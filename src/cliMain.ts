import net from "node:net";
import { Command } from "commander";
import { runCheck } from "./commands/check.js";
import { runExport } from "./commands/export.js";
import { runLogin } from "./commands/login.js";
import { installPersistent, uninstallPersistent } from "./commands/persist.js";
import { runScan } from "./commands/scan.js";
import { runSearch } from "./commands/search.js";
import { runUi } from "./commands/ui.js";
import { useDefinitionStore } from "./scan/settingDefinitions.js";
import { definitionStore } from "./storage/definitions.js";

// Node tries each address of a host in turn and gives every one only a
// quarter of a second to connect. Where IPv6 is offered but doesn't work
// (seen on Azure Container Apps, and in more than one office network),
// or the machine is busy, each try times out and the request dies as
// "fetch failed" / ETIMEDOUT without Graph ever being reached. Two
// seconds per address is still quick and no longer gives up on a
// connection that was about to succeed.
net.setDefaultAutoSelectFamilyAttemptTimeout(2000);

// What Graph says about Intune's catalog is kept on disk between runs — set here, once, so the
// scan code itself never reaches for the database (and tests of it never touch one).
useDefinitionStore(definitionStore);

const program = new Command();

program
  .name("intuneatlas")
  .description("Flatten every Intune profile into one settings index, matched by the real setting — not just a shared name.")
  // Keep in sync with package.json's "version" — not read dynamically
  // because the packaged exe doesn't ship package.json alongside it.
  .version("0.0.54");

function withAuthOptions(command: Command): Command {
  return command
    .requiredOption("--tenant <id-or-domain>", "Tenant ID or domain, e.g. contoso.onmicrosoft.com")
    .option("--client-id <id>", "Your Entra app (client) ID — see intuneatlas.com/docs to register one. Saved after first use, so you only need this once; pass it again anytime to change it.")
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
  .description("Scan the tenant's configuration, compliance and enrollment policies and build the settings index.")
  .option("--out <path>", "Write JSON to a file instead of stdout")
  .option("--baseline <path>", "Folder of baselines to use instead of your own (~/.intuneatlas/baselines)")
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
  .command("check")
  .description("Check the last scan — or one group in it — against a baseline. Exits 1 if anything is below baseline, in conflict or missing.")
  .option("--group <name-or-id>", "Check only what reaches this group: policies assigned to it, to a group containing it, or to everyone. Without it, the whole tenant.")
  .option(
    "--baseline <folder-or-url>",
    "The baseline: a folder of exported policies, or a URL to one — a GitHub folder, a .zip or .tar.gz archive, or a single policy's .json. Without it, the baselines added in the web UI.",
  )
  .option("--scan", "Scan the tenant first instead of using the last stored scan (needs --tenant and a sign-in, like `scan`)", false)
  .option("--tenant <id-or-domain>", "Which tenant's scan to check — needed with --scan, or when scans of several tenants are stored")
  .option("--client-id <id>", "With --scan: your Entra app (client) ID")
  .option("--client-secret <secret>", "With --scan: client secret, for an unattended run")
  .option("--device-code", "With --scan: use device-code sign-in instead of the browser", false)
  .option("--format <format>", "text (default), json, or csv", "text")
  .option("--out <path>", "Write the result to a file instead of the terminal")
  .option("--all", "Report every setting, not only the ones needing attention", false)
  .action(async (opts) => {
    // Its own exit codes, as a check has three outcomes: 0 nothing to do, 1 something needs attention, 2 it couldn't be checked.
    let failed = false;
    await withErrorHandling(async () => {
      ({ failed } = await runCheck({
        tenant: opts.tenant,
        clientId: opts.clientId,
        clientSecret: opts.clientSecret,
        deviceCode: opts.deviceCode,
        scan: opts.scan,
        group: opts.group,
        baseline: opts.baseline,
        format: opts.format,
        out: opts.out,
        all: opts.all,
      }));
    })(opts);
    process.exitCode = process.exitCode === 1 ? 2 : failed ? 1 : 0;
  });

program
  .command("search [words...]")
  .description("Search the last scan: settings by name, path, category, policy or value — with who sets them, for whom, and to what.")
  .option("--group <name-or-id>", "Only what reaches this group")
  .option("--state <state>", "Only settings in this state: Conflict, Below baseline, Missing, Not assigned, Meets baseline, or Not checked")
  .option("--platform <platform>", "Only this platform, e.g. windows10, macOS, ios")
  .option("--baseline <folder-or-url>", "Judge states against this baseline instead of the ones added in the web UI")
  .option("--tenant <id-or-domain>", "Which tenant's scan to search, when scans of several are stored")
  .option("--format <format>", "text (default), json, or csv", "text")
  .option("--out <path>", "Write the result to a file instead of the terminal")
  .action((words: string[], opts) =>
    withErrorHandling(() =>
      runSearch({ query: words, tenant: opts.tenant, group: opts.group, state: opts.state, platform: opts.platform, baseline: opts.baseline, format: opts.format, out: opts.out }),
    )(opts),
  );

program
  .command("ui")
  .description("Open the web UI. Always signs in with your own Microsoft account — that's what runs any scan you trigger.")
  .option("--tenant <id-or-domain>", "Tenant to sign in to — needed the first time, or to switch tenants")
  .option("--client-id <id>", "Your Entra app (client) ID — see intuneatlas.com/docs to register one. Saved after first use, so you only need this once; pass it again anytime to change it.")
  .option("--report <path>", "Read a report from a prior `scan --out` instead of scanning live")
  .option("--baseline <path>", "Folder of baselines to use instead of your own (~/.intuneatlas/baselines)")
  .option(
    "--host <address>",
    "Interface to bind to (default: 127.0.0.1, this machine only). Anything else — e.g. 0.0.0.0 — shares it with a team; each teammate signs in with their own Microsoft account.",
  )
  .option(
    "--persist",
    "Register this exact command to run in the background, starting at boot and restarting on failure (Windows: Scheduled Task as SYSTEM; Linux: systemd service as root). Requires --tenant, --client-id, and an elevated/root shell — the background service can't prompt for either at boot, or read the client ID saved for your own interactive login.",
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
        version: program.version(),
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
