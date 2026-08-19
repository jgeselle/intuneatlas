import { ClientSecretCredential } from "@azure/identity";
import { APPLICATION_SCOPE } from "../config.js";
import type { AuthProvider } from "./types.js";

interface ClientCredentialsOptions {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

/** Unattended auth for hosted/scheduled use. Never used for local interactive login. */
export function createClientCredentialsAuth(options: ClientCredentialsOptions): AuthProvider {
  const credential = new ClientSecretCredential(
    options.tenantId,
    options.clientId,
    options.clientSecret,
  );

  return {
    flow: "client-credentials",
    tenantId: options.tenantId,
    async getToken() {
      const result = await credential.getToken(APPLICATION_SCOPE);
      if (!result) {
        throw new Error("Sign-in did not return a token.");
      }
      return result.token;
    },
  };
}
