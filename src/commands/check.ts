import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { resolveAuth, type ResolveAuthOptions } from "../auth/index.js";
import { can } from "../auth/roles.js";
import { baselineDirs, loadBaselinePack, loadBaselines } from "../baselines/loader.js";
import { listBaselinePacks } from "../baselines/packs.js";
import { fetchBaseline } from "../baselines/remote.js";
import type { BaselineRule } from "../baselines/types.js";
import { applyBaselinesToReport, baselineDefinitionIds, buildReport, type ScanReport } from "../scan/report.js";
import { scopeToGroup } from "../scan/scope.js";
import { getLatestScan, recordScan } from "../storage/scans.js";
import { buildCheckResult, formatCsv, formatText, resolveGroup } from "./checkResult.js";

export interface CheckOptions extends ResolveAuthOptions {
  /** Scan the tenant first. Without it, the last stored scan is what is checked. */
  scan?: boolean;
  /** A group's name or id; everything is narrowed to what reaches it. Without it, the whole tenant. */
  group?: string;
  /** A folder, or a URL to one — one baseline. Without it, the baselines installed for the web UI. */
  baseline?: string;
  format?: string;
  out?: string;
  /** Report every setting, not only the ones needing attention. */
  all?: boolean;
}

/**
 * `intuneatlas check` — the question the web UI answers when a group and
 * a baseline are chosen, asked from a terminal: take the last scan,
 * narrow it to a group, hold it against a baseline, say what needs
 * attention. The narrowing and the verdicts are the UI's own.
 *
 * Checking is separate from scanning on purpose, like everywhere else in
 * the tool: `scan` reads the tenant and stores what it found; `check` (and
 * `search`) work on that, as often as wanted, against whatever baseline,
 * for whatever group, with no sign-in and nothing asked of the tenant.
 * `--scan` does both in one go, for a scheduled job.
 *
 * Returns whether anything was below baseline, in conflict or missing —
 * the caller turns that into the exit code.
 */
export async function runCheck(options: CheckOptions): Promise<{ failed: boolean }> {
  const format = options.format ?? "text";
  if (!["text", "json", "csv"].includes(format)) throw new Error(`Unknown --format "${format}" — expected text, json, or csv.`);
  // Everything that isn't the result goes to stderr, so the result can be piped.
  const say = (message: string) => console.error(message);

  const baseline = await resolveBaseline(options.baseline, say);
  try {
    const rules = baseline.rules;
    if (rules.length === 0) {
      throw new Error(
        options.baseline
          ? `No exported policies were found in ${options.baseline}. A baseline is a folder of Settings Catalog or compliance policies exported from Intune as JSON.`
          : "There is no baseline to check against. Pass --baseline <folder-or-url>, or add one in the web UI first.",
      );
    }

    let raw: ScanReport;
    if (options.scan) {
      const auth = await resolveAuth(options);
      if (auth.flow !== "client-credentials" && !can(await auth.getRole(), "scan")) {
        throw new Error("Your role doesn't include scanning the tenant. Ask an Admin to run it, or to assign you the Admin role.");
      }
      say("Scanning the tenant …");
      // The baseline is known to the scan, so settings it expects and the tenant lacks are looked up by name.
      raw = await buildReport(await auth.getToken(), auth.flow, auth.tenantId, baselineDefinitionIds(rules));
      recordScan(raw);
    } else {
      const stored = getLatestScan(options.tenant ?? process.env.INTUNEATLAS_TENANT_ID);
      if (!stored) throw new Error("There is no scan to check yet. Run `intuneatlas scan` first, or pass --scan to scan now.");
      raw = stored;
    }

    const group = options.group ? resolveGroup(raw, options.group) : undefined;
    const judged = applyBaselinesToReport(group ? scopeToGroup(raw, group.id) : raw, rules);
    const result = buildCheckResult(judged, {
      ...(group ? { group } : {}),
      baselines: listBaselinePacks(rules).map((pack) => ({ name: pack.name, settings: pack.ruleCount, policies: pack.policyCount })),
      all: options.all,
    });

    // A setting the tenant lacks is only known by name if a scan looked it up — which it does for the baselines it is given.
    const unnamed = judged.settings.filter((entry) => entry.state === "Missing" && entry.name === entry.definitionId).length;
    if (unnamed > 0) say(`${unnamed} missing ${unnamed === 1 ? "setting is" : "settings are"} shown by id: the scan didn't know this baseline. Run the check with --scan once to load their names.`);

    const output = format === "json" ? JSON.stringify(result, null, 2) + "\n" : format === "csv" ? formatCsv(result) : formatText(result);
    if (options.out) {
      await writeFile(options.out, output, "utf8");
      say(`Wrote ${result.settings.length} ${result.settings.length === 1 ? "setting" : "settings"} to ${options.out}`);
    } else {
      process.stdout.write(output);
    }
    return { failed: result.failed };
  } finally {
    await baseline.dispose();
  }
}

/**
 * The baseline a command was pointed at: a folder on this machine or a
 * URL to one, each as one baseline — or, with nothing given, the
 * baselines added in the web UI. A download lives in a temporary folder
 * until `dispose`.
 */
export async function resolveBaseline(given: string | undefined, say: (message: string) => void): Promise<{ rules: BaselineRule[]; dispose: () => Promise<void> }> {
  if (given && /^https?:\/\//i.test(given)) {
    const downloaded = await mkdtemp(join(tmpdir(), "intuneatlas-baseline-"));
    const dispose = () => rm(downloaded, { recursive: true, force: true });
    try {
      say(`Downloading the baseline from ${given} …`);
      const { name } = await fetchBaseline(given, downloaded);
      return { rules: await loadBaselinePack(downloaded, name), dispose };
    } catch (error) {
      await dispose();
      throw error;
    }
  }
  if (given) {
    const folder = resolve(given);
    if (!existsSync(folder)) throw new Error(`There is no folder at ${folder}.`);
    return { rules: await loadBaselinePack(folder, basename(folder)), dispose: async () => {} };
  }
  return { rules: await loadBaselines(baselineDirs()), dispose: async () => {} };
}
