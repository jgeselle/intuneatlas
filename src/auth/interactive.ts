import {
  DeviceCodeCredential,
  InteractiveBrowserCredential,
  type AuthenticationRecord,
  type TokenCredential,
} from "@azure/identity";
import { DELEGATED_SCOPES } from "../config.js";
import {
  loadAuthenticationRecord,
  registerCachePlugin,
  saveAuthenticationRecord,
  TOKEN_CACHE_OPTIONS,
} from "./tokenCache.js";
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

export function createInteractiveAuth(options: InteractiveOptions): AuthProvider {
  const flow = options.deviceCode ? "device-code" : "interactive-browser";

  return {
    flow,
    tenantId: options.tenantId,
    async getToken() {
      try {
        return await getTokenWithCache(options);
      } catch (err) {
        if (options.deviceCode) throw new Error(describeDeviceCodeFailure(err));
        throw err;
      }
    },
  };
}

async function getTokenWithCache(options: InteractiveOptions): Promise<string> {
  let authenticationRecord: AuthenticationRecord | undefined;
  let cachingEnabled = false;

  try {
    await registerCachePlugin();
    authenticationRecord = await loadAuthenticationRecord(options.tenantId, options.clientId);
    cachingEnabled = true;
  } catch {
    // No libsecret / Credential Manager / Keychain backend available on this
    // host — proceed without persistence, the user will just be prompted
    // interactively every command instead of just once.
    cachingEnabled = false;
  }

  const credential = buildCredential(options, cachingEnabled, authenticationRecord);

  try {
    if (cachingEnabled && !authenticationRecord) {
      const record = await credential.authenticate(DELEGATED_SCOPES);
      if (record) await saveAuthenticationRecord(options.tenantId, options.clientId, record);
    }
    return requireToken(await credential.getToken(DELEGATED_SCOPES));
  } catch (err) {
    if (!cachingEnabled) throw err;
    // Something about the cached path failed after we already committed to
    // it (corrupt cache, revoked record, etc.) — retry once with a plain,
    // uncached credential rather than leaving the user stuck.
    const fallback = buildCredential(options, false, undefined);
    return requireToken(await fallback.getToken(DELEGATED_SCOPES));
  }
}

function buildCredential(
  options: InteractiveOptions,
  cachingEnabled: boolean,
  authenticationRecord: AuthenticationRecord | undefined,
): TokenCredential & { authenticate: (scopes: string[]) => Promise<AuthenticationRecord | undefined> } {
  const cacheExtras = cachingEnabled
    ? { tokenCachePersistenceOptions: TOKEN_CACHE_OPTIONS, authenticationRecord }
    : {};

  if (options.deviceCode) {
    return new DeviceCodeCredential({
      tenantId: options.tenantId,
      clientId: options.clientId,
      userPromptCallback: (info) => {
        console.log(`\n${info.message}\n`);
      },
      ...cacheExtras,
    });
  }

  return new InteractiveBrowserCredential({
    tenantId: options.tenantId,
    clientId: options.clientId,
    ...cacheExtras,
  });
}

function requireToken(result: { token: string } | null): string {
  if (!result) {
    throw new Error("Sign-in did not return a token.");
  }
  return result.token;
}

function describeDeviceCodeFailure(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/blocked|conditional access|AADSTS/i.test(message)) {
    return `${DEVICE_CODE_BLOCKED_HINT}\n\nOriginal error: ${message}`;
  }
  return message;
}
