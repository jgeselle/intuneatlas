import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  deserializeAuthenticationRecord,
  serializeAuthenticationRecord,
  useIdentityPlugin,
  type AuthenticationRecord,
} from "@azure/identity";
import { cachePersistencePlugin } from "@azure/identity-cache-persistence";

const CACHE_NAME = "intuneatlas";
const CACHE_DIR = join(homedir(), ".intuneatlas");

export const TOKEN_CACHE_OPTIONS = { enabled: true, name: CACHE_NAME };

let pluginRegistered = false;

/**
 * Registers the OS-native secure-storage plugin (Credential Manager / Keychain
 * / libsecret) backing persistent token caching. Safe to call more than once
 * per process. Some headless Linux environments (WSL, containers, CI) lack
 * the libsecret backend this needs — callers should treat this as best-effort
 * and fall back to a plain, non-cached credential if anything cache-related
 * throws, rather than assuming it always works.
 */
export function registerCachePlugin(): void {
  if (pluginRegistered) return;
  useIdentityPlugin(cachePersistencePlugin);
  pluginRegistered = true;
}

function recordPath(tenantId: string, clientId: string): string {
  return join(CACHE_DIR, `${tenantId}-${clientId}.json`);
}

export async function loadAuthenticationRecord(
  tenantId: string,
  clientId: string,
): Promise<AuthenticationRecord | undefined> {
  try {
    const raw = await readFile(recordPath(tenantId, clientId), "utf8");
    return deserializeAuthenticationRecord(raw);
  } catch {
    return undefined; // no cached record yet, or it's unreadable — fall through to a fresh sign-in
  }
}

export async function saveAuthenticationRecord(
  tenantId: string,
  clientId: string,
  record: AuthenticationRecord,
): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(recordPath(tenantId, clientId), serializeAuthenticationRecord(record), "utf8");
  } catch {
    // Best effort — the sign-in itself already succeeded; it just won't be
    // remembered for next time (e.g. a read-only home directory).
  }
}
