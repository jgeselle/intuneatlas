import { useMemo, useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { Sliders, WarningCircle, Warning, Prohibit, Question, MagnifyingGlass, ChatCircle, ListChecks } from "@phosphor-icons/react";
import { Chip, PageSubtitle, Stat, Empty } from "../components/bits.jsx";
import { STATE_STYLE } from "../lib/styles.js";
import { platformLabel } from "../lib/format.js";

const HEADER_ROW_HEIGHT = 33; // category label, ~= mb-2 + line height
const SETTING_ROW_HEIGHT = 61; // one list row at its common (non-wrapping) height

function SettingsView({
  entries,
  notes = {},
  changes = {},
  query,
  setQuery,
  platform,
  setPlatform,
  onOpen,
  scopeLabel,
}) {
  const [state, setState] = useState("All");
  // How many changes are staged per setting — a setting can have several: one per policy, existing or new.
  const stagedCount = useMemo(() => {
    const counts = {};
    // A change made before changes recorded their setting is keyed by the setting itself.
    for (const change of Object.values(changes)) counts[change.settingKey || change.targetKey] = (counts[change.settingKey || change.targetKey] ?? 0) + 1;
    return counts;
  }, [changes]);
  const platforms = ["All", ...Array.from(new Set(entries.map((e) => e.platform)))];
  const states = ["All", "Below baseline", "Conflict", "Missing", "Not assigned", "Meets baseline", "Not checked"];

  const shown = entries.filter(
    (e) =>
      (platform === "All" || e.platform === platform) &&
      (state === "All" || e.state === state) &&
      (e.name.toLowerCase().includes(query.toLowerCase()) ||
        e.category.toLowerCase().includes(query.toLowerCase()) ||
        (e.cspPath || "").toLowerCase().includes(query.toLowerCase())),
  );

  const categories = Array.from(new Set(shown.map((e) => e.category)));
  const count = (s) => entries.filter((e) => e.state === s).length;
  // "Missing" entries are synthetic — a baseline rule with no matching
  // setting anywhere in the tenant, not something actually configured —
  // so they're excluded from what "Managed" claims to count.
  const managedCount = entries.length - count("Missing");

  // Flattened so category headers and their rows live in one virtualized
  // list — the alternative (virtualizing per-category) can't share a
  // single window scroll position across categories.
  const flatItems = useMemo(() => {
    const items = [];
    for (const cat of categories) {
      items.push({ type: "header", category: cat });
      for (const e of shown) {
        if (e.category === cat) items.push({ type: "row", entry: e });
      }
    }
    return items;
  }, [categories, shown]);

  const listRef = useRef(null);
  const virtualizer = useWindowVirtualizer({
    count: flatItems.length,
    estimateSize: (i) => (flatItems[i].type === "header" ? HEADER_ROW_HEIGHT : SETTING_ROW_HEIGHT),
    overscan: 12,
    getItemKey: (i) => (flatItems[i].type === "header" ? "h:" + flatItems[i].category : flatItems[i].entry.key),
    scrollMargin: listRef.current?.offsetTop ?? 0,
  });

  return (
    <div className="space-y-5">
      {/* Cancels out the page wrapper's own top padding (App.jsx's `py-6
          lg:py-8`) with a matching negative margin, then restores the same
          visual gap as internal padding. Otherwise this element's box starts
          24-32px below the true document top, so `sticky top-0` only takes
          effect after scrolling past that gap instead of immediately. */}
      <div className="sticky top-0 z-10 -mt-6 space-y-5 bg-stone-50 pb-4 pt-6 lg:-mt-8 lg:pt-8">
        <header>
          <h1 className="text-xl font-semibold">Settings</h1>
          <PageSubtitle scopeLabel={scopeLabel} />
        </header>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="Managed" value={managedCount} icon={Sliders} />
          <Stat label="Below baseline" value={count("Below baseline")} tone={count("Below baseline") ? "amber" : "neutral"} icon={WarningCircle} />
          <Stat label="Conflicting" value={count("Conflict")} tone={count("Conflict") ? "alert" : "neutral"} icon={Warning} />
          <Stat label="Not assigned" value={count("Not assigned")} icon={Prohibit} />
          <Stat label="Missing" value={count("Missing")} tone={count("Missing") ? "amber" : "neutral"} icon={Question} />
        </div>

        <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <MagnifyingGlass className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-stone-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, category, or CSP path"
              className="w-full rounded-md border border-stone-300 bg-white py-2 pl-9 pr-3 text-sm placeholder-stone-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {states.map((s) => (
            <button
              key={s}
              onClick={() => setState(s)}
              className={
                "shrink-0 rounded-md px-3 py-1.5 text-xs font-medium focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-500 " +
                (state === s ? "bg-stone-900 text-white" : "bg-white text-stone-600 ring-1 ring-inset ring-stone-300 hover:bg-stone-50")
              }
            >
              {s}
              <span className="ml-1.5 tabular-nums opacity-60">{s === "All" ? entries.length : count(s)}</span>
            </button>
          ))}
          <span className="mx-1 hidden w-px bg-stone-200 sm:block" />
          {platforms.map((p) => (
            <button
              key={p}
              onClick={() => setPlatform(p)}
              className={
                "shrink-0 rounded-md px-3 py-1.5 text-xs font-medium focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-500 " +
                (platform === p ? "bg-teal-700 text-white" : "bg-white text-stone-600 ring-1 ring-inset ring-stone-300 hover:bg-stone-50")
              }
            >
              {p === "All" ? "All" : platformLabel(p)}
            </button>
          ))}
        </div>
        </div>
      </div>

      {shown.length === 0 ? (
        <Empty>No settings match that filter</Empty>
      ) : (
        <div ref={listRef} style={{ position: "relative", height: virtualizer.getTotalSize(), width: "100%" }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const item = flatItems[vi.index];
            return (
              <div
                key={vi.key}
                data-index={vi.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${vi.start - virtualizer.options.scrollMargin}px)`,
                }}
              >
                {item.type === "header" ? (
                  <h2 className="pb-2 pt-5 font-sans text-xs font-semibold uppercase tracking-wide text-stone-500">{item.category}</h2>
                ) : (
                  <div className="pb-2">
                    <button
                      onClick={() => onOpen(item.entry.key)}
                      className="flex w-full items-center gap-3 rounded-lg border border-stone-200 bg-white px-4 py-3 text-left hover:bg-stone-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-teal-500"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium">{item.entry.name}</span>
                          {(notes[item.entry.key] || []).length > 0 && (
                            <span
                              className="inline-flex shrink-0 items-center gap-0.5 text-xs text-stone-400"
                              title={(notes[item.entry.key] || []).length + " notes"}
                            >
                              <ChatCircle className="h-3.5 w-3.5" />
                              <span className="tabular-nums">{(notes[item.entry.key] || []).length}</span>
                            </span>
                          )}
                          {/* Same icon as the Change log in the sidebar: something is staged for this setting. */}
                          {stagedCount[item.entry.key] > 0 && (
                            <span
                              className="inline-flex shrink-0 items-center gap-0.5 text-xs text-teal-700"
                              title={stagedCount[item.entry.key] === 1 ? "1 staged change" : stagedCount[item.entry.key] + " staged changes"}
                            >
                              <ListChecks weight="bold" className="h-3.5 w-3.5" />
                              <span className="tabular-nums">{stagedCount[item.entry.key]}</span>
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 truncate text-xs text-stone-500">
                          {platformLabel(item.entry.platform)} ·{" "}
                          {item.entry.sources.length === 0
                            ? "No policy"
                            : item.entry.sources.length === 1
                              ? item.entry.sources[0].policyName
                              : item.entry.sources.length + " policies"}
                        </div>
                      </div>
                      <div className="hidden w-56 shrink-0 sm:block">
                        <div className={"truncate text-sm " + (item.entry.conflict ? "text-red-700" : "text-stone-700")}>
                          {item.entry.values.length === 0
                            ? "Not configured"
                            : item.entry.values.map((v) => v.replace(/\n/g, ", ")).join(" / ")}
                        </div>
                      </div>
                      {/* Fixed width: the chip's own width varies with its label, which would otherwise shift the value column row by row. */}
                      <div className="flex w-28 shrink-0 justify-end">
                        <Chip className={STATE_STYLE[item.entry.state]}>{item.entry.state}</Chip>
                      </div>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export { SettingsView };
