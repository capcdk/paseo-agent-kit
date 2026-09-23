import { z } from "zod";
import { defineSettings } from "@getpaseo/plugin";

/**
 * Single source of truth for Agent Kit.
 *
 * agent-kit OWNS these entities; harness files are only sync targets. The
 * `import` RPC seeds the store from every registered harness's user- and
 * project-level config; after that, all harness files are downstream.
 */

export const McpServerDefSchema = z.object({
  name: z.string().min(1),
  /** stdio command (with args/env) or http/sse url (with headers) */
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  /** transport hint: stdio when command set, http when url set */
  transport: z.enum(["stdio", "http", "sse"]).default("stdio"),
  enabled: z.boolean().default(true),
  /** written to harness user-level files, i.e. loaded by every session regardless of project */
  userLevel: z.boolean().default(true),
  /** project ids (paseo workspace project) whose project-level files receive this server */
  projectIds: z.array(z.string()).default([]),
  /** session-level injection into agent.create (paseo-only) */
  sessionInject: z.boolean().default(false),
});

export const SkillDefSchema = z.object({
  name: z.string().min(1),
  /** absolute path to the skill directory containing SKILL.md */
  sourcePath: z.string(),
  enabled: z.boolean().default(true),
  /** linked into harness user-level skill roots, i.e. available in every session */
  userLevel: z.boolean().default(true),
  /** project ids whose project-level skill roots receive this skill */
  projectIds: z.array(z.string()).default([]),
});

export const KitStoreSchema = z.object({
  version: z.number().default(1),
  importedAt: z.number().nullable().default(null),
  locale: z.enum(["auto", "en", "zh"]).default("auto"),
  servers: z.array(McpServerDefSchema).default([]),
  skills: z.array(SkillDefSchema).default([]),
});

export type McpServerDef = z.infer<typeof McpServerDefSchema>;
export type SkillDef = z.infer<typeof SkillDefSchema>;
export type KitStore = z.infer<typeof KitStoreSchema>;

export const kitSettings = defineSettings({
  id: "kit-store",
  scope: "host",
  version: 1,
  schema: KitStoreSchema,
});

export const DEFAULT_KIT_STORE: KitStore = KitStoreSchema.parse({});
