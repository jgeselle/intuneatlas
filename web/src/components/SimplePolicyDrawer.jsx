import { DrawerShell } from "./DrawerShell.jsx";
import { Chip, HistorySection } from "./bits.jsx";
import { platformLabel } from "../lib/format.js";

function SimplePolicyDrawer({ item, kindLabel, notes, onAddNote, onDeleteNote, onClose, viewer }) {
  const canNote = viewer?.role === "contributor" || viewer?.role === "admin";
  return (
    <DrawerShell
      eyebrow={kindLabel}
      title={item.name}
      onClose={onClose}
      chips={
        <>
          <Chip className={item.deployed ? "bg-teal-50 text-teal-700 ring-teal-200" : "bg-stone-100 text-stone-500 ring-stone-200"}>
            {item.deployed ? "Assigned" : "Not assigned"}
          </Chip>
          <Chip className="bg-stone-100 text-stone-600 ring-stone-200">{platformLabel(item.platform)}</Chip>
          {item.priority !== undefined && (
            <Chip className="bg-stone-100 text-stone-600 ring-stone-200">Priority {item.priority}</Chip>
          )}
        </>
      }
    >
      <HistorySection notes={notes} onAdd={onAddNote} onDelete={onDeleteNote} readOnly={!canNote} viewer={viewer} />
    </DrawerShell>
  );
}

export { SimplePolicyDrawer };
