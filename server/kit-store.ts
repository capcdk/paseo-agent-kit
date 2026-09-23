import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_KIT_STORE, KitStoreSchema, type KitStore } from "../shared/store";

/**
 * Direct disk access to the plugin settings document that the daemon manages
 * (same envelope format as PluginSettingsStore: {version, values}).
 * The client edits the store via useSettings(); the server reads it here.
 * Server writes are only used by the one-time import.
 */

const STORE_PATH = join(homedir(), ".paseo", "plugin-settings", "agent-kit", "kit-store.json");

function parseEnvelope(raw: string | null): KitStore {
  if (raw === null) {
    return DEFAULT_KIT_STORE;
  }
  try {
    const envelope = JSON.parse(raw) as { version?: number; values?: unknown };
    const parsed = KitStoreSchema.safeParse(envelope.values ?? {});
    return parsed.success ? parsed.data : DEFAULT_KIT_STORE;
  } catch {
    return DEFAULT_KIT_STORE;
  }
}

export function loadKitStore(): KitStore {
  return parseEnvelope(existsSync(STORE_PATH) ? readFileSync(STORE_PATH, "utf8") : null);
}

export function saveKitStore(store: KitStore): void {
  mkdirSync(join(STORE_PATH, ".."), { recursive: true });
  const temp = `${STORE_PATH}.tmp`;
  writeFileSync(temp, JSON.stringify({ version: 1, values: store }), { encoding: "utf8", mode: 0o600 });
  renameSync(temp, STORE_PATH);
}
