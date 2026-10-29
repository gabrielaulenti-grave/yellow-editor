import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { GraphicsAsset, GraphicsCatalog, GraphicsDocument, GraphicsFocus } from "./core/graphics";
import { drawPixelLine, encodeGraphicsPng, fillGraphics, flipGraphics, graphicsPixelsFromImage, graphicsPixelsToImage, validateGraphicsPixels, validateGraphicsPngHeader, type PixelRect } from "./core/graphicsPixels";
import { decodeGen1Png, encodeGen1RgbaToTiles } from "./core/gen1Graphics";
import type { HistorySummary, MapVisualization, ProjectInfo } from "./core/types";
import type { EditorController } from "./editor/types";
import { renderMap } from "./editor/mapCanvasDrawing";
import { convertFileSrc, invoke } from "./platform/compat";
import { graphicsDraftOperation, type GraphicsDraft } from "./platform/graphicsDraftStore";
import "./GraphicsTab.css";

const GRAY = ["#ffffff", "#aaaaaa", "#555555", "#000000"];
const GREEN = ["#e0f8cf", "#86c06c", "#306850", "#071821"];
const categories = { all: "All graphics", pokemon: "Pokémon", trainers: "Trainers", tilesets: "Tilesets", sprites: "Overworld sprites", battle: "Battle graphics", interface: "Interface & fonts", scenes: "Scenes & screens", other: "Other graphics" };
type Tool = "pencil" | "fill" | "pick" | "select" | "reference" | "pan";
interface ReferenceImage { url: string; image: HTMLImageElement; name: string; opacity: number; scale: number; x: number; y: number; visible: boolean }
const equal = (a: number[], b: number[]) => a.length === b.length && a.every((value, i) => value === b[i]);
function download(bytes: Uint8Array, name: string): void {
  const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes).buffer], { type: "image/png" }));
  const anchor = window.document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Thumbnail({ asset, revision }: { asset: GraphicsAsset; revision: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void invoke<string | null>("get_graphics_asset_url", { path: asset.path }).then(url => { if (!cancelled) setUrl(url); }).catch(() => { if (!cancelled) setUrl(null); });
    return () => { cancelled = true; };
  }, [asset.path, revision]);
  return url ? <img src={convertFileSrc(url)} alt="" loading="lazy" /> : <span className="graphics-thumbnail-empty">{asset.format.toUpperCase()}</span>;
}
function PixelPreview({ doc, pixels, palette }: { doc: GraphicsDocument; pixels: number[]; palette: string[] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current; if (!element) return;
    element.width = doc.width; element.height = doc.height;
    const context = element.getContext("2d"); if (!context) return;
    pixels.forEach((shade, i) => { context.fillStyle = palette[shade]; context.fillRect(i % doc.width, Math.floor(i / doc.width), 1, 1); });
  }, [doc, pixels, palette]);
  return <canvas ref={canvas} aria-label="Artwork preview without tracing reference" style={{ width: doc.width, height: doc.height }} />;
}
function MapPreview({ doc, pixels, map }: { doc: GraphicsDocument; pixels: number[]; map: MapVisualization }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvas.current) return;
    const bytes = Array.from(encodeGen1RgbaToTiles(graphicsPixelsToImage({ ...doc, pixels }), { depth: 2 }));
    // Native tileset assembly can pad the sheet; retain the resolved padding in the context preview.
    while (bytes.length < map.tilesetGfx.length) bytes.push(0);
    renderMap(canvas.current, { ...map, tilesetGfx: bytes }, false);
  }, [doc, pixels, map]);
  return <canvas ref={canvas} className="graphics-map-preview" aria-label={`Draft tiles in ${map.map.displayName}`} />;
}

export function GraphicsTab({ project, focus, onControllerChange, onReturn }: {
  project: ProjectInfo; focus: GraphicsFocus | null;
  onControllerChange(controller: EditorController | null): void;
  onReturn(): void;
}) {
  const [catalog, setCatalog] = useState<GraphicsCatalog | null>(null), [category, setCategory] = useState("all"), [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(60), [path, setPath] = useState<string | null>(null), [revision, setRevision] = useState(0);
  const [doc, setDoc] = useState<GraphicsDocument | null>(null), [pixels, setPixels] = useState<number[]>([]);
  const pixelsRef = useRef(pixels), docRef = useRef(doc), dirtyRef = useRef(false), loadSequence = useRef(0), saving = useRef(false);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState("");
  const [draftWarning, setDraftWarning] = useState<string | null>(null), [recovery, setRecovery] = useState<GraphicsDraft | null>(null);
  const undo = useRef<number[][]>([]), redo = useRef<number[][]>([]);
  const [, setHistoryRevision] = useState(0), [confirmShared, setConfirmShared] = useState(false);
  const [tool, setTool] = useState<Tool>("pencil"), [shade, setShade] = useState(3), [zoom, setZoom] = useState(8), [showGrid, setShowGrid] = useState(true), [compare, setCompare] = useState(false);
  const [paletteChoice, setPaletteChoice] = useState("gray"), [tile, setTile] = useState<number | null>(null), [selection, setSelection] = useState<PixelRect | null>(null);
  const clipboard = useRef<{ width: number; height: number; depth: number; pixels: number[] } | null>(null), [hasClipboard, setHasClipboard] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null), atlas = useRef<HTMLCanvasElement>(null), canvasViewport = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const [reference, setReference] = useState<ReferenceImage | null>(null), referenceRef = useRef(reference), referenceRequest = useRef(0), importRequest = useRef(0);
  const [mapContext, setMapContext] = useState<MapVisualization | null>(null);
  const stroke = useRef<{ id: number; before: number[]; start: { x: number; y: number }; last: { x: number; y: number }; referenceStart?: { x: number; y: number } } | null>(null);
  const dirty = Boolean(doc && !equal(doc.pixels, pixels)); dirtyRef.current = dirty; docRef.current = doc;
  const colors = paletteChoice === "green" ? GREEN : paletteChoice === "game" && focus?.palette?.length === 4 ? focus.palette : GRAY;
  const palette = useMemo(() => doc?.depth === 1 ? [colors[0], colors[3]] : colors, [doc?.depth, colors]);
  const rect: PixelRect = doc && tile !== null ? { x: tile % (doc.width / 8) * 8, y: Math.floor(tile / (doc.width / 8)) * 8, width: 8, height: 8 } : { x: 0, y: 0, width: doc?.width ?? 8, height: doc?.height ?? 8 };
  const selectedAsset = catalog?.assets.find(asset => asset.path === path);
  const filtered = useMemo(() => catalog?.assets.filter(asset => (category === "all" || asset.category === category)
    && `${asset.name} ${asset.path} ${asset.references.flatMap(ref => ref.labels).join(" ")}`.toLowerCase().includes(search.toLowerCase())) ?? [], [catalog, category, search]);
  const updatePixels = useCallback((next: number[]) => { pixelsRef.current = next; setPixels(next); }, []);
  const clearHistory = useCallback(() => { undo.current = []; redo.current = []; setHistoryRevision(n => n + 1); }, []);
  const pushUndo = useCallback((before: number[]) => {
    undo.current.push(before); redo.current = [];
    const max = Math.max(2, Math.min(50, Math.floor(8 * 1024 * 1024 / Math.max(1, before.length * 8))));
    if (undo.current.length > max) undo.current.shift();
    setHistoryRevision(n => n + 1);
  }, []);
  const commit = useCallback((next: number[]) => {
    if (!equal(next, pixelsRef.current)) { pushUndo(pixelsRef.current); updatePixels(next); }
  }, [pushUndo, updatePixels]);

  const readAsset = useCallback(async (assetPath: string) => {
    const sequence = ++loadSequence.current;
    ++importRequest.current; ++referenceRequest.current;
    stroke.current = null; setLoading(true); setError(null); setDoc(null); updatePixels([]); clearHistory(); setSelection(null); setConfirmShared(false); setRecovery(null); setCompare(false);
    try {
      const next = await invoke<GraphicsDocument>("get_graphics_document", { path: assetPath });
      if (sequence !== loadSequence.current) return;
      setDoc(next); updatePixels(next.pixels.slice()); setShade((1 << next.depth) - 1);
      setTile(next.asset.category === "tilesets" ? 0 : null); setZoom(next.asset.category === "tilesets" ? 24 : next.width > 128 ? 2 : 8);
      try {
        const draft = await graphicsDraftOperation(project.storageKey, assetPath, "read");
        if (sequence !== loadSequence.current) return;
        if (draft) { validateGraphicsPixels(draft); if (draft.version !== 1) throw new Error("Unsupported graphics draft."); setRecovery(draft); }
      } catch (error) { if (sequence === loadSequence.current) setDraftWarning(String(error)); }
    } catch (error) { if (sequence === loadSequence.current) setError(String(error)); }
    finally { if (sequence === loadSequence.current) setLoading(false); }
  }, [project.storageKey, updatePixels, clearHistory]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void invoke<GraphicsCatalog>("get_graphics_catalog").then(catalog => {
      if (cancelled) return;
      setCatalog(catalog);
      const focused = catalog.assets.find(asset => asset.path === focus?.path || focus?.path && asset.path.replace(/\.(?:png|1bpp|2bpp|pic)$/, "") === focus.path.replace(/\.(?:png|1bpp|2bpp|pic)$/, "") || focus?.label && asset.references.some(ref => ref.labels.includes(focus.label!)));
      if (focus && !focused) setNotice("The requested graphic was not found. Choose an asset from the browser.");
      if (focused) setCategory(focused.category);
      setPath(focused?.path ?? catalog.assets.find(asset => !asset.reason)?.path ?? catalog.assets[0]?.path ?? null);
      if (!catalog.assets.length) setLoading(false);
    }).catch(error => { if (!cancelled) { setError(String(error)); setLoading(false); } });
    return () => { cancelled = true; ++loadSequence.current; ++referenceRequest.current; ++importRequest.current; };
  }, [project.storageKey, focus]);
  useEffect(() => { if (path) void readAsset(path); }, [path, readAsset]);
  useEffect(() => { setVisibleCount(60); }, [search, category]);
  useEffect(() => {
    if (!focus?.mapConstant) return;
    let cancelled = false;
    void invoke<MapVisualization>("get_map_visualization", { mapConstant: focus.mapConstant }).then(map => { if (!cancelled) setMapContext(map); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [focus?.mapConstant, revision]);
  useEffect(() => {
    const changed = () => { if (!saving.current && path && !dirtyRef.current) { setRevision(n => n + 1); void readAsset(path); } };
    window.addEventListener("yellow-editor:history-changed", changed);
    return () => window.removeEventListener("yellow-editor:history-changed", changed);
  }, [path, readAsset]);
  useEffect(() => {
    if (!doc || recovery || loading) return;
    const timer = window.setTimeout(() => {
      void graphicsDraftOperation(project.storageKey, doc.asset.path, dirty ? "write" : "delete", dirty ? { version: 1, sourceHash: doc.sourceHash, width: doc.width, height: doc.height, depth: doc.depth, pixels: pixels.slice() } : undefined)
        .catch(error => setDraftWarning(String(error)));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [doc, pixels, dirty, project.storageKey, recovery, loading]);
  // Keep the last complete stroke recoverable even when navigation unmounts the workspace.
  useEffect(() => () => {
    const current = docRef.current;
    if (current && dirtyRef.current) void graphicsDraftOperation(project.storageKey, current.asset.path, "write", { version: 1, sourceHash: current.sourceHash, width: current.width, height: current.height, depth: current.depth, pixels: pixelsRef.current }).catch(() => undefined);
  }, [project.storageKey]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);
  useEffect(() => { referenceRef.current = reference; }, [reference]);
  useEffect(() => () => { if (referenceRef.current) URL.revokeObjectURL(referenceRef.current.url); }, []);

  const revert = useCallback(async () => {
    if (!doc) return;
    dirtyRef.current = false;
    await graphicsDraftOperation(project.storageKey, doc.asset.path, "delete").catch(error => setDraftWarning(String(error)));
    await readAsset(doc.asset.path);
  }, [doc, project.storageKey, readAsset]);
  const save = useCallback(async () => {
    if (!doc || !dirty || busy || stroke.current) return;
    setBusy(true); saving.current = true; setError(null);
    try {
      const history = await invoke<HistorySummary>("save_graphics", { document: doc, values: { pixels, confirmShared } });
      dirtyRef.current = false;
      setDoc({ ...doc, pixels: pixels.slice() }); clearHistory();
      await graphicsDraftOperation(project.storageKey, doc.asset.path, "delete").catch(error => setDraftWarning(String(error)));
      window.dispatchEvent(new CustomEvent("yellow-editor:history-changed", { detail: history }));
      setRevision(n => n + 1); setNotice("Graphic saved. All uses of this source will receive the edited artwork.");
      await readAsset(doc.asset.path);
    } catch (error) { setError(String(error)); }
    finally { saving.current = false; setBusy(false); }
  }, [doc, dirty, busy, pixels, confirmShared, clearHistory, project.storageKey, readAsset]);
  useEffect(() => {
    onControllerChange({ dirty, valid: Boolean(doc && (!doc.asset.references.length || confirmShared)), busy: busy || loading, save, revert });
  }, [dirty, doc, confirmShared, busy, loading, save, revert, onControllerChange]);
  useEffect(() => () => onControllerChange(null), [onControllerChange]);

  useEffect(() => {
    const element = canvas.current; if (!element || !doc) return;
    element.width = rect.width * zoom; element.height = rect.height * zoom;
    const context = element.getContext("2d"); if (!context) return;
    const data = compare ? doc.pixels : pixels;
    for (let y = 0; y < rect.height; y++) for (let x = 0; x < rect.width; x++) {
      context.fillStyle = palette[data[(rect.y + y) * doc.width + rect.x + x]];
      context.fillRect(x * zoom, y * zoom, zoom, zoom);
    }
    if (reference?.visible && !compare) {
      context.save(); context.globalAlpha = reference.opacity / 100;
      context.drawImage(reference.image, reference.x * zoom, reference.y * zoom, reference.image.width * reference.scale / 100 * zoom, reference.image.height * reference.scale / 100 * zoom); context.restore();
    }
    if (showGrid) {
      context.strokeStyle = "rgba(120,120,120,0.55)"; context.lineWidth = 1;
      const step = zoom >= 8 ? 1 : 8;
      for (let x = step; x < rect.width; x += step) { context.beginPath(); context.moveTo(x * zoom + .5, 0); context.lineTo(x * zoom + .5, element.height); context.stroke(); }
      for (let y = step; y < rect.height; y += step) { context.beginPath(); context.moveTo(0, y * zoom + .5); context.lineTo(element.width, y * zoom + .5); context.stroke(); }
    }
    if (selection) {
      context.strokeStyle = "#c58a1f"; context.lineWidth = 2;
      context.strokeRect((selection.x - rect.x) * zoom + 1, (selection.y - rect.y) * zoom + 1, selection.width * zoom - 2, selection.height * zoom - 2);
    }
  }, [doc, pixels, rect.x, rect.y, rect.width, rect.height, zoom, palette, compare, showGrid, reference, selection]);
  useEffect(() => {
    if (!atlas.current || !doc || doc.asset.category !== "tilesets") return;
    const element = atlas.current; element.width = doc.width; element.height = doc.height;
    const context = element.getContext("2d"); if (!context) return;
    pixels.forEach((shade, i) => { context.fillStyle = palette[shade]; context.fillRect(i % doc.width, Math.floor(i / doc.width), 1, 1); });
    if (tile !== null) { context.strokeStyle = "#c58a1f"; context.lineWidth = 1; context.strokeRect(rect.x + .5, rect.y + .5, 7, 7); }
  }, [doc, pixels, palette, tile, rect.x, rect.y]);

  async function chooseAsset(asset: GraphicsAsset) {
    if (asset.path === path || busy || loading) return;
    if (dirty && !window.confirm("Leave unsaved pixels and open another graphic? A recoverable draft will be kept.")) return;
    if (doc && dirty) await graphicsDraftOperation(project.storageKey, doc.asset.path, "write", { version: 1, sourceHash: doc.sourceHash, width: doc.width, height: doc.height, depth: doc.depth, pixels: pixelsRef.current }).catch(error => setDraftWarning(String(error)));
    setNotice(""); setPath(asset.path);
  }
  function undoStroke(direction: "undo" | "redo") {
    if (busy || stroke.current) return;
    const from = direction === "undo" ? undo.current : redo.current, to = direction === "undo" ? redo.current : undo.current;
    const next = from.pop(); if (!next) return;
    to.push(pixelsRef.current); updatePixels(next); setHistoryRevision(n => n + 1);
  }
  function point(event: ReactPointerEvent<HTMLCanvasElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(rect.x, Math.min(rect.x + rect.width - 1, Math.floor((event.clientX - box.left) / zoom) + rect.x)), y: Math.max(rect.y, Math.min(rect.y + rect.height - 1, Math.floor((event.clientY - box.top) / zoom) + rect.y)) };
  }
  function startStroke(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!doc || busy || recovery || compare || tool === "pan" || event.button !== 0 || stroke.current) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    const at = point(event); setCursor(at);
    if (tool === "pick") { setShade(pixelsRef.current[at.y * doc.width + at.x]); return; }
    if (tool === "fill") { commit(fillGraphics(pixelsRef.current, doc.width, at.x, at.y, shade, selection ?? rect)); return; }
    stroke.current = { id: event.pointerId, before: pixelsRef.current, start: at, last: at, ...(tool === "reference" && reference ? { referenceStart: { x: reference.x, y: reference.y } } : {}) };
    if (tool === "pencil") updatePixels(drawPixelLine(pixelsRef.current, doc.width, doc.height, at.x, at.y, at.x, at.y, shade));
    if (tool === "select") setSelection({ ...at, width: 1, height: 1 });
  }
  function moveStroke(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!doc || busy) return;
    const at = point(event); setCursor(at);
    const current = stroke.current; if (!current || current.id !== event.pointerId) return;
    if (tool === "pencil") updatePixels(drawPixelLine(pixelsRef.current, doc.width, doc.height, current.last.x, current.last.y, at.x, at.y, shade));
    if (tool === "select") setSelection({ x: Math.min(at.x, current.start.x), y: Math.min(at.y, current.start.y), width: Math.abs(at.x - current.start.x) + 1, height: Math.abs(at.y - current.start.y) + 1 });
    if (tool === "reference" && current.referenceStart) setReference(ref => ref ? { ...ref, x: current.referenceStart!.x + at.x - current.start.x, y: current.referenceStart!.y + at.y - current.start.y } : ref);
    current.last = at;
  }
  function finishStroke() {
    const current = stroke.current; stroke.current = null;
    if (current && !equal(current.before, pixelsRef.current)) pushUndo(current.before);
  }
  function copySelection() {
    if (!doc) return;
    const area = selection ?? rect;
    clipboard.current = { width: area.width, height: area.height, depth: doc.depth, pixels: Array.from({ length: area.width * area.height }, (_, i) => pixelsRef.current[(area.y + Math.floor(i / area.width)) * doc.width + area.x + i % area.width]) };
    setHasClipboard(true); setNotice("Pixels copied. Select a destination and paste.");
  }
  function pasteSelection() {
    if (!doc || !clipboard.current || clipboard.current.depth !== doc.depth) return;
    const area = selection ?? rect, copied = clipboard.current, next = pixelsRef.current.slice();
    for (let y = 0; y < copied.height && area.y + y < rect.y + rect.height; y++) for (let x = 0; x < copied.width && area.x + x < rect.x + rect.width; x++) next[(area.y + y) * doc.width + area.x + x] = copied.pixels[y * copied.width + x];
    commit(next);
  }
  async function importArtwork(file: File) {
    if (!doc || busy || compare) return;
    const request = ++importRequest.current, assetPath = doc.asset.path;
    setError(null);
    try {
      if (file.size > 16 * 1024 * 1024 || !/\.png$/i.test(file.name)) throw new Error("Import an opaque grayscale PNG up to 16 MB. Use a reference image to trace other artwork.");
      const bytes = new Uint8Array(await file.arrayBuffer()); validateGraphicsPngHeader(bytes);
      const image = graphicsPixelsFromImage(await decodeGen1Png(bytes), doc.depth);
      if (request !== importRequest.current || docRef.current?.asset.path !== assetPath) return;
      if (image.width !== doc.width || image.height !== doc.height) throw new Error(`Artwork must remain ${doc.width}×${doc.height} pixels. Reference images can be scaled freely.`);
      commit(image.pixels); setNotice("Artwork imported as an unsaved edit.");
    } catch (error) { if (request === importRequest.current) setError(String(error)); }
  }
  async function uploadReference(file: File) {
    const request = ++referenceRequest.current; let url: string | null = null;
    setError(null);
    try {
      if (file.size > 16 * 1024 * 1024 || !/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("Choose a PNG, JPEG or WebP reference up to 16 MB.");
      url = URL.createObjectURL(file);
      const image = new Image(); image.src = url; await image.decode();
      if (request !== referenceRequest.current) { URL.revokeObjectURL(url); return; }
      if (image.width * image.height > 16 * 1024 * 1024 || image.width > 8192 || image.height > 8192) throw new Error("Reference images must fit within 8192 pixels per side and 16 million pixels.");
      if (referenceRef.current) URL.revokeObjectURL(referenceRef.current.url);
      const next = { url, image, name: file.name, opacity: 35, scale: Math.min(rect.width / image.width, rect.height / image.height) * 100, x: 0, y: 0, visible: true };
      referenceRef.current = next; setReference(next); setNotice("Reference loaded for tracing. It stays outside saved and exported artwork.");
    } catch (error) { if (url) URL.revokeObjectURL(url); if (request === referenceRequest.current) setError(String(error)); }
  }
  const validRecovery = Boolean(recovery && doc && recovery.sourceHash === doc.sourceHash && recovery.width === doc.width && recovery.height === doc.height && recovery.depth === doc.depth);
  const canEdit = Boolean(doc && !busy && !loading && !compare && !recovery);
  return <section className="tab-content graphics-workspace" aria-label="Graphics workspace">
    <div className="tab-heading-row"><div><h2>Graphics</h2><p>Edit source artwork and trace from a reference image.</p></div>{focus && <button type="button" onClick={onReturn} disabled={busy || loading}>Return to {focus.returnTab === "pokemon" ? "Pokémon" : focus.returnTab === "trainers" ? "Trainers" : "Maps"}</button>}</div>
    {error && <p className="graphics-error" role="alert">{error}</p>}
    {notice && <p className="help-text" role="status">{notice}</p>}
    {draftWarning && <p className="graphics-error" role="status">{draftWarning} You can export the artwork as a PNG to retain it.</p>}
    <div className="graphics-layout">
      <aside className="graphics-browser" aria-label="Graphics asset browser">
        <label className="editor-field"><span>Category</span><select aria-label="Category" value={category} onChange={e => setCategory(e.target.value)}>{Object.entries(categories).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
        <label className="editor-field"><span>Find graphics</span><input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Name, label or file path" /></label>
        <button type="button" disabled={busy || loading || dirty} onClick={() => {
          setLoading(true); setError(null);
          void invoke<GraphicsCatalog>("get_graphics_catalog", { refresh: true }).then(next => { setCatalog(next); setRevision(n => n + 1); if (path && next.assets.some(asset => asset.path === path)) return readAsset(path); setPath(next.assets[0]?.path ?? null); }).catch(error => setError(String(error))).finally(() => setLoading(false));
        }}>Refresh assets</button>
        <p className="help-text">{catalog ? `${filtered.length} graphics` : "Indexing source graphics…"}</p>
        <div className="graphics-asset-list">{filtered.slice(0, visibleCount).map(asset => <button type="button" key={asset.path} className={`graphics-asset${asset.path === path ? " active" : ""}`} aria-pressed={asset.path === path} disabled={busy || loading} onClick={() => void chooseAsset(asset)}><Thumbnail asset={asset} revision={revision} /><span>{asset.name}<small>{asset.format.toUpperCase()}{asset.reason ? " · inspect only" : ""}</small></span></button>)}</div>
        {filtered.length > visibleCount && <button type="button" onClick={() => setVisibleCount(n => n + 60)}>Show more graphics</button>}
        {catalog?.warnings.length ? <details><summary>Reference scan notes ({catalog.warnings.length})</summary><ul>{catalog.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></details> : null}
      </aside>
      <section className="graphics-edit-panel" aria-label="Pixel editing tools">
        <h3>{selectedAsset?.name ?? "Choose a graphic"}</h3>
        {selectedAsset && <p className="graphics-source"><code>{selectedAsset.path}</code></p>}
        {loading && <p role="status">Loading graphics…</p>}
        {!loading && !doc && <p>{selectedAsset?.reason ?? "Select an editable graphic from the asset browser."}</p>}
        {doc && <>
          {recovery && <div className="graphics-recovery" role="status"><p>{validRecovery ? "A recoverable pixel draft is available." : "A previous draft uses different source graphics. Export it for reference or discard it; the current source is preserved."}</p><div className="graphics-controls"><button type="button" disabled={!validRecovery || busy} onClick={() => { commit(recovery.pixels.slice()); setRecovery(null); }}>Resume draft</button><button type="button" onClick={() => download(encodeGraphicsPng(recovery), "graphics-draft.png")}>Export draft PNG</button><button type="button" onClick={() => { void graphicsDraftOperation(project.storageKey, doc.asset.path, "delete").then(() => setRecovery(null)).catch(error => setDraftWarning(String(error))); }}>Discard draft</button></div></div>}
          <div className="graphics-controls"><label className="editor-field"><span>Drawing tool</span><select aria-label="Drawing tool" value={tool} disabled={!canEdit} onChange={e => setTool(e.target.value as Tool)}><option value="pencil">Pencil</option><option value="fill">Flood fill</option><option value="pick">Eyedropper</option><option value="select">Select rectangle</option><option value="reference" disabled={!reference}>Move reference</option><option value="pan">Scroll artwork</option></select></label><label className="editor-field"><span>Pixel zoom</span><select aria-label="Pixel zoom" value={zoom} onChange={e => setZoom(Number(e.target.value))}>{[1, 2, 4, 8, 12, 16, 24, 32].map(n => <option value={n} key={n}>{n}×</option>)}</select></label><label><input type="checkbox" checked={showGrid} onChange={e => setShowGrid(e.target.checked)} /> Grid</label><label><input type="checkbox" checked={compare} onChange={e => setCompare(e.target.checked)} /> Show original</label></div>
          <div className="graphics-controls graphics-stroke-controls"><button type="button" disabled={!canEdit || !undo.current.length} onClick={() => undoStroke("undo")}>Undo stroke</button><button type="button" disabled={!canEdit || !redo.current.length} onClick={() => undoStroke("redo")}>Redo stroke</button><button type="button" disabled={!canEdit} onClick={copySelection}>Copy pixels</button><button type="button" disabled={!canEdit || !hasClipboard || clipboard.current?.depth !== doc.depth} onClick={pasteSelection}>Paste pixels</button><button type="button" disabled={!canEdit} onClick={() => commit(flipGraphics(pixelsRef.current, doc.width, selection ?? rect, "horizontal"))}>Flip horizontal</button><button type="button" disabled={!canEdit} onClick={() => commit(flipGraphics(pixelsRef.current, doc.width, selection ?? rect, "vertical"))}>Flip vertical</button>{selection && <button type="button" onClick={() => setSelection(null)}>Clear selection</button>}</div>
          <div className="graphics-controls graphics-shades" aria-label="Paint shades">{palette.map((color, i) => <button type="button" key={i} aria-label={`Paint shade ${i}`} aria-pressed={shade === i} disabled={!canEdit} onClick={() => setShade(i)}><span style={{ backgroundColor: color }} />{i}</button>)}</div>
          {doc.asset.category === "tilesets" && <div className="graphics-tile-picker"><label className="editor-field"><span>Edit region</span><select aria-label="Edit region" value={tile === null ? "sheet" : String(tile)} onChange={e => { setTile(e.target.value === "sheet" ? null : Number(e.target.value)); setSelection(null); setZoom(e.target.value === "sheet" ? 4 : 24); }}><option value="sheet">Whole tile sheet</option>{Array.from({ length: doc.width * doc.height / 64 }, (_, i) => <option key={i} value={i}>Tile {i} (${i.toString(16).padStart(2, "0").toUpperCase()})</option>)}</select></label><div className="graphics-atlas-scroll"><canvas ref={atlas} aria-label="Tileset tile picker" onClick={event => { const box = event.currentTarget.getBoundingClientRect(); setTile(Math.floor((event.clientY - box.top) * doc.height / box.height / 8) * (doc.width / 8) + Math.floor((event.clientX - box.left) * doc.width / box.width / 8)); setSelection(null); setZoom(24); }} style={{ width: doc.width * 2, height: doc.height * 2 }} /></div></div>}
          <div className="graphics-canvas-viewport" ref={canvasViewport} role="region" aria-label="Artwork drawing viewport"><canvas ref={canvas} className="graphics-canvas" aria-label="Pixel drawing canvas" tabIndex={0} style={{ touchAction: tool === "pan" ? "auto" : "none" }} onPointerDown={startStroke} onPointerMove={moveStroke} onPointerUp={finishStroke} onPointerCancel={finishStroke} onLostPointerCapture={finishStroke} onKeyDown={e => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undoStroke(e.shiftKey ? "redo" : "undo"); return; }
            const delta: Record<string, number[]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
            if (delta[e.key]) { e.preventDefault(); setCursor(at => ({ x: Math.max(rect.x, Math.min(rect.x + rect.width - 1, at.x + delta[e.key][0])), y: Math.max(rect.y, Math.min(rect.y + rect.height - 1, at.y + delta[e.key][1])) })); }
            if (e.key === " " && canEdit) { e.preventDefault(); const x = Math.max(rect.x, Math.min(rect.x + rect.width - 1, cursor.x)), y = Math.max(rect.y, Math.min(rect.y + rect.height - 1, cursor.y)); commit(drawPixelLine(pixelsRef.current, doc.width, doc.height, x, y, x, y, shade)); }
          }}>Use the arrow keys to choose a pixel and Space to paint it.</canvas></div>
          <p className="help-text graphics-pixel-status">{doc.width}×{doc.height} source pixels · {1 << doc.depth} shades · {dirty ? "Unsaved pixels" : "Saved artwork"}. Keyboard: arrows move, Space paints, Ctrl/Cmd+Z undoes.</p>
          <div className="graphics-controls"><label className="graphics-file-button">Import artwork PNG<input type="file" accept="image/png" disabled={!canEdit} onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void importArtwork(file); }} /></label><button type="button" disabled={busy} onClick={() => download(encodeGraphicsPng({ ...doc, pixels }), doc.asset.path.split("/").pop()!.replace(/\.[^.]+$/, ".png"))}>Export artwork PNG</button><button type="button" className="primary-action" disabled={!dirty || busy || loading || doc.asset.references.length > 0 && !confirmShared} onClick={() => void save()}>Save graphic</button></div>
        </>}
      </section>
      <aside className="graphics-inspector" aria-label="Graphics preview and reference">
        <h3>Tracing reference</h3><label className="graphics-file-button">Upload reference image<input type="file" accept="image/png,image/jpeg,image/webp" disabled={!doc || busy} onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void uploadReference(file); }} /></label><p className="help-text">PNG, JPEG or WebP. The reference is a temporary drawing guide and is excluded from artwork exports and project saves.</p>
        {reference && <div className="graphics-reference-controls"><p className="graphics-source">{reference.name}</p><label><input type="checkbox" checked={reference.visible} onChange={e => setReference({ ...reference, visible: e.target.checked })} /> Show reference</label><label className="editor-field"><span>Reference opacity ({reference.opacity}%)</span><input type="range" min="0" max="100" value={reference.opacity} onChange={e => setReference({ ...reference, opacity: Number(e.target.value) })} /></label><label className="editor-field"><span>Reference scale (%)</span><input type="number" min="0.01" max="1600" step="0.1" value={Number(reference.scale.toFixed(3))} onChange={e => { const value = Number(e.target.value); if (Number.isFinite(value) && value > 0 && value <= 1600) setReference({ ...reference, scale: value }); }} /></label><div className="graphics-reference-position">{(["x", "y"] as const).map(axis => <label className="editor-field" key={axis}><span>Reference {axis.toUpperCase()}</span><input type="number" min="-8192" max="8192" value={reference[axis]} onChange={e => { const value = Number(e.target.value); if (Number.isFinite(value)) setReference({ ...reference, [axis]: Math.max(-8192, Math.min(8192, value)) }); }} /></label>)}</div><div className="graphics-controls"><button type="button" onClick={() => setReference({ ...reference, x: 0, y: 0, scale: Math.min(rect.width / reference.image.width, rect.height / reference.image.height) * 100 })}>Fit reference</button><button type="button" onClick={() => { ++referenceRequest.current; URL.revokeObjectURL(reference.url); referenceRef.current = null; setReference(null); if (tool === "reference") setTool("pencil"); }}>Remove reference</button></div></div>}
        {doc && <><h3>Artwork preview</h3><label className="editor-field"><span>Preview palette</span><select aria-label="Preview palette" value={paletteChoice} onChange={e => setPaletteChoice(e.target.value)}><option value="gray">Grayscale</option><option value="green">DMG green</option>{focus?.palette?.length === 4 && <option value="game">Selected game palette</option>}</select></label><div className="graphics-native-preview"><PixelPreview doc={doc} pixels={pixels} palette={palette} /></div><p className="help-text">Palette previews do not change pixel indices or game palette assignments.</p>{mapContext && doc.asset.category === "tilesets" && mapContext.tilesetGfxPath.replace(/\.(?:png|2bpp)$/, "") === doc.asset.path.replace(/\.(?:png|2bpp)$/, "") && <><h4>{mapContext.map.displayName}</h4><MapPreview doc={doc} pixels={pixels} map={mapContext} /></>}<h3>Source references</h3><p className="help-text">Direct binary references, including aliases and dimension headers. Computed paths and engine callers may have additional uses.</p><ul className="graphics-references">{doc.asset.references.map(ref => <li key={`${ref.path}:${ref.line}`}><strong>{ref.labels.join(", ") || "Binary include"}</strong><code>{ref.path}:{ref.line}</code></li>)}</ul>{!doc.asset.references.length && <p className="help-text">No literal binary references found.</p>}{doc.asset.references.length > 0 && <label className="graphics-shared"><input type="checkbox" checked={confirmShared} onChange={e => setConfirmShared(e.target.checked)} /> Apply this artwork to every use of this source.</label>}<p className="help-text">Dimensions and tile order stay fixed. Tile collision and animation commands are edited separately.</p></>}
      </aside>
    </div>
  </section>;
}
