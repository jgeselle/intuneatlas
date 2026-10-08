import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { CaretDown, Check, MagnifyingGlass } from "@phosphor-icons/react";

/**
 * A dropdown drawn by the app instead of the browser's own <select>. The
 * native one sizes its list to its longest option and draws it outside the
 * page, so the long option labels Intune uses ran off the edge of the
 * window. This list is as wide as its button, wraps long labels
 * onto several lines, scrolls when there are many, and opens upward when
 * there isn't room below.
 *
 * `inline` draws the button as plain text with a caret, for use inside a
 * line of text; its list then gets a width of its own.
 *
 * `searchable` is for lists of names that can be many and long (a tenant's
 * groups): the list opens with a search field that narrows it as you type,
 * and a long name stays on one line — the list scrolls sideways instead.
 *
 * `value` picks the selected option; with no matching option the
 * `placeholder` shows instead, which is also how an "add something" menu
 * is made (never holds a value, just reports what was picked).
 *
 * Keyboard: Enter/Space/arrows open it; arrows, Home and End move; a
 * letter jumps to the next option starting with it; Enter or Space picks;
 * Escape or Tab closes.
 */
function Dropdown({ value, options, onChange, placeholder = "Select…", ariaLabel, muted = false, inline = false, searchable = false }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [above, setAbove] = useState(false);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const listRef = useRef(null);
  const searchRef = useRef(null);
  const [search, setSearch] = useState("");
  const listId = useId();
  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = options[selectedIndex];
  // What the list shows: everything, or what the search leaves. `active` counts within it.
  // Every word typed has to appear somewhere in the name, in any order ("apac fin" finds "…-APAC-Finance-…").
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = searchable && words.length ? options.filter((o) => words.every((w) => o.label.toLowerCase().includes(w))) : options;

  function openList() {
    // Opens upward only when the space below is too small for a useful list and there's more above.
    const rect = buttonRef.current.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom;
    setAbove(below < 240 && rect.top > below);
    setSearch("");
    setActive(Math.max(selectedIndex, 0));
    setOpen(true);
  }

  // Typing goes to the search field from the moment the list opens.
  useEffect(() => {
    if (open && searchable) searchRef.current?.focus();
  }, [open]);

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

  // Keeps the highlighted option in view as the keyboard moves through a long list. Up and down
  // only, and by hand: scrollIntoView would also pull a sideways-scrolled list back to its start.
  useLayoutEffect(() => {
    const item = open && listRef.current?.children[active];
    const box = listRef.current?.parentElement;
    if (!item || !box) return;
    // Measured from the scrolling box itself (it is the rows' offset parent), with its own padding kept clear.
    const pad = listRef.current.offsetTop;
    const top = item.offsetTop;
    if (top - pad < box.scrollTop) box.scrollTop = top - pad;
    else if (top + item.offsetHeight + pad > box.scrollTop + box.clientHeight) box.scrollTop = top + item.offsetHeight + pad - box.clientHeight;
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
      buttonRef.current?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, shown.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (shown[active]) pick(shown[active]);
    } else if (searchable) {
      // Every other key belongs to the search field: letters, Space, Home and End edit the text.
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(options.length - 1);
    } else if (e.key === " ") {
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
    <div ref={rootRef} className={inline ? "relative inline-block max-w-full align-bottom" : "relative"}>
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        aria-activedescendant={open && !searchable && shown[active] ? listId + "-" + active : undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        className={
          inline
            ? "flex max-w-full items-center gap-1 rounded text-left hover:text-stone-900 focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-600 " + (open ? "text-stone-900" : "")
            : "flex w-full items-center gap-2 rounded-md border bg-white py-1.5 pl-2.5 pr-2 text-left text-sm focus:outline-none focus:ring-1 focus:ring-teal-600 " +
              (open ? "border-teal-600 ring-1 ring-teal-600" : "border-stone-300 focus:border-teal-600")
        }
      >
        <span className={"min-w-0 truncate " + (inline ? "" : "flex-1 ") + (inline || (selected && !muted) ? "" : "text-stone-500")} title={selected?.label}>
          {selected ? selected.label : placeholder}
        </span>
        <CaretDown className={(inline ? "h-3 w-3 " : "h-3.5 w-3.5 text-stone-500 ") + "shrink-0 transition-transform duration-150 " + (open ? "rotate-180" : "")} />
      </button>

      {open && (
        <div
          className={
            "absolute left-0 z-30 animate-fade-in overflow-hidden rounded-md border border-stone-200 bg-white shadow-lg " +
            (searchable ? "w-[28rem] max-w-[calc(100vw-2rem)] " : inline ? "w-72 max-w-[calc(100vw-2rem)] " : "right-0 ") +
            (above ? "bottom-full mb-1" : "top-full mt-1")
          }
        >
          {searchable && (
            <div className="flex items-center gap-2 border-b border-stone-200 px-2.5">
              <MagnifyingGlass className="h-3.5 w-3.5 shrink-0 text-stone-400" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onKeyDown}
                placeholder="Search"
                aria-label={"Search " + (ariaLabel ?? "options")}
                aria-controls={listId}
                aria-activedescendant={shown[active] ? listId + "-" + active : undefined}
                className="min-w-0 flex-1 bg-transparent py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none"
              />
            </div>
          )}
          <div className="relative max-h-64 overflow-auto overscroll-contain py-1">
            {/* As wide as its longest name when names stay on one line, so every row's highlight spans the full scroll width. */}
            <ul ref={listRef} id={listId} role="listbox" aria-label={ariaLabel} className={searchable ? "w-max min-w-full" : ""}>
              {shown.map((option, i) => (
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
                  {/* On one-line names the tick leads: at the end it could be scrolled out of sight. */}
                  {searchable && <Check weight="bold" className={"mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-700 " + (option.value === value ? "" : "invisible")} />}
                  <span className={searchable ? "whitespace-nowrap" : "min-w-0 flex-1 break-words"}>{option.label}</span>
                  {!searchable && option.value === value && <Check weight="bold" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-700" />}
                </li>
              ))}
            </ul>
            {shown.length === 0 && <p className="px-2.5 py-1.5 text-sm text-stone-500">No matches</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export { Dropdown };
