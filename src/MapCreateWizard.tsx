import { useEffect, useRef, useState } from "react";
import { invoke } from "./platform/compat";
import { SearchableSelect } from "./editor/SearchableSelect";
import { MapPaintSurface } from "./editor/MapPaintSurface";
import type { MapCreateDocument, MapCreateResult, MapCreateValues, MapVisualization } from "./core/types";
import "./MapEditing.css";

export function MapCreateWizard({ exterior, onClose, onCreated, onDirtyChange }: {
  exterior: MapVisualization | null; onClose(): void; onCreated(result: MapCreateResult): void; onDirtyChange?(dirty: boolean): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), callback = useRef(onDirtyChange); callback.current = onDirtyChange;
  const initialValues = useRef<string | null>(null);
  const [template, setTemplate] = useState("BLUES_HOUSE"), [document, setDocument] = useState<MapCreateDocument | null>(null);
  const [values, setValues] = useState<MapCreateValues | null>(null), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = Boolean(values && (JSON.stringify(values) !== initialValues.current || template !== "BLUES_HOUSE"));
  useEffect(() => { callback.current?.(dirty); }, [dirty]);
  useEffect(() => () => callback.current?.(false), []);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    let cancelled = false; setLoading(true); setError(null);
    void invoke<MapCreateDocument>("get_map_create_document", { templateConstant: template }).then(next => {
      if (cancelled) return;
      const v = next.visualization, exit = v.warps[0];
      setDocument(next);
      setValues(old => { const nextValues: MapCreateValues = { constant: old?.constant ?? "", width: v.map.width, height: v.map.height, layout: "copy", fillBlock: v.mapBlocks[v.map.width + 1] ?? 0,
        borderBlock: next.borderBlock, locationMap: old?.locationMap ?? next.locations.find(map => map.constant === exterior?.map.constant)?.constant ?? "PALLET_TOWN", musicMap: template,
        connection: old?.connection && exterior ? { ...old.connection, interiorX: exit?.x ?? 0, interiorY: exit?.y ?? 0 } : null }; if (initialValues.current === null) initialValues.current = JSON.stringify(nextValues); return nextValues; });
    }).catch(reason => { if (!cancelled) setError(String(reason)); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [template]);
  function update(patch: Partial<MapCreateValues>) { setValues(old => old ? { ...old, ...patch } : old); setError(null); }
  function close() { if (!saving && (!dirty || window.confirm("Discard the unsaved new map?"))) onClose(); }
  async function save() {
    if (!document || !values) return;
    setSaving(true); setError(null);
    try { onCreated(await invoke<MapCreateResult>("create_map", { document, values })); }
    catch (reason) { setError(String(reason)); setSaving(false); }
  }
  const v = document?.visualization;
  const dimensionError = values && (!Number.isInteger(values.width) || !Number.isInteger(values.height) || values.width < 2 || values.height < 2 || values.width > 64 || values.height > 64)
    ? "Choose whole-number dimensions from 2 to 64 blocks."
    : values && (values.width + 6) * (values.height + 6) > 1300 ? "This map exceeds the 1300-block map buffer, including its border. Choose smaller dimensions." : null;
  const preview = v && values && Number.isInteger(values.width) && Number.isInteger(values.height) && values.width >= 2 && values.height >= 2 && (values.width + 6) * (values.height + 6) <= 1300
    ? { ...v, map: { ...v.map, width: values.width, height: values.height }, mapBlocks: values.layout === "copy" ? v.mapBlocks : Array(values.width * values.height).fill(values.fillBlock) } : null;
  return <dialog ref={dialog} className="wizard-dialog map-edit-dialog" aria-labelledby="create-map-title" onCancel={event => { event.preventDefault(); close(); }}>
    <div className="wizard-heading"><div><h2 id="create-map-title">Create map</h2><p>Create an independent interior, then edit its terrain, warps, NPCs and dialogue in Maps.</p></div><button type="button" disabled={saving} aria-label="Close Create map" onClick={close}>×</button></div>
    {error && <p role="alert">{error}</p>}
    {loading && <p role="status">Reading terrain and checking map tables…</p>}
    {document && values && v && <>
      <fieldset className="map-edit-fields" disabled={saving || loading}>
        <div className="warp-edit-grid"><label className="map-create-name">Map constant<input aria-label="New map constant" placeholder="PALLET_NEW_HOUSE" value={values.constant} maxLength={48} onChange={event => update({ constant: event.target.value.toUpperCase().replace(/ /g, "_") })} /></label>
          <label>Terrain template<SearchableSelect aria-label="Terrain template" value={template} onChange={event => setTemplate(event.target.value)}>{document.templates.map(map => <option key={map.constant} value={map.constant}>{map.displayName}</option>)}</SearchableSelect></label>
        </div>
        <p>Map ID ${document.nextId.toString(16).toUpperCase()} · {document.remainingIds} available IDs. Existing IDs stay in place.</p>
        <p>The template supplies terrain and a tileset. The new map starts with its own empty object list and script.</p>
        <div className="warp-edit-grid"><label>Starting terrain<select aria-label="Starting terrain" value={values.layout} onChange={event => update({ layout: event.target.value as "copy" | "blank", width: v.map.width, height: v.map.height })}><option value="copy">Copy the template's terrain</option><option value="blank">Blank map with custom dimensions</option></select></label>
          {(["width", "height"] as const).map(axis => <label key={axis}>{axis === "width" ? "Width" : "Height"} in blocks<input aria-label={`New map ${axis}`} type="number" min={2} max={64} disabled={values.layout === "copy"} value={Number.isNaN(values[axis]) ? "" : values[axis]} onChange={event => update({ [axis]: event.target.valueAsNumber })} /></label>)}
          {values.layout === "blank" && <label>Fill block<select aria-label="New map fill block" value={values.fillBlock} onChange={event => update({ fillBlock: Number(event.target.value) })}>{Array.from({ length: Math.min(v.blockCount, 256) }, (_, id) => <option key={id} value={id}>#{id}</option>)}</select></label>}
          <label>Border block<select aria-label="New map border block" value={values.borderBlock} onChange={event => update({ borderBlock: Number(event.target.value) })}>{Array.from({ length: Math.min(v.blockCount, 256) }, (_, id) => <option key={id} value={id}>#{id}</option>)}</select></label>
        </div>
        {dimensionError && <p role="alert">{dimensionError}</p>}
        <div className="warp-edit-grid"><label>Town-map location<SearchableSelect aria-label="Town-map location" value={values.locationMap} onChange={event => update({ locationMap: event.target.value })}>{document.locations.map(map => <option key={map.constant} value={map.constant}>{map.displayName}</option>)}</SearchableSelect></label>
          <label>Music from<SearchableSelect aria-label="New map music" value={values.musicMap} onChange={event => update({ musicMap: event.target.value })}>{[...document.locations, ...document.templates].map(map => <option key={map.constant} value={map.constant}>{map.displayName}</option>)}</SearchableSelect></label></div>
        {exterior && <label className="map-edit-ack"><input type="checkbox" checked={Boolean(values.connection)} onChange={event => update({ connection: event.target.checked ? { exteriorMap: exterior.map.constant, exteriorX: 0, exteriorY: 0, interiorX: v.warps[0]?.x ?? 0, interiorY: v.warps[0]?.y ?? 0 } : null })} />Connect to {exterior.map.displayName} now with entrance and return warps</label>}
        <div className="terrain-workspace"><section><h3>New interior preview</h3>
          {values.connection && <div className="warp-edit-grid">{(["interiorX", "interiorY"] as const).map(axis => <label key={axis}>Exit {axis.endsWith("X") ? "X" : "Y"}<input type="number" aria-label={`New map exit ${axis.endsWith("X") ? "X" : "Y"}`} value={Number.isNaN(values.connection![axis]) ? "" : values.connection![axis]} onChange={event => update({ connection: { ...values.connection!, [axis]: event.target.valueAsNumber } })} /></label>)}</div>}
          {preview && <MapPaintSurface disabled={saving || loading} visualization={preview} cellSize={16} label="New map terrain preview" selected={values.connection ? { x: values.connection.interiorX, y: values.connection.interiorY } : undefined} onCell={values.connection ? (x, y) => update({ connection: { ...values.connection!, interiorX: x, interiorY: y } }) : undefined} />}
        </section>
        <section>{values.connection && exterior ? <><h3>Entrance in {exterior.map.displayName}</h3><div className="warp-edit-grid">{(["exteriorX", "exteriorY"] as const).map(axis => <label key={axis}>Entrance {axis.endsWith("X") ? "X" : "Y"}<input type="number" aria-label={`New map entrance ${axis.endsWith("X") ? "X" : "Y"}`} value={Number.isNaN(values.connection![axis]) ? "" : values.connection![axis]} onChange={event => update({ connection: { ...values.connection!, [axis]: event.target.valueAsNumber } })} /></label>)}</div>
          <MapPaintSurface disabled={saving || loading} visualization={exterior} cellSize={16} label="Place new map entrance" selected={{ x: values.connection.exteriorX, y: values.connection.exteriorY }} onCell={(x, y) => update({ connection: { ...values.connection!, exteriorX: x, exteriorY: y } })} />
          <p>Place both warps on suitable door, stair or warp tiles. Terrain keeps the tileset's existing collision and activation rules.</p></> : <p>You can add entrance and exit warps after creating the map. Blank maps need suitable terrain before their warps will activate.</p>}</section></div>
        <p className="help-text">No wild encounters are assigned initially. All files, table entries and optional entrance/return warps save together and can be undone together. Compile and playtest before distributing the edited game.</p>
      </fieldset>
      <div className="wizard-actions"><button type="button" disabled={saving} onClick={close}>Cancel</button><button type="button" className="primary-button" disabled={saving || loading || document.templateConstant !== template || !values.constant.trim() || Boolean(dimensionError) || !preview} onClick={() => void save()}>{saving ? "Creating…" : "Create map"}</button></div>
    </>}
  </dialog>;
}
