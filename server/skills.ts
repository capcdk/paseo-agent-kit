import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, symlinkSync, lstatSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readJsonDoc } from "./mcp-config";
import { loadKitStore } from "./kit-store";

const PROJECTS_PATH = join(homedir(), ".paseo", "projects", "projects.json");

export interface SkillHarnessDef {
  readonly id: string;
  readonly label: string;
  /** user-level skills root; null = harness has no user skill dir we manage */
  readonly skillUserPath: string | null;
  /** project-level skills root builder; null = no project skill support */
  readonly skillProjectPath: ((dir: string) => string) | null;
}

export function skillHarnesses(): readonly SkillHarnessDef[] {
  const home = homedir();
  return [
    { id: "cursor", label: "Cursor", skillUserPath: join(home, ".cursor", "skills"), skillProjectPath: (dir) => join(dir, ".cursor", "skills") },
    { id: "kiro", label: "Kiro", skillUserPath: join(home, ".kiro", "skills"), skillProjectPath: (dir) => join(dir, ".kiro", "skills") },
    // qoder discovers ~/.agents/skills + ~/.qoder/skills and <project>/.agents|.qoder/skills (verified in a live session)
    { id: "qoder", label: "Qoder", skillUserPath: join(home, ".agents", "skills"), skillProjectPath: (dir) => join(dir, ".qoder", "skills") },
  ];
}

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

function placeLink(sourceDir: string, linkPath: string): void {
  mkdirSync(linkPath.slice(0, linkPath.lastIndexOf("/")), { recursive: true });
  if (isManagedLink(linkPath)) {
    unlinkSync(linkPath);
  }
  symlinkSync(sourceDir, linkPath);
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
    const projectRoots = def.userLevel
      ? []
      : projects.filter((project) => def.projectIds.includes(project.projectId)).map((project) => project.rootPath);
    for (const harness of skillHarnesses()) {
      const bases = [
        def.userLevel ? harness.skillUserPath : null,
        ...projectRoots.map((root) => harness.skillProjectPath?.(root) ?? null),
      ];
      for (const base of bases) {
        if (!base) {
          continue;
        }
        // the skill already lives in this root — nothing to link
        if (normalizedSource.startsWith(`${base}/`)) {
          continue;
        }
        const linkPath = join(base, def.name);
        desiredLinks.push(linkPath);
        if (existsSync(linkPath) && !isManagedLink(linkPath)) {
          failed.push({ path: linkPath, error: "目标位置已被真实目录占用，未覆盖" });
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
  }

  for (const harness of skillHarnesses()) {
    const bases = [harness.skillUserPath, ...projects.map((project) => harness.skillProjectPath?.(project.rootPath) ?? null)];
    for (const base of bases) {
      if (!base || !existsSync(base)) {
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
  }

  return { placed, removed, failed };
}

/** Where skills live once they stop being global: outside every root a harness scans on its own. */
export const MANAGED_SKILLS_ROOT = join(homedir(), ".paseo", "agent-kit", "skills");

/** User-level roots that harnesses scan directly (verified in live sessions), beyond the ones we link into. */
function autoScannedUserRoots(): string[] {
  const home = homedir();
  return [
    join(home, ".agents", "skills"),
    join(home, ".claude", "skills"),
    join(home, ".cursor", "skills"),
    join(home, ".kiro", "skills"),
    join(home, ".qoder", "skills"),
  ];
}

/** Paseo copies its bundled skills back into ~/.agents/skills, so they cannot leave the user level. */
export function globalLockReason(name: string): string | null {
  return name === "paseo" || name.startsWith("paseo-") ? "Paseo 自带 Skill，会被 Paseo 重新同步到用户目录" : null;
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
  const source = sourcePath.replace(/\/+$/, "");
  if (!autoScannedUserRoots().some((root) => isInside(source, root))) {
    return source;
  }
  const target = join(MANAGED_SKILLS_ROOT, name);
  if (existsSync(target)) {
    throw new Error(`迁移目标已存在：${target}`);
  }
  const roots = [
    ...autoScannedUserRoots(),
    ...readProjects().flatMap((project) =>
      skillHarnesses().map((harness) => harness.skillProjectPath?.(project.rootPath) ?? null),
    ),
  ];
  for (const root of roots) {
    if (!root || !existsSync(root)) {
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
    out.push({ name: match?.[1] ?? entry.name, sourcePath: join(root, entry.name) });
  }
  return out;
}
