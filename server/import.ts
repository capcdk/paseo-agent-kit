import { existsSync, realpathSync } from "node:fs";
import type { McpServer } from "../shared/api";
import type { KitStore, McpServerDef, SkillDef } from "../shared/store";
import { harnesses, type HarnessDef } from "./harness";
import { loadKitStore, saveKitStore } from "./kit-store";
import { readJsonDoc, serversEqual } from "./mcp-config";
import { listSkillsInRoot, readProjects } from "./skills";
import { applySync } from "./sync";

export interface ImportResult {
  readonly servers: number;
  readonly skills: number;
  readonly conflicts: string[];
  readonly failed: { path: string; error: string }[];
  readonly importedAt: number;
}

function toServerDef(name: string, server: McpServer, userLevel: boolean): McpServerDef {
  return {
    name,
    ...(server.command ? { command: server.command } : {}),
    ...(server.args ? { args: server.args } : {}),
    ...(server.env ? { env: server.env } : {}),
    ...(server.url ? { url: server.url } : {}),
    ...(server.headers ? { headers: server.headers } : {}),
    transport: server.url ? (server.type === "sse" ? "sse" : "http") : "stdio",
    enabled: server.enabled !== false,
    userLevel,
    projectIds: [],
    sessionInject: false,
  };
}

function defToServer(def: McpServerDef): McpServer {
  return {
    ...(def.command ? { command: def.command } : {}),
    ...(def.args ? { args: def.args } : {}),
    ...(def.env ? { env: def.env } : {}),
    ...(def.url ? { url: def.url } : {}),
    ...(def.headers ? { headers: def.headers } : {}),
    enabled: def.enabled,
  };
}

function readServers(harness: HarnessDef, path: string): Record<string, McpServer> {
  return existsSync(path) ? harness.mcp.format.read(readJsonDoc(path).doc) : {};
}

function realPath(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

/**
 * Take over what every registered harness already has: user- and project-level MCP
 * servers and skills. Idempotent — merges by name and never deletes. When two harnesses
 * disagree on a name, the first one in registry order wins and the clash is reported;
 * the follow-up sync then writes the winner everywhere (each file is backed up first).
 */
export function importFromHarnesses(): ImportResult {
  const store = loadKitStore();
  const importedAt = Date.now();
  const projects = readProjects();
  const all = harnesses();
  const conflicts = new Set<string>();

  const servers = new Map(store.servers.map((def) => [def.name, def]));
  const serverOrigin = new Map<string, string>();
  let serverCount = 0;
  const takeServer = (harness: HarnessDef, name: string, server: McpServer, projectId: string | null) => {
    const existing = servers.get(name);
    if (!existing) {
      const def = toServerDef(name, server, projectId === null);
      if (projectId !== null) {
        def.projectIds.push(projectId);
      }
      servers.set(name, def);
      serverOrigin.set(name, harness.label);
      serverCount += 1;
      return;
    }
    if (!serversEqual(defToServer(existing), server)) {
      conflicts.add(`MCP ${name} (${serverOrigin.get(name) ?? "Agent Kit"} ≠ ${harness.label})`);
    }
    if (projectId !== null && !existing.userLevel && !existing.projectIds.includes(projectId)) {
      existing.projectIds.push(projectId);
    }
  };

  for (const harness of all) {
    for (const [name, server] of Object.entries(readServers(harness, harness.mcp.userPath))) {
      takeServer(harness, name, server, null);
    }
  }
  for (const project of projects) {
    for (const harness of all) {
      const path = harness.mcp.projectPath?.(project.rootPath);
      if (!path) {
        continue;
      }
      for (const [name, server] of Object.entries(readServers(harness, path))) {
        takeServer(harness, name, server, project.projectId);
      }
    }
  }

  const skills: SkillDef[] = [...store.skills];
  const skillByName = new Map(skills.map((def) => [def.name, def]));
  const knownSources = new Set(skills.flatMap((def) => [def.sourcePath, realPath(def.sourcePath) ?? def.sourcePath]));
  let skillCount = 0;
  const takeSkill = (name: string, sourcePath: string, projectId: string | null) => {
    const real = realPath(sourcePath);
    if (!real) {
      return;
    }
    const existing = skillByName.get(name);
    if (existing) {
      if (realPath(existing.sourcePath) !== real) {
        conflicts.add(`Skill ${name} (${existing.sourcePath} ≠ ${real})`);
      } else if (projectId !== null && !existing.userLevel && !existing.projectIds.includes(projectId)) {
        existing.projectIds.push(projectId);
      }
      return;
    }
    if (knownSources.has(real)) {
      return;
    }
    const def: SkillDef = { name, sourcePath: real, enabled: true, userLevel: projectId === null, projectIds: projectId ? [projectId] : [] };
    skills.push(def);
    skillByName.set(name, def);
    knownSources.add(real);
    skillCount += 1;
  };

  for (const harness of all) {
    for (const root of harness.skills?.userScan ?? []) {
      for (const found of listSkillsInRoot(root)) {
        takeSkill(found.name, found.sourcePath, null);
      }
    }
  }
  for (const project of projects) {
    for (const harness of all) {
      for (const root of harness.skills?.projectScan(project.rootPath) ?? []) {
        for (const found of listSkillsInRoot(root)) {
          takeSkill(found.name, found.sourcePath, project.projectId);
        }
      }
    }
  }

  const next: KitStore = {
    ...store,
    importedAt,
    servers: [...servers.values()].sort((a, b) => a.name.localeCompare(b.name)),
    skills: skills.sort((a, b) => a.name.localeCompare(b.name)),
  };
  saveKitStore(next);
  const { failed } = applySync("all", null);
  return { servers: serverCount, skills: skillCount, conflicts: [...conflicts], failed, importedAt };
}
