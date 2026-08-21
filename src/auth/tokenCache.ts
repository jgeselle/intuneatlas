import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { isSea } from "node:sea";

const CACHE_NAME = "intuneatlas";
const CACHE_DIR = join(homedir(), ".intuneatlas");

// Windows Credential Manager and macOS Keychain are reliably present.
// Linux relies on a libsecret-backed keyring (gnome-keyring/kwallet or a
// D-Bus secret service) that's frequently absent on headless boxes,
// containers, and WSL — and this stack's failure mode there can be an
// *unhandled promise rejection deep in its own internals*, not a catchable
// throw, so it can crash the whole process rather than degrading
// gracefully. Safer to just never attempt it on Linux than to try and rely
// on a try/catch that can't actually reach the failure.
//
// A packaged SEA .exe (see the packaging plan) can't load this at all,
// working or not: it pulls in keytar, a native addon, which needs real
// node_modules resolution — something a self-contained sealed executable
// structurally doesn't have. Confirmed the hard way: it doesn't degrade, it
// fails to even load the module graph.
const CACHE_SUPPORTED = (process.platform === "win32" || process.platform === "darwin") && !isSea();

/**
 * OS-native persistent cache plugin for a raw `msal-node` `PublicClientApplication`
 * — shared by both the CLI's interactive/device-code sign-in
 * (src/auth/interactive.ts) and the web session's browser sign-in
 * (src/auth/webSession.ts), same cache file per tenant+clientId, so signing
 * into one signs into the other too. Backed by `keytar` via
 * `@azure/msal-node-extensions`; Windows/macOS only, never in a packaged SEA
 * exe, and never allowed to crash the caller — any failure here just means
 * no persistence, not a dead process.
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
