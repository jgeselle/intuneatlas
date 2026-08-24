import { useState } from "react";
import { SlidersHorizontal, CaretLeft, CaretRight, Check } from "@phosphor-icons/react";

/**
 * A fully custom checkbox — no native `<input type="checkbox">` — matching
 * the app's own button/chip visual language. Purely visual: the whole row
 * it sits in is the actual clickable/accessible control (see the pack row
 * button below), so this never carries its own click handler or ARIA role.
 */
function CheckIndicator({ checked }) {
  return (
    <span
      className={
        "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors " +
        (checked ? "border-teal-700 bg-teal-700" : "border-stone-300 bg-white")
      }
    >
      {checked && <Check weight="bold" className="h-3 w-3 text-white" />}
    </span>
  );
}

/**
 * Which baseline packs judge the settings list — a personal preference,
 * not tenant data (see src/storage/baselineSelections.ts). `activePacks`
 * is null when every discovered pack is active (the default before this
 * viewer ever customized it); otherwise it's the exact set of active
 * pack paths. Every toggle here re-evaluates immediately — no separate
 * "Apply" step — since evaluation is now a purely local, pure function
 * over an already-scanned report (see applyBaselinesToReport).
 *
 * Browsed like a directory tree, matching how baselines/ is actually
 * laid out on disk: the root shows only source folders (CIS, Microsoft,
 * ...); picking one navigates into it to toggle the packs inside.
 */
function BaselinePicker({ packs, activePacks, onChange }) {
  const [open, setOpen] = useState(false);
  const [folder, setFolder] = useState(null);
  const allActive = activePacks === null;
  const isActive = (pack) => allActive || activePacks.includes(pack.path);
  const activeCount = packs.filter(isActive).length;

  function toggle(pack) {
    const next = packs.filter((p) => (p.path === pack.path ? !isActive(pack) : isActive(p))).map((p) => p.path);
    onChange(next);
  }

  function close() {
    setOpen(false);
    setFolder(null);
  }

  const folders = [];
  for (const pack of packs) {
    const group = folders.find((g) => g.sourceLabel === pack.sourceLabel);
    if (group) group.packs.push(pack);
    else folders.push({ sourceLabel: pack.sourceLabel, packs: [pack] });
  }
  const currentFolder = folders.find((g) => g.sourceLabel === folder);

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
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

      {open && <div className="fixed inset-0 z-30" onClick={close} />}
      {/* Always mounted (not `{open && ...}`) so the close transition below
          can actually play instead of the panel just vanishing — same
          pattern as the account menu (components/AccountMenu.jsx). */}
      <div
        className={
          "absolute right-0 z-40 mt-2 w-96 origin-top-right rounded-lg border border-stone-200 bg-white p-3 shadow-xl transition duration-150 ease-out " +
          (open ? "translate-y-0 scale-100 opacity-100" : "pointer-events-none -translate-y-1.5 scale-95 opacity-0")
        }
      >
        {currentFolder ? (
          <>
            <button
              onClick={() => setFolder(null)}
              className="flex items-center gap-1 rounded text-xs font-semibold uppercase tracking-wide text-stone-500 hover:text-stone-700 focus:outline-none"
            >
              <CaretLeft weight="bold" className="h-3 w-3" />
              {currentFolder.sourceLabel}
            </button>
            <div className="mt-2 max-h-80 space-y-0.5 overflow-y-auto">
              {currentFolder.packs.map((p) => (
                <button
                  key={p.path}
                  type="button"
                  role="checkbox"
                  aria-checked={isActive(p)}
                  onClick={() => toggle(p)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-stone-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-teal-500"
                >
                  <CheckIndicator checked={isActive(p)} />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <span className="shrink-0 text-xs text-stone-400">{p.platforms.join(", ")}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
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

            {folders.length === 0 ? (
              <p className="mt-2 text-xs text-stone-500">No baseline rules found.</p>
            ) : (
              <div className="mt-2 space-y-0.5">
                {folders.map((f) => {
                  const folderActiveCount = f.packs.filter(isActive).length;
                  return (
                    <button
                      key={f.sourceLabel}
                      onClick={() => setFolder(f.sourceLabel)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-stone-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-teal-500"
                    >
                      <span className="min-w-0 flex-1 truncate">{f.sourceLabel}</span>
                      <span className="shrink-0 text-xs tabular-nums text-stone-400">
                        {folderActiveCount}/{f.packs.length}
                      </span>
                      <CaretRight className="h-3.5 w-3.5 shrink-0 text-stone-300" />
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export { BaselinePicker };
