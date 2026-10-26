import { useEffect, useRef, useState } from "react";
import { invoke } from "./platform/compat";
import type { MapPropertiesDocument, MapPropertiesValues } from "./core/mapProperties";
import type { HistorySummary } from "./core/types";
import "./MapEditing.css";

const fields = [
  ["bicycle", "Bicycle", "Controls mounting the bicycle and remaining on it when entering this map."],
  ["escape", "Dig and Escape Rope", "These share the native escape routine and its last-healing-location destination."],
  ["teleport", "Teleport", "Returns to the normal last healing destination. This permission does not change ordinary entrance or return warps."],
  ["fly", "Fly departure", "Allows departing this map. Fly destinations are configured separately by the game."],
  ["flash", "Flash", "Controls using Flash. Darkness is configured separately below."],
] as const;
export function MapPropertiesEditor({ mapConstant, onClose, onSaved, onDirtyChange }: { mapConstant: string; onClose(): void; onSaved(history: HistorySummary): void; onDirtyChange?(dirty: boolean): void }) {
  const dialog = useRef<HTMLDialogElement>(null), callback = useRef(onDirtyChange); callback.current = onDirtyChange;
  const [document, setDocument] = useState<MapPropertiesDocument | null>(null), [values, setValues] = useState<MapPropertiesValues | null>(null);
  const [error, setError] = useState<string | null>(null), [saving, setSaving] = useState(false);
  const dirty = Boolean(document && values && JSON.stringify(document.values) !== JSON.stringify(values));
  useEffect(() => { callback.current?.(dirty); }, [dirty]); useEffect(() => () => callback.current?.(false), []);
  useEffect(() => { dialog.current?.showModal(); let cancelled = false;
    void invoke<MapPropertiesDocument>("get_map_properties_document", { mapConstant }).then(next => { if (!cancelled) { setDocument(next); setValues(next.values); } }).catch(e => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [mapConstant]);
  function close() { if (!saving && (!dirty || window.confirm("Discard unsaved map properties?"))) onClose(); }
  async function save() { if (!document || !values) return; setSaving(true); setError(null);
    try { onSaved(await invoke<HistorySummary>("save_map_properties", { document, values })); }
    catch (e) { setError(String(e)); setSaving(false); }
  }
  return <dialog ref={dialog} className="wizard-dialog map-edit-dialog" aria-labelledby="map-properties-title" onCancel={e => { e.preventDefault(); close(); }}>
    <div className="wizard-heading"><div><h2 id="map-properties-title">Map properties{document ? ` in ${document.mapName}` : ""}</h2><p>Set field-use permissions for this map. Normal move, item and badge requirements still apply.</p></div><button type="button" disabled={saving} aria-label="Close map properties" onClick={close}>×</button></div>
    {error && <p role="alert">{error}</p>}
    {!document || !values ? <p role="status">{error ? "Map properties are unavailable for this source." : "Reading native map rules…"}</p> : <>
      <fieldset className="map-edit-fields" disabled={saving}>
        <div className="terrain-workspace">{fields.map(([key, title, help]) => <section className="strength-row" key={key}><label>{title}<select aria-label={title} value={values[key] === null ? "default" : values[key] ? "allow" : "block"} onChange={e => { setValues({ ...values, [key]: e.target.value === "default" ? null : e.target.value === "allow" }); setError(null); }}><option value="default">Default ({document.defaults[key] ? "allowed" : "blocked"})</option><option value="allow">Allowed on this map</option><option value="block">Blocked on this map</option></select></label><p>{help}</p></section>)}</div>
        <section className="strength-row"><label>Lighting on entry<select aria-label="Lighting on entry" value={values.lighting ?? "default"} onChange={e => { setValues({ ...values, lighting: e.target.value === "default" ? null : e.target.value as "normal" | "dark" }); setError(null); }}><option value="default">Native lighting behavior</option><option value="normal">Normal lighting</option><option value="dark">Dark until Flash is used</option></select></label><p>A dark override resets when entering this map again, including stairs from another map. Flash remains effective while staying on the map. Loading a saved game preserves its saved lighting state.</p></section>
      </fieldset>
      <div className="wizard-actions"><button type="button" disabled={saving} onClick={close}>Cancel</button><button type="button" className="primary-button" disabled={!dirty || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save map properties"}</button></div>
    </>}
  </dialog>;
}
