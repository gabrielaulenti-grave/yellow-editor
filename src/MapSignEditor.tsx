import { useEffect, useRef, useState } from "react";
import { invoke } from "./platform/compat";
import { MapPaintSurface } from "./editor/MapPaintSurface";
import { TextEditor } from "./TextEditor";
import { mapSignPositionError, type MapSignDocument, type MapSignValues } from "./core/mapSigns";
import type { HistorySummary, MapVisualization } from "./core/types";
import "./MapEditing.css";

export function MapSignEditor({ visualization, signId, onClose, onSaved, onDirtyChange }: {
  visualization: MapVisualization; signId: number | null; onClose(): void; onSaved(id: number, history: HistorySummary): void; onDirtyChange?(dirty: boolean): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), callback = useRef(onDirtyChange); callback.current = onDirtyChange;
  const [document, setDocument] = useState<MapSignDocument | null>(null), [values, setValues] = useState<MapSignValues | null>(null);
  const [error, setError] = useState<string | null>(null), [saving, setSaving] = useState(false), [textOpen, setTextOpen] = useState(false);
  const textDirty = useRef(false), dirty = Boolean(document && values && JSON.stringify(values) !== JSON.stringify(document.values));
  useEffect(() => { callback.current?.(dirty || textDirty.current); }, [dirty]);
  useEffect(() => { dialog.current?.showModal(); let cancelled = false;
    void invoke<MapSignDocument>("get_map_sign_document", { mapConstant: visualization.map.constant, signId }).then(d => { if (!cancelled) { setDocument(d); setValues(structuredClone(d.values)); } }).catch(e => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; callback.current?.(false); };
  }, [visualization.map.constant, signId]);
  function update(patch: Partial<MapSignValues>) { setValues(v => v ? { ...v, ...patch } : v); setError(null); }
  function close() { if (!saving && (!(dirty || textDirty.current) || window.confirm("Discard the unsaved sign changes?"))) onClose(); }
  const positionError = document && values ? mapSignPositionError(document, values) : null;
  const blocked = signId === null ? document?.createReason : null;
  async function save() { if (!document || !values || saving || positionError || blocked || textOpen) return; setSaving(true); setError(null);
    try { onSaved(signId ?? visualization.signs.length + 1, await invoke<HistorySummary>("save_map_sign", { document, values })); } catch(e) { setError(String(e)); setSaving(false); } }
  return <dialog ref={dialog} className="wizard-dialog map-edit-dialog" aria-labelledby="map-sign-title" onCancel={e => { e.preventDefault(); close(); }}>
    <div className="wizard-heading"><div><h2 id="map-sign-title">{signId === null ? "Place sign" : `Edit sign #${signId}`} in {visualization.map.displayName}</h2><p>Positions use the 16×16 movement grid. Place signs where the player can face and read them.</p></div><button type="button" aria-label="Close sign editor" disabled={saving} onClick={close}>×</button></div>
    {error && <p role="alert">{error}</p>}{blocked && <p role="status">{blocked}</p>}
    {!document || !values ? !error && <p role="status">Reading sign bindings…</p> : <>
      <fieldset className="map-edit-fields" disabled={saving || textOpen || Boolean(blocked)}>
        <div className="warp-edit-grid">{(["x", "y"] as const).map(axis => <label key={axis}>{axis.toUpperCase()}<input aria-label={`Sign ${axis.toUpperCase()}`} type="number" min={0} max={Math.min(document[axis === "x" ? "width" : "height"], 256) - 1} value={Number.isNaN(values[axis]) ? "" : values[axis]} onChange={e => update({ [axis]: e.target.valueAsNumber })} /></label>)}</div>
        {positionError && <p role="alert">{positionError}</p>}
        <MapPaintSurface visualization={visualization} cellSize={16} label="Sign placement map" selected={{ x: values.x, y: values.y }} markers={document.occupied.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y)).map(p => ({ ...p, label: "×" }))} onCell={(x, y) => update({ x, y })} disabled={saving || textOpen || Boolean(blocked)} />
        {signId === null && <label className="map-sign-dialogue">Sign dialogue<textarea aria-label="New sign dialogue" rows={5} value={values.lines.join("\n")} onChange={e => update({ lines: e.target.value.split("\n") })} /><small>One game-text row per line; up to 16 rows. Long rows are checked before saving.</small></label>}
      </fieldset>
      {document.dialogueReason && <p role="status">{document.dialogueReason}</p>}
      {document.dialogue && <>
        <p className="help-text">Editing this text changes its existing source. Other interactions can share it.</p>
        <details><summary>Text source and callers</summary><p><code>{document.dialogue.path}:{document.dialogue.label}</code></p>{document.sharedCallers.map((c, i) => <p key={i}><code>{c.path}:{c.line}</code></p>)}</details>
        <TextEditor title="Sign dialogue" target={{ path: document.dialogue.path, label: document.dialogue.label }} initialText={null} controlledSegments={values.segments} controlledTerminator={document.dialogue.terminator} controlledCanEditStructure={document.dialogue.canEditStructure} disabled={saving}
          onControlledSegmentsChange={segments => update({ segments })} onEditStateChange={(open, pending) => { setTextOpen(open); textDirty.current = pending; callback.current?.(dirty || pending); }} />
      </>}
    </>}
    <div className="wizard-actions"><button type="button" disabled={saving} onClick={close}>Cancel</button><button type="button" className="primary-button" disabled={!document || !values || saving || Boolean(positionError || blocked) || textOpen} onClick={() => void save()}>{saving ? "Saving…" : "Save sign"}</button></div>
  </dialog>;
}
