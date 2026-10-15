import type { IncomingMessage, ServerResponse } from "node:http";
import type { ViewerIdentity } from "../auth/webSession.js";
import { can } from "../auth/roles.js";
import { readRequestBody, sendApiError } from "./http.js";
import type { ReminderStore } from "./types.js";

/**
 * Whether a viewer may see a setting at all: one of the policies setting it is one they can see.
 * A setting no policy in the tenant sets — one a baseline expects (Missing), or one gone since —
 * shows nothing of the tenant, so anyone may see it. Every setting, where nothing narrows what
 * they see.
 */
export function settingVisible(report: unknown, viewer: ViewerIdentity, key: string): boolean {
  const visible = viewer.visiblePolicies;
  if (!visible) return true;
  const entry = (report as { settings?: Array<{ key: string; sources: Array<{ policyId: string }> }> } | null)?.settings?.find((e) => e.key === key);
  if (!entry || entry.sources.length === 0) return true;
  return entry.sources.some((s) => visible.has(s.policyId));
}

/**
 * Everyone who can see the report sees every reminder. Adding one, and
 * marking one done or snoozing it, takes what adding a note takes;
 * deleting one is its maker's or an Admin's, like a note. Every answer is
 * the whole list again — it's short, and the bell and the drawer both
 * show it.
 */
export async function handleReminders(
  req: IncomingMessage,
  res: ServerResponse,
  store: ReminderStore | undefined,
  viewer: ViewerIdentity,
  canSee: (settingKey: string) => boolean,
): Promise<void> {
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  // Every answer is the list again — of the reminders on settings this viewer may see.
  const listJson = (list: unknown[]) => json(200, (list as Array<{ targetKey: string }>).filter((r) => canSee(r.targetKey)));
  if (!store) return json(501, { error: "Reminders aren't available from this session." });
  if (!can(viewer.role, "view")) return json(403, { error: "Your role doesn't include viewing the report." });

  try {
    if (req.url === "/api/reminders") {
      if (req.method === "GET") return listJson(store.list());
      if (req.method !== "POST") return json(405, { error: "Method not allowed." });
      if (!can(viewer.role, "note")) return json(403, { error: "Your role doesn't include adding reminders." });
      const body = JSON.parse(await readRequestBody(req)) as Record<string, unknown>;
      const repeat = body.repeatMonths === null || body.repeatMonths === undefined ? null : Number(body.repeatMonths);
      const note = typeof body.note === "string" ? body.note.trim() : "";
      if (typeof body.targetKey !== "string" || !body.targetKey || typeof body.targetName !== "string") return json(400, { error: "Name the setting." });
      if (typeof body.dueOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.dueOn) || Number.isNaN(Date.parse(body.dueOn))) return json(400, { error: "Choose a date." });
      if (repeat !== null && !(Number.isInteger(repeat) && repeat >= 1 && repeat <= 120)) return json(400, { error: "Repeat every 1 to 120 months, or not at all." });
      if (note.length > 1000) return json(400, { error: "Keep the note under 1,000 characters." });
      if (!canSee(body.targetKey)) return json(403, { error: "Your Intune role doesn't let you see that setting." });
      return listJson(store.add({ targetKey: body.targetKey, targetName: body.targetName, note, dueOn: body.dueOn, repeatMonths: repeat }, viewer));
    }

    const match = req.url?.match(/^\/api\/reminders\/(\d+)(?:\/(done|snooze))?$/);
    if (!match) return json(404, { error: "Not found." });
    const id = Number(match[1]);
    const existing = store.get(id) as ({ createdById: string; targetKey?: string } | undefined);
    if (!existing || (existing.targetKey !== undefined && !canSee(existing.targetKey))) return json(404, { error: "That reminder no longer exists." });

    if (match[2] && req.method === "POST") {
      if (!can(viewer.role, "note")) return json(403, { error: "Your role doesn't include changing reminders." });
      return listJson(match[2] === "done" ? store.complete(id) : store.snooze(id));
    }
    if (!match[2] && req.method === "DELETE") {
      if (!can(viewer.role, "deleteNote", { ownerId: existing.createdById, viewerId: viewer.id })) {
        return json(403, { error: "You can only delete reminders you made yourself, unless you're an Admin." });
      }
      return listJson(store.remove(id));
    }
    json(405, { error: "Method not allowed." });
  } catch (err) {
    sendApiError(res, err);
  }
}
