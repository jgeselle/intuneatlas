import type { IncomingMessage, ServerResponse } from "node:http";
import type { ViewerIdentity } from "../auth/webSession.js";
import { can } from "../auth/roles.js";
import { readRequestBody, sendApiError } from "./http.js";
import type { NoteRequestBody, StartServerOptions } from "./types.js";

export async function handleNoteRequest(
  req: IncomingMessage,
  res: ServerResponse,
  onNoteRequest: StartServerOptions["onNoteRequest"],
  viewer: ViewerIdentity,
  onSaved: (targetKey: string, notes: unknown[]) => void,
): Promise<void> {
  if (!onNoteRequest) {
    res.writeHead(501, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Notes aren't available from this session." }));
    return;
  }
  if (!can(viewer.role, "note")) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Your role doesn't include adding notes." }));
    return;
  }

  try {
    const body = JSON.parse(await readRequestBody(req)) as NoteRequestBody;
    if (!body.targetKey || !body.text?.trim()) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "targetKey and text are required" }));
      return;
    }

    const notes = onNoteRequest(body, viewer);
    onSaved(body.targetKey, notes);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(notes));
  } catch (err) {
    sendApiError(res, err);
  }
}

export async function handleDeleteNote(
  res: ServerResponse,
  id: number,
  onDeleteNote: StartServerOptions["onDeleteNote"],
  getNoteById: StartServerOptions["getNoteById"],
  viewer: ViewerIdentity,
  onDeleted: (targetKey: string, notes: unknown[]) => void,
): Promise<void> {
  if (!onDeleteNote) {
    res.writeHead(501, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Deleting notes isn't available from this session." }));
    return;
  }

  const existing = getNoteById?.(id);
  if (!existing) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `No note with id ${id}.` }));
    return;
  }
  if (!can(viewer.role, "deleteNote", { ownerId: existing.authorId, viewerId: viewer.id })) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "You can only delete notes you wrote yourself, unless you're an Admin." }));
    return;
  }

  try {
    const result = onDeleteNote(id);
    if (result) onDeleted(result.targetKey, result.notes);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result?.notes ?? []));
  } catch (err) {
    sendApiError(res, err);
  }
}
