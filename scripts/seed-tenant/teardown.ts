// Deletes every object this toolkit created — anything whose name starts
// with TEST_TAG — and nothing else. Filters client-side rather than via
// OData $filter: configurationPolicies is a beta resource with unclear
// $filter support on `name`, and client-side filtering sidesteps that
// entirely at the cost of listing everything first, which is cheap for a
// dedicated test tenant.
import { GRAPH_BETA_BASE, TEST_TAG, type SeedClient } from "./client.js";

interface NamedObject {
  id: string;
  name?: string;
  displayName?: string;
}

function isTagged(obj: NamedObject): boolean {
  return (obj.name ?? obj.displayName ?? "").startsWith(TEST_TAG);
}

export async function teardown(client: SeedClient): Promise<void> {
  const policies = await client.getAll<NamedObject>("/deviceManagement/configurationPolicies", GRAPH_BETA_BASE);
  const taggedPolicies = policies.filter(isTagged);
  for (const policy of taggedPolicies) {
    await client.del(`/deviceManagement/configurationPolicies/${policy.id}`, GRAPH_BETA_BASE);
  }
  console.log(`teardown: deleted ${taggedPolicies.length} configuration ${taggedPolicies.length === 1 ? "policy" : "policies"}.`);

  const legacyConfigs = await client.getAll<NamedObject>("/deviceManagement/deviceConfigurations?$select=id,displayName");
  const taggedLegacyConfigs = legacyConfigs.filter(isTagged);
  for (const config of taggedLegacyConfigs) {
    await client.del(`/deviceManagement/deviceConfigurations/${config.id}`);
  }
  console.log(
    `teardown: deleted ${taggedLegacyConfigs.length} legacy device configuration ${taggedLegacyConfigs.length === 1 ? "profile" : "profiles"}.`,
  );

  const groups = await client.getAll<NamedObject>("/groups?$select=id,displayName");
  const taggedGroups = groups.filter(isTagged);
  for (const group of taggedGroups) {
    await client.del(`/groups/${group.id}`);
  }
  console.log(`teardown: deleted ${taggedGroups.length} ${taggedGroups.length === 1 ? "group" : "groups"}.`);
}
