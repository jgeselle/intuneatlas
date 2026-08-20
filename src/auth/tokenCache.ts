import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { isSea } from "node:sea";
import {
  deserializeAuthenticationRecord,
  serializeAuthenticationRecord,
  useIdentityPlugin,
  type AuthenticationRecord,
} from "@azure/identity";

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
//
// A packaged SEA .exe (see the packaging plan) can't load this at all,
// working or not: @azure/identity-cache-persistence pulls in keytar, a
// native addon, which needs real node_modules resolution — something a
// self-contained sealed executable structurally doesn't have. Confirmed the
// hard way: it doesn't degrade, it fails to even load the module graph.
const CACHE_SUPPORTED = (process.platform === "win32" || process.platform === "darwin") && !isSea();

let pluginRegistered = false;

/**
 * Registers the OS-native secure-storage plugin backing persistent token
 * caching. Safe to call more than once per process. Rejects (catchable) on
 * platforms/build modes where this isn't attempted at all — see
 * CACHE_SUPPORTED above.
 *
 * The import of @azure/identity-cache-persistence is deliberately dynamic,
 * not static — a static top-level import gets evaluated as part of module
 * instantiation, before this function's own try/catch (or any caller's)
 * ever runs, which is exactly what broke the packaged exe: the whole
 * process crashed on load, not on first use. A dynamic import here defers
 * evaluation to actual call time, inside a catchable async function.
 */
export async function registerCachePlugin(): Promise<void> {
  if (!CACHE_SUPPORTED) {
    throw new Error("Persistent token cache is only supported on Windows and macOS for now.");
  }
  if (pluginRegistered) return;
  const { cachePersistencePlugin } = await import("@azure/identity-cache-persistence");
  useIdentityPlugin(cachePersistencePlugin);
  pluginRegistered = true;
}

/**
 * OS-native persistent cache plugin for a raw `msal-node` `PublicClientApplication`
 * (used by src/auth/webSession.ts for the browser sign-in flow) — a different
 * plugin family from registerCachePlugin() above (that one is `@azure/identity`-
 * specific), but backed by the exact same native dependency (`keytar`, via
 * `@azure/msal-node-extensions`) and so needs the exact same guardrails:
 * Windows/macOS only, never in a packaged SEA exe, and never allowed to crash
 * the caller — any failure here just means no persistence, not a dead process.
 */
export async function createMsalCachePlugin(cacheFileName: string): Promise<import("@azure/msal-common/node").ICachePlugin | undefined> {
  if (!CACHE_SUPPORTED) return undefined;
  try {
    const { PersistenceCreator, DataProtectionScope, PersistenceCachePlugin } = await import("@azure/msal-node-extensions");
    await mkdir(CACHE_DIR, { recursive: true });
    const persistence = await PersistenceCreator.createPersistence({
      cachePath: join(CACHE_DIR, cacheFileName),
      serviceName: CACHE_NAME,
      accountName: cacheFileName,
      dataProtectionScope: DataProtectionScope.CurrentUser,
    });
    return new PersistenceCachePlugin(persistence);
  } catch {
    return undefined; // no libsecret, unsupported platform, or anything else — proceed without persistence
  }
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
