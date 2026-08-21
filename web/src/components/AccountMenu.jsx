import { useEffect, useState } from "react";
import { CaretDown, SignOut } from "@phosphor-icons/react";
import { initialsOf } from "../lib/format.js";

function AccountMenu({ session, tenant, up = false, full = false, textClassName = "", onOpenChange }) {
  const [open, setOpen] = useState(false);

  // Lets a parent rail pin itself open while the popover is up (see
  // `menuPinned` in App) — needed only for the collapsible-sidebar
  // placement, harmless everywhere else since the callback is optional.
  useEffect(() => {
    onOpenChange?.(open);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const initials = initialsOf(session.name);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        title={textClassName ? session.name : undefined}
        className={"flex items-center gap-2 rounded-md py-1 pl-[5px] pr-1.5 hover:bg-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-300 " + (full ? "w-full" : "")}
      >
        {/* The avatar is the "icon" here — like a nav icon it stays fully
            visible in the collapsed rail; only the surrounding text fades. */}
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-700 text-xs font-semibold text-white">
          {initials}
        </span>
        {full ? (
          <span className={"min-w-0 flex-1 text-left transition-opacity duration-150 " + textClassName}>
            <span className="block truncate text-sm text-white">{session.name}</span>
            <span className="block truncate text-xs text-teal-300">{session.email}</span>
          </span>
        ) : (
          <span className="hidden text-sm text-teal-50 sm:block">{session.name}</span>
        )}
        <CaretDown
          weight="bold"
          className={
            "h-3.5 w-3.5 shrink-0 text-teal-300 transition-[rotate,opacity] duration-150 " +
            // This trigger's popover opens upward (`up`), so the resting
            // chevron should point toward where it'll appear — up, not
            // down — and rotate back to neutral once it's actually open.
            // The plain dropdown placement keeps the usual convention:
            // down at rest, flips up once expanded.
            ((up ? !open : open) ? "rotate-180 " : "") +
            textClassName
          }
        />
      </button>

      {open && <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />}
      {/* Always mounted (not `{open && ...}`) so the close transition below
          can actually play instead of the panel just vanishing. */}
      <div
        className={
          "absolute z-40 rounded-lg border border-stone-200 bg-white p-3 shadow-xl transition duration-150 ease-out " +
          // "up" opens from the sidebar footer, which is narrower than a
          // fixed width — stretch to match the rail instead of
          // overflowing past its edge. The other placement has open
          // room to its left, so a fixed width there is fine.
          (up ? "bottom-full left-0 right-0 mb-2 origin-bottom " : "right-0 mt-2 w-64 origin-top-right ") +
          (open
            ? "translate-y-0 scale-100 opacity-100"
            : "pointer-events-none scale-95 opacity-0 " + (up ? "translate-y-1.5" : "-translate-y-1.5"))
        }
      >
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-800 text-xs font-semibold text-white">
            {initials}
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{session.name}</div>
            <div className="truncate text-xs text-stone-500">{session.email}</div>
          </div>
        </div>

        {tenant && (
          <dl className="mt-3 space-y-1.5 border-t border-stone-100 pt-3 text-xs">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-stone-500">Tenant</dt>
              <dd className="truncate text-right text-stone-700">{tenant}</dd>
            </div>
          </dl>
        )}

        <a
          href="/auth/logout"
          className="mt-3 flex w-full items-center gap-2 rounded-md border-t border-stone-200 px-2 pt-3 pb-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
        >
          <SignOut className="h-3.5 w-3.5" />
          Sign out
        </a>
      </div>
    </div>
  );
}

export { AccountMenu };
