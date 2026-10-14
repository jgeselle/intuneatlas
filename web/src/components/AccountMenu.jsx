import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CaretDown, SignOut } from "@phosphor-icons/react";
import { initialsOf } from "../lib/format.js";
import { setThemeChoice, themeChoice } from "../lib/theme.js";

function AccountMenu({ session, tenant, up = false, full = false, textClassName = "", onOpenChange }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState(null);
  const trigger = useRef(null);
  // Which build is running — put into the page by the server, like the session.
  const version = window.__INTUNEATLAS_VERSION__;

  // Lets a parent rail pin itself open while the popover is up (see
  // `menuPinned` in App) — needed only for the collapsible-sidebar
  // placement, harmless everywhere else since the callback is optional.
  useEffect(() => {
    onOpenChange?.(open);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // In the sidebar footer (`up`) the panel is wider than the sidebar, which would clip it — so it's put
  // in the page and lined up from there: from the sidebar's left edge, just above this button.
  useLayoutEffect(() => {
    if (!open || !up) return;
    const measure = () => {
      const button = trigger.current?.getBoundingClientRect();
      const aside = trigger.current?.closest("aside")?.getBoundingClientRect();
      if (button) setPlace({ bottom: window.innerHeight - button.top + 8, left: (aside?.left ?? 0) + 12 });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open, up]);

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
        ref={trigger}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        title={textClassName ? session.name : undefined}
        className={"flex items-center gap-2 rounded-md py-1 pl-[5px] pr-1.5 hover:bg-teal-800 focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-300 " + (full ? "w-full" : "")}
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

      {portalIf(
        up,
        <>
      {open && <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />}
      {/* Always mounted (not `{open && ...}`) so the close transition below
          can actually play instead of the panel just vanishing. */}
      <div
        style={up ? (place ?? { bottom: 0, left: 0 }) : undefined}
        className={
          "z-40 w-[min(21rem,calc(100vw-1.5rem))] rounded-lg border border-stone-200 bg-surface p-3 text-stone-900 shadow-xl transition duration-150 ease-out " +
          // "up" opens from the sidebar footer, out over the page; the top-bar placement hangs below its button.
          (up ? "fixed origin-bottom-left " : "absolute right-0 mt-2 origin-top-right ") +
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

        {(session.role || tenant || version) && (
          <dl className="mt-3 space-y-1.5 border-t border-stone-100 pt-3 text-xs">
            {session.role && (
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-stone-500">Role</dt>
                <dd className="truncate text-right text-stone-700">{session.role.charAt(0).toUpperCase() + session.role.slice(1)}</dd>
              </div>
            )}
            {tenant && (
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-stone-500">Tenant</dt>
                <dd className="truncate text-right text-stone-700">{tenant}</dd>
              </div>
            )}
            {version && (
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-stone-500">Version</dt>
                <dd className="truncate text-right tabular-nums text-stone-700">{version}</dd>
              </div>
            )}
          </dl>
        )}

        <Appearance />

        <a
          href="/auth/logout"
          className="mt-3 flex w-full items-center gap-2 rounded-md border-t border-stone-200 px-2 pt-3 pb-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-500"
        >
          <SignOut className="h-3.5 w-3.5" />
          Sign out
        </a>
      </div>
        </>,
      )}
    </div>
  );
}

/** In the page, out of the sidebar's clipping, where `inPage` — in place otherwise. */
function portalIf(inPage, children) {
  return inPage ? createPortal(children, document.body) : children;
}

const APPEARANCES = [
  ["system", "System"],
  ["light", "Light"],
  ["dark", "Dark"],
];

function Appearance() {
  const [choice, setChoice] = useState(themeChoice);
  return (
    <div className="mt-3 border-t border-stone-100 pt-3 text-xs">
      <div className="text-stone-500">Appearance</div>
      <div className="mt-1.5 grid grid-cols-3 rounded-md bg-stone-100 p-0.5" role="radiogroup" aria-label="Appearance">
        {APPEARANCES.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={choice === value}
            onClick={() => {
              setThemeChoice(value);
              setChoice(value);
            }}
            className={
              "rounded px-2 py-1 focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-500 " +
              (choice === value ? "bg-surface font-medium text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-700")
            }
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

export { AccountMenu };
