import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ScopeSnapshot, Snapshot, TargetStatus } from "../shared/api";
import { diffServers, readJsonDoc } from "./mcp-config";
import { harnesses, SOURCE_ID, type HarnessDef, type ServerMap } from "./harness";

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
    const projectId = record.projectId;
    const rootPath = record.rootPath;
    const displayName = record.displayName;
    if (typeof projectId !== "string" || typeof rootPath !== "string") {
      continue;
    }
    out.push({
      projectId,
      rootPath,
      displayName: typeof displayName === "string" ? displayName : rootPath,
    });
  }
  return out;
}

function readServers(harness: HarnessDef, path: string): ServerMap {
  const { doc } = readJsonDoc(path);
  return harness.format.read(doc);
}

function toNamed(source: ServerMap): { name: string; server: ServerMap[string] }[] {
  return Object.entries(source)
    .map(([name, server]) => ({ name, server }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function targetStatus(harness: HarnessDef, path: string, source: ServerMap): TargetStatus {
  const exists = existsSync(path);
  const servers = exists ? readServers(harness, path) : {};
  const diff = exists ? diffServers(source, servers) : { missing: Object.keys(source), extra: [], drifted: [] };
  const outOfSync = diff.missing.length > 0 || diff.drifted.length > 0 || diff.extra.length > 0;
  return {
    harness: harness.id,
    label: harness.label,
    path,
    exists,
    isSource: harness.isSource,
    servers: toNamed(servers),
    missing: [...diff.missing].sort(),
    extra: [...diff.extra].sort(),
    drifted: [...diff.drifted].sort(),
    status: harness.isSource ? "source" : exists ? (outOfSync ? "out-of-sync" : "in-sync") : "unavailable",
  };
}

export function buildUserScope(): ScopeSnapshot {
  const all = harnesses();
  const source = all.find((harness) => harness.id === SOURCE_ID);
  const sourcePath = source?.userPath ?? "";
  const sourceServers = source ? readServers(source, sourcePath) : {};
  const targets = all.map((harness) => targetStatus(harness, harness.userPath, sourceServers));
  return {
    scope: "user",
    projectId: null,
    projectName: null,
    dir: null,
    sourcePath,
    sourceExists: existsSync(sourcePath),
    sourceServers: toNamed(sourceServers),
    targets,
  };
}

export function buildProjectScope(project: ProjectEntry): ScopeSnapshot {
  const all = harnesses();
  const source = all.find((harness) => harness.id === SOURCE_ID);
  const sourcePath = source?.projectPath?.(project.rootPath) ?? "";
  const sourceServers = source && sourcePath ? readServers(source, sourcePath) : {};
  const targets: TargetStatus[] = [];
  for (const harness of all) {
    if (!harness.projectPath) {
      continue;
    }
    targets.push(targetStatus(harness, harness.projectPath(project.rootPath), sourceServers));
  }
  return {
    scope: "project",
    projectId: project.projectId,
    projectName: project.displayName,
    dir: project.rootPath,
    sourcePath,
    sourceExists: sourcePath.length > 0 && existsSync(sourcePath),
    sourceServers: toNamed(sourceServers),
    targets,
  };
}

export function buildSnapshot(): Snapshot {
  return {
    fetchedAt: Date.now(),
    user: buildUserScope(),
    projects: readProjects().map(buildProjectScope),
  };
}
