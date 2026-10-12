import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, lstatSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readJsonDoc } from "./mcp-config";
import { loadKitStore } from "./kit-store";
import { autoScannedUserSkillRoots, harnesses, projectSkillRoots } from "./harness";
import { t } from "./locale";
import { isNpxOwned } from "./npx";

const PROJECTS_PATH = join(homedir(), ".paseo", "projects", "projects.json");

export interface ProjectEntry {
  readonly projectId: string;
  readonly rootPath: string;
  readonly displayName: string;
}

export function readProjects(): readonly ProjectEntry[] {
  const { doc } = readJsonDoc(PROJECTS_PATH);
  if (!Array.isArray(doc)) {
    return [];
  }
  const out: ProjectEntry[] = [];
  for (const entry of doc) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    if (record.archivedAt) {
      continue;
    }
    const { projectId, rootPath, displayName } = record as Record<string, unknown>;
    if (typeof projectId !== "string" || typeof rootPath !== "string") {
      continue;
    }
    out.push({ projectId, rootPath, displayName: typeof displayName === "string" ? displayName : rootPath });
  }
  return out;
}

function isManagedLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function linkTarget(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

/** Whether two directory trees hold the same files with the same bytes (.DS_Store aside). */
export function treesIdentical(a: string, b: string): boolean {
  try {
    const list = (dir: string) => readdirSync(dir).filter((entry) => entry !== ".DS_Store").sort();
    const left = list(a);
    const right = list(b);
    if (left.length !== right.length || left.some((entry, index) => entry !== right[index])) {
      return false;
    }
    return left.every((entry) => {
      const x = join(a, entry);
      const y = join(b, entry);
      const dirX = lstatSync(x).isDirectory();
      if (dirX !== lstatSync(y).isDirectory()) {
        return false;
      }
      return dirX ? treesIdentical(x, y) : readFileSync(x).equals(readFileSync(y));
    });
  } catch {
    return false;
  }
}

/** Copies Agent Kit replaced with links are parked here instead of being deleted. */
export const REPLACED_SKILLS_ROOT = join(homedir(), ".paseo", "agent-kit", "replaced");

/** Put a real directory aside (copy, then remove) so a link can take its place. */
function parkReplacedCopy(name: string, dir: string): void {
  const dest = join(REPLACED_SKILLS_ROOT, `${Date.now()}-${name}`);
  mkdirSync(REPLACED_SKILLS_ROOT, { recursive: true });
  cpSync(dir, dest, { recursive: true });
  rmSync(dir, { recursive: true });
}

function placeLink(sourceDir: string, linkPath: string): void {
  mkdirSync(linkPath.slice(0, linkPath.lastIndexOf("/")), { recursive: true });
  if (isManagedLink(linkPath)) {
    unlinkSync(linkPath);
  }
  symlinkSync(sourceDir, linkPath);
}

function userLinkRoots(): string[] {
  return harnesses().flatMap((harness) => (harness.skills ? [harness.skills.userLink] : []));
}

function projectLinkRoots(dir: string): string[] {
  return harnesses().flatMap((harness) => (harness.skills?.projectLink ? [harness.skills.projectLink(dir)] : []));
}

export interface SkillSyncResult {
  readonly placed: string[];
  readonly removed: string[];
  readonly failed: { path: string; error: string }[];
}

/**
 * Reconcile skill links with the store: every enabled skill to its bound scopes.
 * Removal is conservative: only links whose resolved target is one of the store's
 * own skill sourcePaths are swept — foreign symlinks (other sync tools, paseo bundles)
 * in shared roots like ~/.agents/skills are never touched.
 */
export function syncSkills(removedSources: readonly string[] = []): SkillSyncResult {
  const store = loadKitStore();
  const projects = readProjects();
  const sourcePaths = new Set([...store.skills.map((def) => def.sourcePath), ...removedSources]);
  const placed: string[] = [];
  const removed: string[] = [];
  const failed: { path: string; error: string }[] = [];
  const desiredLinks: string[] = [];

  for (const def of store.skills) {
    if (!def.enabled || !existsSync(def.sourcePath)) {
      continue;
    }
    const normalizedSource = def.sourcePath.endsWith("/") ? def.sourcePath.slice(0, -1) : def.sourcePath;
    const realSource = linkTarget(def.sourcePath);
    const bases = def.userLevel
      ? userLinkRoots()
      : projects.filter((project) => def.projectIds.includes(project.projectId)).flatMap((project) => projectLinkRoots(project.rootPath));
    for (const base of bases) {
      // the skill already lives in this root — nothing to link
      if (normalizedSource.startsWith(`${base}/`)) {
        continue;
      }
      const linkPath = join(base, def.name);
      desiredLinks.push(linkPath);
      if (existsSync(linkPath) && !isManagedLink(linkPath) && linkTarget(linkPath) === realSource) {
        continue;
      }
      // A byte-identical real copy is an uncontrolled duplicate: park it and link the managed source in its place.
      if (existsSync(linkPath) && !isManagedLink(linkPath) && lstatSync(linkPath).isDirectory() && treesIdentical(linkPath, def.sourcePath)) {
        try {
          parkReplacedCopy(def.name, linkPath);
        } catch (error) {
          failed.push({ path: linkPath, error: error instanceof Error ? error.message : String(error) });
          continue;
        }
      }
      if (existsSync(linkPath) && !isManagedLink(linkPath)) {
        failed.push({ path: linkPath, error: t("linkOccupied") });
        continue;
      }
      try {
        placeLink(def.sourcePath, linkPath);
        placed.push(linkPath);
      } catch (error) {
        failed.push({ path: linkPath, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  const sweepRoots = [...userLinkRoots(), ...projects.flatMap((project) => projectLinkRoots(project.rootPath))];
  for (const base of sweepRoots) {
    if (!existsSync(base)) {
      continue;
    }
    for (const name of readdirSync(base)) {
      const linkPath = join(base, name);
      if (!isManagedLink(linkPath) || desiredLinks.includes(linkPath)) {
        continue;
      }
      const target = linkTarget(linkPath);
      if (target === null || ![...sourcePaths].some((source) => target === source || target.startsWith(`${source}/`))) {
        continue;
      }
      try {
        unlinkSync(linkPath);
        removed.push(linkPath);
      } catch (error) {
        failed.push({ path: linkPath, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  return { placed, removed, failed };
}

/** Where skills live once they stop being global: outside every root a harness scans on its own. */
export const MANAGED_SKILLS_ROOT = join(homedir(), ".paseo", "agent-kit", "skills");

/** Paseo copies its bundled skills back into ~/.agents/skills, so they cannot leave the user level. */
export function globalLockReason(name: string): string | null {
  if (name === "paseo" || name.startsWith("paseo-")) {
    return t("paseoBundledLock");
  }
  if (isNpxOwned(name)) {
    return t("npxManagedLock");
  }
  return null;
}

function isInside(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

/**
 * Move a skill's source out of auto-scanned user roots so dropping the user-level
 * links actually hides it. Links (ours or other tools') to the old path are removed
 * first; syncSkills then re-links the new path wherever the skill is still bound.
 */
export function relocateSkillSource(name: string, sourcePath: string): string {
  if (isNpxOwned(name)) {
    throw new Error(t("cannotUnglobal", { name, reason: t("npxManagedLock") }));
  }
  const source = sourcePath.replace(/\/+$/, "");
  const userRoots = autoScannedUserSkillRoots();
  if (!userRoots.some((root) => isInside(source, root))) {
    return source;
  }
  const target = join(MANAGED_SKILLS_ROOT, name);
  if (existsSync(target)) {
    throw new Error(t("relocateTargetExists", { path: target }));
  }
  const roots = [...userRoots, ...readProjects().flatMap((project) => projectSkillRoots(project.rootPath))];
  for (const root of roots) {
    if (!existsSync(root)) {
      continue;
    }
    for (const entry of readdirSync(root)) {
      const linkPath = join(root, entry);
      if (isManagedLink(linkPath) && linkTarget(linkPath) === source) {
        unlinkSync(linkPath);
      }
    }
  }
  mkdirSync(MANAGED_SKILLS_ROOT, { recursive: true });
  renameSync(source, target);
  return target;
}

/**
 * Whether a skill folder may be wiped from disk. The folder must look like a
 * skill (SKILL.md), and must not be something much bigger that merely contains
 * one: a git repository root, a skill root, a project, or a shallow path.
 * Returns the reason it is unsafe, or null.
 */
export function skillDeleteBlocker(sourcePath: string): string | null {
  const source = sourcePath.replace(/\/+$/, "");
  if (!existsSync(source)) {
    return null;
  }
  if (isManagedLink(source)) {
    return null;
  }
  if (!lstatSync(source).isDirectory() || !existsSync(join(source, "SKILL.md"))) {
    return t("deleteBlockNotSkill");
  }
  if (source.split("/").filter(Boolean).length < 3 || source === homedir()) {
    return t("deleteBlockShallow");
  }
  if (existsSync(join(source, ".git"))) {
    return t("deleteBlockRepo");
  }
  const projects = readProjects();
  const roots = [...autoScannedUserSkillRoots(), MANAGED_SKILLS_ROOT, ...projects.flatMap((project) => projectSkillRoots(project.rootPath))];
  if (roots.some((root) => isInside(root, source))) {
    return t("deleteBlockRoot");
  }
  if (projects.some((project) => isInside(project.rootPath, source))) {
    return t("deleteBlockProject");
  }
  return null;
}

/** Whether the source sits in a directory some harness scans by itself (user level or any project). */
function inScannedRoot(source: string): boolean {
  const roots = [...autoScannedUserSkillRoots(), ...readProjects().flatMap((project) => projectSkillRoots(project.rootPath))];
  return roots.some((root) => isInside(source, root));
}

/** Where detachSkillSource would move the folder, or null when the folder stays where it is. */
export function detachTarget(name: string, sourcePath: string): string | null {
  const source = sourcePath.replace(/\/+$/, "");
  if (!existsSync(source) || isManagedLink(source) || !inScannedRoot(source)) {
    return null;
  }
  return join(MANAGED_SKILLS_ROOT, name);
}

/**
 * Stop harnesses from loading a skill without deleting its files. A folder sitting
 * in a directory harnesses scan on their own is moved to MANAGED_SKILLS_ROOT (else it
 * would keep loading, and Re-scan would import it again); a symlink there is just
 * unlinked; a folder elsewhere is left alone. Callers sweep our own links separately.
 */
export function detachSkillSource(name: string, sourcePath: string): void {
  const source = sourcePath.replace(/\/+$/, "");
  if (isManagedLink(source)) {
    if (inScannedRoot(source)) {
      unlinkSync(source);
    }
    return;
  }
  const target = detachTarget(name, source);
  if (target === null) {
    return;
  }
  if (existsSync(target)) {
    throw new Error(t("relocateTargetExists", { path: target }));
  }
  mkdirSync(MANAGED_SKILLS_ROOT, { recursive: true });
  renameSync(source, target);
}

/** Remove a skill's folder (or just the link when the source is a symlink). Callers check skillDeleteBlocker first. */
export function deleteSkillSource(sourcePath: string): void {
  const source = sourcePath.replace(/\/+$/, "");
  if (isManagedLink(source)) {
    unlinkSync(source);
    return;
  }
  if (existsSync(source)) {
    rmSync(source, { recursive: true });
  }
}

/** YAML allows quoted names (`name: "foo"`); the quotes must not leak into paths. */
function unquoteYamlScalar(value: string): string {
  const match = /^(["'])(.*)\1$/.exec(value);
  return match ? match[2] : value;
}

/** Scan a skills root for directories containing SKILL.md with a name field. */
export function listSkillsInRoot(root: string): { name: string; sourcePath: string }[] {
  if (!existsSync(root)) {
    return [];
  }
  const out: { name: string; sourcePath: string }[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) {
      continue;
    }
    const skillMd = join(root, entry.name, "SKILL.md");
    if (!existsSync(skillMd)) {
      continue;
    }
    const raw = readFileSync(skillMd, "utf8");
    const match = /^name:\s*(\S+)/m.exec(raw);
    out.push({ name: unquoteYamlScalar(match?.[1] ?? entry.name), sourcePath: join(root, entry.name) });
  }
  return out;
}
