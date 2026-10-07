import { useState } from "react";
import { Warning, WarningCircle, CheckCircle, MinusCircle, Info, PencilSimple } from "@phosphor-icons/react";
import { DrawerShell } from "./DrawerShell.jsx";
import { Chip, Diff, RefPath, HistorySection, ValueDisplay, SourceRow } from "./bits.jsx";
import { STATE_STYLE, SEVERITY_STYLE } from "../lib/styles.js";
import { platformLabel, refLabel } from "../lib/format.js";
import { rootSchema, editorKind, rangeLabel, validationError, usableValue } from "../lib/schema.js";

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
          {isSelected ? "Using this value below" : "Use this value"}
        </button>
      )}
    </li>
  );
}

/**
 * Stage any new value, not just a baseline's recommended one — the
 * server never required a real rule id behind a staged change (only
 * that one be present at all), so this was always a frontend-only
 * restriction. The value itself lives in the drawer (not here) so a
 * baseline card's "Use this value" can fill it in. Which rule (if any)
 * the staged change traces back to is derived from whether the current
 * field value matches a failing rule's expectation, not tracked
 * separately — free-typing over a picked one correctly falls back to
 * "manual".
 */
function ChangeValueSection({ current, value, setValue, recs, schema, onStage }) {
  const [reason, setReason] = useState("");
  const kind = editorKind(schema);
  // A single-line input works fine for "Enabled"/"Not allowed." but not
  // for a long single string value (confirmed live: a 2,300-character
  // base64 blob) — genuinely simple (one value, not a group/collection),
  // just too long for one line.
  const isLong = current.length > 100 || value.length > 100;
  const matchedRuleId = recs.find((r) => usableValue(schema, r.recommended) === value)?.ruleId ?? "manual";
  const error = value.trim() && value !== current ? validationError(schema, value) : null;
  const range = kind === "integer" ? rangeLabel(schema) : null;
  const fieldClass =
    "mt-1 w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600";

  return (
    <section>
      <h3 className={SECTION_HEADING}>Change it</h3>
      <div className="mt-2 rounded-md border border-stone-200 p-3">
        <label className="block">
          <span className="text-xs font-medium text-stone-500">New value</span>
          {kind === "choice" ? (
            <select value={value} onChange={(e) => setValue(e.target.value)} className={fieldClass}>
              {/* A current value Intune's definition doesn't list (an option id that never resolved) still has to be showable. */}
              {!schema.options.some((o) => o.label === value) && <option value={value}>{value}</option>}
              {schema.options.map((o) => (
                <option key={o.id} value={o.label}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : kind === "integer" ? (
            <input
              type="number"
              inputMode="numeric"
              step={1}
              min={schema.min}
              max={schema.max}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className={fieldClass + " tabular-nums"}
            />
          ) : isLong ? (
            <textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              rows={4}
              className="mt-1 w-full resize-y rounded-md border border-stone-300 bg-white p-2.5 font-mono text-xs focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
            />
          ) : (
            <input type="text" value={value} onChange={(e) => setValue(e.target.value)} className={fieldClass} />
          )}
        </label>
        {error ? (
          <p className="mt-1 text-xs text-red-700">{error}</p>
        ) : range ? (
          <p className="mt-1 text-xs text-stone-500">Allowed: {range}</p>
        ) : null}

        <label className="mt-3 block">
          <span className="text-xs font-medium text-stone-500">Reason (optional)</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="Why?"
            className="mt-1 w-full resize-none rounded-md border border-stone-300 bg-white p-2 text-xs placeholder-stone-400 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
          />
        </label>

        <button
          onClick={() => onStage(value, matchedRuleId, current, reason)}
          disabled={!value.trim() || value === current || Boolean(error)}
          className="mt-3 rounded-md bg-teal-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700 active:scale-[0.97] focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-500 disabled:bg-stone-200 disabled:text-stone-400"
        >
          Stage this change
        </button>
      </div>
    </section>
  );
}

/**
 * What Intune's definition allows this setting to be, shown right under
 * its current value: every option of a choice (the current one marked),
 * or a number's range.
 */
function AllowedValues({ schema, current }) {
  const kind = editorKind(schema);
  if (kind === "choice") {
    return (
      <div className="mt-3">
        <div className="text-xs font-medium text-stone-500">Options</div>
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {schema.options.map((o) => {
            const isCurrent = o.label === current;
            return (
              <li
                key={o.id}
                title={o.description || undefined}
                className={
                  "rounded border px-2 py-0.5 text-xs " +
                  (isCurrent ? "border-stone-400 bg-stone-100 font-medium text-stone-800" : "border-stone-200 text-stone-500")
                }
              >
                {o.label}
              </li>
            );
          })}
        </ul>
      </div>
    );
  }
  const range = kind === "integer" ? rangeLabel(schema) : null;
  if (!range) return null;
  return <div className="mt-3 text-xs text-stone-500">Allowed: whole number, {range}</div>;
}

/**
 * Reads top to bottom as: what state is this in and why (summary) ->
 * what is it set to and by which policies -> what do the baselines
 * expect -> change it -> reference path and history.
 */
function SettingDrawer({ entry, notes, onAddNote, onDeleteNote, onClose, change, onStage, onRevert, viewer }) {
  const recs = entry.recs;
  const checks = entry.checks ?? [];
  const canNote = viewer?.role === "contributor" || viewer?.role === "admin";
  const canStage = viewer?.role === "contributor" || viewer?.role === "admin";
  const canRevertThis = viewer?.role === "admin" || (viewer?.role === "contributor" && change?.stagedBy === viewer?.id);
  // Compound values (a group's children, a collection's items, a
  // dependent choice's child) are newline-joined — editing those means
  // replacing several discrete things at once, which needs its own UI
  // this doesn't have yet. Simple/choice settings only, for now.
  const isSimpleValue = !entry.values.some((v) => v.includes("\n"));
  // Only synthetic "Missing" entries ever have no values at all — a
  // real scanned setting always has at least one. "Not configured" reads
  // sensibly wherever this ends up displayed (e.g. a staged change's
  // Diff), instead of an empty string.
  const current = entry.values[0] ?? "Not configured";
  const canEdit = !change && isSimpleValue && canStage;
  const schema = rootSchema(entry);
  // Starts on the first failing baseline's expectation when that's a value
  // the setting can actually take, otherwise on what it's set to now.
  const [draft, setDraft] = useState((recs[0] && usableValue(schema, recs[0].recommended)) ?? current);
  const summary = summarize(entry, checks, entry.values[0]);
  const summaryTone = SUMMARY_TONE[summary.tone];

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
        <h3 className={SECTION_HEADING}>Current value</h3>
        {entry.state === "Missing" ? (
          <p className="mt-2 rounded-md border border-dashed border-stone-300 bg-stone-50 p-3 text-sm text-stone-500">Not configured</p>
        ) : (
          <>
            {!entry.conflict && (
              <div className="mt-2 rounded-md border border-stone-200 p-3 text-sm font-medium">
                <ValueDisplay value={entry.values[0] ?? ""} />
              </div>
            )}
            {schema && isSimpleValue && <AllowedValues schema={schema} current={entry.conflict ? null : entry.values[0]} />}
            <div className="mt-3 text-xs font-medium text-stone-500">
              Set by {entry.sources.length === 1 ? "1 policy" : entry.sources.length + " policies"}
            </div>
            <ul className="mt-1.5 space-y-1.5">
              {entry.sources.map((s, n) => (
                <li
                  key={n}
                  className={"rounded-md border p-2.5 " + (entry.conflict && s.deployed ? "border-red-200 bg-red-50" : "border-stone-200")}
                >
                  {/* With a single source its value is the one shown above — repeating it adds nothing. */}
                  {entry.sources.length === 1 ? (
                    <div className="truncate text-xs">{s.policyName}</div>
                  ) : (
                    <SourceRow policyName={s.policyName} value={s.value} tone={entry.conflict && s.deployed ? "alert" : "default"} />
                  )}
                  <div className={"mt-1 text-xs " + (s.deployed ? "text-stone-500" : "text-stone-400")}>
                    {s.deployed ? "Assigned" : "Not assigned to any group"}
                  </div>
                </li>
              ))}
            </ul>
          </>
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
            {checks.map((check) => (
              <BaselineCheckCard
                key={check.ruleId}
                check={check}
                current={current}
                canUse={canEdit && usableValue(schema, check.expected) !== null}
                isSelected={draft === usableValue(schema, check.expected)}
                onUse={() => setDraft(usableValue(schema, check.expected))}
              />
            ))}
          </ul>
        )}
      </section>

      {canEdit && <ChangeValueSection current={current} value={draft} setValue={setDraft} recs={recs} schema={schema} onStage={onStage} />}

      {change && (
        <p className="flex items-start gap-2 rounded-md border border-stone-200 bg-stone-50 p-3 text-xs leading-relaxed text-stone-600">
          <PencilSimple className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" />A change to this setting is already staged — see History below.
        </p>
      )}

      {!change && isSimpleValue && !canStage && (
        <p className="flex items-start gap-2 rounded-md border border-stone-200 bg-stone-50 p-3 text-xs leading-relaxed text-stone-600">
          <PencilSimple className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" />
          Ask a Contributor or Admin to change this.
        </p>
      )}

      {!change && !isSimpleValue && (
        <p className="flex items-start gap-2 rounded-md border border-stone-200 bg-stone-50 p-3 text-xs leading-relaxed text-stone-600">
          <PencilSimple className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" />
          Compound setting (several values at once) — editing those isn’t supported yet.
        </p>
      )}

      {entry.cspPath && <RefPath value={entry.cspPath} label={refLabel(entry.platform)} />}

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
