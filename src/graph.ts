import { GRAPH_V1_BASE } from "./config.js";

// A real tenant of any size legitimately trips Intune Graph's throttling
// during a scan — confirmed for real against a tenant with ~1,200
// real settings across 111 policies, resolving hundreds of distinct
// setting definitions and categories. Retries with the server's own
// Retry-After rather than failing the whole scan over a transient 429.
const MAX_ATTEMPTS = 6;

export async function graphGet<T>(token: string, path: string, base: string = GRAPH_V1_BASE): Promise<T> {
  const url = path.startsWith("http") ? path : `${base}${path}`;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.status === 429 && attempt < MAX_ATTEMPTS) {
      const retryAfterSeconds = Number(response.headers.get("Retry-After")) || 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, retryAfterSeconds * 1000));
      continue;
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Graph request to ${url} failed: ${response.status} ${response.statusText}\n${body}`);
    }

    return (await response.json()) as T;
  }
  // Unreachable: the loop always returns or throws before MAX_ATTEMPTS is exhausted without a final non-429 response.
  throw new Error(`Graph request to ${url} failed: exhausted retries`);
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
