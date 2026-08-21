import { useState } from "react";
import { ArrowCounterClockwise, Check, Clock, PaperPlaneTilt } from "@phosphor-icons/react";
import { Chip, Diff } from "../components/bits.jsx";

function ChangeCard({ change, onUpdateField, onRevert, viewer }) {
  const [reason, setReason] = useState(change.reason);
  const reviewedByMe = change.reviewedBy === viewer.name;

  return (
    <li className="rounded-lg border border-stone-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Chip className={change.ready ? "bg-teal-50 text-teal-700 ring-teal-200" : "bg-amber-50 text-amber-800 ring-amber-200"}>
              {change.ready ? "Ready" : "Needs review"}
            </Chip>
          </div>
          <h3 className="mt-2 text-sm font-medium">{change.targetName}</h3>
        </div>
        <button
          onClick={() => onRevert(change.id, change.targetKey)}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-stone-600 ring-1 ring-inset ring-stone-300 hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
        >
          <ArrowCounterClockwise className="h-3.5 w-3.5" />
          Revert
        </button>
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
            placeholder="Why is this change needed?"
            className="mt-1 w-full resize-none rounded-md border border-stone-300 bg-white p-2 text-xs placeholder-stone-400 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
          />
        </label>
        <div>
          <span className="text-xs font-medium text-stone-500">Reviewed by</span>
          <button
            type="button"
            onClick={() => onUpdateField(change.id, "reviewedBy", viewer.name)}
            disabled={reviewedByMe}
            className={
              "mt-1 flex w-full items-center justify-center gap-1.5 rounded-md p-2 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 " +
              (reviewedByMe
                ? "cursor-default bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-200"
                : "bg-stone-100 text-stone-700 hover:bg-stone-200")
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

function ChangeLog({ changes, onUpdateField, onRevert, viewer }) {
  const list = Object.values(changes).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  const ready = list.filter((c) => c.ready).length;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Change log</h1>
          <p className="mt-1 text-sm text-stone-500">
            {list.length === 0
              ? "Nothing staged yet. Apply a recommendation and it lands here for review."
              : ready + " of " + list.length + " ready. Reason and a reviewer are required before deploying."}
          </p>
        </div>
        <button
          disabled
          title="Deploying to the tenant needs write-back, which isn't built yet."
          className="inline-flex cursor-not-allowed items-center gap-2 rounded-md bg-stone-200 px-3.5 py-2 text-sm font-medium text-stone-400"
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
            Open a recommendation and click "Stage this change" — it'll show up here for review.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {list.map((c) => (
            <ChangeCard key={c.id} change={c} onUpdateField={onUpdateField} onRevert={onRevert} viewer={viewer} />
          ))}
        </ul>
      )}
    </div>
  );
}

export { ChangeLog };
