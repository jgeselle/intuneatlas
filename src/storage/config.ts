import { getDb } from "./db.js";

const CLIENT_ID_KEY = "client_id";

export function getStoredClientId(): string | undefined {
  const db = getDb();
  const row = db.prepare("SELECT value FROM config WHERE key = ?").get(CLIENT_ID_KEY) as { value: string } | undefined;
  return row?.value;
}

export function setStoredClientId(clientId: string): void {
  const db = getDb();
  db.prepare("INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    CLIENT_ID_KEY,
    clientId,
  );
}
