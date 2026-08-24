import { useState } from "react";
import { Warning, WarningCircle, CheckCircle, PencilSimple } from "@phosphor-icons/react";
import { DrawerShell } from "./DrawerShell.jsx";
import { Chip, RefPath, HistorySection, ValueDisplay, SourceRow } from "./bits.jsx";
import { STATE_STYLE, SEVERITY_STYLE } from "../lib/styles.js";
import { platformLabel, refLabel } from "../lib/format.js";

/** One baseline's opinion on this setting — several of these can coexist, possibly disagreeing. */
function RecommendationCard({ rec, isSelected, onUse }) {
  return (
    <div className={"rounded-md border p-2.5 " + (isSelected ? "border-teal-300 bg-teal-50" : "border-stone-200")}>
      <div className="flex items-center gap-2">
        <WarningCircle className="h-4 w-4 shrink-0 text-amber-500" />
        <span className="text-xs font-medium text-stone-500">{rec.source}</span>
        <Chip className={"ml-auto " + SEVERITY_STYLE[rec.severity].chip}>{SEVERITY_STYLE[rec.severity].label}</Chip>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-stone-600">{rec.why}</p>
      <button
        type="button"
        onClick={onUse}
        disabled={isSelected}
        className="mt-1.5 text-xs font-medium text-teal-700 hover:underline focus:outline-none disabled:cursor-default disabled:text-teal-800 disabled:no-underline"
      >
        {isSelected ? `Using this value (${rec.recommended})` : `Use this value (${rec.recommended})`}
      </button>
    </div>
  );
}

/**
 * Stage any new value, not just a baseline's recommended one — the
 * server never required a real rule id behind a staged change (only
 * that one be present at all), so this was always a frontend-only
 * restriction. A setting can have zero, one, or several recommendations
 * — different baselines (Microsoft's, a CIS benchmark, a house rules
 * pack, ...) can each have their own opinion, and even disagree with
 * each other — so this shows all of them and lets you pick, or type
 * something else entirely. Which rule (if any) the staged change
 * traces back to is derived from whether the current field value
 * matches one of them, not tracked separately — free-typing over a
 * picked recommendation correctly falls back to "manual".
 */
function EditValueSection({ current, recs, onStage }) {
  const [value, setValue] = useState(recs[0]?.recommended ?? current);
  const [reason, setReason] = useState("");
  // A single-line input works fine for "Enabled"/"Not allowed." but not
  // for a long single string value (confirmed live: a 2,300-character
  // base64 blob) — genuinely simple (one value, not a group/collection),
  // just too long for one line.
  const isLong = current.length > 100 || value.length > 100;
  const matchedRuleId = recs.find((r) => r.recommended === value)?.ruleId ?? "manual";

  return (
    <section className="rounded-md border border-stone-200 p-3">
      {recs.length > 0 && (
        <div className="space-y-2">
          {recs.map((rec) => (
            <RecommendationCard
              key={rec.ruleId}
              rec={rec}
              isSelected={value === rec.recommended}
              onUse={() => setValue(rec.recommended)}
            />
          ))}
        </div>
      )}

      <label className={"block " + (recs.length > 0 ? "mt-3" : "")}>
        <span className="text-xs font-medium text-stone-500">{recs.length > 0 ? "Value to stage" : "New value"}</span>
        {isLong ? (
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={4}
            className="mt-1 w-full resize-y rounded-md border border-stone-300 bg-white p-2.5 font-mono text-xs focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
          />
        ) : (
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="mt-1 w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
          />
        )}
      </label>

      <label className="mt-3 block">
        <span className="text-xs font-medium text-stone-500">Reason (optional)</span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder="Why is this change needed?"
          className="mt-1 w-full resize-none rounded-md border border-stone-300 bg-white p-2 text-xs placeholder-stone-400 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
        />
      </label>

      <button
        onClick={() => onStage(value, matchedRuleId, current, reason)}
        disabled={!value.trim() || value === current}
        className="mt-3 rounded-md bg-teal-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700 focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-500 disabled:bg-stone-200 disabled:text-stone-400"
      >
        Stage this change
      </button>
      <p className="mt-2 text-xs text-stone-400">
        Staging doesn't touch the tenant — it just queues this for review. Deploying needs write-back, which isn't built yet.
      </p>
    </section>
  );
}

function SettingDrawer({ entry, notes, onAddNote, onDeleteNote, onClose, change, onStage, onRevert, viewer }) {
  const recs = entry.recs;
  const canNote = viewer?.role === "contributor" || viewer?.role === "admin";
  const canStage = viewer?.role === "contributor" || viewer?.role === "admin";
  const canRevertThis = viewer?.role === "admin" || (viewer?.role === "contributor" && change?.stagedBy === viewer?.id);
  // Compound values (a group's children, a collection's items, a
  // dependent choice's child) are newline-joined — editing those means
  // replacing several discrete things at once, which needs its own UI
  // this doesn't have yet. Simple/choice settings only, for now.
  const isSimpleValue = !entry.values.some((v) => v.includes("\n"));
  const current = entry.values[0] ?? "";

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
            <ul className="mt-3 space-y-2">
              {entry.sources.map((s, n) => (
                <li key={n} className="text-xs">
                  <SourceRow policyName={s.policyName} value={s.value} tone="alert" />
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="mt-2 rounded-md border border-stone-200 p-3">
            {entry.values.length > 1 ? (
              <ul className="space-y-2">
                {entry.values.map((v, n) => (
                  <li key={n} className="text-sm font-medium">
                    <ValueDisplay value={v} />
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-sm font-medium">
                <ValueDisplay value={entry.values[0] ?? ""} />
              </div>
            )}
            {entry.state === "Not deployed" && (
              <p className="mt-1 text-xs text-stone-500">
                Configured but not reaching any device, because the policy holding it has no group assigned.
              </p>
            )}
          </div>
        )}
      </section>

      {entry.cspPath && <RefPath value={entry.cspPath} label={refLabel(entry.platform)} />}

      {!change && isSimpleValue && canStage && <EditValueSection current={current} recs={recs} onStage={onStage} />}

      {!change && isSimpleValue && !canStage && (
        <p className="flex items-start gap-2 rounded-md border border-stone-200 bg-stone-50 p-3 text-xs leading-relaxed text-stone-600">
          <PencilSimple className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" />
          {recs.length > 0 ? "Differs from the baseline. Ask a Contributor or Admin to change it." : "Ask a Contributor or Admin to change this."}
        </p>
      )}

      {!change && !isSimpleValue && (
        <p className="flex items-start gap-2 rounded-md border border-stone-200 bg-stone-50 p-3 text-xs leading-relaxed text-stone-600">
          <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" />
          {recs.length > 0
            ? "Differs from the baseline, but this is a compound setting (several values at once) — editing those isn't supported yet."
            : "Compound setting — editing isn't supported yet."}
        </p>
      )}

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Set by</h3>
        <ul className="mt-2 space-y-2">
          {entry.sources.map((s, n) => (
            <li key={n} className="rounded-md border border-stone-200 p-3">
              <SourceRow policyName={s.policyName} value={s.value} />
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

      <HistorySection
        notes={notes}
        onAdd={onAddNote}
        onDelete={onDeleteNote}
        readOnly={!canNote}
        viewer={viewer}
        change={change}
        onRevertChange={onRevert}
        canRevertChange={canRevertThis}
      />
    </DrawerShell>
  );
}

export { SettingDrawer };
