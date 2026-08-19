#!/usr/bin/env node
import { Command } from "commander";
import { runLogin } from "./commands/login.js";
import { runScan } from "./commands/scan.js";
import { runUi } from "./commands/ui.js";

const program = new Command();

program
  .name("intuneatlas")
  .description("Flatten every Intune profile into one settings index, keyed on the CSP path.")
  .version("0.0.1");

function withAuthOptions(command: Command): Command {
  return command
    .requiredOption("--tenant <id-or-domain>", "Tenant ID or domain, e.g. contoso.onmicrosoft.com")
    .option("--client-id <id>", "Entra app (client) ID")
    .option("--client-secret <secret>", "Client secret — selects the unattended client-credentials flow")
    .option("--device-code", "Use device-code sign-in instead of the interactive browser flow", false);
}

function withOptionalAuthOptions(command: Command): Command {
  return command
    .option("--tenant <id-or-domain>", "Tenant ID or domain — runs a live scan instead of reading --report")
    .option("--client-id <id>", "Entra app (client) ID")
    .option("--client-secret <secret>", "Client secret — selects the unattended client-credentials flow")
    .option("--device-code", "Use device-code sign-in instead of the interactive browser flow", false);
}

function withErrorHandling<Opts>(action: (opts: Opts) => Promise<void>) {
  return async (opts: Opts) => {
    try {
      await action(opts);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nError: ${message}`);
      process.exitCode = 1;
    }
  };
}

withAuthOptions(program.command("login"))
  .description("Sign in to a tenant and confirm the token works.")
  .action(
    withErrorHandling((opts) =>
      runLogin({
        tenant: opts.tenant,
        clientId: opts.clientId,
        clientSecret: opts.clientSecret,
        deviceCode: opts.deviceCode,
      }),
    ),
  );

withAuthOptions(program.command("scan"))
  .description("Pull Windows Settings Catalog policies and build the settings index.")
  .option("--out <path>", "Write JSON to a file instead of stdout")
  .action(
    withErrorHandling((opts) =>
      runScan({
        tenant: opts.tenant,
        clientId: opts.clientId,
        clientSecret: opts.clientSecret,
        deviceCode: opts.deviceCode,
        out: opts.out,
      }),
    ),
  );

withOptionalAuthOptions(program.command("ui"))
  .description("Open the local web UI, from a saved report or a live scan.")
  .option("--report <path>", "Read a report from a prior `scan --out` instead of scanning live")
  .action(
    withErrorHandling((opts) =>
      runUi({
        tenant: opts.tenant,
        clientId: opts.clientId,
        clientSecret: opts.clientSecret,
        deviceCode: opts.deviceCode,
        report: opts.report,
      }),
    ),
  );

program.parse();
