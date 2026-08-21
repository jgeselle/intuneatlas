import { DrawerShell } from "./DrawerShell.jsx";
import { Chip, NoteThread } from "./bits.jsx";
import { platformLabel } from "../lib/format.js";

function SimplePolicyDrawer({ item, kindLabel, notes, onAddNote, onClose, viewer }) {
  const canNote = viewer?.role === "contributor" || viewer?.role === "admin";
  return (
    <DrawerShell
      eyebrow={kindLabel}
      title={item.name}
      onClose={onClose}
      chips={
        <>
          <Chip className={item.deployed ? "bg-teal-50 text-teal-700 ring-teal-200" : "bg-stone-100 text-stone-500 ring-stone-200"}>
            {item.deployed ? "Deployed" : "Not deployed"}
          </Chip>
          <Chip className="bg-stone-100 text-stone-600 ring-stone-200">{platformLabel(item.platform)}</Chip>
          {item.priority !== undefined && (
            <Chip className="bg-stone-100 text-stone-600 ring-stone-200">Priority {item.priority}</Chip>
          )}
        </>
      }
    >
      <p className="rounded-md border border-stone-200 bg-stone-50 p-3 text-xs leading-relaxed text-stone-600">
        Per-setting detail for {kindLabel.toLowerCase()} policies isn't scanned yet — this shows identity and deployment status only.
      </p>
      <NoteThread notes={notes} onAdd={onAddNote} readOnly={!canNote} />
    </DrawerShell>
  );
}

export { SimplePolicyDrawer };
