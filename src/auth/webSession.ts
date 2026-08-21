import { randomBytes } from "node:crypto";
import { type AccountInfo, CryptoProvider, PublicClientApplication } from "@azure/msal-node";
import { DELEGATED_SCOPES } from "../config.js";
import { createMsalCachePlugin } from "./tokenCache.js";
import { type Role, effectiveRole } from "./roles.js";

/**
 * Identifies who's looking at a `ui` instance. `id` is the Entra object ID
 * (`AccountInfo.localAccountId`, mapped from the `oid` claim) — immutable
 * and unique per user per tenant, and the only field ownership/authorization
 * checks (e.g. "did this Contributor stage this change") should ever
 * compare against. `name` is a *display* value only — Entra display names
 * are neither unique (two people can share one) nor stable (renaming a
 * user doesn't change their `id`) — never use it for anything but showing
 * text to a human. `role` is resolved once from the ID token's `roles`
 * claim (an Entra App Role assignment), not the raw claim array — callers
 * should never need to re-derive it. `null` means signed in but unassigned
 * any App Role, which grants zero capabilities (see src/auth/roles.ts)
 * rather than falling back to full access.
 */
export interface ViewerIdentity {
  id: string;
  name: string;
  email: string;
  role: Role | null;
}

/**
 * Pure account-to-identity mapping — exported (rather than kept as a
 * closure-local helper) specifically so it's directly unit-testable
 * without a real MSAL sign-in: see test/auth/webSession.test.ts, which
 * pins `id` coming from `localAccountId`, not `name`.
 */
export function identityFromAccount(account: AccountInfo): ViewerIdentity {
  return {
    id: account.localAccountId,
    name: account.name ?? account.username,
    email: account.username,
    role: effectiveRole(account.idTokenClaims?.roles as string[] | undefined),
  };
}

interface Session {
  identity: ViewerIdentity;
  account: AccountInfo;
}

interface PendingLogin {
  codeVerifier: string;
  createdAt: number;
}

const SESSION_COOKIE = "intuneatlas_session";
const PENDING_LOGIN_TTL_MS = 10 * 60 * 1000;
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export interface WebSessionManager {
  /** Builds the Entra /authorize redirect URL and remembers the PKCE verifier under a fresh state. */
  loginRedirectUrl(redirectUri: string): Promise<string>;
  /** Exchanges the callback's code for tokens and starts a session. Throws if state is missing/expired. */
  completeLogin(params: { code: string; state: string; redirectUri: string }): Promise<{ sessionId: string; identity: ViewerIdentity }>;
  /**
   * Tries to sign in from the OS-persisted cache alone, no browser round
   * trip — used so a returning solo user doesn't get re-prompted on every
   * `intuneatlas ui` launch. Only meaningful when exactly one account is
   * cached (the common single-person-per-machine case); undefined otherwise.
   */
  trySilentLogin(): Promise<{ sessionId: string; identity: ViewerIdentity } | undefined>;
  /**
   * Reads the caller's session cookie, if any, and returns who they are.
   * Opportunistically re-derives `role` from a silent token refresh on
   * every call — cheap when the cached access token hasn't expired (a
   * local cache read, no network), and bounds how long a role change in
   * Entra takes to actually apply for an already-signed-in browser to
   * roughly the access-token lifetime instead of the full session
   * cookie lifetime. Falls back to the last-known identity on any
   * refresh failure rather than failing the request.
   */
  getSession(cookieHeader: string | undefined): Promise<ViewerIdentity | undefined>;
  /** A live Graph access token for the signed-in viewer, refreshed silently — undefined if there's no valid session. */
  getGraphToken(cookieHeader: string | undefined): Promise<string | undefined>;
  /**
   * Ends the caller's session and purges the underlying account from the
   * persistent cache — not just dropping the cookie. Otherwise the very
   * next page load would call trySilentLogin() and immediately sign the
   * same person back in, making "sign out" a no-op.
   */
  signOut(cookieHeader: string | undefined): Promise<void>;
  /** `Set-Cookie` value that pins a browser to the given session id. */
  sessionCookie(sessionId: string): string;
  /** `Set-Cookie` value that clears a previously-set session cookie. */
  clearSessionCookie(): string;
}

/**
 * One manager per running server, scoped to the tenant the server was
 * started against — sign-in is deliberately restricted to that tenant
 * (authority is tenant-specific, not `common`), not "any Microsoft account
 * anywhere". Reuses the same public, no-secret multi-tenant client ID the
 * desktop interactive flow already uses (src/config.ts) — PKCE stands in for
 * a client secret here, same as any SPA/mobile auth-code flow.
 *
 * Local solo use and a shared team deployment both go through this exact
 * same sign-in; what differs is just where the server binds (see
 * src/server/staticServer.ts) and, for a solo user, that a cached sign-in
 * skips the visible browser step (trySilentLogin below). What every
 * account gets to *do* once signed in depends on their Entra App Role
 * assignment (src/auth/roles.ts) — sign-in alone grants nothing beyond
 * an identity.
 */
export async function createWebSessionManager(tenantId: string, clientId: string): Promise<WebSessionManager> {
  // Same cache file src/auth/interactive.ts uses for the CLI's sign-in —
  // one sign-in shared by `ui`, `scan`, and `login`, not a disjoint cache
  // per entry point.
  const cachePlugin = await createMsalCachePlugin(`${tenantId}-${clientId}.bin`);
  const msal = new PublicClientApplication({
    auth: { clientId, authority: `https://login.microsoftonline.com/${tenantId}` },
    cache: cachePlugin ? { cachePlugin } : undefined,
  });
  const crypto = new CryptoProvider();

  // Sessions themselves stay in-memory (a browser just signs in again after
  // a server restart, cheaply — see trySilentLogin), but the underlying
  // Graph tokens they point at persist via cachePlugin above when available.
  const pendingLogins = new Map<string, PendingLogin>();
  const sessions = new Map<string, Session>();

  function prunePendingLogins(): void {
    const cutoff = Date.now() - PENDING_LOGIN_TTL_MS;
    for (const [state, login] of pendingLogins) {
      if (login.createdAt < cutoff) pendingLogins.delete(state);
    }
  }

  function startSession(account: AccountInfo): { sessionId: string; identity: ViewerIdentity } {
    const identity = identityFromAccount(account);
    const sessionId = randomBytes(24).toString("hex");
    sessions.set(sessionId, { identity, account });
    return { sessionId, identity };
  }

  return {
    async loginRedirectUrl(redirectUri) {
      prunePendingLogins();
      const { verifier, challenge } = await crypto.generatePkceCodes();
      const state = randomBytes(16).toString("hex");
      pendingLogins.set(state, { codeVerifier: verifier, createdAt: Date.now() });

      return msal.getAuthCodeUrl({
        scopes: DELEGATED_SCOPES,
        redirectUri,
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
        state,
        // Without this, Entra silently reuses whatever Microsoft session is
        // already active in the browser — fine for a single-account user,
        // but this is IT admin tooling, and admins juggling a personal
        // account alongside one or more work/admin accounts are common.
        // Doesn't affect trySilentLogin's cached-account fast path above —
        // this only applies to an actual interactive round trip.
        prompt: "select_account",
      });
    },

    async completeLogin({ code, state, redirectUri }) {
      const pending = pendingLogins.get(state);
      if (!pending) {
        throw new Error("Sign-in expired or was already completed — try again.");
      }
      pendingLogins.delete(state);

      const result = await msal.acquireTokenByCode({
        scopes: DELEGATED_SCOPES,
        redirectUri,
        code,
        codeVerifier: pending.codeVerifier,
      });
      if (!result?.account) {
        throw new Error("Sign-in didn't return an account.");
      }
      return startSession(result.account);
    },

    async trySilentLogin() {
      if (!cachePlugin) return undefined;
      const accounts = await msal.getTokenCache().getAllAccounts();
      if (accounts.length !== 1) return undefined; // none cached, or ambiguous — fall back to a real sign-in
      try {
        const result = await msal.acquireTokenSilent({ account: accounts[0], scopes: DELEGATED_SCOPES });
        if (!result?.account) return undefined;
        return startSession(result.account);
      } catch {
        return undefined; // cached refresh token revoked/expired — fall back to a real sign-in
      }
    },

    async getSession(cookieHeader) {
      const sessionId = readCookie(cookieHeader, SESSION_COOKIE);
      const session = sessionId ? sessions.get(sessionId) : undefined;
      if (!session) return undefined;
      try {
        const result = await msal.acquireTokenSilent({ account: session.account, scopes: DELEGATED_SCOPES });
        if (result?.account) {
          session.account = result.account;
          session.identity = identityFromAccount(result.account);
        }
      } catch {
        // Refresh failed (offline, revoked, transient) — fall back to the
        // identity already on file rather than failing the request.
      }
      return session.identity;
    },

    async getGraphToken(cookieHeader) {
      const sessionId = readCookie(cookieHeader, SESSION_COOKIE);
      const session = sessionId ? sessions.get(sessionId) : undefined;
      if (!session) return undefined;
      try {
        const result = await msal.acquireTokenSilent({ account: session.account, scopes: DELEGATED_SCOPES });
        return result?.accessToken;
      } catch {
        return undefined;
      }
    },

    async signOut(cookieHeader) {
      const sessionId = readCookie(cookieHeader, SESSION_COOKIE);
      const session = sessionId ? sessions.get(sessionId) : undefined;
      if (sessionId) sessions.delete(sessionId);
      if (session) {
        try {
          await msal.getTokenCache().removeAccount(session.account);
        } catch {
          // Best effort — worst case the cache still has it and a future
          // trySilentLogin() offers this account again; the browser session
          // itself is already gone either way.
        }
      }
    },

    sessionCookie(sessionId) {
      return `${SESSION_COOKIE}=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
    },

    clearSessionCookie() {
      return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
    },
  };
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}
