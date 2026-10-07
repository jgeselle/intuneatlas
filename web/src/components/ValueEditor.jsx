import { Plus, X } from "@phosphor-icons/react";
import { defaultNode } from "../lib/settingValue.js";

const FIELD =
  "w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600";
const SMALL_BUTTON =
  "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-stone-600 ring-1 ring-inset ring-stone-300 hover:bg-stone-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-500 disabled:text-stone-300 disabled:ring-stone-200";
const ICON_BUTTON =
  "shrink-0 rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700 focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-500";

/** One number or piece of text, held to what the definition allows. */
function ScalarField({ schema, value, onChange }) {
  if (schema?.valueType === "integer") {
    return (
      <input
        type="number"
        inputMode="numeric"
        step={1}
        min={schema.min}
        max={schema.max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={FIELD + " tabular-nums"}
      />
    );
  }
  // A single-line input works fine for "Enabled"/"Not allowed." but not
  // for a long single string value (confirmed live: a 2,300-character
  // base64 blob) — one value, just too long for one line.
  if (String(value).length > 100) {
    return <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={4} className={FIELD + " resize-y font-mono text-xs"} />;
  }
  return <input type="text" value={value} maxLength={schema?.maxLength} onChange={(e) => onChange(e.target.value)} className={FIELD} />;
}

/**
 * The sub-settings under a choice's selected option, or inside a group.
 * Every one of them is optional (confirmed live: policies configure all,
 * some or none of what's declared), so each is either set — shown with
 * its own editor and a remove button — or offered in the "add" list.
 */
function ChildrenEditor({ declaredIds, nodes, schemas, onChange }) {
  const present = new Set(nodes.map((n) => n.definitionId));
  const addable = declaredIds.filter((id) => !present.has(id) && schemas[id]);

  return (
    <div className="mt-2 space-y-2.5 border-l-2 border-stone-200 pl-3">
      {nodes.map((child, i) => (
        <div key={child.definitionId}>
          <div className="flex items-start justify-between gap-2">
            <span className="min-w-0 pt-1 text-xs font-medium leading-snug text-stone-600">{child.name}</span>
            <button
              type="button"
              onClick={() => onChange(nodes.filter((_, n) => n !== i))}
              aria-label={"Remove " + child.name}
              title="Remove"
              className={ICON_BUTTON}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-1">
            <ValueEditor node={child} schemas={schemas} onChange={(next) => onChange(nodes.map((n, idx) => (idx === i ? next : n)))} />
          </div>
        </div>
      ))}
      {addable.length > 0 && (
        <select
          value=""
          onChange={(e) => e.target.value && onChange([...nodes, defaultNode(schemas[e.target.value])])}
          aria-label="Add a sub-setting"
          className={FIELD + " pr-8 text-stone-500"}
        >
          <option value="">Add a sub-setting…</option>
          {addable.map((id) => (
            <option key={id} value={id}>
              {schemas[id].name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

/**
 * Edits a setting's value in whatever shape it has, the way Intune's own
 * editor does: a dropdown for a choice (with the selected option's
 * sub-settings underneath), a field for a number or text, a list with
 * add/remove for a collection, the member settings for a group, and
 * repeatable instances for a group collection. Recursive — a sub-setting
 * is edited by the same component.
 */
function ValueEditor({ node, schemas, onChange }) {
  const schema = schemas?.[node.definitionId];

  if (node.kind === "simple") {
    return <ScalarField schema={schema} value={node.value} onChange={(value) => onChange({ ...node, value })} />;
  }

  if (node.kind === "choice") {
    const options = schema?.options ?? [];
    const selected = options.find((o) => o.id === node.optionId);
    return (
      <>
        <select
          value={node.optionId}
          onChange={(e) => {
            const option = options.find((o) => o.id === e.target.value);
            // Sub-settings belong to the option they were under; a different option starts without any.
            if (option) onChange({ kind: "choice", definitionId: node.definitionId, name: node.name, optionId: option.id, label: option.label });
          }}
          className={FIELD + " pr-8"}
        >
          {/* A value Intune's definition doesn't list (an option id that never resolved) still has to be showable. */}
          {!selected && <option value={node.optionId}>{node.label}</option>}
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        {(selected?.childIds?.length > 0 || node.children?.length > 0) && (
          <ChildrenEditor
            declaredIds={selected?.childIds ?? []}
            nodes={node.children ?? []}
            schemas={schemas}
            onChange={(children) => onChange({ ...node, children })}
          />
        )}
      </>
    );
  }

  if (node.kind === "simpleCollection") {
    const full = schema?.maxCount !== undefined && node.items.length >= schema.maxCount;
    return (
      <div className="space-y-1.5">
        {node.items.map((item, i) => (
          <div key={i} className="flex items-start gap-1.5">
            <ScalarField schema={schema} value={item} onChange={(value) => onChange({ ...node, items: node.items.map((v, n) => (n === i ? value : v)) })} />
            <button
              type="button"
              onClick={() => onChange({ ...node, items: node.items.filter((_, n) => n !== i) })}
              aria-label="Remove item"
              title="Remove"
              className={ICON_BUTTON + " mt-1"}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <button type="button" disabled={full} onClick={() => onChange({ ...node, items: [...node.items, ""] })} className={SMALL_BUTTON}>
          <Plus className="h-3 w-3" />
          Add item
        </button>
      </div>
    );
  }

  if (node.kind === "choiceCollection") {
    const chosen = new Set(node.items.map((item) => item.optionId));
    const options = schema?.options ?? node.items.map((item) => ({ id: item.optionId, label: item.label }));
    return (
      <ul className="space-y-1">
        {options.map((o) => (
          <li key={o.id}>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={chosen.has(o.id)}
                onChange={(e) =>
                  onChange({
                    ...node,
                    // Kept in the definition's own order, whatever order they're ticked in.
                    items: options.filter((x) => (x.id === o.id ? e.target.checked : chosen.has(x.id))).map((x) => ({ optionId: x.id, label: x.label })),
                  })
                }
                className="mt-1 accent-teal-700"
              />
              <span>{o.label}</span>
            </label>
          </li>
        ))}
      </ul>
    );
  }

  if (node.kind === "group") {
    return <ChildrenEditor declaredIds={schema?.childIds ?? []} nodes={node.children} schemas={schemas} onChange={(children) => onChange({ ...node, children })} />;
  }

  if (node.kind === "groupCollection") {
    const full = schema?.maxCount !== undefined && node.groups.length >= schema.maxCount;
    // Most group collections allow exactly one instance (confirmed live) — numbering that one would only be noise.
    const numbered = node.groups.length > 1 || !(schema?.maxCount === 1);
    return (
      <div className="space-y-3">
        {node.groups.map((group, i) => (
          <div key={i}>
            {numbered && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-stone-500">Instance {i + 1}</span>
                <button
                  type="button"
                  onClick={() => onChange({ ...node, groups: node.groups.filter((_, n) => n !== i) })}
                  aria-label={"Remove instance " + (i + 1)}
                  title="Remove"
                  className={ICON_BUTTON}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            <ChildrenEditor
              declaredIds={schema?.childIds ?? []}
              nodes={group}
              schemas={schemas}
              onChange={(children) => onChange({ ...node, groups: node.groups.map((g, n) => (n === i ? children : g)) })}
            />
          </div>
        ))}
        {!full && (
          <button type="button" onClick={() => onChange({ ...node, groups: [...node.groups, []] })} className={SMALL_BUTTON}>
            <Plus className="h-3 w-3" />
            Add instance
          </button>
        )}
      </div>
    );
  }

  return <p className="text-xs text-stone-500">This setting type can’t be edited here.</p>;
}

export { ValueEditor };
