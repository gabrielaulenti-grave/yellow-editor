import { useEffect, useRef, useState } from "react";
import { invoke } from "./platform/compat";
import { SearchableSelect } from "./editor/SearchableSelect";
import { MapPaintSurface } from "./editor/MapPaintSurface";
import type { MapItemDocument, MapItemValues } from "./core/mapItems";
import type { HistorySummary, MapVisualization } from "./core/types";
import "./MapEditing.css";

export function MapItemEditor({ visualization, onClose, onSaved, onDirtyChange }: {
  visualization: MapVisualization; onClose(): void; onSaved(id: number, history: HistorySummary): void; onDirtyChange?(dirty: boolean): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), callback = useRef(onDirtyChange); callback.current = onDirtyChange;
  const [document, setDocument] = useState<MapItemDocument | null>(null), [values, setValues] = useState<MapItemValues>({ x: 0, y: 0, item: "POTION", quantity: 1 });
  const [dirty, setDirty] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState<string | null>(null);
  useEffect(() => { dialog.current?.showModal(); let cancelled = false;
    void invoke<MapItemDocument>("get_map_item_document", { mapConstant: visualization.map.constant }).then(d => { if (!cancelled) { setDocument(d); setValues(v => ({ ...v, item: d.items.includes("POTION") ? "POTION" : d.items[0] ?? "" })); } }).catch(e => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; callback.current?.(false); }; }, [visualization.map.constant]);
  useEffect(() => { callback.current?.(dirty); }, [dirty]);
  function update(patch: Partial<MapItemValues>) { setValues(v => ({ ...v, ...patch })); setDirty(true); setError(null); }
  function close() { if (!saving && (!dirty || window.confirm("Discard this unsaved item?"))) onClose(); }
  const positionError = document && (!Number.isInteger(values.x) || !Number.isInteger(values.y) || values.x < 0 || values.y < 0 || values.x >= Math.min(document.npc.width, 252) || values.y >= Math.min(document.npc.height, 252)) ? "Choose a position inside the map."
    : document?.npc.occupied.some(p => p.x === values.x && p.y === values.y) ? "This position contains an object, sign or warp." : null;
  const quantityError = !Number.isInteger(values.quantity) || values.quantity < 1 || values.quantity > 99;
  async function save() { if (!document || positionError || quantityError) return; setSaving(true); setError(null);
    try { onSaved(document.npc.objectId, await invoke<HistorySummary>("place_map_item", { document, values })); } catch (e) { setError(String(e)); setSaving(false); } }
  return <dialog ref={dialog} className="wizard-dialog map-edit-dialog" aria-labelledby="map-item-title" onCancel={e => { e.preventDefault(); close(); }}>
    <div className="wizard-heading"><div><h2 id="map-item-title">Place item in {visualization.map.displayName}</h2><p>Place a visible Poké Ball pickup that can be collected once per save file.</p></div><button type="button" aria-label="Close Place item" disabled={saving} onClick={close}>×</button></div>
    {error && <p role="alert">{error}</p>}
    {!document ? !error && <p role="status">Checking map and item graphics…</p> : <fieldset className="map-edit-fields" disabled={saving}>
      <div className="warp-edit-grid"><label>Item<SearchableSelect aria-label="Pickup item" value={values.item} onChange={e => update({ item: e.target.value })}>{document.items.map(item => <option key={item} value={item}>{item.replace(/_/g, " ")}</option>)}</SearchableSelect></label>
        <label>Quantity<input aria-label="Pickup quantity" type="number" min={1} max={99} value={Number.isNaN(values.quantity) ? "" : values.quantity} onChange={e => update({ quantity: e.target.valueAsNumber })} /></label>
        {(["x", "y"] as const).map(axis => <label key={axis}>{axis.toUpperCase()}<input aria-label={`Pickup ${axis.toUpperCase()}`} type="number" min={0} max={Math.min(document.npc[axis === "x" ? "width" : "height"] - 1, 251)} value={Number.isNaN(values[axis]) ? "" : values[axis]} onChange={e => update({ [axis]: e.target.valueAsNumber })} /></label>)}
      </div>
      {positionError && <p role="alert">{positionError}</p>}{quantityError && <p role="alert">Choose a quantity from 1 to 99.</p>}
      <p>Tap a suitable tile to place the item, or enter its coordinates above.</p>
      <MapPaintSurface visualization={visualization} cellSize={16} label="Item placement map" selected={{ x: values.x, y: values.y }} markers={[...visualization.npcs.map(n => ({ ...n, label: "N" })), ...visualization.warps.map(w => ({ ...w, label: "W" })), ...visualization.signs.map(s => ({ ...s, label: "S" }))]} onCell={(x, y) => update({ x, y })} disabled={saving} />
      <small>N: existing object · W: warp · S: sign. Choose an unoccupied tile.</small>
      <p className="help-text">A full bag leaves the pickup available. Successful collection hides it immediately and persists in the save. Each pickup uses one object slot. Select it afterward to edit its placement or reward.</p>
    </fieldset>}
    <div className="wizard-actions"><button type="button" disabled={saving} onClick={close}>Cancel</button><button type="button" className="primary-button" disabled={!document || saving || Boolean(positionError) || quantityError || !values.item} onClick={() => void save()}>{saving ? "Placing…" : "Place item"}</button></div>
  </dialog>;
}
