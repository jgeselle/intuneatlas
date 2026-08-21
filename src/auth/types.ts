import type { Role } from "./roles.js";

export interface AuthProvider {
  /** Human-readable name of the flow in use, e.g. "interactive-browser". */
  readonly flow: string;

  /** The tenant this credential resolved against — recorded alongside scans. */
  readonly tenantId: string;

  /** Resolves to a bearer token valid for Microsoft Graph. */
  getToken(): Promise<string>;

  /**
   * The signed-in user's IntuneAtlas role, resolved from the ID token's
   * `roles` claim — not a plain field, since for interactive/device-code
   * flows it's only known once sign-in actually completes. `null` means
   * no per-user identity at all (client-credentials) or no App Role
   * assigned. Safe to call before or after getToken() — both share the
   * same underlying sign-in, triggered by whichever is called first.
   */
  getRole(): Promise<Role | null>;
}
