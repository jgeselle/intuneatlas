import { writeFile } from "node:fs/promises";
import { toCsv } from "../csv.js";
import { getAllNotes } from "../storage/notes.js";
import { getLatestScan } from "../storage/scans.js";

export interface ExportOptions {
  tenant?: string;
  kind?: "settings" | "compliance" | "enrollment";
  format?: "csv";
  out?: string;
}

/**
 * Reads from the tool's own storage only — never touches Graph/auth. Getting
 * a spreadsheet in front of someone shouldn't require re-scanning the tenant.
 */
export async function runExport(options: ExportOptions): Promise<void> {
  if (options.format && options.format !== "csv") {
    throw new Error(`Unsupported format "${options.format}" — only csv is available for now.`);
  }

  const report = getLatestScan(options.tenant);
  if (!report) {
    throw new Error("No scan recorded yet. Run `intuneatlas scan` first.");
  }

  const kind = options.kind ?? "settings";
  if (!["settings", "compliance", "enrollment"].includes(kind)) {
    throw new Error(`Unknown --kind "${kind}" — expected settings, compliance, or enrollment.`);
  }

  const notes = getAllNotes();
  const rows = kind === "settings" ? settingsRows(report, notes) : policyRows(report, kind, notes);
  const csv = toCsv(rows);

  if (options.out) {
    await writeFile(options.out, csv, "utf8");
    console.error(`Wrote ${rows.length} ${kind} rows to ${options.out}`);
  } else {
    console.log(csv);
  }
}

function noteText(notes: Record<string, { text: string }[]>, key: string): string {
  return (notes[key] ?? []).map((n) => n.text).join("\n");
}

function settingsRows(
  report: NonNullable<ReturnType<typeof getLatestScan>>,
  notes: Record<string, { text: string }[]>,
): Array<Record<string, string>> {
  return report.settings.map((e) => ({
    name: e.name,
    category: e.category,
    platform: e.platform,
    cspPath: e.cspPath,
    state: e.state,
    conflict: e.conflict ? "yes" : "no",
    values: e.values.join(" / "),
    policies: e.sources.map((s) => s.policyName).join(", "),
    notes: noteText(notes, e.key),
  }));
}

function policyRows(
  report: NonNullable<ReturnType<typeof getLatestScan>>,
  kind: "compliance" | "enrollment",
  notes: Record<string, { text: string }[]>,
): Array<Record<string, string>> {
  const items = kind === "compliance" ? report.compliancePolicies : report.enrollmentConfigurations;
  return items.map((p) => ({
    name: p.name,
    platform: p.platform,
    deployed: p.deployed ? "yes" : "no",
    ...(p.priority !== undefined ? { priority: String(p.priority) } : {}),
    notes: noteText(notes, p.id),
  }));
}
