import { useEffect, useRef, useState } from "react";
import { invoke } from "./platform/compat";
import { SearchableSelect } from "./editor/SearchableSelect";
import { MapPaintSurface } from "./editor/MapPaintSurface";
import { trainerPlacementError, trainerDelta, type MapTrainerDocument } from "./core/mapTrainers";
import { textLineLengthError } from "./core/textEditing";
import type { HistorySummary, MapVisualization } from "./core/types";
import "./MapEditing.css";

export function MapTrainerEditor({ visualization, objectId, onClose, onSaved, onDirtyChange }: {
  visualization: MapVisualization; objectId: number | null; onClose(): void; onSaved(id: number, history: HistorySummary): void; onDirtyChange?(dirty: boolean): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), callback = useRef(onDirtyChange); callback.current = onDirtyChange;
  const [document, setDocument] = useState<MapTrainerDocument | null>(null), [values, setValues] = useState<MapTrainerDocument["values"] | null>(null), [error, setError] = useState<string | null>(null), [saving, setSaving] = useState(false);
  const dirty = Boolean(document && values && JSON.stringify(values) !== JSON.stringify(document.values));
  useEffect(() => { callback.current?.(dirty); }, [dirty]);
  useEffect(() => { dialog.current?.showModal(); let cancelled = false;
    void invoke<MapTrainerDocument>("get_map_trainer_document", { mapConstant: visualization.map.constant, ...(objectId === null ? {} : { objectId }) }).then(d => { if (!cancelled) { setDocument(d); setValues(d.values); } }).catch(e => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; callback.current?.(false); }; }, [visualization.map.constant, objectId]);
  function update(patch: Partial<MapTrainerDocument["values"]>) { setValues(v => v ? { ...v, ...patch } : v); setError(null); }
  function close() { if (!saving && (!dirty || window.confirm("Discard the unsaved trainer changes?"))) onClose(); }
  const placementError = document && values ? trainerPlacementError(document, values) : null;
  const textError = values ? (["before", "defeat", "after"] as const).map(role => !values[role].some(t => t.trim()) ? "Enter each dialogue." : values[role].length > 16 ? "Use at most 16 rows per dialogue." : values[role].map((t, i) => textLineLengthError(t, i === 0 ? 18 : 17)).find(Boolean)).find(Boolean) : null;
  const party = document?.parties.find(p => p.id === values?.partyId), classes = [...new Map(document?.parties.map(p => [p.classConstant, p.className]) ?? []).entries()];
  const step = values && trainerDelta[values.facing], sight = values && step ? Array.from({ length: values.sight >= 0 && values.sight <= 8 ? values.sight : 0 }, (_, i) => ({ x: values.x + step.x * (i + 1), y: values.y + step.y * (i + 1), label: String(i + 1) })) : [];
  async function save() { if (!document || !values || placementError || textError || saving) return; setSaving(true); setError(null);
    try { onSaved(document.objectId ?? document.npc.objectId, await invoke<HistorySummary>("save_map_trainer", { document, values })); } catch (e) { setError(String(e)); setSaving(false); } }
  return <dialog ref={dialog} className="wizard-dialog map-edit-dialog" aria-labelledby="map-trainer-title" onCancel={e => { e.preventDefault(); close(); }}>
    <div className="wizard-heading"><div><h2 id="map-trainer-title">{objectId === null ? "Place trainer" : "Edit trainer"} in {visualization.map.displayName}</h2><p>Place a trainer, choose their party and write their battle dialogue.</p></div><button type="button" aria-label="Close trainer editor" disabled={saving} onClick={close}>×</button></div>
    {error && <p role="alert">{error}</p>}
    {!document || !values ? !error && <p role="status">Checking trainer data, map scripts and available graphics…</p> : <fieldset className="map-edit-fields" disabled={saving}>
      <div className="warp-edit-grid"><label>Trainer class<SearchableSelect aria-label="Placed trainer class" value={values.partyId.split(":")[0]} onChange={e => update({ partyId: document.parties.find(p => p.classConstant === e.target.value)!.id, copyParty: true })}>{classes.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</SearchableSelect></label>
        <label>Party<SearchableSelect aria-label="Placed trainer party" value={values.partyId} onChange={e => update({ partyId: e.target.value, copyParty: true })}>{document.parties.filter(p => p.classConstant === values.partyId.split(":")[0]).map(p => <option key={p.id} value={p.id}>#{p.partyNumber}: {p.pokemon.map(mon => `${mon.speciesConstant.replace(/_/g, " ")} Lv.${mon.level}`).join(", ")}</option>)}</SearchableSelect></label>
      </div>
      <label className="map-edit-ack"><input type="checkbox" checked={values.copyParty} onChange={e => update({ copyParty: e.target.checked })} />Copy the selected party into a new independent party</label>
      <p className="help-text">{values.copyParty ? "The copy gets a new party number; existing trainers keep their parties. Yellow move overrides are copied too." : "This party is shared. Later edits in Trainers affect every battle using it."} Class-wide AI, prizes and portraits stay shared. Story rewards and map-specific battle scripts are not copied.</p>
      {party && <p>{party.pokemon.map(mon => `${mon.speciesConstant.replace(/_/g, " ")} Lv.${mon.level}`).join(" · ")}</p>}
      <div className="warp-edit-grid"><label>Character<SearchableSelect aria-label="Trainer character" value={values.sprite} onChange={e => update({ sprite: e.target.value })}>{document.npc.sprites.map(s => <option key={s} value={s}>{s.replace(/^SPRITE_/, "").replace(/_/g, " ")}</option>)}</SearchableSelect></label>
        <label>Facing<select aria-label="Trainer facing" value={values.facing} onChange={e => update({ facing: e.target.value as typeof values.facing })}>{Object.keys(trainerDelta).map(dir => <option key={dir} value={dir}>{dir.toLowerCase()}</option>)}</select></label>
        <label>Sight range<input aria-label="Trainer sight range" type="number" min={0} max={8} value={Number.isNaN(values.sight) ? "" : values.sight} onChange={e => update({ sight: e.target.valueAsNumber })} /></label>
        {(["x", "y"] as const).map(axis => <label key={axis}>{axis.toUpperCase()}<input aria-label={`Trainer ${axis.toUpperCase()}`} type="number" min={0} max={Math.min(document.npc[axis === "x" ? "width" : "height"] - 1, 251)} value={Number.isNaN(values[axis]) ? "" : values[axis]} onChange={e => update({ [axis]: e.target.valueAsNumber })} /></label>)}
      </div>
      <p>Range 0: challenge only by talking. Ranges 1–8: approach a player in front of the trainer. The sight corridor must be clear of walls, objects, signs and warps.</p>
      <MapPaintSurface visualization={visualization} cellSize={16} label="Trainer placement map" selected={Number.isFinite(values.x) && Number.isFinite(values.y) ? { x: values.x, y: values.y } : undefined} markers={[...document.occupied.map(p => ({ ...p, label: "×" })), ...sight]} onCell={(x, y) => update({ x, y })} disabled={saving} />
      {placementError && <p role="alert">{placementError}</p>}
      <div className="trainer-dialogues">{(["before", "defeat", "after"] as const).map(role => <label key={role}>{({ before: "Challenge dialogue", defeat: "Defeat dialogue", after: "Post-battle dialogue" })[role]}<textarea aria-label={`Trainer ${role} dialogue`} rows={3} value={values[role].join("\n")} onChange={e => update({ [role]: e.target.value.split("\n") })} /></label>)}</div>
      {textError && <p role="alert">{textError}</p>}
      <p className="help-text">Up to 18 character spaces on the first row and 17 on later rows. Trainers remain available after a loss and remember a victory after saving and reloading. Editing a trainer keeps its existing defeat flag.</p>
    </fieldset>}
    <div className="wizard-actions"><button type="button" disabled={saving} onClick={close}>Cancel</button><button type="button" className="primary-button" disabled={!document || !values || !party || saving || Boolean(placementError || textError)} onClick={() => void save()}>{saving ? "Saving…" : objectId === null ? "Place trainer" : "Save trainer"}</button></div>
  </dialog>;
}
