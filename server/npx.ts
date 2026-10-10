import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { runCli, stripAnsi, type CliRun } from "./probe";

/**
 * Bridge to the `npx skills` CLI (vercel-labs/skills). It owns its own lockfile
 * and canonical copy under ~/.agents; Agent Kit only reads the lock (to know
 * what it must not relocate/un-global) and delegates install/update/remove.
 */

const NPX_AGENTS_ROOT = join(homedir(), ".agents");
const NPX_CANONICAL_SKILLS = join(NPX_AGENTS_ROOT, "skills");
const LOCK_PATH = join(NPX_AGENTS_ROOT, ".skill-lock.json");

const NpxSkillRecordSchema = z.object({
  source: z.string().optional(),
  sourceType: z.string().optional(),
  sourceUrl: z.string().optional(),
  skillPath: z.string().optional(),
  skillFolderHash: z.string().optional(),
  installedAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

const NpxLockSchema = z.object({
  version: z.number().optional(),
  skills: z.record(z.string(), NpxSkillRecordSchema).default({}),
});

type NpxSkillRecord = z.infer<typeof NpxSkillRecordSchema>;

/** name -> lock record for every skill the CLI installed. Malformed lock = empty. */
export function readNpxLock(): Map<string, NpxSkillRecord> {
  const out = new Map<string, NpxSkillRecord>();
  if (!existsSync(LOCK_PATH)) {
    return out;
  }
  try {
    const parsed = NpxLockSchema.safeParse(JSON.parse(readFileSync(LOCK_PATH, "utf8")));
    if (parsed.success) {
      for (const [name, record] of Object.entries(parsed.data.skills)) {
        out.set(name, record);
      }
    }
  } catch {
    return out;
  }
  return out;
}

export function isNpxOwned(name: string): boolean {
  return readNpxLock().has(name);
}

/** Absolute path of the CLI's canonical copy for a skill, when it exists. */
export function canonicalSkillPath(name: string): string | null {
  const path = join(NPX_CANONICAL_SKILLS, name);
  return existsSync(path) ? path : null;
}

/** Clones/updates may hit the network, so these get a much longer leash than probes. */
const NETWORK_TIMEOUT_MS = 240_000;

function npxSkills(args: readonly string[], timeoutMs?: number): Promise<CliRun> {
  return runCli("npx", ["-y", "skills", ...args], homedir(), timeoutMs);
}

/**
 * Install into the canonical dir only: `-a universal` keeps the CLI from
 * symlinking into every known agent directory (its default when no -a is
 * given); distribution stays Agent Kit's job.
 */
export function npxInstall(repo: string, skills: readonly string[]): Promise<CliRun> {
  return npxSkills(
    ["add", repo, ...skills.flatMap((name) => ["-s", name]), "-g", "-y", "-a", "universal", "--full-depth"],
    NETWORK_TIMEOUT_MS,
  );
}

export function npxRemove(name: string): Promise<CliRun> {
  return npxSkills(["remove", name, "-g", "-y"]);
}

export function npxUpdate(name: string): Promise<CliRun> {
  return npxSkills(["update", name, "-g", "-y"], NETWORK_TIMEOUT_MS);
}

/** Last meaningful lines of CLI output, for surfacing in error toasts. */
export function npxOutputTail(run: CliRun): string {
  return stripAnsi(run.out)
    .split("\n")
    .map((line) => line.replace(/^[│◇◆●■├└╮╯\s]+/, "").trim())
    .filter((line) => line.length > 0)
    .slice(-3)
    .join(" / ")
    .slice(-240);
}
