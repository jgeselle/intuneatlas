import type { IncomingMessage, ServerResponse } from "node:http";
import type { ViewerIdentity, WebSessionManager } from "../auth/webSession.js";
import { can } from "../auth/roles.js";
import { PushRefused } from "../push/values.js";
import { readRequestBody, sendApiError } from "./http.js";
import type { StageChangeRequestBody, StartServerOptions, UpdateChangeRequestBody, WithTargetKey } from "./types.js";

export async function handleStageChange(
  req: IncomingMessage,
  res: ServerResponse,
  onStageChange: StartServerOptions["onStageChange"],
  viewer: ViewerIdentity,
  onSaved: (change: WithTargetKey) => void,
): Promise<void> {
  if (!onStageChange) {
    res.writeHead(501, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Staging changes isn't available from this session." }));
    return;
  }
  if (!can(viewer.role, "stage")) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Your role doesn't include staging changes." }));
    return;
  }

  try {
    const body = JSON.parse(await readRequestBody(req)) as StageChangeRequestBody;
    if (body.policyId && viewer.visiblePolicies && !viewer.visiblePolicies.has(body.policyId)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Your Intune role doesn't let you see that policy." }));
      return;
    }
    if (!body.targetKey || !body.targetName || !body.ruleId || body.from === undefined || body.to === undefined) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "targetKey, targetName, ruleId, from, and to are required" }));
      return;
    }
    if (body.targetKind === "new" && !String(body.policyName ?? "").trim()) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "A change staged to a new policy needs the policy's name." }));
      return;
    }

    const change = onStageChange(body, viewer);
    onSaved(change);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(change));
  } catch (err) {
    sendApiError(res, err);
  }
}

export async function handleUpdateChange(
  req: IncomingMessage,
  res: ServerResponse,
  id: number,
  onUpdateChange: StartServerOptions["onUpdateChange"],
  getChangeById: StartServerOptions["getChangeById"],
  viewer: ViewerIdentity,
  onSaved: (change: WithTargetKey) => void,
): Promise<void> {
  if (!onUpdateChange) {
    res.writeHead(501, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Updating changes isn't available from this session." }));
    return;
  }

  const existing = getChangeById?.(id);
  if (!existing) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `No staged change with id ${id}.` }));
    return;
  }
  if (!can(viewer.role, "editChange", { ownerId: existing.stagedBy, viewerId: viewer.id })) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "You can only edit changes you staged yourself, unless you're an Admin." }));
    return;
  }

  try {
    const body = JSON.parse(await readRequestBody(req)) as UpdateChangeRequestBody;
    if (body.reason === undefined && body.reviewedBy === undefined && body.policyName === undefined) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "reason, reviewedBy or policyName is required" }));
      return;
    }
    // Any value but "" marks it reviewed (see UpdateChangeRequestBody); taking a review back is always allowed.
    const reviewing = body.reviewedBy !== undefined && body.reviewedBy !== "";
    if (reviewing && existing.stagedBy === viewer.id && !can(viewer.role, "reviewOwnChange")) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "A change you staged yourself needs someone else to review it, unless you're an Admin." }));
      return;
    }

    const change = onUpdateChange(id, body, viewer);
    onSaved(change);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(change));
  } catch (err) {
    // A rule of review (see storage/changes.ts) is a refusal with its reason, not a server error.
    if (err instanceof Error && err.name === "ChangeRefused") {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
      return;
    }
    sendApiError(res, err);
  }
}

export async function handlePushChange(
  req: IncomingMessage,
  res: ServerResponse,
  id: number,
  options: StartServerOptions,
  session: WebSessionManager,
  viewer: ViewerIdentity,
  getReport: () => unknown,
  onClosed: (targetKey: string) => void,
  setReport: (report: unknown) => void,
): Promise<void> {
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (!options.onPushChange) return json(501, { error: "Pushing changes isn't available from this session." });
  if (!can(viewer.role, "push")) return json(403, { error: "Only an Admin can push a change to the tenant." });
  if (!options.getChangeById?.(id)) return json(404, { error: `No staged change with id ${id}.` });

  const writeToken = await session.getWriteToken(req.headers.cookie);
  if (!writeToken) {
    return json(403, {
      error:
        "This app registration can't write to Intune. Pushing needs the DeviceManagementConfiguration.ReadWrite.All permission (delegated, with admin consent) — see intuneatlas.com/docs. Then sign out and in again.",
    });
  }

  try {
    const result = await options.onPushChange(id, writeToken, viewer, getReport());
    // The brought-up-to-date report first: it was built from the one that still listed these changes as staged.
    if (result.report !== undefined) setReport(result.report);
    for (const change of result.closed) onClosed(change.targetKey);
    const current = getReport();
    json(200, {
      closed: result.closed.map((change) => change.targetKey),
      policyName: result.policyName,
      created: result.created,
      // The report as this viewer sees it, when the push could bring it up to date; otherwise only a scan can.
      ...(result.report !== undefined && current && options.onEvaluateForViewer ? { report: await options.onEvaluateForViewer(current, viewer) } : {}),
    });
  } catch (err) {
    // Declined before anything was written: say why, as a conflict with the state of things, not a server error.
    if (err instanceof PushRefused) return json(409, { error: err.message });
    sendApiError(res, err);
  }
}

export async function handleRevertChange(
  res: ServerResponse,
  id: number,
  onRevertChange: StartServerOptions["onRevertChange"],
  getChangeById: StartServerOptions["getChangeById"],
  viewer: ViewerIdentity,
  onReverted: (targetKey: string) => void,
): Promise<void> {
  if (!onRevertChange) {
    res.writeHead(501, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Reverting changes isn't available from this session." }));
    return;
  }

  const existing = getChangeById?.(id);
  if (!existing) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `No staged change with id ${id}.` }));
    return;
  }
  if (!can(viewer.role, "revertChange", { ownerId: existing.stagedBy, viewerId: viewer.id })) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "You can only revert changes you staged yourself, unless you're an Admin." }));
    return;
  }

  try {
    const targetKey = onRevertChange(id);
    if (targetKey) onReverted(targetKey);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ reverted: Boolean(targetKey) }));
  } catch (err) {
    sendApiError(res, err);
  }
}
