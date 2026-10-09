import { useState } from "react";
import { ArrowCounterClockwise, Check, PaperPlaneTilt, PencilSimple } from "@phosphor-icons/react";
import { Chip, Diff, PageSubtitle, Empty } from "../components/bits.jsx";

/**
 * The step that writes to the tenant, kept deliberate: the button asks
 * once more, naming exactly what will happen, before anything is sent.
 * A refusal — the tenant value changed since staging, the app has no
 * write permission — is shown right here, in full.
 */
function PushButton({ label, confirmText, confirmLabel, onPush }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function push() {
    setBusy(true);
    setError(null);
    const problem = await onPush();
    // On success the change leaves the list, and this with it.
    if (problem) {
      setError(problem);
      setBusy(false);
      setAsking(false);
    }
  }

  return (
    <div className="mt-3 border-t border-stone-100 pt-3">
      {asking ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 text-xs text-stone-700">{confirmText}</p>
          <button
            type="button"
            onClick={push}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-teal-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700 focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-500 disabled:bg-stone-300"
          >
            <PaperPlaneTilt className="h-3.5 w-3.5" />
            {busy ? "Pushing…" : confirmLabel}
          </button>
          <button
            type="button"
            onClick={() => setAsking(false)}
            disabled={busy}
            className="rounded-md px-2.5 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-500"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setError(null);
            setAsking(true);
          }}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-teal-800 ring-1 ring-inset ring-teal-600 hover:bg-teal-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-500"
        >
          <PaperPlaneTilt className="h-3.5 w-3.5" />
          {label}
        </button>
      )}
      {error && <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-800">{error}</p>}
    </div>
  );
}

function ChangeCard({ change, onUpdateField, onRevert, onPush, viewer, inGroup = false, onOpen }) {
  const [reason, setReason] = useState(change.reason);
  // Contributors can only touch changes they staged themselves; Admins can
  // touch any — mirrors the server-side editChange/revertChange check.
  // Compared by id (Entra object ID), not display name — names aren't
  // unique or stable.
  const canEdit = viewer.role === "admin" || (viewer.role === "contributor" && change.stagedBy === viewer.id);

  return (
    <li className="animate-rise-in rounded-lg border border-stone-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Chip className={change.ready ? "bg-teal-50 text-teal-700 ring-teal-200" : "bg-amber-50 text-amber-800 ring-amber-200"}>
              {change.ready ? "Ready" : "Needs review"}
            </Chip>
            {change.stagedByName && <span className="text-xs text-stone-400">staged by {change.stagedByName}</span>}
          </div>
          <h3 className="mt-2 text-sm font-medium">
            {/* The setting's name opens its panel — where the staged value can be looked at in context and edited. */}
            {onOpen ? (
              <button
                type="button"
                onClick={onOpen}
                className="rounded text-left hover:text-teal-700 hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-500"
              >
                {change.targetName}
              </button>
            ) : (
              change.targetName
            )}
          </h3>
          {/* Inside a new policy's group the name is the group's heading already. */}
          {change.policyName && !inGroup && <div className="mt-0.5 truncate text-xs text-stone-500">{change.policyName}</div>}
        </div>
        {canEdit && (
          <button
            onClick={() => onRevert(change.id, change.targetKey)}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-stone-600 ring-1 ring-inset ring-stone-300 hover:bg-stone-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-500"
          >
            <ArrowCounterClockwise className="h-3.5 w-3.5" />
            Revert
          </button>
        )}
      </div>

      <div className="mt-3">
        <Diff from={change.from} to={change.to} />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium text-stone-500">Reason</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => reason !== change.reason && onUpdateField(change.id, "reason", reason)}
            rows={2}
            disabled={!canEdit}
            placeholder="Reason"
            className="mt-1 w-full resize-none rounded-md border border-stone-300 bg-white p-2 text-xs placeholder-stone-400 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600 disabled:bg-stone-50 disabled:text-stone-400"
          />
        </label>
        <div>
          <span className="text-xs font-medium text-stone-500">Reviewed by</span>
          {change.reviewedBy ? (
            // Reviewed — by whoever it was, not only by the person looking. "Undo" takes the review back.
            <div className="mt-1 flex items-center gap-2 rounded-md bg-teal-50 p-2 text-xs font-medium text-teal-700 ring-1 ring-inset ring-teal-200">
              <Check className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">Reviewed by {change.reviewedBy}</span>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => onUpdateField(change.id, "reviewedBy", "")}
                  className="shrink-0 font-medium text-stone-600 hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-500"
                >
                  Undo
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onUpdateField(change.id, "reviewedBy", viewer.name)}
              disabled={!canEdit}
              className={
                "mt-1 flex w-full items-center justify-center gap-1.5 rounded-md p-2 text-xs font-medium focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-500 " +
                (canEdit ? "bg-stone-100 text-stone-700 hover:bg-stone-200" : "bg-stone-50 text-stone-300")
              }
            >
              <Check className="h-3.5 w-3.5" />
              Mark reviewed by {viewer.name}
            </button>
          )}
        </div>
      </div>
      {/* A change to an existing policy is pushed on its own; one of a new policy's settings goes with the policy (see NewPolicyGroup). */}
      {!inGroup && change.ready && onPush && viewer.role === "admin" && (
        <PushButton
          label="Push to tenant"
          confirmText={
            change.toStructured?.kind === "removed" ? (
              <>
                Removes <span className="font-medium">{change.targetName}</span> from <span className="font-medium">{change.policyName || "the policy"}</span> in Intune.
              </>
            ) : (
              <>
                Writes <span className="font-medium">{change.to.split("\n").join(", ")}</span> to <span className="font-medium">{change.policyName || "the policy"}</span> in Intune.
              </>
            )
          }
          confirmLabel="Push"
          onPush={() => onPush(change)}
        />
      )}
    </li>
  );
}

/**
 * Every setting staged into the same not-yet-existing policy, under that
 * policy's name — together they are the policy to be created. Renaming it
 * renames it for all of them.
 */
function NewPolicyGroup({ name, changes, onUpdateField, onRevert, onPush, viewer, openerFor }) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(name);
  // Same rule as a single change: your own, unless you're an Admin — and a rename touches every change in the group.
  const canRename = changes.every((c) => viewer.role === "admin" || (viewer.role === "contributor" && c.stagedBy === viewer.id));

  async function save(e) {
    e.preventDefault();
    const next = draft.trim();
    if (next && next !== name) {
      for (const change of changes) await onUpdateField(change.id, "policyName", next);
    }
    setRenaming(false);
  }

  return (
    <section>
      <div className="flex flex-wrap items-center gap-2">
        <Chip className="bg-teal-50 text-teal-700 ring-teal-200">New policy</Chip>
        {renaming ? (
          <form onSubmit={save} className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
            />
            <button
              type="submit"
              disabled={!draft.trim()}
              className="rounded-md bg-teal-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700 focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-500 disabled:bg-stone-200 disabled:text-stone-400"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(name);
                setRenaming(false);
              }}
              className="rounded-md px-2.5 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-500"
            >
              Cancel
            </button>
          </form>
        ) : (
          <>
            <h2 className="min-w-0 font-heading text-sm font-semibold">{name}</h2>
            <span className="text-xs tabular-nums text-stone-400">
              {changes.length} {changes.length === 1 ? "setting" : "settings"}
            </span>
            {canRename && (
              <button
                onClick={() => setRenaming(true)}
                className="ml-auto inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-stone-600 ring-1 ring-inset ring-stone-300 hover:bg-stone-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-500"
              >
                <PencilSimple className="h-3.5 w-3.5" />
                Rename
              </button>
            )}
          </>
        )}
      </div>
      <ul className="mt-3 space-y-3">
        {changes.map((c) => (
          <ChangeCard key={c.id} change={c} onUpdateField={onUpdateField} onRevert={onRevert} viewer={viewer} inGroup onOpen={openerFor(c)} />
        ))}
      </ul>
      {/* The policy is created from all of its settings at once, so all of them have to be ready. */}
      {onPush && viewer.role === "admin" && changes.every((c) => c.ready) && (
        <PushButton
          label="Create policy in tenant"
          confirmText={
            <>
              Creates <span className="font-medium">{name}</span> in Intune with {changes.length === 1 ? "this setting" : "these " + changes.length + " settings"}. It won't be assigned to anyone.
            </>
          }
          confirmLabel="Create"
          onPush={() => onPush(changes[0])}
        />
      )}
    </section>
  );
}

function ChangeLog({ changes, onUpdateField, onRevert, onPush, viewer, onOpen, canOpen }) {
  // A change made before changes recorded their setting is keyed by the setting itself.
  const settingKeyOf = (change) => change.settingKey || change.targetKey;
  // Only where there is a setting to open: one that has since left the tenant has no panel.
  const openerFor = (change) => (onOpen && canOpen?.(settingKeyOf(change)) ? () => onOpen(settingKeyOf(change)) : undefined);
  const list = Object.values(changes).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  const ready = list.filter((c) => c.ready).length;
  const toExisting = list.filter((c) => c.targetKind !== "new");
  // Settings staged into policies that don't exist yet, grouped into those policies by name.
  const newPolicies = [];
  for (const change of list.filter((c) => c.targetKind === "new")) {
    const group = newPolicies.find(([name]) => name === change.policyName);
    if (group) group[1].push(change);
    else newPolicies.push([change.policyName, [change]]);
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">Change log</h1>
        <PageSubtitle>{list.length > 0 && ready + " of " + list.length + " ready"}</PageSubtitle>
      </header>

      {list.length === 0 ? (
        <Empty>Nothing staged</Empty>
      ) : (
        <div className="space-y-6">
          {newPolicies.map(([name, changes]) => (
            <NewPolicyGroup key={name} name={name} changes={changes} onUpdateField={onUpdateField} onRevert={onRevert} onPush={onPush} viewer={viewer} openerFor={openerFor} />
          ))}
          {toExisting.length > 0 && (
            <section>
              {newPolicies.length > 0 && <h2 className="font-heading text-sm font-semibold">Changes to existing policies</h2>}
              <ul className={"space-y-3 " + (newPolicies.length > 0 ? "mt-3" : "")}>
                {toExisting.map((c) => (
                  <ChangeCard key={c.id} change={c} onUpdateField={onUpdateField} onRevert={onRevert} onPush={onPush} viewer={viewer} onOpen={openerFor(c)} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

export { ChangeLog };
