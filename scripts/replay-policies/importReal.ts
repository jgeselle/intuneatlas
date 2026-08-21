#!/usr/bin/env node
// Imports real exported policies as real Settings Catalog policies in the
// test tenant — realistic, high-volume, real-world-shaped test data no
// synthetic keyword-picked scenario can match. Reads from a local,
// gitignored directory at runtime only; this script never contains
// anyone's actual policy names, values, or settingDefinitionIds — those
// live only in whatever directory you point it at.
//
// Expected input: one YAML file per policy, shape:
//   name: <policy display name>
//   settings:
//     - csp_path: <settingDefinitionId>       # not actually a CSP path string
//       applied_value: <value>
//       applied_value_type: choice|string|integer|stringCollection|secret
//
// Caveat, and it matters: assignment topology isn't in this export format,
// so every imported policy gets assigned to one shared group here. Any
// "conflict" this surfaces is a real same-setting-different-value overlap
// across policies, but not necessarily a real conflict in whatever
// environment they were exported from — that depends on which groups they
// actually target there, which this doesn't know.
//
// Usage: tsx scripts/replay-policies/importReal.ts <dir> [--dry-run] [--limit=N]
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { createSeedClient } from "../seed-tenant/client.js";
import { assignPolicy, createConfigurationPolicy, createTestGroup } from "../seed-tenant/objects.js";
import { buildPolicyInstances, resolveAllDefinitions } from "./buildInstances.js";
import { parseExportFile } from "./parseExport.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitFlag = args.find((a) => a.startsWith("--limit="));
const limit = limitFlag ? Number(limitFlag.slice("--limit=".length)) : undefined;
const dir = args.find((a) => !a.startsWith("--")) ?? "donottrack/policies";

async function main() {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .sort();
  const selected = limit ? files.slice(0, limit) : files;
  console.log(`Parsing ${selected.length} of ${files.length} files from ${dir}...`);

  const parsed = selected.map((file) => ({ file, policy: parseExportFile(join(dir, file)) }));
  const allIds = parsed.flatMap(({ policy }) => policy.settings.map((s) => s.settingDefinitionId));
  console.log(`${new Set(allIds).size} distinct setting definitions to resolve...`);

  const client = await createSeedClient({ dryRun });
  const { resolved, failures } = await resolveAllDefinitions(client, allIds);
  console.log(`Resolved ${resolved.size}, failed ${failures.length}.`);
  if (failures.length > 0) {
    console.log("Resolution failures (first 10):");
    for (const f of failures.slice(0, 10)) console.log(`  ${f.id}: ${f.error}`);
  }

  const group = await createTestGroup(client, "real policy import target");

  let created = 0;
  let totalInstances = 0;
  let totalSkipped = 0;
  for (const { file, policy } of parsed) {
    const { instances, skipped } = buildPolicyInstances(policy.settings, resolved);
    totalSkipped += skipped.length;
    if (instances.length === 0) {
      console.log(`  ${file}: 0 usable settings, skipped entirely`);
      continue;
    }
    try {
      const createdPolicy = await createConfigurationPolicy(client, {
        name: `import: ${file.replace(/\.ya?ml$/, "")}`,
        platforms: "windows10",
        settings: instances,
      });
      await assignPolicy(client, createdPolicy.id, [{ kind: "group", groupId: group.id }]);
      created++;
      totalInstances += instances.length;
      console.log(`  ${file}: created with ${instances.length} settings (${skipped.length} skipped)`);
    } catch (err) {
      console.log(`  ${file}: FAILED — ${err instanceof Error ? err.message.split("\n")[0] : err}`);
    }
  }

  console.log(
    `\nDone: ${created}/${parsed.length} policies created (${totalInstances} settings total, ${totalSkipped} skipped), ` +
      `assigned to "${group.displayName}".`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
