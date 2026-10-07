import { useState } from "react";
import { Warning, WarningCircle, CheckCircle, MinusCircle, Info } from "@phosphor-icons/react";
import { DrawerShell } from "./DrawerShell.jsx";
import { Chip, Diff, RefPath, HistorySection, ValueDisplay } from "./bits.jsx";
import { STATE_STYLE, SEVERITY_STYLE } from "../lib/styles.js";
import { platformLabel, refLabel } from "../lib/format.js";
import { rootSchema, editorKind, isSingleValue, needsSubSettings, rangeLabel, validationError, usableValue } from "../lib/schema.js";


const SECTION_HEADING = "font-sans text-xs font-semibold uppercase tracking-wide text-stone-500";

/** "A", "A and B", or "3 baselines" — for naming who has an opinion in one sentence. */
function sourceNames(checks) {
  const names = Array.from(new Set(checks.map((c) => c.source)));
  if (names.length === 1) return names[0];
  if (names.length === 2) return names[0] + " and " + names[1];
  return names.length + " baselines";
}

/** A value short enough to quote inside a sentence; long or multi-line ones are referred to instead. */
function quotable(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 40 && !value.includes("\n");
}

/**
 * The one thing the panel has to answer before anything else: what state
 * is this setting in, and why. Everything below it is supporting detail.
 */
function summarize(entry, checks, current) {
  const failing = checks.filter((c) => c.passed === false);
  const setTo = quotable(current) ? "Set to “" + current + "”" : "Its current value is set";
  const expects = (list) =>
    list.length === 1 && quotable(list[0].expected)
      ? list[0].source + " expects “" + list[0].expected + "”."
      : sourceNames(list) + (new Set(list.map((c) => c.source)).size === 1 ? " expects" : " expect") + " a different value.";

  switch (entry.state) {
    case "Conflict":
      return {
        tone: "alert",
        Icon: Warning,
        text:
          entry.sources.filter((src) => src.deployed).length +
          " assigned policies set this to different values. Devices apply whichever processes last, so the result is not predictable.",
      };
    case "Not assigned":
      return {
        tone: "neutral",
        Icon: MinusCircle,
        text: "Configured, but not reaching any device: no policy that sets it is assigned to a group.",
      };
    case "Below baseline":
      return { tone: "warn", Icon: WarningCircle, text: setTo + ", but " + expects(failing) };
    case "Meets baseline":
      return { tone: "good", Icon: CheckCircle, text: setTo + ", which satisfies " + sourceNames(checks) + "." };
    case "Missing":
      return { tone: "missing", Icon: WarningCircle, text: "No policy in this tenant configures this setting. " + expects(failing) };
    default:
      return {
        tone: "neutral",
        Icon: Info,
        text: "No active baseline has a rule for this setting, so its value hasn’t been judged.",
      };
  }
}

const SUMMARY_TONE = {
  alert: { box: "border-red-200 bg-red-50 text-red-800", icon: "text-red-600" },
  warn: { box: "border-amber-200 bg-amber-50 text-amber-900", icon: "text-amber-600" },
  good: { box: "border-teal-200 bg-teal-50 text-teal-800", icon: "text-teal-600" },
  missing: { box: "border-purple-200 bg-purple-50 text-purple-800", icon: "text-purple-600" },
  neutral: { box: "border-stone-200 bg-stone-50 text-stone-600", icon: "text-stone-400" },
};

/**
 * One baseline's rule for this setting: who expects what, whether the
 * current value satisfies it, and why the rule exists. Shown for every
 * covering rule — passing ones too — since "which baseline says what" is
 * exactly what's otherwise invisible on a setting that isn't failing.
 * Several can coexist, and can disagree with each other.
 */
function BaselineCheckCard({ check, current, canUse, isSelected, onUse }) {
  // canUse is false when the expectation isn't something that can be staged as a value.
  const failed = check.passed === false;
  const Icon = check.passed === true ? CheckCircle : failed ? WarningCircle : MinusCircle;
  const iconTone = check.passed === true ? "text-teal-600" : failed ? "text-amber-500" : "text-stone-400";

  return (
    <li className="rounded-md border border-stone-200 p-3">
      <div className="flex items-start gap-2">
        <Icon className={"mt-0.5 h-4 w-4 shrink-0 " + iconTone} />
        <span className="min-w-0 flex-1 text-sm font-medium leading-snug text-stone-800">{check.source}</span>
        <Chip className={"shrink-0 " + SEVERITY_STYLE[check.severity].chip}>{SEVERITY_STYLE[check.severity].label}</Chip>
      </div>

      <div className="mt-2.5">
        {failed ? (
          <Diff from={current} to={check.expected} />
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-xs text-stone-500">Expects</span>
            <span className="rounded border border-stone-200 bg-stone-50 px-2 py-1 font-medium text-stone-700">{check.expected}</span>
            {check.passed === true && <span className="text-xs text-teal-700">Satisfied</span>}
            {check.passed === null && <span className="text-xs text-stone-400">Not judged in this state</span>}
          </div>
        )}
      </div>

      <p className="mt-2 text-xs leading-relaxed text-stone-600">{check.why}</p>

      {failed && canUse && (
        <button
          type="button"
          onClick={onUse}
          disabled={isSelected}
          className="mt-2 text-xs font-medium text-teal-700 hover:underline focus:outline-none disabled:cursor-default disabled:text-teal-800 disabled:no-underline"
        >
          {isSelected ? "Filled in above" : "Use this value"}
        </button>
      )}
    </li>
  );
}

/** The control that edits one value, picked from what Intune's definition says the setting can hold. */
function ValueField({ schema, value, onChange, tone }) {
  const kind = editorKind(schema);
  const fieldClass =
    "w-full rounded-md border bg-white px-2.5 py-1.5 text-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600 " +
    (tone === "alert" ? "border-red-300" : "border-stone-300");

  if (kind === "choice") {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={fieldClass}>
        {/* A value Intune's definition doesn't list (an option id that never resolved) still has to be showable. */}
        {!schema.options.some((o) => o.label === value) && <option value={value}>{value}</option>}
        {schema.options.map((o) => (
          // Selectable only if it's the value already set: picking it fresh would also need its sub-settings.
          <option key={o.id} value={o.label} disabled={needsSubSettings(o) && o.label !== value}>
            {o.label}
            {needsSubSettings(o) ? " (has sub-settings)" : ""}
          </option>
        ))}
      </select>
    );
  }
  if (kind === "integer") {
    return (
      <input
        type="number"
        inputMode="numeric"
        step={1}
        min={schema.min}
        max={schema.max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={fieldClass + " tabular-nums"}
      />
    );
  }
  // A single-line input works fine for "Enabled"/"Not allowed." but not
  // for a long single string value (confirmed live: a 2,300-character
  // base64 blob) — genuinely simple (one value, not a group/collection),
  // just too long for one line.
  if (value.length > 100) {
    return <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={4} className={fieldClass + " resize-y font-mono text-xs"} />;
  }
  return <input type="text" value={value} onChange={(e) => onChange(e.target.value)} className={fieldClass} />;
}

/**
 * One policy's value of this setting — the same card whether one policy
 * sets it or five, whether they agree or not: the policy, whether it's
 * assigned, and its value, edited right where it's shown. There is no
 * separate "current value" or "change it" block: what the setting is set
 * to is what its policies say, so that's where it's read and changed.
 *
 * Changing the value doesn't touch the tenant; it reveals the reason
 * field and a "Stage change" button, and a staged change then shows in
 * the card as old -> new until it's reverted.
 */
function PolicyValueCard({ source, schema, inConflict, canStage, change, canRevert, draft, setDraft, onStage, onRevert }) {
  const [reason, setReason] = useState("");
  // Compound values (a list's items, a group's children, a choice with
  // sub-settings) mean replacing several discrete things at once, which
  // needs its own controls this doesn't have yet. Shown, not editable.
  const isCompound = !isSingleValue(schema, source.value);
  const editable = canStage && !isCompound && !change;
  const dirty = editable && draft !== source.value;
  const error = dirty && draft.trim() ? validationError(schema, draft) : null;
  const range = editorKind(schema) === "integer" ? rangeLabel(schema) : null;
  const alert = inConflict && source.deployed;

  return (
    <li className={"rounded-md border p-3 " + (alert ? "border-red-200 bg-red-50" : "border-stone-200")}>
      <div className="flex items-baseline justify-between gap-3">
        <span className={"min-w-0 truncate text-xs font-medium " + (alert ? "text-red-900" : "text-stone-700")} title={source.policyName}>
          {source.policyName}
        </span>
        <span className={"shrink-0 text-xs " + (source.deployed ? "text-stone-500" : "text-stone-400")}>
          {source.deployed ? "Assigned" : "Not assigned"}
        </span>
      </div>

      <div className="mt-2">
        {change ? (
          <>
            <Diff from={change.from} to={change.to} />
            <div className="mt-2 flex items-center gap-2 text-xs text-stone-500">
              <Chip className={change.ready ? "bg-teal-50 text-teal-700 ring-teal-200" : "bg-amber-50 text-amber-800 ring-amber-200"}>
                {change.ready ? "Staged · ready" : "Staged · needs review"}
              </Chip>
              {change.stagedByName && <span className="truncate">{change.stagedByName}</span>}
              {canRevert && (
                <button
                  type="button"
                  onClick={() => onRevert(change)}
                  className="ml-auto shrink-0 font-medium text-stone-600 hover:underline focus:outline-none"
                >
                  Revert
                </button>
              )}
            </div>
            {change.reason && <p className="mt-1.5 text-xs leading-relaxed text-stone-600">{change.reason}</p>}
          </>
        ) : editable ? (
          <>
            <ValueField schema={schema} value={draft} onChange={setDraft} tone={alert ? "alert" : "default"} />
            {error ? (
              <p className="mt-1 text-xs text-red-700">{error}</p>
            ) : range ? (
              <p className="mt-1 text-xs text-stone-500">Allowed: {range}</p>
            ) : null}
            {dirty && (
              <div className="mt-2">
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Reason (optional)"
                  className="w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-xs placeholder-stone-400 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
                />
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onStage(draft, reason)}
                    disabled={!draft.trim() || Boolean(error)}
                    className="rounded-md bg-teal-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700 active:scale-[0.97] focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-500 disabled:bg-stone-200 disabled:text-stone-400"
                  >
                    Stage change
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(source.value);
                      setReason("");
                    }}
                    className="rounded-md px-2.5 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-500"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className={"text-sm font-medium " + (alert ? "text-red-900" : "")}>
            <ValueDisplay value={source.value} compact={isCompound} />
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * Reads top to bottom as: what state is this in and why (summary) ->
 * which policies set it, each with its value editable in place -> what
 * the baselines expect -> reference path and notes. The sections are the
 * same for every setting; only what's inside them differs.
 */
function SettingDrawer({ entry, notes, onAddNote, onDeleteNote, onClose, changes, onStage, onRevert, viewer }) {
  const recs = entry.recs;
  const checks = entry.checks ?? [];
  const schema = rootSchema(entry);
  const canNote = viewer?.role === "contributor" || viewer?.role === "admin";
  const canStage = viewer?.role === "contributor" || viewer?.role === "admin";
  const canRevert = (change) => viewer?.role === "admin" || (viewer?.role === "contributor" && change.stagedBy === viewer?.id);
  // Only synthetic "Missing" entries ever have no values at all — a
  // real scanned setting always has at least one.
  const summary = summarize(entry, checks, entry.values[0]);
  const summaryTone = SUMMARY_TONE[summary.tone];

  // One draft per policy card, each starting on that policy's actual value.
  const [drafts, setDrafts] = useState(() => entry.sources.map((s) => s.value));
  const setDraft = (n, value) => setDrafts((d) => d.map((v, i) => (i === n ? value : v)));

  // A change staged before changes were per-policy targets the setting as
  // a whole; it's shown on the first policy.
  const changeFor = (source, n) =>
    changes.find((c) => c.policyId === source.policyId) ?? (n === 0 ? changes.find((c) => !c.policyId) : undefined);

  // The policies a baseline's value can be filled into: the ones that
  // reach devices, hold a single editable value, and have nothing staged.
  const fillable = entry.sources
    .map((source, n) => ({ source, n }))
    .filter(({ source, n }) => canStage && source.deployed && isSingleValue(schema, source.value) && !changeFor(source, n));

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
      <p className={"flex items-start gap-2 rounded-md border p-3 text-sm leading-relaxed " + summaryTone.box}>
        <summary.Icon className={"mt-0.5 h-4 w-4 shrink-0 " + summaryTone.icon} />
        <span>{summary.text}</span>
      </p>

      <section>
        <h3 className={SECTION_HEADING}>
          Policies {entry.sources.length ? <span className="tabular-nums text-stone-400">· {entry.sources.length}</span> : null}
        </h3>
        {entry.sources.length === 0 ? (
          <p className="mt-2 rounded-md border border-dashed border-stone-300 bg-stone-50 p-3 text-xs leading-relaxed text-stone-500">
            No policy in this tenant configures this setting.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {entry.sources.map((source, n) => {
              const change = changeFor(source, n);
              return (
                <PolicyValueCard
                  key={n}
                  source={source}
                  schema={schema}
                  inConflict={entry.conflict}
                  canStage={canStage}
                  change={change}
                  canRevert={change ? canRevert(change) : false}
                  draft={drafts[n]}
                  setDraft={(value) => setDraft(n, value)}
                  onStage={(to, reason) =>
                    onStage(source, {
                      to,
                      from: source.value,
                      reason,
                      ruleId: recs.find((r) => usableValue(schema, r.recommended) === to)?.ruleId ?? "manual",
                    })
                  }
                  onRevert={onRevert}
                />
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h3 className={SECTION_HEADING}>
          Baselines {checks.length ? <span className="tabular-nums text-stone-400">· {checks.length}</span> : null}
        </h3>
        {checks.length === 0 ? (
          <p className="mt-2 rounded-md border border-dashed border-stone-300 bg-stone-50 p-3 text-xs leading-relaxed text-stone-500">
            No active baseline has a rule for this setting.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {checks.map((check) => {
              const usable = usableValue(schema, check.expected);
              return (
                <BaselineCheckCard
                  key={check.ruleId}
                  check={check}
                  current={entry.values[0] ?? "Not configured"}
                  canUse={usable !== null && fillable.length > 0}
                  isSelected={fillable.length > 0 && fillable.every(({ n }) => drafts[n] === usable)}
                  onUse={() => setDrafts((d) => d.map((v, i) => (fillable.some(({ n }) => n === i) ? usable : v)))}
                />
              );
            })}
          </ul>
        )}
      </section>

      {entry.cspPath && <RefPath value={entry.cspPath} label={refLabel(entry.platform)} />}

      <HistorySection notes={notes} onAdd={onAddNote} onDelete={onDeleteNote} readOnly={!canNote} viewer={viewer} />
    </DrawerShell>
  );
}

export { SettingDrawer };
