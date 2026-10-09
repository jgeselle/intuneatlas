import { writeFile } from "node:fs/promises";
import { applyBaselinesToReport } from "../scan/report.js";
import { scopeToGroup } from "../scan/scope.js";
import type { SettingIndexEntry } from "../scan/types.js";
import { getLatestScan } from "../storage/scans.js";
import { resolveBaseline } from "./check.js";
import { csvCell, finding, resolveGroup, scannedLabel, settingLines, STATES, type CheckFinding } from "./checkResult.js";

export interface SearchOptions {
  /** Words to look for; a setting matches when every one of them appears somewhere in it. */
  query: string[];
  tenant?: string;
  group?: string;
  state?: string;
  platform?: string;
  baseline?: string;
  format?: string;
  out?: string;
}

/** Everything about a setting that a search word can hit: what it is called, where it lives, which policies set it, and to what. */
function haystack(entry: SettingIndexEntry): string {
  return [entry.name, entry.category, entry.cspPath, entry.definitionId ?? "", entry.platform, entry.state, ...entry.sources.flatMap((source) => [source.policyName, source.value])]
    .join("\n")
    .toLowerCase();
}

/**
 * `intuneatlas search` — the web UI's settings list, from a terminal:
 * the last scan, optionally narrowed to a group, filtered by words, state
 * and platform. Each setting comes with the policies that set it, who
 * each of those reaches, and its value. Nothing is asked of the tenant.
 */
export async function runSearch(options: SearchOptions): Promise<void> {
  const format = options.format ?? "text";
  if (!["text", "json", "csv"].includes(format)) throw new Error(`Unknown --format "${format}" — expected text, json, or csv.`);
  const state = options.state ? STATES.find((s) => s.toLowerCase() === options.state!.toLowerCase()) : undefined;
  if (options.state && !state) throw new Error(`Unknown --state "${options.state}" — expected one of: ${STATES.join(", ")}.`);
  const say = (message: string) => console.error(message);

  const raw = getLatestScan(options.tenant ?? process.env.INTUNEATLAS_TENANT_ID);
  if (!raw) throw new Error("There is no scan to search yet. Run `intuneatlas scan` first.");

  const baseline = await resolveBaseline(options.baseline, say);
  try {
    const group = options.group ? resolveGroup(raw, options.group) : undefined;
    // Judged the way the web UI does, so a setting's state here is its state there.
    const judged = applyBaselinesToReport(group ? scopeToGroup(raw, group.id) : raw, baseline.rules);

    const words = options.query.flatMap((part) => part.toLowerCase().split(/\s+/)).filter(Boolean);
    const platform = options.platform?.toLowerCase();
    const matches = judged.settings.filter((entry) => {
      if (state && entry.state !== state) return false;
      if (platform && !entry.platform.toLowerCase().includes(platform)) return false;
      const text = haystack(entry);
      return words.every((word) => text.includes(word));
    });
    const settings = matches.map((entry) => finding(entry, judged.groups));
    const header = { tenant: judged.tenantName ?? judged.tenant, scannedAt: judged.scannedAt, ...(group ? { group } : {}), query: words.join(" ") };

    const output =
      format === "json" ? JSON.stringify({ ...header, settings }, null, 2) + "\n" : format === "csv" ? searchCsv(settings) : searchText(header, settings);
    if (options.out) {
      await writeFile(options.out, output, "utf8");
      say(`Wrote ${settings.length} ${settings.length === 1 ? "setting" : "settings"} to ${options.out}`);
    } else {
      process.stdout.write(output);
    }
  } finally {
    await baseline.dispose();
  }
}

export function searchText(header: { tenant: string; scannedAt: string; group?: { name: string }; query: string }, settings: CheckFinding[]): string {
  const lines = [
    `${header.tenant} · ${header.group ? header.group.name : "all policies"}`,
    `Scanned ${scannedLabel(header.scannedAt)}`,
    `${settings.length} ${settings.length === 1 ? "setting" : "settings"}${header.query ? ` matching "${header.query}"` : ""}`,
  ];
  for (const setting of settings) {
    lines.push("", `  ${setting.name}  (${setting.platform} · ${setting.category})  ${setting.state}`);
    if (setting.path) lines.push(`    ${setting.path}`);
    lines.push(...settingLines(setting));
  }
  return lines.join("\n") + "\n";
}

/** One row per policy that sets a setting (and one for a setting no policy sets) — what a spreadsheet filters best. */
export function searchCsv(settings: CheckFinding[]): string {
  const rows = [["state", "name", "platform", "category", "path", "policy", "assigned to", "value", "expected"]];
  for (const setting of settings) {
    const expected = setting.expected.map((e) => `${e.baseline}: ${e.value}`).join(" | ");
    const policies = setting.policies.length ? setting.policies : [{ name: "", assignedTo: "", value: "" }];
    for (const policy of policies) rows.push([setting.state, setting.name, setting.platform, setting.category, setting.path, policy.name, policy.assignedTo, policy.value, expected]);
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}
