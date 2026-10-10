import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  kitStatusRpc,
  importRpc,
  localeRpc,
  mountRpc,
  probeRpc,
  serverDeleteRpc,
  serverUpsertRpc,
  skillDeleteRpc,
  skillInstallRpc,
  skillSyncRpc,
  skillUpdateRpc,
  skillUpsertRpc,
  syncRpc,
  trustRpc,
  userLevelRpc,
} from "./shared/api";
import { buildKitStatus, probeProject } from "./server/status";
import { applySync, planSync } from "./server/sync";
import { loadKitStore, saveKitStore } from "./server/kit-store";
import { importFromHarnesses } from "./server/import";
import { harnesses } from "./server/harness";
import { setDeviceLocale, t } from "./server/locale";
import { isNpxOwned, npxInstall, npxOutputTail, npxRemove, npxUpdate } from "./server/npx";
import {
  approveProjectMcp,
  projectRoot,
  reapproveMountedMcp,
  setProjectMount,
  setSkillUserLevel,
  setUserLevel,
  throwIfFailed,
} from "./server/mount";
import { readProjects, syncSkills } from "./server/skills";

function projectForCwd(cwd: string): string | null {
  let best: { projectId: string; length: number } | null = null;
  for (const project of readProjects()) {
    const root = project.rootPath.replace(/\/+$/, "");
    if ((cwd === root || cwd.startsWith(`${root}/`)) && (!best || root.length > best.length)) {
      best = { projectId: project.projectId, length: root.length };
    }
  }
  return best?.projectId ?? null;
}

export default function contribute(server: PluginServerContext) {
  // Session-level injection (Paseo-only), additive to the harness's own config:
  // - servers marked sessionInject go into every agent.create;
  // - sessions of harnesses that ignore project MCP files also get the
  //   non-global servers mounted on the project that owns their cwd.
  server.before("agent.create", ({ request }) => {
    const { servers } = loadKitStore();
    const ignoresProjectMcp = harnesses().some(
      (harness) => !harness.mcp.projectLoaded && harness.providerPattern?.test(request.config.provider),
    );
    const projectId = ignoresProjectMcp ? projectForCwd(request.config.cwd) : null;
    const injectable = servers.filter(
      (def) =>
        def.enabled &&
        (def.url || def.command) &&
        (def.sessionInject || (projectId !== null && !def.userLevel && def.projectIds.includes(projectId))),
    );
    if (injectable.length === 0) {
      return;
    }
    const injected: NonNullable<(typeof request)["config"]["mcpServers"]> = {};
    for (const def of injectable) {
      injected[def.name] = def.url
        ? { type: "http", url: def.url, ...(def.headers ? { headers: def.headers } : {}) }
        : { type: "stdio", command: def.command ?? "", args: def.args ?? [], ...(def.env ? { env: def.env } : {}) };
    }
    return {
      ...request,
      config: {
        ...request.config,
        mcpServers: { ...(request.config.mcpServers ?? {}), ...injected },
      },
    };
  });

  server.handle(kitStatusRpc, async ({ deviceLocale }) => {
    setDeviceLocale(deviceLocale);
    return buildKitStatus();
  });

  server.handle(localeRpc, async ({ locale }) => {
    saveKitStore({ ...loadKitStore(), locale });
    return { ok: true as const };
  });

  server.handle(probeRpc, async ({ projectId }) => {
    const project = readProjects().find((entry) => entry.projectId === projectId);
    if (!project) {
      throw new Error(t("unknownProject", { id: projectId }));
    }
    const store = loadKitStore();
    const cells = await probeProject(project.rootPath, {
      mcp: store.servers.map((server) => server.name),
      skills: store.skills.map((skill) => skill.name),
    });
    return { projectId, cells };
  });

  server.handle(mountRpc, async ({ kind, name, projectId, mount }) => {
    await setProjectMount(kind, name, projectId, mount);
    return { ok: true as const };
  });

  server.handle(userLevelRpc, async ({ kind, name, userLevel }) => {
    if (kind === "skill") {
      setSkillUserLevel(name, userLevel);
    } else {
      await setUserLevel(name, userLevel);
    }
    return { ok: true as const };
  });

  server.handle(trustRpc, async ({ harness, name, projectId }) => {
    await approveProjectMcp(harness, projectRoot(projectId), name);
    return { ok: true as const };
  });

  server.handle(importRpc, async () => {
    const result = importFromHarnesses();
    const sync = syncSkills();
    return { ...result, failed: [...result.failed, ...sync.failed] };
  });

  server.handle(serverUpsertRpc, async ({ previousName, server: def }) => {
    const store = loadKitStore();
    const servers = store.servers.filter((entry) => entry.name !== previousName && entry.name !== def.name);
    servers.push(def);
    saveKitStore({ ...store, servers: servers.sort((a, b) => a.name.localeCompare(b.name)) });
    void applySync("all", null);
    await reapproveMountedMcp(def.name);
    return { ok: true } as const;
  });

  server.handle(serverDeleteRpc, async ({ name }) => {
    const store = loadKitStore();
    saveKitStore({ ...store, servers: store.servers.filter((entry) => entry.name !== name) });
    void applySync("all", null);
    return { ok: true } as const;
  });

  server.handle(skillUpsertRpc, async ({ previousName, skill }) => {
    const store = loadKitStore();
    const skills = store.skills.filter((entry) => entry.name !== previousName && entry.name !== skill.name);
    skills.push(skill);
    saveKitStore({ ...store, skills: skills.sort((a, b) => a.name.localeCompare(b.name)) });
    void syncSkills();
    return { ok: true } as const;
  });

  // Uninstall order matters: sweep our links while the entity is still on disk,
  // then let the CLI remove its own canonical copy and lock entry.
  server.handle(skillDeleteRpc, async ({ name }) => {
    const store = loadKitStore();
    const removed = store.skills.filter((entry) => entry.name === name).map((entry) => entry.sourcePath);
    if (removed.length === 0) {
      throw new Error(t("unknownSkill", { name }));
    }
    saveKitStore({ ...store, skills: store.skills.filter((entry) => entry.name !== name) });
    throwIfFailed(syncSkills(removed).failed);
    if (isNpxOwned(name)) {
      const run = await npxRemove(name);
      if (run.code !== 0) {
        throw new Error(t("npxCommandFailed", { detail: npxOutputTail(run) }));
      }
    }
    return { ok: true } as const;
  });

  server.handle(skillUpdateRpc, async ({ name }) => {
    if (!isNpxOwned(name)) {
      throw new Error(t("notNpxManaged", { name }));
    }
    const run = await npxUpdate(name);
    if (run.code !== 0) {
      throw new Error(t("npxCommandFailed", { detail: npxOutputTail(run) }));
    }
    throwIfFailed(syncSkills().failed);
    return { ok: true } as const;
  });

  server.handle(skillInstallRpc, async ({ repo, skills }) => {
    const before = new Set(loadKitStore().skills.map((entry) => entry.name));
    const run = await npxInstall(repo, skills);
    if (run.code !== 0) {
      throw new Error(t("npxCommandFailed", { detail: npxOutputTail(run) }));
    }
    const result = importFromHarnesses();
    const sync = syncSkills();
    const added = loadKitStore()
      .skills.map((entry) => entry.name)
      .filter((name) => !before.has(name));
    return { ok: true as const, added, failed: [...result.failed, ...sync.failed] };
  });

  server.handle(skillSyncRpc, async () => syncSkills());

  server.handle(syncRpc, async (input) => {
    const projectId = input.projectId ?? null;
    if (!input.apply) {
      return { applied: false, changes: [...planSync(input.scope, projectId)], failed: [] };
    }
    return applySync(input.scope, projectId);
  });

  return () => {};
}
