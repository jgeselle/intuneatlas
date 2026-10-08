import { useEffect, useRef, useState } from "react";
import { WarningCircle, CheckCircle, MinusCircle } from "@phosphor-icons/react";
import { DrawerShell } from "./DrawerShell.jsx";
import { Chip, SeverityChip, Differences, RefPath, HistorySection, ValueDisplay, Empty } from "./bits.jsx";
import { STATE_STYLE } from "../lib/styles.js";
import { platformLabel, refLabel, isComplianceSetting } from "../lib/format.js";
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

function BaselineCheckCard({ check, canUse, isSelected, onUse, onStageNew, newPolicyPending }) {
  const failed = check.passed === false;
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

      {failed && (canUse || onStageNew) && (
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
          {/* Puts a new policy, holding this baseline's value, among the policies above — named, reasoned and staged there. */}
          {onStageNew && (
            <button
              type="button"
              onClick={onStageNew}
              disabled={newPolicyPending}
              className="text-xs font-medium text-teal-700 hover:underline focus:outline-none disabled:cursor-default disabled:text-teal-800 disabled:no-underline"
            >
              {newPolicyPending ? "Added above" : "Stage to new policy"}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * One policy's value of this setting — the same card whether one policy
 * sets it or five, whether they agree or not, and whether the policy
 * exists yet: its name, who it's assigned to (or that it is a new policy),
 * and its value, edited right where it's shown (see ValueEditor for the
 * controls). There is no separate "current value" or "change it" block:
 * what the setting is set to is what its policies say, so that's where
 * it's read and changed.
 *
 * Editing doesn't touch the tenant; it reveals the reason field and a
 * "Stage change" button. Once something is staged the card keeps showing
 * the editor — now on the staged value, which can be edited and staged
 * again — with what the tenant actually has noted underneath and a link
 * to revert.
 *
 * A new policy starts the same way, one step earlier: a card with a name
 * field (`nameField`) holding the value it was created with, not staged
 * until "Stage change" is clicked here like on any other card.
 *
 * `draft` is the value being edited as a node, or null when this value
 * can't be edited at all (several lines of text with no structure behind
 * them — a legacy profile, or a scan stored before structure was kept).
 * `settled` is the text the draft counts as unchanged against: the
 * tenant's value, or the staged one while there is a staged change.
 */
function PolicyValueCard({ title, nameField, subtitle, isNew = false, alert = false, settled, tenantValue, schemas, canStage, change, canRevert, draft, setDraft, onReset, onStage, onRevert }) {
  const [reason, setReason] = useState(change?.reason ?? "");
  const editable = canStage && draft !== null;
  // A policy that isn't staged yet (it has a name field instead of a name) is unsaved by definition.
  const dirty = editable && (Boolean(nameField) || renderNode(draft) !== settled);
  const error = dirty ? (nameField && !nameField.value.trim() ? "Give the policy a name." : validateNode(draft, schemas)) : null;
  const cardRef = useRef(null);
  // A card that has just been added by a link further down the panel is brought into view.
  useEffect(() => {
    if (nameField) cardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);
  const rootSchema = draft ? schemas?.[draft.definitionId] : undefined;
  const range = draft?.kind === "simple" && rootSchema?.valueType === "integer" ? rangeLabel(rootSchema) : null;

  return (
    <li
      ref={cardRef}
      className={
        "rounded-md border p-3 " +
        // Dashed: nothing in the tenant sets this yet.
        (isNew ? "animate-rise-in border-dashed border-teal-300 bg-teal-50" : alert ? "border-red-200 bg-red-50" : "border-stone-200")
      }
    >
      {nameField ? (
        <input
          type="text"
          value={nameField.value}
          onChange={(e) => nameField.onChange(e.target.value)}
          aria-label="New policy name"
          placeholder="New policy name"
          className="w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-700 placeholder-stone-400 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
        />
      ) : (
        <div className={"truncate text-xs font-medium " + (alert ? "text-red-900" : "text-stone-700")} title={title}>
          {title}
        </div>
      )}
      <div className={(nameField ? "mt-1 " : "mt-0.5 ") + "break-words text-xs " + (isNew ? "text-teal-700" : "text-stone-500")}>{subtitle}</div>

      <div className="mt-2">
        {editable ? (
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
                    {change ? "Update staged change" : "Stage change"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onReset();
                      setReason(change?.reason ?? "");
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
            <ValueDisplay value={settled} compact={settled.includes("\n")} />
          </div>
        )}
      </div>

      {change && (
        <div className="mt-2.5 border-t border-stone-200/70 pt-2.5">
          <div className="flex items-center gap-2 text-xs text-stone-500">
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
          {/* What the tenant has while the staged value sits in the editor above — for a new policy, there is nothing to note. */}
          {tenantValue !== undefined && (
            <p className="mt-1.5 break-words text-xs text-stone-500">
              In the tenant: <span className="text-stone-700">{clipLine(tenantValue)}</span>
            </p>
          )}
          {change.reason && <p className="mt-1.5 text-xs leading-relaxed text-stone-600">{change.reason}</p>}
        </div>
      )}
    </li>
  );
}

/**
 * Who a policy is assigned to, in words: "All devices", group names, and
 * what it excludes. Group names come from the scan when it could read
 * them; otherwise the group's id stands in. A scan stored before targets
 * were kept only knows assigned-or-not.
 */
function targetsLabel(source, groups) {
  if (!source.targets) return source.deployed ? "Assigned" : "Not assigned";
  const name = (t) => (t.kind === "allDevices" ? "All devices" : t.kind === "allLicensedUsers" ? "All users" : (groups?.names?.[t.groupId] ?? t.groupId)) + (t.filtered ? " (filtered)" : "");
  const included = source.targets.filter((t) => t.kind !== "group" || !t.excluded).map(name);
  const excluded = source.targets.filter((t) => t.kind === "group" && t.excluded).map(name);
  if (included.length === 0) return "Not assigned";
  return included.join(", ") + (excluded.length ? " · except " + excluded.join(", ") : "");
}

/** A value on one line, short enough to sit in a sentence. */
function clipLine(value) {
  const line = String(value).replace(/\n/g, ", ");
  return line.length > 140 ? line.slice(0, 140) + "…" : line;
}

/** The value a staged change holds, as something the editor can open: its structure if it has one, else its text as one field. */
function stagedDraft(change) {
  return change.toStructured ?? nodeFromText(change.to);
}

/**
 * The setting as staged into a policy that doesn't exist yet. It is a
 * policy card like the others — the value stays editable, and staging
 * again under the same name updates it — only dashed, since nothing in
 * the tenant sets it yet.
 */
function NewPolicyCard({ change, schemas, canStage, canRevert, onStageNew, onRevert }) {
  const [draft, setDraft] = useState(() => stagedDraft(change));
  return (
    <PolicyValueCard
      title={change.policyName}
      subtitle="New policy"
      isNew
      settled={change.to}
      schemas={schemas}
      canStage={canStage}
      change={change}
      canRevert={canRevert}
      draft={draft}
      setDraft={setDraft}
      onReset={() => setDraft(stagedDraft(change))}
      onStage={(node, reason) => {
        const normalized = normalizeNode(node, schemas);
        onStageNew({
          newPolicyName: change.policyName,
          to: renderNode(normalized),
          ...(change.toStructured ? { toStructured: normalized } : {}),
          from: change.from,
          reason,
          ruleId: change.ruleId,
        });
      }}
      onRevert={onRevert}
    />
  );
}

/**
 * A new policy that has been put among the policies but not staged yet:
 * named, adjusted, given a reason and staged right here. "Cancel" takes
 * it away again.
 */
function PendingNewPolicyCard({ pending, schemas, onStageNew, onDiscard }) {
  const [name, setName] = useState(pending.policyName);
  const [draft, setDraft] = useState(pending.node);
  return (
    <PolicyValueCard
      nameField={{ value: name, onChange: setName }}
      subtitle="New policy · not staged yet"
      isNew
      settled=""
      schemas={schemas}
      canStage
      draft={draft}
      setDraft={setDraft}
      onReset={onDiscard}
      onStage={(node, reason) => {
        const normalized = normalizeNode(node, schemas);
        onStageNew({ newPolicyName: name.trim(), to: renderNode(normalized), toStructured: normalized, from: pending.from, reason, ruleId: pending.ruleId });
        onDiscard();
      }}
    />
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
function SettingDrawer({ entry, notes, onAddNote, onDeleteNote, onClose, changes, groups, onStage, onStageNew, onRevert, viewer }) {
  const recs = entry.recs;
  const checks = entry.checks ?? [];
  const schemas = entry.schemas;
  const canNote = viewer?.role === "contributor" || viewer?.role === "admin";
  const canStage = viewer?.role === "contributor" || viewer?.role === "admin";
  const canRevert = (change) => viewer?.role === "admin" || (viewer?.role === "contributor" && change.stagedBy === viewer?.id);

  const setDraft = (n, value) => setDrafts((d) => d.map((v, i) => (i === n ? value : v)));

  // A change staged before changes were per-policy targets the setting as
  // a whole; it's shown on the first policy.
  const existingChanges = changes.filter((c) => c.targetKind !== "new");
  const changeFor = (source, n) =>
    existingChanges.find((c) => c.policyId === source.policyId) ?? (n === 0 ? existingChanges.find((c) => !c.policyId) : undefined);
  // The setting as staged into policies that don't exist yet — any number of them, one per policy name.
  const newPolicyChanges = changes.filter((c) => c.targetKind === "new");
  // New policies added from a baseline card that haven't been staged yet — only in this panel, gone if it's closed.
  const [pendingNew, setPendingNew] = useState([]);

  // One draft per policy card: its staged value if it has one, the policy's actual value otherwise.
  const [drafts, setDrafts] = useState(() =>
    entry.sources.map((source, n) => {
      const change = changeFor(source, n);
      return change ? stagedDraft(change) : initialDraft(source);
    }),
  );

  // The policy cards a baseline's value can be filled into: the ones that reach devices and can be edited.
  const fillable = entry.sources
    .map((source, n) => ({ source, n }))
    .filter(({ source, n }) => canStage && source.deployed && drafts[n] !== null);

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
      detail={entry.cspPath ? <RefPath value={entry.cspPath} label={isComplianceSetting(entry) && !entry.definitionId.startsWith("compliance.catalog.") ? "Graph property" : refLabel(entry.platform)} /> : null}
    >
      <section>
        <h3 className={SECTION_HEADING}>
          Policies {entry.sources.length ? <span className="tabular-nums text-stone-400">· {entry.sources.length}</span> : null}
        </h3>
        {entry.sources.length === 0 && newPolicyChanges.length === 0 && pendingNew.length === 0 ? (
          <div className="mt-2">
            <Empty compact>No policy sets this</Empty>
          </div>
        ) : (
          <ul className="mt-2 space-y-2">
            {entry.sources.map((source, n) => {
              const change = changeFor(source, n);
              return (
                <PolicyValueCard
                  key={n}
                  title={source.policyName}
                  subtitle={targetsLabel(source, groups)}
                  alert={entry.conflict && source.deployed}
                  settled={change ? change.to : source.value}
                  tenantValue={change ? source.value : undefined}
                  schemas={schemas}
                  canStage={canStage}
                  change={change}
                  canRevert={change ? canRevert(change) : false}
                  draft={drafts[n]}
                  setDraft={(value) => setDraft(n, value)}
                  onReset={() => setDraft(n, change ? stagedDraft(change) : initialDraft(source))}
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
                  onRevert={(c) => {
                    // Back to what the tenant has — otherwise the card would sit there offering the reverted value as a fresh edit.
                    setDraft(n, initialDraft(source));
                    onRevert(c);
                  }}
                />
              );
            })}
            {newPolicyChanges.map((change) => (
              // Keyed on the staged value too: after an update the card starts over from what is now staged.
              <NewPolicyCard
                key={change.id + ":" + change.updatedAt}
                change={change}
                schemas={schemas}
                canStage={canStage && Boolean(onStageNew)}
                canRevert={canRevert(change)}
                onStageNew={onStageNew}
                onRevert={onRevert}
              />
            ))}
            {pendingNew.map((pending) => (
              <PendingNewPolicyCard
                key={pending.id}
                pending={pending}
                schemas={schemas}
                onStageNew={onStageNew}
                onDiscard={() => setPendingNew((list) => list.filter((x) => x.id !== pending.id))}
              />
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className={SECTION_HEADING}>
          Baselines {checks.length ? <span className="tabular-nums text-stone-400">· {checks.length}</span> : null}
        </h3>
        {checks.length === 0 ? (
          <div className="mt-2">
            <Empty compact>No active baseline covers this</Empty>
          </div>
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
                  newPolicyPending={pendingNew.some((x) => x.id === check.ruleId)}
                  onStageNew={
                    canStage && onStageNew && !entry.definitionId?.startsWith("compliance.tenant.")
                      ? () =>
                          setPendingNew((list) => [
                            ...list,
                            {
                              // One pending card per baseline: its link reads "Added above" while this exists.
                              id: check.ruleId,
                              policyName: check.policyName ?? "",
                              node: check.expectedNode,
                              from: entry.values[0] ?? "Not configured",
                              ruleId: check.ruleId,
                            },
                          ])
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
