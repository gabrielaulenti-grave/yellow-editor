import { useEffect, useRef, useState } from "react";
import { invoke } from "./platform/compat";
import { SearchableSelect } from "./editor/SearchableSelect";
import type { MapEncounterDocument, MapEncounterValues } from "./core/mapEncounters";
import type { HistorySummary } from "./core/types";
import "./MapEditing.css";

export function MapEncounterEditor({ mapConstant, onClose, onSaved, onDirtyChange }: {
  mapConstant: string; onClose(): void; onSaved(history: HistorySummary): void; onDirtyChange?(dirty: boolean): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), callback = useRef(onDirtyChange); callback.current = onDirtyChange;
  const [document, setDocument] = useState<MapEncounterDocument | null>(null), [mode, setMode] = useState<MapEncounterValues["mode"]>("blank"), [tablePath, setTablePath] = useState("");
  const [dirty, setDirty] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState<string | null>(null), [confirmed, setConfirmed] = useState(false);
  useEffect(() => { dialog.current?.showModal(); let cancelled = false;
    void invoke<MapEncounterDocument>("get_map_encounter_document", { mapConstant }).then(d => { if (!cancelled) { setDocument(d); setTablePath(d.tables.find(t => !t.error)?.path ?? ""); } }).catch(e => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; callback.current?.(false); }; }, [mapConstant]);
  useEffect(() => { callback.current?.(dirty); }, [dirty]);
  const selected = document?.tables.find(t => t.path === tablePath);
  const replaces = document && document.currentLabel !== "NothingWildMons";
  function close() { if (!saving && (!dirty || window.confirm("Discard this encounter assignment?"))) onClose(); }
  async function save() { if (!document) return; setSaving(true); setError(null);
    try { onSaved(await invoke<HistorySummary>("assign_map_encounters", { document, values: { mode, tablePath } })); }
    catch (e) { setError(String(e)); setSaving(false); } }
  return <dialog ref={dialog} className="wizard-dialog map-edit-dialog" aria-labelledby="map-encounter-title" onCancel={e => { e.preventDefault(); close(); }}>
    <div className="wizard-heading"><div><h2 id="map-encounter-title">Assign encounters{document ? ` to ${document.mapName}` : ""}</h2><p>Create an independent encounter table or share an existing one.</p></div><button type="button" aria-label="Close Assign encounters" disabled={saving} onClick={close}>×</button></div>
    {error && <p role="alert">{error}</p>}
    {!document ? !error && <p role="status">Reading map encounter assignments…</p> : <fieldset className="map-edit-fields" disabled={saving} onChange={() => { setDirty(true); setError(null); }}>
      <p>Current assignment: {document.currentLabel === "NothingWildMons" ? "No wild encounters" : document.tables.find(t => t.tableLabel === document.currentLabel)?.displayName ?? document.currentLabel}.</p>
      <label>Encounter assignment<select aria-label="Encounter assignment" value={mode} onChange={e => { setMode(e.target.value as MapEncounterValues["mode"]); setConfirmed(false); }}>
        <option value="blank">Create a new empty table</option><option value="copy">Copy a table into an independent table</option><option value="share">Share an existing table</option><option value="none">No wild encounters</option>
      </select></label>
      {(mode === "copy" || mode === "share") && <label>Encounter table<SearchableSelect aria-label="Encounter table" value={tablePath} onChange={e => setTablePath(e.target.value)}>{document.tables.filter(t => !t.error).map(t => <option key={t.path} value={t.path}>{t.displayName} — {t.affectedMaps.length} map(s)</option>)}</SearchableSelect></label>}
      {mode === "blank" && <p>The new table starts with walking/cave and surfing encounters disabled. Use Open in Wild Encounters afterward to enable encounters and choose Pokémon, levels and rates.</p>}
      {mode === "copy" && <p>Copies Pokémon, levels, rates and Red/Blue differences. Later edits affect only maps assigned to the new copy.</p>}
      {mode === "share" && <p role="note">Edits to this table will affect this map and {selected?.affectedLocations.join(", ") || "any other map using it"}. This does not copy the table.</p>}
      {replaces && <label className="map-edit-ack"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Replace this map’s current assignment. The old table and other maps keep their data.</label>}
      <p className="help-text">Terrain must support encounters. Assigning a table does not change the map’s tileset or collision rules. Fishing remains separate.</p>
    </fieldset>}
    <div className="wizard-actions"><button type="button" disabled={saving} onClick={close}>Cancel</button><button type="button" className="primary-button" disabled={!document || saving || Boolean(replaces && !confirmed) || ((mode === "copy" || mode === "share") && !selected)} onClick={() => void save()}>{saving ? "Saving…" : "Save encounter assignment"}</button></div>
  </dialog>;
}
