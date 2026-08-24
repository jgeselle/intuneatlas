import { ArrowsClockwise } from "@phosphor-icons/react";
import { sinceLabel } from "../lib/format.js";

function SyncControl({ syncing, syncedAgo, onSync, compact = false, statusVisible = true, canSync = true }) {
  const dot = syncing ? "bg-teal-300" : syncedAgo >= 60 ? "bg-amber-400" : "bg-teal-400";
  const disabled = syncing || !canSync;
  const deniedTitle = "Only the Admin role can trigger a tenant scan.";

  if (compact) {
    return (
      <button
        onClick={onSync}
        disabled={disabled}
        aria-label={syncing ? "Syncing" : "Sync tenant"}
        title={!canSync ? deniedTitle : syncing ? "Reading tenant…" : "Synced " + sinceLabel(syncedAgo)}
        className="relative rounded-md p-1.5 text-teal-100 hover:bg-teal-800 focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-300 disabled:text-teal-400"
      >
        <ArrowsClockwise weight="bold" className={"h-4 w-4 " + (syncing ? "animate-spin" : "")} />
        <span className={"absolute right-0.5 top-0.5 h-2 w-2 rounded-full border-2 border-teal-900 " + dot} />
      </button>
    );
  }

  return (
    <div>
      <div className={"flex items-center gap-2 px-1 transition-opacity duration-200 " + (statusVisible ? "opacity-100" : "opacity-0")}>
        <span className={"h-1.5 w-1.5 shrink-0 rounded-full " + dot} />
        <span className="min-w-0 truncate text-xs text-teal-300">{syncing ? "Reading tenant…" : "Synced " + sinceLabel(syncedAgo)}</span>
      </div>
      <button
        onClick={onSync}
        disabled={disabled}
        title={!canSync ? deniedTitle : undefined}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-teal-50 ring-1 ring-inset ring-teal-700 hover:bg-teal-800 focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-300 disabled:text-teal-400"
      >
        <ArrowsClockwise weight="bold" className={"h-3.5 w-3.5 shrink-0 " + (syncing ? "animate-spin" : "")} />
        {syncing ? "Syncing" : "Sync now"}
      </button>
    </div>
  );
}

export { SyncControl };
