#!/usr/bin/env node
// Entrypoint for the seeding toolkit. Run with tsx, e.g.:
//   tsx scripts/seed-tenant/index.ts conflict
//   tsx scripts/seed-tenant/index.ts volume 50 --dry-run
//   tsx scripts/seed-tenant/index.ts teardown
// See scripts/seed-tenant/README.md for required environment variables.
import { createSeedClient } from "./client.js";
import { seedBelowBaseline } from "./scenarios/belowBaseline.js";
import { seedConflict } from "./scenarios/conflict.js";
import { seedGroupSetting } from "./scenarios/groupSetting.js";
import { seedMultiPlatform } from "./scenarios/multiPlatform.js";
import { seedVolume } from "./scenarios/volume.js";
import { teardown } from "./teardown.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const positional = args.filter((a) => a !== "--dry-run");
const [scenario, arg] = positional;

const SCENARIOS: Record<string, (client: Awaited<ReturnType<typeof createSeedClient>>) => Promise<void>> = {
  conflict: (client) => seedConflict(client, arg),
  groupSetting: (client) => seedGroupSetting(client, arg),
  belowBaseline: (client) => seedBelowBaseline(client, arg),
  volume: (client) => seedVolume(client, arg ? Number(arg) : undefined),
  multiPlatform: (client) => seedMultiPlatform(client),
  teardown: (client) => teardown(client),
};

async function main() {
  if (!scenario || !SCENARIOS[scenario]) {
    console.error(`Usage: tsx scripts/seed-tenant/index.ts <${Object.keys(SCENARIOS).join("|")}> [arg] [--dry-run]`);
    process.exitCode = 1;
    return;
  }

  const client = await createSeedClient({ dryRun });
  if (dryRun) console.log("--dry-run: no Graph writes will be made.\n");
  await SCENARIOS[scenario](client);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
