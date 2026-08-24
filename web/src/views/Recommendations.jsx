import { useState } from "react";
import { CheckCircle } from "@phosphor-icons/react";
import { Chip, Diff } from "../components/bits.jsx";
import { SEVERITY_STYLE } from "../lib/styles.js";
import { platformLabel } from "../lib/format.js";

// One row per (setting, recommendation) — a setting can have several,
// from different sources, that may even disagree with each other.
// Flattened rather than grouped so severity ranking, filtering, and
// "focus on one source" all operate on the actual recommendation, not
// on whichever one happened to be first for a given setting.
function flattenRecs(settingIndex) {
  return settingIndex.flatMap((e) => e.recs.map((rec) => ({ entry: e, rec })));
}

function Recommendations({ settingIndex, onOpen }) {
  const [severityFilter, setSeverityFilter] = useState("All");
  const [sourceFilter, setSourceFilter] = useState("All");

  const all = flattenRecs(settingIndex).sort((a, b) => SEVERITY_STYLE[a.rec.severity].rank - SEVERITY_STYLE[b.rec.severity].rank);
  const sources = ["All", ...Array.from(new Set(all.map((r) => r.rec.source)))];
  const levels = ["All", "critical", "high", "medium", "low"];

  const bySource = sourceFilter === "All" ? all : all.filter((r) => r.rec.source === sourceFilter);
  const shown = severityFilter === "All" ? bySource : bySource.filter((r) => r.rec.severity === severityFilter);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">Recommendations</h1>
        <p className="mt-1 text-sm text-stone-500">
          Settings that differ from a baseline, ranked by what they expose. A setting can show up more than once here if
          several baselines have an opinion on it. Write-back doesn't exist yet, so these are for review — nothing here
          changes the tenant.
        </p>
      </header>

      {sources.length > 2 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-stone-500">Source</span>
          {sources.map((s) => (
            <button
              key={s}
              onClick={() => setSourceFilter(s)}
              className={
                "shrink-0 rounded-md px-2.5 py-1 text-xs font-medium focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-500 " +
                (sourceFilter === s ? "bg-stone-900 text-white" : "bg-white text-stone-600 ring-1 ring-inset ring-stone-300 hover:bg-stone-50")
              }
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-1 overflow-x-auto">
        {levels.map((l) => (
          <button
            key={l}
            onClick={() => setSeverityFilter(l)}
            className={
              "shrink-0 rounded-md px-3 py-1.5 text-xs font-medium focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-500 " +
              (severityFilter === l ? "bg-stone-900 text-white" : "bg-white text-stone-600 ring-1 ring-inset ring-stone-300 hover:bg-stone-50")
            }
          >
            {l === "All" ? "All" : SEVERITY_STYLE[l].label}
            <span className="ml-1.5 tabular-nums opacity-60">
              {l === "All" ? bySource.length : bySource.filter((r) => r.rec.severity === l).length}
            </span>
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {shown.map(({ entry: e, rec }) => (
          <article key={e.key + "::" + rec.ruleId} className="rounded-lg border border-stone-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Chip className={SEVERITY_STYLE[rec.severity].chip}>{SEVERITY_STYLE[rec.severity].label}</Chip>
                  <span className="truncate text-xs text-stone-500">
                    {platformLabel(e.platform)} · {e.category}
                  </span>
                </div>
                <h3 className="mt-2 font-medium">{e.name}</h3>
                <button
                  onClick={() => onOpen(e.key)}
                  className="mt-0.5 rounded text-xs text-stone-500 hover:text-teal-600 hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-500"
                >
                  See where this is set
                </button>
              </div>
            </div>
            <div className="mt-3">
              <Diff from={rec.current} to={rec.recommended} />
            </div>
            <p className="mt-3 text-sm leading-relaxed text-stone-600">{rec.why}</p>
            <p className="mt-2 text-xs text-stone-400">Source: {rec.source}</p>
          </article>
        ))}

        {shown.length === 0 && (
          <div className="rounded-lg border border-dashed border-stone-300 bg-white px-4 py-16 text-center">
            <CheckCircle className="mx-auto h-7 w-7 text-teal-500" />
            <p className="mt-3 text-sm font-medium">No recommendations at this level</p>
            <p className="mt-1 text-xs text-stone-500">Switch filters to review the rest.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export { Recommendations };
