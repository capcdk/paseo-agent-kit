import { applySync } from "./sync";
import { findHarness, harnesses } from "./harness";
import { loadKitStore, saveKitStore } from "./kit-store";
import { t } from "./locale";
import { globalLockReason, readProjects, relocateSkillSource, syncSkills } from "./skills";

function nextProjectIds(ids: readonly string[], projectId: string, mount: boolean): string[] {
  if (mount) {
    return ids.includes(projectId) ? [...ids] : [...ids, projectId];
  }
  return ids.filter((id) => id !== projectId);
}

export function projectRoot(projectId: string): string {
  const project = readProjects().find((entry) => entry.projectId === projectId);
  if (!project) {
    throw new Error(t("unknownProject", { id: projectId }));
  }
  return project.rootPath;
}

function throwIfFailed(failed: readonly { path: string; error: string }[]): void {
  if (failed.length > 0) {
    throw new Error(failed.map((failure) => `${failure.path}: ${failure.error}`).join("\n"));
  }
}

/** Approval keys may embed a config hash, so this reruns whenever a project entry is written or changed. */
async function approveEverywhere(rootPath: string, name: string): Promise<void> {
  await Promise.all(
    harnesses().map((harness) => (harness.mcp.projectPath && harness.mcp.approveProject ? harness.mcp.approveProject(rootPath, name) : null)),
  );
}

export async function approveProjectMcp(harnessId: string, rootPath: string, name: string): Promise<void> {
  const harness = findHarness(harnessId);
  if (!harness.mcp.approveProject) {
    throw new Error(t("noApproval", { harness: harness.label }));
  }
  await harness.mcp.approveProject(rootPath, name);
}

export async function reapproveMountedMcp(name: string): Promise<void> {
  const def = loadKitStore().servers.find((server) => server.name === name);
  if (!def || !def.enabled || def.userLevel) {
    return;
  }
  const projects = readProjects().filter((project) => def.projectIds.includes(project.projectId));
  await Promise.all(projects.map((project) => approveEverywhere(project.rootPath, name)));
}

export function setSkillUserLevel(name: string, userLevel: boolean): void {
  const store = loadKitStore();
  const def = store.skills.find((skill) => skill.name === name);
  if (!def) {
    throw new Error(t("unknownSkill", { name }));
  }
  const lock = globalLockReason(name);
  if (!userLevel && lock) {
    throw new Error(t("cannotUnglobal", { name, reason: lock }));
  }
  const sourcePath = userLevel ? def.sourcePath : relocateSkillSource(name, def.sourcePath);
  saveKitStore({
    ...store,
    skills: store.skills.map((skill) => (skill.name === name ? { ...skill, userLevel, sourcePath } : skill)),
  });
  throwIfFailed(syncSkills().failed);
}

export async function setUserLevel(name: string, userLevel: boolean): Promise<void> {
  const store = loadKitStore();
  if (!store.servers.some((server) => server.name === name)) {
    throw new Error(t("unknownMcp", { name }));
  }
  saveKitStore({
    ...store,
    servers: store.servers.map((server) => (server.name === name ? { ...server, userLevel } : server)),
  });
  throwIfFailed(applySync("all", null).failed);
  if (!userLevel) {
    await reapproveMountedMcp(name);
  }
}

export async function setProjectMount(kind: "mcp" | "skill", name: string, projectId: string, mount: boolean): Promise<void> {
  const rootPath = projectRoot(projectId);
  const store = loadKitStore();
  if (kind === "mcp") {
    const def = store.servers.find((server) => server.name === name);
    if (!def) {
      throw new Error(t("unknownMcp", { name }));
    }
    if (def.userLevel) {
      throw new Error(t("alreadyGlobal", { name }));
    }
    saveKitStore({
      ...store,
      servers: store.servers.map((server) =>
        server.name === name ? { ...server, projectIds: nextProjectIds(server.projectIds, projectId, mount) } : server,
      ),
    });
    throwIfFailed(applySync("project", projectId).failed);
    if (mount && def.enabled) {
      await approveEverywhere(rootPath, name);
    }
    return;
  }
  const skillDef = store.skills.find((skill) => skill.name === name);
  if (!skillDef) {
    throw new Error(t("unknownSkill", { name }));
  }
  if (skillDef.userLevel) {
    throw new Error(t("alreadyGlobal", { name }));
  }
  saveKitStore({
    ...store,
    skills: store.skills.map((skill) =>
      skill.name === name ? { ...skill, projectIds: nextProjectIds(skill.projectIds, projectId, mount) } : skill,
    ),
  });
  throwIfFailed(syncSkills().failed);
}
