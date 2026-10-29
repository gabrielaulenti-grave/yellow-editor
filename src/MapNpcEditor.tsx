import { useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "./platform/compat";
import { SearchableSelect } from "./editor/SearchableSelect";
import type { HistorySummary, MapNpcEditDocument, MapNpcEditValues } from "./core/types";
import "./MapNpcWizard.css";

export function MapNpcEditor({ mapConstant, objectId, renderPlacement, onClose, onSaved, onDirtyChange }: {
  mapConstant: string; objectId: number;
  renderPlacement(x: number, y: number, onPlace: (x: number, y: number) => void): ReactNode;
  onClose(): void; onSaved(objectId: number, history: HistorySummary): void; onDirtyChange?(dirty: boolean): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [document, setDocument] = useState<MapNpcEditDocument | null>(null);
  const [values, setValues] = useState<MapNpcEditValues | null>(null);
  const [error, setError] = useState<string | null>(null), [saving, setSaving] = useState(false);
  const callback = useRef(onDirtyChange); callback.current = onDirtyChange;
  const dirty = Boolean(document && values && JSON.stringify(document.values) !== JSON.stringify(values));
  useEffect(() => { callback.current?.(dirty); }, [dirty]);
  useEffect(() => () => callback.current?.(false), []);
  useEffect(() => {
    dialog.current?.showModal(); let cancelled = false;
    void invoke<MapNpcEditDocument>("get_map_npc_edit_document", { mapConstant, objectId }).then(next => {
      if (!cancelled) { setDocument(next); setValues(structuredClone(next.values)); }
    }).catch(reason => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
  }, [mapConstant, objectId]);
  const update = (patch: Partial<MapNpcEditValues>) => { setValues(old => old ? { ...old, ...patch } : old); setError(null); };
  function close() { if (!saving && (!dirty || window.confirm("Discard the unsaved NPC changes?"))) onClose(); }
  const moved = document && values && (values.x !== document.values.x || values.y !== document.values.y);
  const placementError = !document || !values ? null : !Number.isInteger(values.x) || !Number.isInteger(values.y) || values.x < 0 || values.y < 0 || values.x >= Math.min(document.width, 252) || values.y >= Math.min(document.height, 252)
    ? "Choose a whole-number position inside the map."
    : moved && document.occupied.some(point => point.x === values.x && point.y === values.y) ? "This position contains an object, warp or sign."
    : moved && !document.walkable.some(point => point.x === values.x && point.y === values.y) ? "Choose walkable ground for the NPC." : null;
  async function save() {
    if (!document || !values || !dirty || document.reason || placementError) return;
    setSaving(true); setError(null);
    try { onSaved(objectId, await invoke<HistorySummary>("save_map_npc", { document, values })); }
    catch (reason) { setError(String(reason)); setSaving(false); }
  }
  return <dialog ref={dialog} className="wizard-dialog npc-create-dialog" aria-labelledby="npc-edit-title" onCancel={event => { event.preventDefault(); close(); }}>
    <div className="wizard-heading"><div><h2 id="npc-edit-title">Edit NPC{document ? ` in ${document.mapName}` : ""}</h2><p>Move this character or change their appearance and movement.</p></div><button type="button" aria-label="Close Edit NPC" disabled={saving} onClick={close}>×</button></div>
    {error && <p role="alert" className="npc-create-error">{error}</p>}
    {!document || !values ? <p role="status">{error ? "NPC editing is unavailable for this object." : "Checking NPC and scene compatibility…"}</p> : <>
      {document.reason && <p role="alert">{document.reason}</p>}
      <fieldset className="npc-create-fields" disabled={saving || Boolean(document.reason)}><div className="wizard-page">
        <p>Click or tap walkable ground, or enter X/Y coordinates. Coordinates start at (0, 0) in the top-left corner.</p>
        {renderPlacement(values.x, values.y, (x, y) => { if (!saving && !document.reason) update({ x, y }); })}
        <div className="npc-create-grid">{(["x", "y"] as const).map(axis => <label key={axis}>{axis.toUpperCase()}<input aria-label={`NPC ${axis.toUpperCase()}`} type="number" min={0} max={Math.min((axis === "x" ? document.width : document.height) - 1, 251)} value={Number.isNaN(values[axis]) ? "" : values[axis]} onChange={e => update({ [axis]: e.target.valueAsNumber })} /></label>)}</div>
        {document.appearanceReason && <p className="help-text">{document.appearanceReason}</p>}
        <label>Character<SearchableSelect disabled={Boolean(document.appearanceReason)} aria-label="NPC character" value={values.sprite} onChange={e => update({ sprite: e.target.value, ...(document.stationarySprites.includes(e.target.value) ? { movement: "STAY", direction: "DOWN" } : {}) })}>{document.sprites.map(sprite => <option key={sprite} value={sprite}>{sprite.replace(/^SPRITE_/, "").replace(/_/g, " ")}</option>)}</SearchableSelect></label><small>{document.spriteNote}</small>
        {document.stationarySprites.includes(values.sprite) && <p className="help-text">Stationary sprite: one pose, no walking animation. Dialogue, visibility, emotes and battles are available.</p>}
        <div className="npc-create-grid"><label>Movement<select disabled={Boolean(document.appearanceReason)} aria-label="NPC movement" value={values.movement} onChange={e => { const movement = e.target.value as "STAY" | "WALK"; update({ movement, direction: movement === "STAY" ? "DOWN" : "ANY_DIR" }); }}><option value="STAY">Stay in place</option><option value="WALK" disabled={document.linkedScenes.length > 0 || document.stationarySprites.includes(values.sprite)}>Wander</option></select></label>
          <label>{values.movement === "STAY" ? "Facing" : "Wandering"}<select disabled={Boolean(document.appearanceReason)} aria-label="NPC direction" value={values.direction} onChange={e => update({ direction: e.target.value })}>{(document.stationarySprites.includes(values.sprite) ? ["DOWN"] : values.movement === "STAY" ? ["DOWN", "UP", "LEFT", "RIGHT"] : ["ANY_DIR", "UP_DOWN", "LEFT_RIGHT"]).map(direction => <option key={direction} value={direction}>{direction.replace(/_/g, " ")}</option>)}</select></label></div>
        {document.linkedScenes.length > 0 && <><strong>Linked scenes</strong><label className="npc-edit-toggle"><input type="checkbox" checked={values.moveSceneStart} onChange={e => update({ moveSceneStart: e.target.checked })} />Move linked player starts and coordinate triggers by the same offset</label>
          <ul>{document.linkedScenes.map(scene => <li key={scene.label}>{scene.label}: player ({scene.playerX + (values.moveSceneStart ? values.x - document.values.x : 0)}, {scene.playerY + (values.moveSceneStart ? values.y - document.values.y : 0)})</li>)}</ul></>}
        {placementError && <p role="alert">{placementError}</p>}
        <small>NPC #{document.objectId} keeps its dialogue and actions. Linked routes are rechecked before saving. All changes can be undone together.</small>
      </div></fieldset>
      <div className="wizard-actions"><button type="button" disabled={saving} onClick={close}>Cancel</button><button type="button" className="primary-button" disabled={saving || !dirty || Boolean(document.reason || placementError)} onClick={() => void save()}>{saving ? "Saving…" : "Save NPC"}</button></div>
    </>}
  </dialog>;
}
