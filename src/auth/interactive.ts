import { PublicClientApplication, type AuthenticationResult } from "@azure/msal-node";
import open from "open";
import { DELEGATED_SCOPES } from "../config.js";
import { createMsalCachePlugin } from "./tokenCache.js";
import { effectiveRole } from "./roles.js";
import type { AuthProvider } from "./types.js";

interface InteractiveOptions {
  tenantId: string;
  clientId: string;
  deviceCode: boolean;
}

const DEVICE_CODE_BLOCKED_HINT =
  "Device code sign-in didn't get a response from Entra ID. Many tenants now block " +
  "device code flow by default via a Microsoft-managed Conditional Access policy " +
  "(a 2025 anti-phishing change). Try again without --device-code to use the " +
  "interactive browser flow instead, or ask your tenant admin to exempt this app " +
  "from that policy if you specifically need device code (e.g. no local browser).";

export async function createInteractiveAuth(options: InteractiveOptions): Promise<AuthProvider> {
  const flow = options.deviceCode ? "device-code" : "interactive-browser";

  // Same cache file src/auth/webSession.ts uses for the `ui` browser
  // session — one sign-in, shared by both, instead of two disjoint caches.
  const cachePlugin = await createMsalCachePlugin(`${options.tenantId}-${options.clientId}.bin`);
  const msal = new PublicClientApplication({
    auth: { clientId: options.clientId, authority: `https://login.microsoftonline.com/${options.tenantId}` },
    cache: cachePlugin ? { cachePlugin } : undefined,
  });

  // Memoized so getToken() and getRole() — called in either order, any
  // number of times — share exactly one real sign-in.
  let acquirePromise: Promise<AuthenticationResult> | undefined;
  function acquire(): Promise<AuthenticationResult> {
    if (!acquirePromise) acquirePromise = doAcquire(msal, options);
    return acquirePromise;
  }

  return {
    flow,
    tenantId: options.tenantId,
    async getToken() {
      const result = await acquire();
      return result.accessToken;
    },
    async getRole() {
      const result = await acquire();
      return effectiveRole(result.account?.idTokenClaims?.roles as string[] | undefined);
    },
  };
}

async function doAcquire(msal: PublicClientApplication, options: InteractiveOptions): Promise<AuthenticationResult> {
  const accounts = await msal.getTokenCache().getAllAccounts();
  if (accounts.length === 1) {
    try {
      const silent = await msal.acquireTokenSilent({ account: accounts[0], scopes: DELEGATED_SCOPES });
      if (silent) return silent;
    } catch {
      // Cached refresh token revoked/expired, or nothing usable cached —
      // fall through to a real sign-in below.
    }
  }

  try {
    if (options.deviceCode) {
      const result = await msal.acquireTokenByDeviceCode({
        scopes: DELEGATED_SCOPES,
        deviceCodeCallback: (response) => console.log(`\n${response.message}\n`),
      });
      if (!result) throw new Error("Sign-in did not return a token.");
      return result;
    }
    // msal-node's own acquireTokenInteractive spins up its own loopback
    // listener and opens the browser — no port pinned here (unlike ui.ts's
    // fixed 7878): Entra ignores the port for localhost redirect URIs, so
    // any free port msal-node picks matches the bare `http://localhost`
    // redirect URI this flow needs registered (see docs/index.html —
    // deliberately separate from ui's fixed-port /auth/callback one, since
    // Entra does NOT ignore the path, only the port).
    return await msal.acquireTokenInteractive({
      scopes: DELEGATED_SCOPES,
      openBrowser: async (url) => {
        await open(url);
      },
    });
  } catch (err) {
    if (options.deviceCode) throw new Error(describeDeviceCodeFailure(err));
    throw err;
  }
}

function describeDeviceCodeFailure(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/blocked|conditional access|AADSTS/i.test(message)) {
    return `${DEVICE_CODE_BLOCKED_HINT}\n\nOriginal error: ${message}`;
  }
  return message;
}
