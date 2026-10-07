import { useState } from "react";
import { WarningCircle, CheckCircle, MinusCircle } from "@phosphor-icons/react";
import { DrawerShell } from "./DrawerShell.jsx";
import { Chip, SeverityChip, Diff, Differences, RefPath, HistorySection, ValueDisplay } from "./bits.jsx";
import { STATE_STYLE } from "../lib/styles.js";
import { platformLabel, refLabel } from "../lib/format.js";
import { rangeLabel } from "../lib/schema.js";
import { renderNode, nodeFromText, validateNode, normalizeNode, applyExpected } from "../lib/settingValue.js";
import { ValueEditor } from "./ValueEditor.jsx";


const SECTION_HEADING = "font-sans text-xs font-semibold uppercase tracking-wide text-stone-500";

/**
 * One baseline's position on this setting: which baseline (and which
 * policy inside it) expects what, whether the tenant's value meets it,
 * and — where the baseline's annotations say — how much it matters and
 * why. Shown for every baseline that covers the setting, passing ones
 * too. Several can coexist, and can disagree with each other.
 */
const COMPARE_SUFFIX = { exact: "", atMost: " or less", atLeast: " or more" };

function BaselineCheckCard({ check, canUse, isSelected, onUse, onStageNew }) {
  const failed = check.passed === false;
  // Staging this baseline's value into a policy that doesn't exist yet: named, by default, what the baseline itself calls the policy that holds the setting.
  const [naming, setNaming] = useState(false);
  const [policyName, setPolicyName] = useState(check.policyName ?? "");
  const [reason, setReason] = useState("");
  const Icon = check.passed === true ? CheckCircle : failed ? WarningCircle : MinusCircle;
  const iconTone = check.passed === true ? "text-teal-600" : failed ? "text-amber-500" : "text-stone-400";

  return (
    <li className="rounded-md border border-stone-200 p-3">
      <div className="flex items-start gap-2">
        <Icon className={"mt-0.5 h-4 w-4 shrink-0 " + iconTone} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium leading-snug text-stone-800">{check.source}</div>
          {check.policyName && (
            <div className="mt-0.5 truncate text-xs text-stone-500" title={check.policyName}>
              {check.policyName}
            </div>
          )}
        </div>
        <SeverityChip severity={check.severity} className="shrink-0" />
      </div>

      <div className="mt-2.5">
        {failed && check.differences?.length ? (
          <Differences differences={check.differences} />
        ) : (
          <>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-stone-500">Expects</span>
              {check.passed === true && <span className="text-teal-700">Satisfied</span>}
              {check.passed === null && <span className="text-stone-400">Not judged in this state</span>}
            </div>
            <div className="mt-1 rounded border border-stone-200 bg-stone-50 px-2 py-1 text-sm font-medium text-stone-700">
              <ValueDisplay value={check.expected + COMPARE_SUFFIX[check.compare ?? "exact"]} compact={check.expected.includes("\n")} />
            </div>
          </>
        )}
      </div>

      {check.alternatives?.length > 0 && (
        <div className="mt-2 text-xs text-stone-500">
          Also accepted by this baseline: {check.alternatives.map((a) => a.replace(/\n/g, ", ")).join(" · ")}
        </div>
      )}
      {check.why && <p className="mt-2 text-xs leading-relaxed text-stone-600">{check.why}</p>}
      {check.reference && <p className="mt-1 text-xs text-stone-400">{check.reference}</p>}

      {failed && (canUse || onStageNew) && !naming && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {canUse && (
            <button
              type="button"
              onClick={onUse}
              disabled={isSelected}
              className="text-xs font-medium text-teal-700 hover:underline focus:outline-none disabled:cursor-default disabled:text-teal-800 disabled:no-underline"
            >
              {isSelected ? "Filled in above" : "Use this value"}
            </button>
          )}
          {onStageNew && (
            <button type="button" onClick={() => setNaming(true)} className="text-xs font-medium text-teal-700 hover:underline focus:outline-none">
              Stage to new policy
            </button>
          )}
        </div>
      )}

      {naming && (
        <form
          className="mt-2.5 animate-fade-in"
          onSubmit={(e) => {
            e.preventDefault();
            onStageNew(policyName.trim(), reason);
            setNaming(false);
          }}
        >
          <label className="block">
            <span className="text-xs font-medium text-stone-500">New policy name</span>
            <input
              autoFocus
              type="text"
              value={policyName}
              onChange={(e) => setPolicyName(e.target.value)}
              className="mt-1 w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
            />
          </label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (optional)"
            className="mt-2 w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-xs placeholder-stone-400 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="submit"
              disabled={!policyName.trim()}
              className="rounded-md bg-teal-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700 active:scale-[0.97] focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-500 disabled:bg-stone-200 disabled:text-stone-400"
            >
              Stage change
            </button>
            <button
              type="button"
              onClick={() => setNaming(false)}
              className="rounded-md px-2.5 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-500"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

/**
 * One policy's value of this setting — the same card whether one policy
 * sets it or five, whether they agree or not: the policy, whether it's
 * assigned, and its value, edited right where it's shown (see
 * ValueEditor for the controls). There is no separate "current value" or
 * "change it" block: what the setting is set to is what its policies
 * say, so that's where it's read and changed.
 *
 * Editing doesn't touch the tenant; it reveals the reason field and a
 * "Stage change" button, and a staged change then shows in the card as
 * old -> new until it's reverted.
 *
 * `draft` is the value being edited as a node, or null when this value
 * can't be edited at all (several lines of text with no structure behind
 * them — a legacy profile, or a scan stored before structure was kept).
 */
function PolicyValueCard({ source, schemas, inConflict, canStage, change, canRevert, draft, setDraft, onReset, onStage, onRevert }) {
  const [reason, setReason] = useState("");
  const editable = canStage && !change && draft !== null;
  const dirty = editable && renderNode(draft) !== source.value;
  const error = dirty ? validateNode(draft, schemas) : null;
  const alert = inConflict && source.deployed;
  const rootSchema = draft ? schemas?.[draft.definitionId] : undefined;
  const range = draft?.kind === "simple" && rootSchema?.valueType === "integer" ? rangeLabel(rootSchema) : null;

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
            <ValueEditor node={draft} schemas={schemas} onChange={setDraft} />
            {error ? (
              <p className="mt-1.5 text-xs text-red-700">{error}</p>
            ) : range ? (
              <p className="mt-1 text-xs text-stone-500">Allowed: {range}</p>
            ) : null}
            {dirty && (
              <div className="mt-2.5">
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
                    disabled={Boolean(error)}
                    className="rounded-md bg-teal-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700 active:scale-[0.97] focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-500 disabled:bg-stone-200 disabled:text-stone-400"
                  >
                    Stage change
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onReset();
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
            <ValueDisplay value={source.value} compact={source.value.includes("\n")} />
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * The setting as staged into a policy that doesn't exist yet. Sits with
 * the real policies — it is where the value will come from once the
 * policy is created — but dashed, since nothing in the tenant sets it yet.
 */
function NewPolicyCard({ change, canRevert, onRevert }) {
  return (
    <li className="animate-rise-in rounded-md border border-dashed border-teal-300 bg-teal-50 p-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-xs font-medium text-stone-700" title={change.policyName}>
          {change.policyName}
        </span>
        <span className="shrink-0 text-xs text-teal-700">New policy</span>
      </div>
      <div className="mt-2 text-sm font-medium">
        <ValueDisplay value={change.to} compact={change.to.includes("\n")} />
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-stone-500">
        <Chip className={change.ready ? "bg-teal-50 text-teal-700 ring-teal-200" : "bg-amber-50 text-amber-800 ring-amber-200"}>
          {change.ready ? "Staged · ready" : "Staged · needs review"}
        </Chip>
        {change.stagedByName && <span className="truncate">{change.stagedByName}</span>}
        {canRevert && (
          <button type="button" onClick={() => onRevert(change)} className="ml-auto shrink-0 font-medium text-stone-600 hover:underline focus:outline-none">
            Revert
          </button>
        )}
      </div>
      {change.reason && <p className="mt-1.5 text-xs leading-relaxed text-stone-600">{change.reason}</p>}
    </li>
  );
}

/** The node a policy card starts editing from: the scanned structure, or the plain text as one field. */
function initialDraft(source) {
  return source.structured ?? nodeFromText(source.value);
}

/**
 * Reads top to bottom as: what the setting is (name, state, reference
 * path, all in the header) -> which policies set it, each with its value
 * editable in place -> what the baselines expect -> notes. The sections are the same for every setting; only what's inside
 * them differs. The state itself is the chip in the header — nothing
 * here restates it in a sentence.
 */
function SettingDrawer({ entry, notes, onAddNote, onDeleteNote, onClose, changes, onStage, onStageNew, onRevert, viewer }) {
  const recs = entry.recs;
  const checks = entry.checks ?? [];
  const schemas = entry.schemas;
  const canNote = viewer?.role === "contributor" || viewer?.role === "admin";
  const canStage = viewer?.role === "contributor" || viewer?.role === "admin";
  const canRevert = (change) => viewer?.role === "admin" || (viewer?.role === "contributor" && change.stagedBy === viewer?.id);

  // One draft per policy card, each starting on that policy's actual value.
  const [drafts, setDrafts] = useState(() => entry.sources.map(initialDraft));
  const setDraft = (n, value) => setDrafts((d) => d.map((v, i) => (i === n ? value : v)));

  // A change staged before changes were per-policy targets the setting as
  // a whole; it's shown on the first policy.
  const existingChanges = changes.filter((c) => c.targetKind !== "new");
  const changeFor = (source, n) =>
    existingChanges.find((c) => c.policyId === source.policyId) ?? (n === 0 ? existingChanges.find((c) => !c.policyId) : undefined);
  // The setting as staged into policies that don't exist yet — any number of them, one per policy name.
  const newPolicyChanges = changes.filter((c) => c.targetKind === "new");

  // The policy cards a baseline's value can be filled into: the ones that
  // reach devices, can be edited, and have nothing staged.
  const fillable = entry.sources
    .map((source, n) => ({ source, n }))
    .filter(({ source, n }) => canStage && source.deployed && drafts[n] !== null && !changeFor(source, n));

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
      detail={entry.cspPath ? <RefPath value={entry.cspPath} label={refLabel(entry.platform)} /> : null}
    >
      <section>
        <h3 className={SECTION_HEADING}>
          Policies {entry.sources.length ? <span className="tabular-nums text-stone-400">· {entry.sources.length}</span> : null}
        </h3>
        {entry.sources.length === 0 && newPolicyChanges.length === 0 ? (
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
                  schemas={schemas}
                  inConflict={entry.conflict}
                  canStage={canStage}
                  change={change}
                  canRevert={change ? canRevert(change) : false}
                  draft={drafts[n]}
                  setDraft={(value) => setDraft(n, value)}
                  onReset={() => setDraft(n, initialDraft(source))}
                  onStage={(draft, reason) => {
                    const node = normalizeNode(draft, schemas);
                    const to = renderNode(node);
                    onStage(source, {
                      to,
                      // Only a value that came with structure has one worth keeping.
                      ...(source.structured ? { toStructured: node } : {}),
                      from: source.value,
                      reason,
                      ruleId: recs.find((r) => r.recommended.trim().toLowerCase() === to.trim().toLowerCase())?.ruleId ?? "manual",
                    });
                  }}
                  onRevert={onRevert}
                />
              );
            })}
            {newPolicyChanges.map((change) => (
              <NewPolicyCard key={change.id} change={change} canRevert={canRevert(change)} onRevert={onRevert} />
            ))}
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
              // Only cards whose value actually came with structure can take a baseline's structured value.
              const fills = fillable
                .filter(({ source }) => source.structured)
                .map(({ n }) => ({ n, next: applyExpected(drafts[n], check.expectedNode) }));
              return (
                <BaselineCheckCard
                  key={check.ruleId}
                  check={check}
                  canUse={fills.length > 0}
                  isSelected={fills.length > 0 && fills.every(({ n, next }) => renderNode(drafts[n]) === renderNode(next))}
                  onUse={() => setDrafts((d) => d.map((v, i) => fills.find(({ n }) => n === i)?.next ?? v))}
                  onStageNew={
                    canStage && onStageNew
                      ? (newPolicyName, reason) =>
                          onStageNew({
                            newPolicyName,
                            to: check.expected,
                            toStructured: check.expectedNode,
                            from: entry.values[0] ?? "Not configured",
                            reason,
                            ruleId: check.ruleId,
                          })
                      : undefined
                  }
                />
              );
            })}
          </ul>
        )}
      </section>

      <HistorySection notes={notes} onAdd={onAddNote} onDelete={onDeleteNote} readOnly={!canNote} viewer={viewer} />
    </DrawerShell>
  );
}

export { SettingDrawer };
