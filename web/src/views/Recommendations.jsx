import { useState } from "react";
import { CheckCircle } from "@phosphor-icons/react";
import { Chip, Diff } from "../components/bits.jsx";
import { SEVERITY_STYLE } from "../lib/styles.js";
import { platformLabel } from "../lib/format.js";

function Recommendations({ settingIndex, onOpen }) {
  const [filter, setFilter] = useState("All");
  const recs = settingIndex
    .filter((e) => e.rec)
    .sort((a, b) => SEVERITY_STYLE[a.rec.severity].rank - SEVERITY_STYLE[b.rec.severity].rank);
  const levels = ["All", "critical", "high", "medium", "low"];
  const shown = filter === "All" ? recs : recs.filter((e) => e.rec.severity === filter);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">Recommendations</h1>
        <p className="mt-1 text-sm text-stone-500">
          Settings that differ from the baseline, ranked by what they expose. Write-back doesn't exist yet, so these are
          for review — nothing here changes the tenant.
        </p>
      </header>

      <div className="flex gap-1 overflow-x-auto">
        {levels.map((l) => (
          <button
            key={l}
            onClick={() => setFilter(l)}
            className={
              "shrink-0 rounded-md px-3 py-1.5 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 " +
              (filter === l ? "bg-stone-900 text-white" : "bg-white text-stone-600 ring-1 ring-inset ring-stone-300 hover:bg-stone-50")
            }
          >
            {l === "All" ? "All" : SEVERITY_STYLE[l].label}
            <span className="ml-1.5 tabular-nums opacity-60">
              {l === "All" ? recs.length : recs.filter((e) => e.rec.severity === l).length}
            </span>
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {shown.map((e) => (
          <article key={e.key} className="rounded-lg border border-stone-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Chip className={SEVERITY_STYLE[e.rec.severity].chip}>{SEVERITY_STYLE[e.rec.severity].label}</Chip>
                  <span className="truncate text-xs text-stone-500">
                    {platformLabel(e.platform)} · {e.category}
                  </span>
                </div>
                <h3 className="mt-2 font-medium">{e.name}</h3>
                <button
                  onClick={() => onOpen(e.key)}
                  className="mt-0.5 rounded text-xs text-stone-500 hover:text-teal-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                >
                  See where this is set
                </button>
              </div>
            </div>
            <div className="mt-3">
              <Diff from={e.rec.current} to={e.rec.recommended} />
            </div>
            <p className="mt-3 text-sm leading-relaxed text-stone-600">{e.rec.why}</p>
            <p className="mt-2 text-xs text-stone-400">Source: {e.rec.source}</p>
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
