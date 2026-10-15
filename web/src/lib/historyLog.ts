// The tenant-wide history as the server narrows it — a kind (pushed or seen by a scan) and words —
// a page at a time, each answer kept: it only changes with a sync or a push, so the Changes page
// shows a kept answer at once. `stamp` names that moment (the scan's time and how many pushes this
// page has made); a different one starts over.
import type { HistoryPage } from "../types.js";

export const LOG_PAGE_SIZE = 100;

/** Which part of the history: one kind (or both), narrowed by words. */
export interface LogFilter {
  kind?: "pushed" | "seen";
  q?: string;
}

const kept = new Map<string, HistoryPage>();
let keptStamp: string | undefined;
const loading = new Map<string, Promise<HistoryPage>>();

const keyOf = ({ kind, q }: LogFilter) => (kind ?? "all") + "|" + (q ?? "").trim().toLowerCase();

async function page({ kind, q }: LogFilter, offset: number): Promise<HistoryPage> {
  const params = new URLSearchParams({ all: "1", limit: String(LOG_PAGE_SIZE), offset: String(offset) });
  if (kind) params.set("kind", kind);
  if (q?.trim()) params.set("q", q.trim());
  const res = await fetch("/api/history?" + params);
  if (!res.ok) throw new Error(String(res.status));
  const body = (await res.json()) as Partial<HistoryPage>;
  return { events: body.events ?? [], next: body.next ?? null, counts: body.counts ?? { pushed: 0, seen: 0 } };
}

function forStamp(stamp: string) {
  if (keptStamp !== stamp) {
    kept.clear();
    loading.clear();
    keptStamp = stamp;
  }
}

/** The first page for this filter. `fresh`: ask even though it's kept — someone else may have pushed since. */
export function loadHistoryLog(stamp: string, filter: LogFilter, fresh = false): Promise<HistoryPage> {
  forStamp(stamp);
  const key = keyOf(filter);
  const held = kept.get(key);
  if (!fresh && held) return Promise.resolve(held);
  const pending = loading.get(key);
  if (pending) return pending;
  const promise = page(filter, 0)
    .then((answer) => {
      if (keptStamp === stamp) kept.set(key, answer);
      return answer;
    })
    .finally(() => loading.delete(key));
  loading.set(key, promise);
  return promise;
}

/** The next older page for this filter, added to what's kept. */
export async function loadMoreHistory(stamp: string, filter: LogFilter): Promise<HistoryPage | undefined> {
  forStamp(stamp);
  const key = keyOf(filter);
  const current = kept.get(key);
  if (!current || current.next === null) return current;
  const more = await page(filter, current.next);
  const seen = new Set(current.events.map((e) => e.id));
  const answer: HistoryPage = { events: [...current.events, ...more.events.filter((e) => !seen.has(e.id))], next: more.next, counts: more.counts };
  if (keptStamp === stamp) kept.set(key, answer);
  return answer;
}

/** What's kept for this filter, if anything — shown straight away. */
export function heldHistoryLog(stamp: string, filter: LogFilter): HistoryPage | undefined {
  return keptStamp === stamp ? kept.get(keyOf(filter)) : undefined;
}
