import { homedir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "../shared/api";

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

export interface HarnessDef {
  readonly id: string;
  readonly label: string;
  readonly format: ConfigFormat;
  readonly userPath: string;
  readonly projectPath: ((dir: string) => string) | null;
  readonly isSource: boolean;
}

export const SOURCE_ID = "cursor";

export function harnesses(): readonly HarnessDef[] {
  const home = homedir();
  return [
    {
      id: "cursor",
      label: "Cursor",
      format: plainFormat,
      userPath: join(home, ".cursor", "mcp.json"),
      projectPath: (dir) => join(dir, ".cursor", "mcp.json"),
      isSource: true,
    },
    {
      id: "kiro",
      label: "Kiro",
      format: plainFormat,
      userPath: join(home, ".kiro", "settings", "mcp.json"),
      projectPath: (dir) => join(dir, ".kiro", "settings", "mcp.json"),
      isSource: false,
    },
    {
      id: "qoder",
      label: "Qoder",
      format: plainFormat,
      userPath: join(home, ".qoder", "settings.json"),
      projectPath: (dir) => join(dir, ".mcp.json"),
      isSource: false,
    },
    {
      id: "opencode",
      label: "OpenCode",
      format: opencodeFormat,
      userPath: join(home, ".config", "opencode", "opencode.json"),
      projectPath: null,
      isSource: false,
    },
    {
      id: "omp",
      label: "Oh My Pi",
      format: plainFormat,
      userPath: join(home, ".omp", "agent", "mcp.json"),
      projectPath: null,
      isSource: false,
    },
  ];
}

export function findHarness(id: string): HarnessDef | undefined {
  return harnesses().find((harness) => harness.id === id);
}
