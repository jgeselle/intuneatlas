import type { ScanReport } from "../scan/report.js";
import { groupIdsIn } from "../scan/targets.js";
import type { AssignmentTarget, GroupDirectory, SettingIndexEntry, SettingIndexState } from "../scan/types.js";

/**
 * What `intuneatlas check` reports: the settings of the tenant (or of one
 * group) in the six states the web UI shows them in, judged by the same
 * code — this file only arranges the outcome for a terminal, a file or a
 * pipeline.
 */
export const STATES: SettingIndexState[] = ["Below baseline", "Conflict", "Missing", "Not assigned", "Meets baseline", "Not checked"];
/** The states that are something to do — what the UI's own worklist is made of, and what makes a check fail. */
export const ATTENTION: SettingIndexState[] = ["Below baseline", "Conflict", "Missing"];

export interface CheckFinding {
  state: SettingIndexState;
  name: string;
  platform: string;
  category: string;
  path: string;
  /** `assignedTo`: who the policy reaches, in words — "All devices", group names, or "not assigned". */
  policies: Array<{ name: string; value: string; assigned: boolean; assignedTo: string }>;
  expected: Array<{ baseline: string; policy: string; value: string; alsoAccepted?: string[]; met: boolean | null }>;
}

export interface CheckResult {
  tenant: string;
  scannedAt: string;
  /** The group everything was narrowed to; absent for the whole tenant. */
  group?: { id: string; name: string };
  baselines: Array<{ name: string; settings: number; policies: number }>;
  counts: Record<SettingIndexState, number>;
  /** Every setting, or only the ones needing attention — see `all`. */
  settings: CheckFinding[];
  /** True when anything is below baseline, in conflict or missing. */
  failed: boolean;
}

const oneLine = (value: string) => value.split("\n").join(", ");

/** Who a policy is assigned to, the way the web UI says it under a policy's name. */
function assignedTo(targets: AssignmentTarget[] | undefined, groups: GroupDirectory | undefined): string {
  if (!targets) return "assignment not recorded";
  const nameOf = (id: string) => groups?.names[id] ?? id;
  const to = targets.flatMap((target) => {
    if (target.kind === "group" && target.excluded) return [];
    const who = target.kind === "allDevices" ? "All devices" : target.kind === "allLicensedUsers" ? "All users" : nameOf(target.groupId);
    return [target.filtered ? `${who} (filtered)` : who];
  });
  const except = targets.flatMap((target) => (target.kind === "group" && target.excluded ? [nameOf(target.groupId)] : []));
  if (to.length === 0) return "not assigned";
  return to.join(", ") + (except.length ? `, except ${except.join(", ")}` : "");
}

export function finding(entry: SettingIndexEntry, groups?: GroupDirectory): CheckFinding {
  return {
    state: entry.state,
    name: entry.name,
    platform: entry.platform,
    category: entry.category,
    path: entry.cspPath,
    policies: entry.sources.map((source) => ({ name: source.policyName, value: oneLine(source.value), assigned: source.deployed, assignedTo: assignedTo(source.targets, groups) })),
    expected: (entry.checks ?? []).map((check) => ({
      baseline: check.source,
      policy: check.policyName,
      value: oneLine(check.expected) + (check.compare === "atMost" ? " or less" : check.compare === "atLeast" ? " or more" : ""),
      ...(check.alternatives?.length ? { alsoAccepted: check.alternatives.map(oneLine) } : {}),
      met: check.passed,
    })),
  };
}

export function buildCheckResult(
  judged: ScanReport,
  options: { group?: { id: string; name: string }; baselines: CheckResult["baselines"]; all?: boolean },
): CheckResult {
  const counts = Object.fromEntries(STATES.map((state) => [state, 0])) as Record<SettingIndexState, number>;
  for (const entry of judged.settings) counts[entry.state]++;
  const shown = judged.settings.filter((entry) => options.all || ATTENTION.includes(entry.state));
  // In the order the states are listed, then as the UI lists settings.
  const settings = [...shown].sort((a, b) => STATES.indexOf(a.state) - STATES.indexOf(b.state)).map((entry) => finding(entry, judged.groups));
  return {
    tenant: judged.tenantName ?? judged.tenant,
    scannedAt: judged.scannedAt,
    ...(options.group ? { group: options.group } : {}),
    baselines: options.baselines,
    counts,
    settings,
    failed: ATTENTION.some((state) => counts[state] > 0),
  };
}

/**
 * The group meant by what was typed: an id, or a name — matched whole,
 * ignoring case. Names are only known where the scan could read them
 * (Group.ReadBasic.All); otherwise only an id can be given.
 */
export function resolveGroup(report: ScanReport, wanted: string): { id: string; name: string } {
  const directory: GroupDirectory = report.groups ?? { available: false, names: {}, contains: {} };
  const ids = new Set<string>([
    ...report.settings.flatMap((entry) => entry.sources.flatMap((source) => groupIdsIn(source.targets ?? []))),
    ...[...report.compliancePolicies, ...report.enrollmentConfigurations].flatMap((policy) => groupIdsIn(policy.targets ?? [])),
    ...Object.values(directory.contains).flat(),
  ]);
  const nameOf = (id: string) => directory.names[id] ?? id;
  if (ids.has(wanted)) return { id: wanted, name: nameOf(wanted) };

  const byName = [...ids].filter((id) => directory.names[id]?.toLowerCase() === wanted.toLowerCase());
  if (byName.length === 1) return { id: byName[0], name: nameOf(byName[0]) };
  if (byName.length > 1) throw new Error(`${byName.length} groups are named "${wanted}". Give the group's id instead: ${byName.join(", ")}.`);

  const known = [...ids].map(nameOf).sort((a, b) => a.localeCompare(b));
  const hint = !directory.available
    ? " Group names couldn't be read (the app registration has no group permission, such as Group.ReadBasic.All), so only a group's id can be given."
    : known.length
      ? ` Groups policies are assigned to: ${known.slice(0, 20).join(", ")}${known.length > 20 ? `, and ${known.length - 20} more` : ""}.`
      : " No policy in the tenant is assigned to a group.";
  throw new Error(`No policy is assigned to a group called "${wanted}".${hint}`);
}

/** For a terminal: who and what, the six counts, then each setting that needs attention under its state. */
export function formatText(result: CheckResult): string {
  const lines: string[] = [];
  lines.push(`${result.tenant} · ${result.group ? result.group.name : "all policies"}`);
  lines.push(`Scanned ${scannedLabel(result.scannedAt)}`);
  for (const baseline of result.baselines) {
    lines.push(`Baseline: ${baseline.name} — ${baseline.settings} ${baseline.settings === 1 ? "setting" : "settings"} in ${baseline.policies} ${baseline.policies === 1 ? "policy" : "policies"}`);
  }
  lines.push("");
  const width = Math.max(...STATES.map((state) => state.length));
  for (const state of STATES) lines.push(`  ${state.padEnd(width)}  ${String(result.counts[state]).padStart(5)}`);

  let current: SettingIndexState | undefined;
  for (const setting of result.settings) {
    if (setting.state !== current) {
      current = setting.state;
      lines.push("", current.toUpperCase());
    }
    lines.push(`  ${setting.name}  (${setting.platform} · ${setting.category})`);
    lines.push(...settingLines(setting));
  }
  return lines.join("\n") + "\n";
}

/** A setting's policies — each with who it reaches and its value — and what a baseline it doesn't meet expects. */
export function settingLines(setting: CheckFinding): string[] {
  const lines = setting.policies.map((policy) => `    ${policy.name} [${policy.assignedTo}]: ${policy.value}`);
  for (const expected of setting.expected) {
    if (expected.met === true) continue;
    const also = expected.alsoAccepted?.length ? ` (also accepted: ${expected.alsoAccepted.join(" | ")})` : "";
    lines.push(`    expected by ${expected.baseline}: ${expected.value}${also}`);
  }
  return lines;
}

/** When the scan was taken, in the reader's own time zone — a check is only as fresh as its scan. */
export function scannedLabel(scannedAt: string): string {
  const date = new Date(scannedAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export const csvCell = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

/** One row per setting — for a spreadsheet. */
export function formatCsv(result: CheckResult): string {
  const rows = [["state", "name", "platform", "category", "policies", "values", "baseline", "expected"]];
  for (const setting of result.settings) {
    rows.push([
      setting.state,
      setting.name,
      setting.platform,
      setting.category,
      setting.policies.map((policy) => policy.name).join(" | "),
      setting.policies.map((policy) => policy.value).join(" | "),
      setting.expected.map((expected) => expected.baseline).join(" | "),
      setting.expected.map((expected) => expected.value).join(" | "),
    ]);
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}
