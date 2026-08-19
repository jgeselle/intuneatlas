import { GRAPH_BASE_URL } from "./config.js";

export async function graphGet<T>(token: string, path: string): Promise<T> {
  const response = await fetch(`${GRAPH_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Graph request to ${path} failed: ${response.status} ${response.statusText}\n${body}`);
  }

  return (await response.json()) as T;
}
