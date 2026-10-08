import { GRAPH_BETA_BASE } from "../config.js";

/**
 * The only place in the shipped product that sends anything but a GET to
 * Microsoft Graph. src/graph.ts stays read-only on purpose; everything
 * that changes a tenant goes through here, and everything that calls this
 * lives under src/push — so "what can this tool write?" has one answer to
 * read.
 *
 * Returns the response body where there is one (a create returns the new
 * object), undefined for the usual 204.
 */
export async function graphWrite<T = unknown>(token: string, method: "PUT" | "PATCH" | "POST", path: string, body: unknown): Promise<T | undefined> {
  const url = `${GRAPH_BETA_BASE}${path}`;
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Graph ${method} ${url} failed: ${response.status} ${response.statusText}\n${await response.text()}`);
  }
  const text = response.status === 204 ? "" : await response.text();
  return text ? (JSON.parse(text) as T) : undefined;
}
