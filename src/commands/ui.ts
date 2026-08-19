import { readFile } from "node:fs/promises";
import open from "open";
import { resolveAuth, type ResolveAuthOptions } from "../auth/index.js";
import { buildReport, type ScanReport } from "../scan/report.js";
import { startServer } from "../server/staticServer.js";

export interface UiOptions extends ResolveAuthOptions {
  report?: string;
}

export async function runUi(options: UiOptions): Promise<void> {
  const report = await resolveReport(options);

  const { url } = await startServer({ report });
  console.log(`intuneatlas ui — ${url}`);
  await open(url);
}

async function resolveReport(options: UiOptions): Promise<ScanReport> {
  if (options.report) {
    const raw = await readFile(options.report, "utf8");
    return JSON.parse(raw) as ScanReport;
  }

  if (!options.tenant) {
    throw new Error("Pass --report <file> (from a prior `scan --out`) or --tenant to run a live scan.");
  }

  const auth = resolveAuth(options);
  const token = await auth.getToken();
  return buildReport(token, auth.flow);
}
