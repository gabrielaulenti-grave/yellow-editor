import { useEffect, useRef, useState } from "react";
import { invoke } from "./platform/compat";
import { SearchableSelect } from "./editor/SearchableSelect";
import { MapPaintSurface } from "./editor/MapPaintSurface";
import type { HistorySummary, MapVisualization, MapWarpDocument, MapWarpValues } from "./core/types";
import "./MapEditing.css";

export function MapWarpEditor({ visualization, warpId, onClose, onSaved, onDirtyChange }: {
  visualization: MapVisualization; warpId: number | null;
  onClose(): void; onSaved(history: HistorySummary): void; onDirtyChange?(dirty: boolean): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [document, setDocument] = useState<MapWarpDocument | null>(null), [values, setValues] = useState<MapWarpValues | null>(null);
  const [destination, setDestination] = useState<MapVisualization | null>(null);
  const [destinationLoading, setDestinationLoading] = useState(false);
  const [error, setError] = useState<string | null>(null), [saving, setSaving] = useState(false);
  const baseline = useRef("");
  const signature = (value: MapWarpValues) => JSON.stringify({ ...value, destinationDocument: null });
  const dirty = Boolean(values && (warpId === null || signature(values) !== baseline.current));
  const callback = useRef(onDirtyChange); callback.current = onDirtyChange;
  useEffect(() => { callback.current?.(dirty); }, [dirty]);
  useEffect(() => () => callback.current?.(false), []);
  useEffect(() => {
    dialog.current?.showModal(); let cancelled = false;
    void invoke<MapWarpDocument>("get_map_warp_document", { mapConstant: visualization.map.constant }).then(next => {
      if (cancelled) return;
      const warp = next.warps.find(warp => warp.id === warpId);
      const initial: MapWarpValues = { id: warpId, x: warp?.x ?? 0, y: warp?.y ?? 0,
        destinationMap: warp?.destinationMap ?? next.maps.find(map => map.constant !== next.mapConstant)?.constant ?? next.mapConstant,
        destinationWarpId: warp?.destinationWarpId ?? 1, pair: null, destinationDocument: null };
      baseline.current = signature(initial); setDocument(next); setValues(initial);
    }).catch(reason => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
  }, [visualization.map.constant, warpId]);
  useEffect(() => {
    const mapConstant = values?.destinationMap;
    setDestination(null);
    if (!mapConstant || mapConstant === "LAST_MAP") { setDestinationLoading(false); return; }
    let cancelled = false; setDestinationLoading(true);
    void Promise.all([
      invoke<MapWarpDocument>("get_map_warp_document", { mapConstant }),
      invoke<MapVisualization>("get_map_visualization", { mapConstant }),
    ]).then(([doc, preview]) => {
      if (!cancelled) { setDestination(preview); setValues(old => old ? { ...old, destinationDocument: doc } : old); }
    }).catch(reason => { if (!cancelled) setError(String(reason)); }).finally(() => { if (!cancelled) setDestinationLoading(false); });
    return () => { cancelled = true; };
  }, [values?.destinationMap]);
  function update(patch: Partial<MapWarpValues>) { setValues(old => old ? { ...old, ...patch } : old); setError(null); }
  function close() { if (!saving && (!dirty || window.confirm("Discard the unsaved warp changes?"))) onClose(); }
  async function save() {
    if (!document || !values || saving) return;
    setSaving(true); setError(null);
    try { onSaved(await invoke<HistorySummary>("save_map_warp", { document, values })); }
    catch (reason) { setError(String(reason)); setSaving(false); }
  }
  function coords(kind: "source" | "return") {
    if (!values || !document) return null;
    const point = kind === "source" ? values : values.pair;
    if (!point) return null;
    return <div className="warp-edit-grid">{(["x", "y"] as const).map(axis => <label key={axis}>{axis.toUpperCase()}<input type="number" aria-label={`${kind === "source" ? "Warp" : "Return warp"} ${axis.toUpperCase()}`} min={0}
      max={(kind === "source" ? axis === "x" ? document.width : document.height : (axis === "x" ? destination?.map.width : destination?.map.height) ?? 0) * (kind === "source" ? 1 : 2) - 1}
      value={Number.isNaN(point[axis]) ? "" : point[axis]} onChange={e => update(kind === "source" ? { [axis]: e.target.valueAsNumber } : { pair: { ...point, [axis]: e.target.valueAsNumber } })} /></label>)}</div>;
  }
  const missingDestination = values?.destinationMap !== "LAST_MAP" && !values?.destinationDocument;
  return <dialog ref={dialog} className="wizard-dialog map-edit-dialog" aria-labelledby="warp-edit-title" onCancel={event => { event.preventDefault(); close(); }}>
    <div className="wizard-heading"><div><h2 id="warp-edit-title">{warpId === null ? "Add warp" : `Edit warp #${warpId}`}{document ? ` in ${document.mapName}` : ""}</h2><p>Choose an entrance and its destination. Positions use the 16×16 player movement grid.</p></div><button type="button" aria-label="Close warp editor" disabled={saving} onClick={close}>×</button></div>
    {error && <p role="alert">{error}</p>}
    {!values || !document ? <p role="status">{error ? "Warp editing is unavailable for this map." : "Reading warp tables…"}</p> : <>
      <fieldset disabled={saving} className="map-edit-fields"><div className="terrain-workspace">
        <section><h3>Entrance in {document.mapName}</h3>{coords("source")}
          <MapPaintSurface disabled={saving} visualization={visualization} cellSize={16} label="Place entrance warp" selected={{ x: values.x, y: values.y }} onCell={(x, y) => update({ x, y })} />
          <p>Place the entrance on a door, stair, ladder or other warp tile. A warp on ordinary ground may not activate. Existing collision and directional warp rules still apply.</p>
        </section><section><h3>Destination</h3>
          <label>Destination map<SearchableSelect aria-label="Destination map" value={values.destinationMap} onChange={e => update({ destinationMap: e.target.value, destinationWarpId: 1, destinationDocument: null, pair: null })}>
            {document.maps.map(map => <option key={map.constant} value={map.constant}>{map.displayName}</option>)}<option value="LAST_MAP">LAST_MAP (last outdoor map)</option>
          </SearchableSelect></label>
          {values.destinationMap === "LAST_MAP" ? <><label>Destination warp ID<input type="number" min={1} max={document.maxWarps} aria-label="Destination warp ID" value={Number.isNaN(values.destinationWarpId) ? "" : values.destinationWarpId} onChange={e => update({ destinationWarpId: e.target.valueAsNumber })} /></label><p>LAST_MAP depends on the outdoor map recorded by the game. Use an explicit map for a new house with a fixed entrance.</p></> : <>
            <label className="map-edit-ack"><input type="checkbox" checked={Boolean(values.pair)} disabled={missingDestination || values.destinationMap === document.mapConstant} onChange={e => update({ pair: e.target.checked ? { x: 0, y: 0 } : null })} />Create a new return warp in the destination</label>
            {destinationLoading && <p role="status">Loading destination…</p>}
            {values.destinationDocument && !values.pair && <label>Destination warp<select aria-label="Destination warp" value={values.destinationWarpId} onChange={e => update({ destinationWarpId: Number(e.target.value) })}>
              {!values.destinationDocument.warps.length && <option value={1}>No existing warps — create a return warp</option>}
              {values.destinationDocument.warps.map(warp => <option key={warp.id} value={warp.id}>#{warp.id} at ({warp.x}, {warp.y})</option>)}
            </select></label>}
            {values.pair && <><p>Return warp #{(values.destinationDocument?.warps.length ?? 0) + 1} will lead back to entrance #{warpId ?? document.warps.length + 1}. Both maps save together.</p>{coords("return")}</>}
            {destination && <MapPaintSurface disabled={saving} visualization={destination} cellSize={16} label={values.pair ? "Place return warp" : "Destination warp preview"}
              selected={values.pair ?? (() => { const warp = destination.warps.find(warp => warp.id === values.destinationWarpId); return warp ? { x: warp.x, y: warp.y } : undefined; })()}
              onCell={values.pair ? (x, y) => update({ pair: { x, y } }) : undefined} />}
          </>}
        </section>
      </div><p className="help-text">Existing warp IDs stay in place. New warps append to the table; the game regenerates arrival coordinates during compilation. This editor links existing maps.</p></fieldset>
      <div className="wizard-actions"><button type="button" disabled={saving} onClick={close}>Cancel</button><button type="button" className="primary-button" disabled={saving || !dirty || destinationLoading || missingDestination || (warpId === null && document.warps.length >= document.maxWarps)} onClick={() => void save()}>{saving ? "Saving…" : values.pair ? "Save entrance and return" : "Save warp"}</button></div>
    </>}
  </dialog>;
}
