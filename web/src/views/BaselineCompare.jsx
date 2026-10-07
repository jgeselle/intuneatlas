import { ArrowRight, X } from "@phosphor-icons/react";
import { Chip } from "../components/bits.jsx";
import { Dropdown } from "../components/Dropdown.jsx";
import { platformLabel } from "../lib/format.js";

const CHANGE_STYLE = {
  added: { label: "Added", chip: "bg-teal-50 text-teal-700 ring-teal-200" },
  removed: { label: "Removed", chip: "bg-stone-100 text-stone-600 ring-stone-300" },
  changed: { label: "Changed", chip: "bg-amber-50 text-amber-800 ring-amber-200" },
};

/** Where the tenant stands on a compared setting — judged against the second baseline (see compareBaselines.ts). */
const TENANT_STYLE = {
  meets: { label: "Meets", chip: "bg-teal-50 text-teal-700 ring-teal-200" },
  below: { label: "Below", chip: "bg-amber-50 text-amber-800 ring-amber-200" },
  missing: { label: "Missing", chip: "bg-purple-50 text-purple-700 ring-purple-200" },
  conflict: { label: "Conflict", chip: "bg-red-50 text-red-700 ring-red-200" },
  notAssigned: { label: "Not assigned", chip: "bg-stone-100 text-stone-500 ring-stone-200" },
  configured: { label: "Configured", chip: "bg-stone-100 text-stone-600 ring-stone-200" },
  notConfigured: { label: "Not configured", chip: "bg-white text-stone-400 ring-stone-200" },
};

/** One side's accepted value(s) on one line: alternatives separated by " / ", a compound value's lines by commas. */
function oneLine(values) {
  return values.map((v) => v.replace(/\n/g, ", ")).join("  /  ");
}

/**
 * What to show for each side of a changed setting. A value with
 * sub-settings is mostly the same on both sides, and two long lines that
 * only differ somewhere past the cut-off say nothing — so each side shows
 * just the lines the other doesn't have. Single values, and settings only
 * one side has, are shown whole.
 */
function sides(change) {
  if (change.from.length === 0 || change.to.length === 0) return { from: oneLine(change.from), to: oneLine(change.to) };
  const lines = (values) => Array.from(new Set(values.flatMap((v) => v.split("\n"))));
  const fromLines = lines(change.from);
  const toLines = lines(change.to);
  const onlyFrom = fromLines.filter((l) => !toLines.includes(l));
  const onlyTo = toLines.filter((l) => !fromLines.includes(l));
  // Nothing line-level differs (e.g. only which alternatives exist changed): fall back to the whole values.
  if (onlyFrom.length === 0 && onlyTo.length === 0) return { from: oneLine(change.from), to: oneLine(change.to) };
  return { from: onlyFrom.join(", "), to: onlyTo.join(", ") };
}

/**
 * The two baseline choosers that turn the settings list into a
 * comparison — shown only while the Compare button next to the search
 * box is on: pick any two — versions of one baseline or two different
 * ones, active or not — and the list below shows only the settings they
 * treat differently.
 */
function CompareBar({ packs, selection, onChange, onClose }) {
  const options = packs.map((p) => ({ value: p.path, label: p.name }));

  return (
    <div className="flex animate-fade-in flex-wrap items-center gap-2">
      <div className="w-[22rem] max-w-full">
        <Dropdown
          value={selection.from}
          options={options.filter((o) => o.value !== selection.to)}
          onChange={(from) => onChange({ ...selection, from })}
          placeholder="Baseline"
          ariaLabel="Compare from baseline"
        />
      </div>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-stone-400" />
      <div className="w-[22rem] max-w-full">
        <Dropdown
          value={selection.to}
          options={options.filter((o) => o.value !== selection.from)}
          onChange={(to) => onChange({ ...selection, to })}
          placeholder="Baseline"
          ariaLabel="Compare to baseline"
        />
      </div>
      <button
        onClick={onClose}
        aria-label="Stop comparing"
        title="Stop comparing"
        className="rounded p-1.5 text-stone-400 hover:bg-stone-200 hover:text-stone-700 focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-500"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** Added / Removed / Changed, with how many of each the comparison found. */
function ChangeFilter({ changes, value, onChange }) {
  const count = (kind) => changes.filter((c) => c.change === kind).length;
  return (
    <>
      {["All", "added", "removed", "changed"].map((kind) => (
        <button
          key={kind}
          onClick={() => onChange(kind)}
          className={
            "shrink-0 rounded-md px-3 py-1.5 text-xs font-medium focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-500 " +
            (value === kind ? "bg-stone-900 text-white" : "bg-white text-stone-600 ring-1 ring-inset ring-stone-300 hover:bg-stone-50")
          }
        >
          {kind === "All" ? "All differences" : CHANGE_STYLE[kind].label}
          <span className="ml-1.5 tabular-nums opacity-60">{kind === "All" ? changes.length : count(kind)}</span>
        </button>
      ))}
    </>
  );
}

/**
 * The settings two baselines treat differently, grouped by category like
 * the normal list: the first baseline's value struck through over the
 * second's, what kind of difference it is, and where the tenant stands on
 * it. A row opens the setting when the tenant has one to open.
 */
function CompareList({ changes, openKeyFor, onOpen }) {
  const categories = Array.from(new Set(changes.map((c) => c.category)));

  return (
    <div>
      {categories.map((category) => (
        <section key={category}>
          <h2 className="pb-2 pt-5 font-sans text-xs font-semibold uppercase tracking-wide text-stone-500">{category || "Other"}</h2>
          <ul className="space-y-2">
            {changes
              .filter((c) => c.category === category)
              .map((c) => {
                const key = openKeyFor(c);
                const Row = key ? "button" : "div";
                const shown = sides(c);
                return (
                  <li key={c.definitionId + "::" + c.platform}>
                    <Row
                      {...(key ? { onClick: () => onOpen(key) } : {})}
                      className={
                        "flex w-full items-center gap-3 rounded-lg border border-stone-200 bg-white px-4 py-3 text-left " +
                        (key ? "hover:bg-stone-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-teal-500" : "")
                      }
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{c.name}</div>
                        <div className="mt-0.5 truncate text-xs text-stone-500">
                          {platformLabel(c.platform)}
                          {c.current !== null ? " · tenant: " + c.current.replace(/\n/g, ", ") : ""}
                        </div>
                      </div>
                      <div className="hidden w-72 shrink-0 text-sm sm:block">
                        {shown.from && (
                          <div className="truncate text-stone-400 line-through decoration-stone-300" title={oneLine(c.from)}>
                            {shown.from}
                          </div>
                        )}
                        {shown.to && (
                          <div className="truncate text-stone-800" title={oneLine(c.to)}>
                            {shown.to}
                          </div>
                        )}
                      </div>
                      {/* Fixed widths, as in the normal list: chip labels vary and would otherwise shift the columns row by row. */}
                      <div className="flex w-20 shrink-0 justify-end">
                        <Chip className={CHANGE_STYLE[c.change].chip}>{CHANGE_STYLE[c.change].label}</Chip>
                      </div>
                      <div className="flex w-28 shrink-0 justify-end">
                        <Chip className={TENANT_STYLE[c.tenant].chip}>{TENANT_STYLE[c.tenant].label}</Chip>
                      </div>
                    </Row>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </div>
  );
}

export { CompareBar, ChangeFilter, CompareList };
