import { useDefinitionStore } from "../src/scan/settingDefinitions.js";

type Fetch = (url: string | URL, init?: RequestInit) => Promise<Response>;

/**
 * The scan reads Intune's catalog whole — a plain list of every
 * definition — never a definition at a time. Fixtures are easier to read
 * (and were written) as one answer per definition id, so this turns a
 * fake Graph that answers `…/configurationSettings/<id>` into one that
 * also answers the list, made of the ids named here. Categories are left
 * out of their lists on purpose: the scan then asks for each by id, which
 * the real thing does too for the ones Graph's list omits.
 *
 * Also forgets any catalog an earlier test loaded.
 */
export function withCatalog(inner: Fetch, ids: { configurationSettings?: string[]; complianceSettings?: string[] } = {}): typeof fetch {
  useDefinitionStore(undefined);
  return (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const list = /\/deviceManagement\/(configurationSettings|complianceSettings|configurationCategories|complianceCategories)$/.exec(u)?.[1];
    if (!list) return inner(url, init);
    const value: unknown[] = [];
    if (list === "configurationSettings" || list === "complianceSettings") {
      for (const id of ids[list] ?? []) {
        const one = await inner(`${u}/${id}`, init);
        if (one.ok) value.push(await one.json());
      }
    }
    return new Response(JSON.stringify({ value }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}
