import { createInterface } from "node:readline/promises";
import { getStoredClientId, setStoredClientId } from "../storage/config.js";
import { createClientCredentialsAuth } from "./clientCredentials.js";
import { createInteractiveAuth } from "./interactive.js";
import type { AuthProvider } from "./types.js";

export interface ResolveAuthOptions {
  tenant?: string;
  clientId?: string;
  clientSecret?: string;
  deviceCode?: boolean;
}

const CLIENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function promptForClientId(): Promise<string> {
  console.log("\nNo Entra app registered yet — see https://intuneatlas.com/docs/#register-app for a five-minute walkthrough.");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const answer = (await rl.question("Application (client) ID: ")).trim();
      if (CLIENT_ID_PATTERN.test(answer)) return answer;
      console.log("That doesn't look like a client ID (expected a GUID, e.g. 12345678-1234-1234-1234-123456789abc) — try again.");
    }
  } finally {
    rl.close();
  }
}

/**
 * Resolves the Entra app's client ID — the same app registration is meant
 * to cover every tenant this machine ever points at, so it's saved locally
 * (~/.intuneatlas/intuneatlas.db) instead of being retyped per invocation
 * like --tenant is.
 *
 * Order: an explicit --client-id always wins *and* becomes the new saved
 * default (that's how you change it later — just pass it again); otherwise
 * INTUNEATLAS_CLIENT_ID (a per-invocation override, deliberately not
 * persisted); otherwise whatever was saved before. If none of those exist
 * and this is an interactive terminal, prompts once and saves the answer so
 * future commands never ask again. Piped/non-interactive stdin (CI, a
 * script) skips the prompt — hanging on stdin there would just look like a
 * hang — and throws the same actionable error as before instead.
 */
export async function resolveClientId(explicit?: string): Promise<string> {
  if (explicit) {
    setStoredClientId(explicit);
    return explicit;
  }

  const clientId = process.env.INTUNEATLAS_CLIENT_ID ?? getStoredClientId();
  if (clientId) return clientId;

  if (!process.stdin.isTTY) {
    throw new Error(
      "Missing client ID. Register your own Entra app (see intuneatlas.com/docs) and pass " +
        "--client-id <id>, or set INTUNEATLAS_CLIENT_ID.",
    );
  }

  const entered = await promptForClientId();
  setStoredClientId(entered);
  console.log("Saved — future commands won't ask again. Pass --client-id to change it.\n");
  return entered;
}

export async function resolveAuth(options: ResolveAuthOptions): Promise<AuthProvider> {
  const tenantId = options.tenant ?? process.env.INTUNEATLAS_TENANT_ID;
  if (!tenantId) {
    throw new Error("Missing tenant. Pass --tenant <id-or-domain> or set INTUNEATLAS_TENANT_ID.");
  }

  const clientId = await resolveClientId(options.clientId);

  const clientSecret = options.clientSecret ?? process.env.INTUNEATLAS_CLIENT_SECRET;
  if (clientSecret) {
    return createClientCredentialsAuth({ tenantId, clientId, clientSecret });
  }

  return createInteractiveAuth({ tenantId, clientId, deviceCode: Boolean(options.deviceCode) });
}
