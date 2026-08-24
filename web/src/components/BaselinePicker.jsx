import { useState } from "react";
import { SlidersHorizontal } from "@phosphor-icons/react";

/**
 * Which baseline packs judge the settings list — a personal preference,
 * not tenant data (see src/storage/baselineSelections.ts). `activePacks`
 * is null when every discovered pack is active (the default before this
 * viewer ever customized it); otherwise it's the exact set of active
 * pack paths. Every toggle here re-evaluates immediately — no separate
 * "Apply" step — since evaluation is now a purely local, pure function
 * over an already-scanned report (see applyBaselinesToReport).
 */
function BaselinePicker({ packs, activePacks, onChange }) {
  const [open, setOpen] = useState(false);
  const allActive = activePacks === null;
  const isActive = (pack) => allActive || activePacks.includes(pack.path);
  const activeCount = packs.filter(isActive).length;

  function toggle(pack) {
    const next = packs.filter((p) => (p.path === pack.path ? !isActive(pack) : isActive(p))).map((p) => p.path);
    onChange(next);
  }

  const groups = [];
  for (const pack of packs) {
    const group = groups.find((g) => g.sourceLabel === pack.sourceLabel);
    if (group) group.packs.push(pack);
    else groups.push({ sourceLabel: pack.sourceLabel, packs: [pack] });
  }

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className={
          "flex h-full items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-500 " +
          (open ? "border-teal-500 bg-teal-50 text-teal-700" : "border-stone-300 bg-white text-stone-600 hover:bg-stone-50")
        }
      >
        <SlidersHorizontal className="h-4 w-4" />
        Baselines
        {!allActive && (
          <span className="rounded bg-teal-100 px-1.5 py-0.5 text-xs tabular-nums text-teal-800">
            {activeCount}/{packs.length}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-2 w-96 rounded-lg border border-stone-200 bg-white p-3 shadow-xl">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">Active baselines</span>
              <div className="flex gap-3">
                <button
                  onClick={() => onChange(null)}
                  disabled={allActive}
                  className="text-xs font-medium text-teal-700 hover:underline focus:outline-none disabled:cursor-default disabled:text-stone-300 disabled:no-underline"
                >
                  All
                </button>
                <button
                  onClick={() => onChange([])}
                  disabled={activeCount === 0}
                  className="text-xs font-medium text-teal-700 hover:underline focus:outline-none disabled:cursor-default disabled:text-stone-300 disabled:no-underline"
                >
                  None
                </button>
              </div>
            </div>

            {packs.length === 0 ? (
              <p className="mt-2 text-xs text-stone-500">No baseline rules found.</p>
            ) : (
              <div className="mt-2 max-h-80 space-y-3 overflow-y-auto">
                {groups.map((g) => (
                  <div key={g.sourceLabel}>
                    <div className="text-xs font-medium text-stone-500">{g.sourceLabel}</div>
                    <div className="mt-1 space-y-0.5">
                      {g.packs.map((p) => (
                        <label
                          key={p.path}
                          className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1.5 text-sm hover:bg-stone-50"
                        >
                          <input
                            type="checkbox"
                            checked={isActive(p)}
                            onChange={() => toggle(p)}
                            className="h-3.5 w-3.5 shrink-0 rounded border-stone-300 text-teal-700 focus:ring-1 focus:ring-teal-500"
                          />
                          <span className="min-w-0 flex-1 truncate">{p.name}</span>
                          <span className="shrink-0 text-xs text-stone-400">{p.platforms.join(", ")}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export { BaselinePicker };
