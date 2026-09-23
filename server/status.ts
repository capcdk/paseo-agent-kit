import type { KitStatus } from "../shared/api";
import type { McpServerDef } from "../shared/store";
import { harnesses } from "./harness";
import { loadKitStore } from "./kit-store";
import { PROJECT_HARNESS_IDS } from "./probe";
import { globalLockReason, readProjects } from "./skills";

function mcpSummary(def: McpServerDef): string {
  if (def.url) {
    return def.url;
  }
  if (def.command) {
    return [def.command, ...(def.args ?? [])].join(" ");
  }
  return def.transport;
}

export function buildKitStatus(): KitStatus {
  const store = loadKitStore();
  const projects = readProjects();
  const labels = new Map(harnesses().map((harness) => [harness.id, harness.label]));
  const mcp = [...store.servers].sort((a, b) => a.name.localeCompare(b.name));
  const skills = [...store.skills].sort((a, b) => a.name.localeCompare(b.name));
  return {
    fetchedAt: Date.now(),
    importedAt: store.importedAt,
    harnesses: PROJECT_HARNESS_IDS.map((id) => ({ id, label: labels.get(id) ?? id })),
    mcp: mcp.map((def) => ({ name: def.name, summary: mcpSummary(def), userLevel: def.userLevel, globalLock: null })),
    skills: skills.map((def) => ({
      name: def.name,
      summary: def.sourcePath,
      userLevel: def.userLevel,
      globalLock: globalLockReason(def.name),
    })),
    projects: projects.map((project) => ({
      projectId: project.projectId,
      name: project.displayName,
      rootPath: project.rootPath,
      mountedMcp: mcp.filter((def) => def.projectIds.includes(project.projectId)).map((def) => def.name),
      mountedSkills: skills.filter((def) => def.projectIds.includes(project.projectId)).map((def) => def.name),
    })),
  };
}
