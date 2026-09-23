
import type { KitStore, McpServerDef, SkillDef } from "../shared/store";
import { harnesses, SOURCE_ID } from "./harness";
import { loadKitStore, saveKitStore } from "./kit-store";
import { readJsonDoc } from "./mcp-config";
import { realpathSync } from "node:fs";
import { listSkillsInRoot, readProjects, skillHarnesses } from "./skills";

/** Convert a raw cursor-file server entry into a store def (deduce transport). */
function toServerDef(name: string, server: Record<string, unknown>, userLevel: boolean): McpServerDef {
  const command = typeof server.command === "string" ? server.command : undefined;
  const url = typeof server.url === "string" ? server.url : undefined;
  return {
    name,
    ...(command ? { command } : {}),
    ...(Array.isArray(server.args) ? { args: server.args.filter((a): a is string => typeof a === "string") } : {}),
    ...(server.env && typeof server.env === "object" ? { env: Object.fromEntries(Object.entries(server.env).filter(([, v]) => typeof v === "string")) as Record<string, string> } : {}),
    ...(url ? { url } : {}),
    ...(server.headers && typeof server.headers === "object" ? { headers: Object.fromEntries(Object.entries(server.headers).filter(([, v]) => typeof v === "string")) as Record<string, string> } : {}),
    transport: url ? "http" : "stdio",
    enabled: true,
    userLevel,
    projectIds: [],
    sessionInject: false,
  };
}

/** One-time import: harvest cursor user + project MCP configs and skill dirs into the store. Idempotent — merges, never deletes. */
export function importFromCursor(): { servers: number; skills: number; importedAt: number } {
  const store = loadKitStore();
  const importedAt = Date.now();
  const byName = new Map(store.servers.map((def) => [def.name, def]));
  let serverCount = 0;

  for (const harness of harnesses()) {
    if (harness.id !== SOURCE_ID) {
      continue;
    }
    // user level
    const { doc } = readJsonDoc(harness.userPath);
    if (doc && typeof doc === "object" && !Array.isArray(doc)) {
      const mcpServers = (doc as Record<string, unknown>).mcpServers;
      if (mcpServers && typeof mcpServers === "object") {
        for (const [name, value] of Object.entries(mcpServers as Record<string, unknown>)) {
          if (value && typeof value === "object" && !byName.has(name)) {
            byName.set(name, toServerDef(name, value as Record<string, unknown>, true));
            serverCount += 1;
          }
        }
      }
    }
    // project level: bind existing project .cursor/mcp.json entries to those projects
    for (const project of readProjects()) {
      const projectPath = harness.projectPath?.(project.rootPath);
      if (!projectPath) {
        continue;
      }
      const { doc: projectDoc } = readJsonDoc(projectPath);
      if (!projectDoc || typeof projectDoc !== "object" || Array.isArray(projectDoc)) {
        continue;
      }
      const projectServers = (projectDoc as Record<string, unknown>).mcpServers;
      if (!projectServers || typeof projectServers !== "object") {
        continue;
      }
      for (const [name, value] of Object.entries(projectServers as Record<string, unknown>)) {
        if (!value || typeof value !== "object") {
          continue;
        }
        const existing = byName.get(name);
        if (existing) {
          if (!existing.projectIds.includes(project.projectId)) {
            existing.projectIds.push(project.projectId);
          }
        } else {
          const def = toServerDef(name, value as Record<string, unknown>, false);
          def.projectIds.push(project.projectId);
          byName.set(name, def);
          serverCount += 1;
        }
      }
    }
  }

  const skills: SkillDef[] = [...store.skills];
  const skillByPath = new Set(skills.map((def) => def.sourcePath));
  let skillCount = 0;
  for (const harness of skillHarnesses()) {
    if (!harness.skillUserPath) {
      continue;
    }
    for (const found of listSkillsInRoot(harness.skillUserPath)) {
      const real = realpathSync(found.sourcePath);
      if (!skillByPath.has(found.sourcePath) && !skillByPath.has(real)) {
        skills.push({ name: found.name, sourcePath: real, enabled: true, userLevel: true, projectIds: [] });
        skillByPath.add(real);
        skillCount += 1;
      }
    }
  }

  const next: KitStore = { ...store, importedAt, servers: [...byName.values()], skills };
  saveKitStore(next);
  return { servers: serverCount, skills: skillCount, importedAt };
}
