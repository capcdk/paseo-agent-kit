import { z } from "zod";
import { defineRpc } from "@getpaseo/plugin";
import { McpServerDefSchema, SkillDefSchema } from "./store";

export { McpServerDefSchema, SkillDefSchema, KitStoreSchema } from "./store";
export type { McpServerDef, SkillDef, KitStore } from "./store";

export const McpServerSchema = z.object({
  type: z.string().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
});

export type McpServer = z.infer<typeof McpServerSchema>;

export const NamedServerSchema = z.object({
  name: z.string(),
  server: McpServerSchema,
});

export const TargetStatusSchema = z.object({
  harness: z.string(),
  label: z.string(),
  path: z.string(),
  exists: z.boolean(),
  isSource: z.boolean(),
  servers: z.array(NamedServerSchema),
  missing: z.array(z.string()),
  extra: z.array(z.string()),
  drifted: z.array(z.string()),
  status: z.enum(["source", "in-sync", "out-of-sync", "unavailable"]),
});

export const ScopeSnapshotSchema = z.object({
  scope: z.enum(["user", "project"]),
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  dir: z.string().nullable(),
  sourcePath: z.string(),
  sourceExists: z.boolean(),
  sourceServers: z.array(NamedServerSchema),
  targets: z.array(TargetStatusSchema),
});

export const SnapshotSchema = z.object({
  fetchedAt: z.number(),
  user: ScopeSnapshotSchema,
  projects: z.array(ScopeSnapshotSchema),
});

export const ChangeSchema = z.object({
  harness: z.string(),
  scope: z.enum(["user", "project"]),
  projectId: z.string().nullable(),
  path: z.string(),
  op: z.enum(["add", "update", "remove", "skip-no-source"]),
  server: z.string(),
});

export const SyncResultSchema = z.object({
  applied: z.boolean(),
  changes: z.array(ChangeSchema),
  failed: z.array(z.object({ path: z.string(), error: z.string() })),
});

export type TargetStatus = z.infer<typeof TargetStatusSchema>;
export type ScopeSnapshot = z.infer<typeof ScopeSnapshotSchema>;
export type Snapshot = z.infer<typeof SnapshotSchema>;
export type Change = z.infer<typeof ChangeSchema>;
export type SyncResult = z.infer<typeof SyncResultSchema>;

export const statusRpc = defineRpc({
  name: "agent-kit.status",
  input: z.object({}),
  output: SnapshotSchema,
});

export const syncRpc = defineRpc({
  name: "agent-kit.sync",
  input: z.object({
    scope: z.enum(["user", "project", "all"]),
    projectId: z.string().nullable().optional(),
    apply: z.boolean(),
  }),
  output: SyncResultSchema,
});

// ─── Kit (store-driven) API ────────────────────────────────────────────────

export const CatalogItemSchema = z.object({
  name: z.string(),
  summary: z.string(),
  userLevel: z.boolean(),
  /** why the global toggle cannot be turned off; null = free to change */
  globalLock: z.string().nullable(),
});

export const HarnessColumnSchema = z.object({
  id: z.string(),
  label: z.string(),
});

export const ProjectBoardSchema = z.object({
  projectId: z.string(),
  name: z.string(),
  rootPath: z.string(),
  mountedMcp: z.array(z.string()),
  mountedSkills: z.array(z.string()),
});

export const KitStatusSchema = z.object({
  fetchedAt: z.number(),
  importedAt: z.number().nullable(),
  harnesses: z.array(HarnessColumnSchema),
  mcp: z.array(CatalogItemSchema),
  skills: z.array(CatalogItemSchema),
  projects: z.array(ProjectBoardSchema),
});

export type CatalogItem = z.infer<typeof CatalogItemSchema>;
export type HarnessColumn = z.infer<typeof HarnessColumnSchema>;
export type ProjectBoard = z.infer<typeof ProjectBoardSchema>;
export type KitStatus = z.infer<typeof KitStatusSchema>;

export const LoadStateSchema = z.enum(["loaded", "approval", "auth", "failed", "unknown"]);

export const ProbeCellSchema = z.object({
  kind: z.enum(["mcp", "skill"]),
  name: z.string(),
  harness: z.string(),
  state: LoadStateSchema,
  detail: z.string(),
});

export type LoadState = z.infer<typeof LoadStateSchema>;
export type ProbeCell = z.infer<typeof ProbeCellSchema>;

export const kitStatusRpc = defineRpc({
  name: "agent-kit.kit-status",
  input: z.object({}),
  output: KitStatusSchema,
});

export const importRpc = defineRpc({
  name: "agent-kit.import",
  input: z.object({}),
  output: z.object({
    servers: z.number(),
    skills: z.number(),
    importedAt: z.number(),
  }),
});

export const serverUpsertRpc = defineRpc({
  name: "agent-kit.server-upsert",
  input: z.object({
    previousName: z.string().nullable(),
    server: McpServerDefSchema,
  }),
  output: z.object({ ok: z.literal(true) }),
});

export const serverDeleteRpc = defineRpc({
  name: "agent-kit.server-delete",
  input: z.object({ name: z.string() }),
  output: z.object({ ok: z.literal(true) }),
});

export const skillUpsertRpc = defineRpc({
  name: "agent-kit.skill-upsert",
  input: z.object({
    previousName: z.string().nullable(),
    skill: SkillDefSchema,
  }),
  output: z.object({ ok: z.literal(true) }),
});

export const skillDeleteRpc = defineRpc({
  name: "agent-kit.skill-delete",
  input: z.object({ name: z.string() }),
  output: z.object({ ok: z.literal(true) }),
});

export const skillSyncRpc = defineRpc({
  name: "agent-kit.skill-sync",
  input: z.object({}),
  output: z.object({
    placed: z.array(z.string()),
    removed: z.array(z.string()),
    failed: z.array(z.object({ path: z.string(), error: z.string() })),
  }),
});

export const probeRpc = defineRpc({
  name: "agent-kit.probe",
  input: z.object({ projectId: z.string() }),
  output: z.object({
    projectId: z.string(),
    cells: z.array(ProbeCellSchema),
  }),
});

export const mountRpc = defineRpc({
  name: "agent-kit.mount",
  input: z.object({
    kind: z.enum(["mcp", "skill"]),
    name: z.string(),
    projectId: z.string(),
    mount: z.boolean(),
  }),
  output: z.object({ ok: z.literal(true) }),
});

export const trustRpc = defineRpc({
  name: "agent-kit.trust",
  input: z.object({
    name: z.string(),
    projectId: z.string(),
  }),
  output: z.object({ ok: z.literal(true) }),
});

export const userLevelRpc = defineRpc({
  name: "agent-kit.user-level",
  input: z.object({
    kind: z.enum(["mcp", "skill"]),
    name: z.string(),
    userLevel: z.boolean(),
  }),
  output: z.object({ ok: z.literal(true) }),
});
