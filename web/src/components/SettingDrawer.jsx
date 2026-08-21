import { Warning, WarningCircle, CheckCircle, ArrowCounterClockwise } from "@phosphor-icons/react";
import { DrawerShell } from "./DrawerShell.jsx";
import { Chip, Diff, RefPath, NoteThread } from "./bits.jsx";
import { STATE_STYLE, SEVERITY_STYLE } from "../lib/styles.js";
import { platformLabel, refLabel } from "../lib/format.js";

function SettingDrawer({ entry, notes, onAddNote, onClose, change, onStage, onRevert, viewer }) {
  const rec = entry.rec;
  const canNote = viewer?.role === "contributor" || viewer?.role === "admin";
  const canStage = viewer?.role === "contributor" || viewer?.role === "admin";
  const canRevertThis = viewer?.role === "admin" || (viewer?.role === "contributor" && change?.stagedBy === viewer?.name);

  return (
    <DrawerShell
      eyebrow={entry.category}
      title={entry.name}
      onClose={onClose}
      chips={
        <>
          <Chip className={STATE_STYLE[entry.state]}>{entry.state}</Chip>
          <Chip className="bg-stone-100 text-stone-600 ring-stone-200">{platformLabel(entry.platform)}</Chip>
        </>
      }
    >
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Effective value</h3>
        {entry.conflict ? (
          <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-3">
            <div className="flex gap-2">
              <Warning className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <p className="text-xs leading-relaxed text-red-800">
                Two policies set this differently on overlapping groups. Devices apply whichever processes last, so the result is not
                predictable.
              </p>
            </div>
            <ul className="mt-3 space-y-1.5">
              {entry.sources.map((s, n) => (
                <li key={n} className="flex items-center justify-between gap-3 text-xs">
                  <span className="truncate text-red-900">{s.policyName}</span>
                  <span className="shrink-0 rounded border border-red-200 bg-white px-1.5 py-0.5 font-medium text-red-800">
                    {s.value}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="mt-2 rounded-md border border-stone-200 p-3">
            <div className="text-sm font-medium">{entry.values.join(", ")}</div>
            {entry.state === "Not deployed" && (
              <p className="mt-1 text-xs text-stone-500">
                Configured but not reaching any device, because the policy holding it has no group assigned.
              </p>
            )}
          </div>
        )}
      </section>

      {entry.cspPath && <RefPath value={entry.cspPath} label={refLabel(entry.platform)} />}

      {rec && change && (
        <section className="rounded-md border border-teal-200 bg-teal-50 p-3">
          <div className="flex items-center gap-2">
            <Chip className="bg-white text-teal-700 ring-teal-200">{change.ready ? "Ready" : "Staged"}</Chip>
            {!change.ready && <span className="text-xs text-teal-800">Needs a reason and reviewer</span>}
          </div>
          <div className="mt-3">
            <Diff from={change.from} to={change.to} />
          </div>
          <p className="mt-2 text-xs text-teal-700">Edit the reason and reviewer from the Change log tab.</p>
          {canRevertThis && (
            <button
              onClick={() => onRevert(change.id)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-stone-600 ring-1 ring-inset ring-stone-300 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
            >
              <ArrowCounterClockwise className="h-3.5 w-3.5" />
              Revert
            </button>
          )}
        </section>
      )}

      {rec && !change && canStage && (
        <section className="rounded-md border border-stone-200 p-3">
          <div className="flex items-center gap-2">
            <WarningCircle className="h-4 w-4 shrink-0 text-amber-500" />
            <h3 className="text-sm font-semibold">Recommended change</h3>
            <Chip className={"ml-auto " + SEVERITY_STYLE[rec.severity].chip}>{SEVERITY_STYLE[rec.severity].label}</Chip>
          </div>
          <div className="mt-3">
            <Diff from={rec.current} to={rec.recommended} />
          </div>
          <p className="mt-3 text-xs leading-relaxed text-stone-600">{rec.why}</p>
          <p className="mt-2 text-xs text-stone-400">Source: {rec.source}</p>
          <button
            onClick={onStage}
            className="mt-3 rounded-md bg-teal-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          >
            Stage this change
          </button>
          <p className="mt-2 text-xs text-stone-400">
            Staging doesn't touch the tenant — it just queues this for review. Deploying needs write-back, which isn't built yet.
          </p>
        </section>
      )}

      {rec && !change && !canStage && (
        <p className="flex items-start gap-2 rounded-md border border-stone-200 bg-stone-50 p-3 text-xs leading-relaxed text-stone-600">
          <WarningCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          Differs from the baseline. Ask a Contributor or Admin to stage the recommended change.
        </p>
      )}

      {!rec && !entry.conflict && (
        <p className="flex items-start gap-2 rounded-md border border-stone-200 bg-stone-50 p-3 text-xs leading-relaxed text-stone-600">
          <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" />
          Matches the baseline. Nothing to change.
        </p>
      )}

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Set by</h3>
        <ul className="mt-2 space-y-2">
          {entry.sources.map((s, n) => (
            <li key={n} className="rounded-md border border-stone-200 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 truncate text-sm font-medium">{s.policyName}</div>
                <span className="shrink-0 rounded border border-stone-200 bg-stone-50 px-1.5 py-0.5 text-xs text-stone-700">
                  {s.value}
                </span>
              </div>
              <div className="mt-2 text-xs text-stone-500">
                {s.deployed ? "Deployed" : <span className="text-stone-400">Not deployed to any group</span>}
              </div>
            </li>
          ))}
        </ul>
        {entry.sources.length > 1 && !entry.conflict && (
          <p className="mt-2 text-xs text-stone-500">
            Defined in {entry.sources.length} policies with the same value. Harmless, but worth consolidating.
          </p>
        )}
      </section>

      <NoteThread notes={notes} onAdd={onAddNote} readOnly={!canNote} />
    </DrawerShell>
  );
}

export { SettingDrawer };
