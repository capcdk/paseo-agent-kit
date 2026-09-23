import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { McpServer } from "../shared/api";
import type { ServerMap } from "./harness";

export function readJsonDoc(path: string): { exists: boolean; doc: unknown } {
  if (!existsSync(path)) {
    return { exists: false, doc: null };
  }
  try {
    return { exists: true, doc: JSON.parse(readFileSync(path, "utf8")) as unknown };
  } catch {
    return { exists: true, doc: null };
  }
}

export function writeJsonDoc(path: string, doc: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) {
    copyFileSync(path, `${path}.agent-kit.bak`);
  }
  const temp = `${path}.agent-kit.tmp`;
  writeFileSync(temp, `${JSON.stringify(doc, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temp, path);
}

function sortedMap(map: Readonly<Record<string, string>> | undefined): readonly (readonly [string, string])[] | null {
  if (!map) {
    return null;
  }
  return Object.keys(map)
    .sort()
    .map((key) => [key, map[key]] as const);
}

function canonical(server: McpServer): string {
  return JSON.stringify({
    command: server.command ?? null,
    args: server.args ?? null,
    env: sortedMap(server.env),
    url: server.url ?? null,
    headers: sortedMap(server.headers),
    enabled: server.enabled !== false,
  });
}

export function serversEqual(a: McpServer, b: McpServer): boolean {
  return canonical(a) === canonical(b);
}

export interface ServerDiff {
  readonly missing: readonly string[];
  readonly extra: readonly string[];
  readonly drifted: readonly string[];
}

export function diffServers(source: ServerMap, target: ServerMap): ServerDiff {
  const missing: string[] = [];
  const drifted: string[] = [];
  for (const [name, server] of Object.entries(source)) {
    const existing = target[name];
    if (!existing) {
      missing.push(name);
    } else if (!serversEqual(server, existing)) {
      drifted.push(name);
    }
  }
  const extra = Object.keys(target).filter((name) => !(name in source));
  return { missing, extra, drifted };
}

const LOCK_PATH = join(homedir(), ".paseo", "agent-kit.lock.json");

interface Ownership {
  version: 1;
  owned: Record<string, string[]>;
}

function targetKey(harness: string, scope: "user" | "project", projectId: string | null): string {
  return `${harness}:${scope}:${projectId ?? "-"}`;
}

export function loadOwnership(): Ownership {
  const { doc } = readJsonDoc(LOCK_PATH);
  if (doc && typeof doc === "object" && !Array.isArray(doc)) {
    const record = doc as { version?: unknown; owned?: unknown };
    if (record.version === 1 && record.owned && typeof record.owned === "object") {
      const owned: Record<string, string[]> = {};
      for (const [key, value] of Object.entries(record.owned as Record<string, unknown>)) {
        if (Array.isArray(value)) {
          owned[key] = value.filter((entry): entry is string => typeof entry === "string");
        }
      }
      return { version: 1, owned };
    }
  }
  return { version: 1, owned: {} };
}

export function ownedFor(ownership: Ownership, harness: string, scope: "user" | "project", projectId: string | null): Set<string> {
  return new Set(ownership.owned[targetKey(harness, scope, projectId)] ?? []);
}

export function recordOwned(
  ownership: Ownership,
  harness: string,
  scope: "user" | "project",
  projectId: string | null,
  names: readonly string[],
): void {
  ownership.owned[targetKey(harness, scope, projectId)] = [...names];
}

export function saveOwnership(ownership: Ownership): void {
  writeJsonDoc(LOCK_PATH, ownership);
}
