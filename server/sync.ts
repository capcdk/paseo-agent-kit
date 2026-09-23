import { existsSync } from "node:fs";
import type { Change, SyncResult } from "../shared/api";
import type { McpServerDef } from "../shared/store";
import { loadOwnership, ownedFor, readJsonDoc, recordOwned, saveOwnership, serversEqual, writeJsonDoc } from "./mcp-config";
import { harnesses, type HarnessDef, type ServerMap } from "./harness";
import { loadKitStore } from "./kit-store";
import { readProjects, syncSkills } from "./skills";
import type { ProjectEntry } from "./skills";

export type SyncScope = "user" | "project" | "all";

interface TargetPlan {
  readonly harness: HarnessDef;
  readonly scope: "user" | "project";
  readonly projectId: string | null;
  readonly path: string;
  readonly source: ServerMap;
  readonly changes: readonly Change[];
}

function planTarget(
  harness: HarnessDef,
  scope: "user" | "project",
  projectId: string | null,
  path: string,
  source: ServerMap,
  existing: ServerMap,
  owned: ReadonlySet<string>,
): TargetPlan {
  const changes: Change[] = [];
  for (const [name, server] of Object.entries(source)) {
    const current = existing[name];
    if (!current) {
      changes.push({ harness: harness.id, scope, projectId, path, op: "add", server: name });
    } else if (!serversEqual(current, server)) {
      changes.push({ harness: harness.id, scope, projectId, path, op: "update", server: name });
    }
  }
  for (const name of Object.keys(existing)) {
    if (!(name in source) && owned.has(name)) {
      changes.push({ harness: harness.id, scope, projectId, path, op: "remove", server: name });
    }
  }
  return { harness, scope, projectId, path, source, changes };
}

function readTargetServers(harness: HarnessDef, path: string): ServerMap {
  if (!existsSync(path)) {
    return {};
  }
  return harness.format.read(readJsonDoc(path).doc);
}

function defToServer(def: McpServerDef) {
  return {
    ...(def.command ? { command: def.command } : {}),
    ...(def.args ? { args: def.args } : {}),
    ...(def.env ? { env: def.env } : {}),
    ...(def.url ? { url: def.url } : {}),
    ...(def.headers ? { headers: def.headers } : {}),
    enabled: def.enabled,
  };
}

/** Store defs -> desired ServerMap for a given scope, respecting enabled + project binding. */
function desiredServers(
  defs: readonly McpServerDef[],
  scope: "user" | "project",
  projectId: string | null,
): ServerMap {
  const out: ServerMap = {};
  for (const def of defs) {
    if (!def.enabled) {
      continue;
    }
    if (scope === "user" && !def.userLevel) {
      continue;
    }
    // Cursor lets a project entry shadow the user entry of the same name and then
    // gates it behind approval, so global servers must stay out of project files.
    if (scope === "project" && (def.userLevel || !def.projectIds.includes(projectId ?? ""))) {
      continue;
    }
    out[def.name] = defToServer(def);
  }
  return out;
}

function planUser(defs: readonly McpServerDef[]): TargetPlan[] {
  const source = desiredServers(defs, "user", null);
  const ownership = loadOwnership();
  return harnesses().map((harness) =>
    planTarget(
      harness,
      "user",
      null,
      harness.userPath,
      source,
      readTargetServers(harness, harness.userPath),
      ownedFor(ownership, harness.id, "user", null),
    ),
  );
}

function planProjects(defs: readonly McpServerDef[], projectId: string | null): TargetPlan[] {
  const ownership = loadOwnership();
  const projects: readonly ProjectEntry[] = readProjects();
  const selected = projectId ? projects.filter((project) => project.projectId === projectId) : projects;
  const plans: TargetPlan[] = [];
  for (const project of selected) {
    const source = desiredServers(defs, "project", project.projectId);
    for (const harness of harnesses()) {
      const path = harness.projectPath?.(project.rootPath);
      if (!path) {
        continue;
      }
      plans.push(
        planTarget(
          harness,
          "project",
          project.projectId,
          path,
          source,
          readTargetServers(harness, path),
          ownedFor(ownership, harness.id, "project", project.projectId),
        ),
      );
    }
  }
  return plans;
}

function plansFor(scope: SyncScope, projectId: string | null): TargetPlan[] {
  const { servers } = loadKitStore();
  if (scope === "user") {
    return planUser(servers);
  }
  if (scope === "project") {
    return planProjects(servers, projectId);
  }
  return [...planUser(servers), ...planProjects(servers, projectId)];
}

export function planSync(scope: SyncScope, projectId: string | null): readonly Change[] {
  return plansFor(scope, projectId).flatMap((plan) => plan.changes);
}

export function applySync(scope: SyncScope, projectId: string | null): SyncResult {
  const plans = plansFor(scope, projectId);
  const ownership = loadOwnership();
  const changes: Change[] = [];
  const failed: { path: string; error: string }[] = [];

  for (const plan of plans) {
    changes.push(...plan.changes);
    try {
      if (plan.changes.length > 0) {
        const existingDoc = readJsonDoc(plan.path).doc;
        const owned = ownedFor(ownership, plan.harness.id, plan.scope, plan.projectId);
        const next = plan.harness.format.write(existingDoc, plan.source, owned);
        writeJsonDoc(plan.path, next);
      }
      recordOwned(ownership, plan.harness.id, plan.scope, plan.projectId, Object.keys(plan.source));
    } catch (error) {
      failed.push({ path: plan.path, error: error instanceof Error ? error.message : String(error) });
    }
  }

  // skills ride along on every sync
  const skillResult = syncSkills();
  for (const failure of skillResult.failed) {
    failed.push(failure);
  }

  if (failed.length === 0) {
    saveOwnership(ownership);
  }
  return { applied: true, changes, failed };
}
