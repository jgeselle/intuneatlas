import { GRAPH_V1_BASE } from "./config.js";

// A real tenant of any size legitimately trips Intune Graph's throttling
// during a scan — confirmed for real against a tenant with ~1,200
// real settings across 111 policies, resolving hundreds of distinct
// setting definitions and categories. Retries with the server's own
// Retry-After rather than failing the whole scan over a transient 429.
// MAX_ATTEMPTS is the budget for everything else that's worth another try.
const MAX_ATTEMPTS = 6;

// A scan asks for every policy's settings and every definition at once —
// hundreds of requests in the same instant. Left unbounded, that opens
// hundreds of connections together, and some get dropped before they
// answer (worst on a hosted instance, where outbound connections are
// rationed). Node reports each drop as a bare "fetch failed". So requests
// take turns, and one that dies on the network is tried again.
const MAX_CONCURRENT = 8;
const TRANSIENT_STATUS = new Set([502, 503, 504]);
// A request that has heard nothing for this long is given up on and tried again, rather than
// holding its turn (and the whole scan) for the several minutes Node would otherwise wait.
const REQUEST_TIMEOUT_MS = 60_000;

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

// Graph throttles per app and tenant, not per request: when one request
// is told to slow down, the rest are about to hear the same. So a 429
// holds every request back until the time Graph named, instead of each
// one finding out for itself and using up its tries doing so (seen on a
// first scan resolving ~1,500 baseline definitions).
const MAX_THROTTLE_WAITS = 12;
let pausedUntil = 0;

async function waitOutThrottling(): Promise<void> {
  while (pausedUntil > Date.now()) await sleep(pausedUntil - Date.now());
}

type Outcome<T> = { body: T } | { retryInMs: number } | { throttled: true } | { error: Error };

export async function graphGet<T>(token: string, path: string, base: string = GRAPH_V1_BASE, timeoutMs: number = REQUEST_TIMEOUT_MS): Promise<T> {
  const url = path.startsWith("http") ? path : `${base}${path}`;
  let failures = 0;
  let throttles = 0;

  for (;;) {
    const canRetry = failures + 1 < MAX_ATTEMPTS;
    const backoffMs = 250 * 2 ** failures;
    // The slot covers the request and reading its answer, never the wait before its own retry.
    const outcome = await withSlot<Outcome<T>>(async () => {
      // Checked once the turn has come — a request that queued before the pause began must sit it out too.
      await waitOutThrottling();
      let response: Response;
      try {
        response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(timeoutMs) });
      } catch (err) {
        if (canRetry) return { retryInMs: backoffMs };
        return { error: new Error(`Couldn't reach Microsoft Graph (${networkReason(err)}) after ${MAX_ATTEMPTS} tries: ${url}`, { cause: err }) };
      }

      const retryAfter = Number(response.headers.get("Retry-After") ?? NaN);

      if (response.status === 429 && throttles < MAX_THROTTLE_WAITS) {
        await response.body?.cancel();
        const waitMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : Math.min(2 ** (throttles + 1), 30) * 1000;
        pausedUntil = Math.max(pausedUntil, Date.now() + waitMs);
        return { throttled: true };
      }

      if (TRANSIENT_STATUS.has(response.status) && canRetry) {
        await response.body?.cancel();
        return { retryInMs: Number.isFinite(retryAfter) ? retryAfter * 1000 : backoffMs };
      }

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        return { error: new Error(`Graph request to ${url} failed: ${response.status} ${response.statusText}\n${body}`) };
      }

      try {
        return { body: (await response.json()) as T };
      } catch (err) {
        // The connection can still drop while the answer is arriving.
        if (canRetry) return { retryInMs: backoffMs };
        return { error: new Error(`Microsoft Graph's answer was cut off (${networkReason(err)}) after ${MAX_ATTEMPTS} tries: ${url}`, { cause: err }) };
      }
    });

    if ("body" in outcome) return outcome.body;
    if ("error" in outcome) throw outcome.error;
    if ("throttled" in outcome) {
      throttles++;
      continue;
    }
    failures++;
    await sleep(outcome.retryInMs);
  }
}

interface ODataPage<T> {
  value: T[];
  "@odata.nextLink"?: string;
}

/** Follows @odata.nextLink until exhausted, returning every item across all pages. */
export async function graphGetAll<T>(token: string, path: string, base: string = GRAPH_V1_BASE, timeoutMs?: number): Promise<T[]> {
  const items: T[] = [];
  let next: string | undefined = path;

  while (next) {
    // graphGet only prefixes `base` onto relative paths; @odata.nextLink is
    // already a full URL, so it passes through untouched on later iterations.
    const page: ODataPage<T> = await graphGet<ODataPage<T>>(token, next, base, timeoutMs);
    items.push(...page.value);
    next = page["@odata.nextLink"];
  }

  return items;
}
