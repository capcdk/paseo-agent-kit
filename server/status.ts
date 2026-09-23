import { existsSync } from "node:fs";
import type { KitStatus, ProbeCell } from "../shared/api";
import type { McpServerDef } from "../shared/store";
import { harnesses } from "./harness";
import { loadKitStore } from "./kit-store";
import { t } from "./locale";
import { staticCells, type ProbeNames } from "./probe";
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
  const all = harnesses();
  const mcp = [...store.servers].sort((a, b) => a.name.localeCompare(b.name));
  const skills = [...store.skills].sort((a, b) => a.name.localeCompare(b.name));
  return {
    fetchedAt: Date.now(),
    importedAt: store.importedAt,
    locale: store.locale,
    importSources: all.map((harness) => harness.label),
    harnesses: all
      .filter((harness) => harness.probe)
      .map((harness) => ({
        id: harness.id,
        label: harness.label,
        projectSkills: Boolean(harness.skills?.projectLink && harness.skills.projectLoaded),
        canApprove: Boolean(harness.mcp.projectPath && harness.mcp.approveProject),
      })),
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

export async function probeProject(rootPath: string, names: ProbeNames): Promise<ProbeCell[]> {
  const probed = harnesses().filter((harness) => harness.probe);
  if (!existsSync(rootPath)) {
    const detail = t("projectDirMissing");
    return probed.flatMap((harness) => [
      ...staticCells("mcp", harness.id, names.mcp, detail),
      ...staticCells("skill", harness.id, names.skills, detail),
    ]);
  }
  const results = await Promise.all(probed.map((harness) => harness.probe?.(rootPath, names) ?? []));
  return results.flat();
}
