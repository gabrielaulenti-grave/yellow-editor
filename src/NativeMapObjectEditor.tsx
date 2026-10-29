import { useEffect, useRef, useState } from "react";
import { invoke } from "./platform/compat";
import { SearchableSelect } from "./editor/SearchableSelect";
import { MapPaintSurface } from "./editor/MapPaintSurface";
import { TextEditor } from "./TextEditor";
import { nativeObjectPlacementError, type NativeMapObjectDocument, type NativeMapObjectValues } from "./core/nativeMapObjects";
import type { HistorySummary, MapVisualization } from "./core/types";
import "./MapEditing.css";

export function NativeMapObjectEditor({ visualization, objectId, onClose, onSaved, onDirtyChange }: {
  visualization: MapVisualization; objectId: number; onClose(): void; onSaved(id: number, history: HistorySummary): void; onDirtyChange?(dirty: boolean): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), callback = useRef(onDirtyChange); callback.current = onDirtyChange;
  const [document, setDocument] = useState<NativeMapObjectDocument | null>(null), [values, setValues] = useState<NativeMapObjectValues | null>(null);
  const [saving, setSaving] = useState(false), [error, setError] = useState<string | null>(null), [openText, setOpenText] = useState<string | null>(null);
  const textDirty = useRef(false);
  const dirty = Boolean(document && values && JSON.stringify(document.values) !== JSON.stringify(values));
  useEffect(() => { callback.current?.(dirty || textDirty.current); }, [dirty]);
  useEffect(() => { dialog.current?.showModal(); let cancelled = false;
    void invoke<NativeMapObjectDocument>("get_native_map_object_document", { mapConstant: visualization.map.constant, objectId }).then(d => { if (!cancelled) { setDocument(d); setValues(structuredClone(d.values)); } }).catch(e => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; callback.current?.(false); }; }, [visualization.map.constant, objectId]);
  function update(patch: Partial<NativeMapObjectValues>) { setValues(v => v ? { ...v, ...patch } : v); setError(null); }
  function close() { if (!saving && (!(dirty || textDirty.current) || window.confirm("Discard the unsaved object changes?"))) onClose(); }
  const positionError = document && values ? nativeObjectPlacementError(document, values) : null;
  async function save() { if (!document || !values || saving || positionError || openText) return; setSaving(true); setError(null);
    try { onSaved(objectId, await invoke<HistorySummary>("save_native_map_object", { document, values })); } catch(e) { setError(String(e)); setSaving(false); } }
  return <dialog ref={dialog} className="wizard-dialog map-edit-dialog" aria-labelledby="native-object-title" onCancel={e => { e.preventDefault(); close(); }}>
    <div className="wizard-heading"><div><h2 id="native-object-title">Edit native {document?.kind ?? "object"} in {visualization.map.displayName}</h2><p>Edit the original object while preserving its script links and saved state.</p></div><button type="button" aria-label="Close native object editor" disabled={saving} onClick={close}>×</button></div>
    {error && <p role="alert">{error}</p>}
    {!document || !values ? !error && <p role="status">Reading native object bindings…</p> : <>
      <p><strong>{document.objectConstant}</strong></p>{document.visibility && <p>{document.visibility}</p>}{document.event && <p>Defeat flag: <code>{document.event}</code></p>}
      {document.notes.map(note => <p className="help-text" key={note}>{note}</p>)}
      {document.evidence?.length > 0 && <details><summary>How this was resolved</summary>{document.evidence.map((e, i) => <p key={i}><code>{e.path}:{e.line}</code> — {e.detail}</p>)}</details>}
      {document.reason && <p role="status">{document.reason}</p>}
      <fieldset className="map-edit-fields" disabled={saving || Boolean(document.reason) || Boolean(openText)}>
        {document.kind === "item" && <label>Item<SearchableSelect disabled={Boolean(document.itemReason)} aria-label="Native pickup item" value={values.item ?? ""} onChange={e => update({ item: e.target.value })}>{document.items.map(i => <option key={i} value={i}>{i.replace(/_/g, " ")}</option>)}</SearchableSelect>{document.itemReason && <small>{document.itemReason}</small>}</label>}
        {document.kind === "trainer" && <div className="warp-edit-grid"><label>Party<SearchableSelect disabled={Boolean(document.partyReason)} aria-label="Native trainer party" value={values.partyId ?? ""} onChange={e => update({ partyId: e.target.value })}>{document.parties.map(p => <option key={p.id} value={p.id}>{p.className} #{p.partyNumber}: {p.pokemon.map(m => `${m.speciesConstant} Lv.${m.level}`).join(", ")}</option>)}</SearchableSelect>{document.partyReason && <small>{document.partyReason}</small>}</label><label>Sight range<input disabled={Boolean(document.sightReason)} type="number" aria-label="Native trainer sight range" min={0} max={15} value={values.sight ?? ""} onChange={e => update({ sight: e.target.valueAsNumber })} />{document.sightReason && <small>{document.sightReason}</small>}</label></div>}
        {document.placementReason && <p role="status">{document.placementReason}</p>}{document.appearanceReason && <p role="status">{document.appearanceReason}</p>}
        <p className="help-text">{document.placement.spriteNote}</p>
        <fieldset className="map-edit-fields" disabled={Boolean(document.placementReason)}><div className="warp-edit-grid">
          <label>Character<SearchableSelect disabled={Boolean(document.appearanceReason)} aria-label="Native object character" value={values.sprite} onChange={e => update({ sprite: e.target.value })}>{document.placement.sprites.map(s => <option key={s} value={s}>{s.replace(/^SPRITE_/, "").replace(/_/g, " ")}</option>)}</SearchableSelect></label>
          <label>Facing<select disabled={Boolean(document.appearanceReason)} aria-label="Native object facing" value={values.direction} onChange={e => update({ direction: e.target.value })}>{["DOWN", "UP", "LEFT", "RIGHT", ...(document.kind === "item" ? ["NONE"] : [])].map(d => <option key={d}>{d}</option>)}</select></label>
          {(["x", "y"] as const).map(axis => <label key={axis}>{axis.toUpperCase()}<input type="number" aria-label={`Native object ${axis.toUpperCase()}`} min={0} max={document.placement[axis === "x" ? "width" : "height"] - 1} value={Number.isNaN(values[axis]) ? "" : values[axis]} onChange={e => update({ [axis]: e.target.valueAsNumber })} /></label>)}
        </div><MapPaintSurface visualization={visualization} cellSize={16} label="Native object placement map" selected={{ x: values.x, y: values.y }} markers={document.placement.occupied.map(p => ({ ...p, label: "×" }))} disabled={Boolean(document.reason || document.placementReason || openText) || saving} onCell={(x, y) => update({ x, y })} /></fieldset>
        {positionError && <p role="alert">{positionError}</p>}
      </fieldset>
      {document.dialogues.map((d, i) => <TextEditor key={d.role} title={d.role} target={{ path: d.document.path, label: d.document.label }} initialText={null} controlledSegments={values.dialogues[i]} controlledTerminator={d.document.terminator} controlledCanEditStructure={d.document.canEditStructure} disabled={saving || Boolean(document.reason) || Boolean(openText && openText !== d.role)}
        onControlledSegmentsChange={segments => { const next = structuredClone(values.dialogues); document.dialogues.forEach((other, j) => { if (other.document.path === d.document.path && other.document.label === d.document.label) next[j] = structuredClone(segments); }); update({ dialogues: next }); }}
        onEditStateChange={(open, pending) => { setOpenText(open ? d.role : null); textDirty.current = pending; callback.current?.(dirty || pending); }} />)}
    </>}
    <div className="wizard-actions"><button type="button" disabled={saving} onClick={close}>Cancel</button><button type="button" className="primary-button" disabled={!document || !values || saving || Boolean(document?.reason || positionError || openText)} onClick={() => void save()}>{saving ? "Saving…" : "Save object"}</button></div>
  </dialog>;
}
