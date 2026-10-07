import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "@phosphor-icons/react";

// Matches --animate-drawer-out in index.css.
const CLOSE_MS = 160;

function DrawerShell({ eyebrow, title, chips, detail, onClose, children }) {
  // The parent unmounts the drawer the moment onClose runs, which would
  // cut any exit animation off — so closing is two steps: flip `closing`
  // to play the exit, then tell the parent once it's done.
  const [closing, setClosing] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const requestClose = useCallback(() => setClosing(true), []);

  useEffect(() => {
    if (!closing) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => onCloseRef.current(), reduced ? 0 : CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [closing]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <div
        className={"absolute inset-0 " + (closing ? "animate-backdrop-out" : "animate-backdrop-in")}
        style={{ backgroundColor: "rgba(28, 25, 23, 0.32)" }}
        onClick={requestClose}
      />
      <div
        className={
          "relative flex h-full w-full max-w-md flex-col overflow-y-auto overscroll-contain border-l border-stone-200 bg-white shadow-2xl " +
          (closing ? "animate-drawer-out" : "animate-drawer-in")
        }
      >
        <div className="sticky top-0 z-10 border-b border-stone-200 bg-white px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wide text-stone-500">{eyebrow}</div>
              <h2 className="mt-1 text-base font-semibold leading-snug">{title}</h2>
            </div>
            <button
              onClick={requestClose}
              aria-label="Close"
              className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700 focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-500"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">{chips}</div>
          {detail ? <div className="mt-3">{detail}</div> : null}
        </div>
        <div className="space-y-5 px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

export { DrawerShell };
