import { graphGet } from "../graph.js";

interface GraphVerifiedDomain {
  name: string;
  isDefault: boolean;
}

interface GraphOrganization {
  displayName?: string;
  verifiedDomains?: GraphVerifiedDomain[];
}

interface GraphOrganizationList {
  value: GraphOrganization[];
}

/**
 * Best-effort friendly tenant name for display — falls back to undefined
 * (never throws) so a Graph hiccup here never blocks a scan over something
 * that's purely cosmetic. `--tenant` is often a raw GUID or an
 * onmicrosoft.com domain, neither of which reads well in the UI.
 */
export async function fetchTenantDisplayName(token: string): Promise<string | undefined> {
  try {
    const { value } = await graphGet<GraphOrganizationList>(token, "/organization");
    const org = value[0];
    if (!org) return undefined;

    // Just the org name — the sidebar it's shown in is too narrow for
    // "Display Name (domain.onmicrosoft.com)" (confirmed the hard way).
    // The raw --tenant value is still available as a hover tooltip.
    const defaultDomain = org.verifiedDomains?.find((d) => d.isDefault)?.name ?? org.verifiedDomains?.[0]?.name;
    return org.displayName ?? defaultDomain;
  } catch {
    return undefined;
  }
}
