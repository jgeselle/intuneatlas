#!/usr/bin/env node
import { Command } from "commander";
import { runLogin } from "./commands/login.js";

const program = new Command();

program
  .name("intuneatlas")
  .description("Flatten every Intune profile into one settings index, keyed on the CSP path.")
  .version("0.0.1");

program
  .command("login")
  .description("Sign in to a tenant and confirm the token works.")
  .requiredOption("--tenant <id-or-domain>", "Tenant ID or domain, e.g. contoso.onmicrosoft.com")
  .option("--client-id <id>", "Entra app (client) ID")
  .option("--client-secret <secret>", "Client secret — selects the unattended client-credentials flow")
  .option("--device-code", "Use device-code sign-in instead of the interactive browser flow", false)
  .action(async (opts) => {
    try {
      await runLogin({
        tenant: opts.tenant,
        clientId: opts.clientId,
        clientSecret: opts.clientSecret,
        deviceCode: opts.deviceCode,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nError: ${message}`);
      process.exitCode = 1;
    }
  });

program.parse();
