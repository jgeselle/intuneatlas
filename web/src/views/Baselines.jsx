import { useRef, useState } from "react";
import { FolderOpen, PencilSimple, Plus, Trash } from "@phosphor-icons/react";
import { PageSubtitle, Empty } from "../components/bits.jsx";
import { platformLabel } from "../lib/format.js";

const FIELD =
  "w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm placeholder-stone-400 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600";
const BUTTON =
  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-stone-600 ring-1 ring-inset ring-stone-300 hover:bg-stone-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-500 disabled:text-stone-300 disabled:ring-stone-200";
const PRIMARY =
  "inline-flex items-center gap-1.5 rounded-md bg-teal-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700 active:scale-[0.97] focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-500 disabled:bg-stone-200 disabled:text-stone-400";

/** How the tenant stands against one baseline, counted from the checks each setting carries for it. */
function standing(settingIndex, packPath) {
  const counts = { meets: 0, below: 0, missing: 0, unjudged: 0 };
  for (const entry of settingIndex) {
    const check = (entry.checks ?? []).find((c) => c.pack === packPath);
    if (!check) continue;
    if (entry.state === "Missing") counts.missing++;
    else if (check.passed === true) counts.meets++;
    else if (check.passed === false) counts.below++;
    else counts.unjudged++;
  }
  return counts;
}

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    // A data URL is "data:<type>;base64,<payload>" — only the payload is the file.
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(file);
  });
}

/**
 * Picks a downloaded baseline's folder and uploads the files that make it
 * one: the exported policies (any .json, at any depth) and a baseline.yml
 * at the top, if there is one. Scripts, docs and everything else stay on
 * the user's disk — the server would only discard them.
 */
function AddBaseline({ onAdd }) {
  const [source, setSource] = useState("");
  const [version, setVersion] = useState("");
  const [name, setName] = useState("");
  const [picked, setPicked] = useState(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  function onPick(e) {
    const files = Array.from(e.target.files ?? []).map((file) => {
      // "ChosenFolder/sub/x.json" -> "sub/x.json": the chosen folder itself is the pack.
      const path = (file.webkitRelativePath || file.name).split("/").slice(file.webkitRelativePath ? 1 : 0).join("/");
      return { file, path };
    });
    const kept = files.filter(({ path }) => /\.json$/i.test(path) || path === "baseline.yml");
    const folder = files[0]?.file.webkitRelativePath?.split("/")[0] ?? "";
    setPicked({ folder, files: kept, skipped: files.length - kept.length });
    if (!version && folder) setVersion(folder);
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const files = await Promise.all(picked.files.map(async ({ file, path }) => ({ path, contentBase64: await readAsBase64(file) })));
      const added = await onAdd({ source, version, name, files });
      if (added) {
        setSource("");
        setVersion("");
        setName("");
        setPicked(null);
        if (inputRef.current) inputRef.current.value = "";
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-stone-200 bg-white p-4">
      <h2 className="text-sm font-semibold">Add a baseline</h2>
      <p className="mt-1 text-xs leading-relaxed text-stone-500">
        A folder of Settings Catalog policies exported from Intune as JSON. Other files in the folder are ignored.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {/* webkitdirectory isn't a prop React knows; set as an attribute it picks a whole folder in every current browser. */}
        <input ref={inputRef} type="file" multiple webkitdirectory="" directory="" onChange={onPick} className="hidden" id="baseline-folder" />
        <label htmlFor="baseline-folder" className={BUTTON + " cursor-pointer"}>
          <FolderOpen className="h-3.5 w-3.5" />
          Choose folder
        </label>
        {picked && (
          <span className="text-xs text-stone-600">
            {picked.folder ? <span className="font-medium">{picked.folder}</span> : null}
            {picked.folder ? " · " : ""}
            {picked.files.length} JSON {picked.files.length === 1 ? "file" : "files"}
            {picked.skipped > 0 ? " · " + picked.skipped + " other files ignored" : ""}
          </span>
        )}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="text-xs font-medium text-stone-500">Source</span>
          <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="oib" className={FIELD + " mt-1"} />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-stone-500">Name and version</span>
          <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="windows-v4.0" className={FIELD + " mt-1"} />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-stone-500">Display name (optional)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Open Intune Baseline – Windows v4.0" className={FIELD + " mt-1"} />
        </label>
      </div>

      <button type="submit" disabled={busy || !picked || picked.files.length === 0 || !source.trim() || !version.trim()} className={PRIMARY + " mt-3"}>
        <Plus className="h-3.5 w-3.5" />
        {busy ? "Adding" : "Add baseline"}
      </button>
    </form>
  );
}

function PackCard({ pack, active, counts, canManage, onToggle, onRename, onRemove }) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(pack.name);
  const [confirming, setConfirming] = useState(false);
  const manageable = canManage && pack.editable;

  async function saveName(e) {
    e.preventDefault();
    if (draft.trim() && draft.trim() !== pack.name) await onRename(pack.path, draft.trim());
    setRenaming(false);
  }

  return (
    <li className="animate-rise-in rounded-lg border border-stone-200 bg-white p-4">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={active}
          onChange={() => onToggle(pack)}
          aria-label={(active ? "Deactivate " : "Activate ") + pack.name}
          className="mt-1 h-4 w-4 shrink-0 accent-teal-700"
        />
        <div className="min-w-0 flex-1">
          {renaming ? (
            <form onSubmit={saveName} className="flex flex-wrap items-center gap-2">
              <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} className={FIELD + " max-w-md"} />
              <button type="submit" disabled={!draft.trim()} className={PRIMARY}>
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft(pack.name);
                  setRenaming(false);
                }}
                className={BUTTON}
              >
                Cancel
              </button>
            </form>
          ) : (
            <h3 className="text-sm font-medium leading-snug">{pack.name}</h3>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone-500">
            <code className="font-mono text-stone-600">{pack.path}</code>
            <span>·</span>
            <span className="tabular-nums">
              {pack.policyCount} {pack.policyCount === 1 ? "policy" : "policies"}
            </span>
            <span>·</span>
            <span className="tabular-nums">{pack.ruleCount} settings</span>
            {pack.platforms.filter(Boolean).length > 0 && (
              <>
                <span>·</span>
                <span>{pack.platforms.filter(Boolean).map(platformLabel).join(", ")}</span>
              </>
            )}
          </div>

          {active ? (
            <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-xs">
              {[
                ["Meets", counts.meets, "text-teal-700"],
                ["Below", counts.below, counts.below ? "text-amber-700" : "text-stone-700"],
                ["Missing", counts.missing, counts.missing ? "text-purple-700" : "text-stone-700"],
                ["Not judged", counts.unjudged, "text-stone-700"],
              ].map(([label, value, tone]) => (
                <div key={label}>
                  <dt className="text-stone-500">{label}</dt>
                  <dd className={"mt-0.5 font-heading text-lg font-semibold tabular-nums leading-none " + tone}>{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-3 text-xs text-stone-400">Not active</p>
          )}
        </div>

        {manageable && !renaming && (
          <div className="flex shrink-0 items-center gap-2">
            {confirming ? (
              <>
                <span className="text-xs text-stone-600">Remove its files?</span>
                <button
                  onClick={async () => {
                    await onRemove(pack.path);
                    setConfirming(false);
                  }}
                  className="inline-flex items-center rounded-md bg-red-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600 focus:outline-none focus-visible:ring-1 focus-visible:ring-red-500"
                >
                  Remove
                </button>
                <button onClick={() => setConfirming(false)} className={BUTTON}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button onClick={() => setRenaming(true)} className={BUTTON}>
                  <PencilSimple className="h-3.5 w-3.5" />
                  Rename
                </button>
                <button onClick={() => setConfirming(true)} className={BUTTON}>
                  <Trash className="h-3.5 w-3.5" />
                  Remove
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * Every baseline the app can see: what it's made of, whether it's active
 * for this viewer, how the tenant stands against it, and — for an Admin,
 * for baselines in the user's own folder — adding, renaming and removing.
 */
function Baselines({ packs, activePacks, settingIndex, folder, viewer, onUpdateSelection, onAdd, onRename, onRemove, scope }) {
  const canManage = viewer?.role === "admin" && Boolean(onAdd);
  const isActive = (pack) => activePacks === null || activePacks.includes(pack.path);
  // A baseline added since the last sync can expect settings the scan never looked up — they show by their raw id until it does.
  const unnamed = settingIndex.filter((e) => e.state === "Missing" && e.name === e.definitionId).length;

  function toggle(pack) {
    const next = packs.filter((p) => (p.path === pack.path ? !isActive(pack) : isActive(p))).map((p) => p.path);
    onUpdateSelection(next.length === packs.length ? null : next);
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">Baselines</h1>
        <PageSubtitle scope={scope}>
          {folder && (
            <>
              Stored in <code className="font-mono text-xs text-stone-600">{folder}</code>
            </>
          )}
        </PageSubtitle>
      </header>

      {canManage && <AddBaseline onAdd={onAdd} />}

      {unnamed > 0 && (
        <p className="rounded-md border border-stone-200 bg-stone-50 p-3 text-xs leading-relaxed text-stone-600">
          {unnamed} missing {unnamed === 1 ? "setting is" : "settings are"} shown by ID. Sync the tenant to load their names.
        </p>
      )}

      {packs.length === 0 ? (
        <Empty>No baselines</Empty>
      ) : (
        <ul className="space-y-3">
          {packs.map((pack) => (
            <PackCard
              key={pack.path}
              pack={pack}
              active={isActive(pack)}
              counts={standing(settingIndex, pack.path)}
              canManage={canManage}
              onToggle={toggle}
              onRename={onRename}
              onRemove={onRemove}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

export { Baselines };
