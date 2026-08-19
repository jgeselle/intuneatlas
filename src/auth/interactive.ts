import { DeviceCodeCredential, InteractiveBrowserCredential } from "@azure/identity";
import { DELEGATED_SCOPES } from "../config.js";
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
  if (options.deviceCode) {
    const credential = new DeviceCodeCredential({
      tenantId: options.tenantId,
      clientId: options.clientId,
      userPromptCallback: (info) => {
        console.log(`\n${info.message}\n`);
      },
    });

    return {
      flow: "device-code",
      async getToken() {
        try {
          const result = await credential.getToken(DELEGATED_SCOPES);
          return requireToken(result);
        } catch (err) {
          throw new Error(describeDeviceCodeFailure(err));
        }
      },
    };
  }

  const credential = new InteractiveBrowserCredential({
    tenantId: options.tenantId,
    clientId: options.clientId,
  });

  return {
    flow: "interactive-browser",
    async getToken() {
      const result = await credential.getToken(DELEGATED_SCOPES);
      return requireToken(result);
    },
  };
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
