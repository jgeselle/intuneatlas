import { GRAPH_V1_BASE } from "./config.js";

export async function graphGet<T>(token: string, path: string, base: string = GRAPH_V1_BASE): Promise<T> {
  const url = path.startsWith("http") ? path : `${base}${path}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Graph request to ${url} failed: ${response.status} ${response.statusText}\n${body}`);
  }

  return (await response.json()) as T;
}

interface ODataPage<T> {
  value: T[];
  "@odata.nextLink"?: string;
}

/** Follows @odata.nextLink until exhausted, returning every item across all pages. */
export async function graphGetAll<T>(token: string, path: string, base: string = GRAPH_V1_BASE): Promise<T[]> {
  const items: T[] = [];
  let next: string | undefined = path;

  while (next) {
    // graphGet only prefixes `base` onto relative paths; @odata.nextLink is
    // already a full URL, so it passes through untouched on later iterations.
    const page: ODataPage<T> = await graphGet<ODataPage<T>>(token, next, base);
    items.push(...page.value);
    next = page["@odata.nextLink"];
  }

  return items;
}
