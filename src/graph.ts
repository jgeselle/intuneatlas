import { GRAPH_V1_BASE } from "./config.js";

// A real tenant of any size legitimately trips Intune Graph's throttling
// during a scan — confirmed for real against a tenant with ~1,200
// real settings across 111 policies, resolving hundreds of distinct
// setting definitions and categories. Retries with the server's own
// Retry-After rather than failing the whole scan over a transient 429.
const MAX_ATTEMPTS = 6;

// A scan asks for every policy's settings and every definition at once —
// hundreds of requests in the same instant. Left unbounded, that opens
// hundreds of connections together, and some get dropped before they
// answer (worst on a hosted instance, where outbound connections are
// rationed). Node reports each drop as a bare "fetch failed". So requests
// take turns, and one that dies on the network is tried again.
const MAX_CONCURRENT = 8;
const TRANSIENT_STATUS = new Set([502, 503, 504]);

let inFlight = 0;
const waiting: Array<() => void> = [];

async function withSlot<T>(work: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve));
  else inFlight++;
  try {
    return await work();
  } finally {
    // A waiting request inherits the slot directly, so the count never dips and lets a newcomer jump the queue.
    const next = waiting.shift();
    if (next) next();
    else inFlight--;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** What actually went wrong on the network — fetch itself only ever says "fetch failed". */
function networkReason(err: unknown): string {
  const cause = err instanceof Error ? (err.cause as { code?: string; message?: string } | undefined) : undefined;
  return cause?.code ?? cause?.message ?? (err instanceof Error ? err.message : String(err));
}

type Outcome<T> = { body: T } | { retryInMs: number } | { error: Error };

export async function graphGet<T>(token: string, path: string, base: string = GRAPH_V1_BASE): Promise<T> {
  const url = path.startsWith("http") ? path : `${base}${path}`;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const canRetry = attempt < MAX_ATTEMPTS;
    // The slot covers the request and reading its answer, never the wait before a retry.
    const outcome = await withSlot<Outcome<T>>(async () => {
      let response: Response;
      try {
        response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      } catch (err) {
        if (canRetry) return { retryInMs: 250 * 2 ** (attempt - 1) };
        return { error: new Error(`Couldn't reach Microsoft Graph (${networkReason(err)}) after ${MAX_ATTEMPTS} tries: ${url}`, { cause: err }) };
      }

      if ((response.status === 429 || TRANSIENT_STATUS.has(response.status)) && canRetry) {
        const retryAfter = response.headers.get("Retry-After");
        await response.body?.cancel();
        if (retryAfter !== null && Number.isFinite(Number(retryAfter))) return { retryInMs: Number(retryAfter) * 1000 };
        // Throttling wants real patience; a gateway hiccup is usually gone in a moment.
        return { retryInMs: response.status === 429 ? 2 ** attempt * 1000 : 250 * 2 ** (attempt - 1) };
      }

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        return { error: new Error(`Graph request to ${url} failed: ${response.status} ${response.statusText}\n${body}`) };
      }

      try {
        return { body: (await response.json()) as T };
      } catch (err) {
        // The connection can still drop while the answer is arriving.
        if (canRetry) return { retryInMs: 250 * 2 ** (attempt - 1) };
        return { error: new Error(`Microsoft Graph's answer was cut off (${networkReason(err)}) after ${MAX_ATTEMPTS} tries: ${url}`, { cause: err }) };
      }
    });

    if ("body" in outcome) return outcome.body;
    if ("error" in outcome) throw outcome.error;
    await sleep(outcome.retryInMs);
  }
  // Unreachable: the last attempt always returns a body or an error.
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
