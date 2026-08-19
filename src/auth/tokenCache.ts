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

// Windows Credential Manager and macOS Keychain are reliably present.
// Linux relies on a libsecret-backed keyring (gnome-keyring/kwallet or a
// D-Bus secret service) that's frequently absent on headless boxes,
// containers, and WSL — and @azure/identity-cache-persistence's failure
// mode there is an *unhandled promise rejection deep in its own internals*,
// not a catchable throw, so it crashes the whole process rather than
// degrading gracefully. Safer to just never attempt it on Linux than to
// try and rely on a try/catch that can't actually reach the failure.
const CACHE_SUPPORTED = process.platform === "win32" || process.platform === "darwin";

let pluginRegistered = false;

/**
 * Registers the OS-native secure-storage plugin backing persistent token
 * caching. Safe to call more than once per process. Throws synchronously
 * (catchable) on platforms where this isn't attempted at all — see
 * CACHE_SUPPORTED above for why Linux is excluded rather than best-effort.
 */
export function registerCachePlugin(): void {
  if (!CACHE_SUPPORTED) {
    throw new Error("Persistent token cache is only supported on Windows and macOS for now.");
  }
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
