import { useEffect, useRef, useState } from "react";
import { invoke } from "./platform/compat";
import type { HistorySummary, MapTerrainDocument, MapTerrainValues } from "./core/types";
import { MapPaintSurface } from "./editor/MapPaintSurface";
import "./MapEditing.css";

type Terrain = Pick<MapTerrainValues, "mapBlocks" | "blockset">;
export function MapTerrainEditor({ mapConstant, onClose, onSaved, onDirtyChange }: {
  mapConstant: string; onClose(): void; onSaved(history: HistorySummary): void; onDirtyChange?(dirty: boolean): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [document, setDocument] = useState<MapTerrainDocument | null>(null), [draft, setDraft] = useState<Terrain | null>(null);
  const [selectedBlock, setSelectedBlock] = useState(0), [selectedTile, setSelectedTile] = useState(0);
  const [tool, setTool] = useState<"paint" | "pick" | "scroll">("paint"), [zoom, setZoom] = useState(1);
  const [undo, setUndo] = useState<Terrain[]>([]), [redo, setRedo] = useState<Terrain[]>([]);
  const [sharedBlocks, setSharedBlocks] = useState(false), [sharedLayout, setSharedLayout] = useState(false);
  const [error, setError] = useState<string | null>(null), [saving, setSaving] = useState(false);
  const current = useRef(draft); current.current = draft;
  const stroke = useRef<Terrain | null>(null);
  const v = document?.visualization;
  const blocksChanged = Boolean(v && draft && JSON.stringify(v.blockset) !== JSON.stringify(draft.blockset));
  const layoutChanged = Boolean(v && draft && JSON.stringify(v.mapBlocks) !== JSON.stringify(draft.mapBlocks));
  const dirty = blocksChanged || layoutChanged;
  const callback = useRef(onDirtyChange); callback.current = onDirtyChange;
  useEffect(() => { callback.current?.(dirty); }, [dirty]);
  useEffect(() => () => callback.current?.(false), []);
  useEffect(() => {
    dialog.current?.showModal(); let cancelled = false;
    void invoke<MapTerrainDocument>("get_map_terrain_document", { mapConstant }).then(next => {
      if (!cancelled) { setDocument(next); setDraft({ mapBlocks: next.visualization.mapBlocks.slice(), blockset: next.visualization.blockset.slice() }); }
    }).catch(reason => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
  }, [mapConstant]);
  function close() { if (!saving && (!dirty || window.confirm("Discard the unsaved terrain changes?"))) onClose(); }
  function start() { stroke.current = current.current; }
  function end() {
    const before = stroke.current;
    if (before && JSON.stringify(before) !== JSON.stringify(current.current)) { setUndo(old => [...old.slice(-49), before]); setRedo([]); }
    stroke.current = null;
  }
  function change(next: Terrain) { current.current = next; setDraft(next); setError(null); }
  function history(direction: "undo" | "redo") {
    const stack = direction === "undo" ? undo : redo, next = stack[stack.length - 1];
    if (!next || !draft) return;
    if (direction === "undo") { setUndo(stack.slice(0, -1)); setRedo(old => [...old, draft]); }
    else { setRedo(stack.slice(0, -1)); setUndo(old => [...old, draft]); }
    setSelectedBlock(id => Math.min(id, next.blockset.length / 16 - 1)); change(next);
  }
  async function save() {
    if (!document || !draft || !dirty) return;
    setSaving(true); setError(null);
    try { onSaved(await invoke<HistorySummary>("save_map_terrain", { document, values: { ...draft, confirmSharedBlocks: sharedBlocks, confirmSharedLayout: sharedLayout } })); }
    catch (reason) { setError(String(reason)); setSaving(false); }
  }
  const preview = v && draft ? { ...v, ...draft, blockCount: draft.blockset.length / 16 } : null;
  return <dialog ref={dialog} className="wizard-dialog map-edit-dialog" aria-labelledby="terrain-title" onCancel={event => { event.preventDefault(); close(); }}>
    <div className="wizard-heading"><div><h2 id="terrain-title">Edit terrain{v ? ` in ${v.map.displayName}` : ""}</h2><p>Paint 32×32 blocks. Each block contains sixteen 8×8 tiles.</p></div><button type="button" aria-label="Close terrain editor" disabled={saving} onClick={close}>×</button></div>
    {error && <p role="alert">{error}</p>}
    {!preview || !draft || !document ? <p role="status">{error ? "Terrain editing is unavailable for this map." : "Loading map and blockset…"}</p> : <>
      <fieldset disabled={saving} className="map-edit-fields"><div className="terrain-toolbar">
        <button type="button" disabled={!undo.length} onClick={() => history("undo")}>Undo stroke</button><button type="button" disabled={!redo.length} onClick={() => history("redo")}>Redo stroke</button>
        <label>Map tool<select value={tool} onChange={e => setTool(e.target.value as typeof tool)}><option value="paint">Paint blocks</option><option value="pick">Pick block from map</option><option value="scroll">Scroll map</option></select></label>
        <label>Map zoom<select value={zoom} onChange={e => setZoom(Number(e.target.value))}><option value={1}>1×</option><option value={2}>2×</option><option value={3}>3×</option></select></label>
      </div>
      <div className="terrain-workspace"><section><h3>Map layout</h3><p>Click or drag to paint block #{selectedBlock}. Use Pick block to sample an existing house. On touchscreens, choose Scroll map and swipe to move around without painting.</p>
        <MapPaintSurface disabled={saving} visualization={preview} zoom={zoom} mode={tool === "pick" ? "select" : tool} label="Paint map blocks" onStart={start} onEnd={end} onCell={(x, y) => {
          const value = current.current!; const at = y * preview.map.width + x;
          if (tool === "pick") { setSelectedBlock(value.mapBlocks[at]); return; }
          if (value.mapBlocks[at] === selectedBlock) return;
          const next = value.mapBlocks.slice(); next[at] = selectedBlock; change({ ...value, mapBlocks: next });
        }} />
      </section><section><h3>Block palette</h3>
        <label>Selected block<select aria-label="Selected block" value={selectedBlock} onChange={e => setSelectedBlock(Number(e.target.value))}>{Array.from({ length: preview.blockCount }, (_, id) => <option key={id} value={id}>#{id} (${id.toString(16).toUpperCase().padStart(2, "0")})</option>)}</select></label>
        <MapPaintSurface disabled={saving} visualization={preview} kind="blocks" label="Choose map block" selected={{ x: selectedBlock % 8, y: Math.floor(selectedBlock / 8) }} onCell={(x, y) => { const id = y * 8 + x; if (id < preview.blockCount) setSelectedBlock(id); }} />
      </section></div>
      <details><summary>Edit the tiles inside block #{selectedBlock}</summary>
        <p>Changing an existing block changes every occurrence on every map using this blockset. Duplicate it to keep the existing block intact, then paint the new block onto this map.</p>
        <button type="button" disabled={preview.blockCount >= 256} onClick={() => { start(); const value = current.current!; change({ ...value, blockset: [...value.blockset, ...value.blockset.slice(selectedBlock * 16, selectedBlock * 16 + 16)] }); setSelectedBlock(preview.blockCount); end(); }}>Duplicate selected block</button>
        <div className="terrain-workspace"><section><h3>Block #{selectedBlock}</h3>
          <MapPaintSurface disabled={saving} mode="paint" visualization={{ ...preview, map: { ...preview.map, width: 1, height: 1 }, mapBlocks: [selectedBlock] }} zoom={6} cellSize={8} label="Paint tiles inside block" onStart={start} onEnd={end} onCell={(x, y) => {
            const value = current.current!; const at = selectedBlock * 16 + y * 4 + x;
            if (value.blockset[at] === selectedTile) return;
            const next = value.blockset.slice(); next[at] = selectedTile; change({ ...value, blockset: next });
          }} />
          <p>Tile arrangement determines collision and door behavior using the tileset’s existing tile properties.</p>
        </section><section><h3>Tile palette</h3>
          <label>Selected tile<select aria-label="Selected tile" value={selectedTile} onChange={e => setSelectedTile(Number(e.target.value))}>{Array.from({ length: Math.min(preview.tileCount, 256) }, (_, id) => <option key={id} value={id}>#{id} (${id.toString(16).toUpperCase().padStart(2, "0")})</option>)}</select></label>
          <MapPaintSurface disabled={saving} visualization={preview} kind="tiles" zoom={2} label="Choose block tile" selected={{ x: selectedTile % 16, y: Math.floor(selectedTile / 16) }} onCell={(x, y) => { const id = y * 16 + x; if (id < Math.min(preview.tileCount, 256)) setSelectedTile(id); }} />
        </section></div>
      </details>
      {blocksChanged && <label className="map-edit-ack"><input type="checkbox" checked={sharedBlocks} onChange={e => setSharedBlocks(e.target.checked)} />I understand that blockset changes are shared by all maps using this blockset.</label>}
      {layoutChanged && document.sharedLayout && <label className="map-edit-ack"><input type="checkbox" checked={sharedLayout} onChange={e => setSharedLayout(e.target.checked)} />I understand that multiple maps share this layout file.</label>}
      <p className="help-text">To add a house, place its roof and wall blocks, keep a door tile at the entrance, save terrain, then add an entrance and a return warp. This pass uses existing tile graphics and map dimensions.</p>
      </fieldset>
      <div className="wizard-actions"><button type="button" disabled={saving} onClick={close}>Cancel</button><button type="button" className="primary-button" disabled={saving || !dirty || (blocksChanged && !sharedBlocks) || (layoutChanged && document.sharedLayout && !sharedLayout)} onClick={() => void save()}>{saving ? "Saving…" : "Save terrain"}</button></div>
    </>}
  </dialog>;
}
