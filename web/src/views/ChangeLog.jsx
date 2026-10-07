import { useState } from "react";
import { ArrowCounterClockwise, Check, Clock, PaperPlaneTilt, PencilSimple } from "@phosphor-icons/react";
import { Chip, Diff } from "../components/bits.jsx";

function ChangeCard({ change, onUpdateField, onRevert, viewer, inGroup = false, onOpen }) {
  const [reason, setReason] = useState(change.reason);
  const reviewedByMe = change.reviewedBy === viewer.name;
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
            placeholder="Why is this change needed?"
            className="mt-1 w-full resize-none rounded-md border border-stone-300 bg-white p-2 text-xs placeholder-stone-400 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600 disabled:bg-stone-50 disabled:text-stone-400"
          />
        </label>
        <div>
          <span className="text-xs font-medium text-stone-500">Reviewed by</span>
          <button
            type="button"
            onClick={() => onUpdateField(change.id, "reviewedBy", viewer.name)}
            disabled={reviewedByMe || !canEdit}
            className={
              "mt-1 flex w-full items-center justify-center gap-1.5 rounded-md p-2 text-xs font-medium focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-500 " +
              (reviewedByMe
                ? "cursor-default bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-200"
                : canEdit
                  ? "bg-stone-100 text-stone-700 hover:bg-stone-200"
                  : "bg-stone-50 text-stone-300")
            }
          >
            <Check className="h-3.5 w-3.5" />
            {reviewedByMe ? `Reviewed by ${viewer.name}` : `Mark reviewed by ${viewer.name}`}
          </button>
        </div>
      </div>
    </li>
  );
}

/**
 * Every setting staged into the same not-yet-existing policy, under that
 * policy's name — together they are the policy to be created. Renaming it
 * renames it for all of them.
 */
function NewPolicyGroup({ name, changes, onUpdateField, onRevert, viewer, openerFor }) {
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
    </section>
  );
}

function ChangeLog({ changes, onUpdateField, onRevert, viewer, onOpen, canOpen }) {
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
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Change log</h1>
          <p className="mt-1 text-sm text-stone-500">
            {list.length === 0
              ? "Nothing staged yet. Change a setting's value and it lands here for review."
              : ready + " of " + list.length + " ready. Reason and a reviewer are required before deploying."}
          </p>
        </div>
        <button
          disabled
          title="Deploying to the tenant needs write-back, which isn't built yet."
          className="inline-flex items-center gap-2 rounded-md bg-stone-200 px-3.5 py-2 text-sm font-medium text-stone-400"
        >
          <PaperPlaneTilt className="h-4 w-4" />
          Deploy
        </button>
      </header>

      {list.length === 0 ? (
        <div className="rounded-lg border border-dashed border-stone-300 bg-white px-4 py-16 text-center">
          <Clock className="mx-auto h-6 w-6 text-stone-400" />
          <p className="mt-3 text-sm font-medium">Nothing staged</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-stone-500">
            Open a setting and click "Stage this change" — it'll show up here for review.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {newPolicies.map(([name, changes]) => (
            <NewPolicyGroup key={name} name={name} changes={changes} onUpdateField={onUpdateField} onRevert={onRevert} viewer={viewer} openerFor={openerFor} />
          ))}
          {toExisting.length > 0 && (
            <section>
              {newPolicies.length > 0 && <h2 className="font-heading text-sm font-semibold">Changes to existing policies</h2>}
              <ul className={"space-y-3 " + (newPolicies.length > 0 ? "mt-3" : "")}>
                {toExisting.map((c) => (
                  <ChangeCard key={c.id} change={c} onUpdateField={onUpdateField} onRevert={onRevert} viewer={viewer} onOpen={openerFor(c)} />
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
