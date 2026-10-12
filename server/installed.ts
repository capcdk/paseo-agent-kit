import { accessSync, constants, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

/**
 * The Paseo daemon often starts with a trimmed PATH (e.g. launched from the app),
 * so besides PATH we also look where these CLIs install themselves.
 */
function searchDirs(): string[] {
  const home = homedir();
  const kimiHome = process.env.KIMI_CODE_HOME || join(home, ".kimi-code");
  const minimaxHome = process.env.MINIMAX_DATA_DIR || join(home, ".minimax");
  return [
    ...(process.env.PATH ?? "").split(delimiter).filter(Boolean),
    join(home, ".local", "bin"),
    join(home, ".bun", "bin"),
    join(home, ".opencode", "bin"),
    join(kimiHome, "bin"),
    join(minimaxHome, "bin"),
    join(home, ".cargo", "bin"),
    join(home, ".npm-global", "bin"),
    join(home, ".volta", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

const CACHE_MS = 15_000;
const cache = new Map<string, { at: number; path: string | null }>();

/** Absolute path of `command` on PATH or in a usual install directory, or null. Cached briefly: sync paths call this a lot. */
export function findCommand(command: string): string | null {
  const hit = cache.get(command);
  const now = Date.now();
  if (hit && now - hit.at < CACHE_MS) {
    return hit.path;
  }
  const dir = searchDirs().find((entry) => isExecutable(join(entry, command)));
  const path = dir ? join(dir, command) : null;
  cache.set(command, { at: now, path });
  return path;
}

export function hasCommand(command: string): boolean {
  return findCommand(command) !== null;
}
