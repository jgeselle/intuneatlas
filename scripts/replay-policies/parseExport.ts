import { readFileSync } from "node:fs";
import { load } from "js-yaml";

/**
 * Parses one exported policy YAML — a format some real-world tenants use
 * (settingDefinitionId under the field name `csp_path`, despite not
 * actually being a CSP path string; `applied_value` + `applied_value_type`
 * for the raw value). Not a Graph API shape — this is whatever a specific
 * export tool produced. Deliberately tolerant: unknown fields (owner,
 * last_reviewed, reviewer, rationale) are ignored rather than rejected, so
 * this doesn't need to track every export tool's exact schema.
 */
export interface ExportedSetting {
  settingDefinitionId: string;
  appliedValue: unknown;
  valueType: string;
}

export interface ExportedPolicy {
  name: string;
  settings: ExportedSetting[];
}

interface RawYamlSetting {
  csp_path: string;
  applied_value: unknown;
  applied_value_type: string;
}

interface RawYamlPolicy {
  name: string;
  settings?: RawYamlSetting[];
}

export function parseExportFile(path: string): ExportedPolicy {
  const parsed = load(readFileSync(path, "utf8")) as RawYamlPolicy;
  return {
    name: parsed.name,
    settings: (parsed.settings ?? []).map((s) => ({
      settingDefinitionId: s.csp_path,
      appliedValue: s.applied_value,
      valueType: s.applied_value_type,
    })),
  };
}
