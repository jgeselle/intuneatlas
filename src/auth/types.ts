export interface AuthProvider {
  /** Human-readable name of the flow in use, e.g. "interactive-browser". */
  readonly flow: string;

  /** Resolves to a bearer token valid for Microsoft Graph. */
  getToken(): Promise<string>;
}
