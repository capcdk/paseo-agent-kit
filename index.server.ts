import { existsSync } from "node:fs";
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
  skillDiscoverRpc,
  skillInstallRpc,
  skillSyncRpc,
  skillUpdateRpc,
  skillUpsertRpc,
  syncRpc,
  trustRpc,
  userLevelRpc,
} from "./shared/api";
import { buildKitStatus, probeProject } from "./server/status";
import { applySync, planSync, purgeMcpServer } from "./server/sync";
import { loadKitStore, saveKitStore } from "./server/kit-store";
import { importFromHarnesses } from "./server/import";
import { harnesses } from "./server/harness";
import { setDeviceLocale, t } from "./server/locale";
import { isNpxOwned, npxInstall, npxList, npxOutputTail, npxRemove, npxUpdate, parseSkillList } from "./server/npx";
import {
  approveProjectMcp,
  projectRoot,
  reapproveMountedMcp,
  setProjectMount,
  setSkillUserLevel,
  setUserLevel,
  throwIfFailed,
} from "./server/mount";
import {
  deleteSkillSource,
  detachSkillSource,
  detachTarget,
  normalizeNpxOwned,
  readProjects,
  skillDeleteBlocker,
  skillDescription,
  syncSkills,
} from "./server/skills";

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
    const { servers, skills } = loadKitStore();
    const matching = harnesses().filter((harness) => harness.providerPattern?.test(request.config.provider));
    const ignoresProjectMcp = matching.some((harness) => !harness.mcp.projectLoaded);
    const ignoresProjectSkills = matching.some((harness) => harness.skills !== null && !harness.skills.projectLoaded);
    const projectId = ignoresProjectMcp || ignoresProjectSkills ? projectForCwd(request.config.cwd) : null;
    const injectable = servers.filter(
      (def) =>
        def.enabled &&
        (def.url || def.command) &&
        (def.sessionInject || (ignoresProjectMcp && projectId !== null && !def.userLevel && def.projectIds.includes(projectId))),
    );
    // Such harnesses never look in project skill directories, so tell the model where this project's skills are.
    const projectSkills =
      ignoresProjectSkills && projectId !== null
        ? skills.filter((def) => def.enabled && !def.userLevel && def.projectIds.includes(projectId) && existsSync(def.sourcePath))
        : [];
    if (injectable.length === 0 && projectSkills.length === 0) {
      return;
    }
    const injected: NonNullable<(typeof request)["config"]["mcpServers"]> = {};
    for (const def of injectable) {
      injected[def.name] = def.url
        ? { type: def.transport === "sse" ? "sse" : "http", url: def.url, ...(def.headers ? { headers: def.headers } : {}) }
        : { type: "stdio", command: def.command ?? "", args: def.args ?? [], ...(def.env ? { env: def.env } : {}) };
    }
    const skillNote =
      projectSkills.length > 0
        ? [
            "This project has skills that are not auto-loaded in this session. When a task matches one of them, read its SKILL.md first and follow it:",
            ...projectSkills.map((def) => `- ${def.name}: ${skillDescription(def.sourcePath).slice(0, 300)} (${def.sourcePath.replace(/\/+$/, "")}/SKILL.md)`),
          ].join("\n")
        : null;
    return {
      ...request,
      config: {
        ...request.config,
        mcpServers: { ...(request.config.mcpServers ?? {}), ...injected },
        ...(skillNote ? { systemPrompt: [request.config.systemPrompt, skillNote].filter(Boolean).join("\n\n") } : {}),
      },
    };
  });

  // Reconcile once at startup and again whenever the set of installed harnesses changes
  // (plugin update that adds a harness, a CLI installed later): the catalog is the source of truth.
  let reconciledFor = "";
  server.handle(kitStatusRpc, async ({ deviceLocale }) => {
    setDeviceLocale(deviceLocale);
    if (normalizeNpxOwned()) {
      syncSkills();
    }
    const installed = harnesses().map((harness) => harness.id).join(",");
    if (installed !== reconciledFor) {
      reconciledFor = installed;
      // never reconcile from an empty or unreadable catalog: that would strip every entry we own
      const catalog = loadKitStore();
      if (catalog.importedAt !== null && catalog.servers.length + catalog.skills.length > 0) {
        applySync("all", null);
      }
    }
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
    normalizeNpxOwned();
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

  // Uninstall: out of the catalog, then out of every harness config (owned or not).
  server.handle(serverDeleteRpc, async ({ name }) => {
    const store = loadKitStore();
    if (!store.servers.some((entry) => entry.name === name)) {
      throw new Error(t("unknownServer", { name }));
    }
    saveKitStore({ ...store, servers: store.servers.filter((entry) => entry.name !== name) });
    throwIfFailed(purgeMcpServer(name).failed);
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
  server.handle(skillDeleteRpc, async ({ name, mode }) => {
    const store = loadKitStore();
    const removed = [...new Set(store.skills.filter((entry) => entry.name === name).map((entry) => entry.sourcePath))];
    if (removed.length === 0) {
      throw new Error(t("unknownSkill", { name }));
    }
    const npxOwned = isNpxOwned(name);
    // Local folders are touched on disk, so every check runs before anything changes.
    if (!npxOwned) {
      if (name === "paseo" || name.startsWith("paseo-")) {
        throw new Error(t("paseoBundledNoDelete", { name }));
      }
      for (const path of removed) {
        const blocker = mode === "delete" ? skillDeleteBlocker(path) : null;
        if (blocker) {
          throw new Error(t("deleteBlocked", { path, reason: blocker }));
        }
        const target = mode === "delist" ? detachTarget(name, path) : null;
        if (target !== null && existsSync(target)) {
          throw new Error(t("relocateTargetExists", { path: target }));
        }
      }
    }
    saveKitStore({ ...store, skills: store.skills.filter((entry) => entry.name !== name) });
    throwIfFailed(syncSkills(removed).failed);
    if (npxOwned) {
      const run = await npxRemove(name);
      if (run.code !== 0) {
        throw new Error(t("npxCommandFailed", { detail: npxOutputTail(run) }));
      }
    } else {
      for (const path of removed) {
        if (mode === "delete") {
          deleteSkillSource(path);
        } else {
          detachSkillSource(name, path);
        }
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

  server.handle(skillDiscoverRpc, async ({ repo }) => {
    const run = await npxList(repo);
    const { skills, skipped } = parseSkillList(run.out);
    if (run.code !== 0 || skills.length === 0) {
      throw new Error(t("npxCommandFailed", { detail: npxOutputTail(run) }));
    }
    return { skills: skills.map((skill) => ({ ...skill, installed: isNpxOwned(skill.name) })), skipped };
  });

  server.handle(skillInstallRpc, async ({ repo, skills }) => {
    const before = new Set(loadKitStore().skills.map((entry) => entry.name));
    const run = await npxInstall(repo, skills);
    if (run.code !== 0) {
      throw new Error(t("npxCommandFailed", { detail: npxOutputTail(run) }));
    }
    const result = importFromHarnesses();
    normalizeNpxOwned();
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
