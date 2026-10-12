import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { McpServer, ProbeCell } from "../shared/api";
import { t } from "./locale";
import { readJsonDoc, writeJsonDoc } from "./mcp-config";
import { mcpFileCells, skillFileCells } from "./skill-probe";
import { cellsFromBullets, cellsFromHeaders, cellsFromLines, runCli, type ProbeNames } from "./probe";

export type ServerMap = Record<string, McpServer>;

export interface ConfigFormat {
  read(doc: unknown): ServerMap;
  write(doc: unknown, desired: ServerMap, owned: ReadonlySet<string>): unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringMap(value: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") {
      out[key] = entry;
    }
  }
  return out;
}

function normalizeServer(value: unknown): McpServer | null {
  if (!isRecord(value)) {
    return null;
  }
  const server: McpServer = {};
  if (typeof value.type === "string") {
    server.type = value.type;
  }
  if (typeof value.command === "string") {
    server.command = value.command;
  }
  if (Array.isArray(value.args) && value.args.every((arg) => typeof arg === "string")) {
    server.args = value.args as string[];
  }
  if (isRecord(value.env)) {
    server.env = stringMap(value.env);
  }
  if (typeof value.url === "string") {
    server.url = value.url;
  }
  if (isRecord(value.headers)) {
    server.headers = stringMap(value.headers);
  }
  if (typeof value.enabled === "boolean") {
    server.enabled = value.enabled;
  } else if (value.disabled === true) {
    server.enabled = false;
  }
  return server;
}

function cloneDoc(doc: unknown): Record<string, unknown> {
  return isRecord(doc) ? (structuredClone(doc) as Record<string, unknown>) : {};
}

function mergeKey(
  doc: Record<string, unknown>,
  key: string,
  desired: ServerMap,
  owned: ReadonlySet<string>,
): void {
  const existing = isRecord(doc[key]) ? (doc[key] as Record<string, unknown>) : {};
  const next: Record<string, unknown> = { ...existing };
  for (const name of Object.keys(next)) {
    if (owned.has(name) && !(name in desired)) {
      delete next[name];
    }
  }
  for (const [name, server] of Object.entries(desired)) {
    next[name] = server;
  }
  doc[key] = next;
}

export const plainFormat: ConfigFormat = {
  read(doc) {
    const out: ServerMap = {};
    if (!isRecord(doc) || !isRecord(doc.mcpServers)) {
      return out;
    }
    for (const [name, value] of Object.entries(doc.mcpServers)) {
      const server = normalizeServer(value);
      if (server) {
        out[name] = server;
      }
    }
    return out;
  },
  write(doc, desired, owned) {
    const base = cloneDoc(doc);
    mergeKey(base, "mcpServers", desired, owned);
    return base;
  },
};

/** Plain `mcpServers` file whose schema insists on an explicit transport for URL servers. */
function typedRemoteFormat(remoteType: string): ConfigFormat {
  return {
    read: plainFormat.read,
    write(doc, desired, owned) {
      const typed: ServerMap = {};
      for (const [name, server] of Object.entries(desired)) {
        typed[name] = server.type ? server : { ...server, type: server.command ? "stdio" : remoteType };
      }
      return plainFormat.write(doc, typed, owned);
    },
  };
}

/** Kimi Code: no `type` key; HTTP is implied by `url`, legacy SSE is `transport: "sse"`. */
const kimiFormat: ConfigFormat = {
  read(doc) {
    const out = plainFormat.read(doc);
    const raw = isRecord(doc) && isRecord(doc.mcpServers) ? doc.mcpServers : {};
    for (const [name, value] of Object.entries(raw)) {
      if (isRecord(value) && value.transport === "sse" && out[name]) {
        out[name] = { ...out[name], type: "sse" };
      }
    }
    return out;
  },
  write(doc, desired, owned) {
    const mapped: Record<string, Record<string, unknown>> = {};
    for (const [name, server] of Object.entries(desired)) {
      const { type, ...rest } = server;
      mapped[name] = type === "sse" ? { ...rest, transport: "sse" } : rest;
    }
    return plainFormat.write(doc, mapped as ServerMap, owned);
  },
};

export const opencodeFormat: ConfigFormat = {
  read(doc) {
    const out: ServerMap = {};
    if (!isRecord(doc) || !isRecord(doc.mcp)) {
      return out;
    }
    for (const [name, value] of Object.entries(doc.mcp)) {
      if (!isRecord(value)) {
        continue;
      }
      const server: McpServer = {};
      if (value.type === "remote" && typeof value.url === "string") {
        server.url = value.url;
        if (isRecord(value.headers)) {
          server.headers = stringMap(value.headers);
        }
      } else if (Array.isArray(value.command) && typeof value.command[0] === "string") {
        server.command = value.command[0];
        const args = value.command.slice(1).filter((arg): arg is string => typeof arg === "string");
        if (args.length > 0) {
          server.args = args;
        }
      } else {
        continue;
      }
      if (isRecord(value.environment)) {
        server.env = stringMap(value.environment);
      }
      if (typeof value.enabled === "boolean") {
        server.enabled = value.enabled;
      }
      out[name] = server;
    }
    return out;
  },
  write(doc, desired, owned) {
    const base = cloneDoc(doc);
    const existing = isRecord(base.mcp) ? (base.mcp as Record<string, unknown>) : {};
    const next: Record<string, unknown> = { ...existing };
    for (const name of Object.keys(next)) {
      if (owned.has(name) && !(name in desired)) {
        delete next[name];
      }
    }
    for (const [name, server] of Object.entries(desired)) {
      const enabled = server.enabled !== false;
      if (server.url) {
        next[name] = {
          type: "remote",
          url: server.url,
          ...(server.headers ? { headers: server.headers } : {}),
          enabled,
        };
      } else if (server.command) {
        next[name] = {
          type: "local",
          command: [server.command, ...(server.args ?? [])],
          ...(server.env ? { environment: server.env } : {}),
          enabled,
        };
      }
    }
    base.mcp = next;
    return base;
  },
};

export interface McpSupport {
  readonly format: ConfigFormat;
  readonly userPath: string;
  readonly projectPath: ((dir: string) => string) | null;
  /** false when this harness's Paseo sessions ignore project MCP files; mounted servers are then injected at agent.create */
  readonly projectLoaded: boolean;
  /** runs after a project entry is written or changed, for harnesses that gate project servers behind approval */
  readonly approveProject: ((rootPath: string, name: string) => Promise<void>) | null;
}

export interface SkillSupport {
  /** where agent-kit links global skills */
  readonly userLink: string;
  /** every user-level root the harness reads on its own; imported from, and vacated when a skill stops being global */
  readonly userScan: readonly string[];
  readonly projectLink: ((dir: string) => string) | null;
  readonly projectScan: (dir: string) => readonly string[];
  /** false when this harness's Paseo sessions ignore project skill directories */
  readonly projectLoaded: boolean;
}

/**
 * One entry per supported harness. A new harness declares all of: MCP user/project
 * files, skill user/project roots, the provider ids Paseo launches it under, and
 * optionally a live load check. Import, sync, mounting, and injection all read this.
 */
export interface HarnessDef {
  readonly id: string;
  readonly label: string;
  /** matches the Paseo provider ids of this harness */
  readonly providerPattern: RegExp | null;
  readonly mcp: McpSupport;
  readonly skills: SkillSupport | null;
  /** load check run in a project directory; only harnesses with one get a dashboard column */
  readonly probe: ((rootPath: string, names: ProbeNames) => Promise<ProbeCell[]>) | null;
  /** harnesses we only know from docs are left alone until their data directory exists; absent means always present */
  readonly installed?: () => boolean;
}

async function cursorApprove(rootPath: string, name: string): Promise<void> {
  const run = await runCli("agent", ["mcp", "enable", name], rootPath);
  if (run.code !== 0) {
    throw new Error(
      t("approveFailed", { harness: "Cursor", name, detail: run.out.trim().slice(-180) || t("exitCode", { code: String(run.code) }) }),
    );
  }
}

/**
 * Claude Code asks before using servers from a project .mcp.json. Approving one
 * means listing it in `enabledMcpjsonServers` of the project's settings.local.json.
 */
async function claudeApprove(rootPath: string, name: string): Promise<void> {
  const path = join(rootPath, ".claude", "settings.local.json");
  const { doc } = readJsonDoc(path);
  const base = isRecord(doc) ? { ...doc } : {};
  const current = Array.isArray(base.enabledMcpjsonServers) ? base.enabledMcpjsonServers.filter((entry): entry is string => typeof entry === "string") : [];
  if (current.includes(name)) {
    return;
  }
  base.enabledMcpjsonServers = [...current, name];
  writeJsonDoc(path, base);
}

export function harnesses(): readonly HarnessDef[] {
  const home = homedir();
  const cursorSkills: SkillSupport = {
      userLink: join(home, ".cursor", "skills"),
      userScan: [join(home, ".cursor", "skills"), join(home, ".agents", "skills"), join(home, ".claude", "skills")],
      projectLink: (dir) => join(dir, ".cursor", "skills"),
      projectScan: (dir) => [join(dir, ".cursor", "skills")],
      projectLoaded: false,
    };
  const kiroSkills: SkillSupport = {
      userLink: join(home, ".kiro", "skills"),
      userScan: [join(home, ".kiro", "skills")],
      projectLink: (dir) => join(dir, ".kiro", "skills"),
      projectScan: (dir) => [join(dir, ".kiro", "skills")],
      projectLoaded: true,
    };
  const claudeSkills: SkillSupport = {
    userLink: join(home, ".claude", "skills"),
    userScan: [join(home, ".claude", "skills")],
    projectLink: (dir) => join(dir, ".claude", "skills"),
    projectScan: (dir) => [join(dir, ".claude", "skills")],
    projectLoaded: true,
  };
  const opencodeSkills: SkillSupport = {
    userLink: join(home, ".config", "opencode", "skills"),
    userScan: [join(home, ".config", "opencode", "skills"), join(home, ".claude", "skills"), join(home, ".agents", "skills")],
    projectLink: (dir) => join(dir, ".opencode", "skills"),
    projectScan: (dir) => [join(dir, ".opencode", "skills"), join(dir, ".claude", "skills"), join(dir, ".agents", "skills")],
    projectLoaded: true,
  };
  // omp reads ~/.claude and ~/.agents at user level only when the provider is opted in, so only its own root counts there
  const ompSkills: SkillSupport = {
    userLink: join(home, ".omp", "agent", "skills"),
    userScan: [join(home, ".omp", "agent", "skills")],
    projectLink: (dir) => join(dir, ".omp", "skills"),
    projectScan: (dir) => [join(dir, ".omp", "skills"), join(dir, ".agents", "skills"), join(dir, ".claude", "skills")],
    projectLoaded: true,
  };
  const kimiHome = process.env.KIMI_CODE_HOME || join(home, ".kimi-code");
  const kimiSkills: SkillSupport = {
    userLink: join(kimiHome, "skills"),
    userScan: [join(kimiHome, "skills"), join(home, ".agents", "skills")],
    projectLink: (dir) => join(dir, ".kimi-code", "skills"),
    projectScan: (dir) => [join(dir, ".kimi-code", "skills"), join(dir, ".agents", "skills")],
    projectLoaded: true,
  };
  const minimaxHome = process.env.MINIMAX_DATA_DIR || join(home, ".minimax");
  const claudeMcp: McpSupport = {
    format: typedRemoteFormat("http"),
    userPath: join(home, ".claude.json"),
    projectPath: (dir) => join(dir, ".mcp.json"),
    projectLoaded: true,
    approveProject: claudeApprove,
  };
  const opencodeMcp: McpSupport = {
    format: opencodeFormat,
    userPath: join(home, ".config", "opencode", "opencode.json"),
    projectPath: (dir) => join(dir, "opencode.json"),
    projectLoaded: true,
    approveProject: null,
  };
  const ompMcp: McpSupport = {
    format: plainFormat,
    userPath: join(home, ".omp", "agent", "mcp.json"),
    projectPath: (dir) => join(dir, ".omp", "mcp.json"),
    projectLoaded: true,
    approveProject: null,
  };
  const kimiMcp: McpSupport = {
    format: kimiFormat,
    userPath: join(kimiHome, "mcp.json"),
    projectPath: (dir) => join(dir, ".kimi-code", "mcp.json"),
    projectLoaded: true,
    approveProject: null,
  };
  const minimaxMcp: McpSupport = {
    format: typedRemoteFormat("streamable-http"),
    userPath: join(minimaxHome, "mcp.json"),
    projectPath: null,
    projectLoaded: true,
    approveProject: null,
  };
  const all: HarnessDef[] = [
    {
      id: "cursor",
      label: "Cursor",
      providerPattern: /^cursor/,
      mcp: {
        format: plainFormat,
        userPath: join(home, ".cursor", "mcp.json"),
        // the CLI and IDE read it (after approval); ACP sessions in Paseo do not
        projectPath: (dir) => join(dir, ".cursor", "mcp.json"),
        projectLoaded: false,
        approveProject: cursorApprove,
      },
      skills: cursorSkills,
      async probe(rootPath, names) {
        const run = await runCli("agent", ["mcp", "list"], rootPath);
        return [
          ...cellsFromLines("mcp", "cursor", "Cursor", names.mcp, run),
          ...skillFileCells("cursor", "Cursor", cursorSkills, rootPath, names.skills),
        ];
      },
    },
    {
      id: "kiro",
      label: "Kiro",
      providerPattern: /^kiro/,
      mcp: {
        format: plainFormat,
        userPath: join(home, ".kiro", "settings", "mcp.json"),
        projectPath: (dir) => join(dir, ".kiro", "settings", "mcp.json"),
        projectLoaded: true,
        approveProject: null,
      },
      skills: kiroSkills,
      async probe(rootPath, names) {
        const run = await runCli("kiro-cli", ["mcp", "list", "default"], rootPath);
        return [
          ...cellsFromBullets("mcp", "kiro", names.mcp, run),
          ...skillFileCells("kiro", "Kiro", kiroSkills, rootPath, names.skills),
        ];
      },
    },
    {
      id: "qoder",
      label: "Qoder",
      providerPattern: /^qoder/,
      mcp: {
        format: plainFormat,
        userPath: join(home, ".qoder", "settings.json"),
        projectPath: (dir) => join(dir, ".mcp.json"),
        projectLoaded: true,
        approveProject: null,
      },
      skills: {
        userLink: join(home, ".agents", "skills"),
        userScan: [join(home, ".agents", "skills"), join(home, ".qoder", "skills")],
        projectLink: (dir) => join(dir, ".qoder", "skills"),
        projectScan: (dir) => [join(dir, ".qoder", "skills"), join(dir, ".agents", "skills")],
        projectLoaded: true,
      },
      async probe(rootPath, names) {
        const [mcp, skills] = await Promise.all([
          runCli("qodercli", ["mcp", "list"], rootPath),
          runCli("qodercli", ["skills", "list"], rootPath),
        ]);
        return [
          ...cellsFromLines("mcp", "qoder", "Qoder", names.mcp, mcp),
          ...cellsFromHeaders("skill", "qoder", "Qoder", names.skills, skills),
        ];
      },
    },
    {
      id: "opencode",
      label: "OpenCode",
      providerPattern: /^opencode/,
      mcp: opencodeMcp,
      skills: opencodeSkills,
      async probe(rootPath, names) {
        const run = await runCli("opencode", ["mcp", "list"], rootPath);
        return [
          ...cellsFromLines("mcp", "opencode", "OpenCode", names.mcp, run),
          ...skillFileCells("opencode", "OpenCode", opencodeSkills, rootPath, names.skills),
        ];
      },
    },
    {
      id: "omp",
      label: "Oh My Pi",
      providerPattern: /^omp/,
      mcp: ompMcp,
      skills: ompSkills,
      async probe(rootPath, names) {
        return [
          ...mcpFileCells("omp", "Oh My Pi", ompMcp, rootPath, names.mcp),
          ...skillFileCells("omp", "Oh My Pi", ompSkills, rootPath, names.skills),
        ];
      },
    },
    {
      id: "claude",
      label: "Claude Code",
      providerPattern: /^claude/,
      mcp: claudeMcp,
      skills: claudeSkills,
      installed: () => existsSync(join(home, ".claude")) || existsSync(join(home, ".claude.json")),
      async probe(rootPath, names) {
        const run = await runCli("claude", ["mcp", "list"], rootPath);
        return [
          ...cellsFromLines("mcp", "claude", "Claude Code", names.mcp, run),
          ...skillFileCells("claude", "Claude Code", claudeSkills, rootPath, names.skills),
        ];
      },
    },
    {
      id: "kimi",
      label: "Kimi Code",
      providerPattern: /^kimi/,
      mcp: kimiMcp,
      skills: kimiSkills,
      installed: () => existsSync(kimiHome),
      async probe(rootPath, names) {
        return [
          ...mcpFileCells("kimi", "Kimi Code", kimiMcp, rootPath, names.mcp),
          ...skillFileCells("kimi", "Kimi Code", kimiSkills, rootPath, names.skills),
        ];
      },
    },
    {
      id: "minimax",
      label: "MiniMax Code",
      providerPattern: null,
      mcp: minimaxMcp,
      // MiniMax Code's skill directories are not documented, so skills are not managed there yet
      skills: null,
      installed: () => existsSync(minimaxHome),
      async probe(rootPath, names) {
        return mcpFileCells("minimax", "MiniMax Code", minimaxMcp, rootPath, names.mcp);
      },
    },
  ];
  return all.filter((harness) => harness.installed?.() ?? true);
}

export function findHarness(id: string): HarnessDef {
  const harness = harnesses().find((entry) => entry.id === id);
  if (!harness) {
    throw new Error(t("unknownHarness", { id }));
  }
  return harness;
}

/** Every user-level skill root some harness reads on its own. */
export function autoScannedUserSkillRoots(): string[] {
  return [...new Set(harnesses().flatMap((harness) => harness.skills?.userScan ?? []))];
}

/** Every project-level skill root some harness reads on its own. */
export function projectSkillRoots(dir: string): string[] {
  return [...new Set(harnesses().flatMap((harness) => harness.skills?.projectScan(dir) ?? []))];
}

