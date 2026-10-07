import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { CaretDown, Check } from "@phosphor-icons/react";

/**
 * A dropdown drawn by the app instead of the browser's own <select>. The
 * native one sizes its list to its longest option and draws it outside the
 * page, so the long option labels Intune uses ran off the edge of the
 * window. This list is exactly as wide as its button, wraps long labels
 * onto several lines, scrolls when there are many, and opens upward when
 * there isn't room below.
 *
 * `value` picks the selected option; with no matching option the
 * `placeholder` shows instead, which is also how an "add something" menu
 * is made (never holds a value, just reports what was picked).
 *
 * Keyboard: Enter/Space/arrows open it; arrows, Home and End move; a
 * letter jumps to the next option starting with it; Enter or Space picks;
 * Escape or Tab closes.
 */
function Dropdown({ value, options, onChange, placeholder = "Select…", ariaLabel, muted = false, size = "md" }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [above, setAbove] = useState(false);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const listRef = useRef(null);
  const listId = useId();
  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = options[selectedIndex];

  function openList() {
    // Opens upward only when the space below is too small for a useful list and there's more above.
    const rect = buttonRef.current.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom;
    setAbove(below < 240 && rect.top > below);
    setActive(Math.max(selectedIndex, 0));
    setOpen(true);
  }

  function pick(option) {
    setOpen(false);
    buttonRef.current?.focus();
    if (option.value !== value) onChange(option.value);
  }

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  // Keeps the highlighted option in view as the keyboard moves through a long list.
  useLayoutEffect(() => {
    if (open) listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function onKeyDown(e) {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        openList();
      }
      return;
    }
    if (e.key === "Escape") {
      // Stops here: the drawer this sits in also closes on Escape, and the first press should only close the list.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "Tab") {
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(options.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (options[active]) pick(options[active]);
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const letter = e.key.toLowerCase();
      const from = (active + 1) % options.length;
      const order = [...options.slice(from), ...options.slice(0, from)];
      const match = order.find((o) => o.label.trim().toLowerCase().startsWith(letter));
      if (match) setActive(options.indexOf(match));
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        aria-activedescendant={open && options[active] ? listId + "-" + active : undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        className={
          "flex w-full items-center gap-2 rounded-md border bg-white pl-2.5 pr-2 text-left text-sm focus:outline-none focus:ring-1 focus:ring-teal-600 " +
          // "lg" matches the height of the page-level search box it sits next to.
          (size === "lg" ? "py-2 pl-3 " : "py-1.5 ") +
          (open ? "border-teal-600 ring-1 ring-teal-600" : "border-stone-300 focus:border-teal-600")
        }
      >
        <span className={"min-w-0 flex-1 truncate " + (selected && !muted ? "" : "text-stone-500")} title={selected?.label}>
          {selected ? selected.label : placeholder}
        </span>
        <CaretDown className={"h-3.5 w-3.5 shrink-0 text-stone-500 transition-transform duration-150 " + (open ? "rotate-180" : "")} />
      </button>

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className={
            "absolute left-0 right-0 z-30 max-h-64 animate-fade-in overflow-y-auto overscroll-contain rounded-md border border-stone-200 bg-white py-1 shadow-lg " +
            (above ? "bottom-full mb-1" : "top-full mt-1")
          }
        >
          {options.map((option, i) => (
            <li
              key={option.value}
              id={listId + "-" + i}
              role="option"
              aria-selected={option.value === value}
              // mousedown, not click: picking must happen before the button's blur can close the list.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(option);
              }}
              // Move, not enter: when the keyboard scrolls the list under a resting
              // pointer, "enter" fires on whatever slides beneath it and would steal the highlight.
              onMouseMove={() => i !== active && setActive(i)}
              className={
                "flex cursor-pointer items-start gap-2 px-2.5 py-1.5 text-sm leading-snug " +
                (i === active ? "bg-stone-100 " : "") +
                (option.value === value ? "font-medium text-stone-900" : "text-stone-700")
              }
            >
              <span className="min-w-0 flex-1 break-words">{option.label}</span>
              {option.value === value && <Check weight="bold" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-700" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export { Dropdown };
