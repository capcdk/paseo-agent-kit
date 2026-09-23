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

export type Change = z.infer<typeof ChangeSchema>;
export type SyncResult = z.infer<typeof SyncResultSchema>;

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
  /** Paseo sessions of this harness read project-level skill directories */
  projectSkills: z.boolean(),
  /** project MCP servers need an approval step in this harness */
  canApprove: z.boolean(),
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
  locale: z.enum(["auto", "en", "zh"]),
  /** labels of every harness the import reads from */
  importSources: z.array(z.string()),
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
  input: z.object({ deviceLocale: z.enum(["en", "zh"]) }),
  output: KitStatusSchema,
});

export const importRpc = defineRpc({
  name: "agent-kit.import",
  input: z.object({}),
  output: z.object({
    servers: z.number(),
    skills: z.number(),
    conflicts: z.array(z.string()),
    failed: z.array(z.object({ path: z.string(), error: z.string() })),
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
    harness: z.string(),
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

export const localeRpc = defineRpc({
  name: "agent-kit.locale",
  input: z.object({ locale: z.enum(["auto", "en", "zh"]) }),
  output: z.object({ ok: z.literal(true) }),
});
