import { applySync } from "./sync";
import { loadKitStore, saveKitStore } from "./kit-store";
import { runCli } from "./probe";
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
    throw new Error(`未知项目：${projectId}`);
  }
  return project.rootPath;
}

function throwIfFailed(failed: readonly { path: string; error: string }[]): void {
  if (failed.length > 0) {
    throw new Error(failed.map((failure) => `${failure.path}: ${failure.error}`).join("\n"));
  }
}

/**
 * Cursor refuses to load project-level MCP servers until they are approved
 * (`not loaded (needs approval)`). Approval keys embed a config hash, so this
 * must rerun whenever the server definition changes.
 */
export async function approveCursorProjectMcp(rootPath: string, name: string): Promise<void> {
  const run = await runCli("agent", ["mcp", "enable", name], rootPath);
  if (run.code !== 0) {
    throw new Error(`Cursor 审批 ${name} 失败：${run.out.trim().slice(-180) || `退出码 ${run.code}`}`);
  }
}

export async function reapproveMountedMcp(name: string): Promise<void> {
  const def = loadKitStore().servers.find((server) => server.name === name);
  if (!def || !def.enabled) {
    return;
  }
  if (def.userLevel) {
    return;
  }
  const projects = readProjects().filter((project) => def.projectIds.includes(project.projectId));
  await Promise.all(projects.map((project) => approveCursorProjectMcp(project.rootPath, name)));
}

export function setSkillUserLevel(name: string, userLevel: boolean): void {
  const store = loadKitStore();
  const def = store.skills.find((skill) => skill.name === name);
  if (!def) {
    throw new Error(`未知 Skill：${name}`);
  }
  const lock = globalLockReason(name);
  if (!userLevel && lock) {
    throw new Error(`${name} 无法取消全局：${lock}`);
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
    throw new Error(`未知 MCP：${name}`);
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
      throw new Error(`未知 MCP：${name}`);
    }
    if (def.userLevel) {
      throw new Error(`${name} 已全局加载，无需按项目挂载`);
    }
    saveKitStore({
      ...store,
      servers: store.servers.map((server) =>
        server.name === name ? { ...server, projectIds: nextProjectIds(server.projectIds, projectId, mount) } : server,
      ),
    });
    throwIfFailed(applySync("project", projectId).failed);
    if (mount && def.enabled) {
      await approveCursorProjectMcp(rootPath, name);
    }
    return;
  }
  const skillDef = store.skills.find((skill) => skill.name === name);
  if (!skillDef) {
    throw new Error(`未知 Skill：${name}`);
  }
  if (skillDef.userLevel) {
    throw new Error(`${name} 已全局加载，无需按项目挂载`);
  }
  saveKitStore({
    ...store,
    skills: store.skills.map((skill) =>
      skill.name === name ? { ...skill, projectIds: nextProjectIds(skill.projectIds, projectId, mount) } : skill,
    ),
  });
  throwIfFailed(syncSkills().failed);
}
