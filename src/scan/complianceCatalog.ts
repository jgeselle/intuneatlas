import type { GraphSettingInstance } from "./settingValue.js";

/**
 * Compliance policies in the Settings Catalog format.
 *
 * Besides the typed, one-per-platform compliance policies (see
 * complianceSettings.ts), Intune has a second kind, used for Linux:
 * `deviceManagement/compliancePolicies`, built exactly like a Settings
 * Catalog configuration policy — a list of setting instances, each
 * pointing at a definition. Confirmed against a live tenant: the
 * definitions live in their own catalog (`complianceSettings`; asking
 * `configurationSettings` for one is a 404), which also holds Windows
 * definitions shared with configuration policies.
 *
 * So the same definition id can mean a configuration setting or a
 * compliance one. To keep them apart everywhere — the index, baselines,
 * the pages — a compliance catalog setting's ids carry this prefix from
 * the moment they are read. It also tells the definition lookup which
 * catalog to ask, and puts these under isComplianceDefinition along with
 * the typed ones. The option ids a value stores are left as Graph has them.
 */
export const COMPLIANCE_CATALOG_PREFIX = "compliance.catalog.";

export function inComplianceCatalog(definitionId: string): boolean {
  return definitionId.startsWith(COMPLIANCE_CATALOG_PREFIX);
}

export function toComplianceCatalogId(graphId: string): string {
  return COMPLIANCE_CATALOG_PREFIX + graphId;
}

/** The id Graph knows the definition by. */
export function graphDefinitionId(definitionId: string): string {
  return inComplianceCatalog(definitionId) ? definitionId.slice(COMPLIANCE_CATALOG_PREFIX.length) : definitionId;
}

/** A setting instance, and every instance nested in it, with its definition ids marked as the compliance catalog's. */
export function asComplianceInstance(instance: GraphSettingInstance): GraphSettingInstance {
  const each = (children: GraphSettingInstance[] | null | undefined) => (children ?? []).map(asComplianceInstance);
  return {
    ...instance,
    settingDefinitionId: toComplianceCatalogId(instance.settingDefinitionId),
    ...(instance.choiceSettingValue ? { choiceSettingValue: { ...instance.choiceSettingValue, children: each(instance.choiceSettingValue.children) } } : {}),
    ...(instance.groupSettingValue ? { groupSettingValue: { children: each(instance.groupSettingValue.children) } } : {}),
    ...(instance.groupSettingCollectionValue
      ? { groupSettingCollectionValue: instance.groupSettingCollectionValue.map((group) => ({ children: each(group.children) })) }
      : {}),
  };
}
