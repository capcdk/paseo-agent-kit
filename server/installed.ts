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
const cache = new Map<string, { at: number; found: boolean }>();

/** Whether `command` can be found on PATH or in a usual install directory. Cached briefly: sync paths call this a lot. */
export function hasCommand(command: string): boolean {
  const hit = cache.get(command);
  const now = Date.now();
  if (hit && now - hit.at < CACHE_MS) {
    return hit.found;
  }
  const found = searchDirs().some((dir) => isExecutable(join(dir, command)));
  cache.set(command, { at: now, found });
  return found;
}
