import { homedir } from "node:os";
import { join } from "node:path";
import type { McpServer, ProbeCell } from "../shared/api";
import { t } from "./locale";
import { cellsFromBullets, cellsFromHeaders, cellsFromLines, runCli, staticCells, type ProbeNames } from "./probe";

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
}

async function cursorApprove(rootPath: string, name: string): Promise<void> {
  const run = await runCli("agent", ["mcp", "enable", name], rootPath);
  if (run.code !== 0) {
    throw new Error(
      t("approveFailed", { harness: "Cursor", name, detail: run.out.trim().slice(-180) || t("exitCode", { code: String(run.code) }) }),
    );
  }
}

export function harnesses(): readonly HarnessDef[] {
  const home = homedir();
  return [
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
      skills: {
        userLink: join(home, ".cursor", "skills"),
        userScan: [join(home, ".cursor", "skills"), join(home, ".agents", "skills"), join(home, ".claude", "skills")],
        projectLink: (dir) => join(dir, ".cursor", "skills"),
        projectScan: (dir) => [join(dir, ".cursor", "skills")],
        projectLoaded: false,
      },
      async probe(rootPath, names) {
        const run = await runCli("agent", ["mcp", "list"], rootPath);
        return [
          ...cellsFromLines("mcp", "cursor", "Cursor", names.mcp, run),
          ...staticCells("skill", "cursor", names.skills, t("skillNotReported", { harness: "Cursor" }), "unknown"),
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
      skills: {
        userLink: join(home, ".kiro", "skills"),
        userScan: [join(home, ".kiro", "skills")],
        projectLink: (dir) => join(dir, ".kiro", "skills"),
        projectScan: (dir) => [join(dir, ".kiro", "skills")],
        projectLoaded: true,
      },
      async probe(rootPath, names) {
        const run = await runCli("kiro-cli", ["mcp", "list", "default"], rootPath);
        return [
          ...cellsFromBullets("mcp", "kiro", names.mcp, run),
          ...staticCells("skill", "kiro", names.skills, t("skillNotReported", { harness: "Kiro" }), "unknown"),
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
      providerPattern: null,
      mcp: {
        format: opencodeFormat,
        userPath: join(home, ".config", "opencode", "opencode.json"),
        projectPath: null,
        projectLoaded: true,
        approveProject: null,
      },
      skills: null,
      probe: null,
    },
    {
      id: "omp",
      label: "Oh My Pi",
      providerPattern: null,
      mcp: {
        format: plainFormat,
        userPath: join(home, ".omp", "agent", "mcp.json"),
        projectPath: null,
        projectLoaded: true,
        approveProject: null,
      },
      skills: null,
      probe: null,
    },
  ];
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

