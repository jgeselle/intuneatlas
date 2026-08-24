import { useEffect } from "react";
import { X } from "@phosphor-icons/react";

function DrawerShell({ eyebrow, title, chips, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 transition-opacity" style={{ backgroundColor: "rgba(28, 25, 23, 0.32)" }} onClick={onClose} />
      <div className="relative flex h-full w-full max-w-md flex-col overflow-y-auto overscroll-contain border-l border-stone-200 bg-white shadow-2xl">
        <div className="sticky top-0 z-10 border-b border-stone-200 bg-white px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wide text-stone-500">{eyebrow}</div>
              <h2 className="mt-1 text-base font-semibold leading-snug">{title}</h2>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700 focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-500"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">{chips}</div>
        </div>
        <div className="space-y-5 px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

export { DrawerShell };
