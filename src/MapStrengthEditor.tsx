import { useEffect, useRef, useState } from "react";
import { invoke } from "./platform/compat";
import { MapPaintSurface } from "./editor/MapPaintSurface";
import { SearchableSelect } from "./editor/SearchableSelect";
import type { MapStrengthDocument, MapStrengthValues } from "./core/mapStrength";
import type { HistorySummary, MapVisualization } from "./core/types";
import "./MapEditing.css";

type Placement = { kind: "boulders" | "targets" | "gates" | "landings" | "goals" | "changes" | "currents"; index: number };
export function MapStrengthEditor({ mapConstant, onClose, onSaved, onDirtyChange }: {
  mapConstant: string; onClose(): void; onSaved(history: HistorySummary): void; onDirtyChange?(dirty: boolean): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), callback = useRef(onDirtyChange); callback.current = onDirtyChange;
  const pendingHistory = useRef<HistorySummary | null>(null);
  const [document, setDocument] = useState<MapStrengthDocument | null>(null), [values, setValues] = useState<MapStrengthValues | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null), [destinationPreview, setDestinationPreview] = useState<MapVisualization | null>(null);
  const [error, setError] = useState<string | null>(null), [saving, setSaving] = useState(false), [newBoulder, setNewBoulder] = useState({ x: 1, y: 1 });
  const dirty = Boolean(document && values && JSON.stringify(document.values) !== JSON.stringify(values));
  useEffect(() => { callback.current?.(dirty); }, [dirty]);
  useEffect(() => () => callback.current?.(false), []);
  async function load() {
    const next = await invoke<MapStrengthDocument>("get_map_strength_document", { mapConstant }); setDocument(next); setValues(structuredClone(next.values)); setPlacement(null);
  }
  useEffect(() => { dialog.current?.showModal(); let cancelled = false;
    void invoke<MapStrengthDocument>("get_map_strength_document", { mapConstant }).then(next => { if (!cancelled) { setDocument(next); setValues(structuredClone(next.values)); } }).catch(e => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [mapConstant]);
  const destinationMap = placement?.kind === "landings" ? values?.landings[placement.index]?.map : null;
  useEffect(() => { let cancelled = false; setDestinationPreview(null); if (destinationMap) void invoke<MapVisualization>("get_map_visualization", { mapConstant: destinationMap }).then(next => { if (!cancelled) setDestinationPreview(next); }).catch(e => { if (!cancelled) setError(String(e)); }); return () => { cancelled = true; }; }, [destinationMap]);
  function close() { if (!saving && (!dirty || window.confirm("Discard unsaved Strength puzzle changes?"))) { onClose(); if (pendingHistory.current) window.dispatchEvent(new CustomEvent("yellow-editor:history-changed", { detail: pendingHistory.current })); } }
  function update(next: MapStrengthValues) { setValues(next); setError(null); }
  function position(kind: Placement["kind"], index: number, x: number, y: number) {
    if (!values) return;
    const next = structuredClone(values); Object.assign(next[kind][index], { x, y }); update(next);
  }
  async function save() {
    if (!document || !values) return;
    setSaving(true); setError(null);
    try { onSaved(await invoke<HistorySummary>("save_map_strength", { document, values })); }
    catch (e) { setError(String(e)); setSaving(false); }
  }
  async function addBoulder() {
    setSaving(true); setError(null);
    try { pendingHistory.current = await invoke<HistorySummary>("add_map_boulder", { mapConstant, ...newBoulder }); await load(); }
    catch (e) { setError(String(e)); }
    finally { setSaving(false); }
  }
  function coordinates(kind: Placement["kind"], index: number, title: string) {
    const point = values![kind][index];
    return <div className="warp-edit-grid">{(["x", "y"] as const).map(axis => <label key={axis}>{axis.toUpperCase()}<input type="number" aria-label={`${title} ${axis.toUpperCase()}`} min={0} value={Number.isNaN(point[axis]) ? "" : point[axis]} onChange={e => position(kind, index, axis === "x" ? e.target.valueAsNumber : point.x, axis === "y" ? e.target.valueAsNumber : point.y)} /></label>)}<button type="button" aria-pressed={placement?.kind === kind && placement.index === index} onClick={() => setPlacement({ kind, index })}>Place {title.toLowerCase()} on map</button></div>;
  }
  const blockGrid = placement?.kind === "gates" || placement?.kind === "changes";
  const preview = destinationMap ? destinationPreview : document?.visualization;
  const selected = placement && values ? values[placement.kind][placement.index] : undefined;
  const markers = !document || !values || destinationMap || blockGrid ? [] : [
    ...values.boulders.map((b, i) => ({ ...b, label: `B${i + 1}` })), ...values.targets.map((p, i) => ({ ...p, label: `T${i + 1}` })), ...values.goals.map(g => ({ ...g, label: `${g.kind === "hole" ? "H" : "S"}${g.id}` })), ...values.currents.map((c, i) => ({ ...c, label: `C${i + 1}` })),
  ];
  return <dialog ref={dialog} className="wizard-dialog map-edit-dialog" aria-labelledby="strength-title" onCancel={e => { e.preventDefault(); close(); }}>
    <div className="wizard-heading"><div><h2 id="strength-title">Strength puzzles{document ? ` in ${document.mapName}` : ""}</h2><p>Place boulders, switches, holes and terrain changes. B labels mark boulder starts; T, S and H mark targets.</p></div><button type="button" aria-label="Close Strength puzzles" disabled={saving} onClick={close}>×</button></div>
    {error && <p role="alert">{error}</p>}
    {!document || !values ? <p role="status">{error ? "Strength editing is unavailable." : "Reading puzzle scripts and object links…"}</p> : <>
      <fieldset className="map-edit-fields" disabled={saving}>
        {document.notes.map(note => <p key={note}>{note}</p>)}
        <div className="terrain-workspace"><section>
          <h3>{destinationMap ? `Landing in ${document.destinations.find(d => d.map === destinationMap)?.name}` : "Puzzle map"}</h3>
          <p>{placement ? `Tap the map to place ${placement.kind === "changes" || placement.kind === "gates" ? "a terrain change on the block grid" : "the selected point on the movement grid"}. Swipe to scroll.` : "Choose a placement button to edit a point on the map. Swipe to scroll."}</p>
          {preview && <MapPaintSurface visualization={preview} cellSize={blockGrid ? 32 : 16} label="Place Strength puzzle point" markers={markers} selected={selected} disabled={saving} onCell={placement ? (x, y) => position(placement.kind, placement.index, x, y) : undefined} />}
        </section><section><h3>Boulders</h3>
          {values.boulders.map((b, i) => <div className="strength-row" key={b.id}><strong>B{i + 1}: {document.boulders[i].constant}</strong>{coordinates("boulders", i, `Boulder ${i + 1}`)}</div>)}
          {!values.boulders.length && <p>No Strength boulders are placed on this map yet.</p>}
          <div className="strength-row"><strong>Add a boulder</strong><div className="warp-edit-grid">{(["x", "y"] as const).map(axis => <label key={axis}>{axis.toUpperCase()}<input type="number" aria-label={`New boulder ${axis.toUpperCase()}`} value={Number.isNaN(newBoulder[axis]) ? "" : newBoulder[axis]} onChange={e => setNewBoulder({ ...newBoulder, [axis]: e.target.valueAsNumber })} /></label>)}<button type="button" disabled={dirty} onClick={() => void addBoulder()}>Add boulder</button></div><small>{dirty ? "Save puzzle changes before adding another boulder." : "Adding a boulder saves a separate undoable history entry."}</small></div>
        </section></div>
        {document.native ? <>
          <h3>Existing switches and holes</h3>
          {values.targets.map((p, i) => <div className="strength-row" key={p.line}><strong>Target {i + 1}</strong>{coordinates("targets", i, `Target ${i + 1}`)}</div>)}
          {values.gates.map((g, i) => <div className="strength-row" key={g.line}><strong>Terrain change {i + 1}</strong>{coordinates("gates", i, `Terrain change ${i + 1}`)}<label>Replacement block<input type="number" aria-label={`Terrain change ${i + 1} block`} value={g.block} onChange={e => { const next = structuredClone(values); next.gates[i].block = e.target.valueAsNumber; update(next); }} /></label></div>)}
          {values.landings.map((p, i) => <div className="strength-row" key={p.line}><strong>Player landing {i + 1} in {document.destinations.find(d => d.map === p.map)?.name}</strong>{coordinates("landings", i, `Player landing ${i + 1}`)}</div>)}
          {values.nativeMoves.length > 0 && <><h3>Existing current routes</h3><p>Movement runs below appear in the order the player travels. Existing puzzle conditions are preserved.</p>{[...new Set(values.nativeMoves.map(move => move.route))].map((route, routeIndex) => <section className="strength-row" key={route}><strong>Current route {routeIndex + 1}</strong>{values.nativeMoves.filter(move => move.route === route).reverse().map((move, stepIndex) => { const index = values.nativeMoves.indexOf(move); return <div className="warp-edit-grid" key={move.line}><label>Direction<select aria-label={`Current route ${routeIndex + 1} movement ${stepIndex + 1} direction`} value={move.direction} onChange={e => { const next = structuredClone(values); next.nativeMoves[index].direction = e.target.value as typeof move.direction; update(next); }}>{["UP", "DOWN", "LEFT", "RIGHT"].map(d => <option key={d}>{d}</option>)}</select></label><label>Steps<input type="number" min={1} max={64} aria-label={`Current route ${routeIndex + 1} movement ${stepIndex + 1} steps`} value={move.steps} onChange={e => { const next = structuredClone(values); next.nativeMoves[index].steps = e.target.valueAsNumber; update(next); }} /></label></div>; })}</section>)}</>}
        </> : <>
          <h3>Switches and holes</h3>
          {values.goals.map((g, i) => { const saved = i < document.values.goals.length, destination = document.destinations.find(d => d.map === g.destination?.map); return <div className="strength-row" key={g.id}><strong>Target {g.id}</strong>
            <div className="warp-edit-grid"><label>Type<select aria-label={`Target ${g.id} type`} disabled={saved} value={g.kind} onChange={e => { const next = structuredClone(values); next.goals[i].kind = e.target.value as "switch" | "hole"; next.goals[i].destination = e.target.value === "hole" ? { map: "", objectId: 0, warpId: 0 } : null; update(next); }}><option value="switch">Switch</option><option value="hole" disabled={document.visualization.tilesetConstant !== "CAVERN"}>Hole to another floor</option></select></label>
            <label>Boulder<select aria-label={`Target ${g.id} boulder`} value={g.boulderId} onChange={e => { const next = structuredClone(values); next.goals[i].boulderId = Number(e.target.value); update(next); }}>{document.boulders.map((b, n) => <option key={b.id} value={b.id}>B{n + 1}: {b.constant}</option>)}</select></label></div>
            {coordinates("goals", i, `Target ${g.id}`)}
            {g.kind === "hole" && <div className="warp-edit-grid"><label>Receiving map<SearchableSelect aria-label={`Target ${g.id} receiving map`} value={g.destination?.map ?? ""} onChange={e => { const next = structuredClone(values); next.goals[i].destination = { map: e.target.value, objectId: 0, warpId: 0 }; update(next); }}><option value="">Choose a map</option>{document.destinations.filter(d => d.map !== mapConstant && d.boulders.length).map(d => <option key={d.map} value={d.map}>{d.name}</option>)}</SearchableSelect></label>
              <label>Receiving boulder<select aria-label={`Target ${g.id} receiving boulder`} value={g.destination?.objectId ?? 0} onChange={e => { const next = structuredClone(values); next.goals[i].destination!.objectId = Number(e.target.value); update(next); }}><option value={0}>Choose a boulder</option>{destination?.boulders.map(b => <option key={b.id} value={b.id}>{b.constant} at {b.x}, {b.y}</option>)}</select></label>
              <label>Player landing warp<select aria-label={`Target ${g.id} landing warp`} value={g.destination?.warpId ?? 0} onChange={e => { const next = structuredClone(values); next.goals[i].destination!.warpId = Number(e.target.value); update(next); }}><option value={0}>Choose a warp</option>{destination?.warps.map(id => <option key={id} value={id}>Warp {id}</option>)}</select></label><p>The receiving boulder stays hidden until this drop is completed. Add it on the receiving map first.</p></div>}
            {g.event && <small>Completion flag: {g.event}</small>}
          </div>; })}
          <button type="button" disabled={!values.boulders.length || values.goals.length >= 8} onClick={() => update({ ...values, goals: [...values.goals, { id: values.goals.length + 1, event: "", x: 0, y: 0, boulderId: values.boulders[0].id, kind: "switch", destination: null }] })}>Add puzzle target</button>
          <h3>Terrain changes after completion</h3>
          {values.changes.map((g, i) => <div className="strength-row" key={i}>{coordinates("changes", i, `Terrain change ${i + 1}`)}<label>Replacement block<input type="number" aria-label={`Terrain change ${i + 1} block`} min={0} max={document.visualization.blockCount - 1} value={g.block} onChange={e => { const next = structuredClone(values); next.changes[i].block = e.target.valueAsNumber; update(next); }} /></label><p>Require all selected targets:</p>{values.goals.map(goal => <label className="map-edit-ack" key={goal.id}><input type="checkbox" aria-label={`Terrain change ${i + 1} requires target ${goal.id}`} checked={g.goals.includes(goal.id)} onChange={e => { const next = structuredClone(values); next.changes[i].goals = e.target.checked ? [...g.goals, goal.id] : g.goals.filter(id => id !== goal.id); update(next); }} />Target {goal.id}</label>)}</div>)}
          <button type="button" disabled={!values.goals.length || values.changes.length >= 8} onClick={() => update({ ...values, changes: [...values.changes, { x: 0, y: 0, block: 0, goals: values.goals.map(g => g.id) }] })}>Add terrain change</button>
          <h3>Water currents</h3><p>Currents move a surfing player along a water route until all selected completion flags are set. Save the upstream puzzle targets first so their flags are available here.</p>
          {values.currents.map((current, i) => <section className="strength-row" key={i}>{coordinates("currents", i, `Current ${i + 1}`)}<p>Stop this current after all selected targets are completed:</p>{document.completionFlags.map(flag => <label className="map-edit-ack" key={flag.event}><input type="checkbox" aria-label={`Current ${i + 1} stops after ${flag.label}`} checked={current.events.includes(flag.event)} onChange={e => { const next = structuredClone(values); next.currents[i].events = e.target.checked ? [...current.events, flag.event] : current.events.filter(f => f !== flag.event); update(next); }} />{flag.label}</label>)}
            {current.path.map((step, j) => <div className="warp-edit-grid" key={j}><label>Direction<select aria-label={`Current ${i + 1} movement ${j + 1} direction`} value={step.direction} onChange={e => { const next = structuredClone(values); next.currents[i].path[j].direction = e.target.value as typeof step.direction; update(next); }}>{["UP", "DOWN", "LEFT", "RIGHT"].map(d => <option key={d}>{d}</option>)}</select></label><label>Steps<input type="number" min={1} max={64} aria-label={`Current ${i + 1} movement ${j + 1} steps`} value={step.steps} onChange={e => { const next = structuredClone(values); next.currents[i].path[j].steps = e.target.valueAsNumber; update(next); }} /></label><button type="button" onClick={() => { const next = structuredClone(values); next.currents[i].path.splice(j, 1); update(next); }}>Remove movement</button></div>)}<button type="button" disabled={current.path.length >= 16} onClick={() => { const next = structuredClone(values); next.currents[i].path.push({ direction: "DOWN", steps: 1 }); update(next); }}>Add current movement</button><button type="button" onClick={() => { const next = structuredClone(values); next.currents.splice(i, 1); update(next); }}>Remove current</button>
          </section>)}
          <button type="button" disabled={document.visualization.tilesetConstant !== "CAVERN" || values.currents.length >= 8 || !document.completionFlags.length} onClick={() => update({ ...values, currents: [...values.currents, { x: 0, y: 0, events: [], path: [{ direction: "DOWN", steps: 1 }] }] })}>Add water current</button>
          <p>New holes and currents use existing CAVERN hole and water tiles. Paint the terrain first. Water landings from managed holes automatically put the player into Surf mode.</p>
        </>}
      </fieldset>
      <div className="wizard-actions"><button type="button" disabled={saving} onClick={close}>Cancel</button><button type="button" className="primary-button" disabled={saving || !dirty} onClick={() => void save()}>{saving ? "Saving…" : "Save Strength puzzles"}</button></div>
    </>}
  </dialog>;
}
