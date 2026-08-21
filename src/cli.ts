#!/usr/bin/env -S node --no-warnings
import { Command } from "commander";
import { runExport } from "./commands/export.js";
import { runLogin } from "./commands/login.js";
import { installPersistent, uninstallPersistent } from "./commands/persist.js";
import { runScan } from "./commands/scan.js";
import { runUi } from "./commands/ui.js";

const program = new Command();

program
  .name("intuneatlas")
  .description("Flatten every Intune profile into one settings index, keyed on the CSP path.")
  // Keep in sync with package.json's "version" — not read dynamically
  // because the packaged exe doesn't ship package.json alongside it.
  .version("0.0.9");

function withAuthOptions(command: Command): Command {
  return command
    .requiredOption("--tenant <id-or-domain>", "Tenant ID or domain, e.g. contoso.onmicrosoft.com")
    .option("--client-id <id>", "Your Entra app (client) ID — see intuneatlas.com/docs to register one; can also come from INTUNEATLAS_CLIENT_ID")
    .option("--client-secret <secret>", "Client secret — selects the unattended client-credentials flow")
    .option("--device-code", "Use device-code sign-in instead of the interactive browser flow", false);
}

function withErrorHandling<Opts>(action: (opts: Opts) => Promise<void>) {
  return async (opts: Opts) => {
    try {
      await action(opts);
    } catch (err) {
      if (process.env.INTUNEATLAS_DEBUG) {
        console.error(err);
      } else {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`\nError: ${message}`);
        console.error("(set INTUNEATLAS_DEBUG=1 for the full stack trace)");
      }
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
  .option("--baseline <path>", "Directory of baseline YAML rules (defaults to the bundled starter pack)")
  .action(
    withErrorHandling((opts) =>
      runScan({
        tenant: opts.tenant,
        clientId: opts.clientId,
        clientSecret: opts.clientSecret,
        deviceCode: opts.deviceCode,
        out: opts.out,
        baseline: opts.baseline,
      }),
    ),
  );

program
  .command("ui")
  .description("Open the web UI. Always signs in with your own Microsoft account — that's what runs any scan you trigger.")
  .option("--tenant <id-or-domain>", "Tenant to sign in to — needed the first time, or to switch tenants")
  .option("--client-id <id>", "Your Entra app (client) ID — see intuneatlas.com/docs to register one; can also come from INTUNEATLAS_CLIENT_ID")
  .option("--report <path>", "Read a report from a prior `scan --out` instead of scanning live")
  .option("--baseline <path>", "Directory of baseline YAML rules (defaults to the bundled starter pack)")
  .option(
    "--host <address>",
    "Interface to bind to (default: 127.0.0.1, this machine only). Anything else — e.g. 0.0.0.0 — shares it with a team; each teammate signs in with their own Microsoft account.",
  )
  .option(
    "--persist",
    "Register this exact command to run in the background, starting at boot and restarting on failure (Windows: Scheduled Task as SYSTEM; Linux: systemd service as root). Requires --tenant and an elevated/root shell.",
    false,
  )
  .option("--stop", "Stop and remove a previously --persist'd background instance.", false)
  .action(
    withErrorHandling((opts) => {
      if (opts.stop) return uninstallPersistent();
      if (opts.persist) {
        return installPersistent({
          tenant: opts.tenant,
          clientId: opts.clientId,
          host: opts.host,
          baseline: opts.baseline,
        });
      }
      return runUi({
        tenant: opts.tenant,
        clientId: opts.clientId,
        report: opts.report,
        baseline: opts.baseline,
        host: opts.host,
      });
    }),
  );

program
  .command("export")
  .description("Export the last scan from local storage — never re-scans the tenant.")
  .option("--tenant <id-or-domain>", "Only export the latest scan for this tenant")
  .option("--kind <kind>", "settings (default), compliance, or enrollment", "settings")
  .option("--format <format>", "csv (default; only format available for now)", "csv")
  .option("--out <path>", "Write to a file instead of stdout")
  .action(
    withErrorHandling((opts) =>
      runExport({
        tenant: opts.tenant,
        kind: opts.kind,
        format: opts.format,
        out: opts.out,
      }),
    ),
  );

program.parse();
