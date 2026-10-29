import { useEffect, useMemo, useRef, useState } from "react";
import { animationTitle, composeAnimationFrame, type AnimationFrameBlock, type AnimationSource, type BattleAnimationCatalog, type BattleAnimationScript, type BattleAnimationStep } from "./core/battleAnimations";
import type { GraphicsDocument } from "./core/graphics";
import { invoke } from "./platform/compat";
import "./BattleAnimationsPanel.css";

function Source({ source, title = "View source" }: { source: AnimationSource | null; title?: string }) {
  return source && <details className="animation-source"><summary>{title} · {source.path}:{source.line}</summary><pre>{source.text}</pre></details>;
}
function Warnings({ warnings }: { warnings: string[] }) {
  return warnings.length > 0 && <div className="graphics-error" role="status"><p>Some source details need inspection.</p><ul>{[...new Set(warnings)].map(warning => <li key={warning}>{warning}</li>)}</ul></div>;
}
function Composition({ block, sheet, tileCount }: { block: AnimationFrameBlock; sheet: GraphicsDocument | null; tileCount: number | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const image = useMemo(() => sheet && tileCount !== null ? composeAnimationFrame(block, sheet, tileCount) : null, [block, sheet, tileCount]);
  useEffect(() => {
    const element = canvas.current;
    if (!element || !image) return;
    element.width = image.width; element.height = image.height;
    const context = element.getContext("2d"); if (!context) return;
    context.clearRect(0, 0, image.width, image.height);
    image.pixels.forEach((shade, i) => { if (shade !== null) { context.fillStyle = ["#ffffff", "#aaaaaa", "#555555", "#000000"][shade]; context.fillRect(i % image.width, Math.floor(i / image.width), 1, 1); } });
  }, [image]);
  return image ? <canvas ref={canvas} role="img" aria-label={`Assembled ${block.label}`} style={{ width: image.width * 3, height: image.height * 3 }} /> : <p className="help-text">{sheet ? "Composition unavailable for this source." : "Loading tile artwork…"}</p>;
}
const modes: Record<number, string> = {
  0: "Wait, then clear sprites and reset the destination.",
  1: "Wait, then clear sprites and reset the destination.",
  2: "Append sprites without a delay or clearing.",
  3: "Wait, then append sprites without clearing.",
  4: "Wait, retain sprites and reuse the destination.",
};

function StepInspector({ catalog, script, step, onArtwork, onMove }: {
  catalog: BattleAnimationCatalog; script: BattleAnimationScript; step: BattleAnimationStep;
  onArtwork(path: string): void; onMove(id: number): void;
}) {
  const subanimation = catalog.subanimations.find(sub => sub.id === step.targetId);
  const effect = catalog.effects.find(effect => effect.id === step.targetId);
  const sheet = catalog.sheets.find(sheet => sheet.id === step.sheetId);
  const [artwork, setArtwork] = useState<GraphicsDocument | null>(null), [error, setError] = useState<string | null>(null), [frameIndex, setFrameIndex] = useState(0);
  useEffect(() => {
    let cancelled = false; setArtwork(null); setError(null); setFrameIndex(0);
    if (step.kind === "subanimation" && sheet?.path) void invoke<GraphicsDocument>("get_graphics_document", { path: sheet.path }).then(doc => { if (!cancelled) setArtwork(doc); }).catch(error => { if (!cancelled) setError(String(error)); });
    return () => { cancelled = true; };
  }, [step, sheet?.path]);
  const frame = subanimation?.frames[frameIndex], block = catalog.blocks.find(block => block.id === frame?.blockId);
  const users = catalog.moves.filter(move => catalog.scripts.find(script => script.id === move.animationId)?.steps.some(candidate => candidate.kind === step.kind && candidate.targetId === step.targetId));
  return <section className="animation-inspector" aria-label="Animation step inspector">
    <h3>{animationTitle(step.target)}</h3>
    <p className="muted-code">{step.target}</p>
    <p><strong>Sound cue:</strong> {step.sound === "NO_MOVE" ? "No sound cue" : step.sound}</p>
    {error && <p role="alert" className="graphics-error">{error}</p>}
    {step.kind === "effect" && <>
      <p>This step calls a special-effect routine. Its timing and screen changes are controlled by that routine.</p>
      <p><strong>Routine:</strong> <code>{effect?.routine ?? "Unresolved"}</code></p>
      <Source source={effect?.source ?? null} title="Effect binding" />
      <Source source={effect?.routineSource ?? null} title="Effect routine" />
    </>}
    {step.kind === "subanimation" && <>
      <div className="animation-facts"><p><strong>Tile sheet {step.sheetId ?? "?"}</strong><br />{sheet?.path ?? "Unresolved tile source"}</p><p><strong>Frame delay setting</strong><br />{step.delay ?? "Unresolved"} game frames</p><p><strong>Sequence transform</strong><br />{subanimation ? animationTitle(subanimation.type) : "Unresolved"}</p></div>
      {sheet?.path && <button type="button" onClick={() => onArtwork(sheet.path!)}>Edit tile sheet {sheet.id}</button>}
      <p className="help-text">Isolated frame compositions use the selected tile sheet. Placement, opponent transforms, retained sprites and screen effects are described below; these thumbnails show the source pieces before those changes.</p>
      {subanimation && <>
        <Warnings warnings={subanimation.warnings} />
        <label className="editor-field"><span>Sequence frame ({subanimation.frames.length} entries)</span><select aria-label="Sequence frame" value={Math.min(frameIndex, Math.max(0, subanimation.frames.length - 1))} onChange={event => setFrameIndex(Number(event.target.value))}>{subanimation.frames.map((frame, i) => <option key={i} value={i}>{i + 1} · {frame.block}</option>)}</select></label>
        <div className="animation-frame-strip" aria-label="Sequence frames">{subanimation.frames.map((_, i) => <button type="button" key={i} aria-label={`Inspect sequence frame ${i + 1}`} aria-pressed={i === frameIndex} onClick={() => setFrameIndex(i)}>{i + 1}</button>)}</div>
        {frame && <div className="animation-frame-detail"><div className="animation-composition">{block && <Composition block={block} sheet={artwork} tileCount={sheet?.tileCount ?? null} />}</div><div><h4>{block?.label ?? frame.block}</h4><p><strong>Base coordinate:</strong> X {frame.x ?? "?"}, Y {frame.y ?? "?"} (OAM coordinates)</p><p className="help-text">OAM adds a hardware offset of 8 pixels to X and 16 to Y.</p><p><strong>Frame mode:</strong> {frame.mode}<br />{frame.modeId === null ? "Unresolved mode" : modes[frame.modeId] ?? "Custom mode"}</p><p><strong>Tiles:</strong> {block ? [...new Set(block.sprites.map(sprite => `$${sprite.tile.toString(16).padStart(2, "0")}`))].join(", ") : "Unresolved"}</p><Source source={frame.source} title="Frame placement" /></div></div>}
        <p className="help-text">The delay is a per-frame engine setting. Sprite cleanup, frame modes and engine effects can add or skip waits. Opponent transforms depend on the sequence type and whose turn it is.</p>
        {block && <><Warnings warnings={block.warnings} /><Source source={block.source} title="Sprite composition" /></>}
        <Source source={subanimation.source} title="Subanimation sequence" />
      </>}
    </>}
    <Source source={step.source} title="Move script command" />
    {step.kind !== "unknown" && <details className="animation-shared"><summary>Used by {users.length} moves</summary><p className="help-text">These moves reference this reusable {step.kind === "effect" ? "effect" : "sequence"}. A sequence can use different tile sheets.</p><div className="animation-use-list">{users.map(move => <button type="button" key={move.id} disabled={move.animationId === script.id} onClick={() => onMove(move.id)}>{move.name}</button>)}</div></details>}
  </section>;
}

export function BattleAnimationsPanel({ moveId, onArtwork }: { moveId?: number; onArtwork(path: string): void }) {
  const [catalog, setCatalog] = useState<BattleAnimationCatalog | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null);
  const [library, setLibrary] = useState("moves"), [search, setSearch] = useState(""), [selected, setSelected] = useState(moveId ?? 1), [stepIndex, setStepIndex] = useState(0);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => { if (moveId !== undefined) { setLibrary("moves"); setSelected(moveId); setStepIndex(0); setSearch(""); } }, [moveId]);
  useEffect(() => {
    let cancelled = false; setLoading(true); setError(null);
    void invoke<BattleAnimationCatalog>("get_battle_animation_catalog").then(catalog => { if (!cancelled) setCatalog(catalog); }).catch(error => { if (!cancelled) setError(String(error)); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refresh]);
  useEffect(() => { const changed = () => setRefresh(value => value + 1); window.addEventListener("yellow-editor:history-changed", changed); return () => window.removeEventListener("yellow-editor:history-changed", changed); }, []);
  const move = library === "moves" ? catalog?.moves.find(move => move.id === selected) : null;
  const script = library === "moves" ? catalog?.scripts.find(script => script.id === move?.animationId) : library === "other" ? catalog?.scripts.find(script => script.id === selected) : null;
  const selectedEffect = library === "effects" ? catalog?.effects.find(effect => effect.id === selected) : null;
  const step = script?.steps[Math.min(stepIndex, Math.max(0, script.steps.length - 1))];
  const hooks = catalog?.hooks.filter(hook => hook.animationId === script?.id) ?? [];
  const chooseMove = (id: number) => { setLibrary("moves"); setSelected(id); setStepIndex(0); setSearch(""); };
  const entries = !catalog ? [] : library === "moves" ? catalog.moves.map(move => ({ id: move.id, title: move.name, detail: `${move.constant} ${move.animation}` }))
    : library === "other" ? catalog.scripts.filter(script => !catalog.moves.some(move => move.id === script.id)).map(script => ({ id: script.id, title: animationTitle(script.constant), detail: script.label }))
      : catalog.effects.map(effect => ({ id: effect.id, title: animationTitle(effect.constant), detail: `${effect.constant} ${effect.routine}` }));
  const filtered = entries.filter(entry => `${entry.title} ${entry.detail} ${entry.id} $${entry.id.toString(16)}`.toLowerCase().includes(search.toLowerCase()));
  const effectUsers = selectedEffect && catalog ? catalog.moves.filter(move => catalog.scripts.find(script => script.id === move.animationId)?.steps.some(step => step.kind === "effect" && step.targetId === selectedEffect.id)) : [];
  const sharedScripts = script?.steps.length && catalog ? catalog.moves.filter(move => catalog.scripts.find(candidate => candidate.id === move.animationId)?.steps[0]?.source.line === script.steps[0]?.source.line) : [];
  return <section className="battle-animations" aria-label="Move animation explorer">
    <div className="tab-heading-row"><div><h3>Move animations</h3><p>Follow move scripts from sound cues and reusable frames to screen-effect routines.</p></div><button type="button" disabled={loading} onClick={() => setRefresh(value => value + 1)}>Refresh animation sources</button></div>
    <p className="help-text">Source inspection is read-only. Open a linked tile sheet to edit its pixels. Full battle playback and script editing are future steps.</p>
    {loading && <p role="status">Reading animation sources…</p>}
    {error && <p className="graphics-error" role="alert">{error}</p>}
    {catalog && !loading && <><Warnings warnings={catalog.warnings} /><div className="animation-layout">
      <aside className="animation-library" aria-label="Animation library">
        <label className="editor-field"><span>Browse animations</span><select aria-label="Browse animations" value={library} onChange={event => { const value = event.target.value; setLibrary(value); setSearch(""); setStepIndex(0); setSelected(value === "moves" ? catalog.moves[0]?.id ?? 1 : value === "effects" ? catalog.effects[0]?.id ?? 0 : catalog.scripts.find(script => !catalog.moves.some(move => move.id === script.id))?.id ?? 0); }}><option value="moves">Moves</option><option value="other">Status & other animations</option><option value="effects">Screen & special effects</option></select></label>
        <label className="editor-field"><span>Find animations</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Move, effect, label or ID" /></label>
        <p className="help-text">{filtered.length} {library === "moves" ? "moves" : library === "effects" ? "effects" : "animations"}</p>
        <div className="animation-entry-list">{filtered.map(entry => <button type="button" key={entry.id} className={selected === entry.id ? "active" : ""} aria-pressed={selected === entry.id} onClick={() => { setSelected(entry.id); setStepIndex(0); }}>{entry.title}<small>${entry.id.toString(16).padStart(2, "0").toUpperCase()}</small></button>)}</div>
        {!filtered.length && <p>No matches.</p>}
      </aside>
      <div className="animation-content">
        {(move || script) && <><h3>{move?.name ?? animationTitle(script!.constant)}</h3><p className="muted-code">{move?.constant ?? script?.constant} → {move?.animation ?? script?.constant} → {script?.label ?? "Unresolved animation"}</p></>}
        {move && !script && <p role="status">The animation assignment could not be resolved. Inspect the project’s move and animation pointer sources.</p>}
        {script && <>
          <Warnings warnings={script.warnings} />
          <p>{script.steps.length} ordered steps · {script.steps.filter(step => step.kind === "subanimation").length} frame sequences · {script.steps.filter(step => step.kind === "effect").length} scripted effects</p>
          {sharedScripts.length > 1 && <p className="help-text">Shared script: {sharedScripts.map(move => move.name).join(", ")}.</p>}
          <ol className="animation-step-list" aria-label="Animation sequence">{script.steps.map((step, i) => <li key={i}><button type="button" aria-pressed={i === stepIndex} onClick={() => setStepIndex(i)}><strong>{i + 1}. {animationTitle(step.target)}</strong><span>{step.kind === "subanimation" ? `Frame sequence · sheet ${step.sheetId ?? "?"} · delay ${step.delay ?? "?"}` : step.kind === "effect" ? "Screen / special effect" : "Source inspection needed"} · {step.sound === "NO_MOVE" ? "no sound cue" : step.sound}</span></button></li>)}</ol>
          {!script.steps.length && <p>No animation steps were resolved.</p>}
          {step && <StepInspector key={`${refresh}:${script.id}:${stepIndex}`} catalog={catalog} script={script} step={step} onArtwork={onArtwork} onMove={chooseMove} />}
          <section className="animation-engine"><h4>Additional engine effects</h4>{hooks.length ? <><p>These routines run after each frame block is drawn for this animation ID, in addition to its script.</p>{hooks.map(hook => <div key={hook.constant}><p><code>{hook.routine}</code></p><Source source={hook.source} title="Engine hook binding" /><Source source={hook.routineSource} title="Engine hook routine" /></div>)}</> : <p className="help-text">No per-frame hook is listed for this animation ID.</p>}
            <details><summary>Opponent variants & hit reactions</summary><p>The engine can substitute a different animation on the opponent’s turn. It can also add a hit reaction after the move, using runtime animation type and battle state.</p>{catalog.engineNotes.map(source => <Source key={source.line} source={source} title="Engine rules" />)}<ul>{catalog.impacts.map(impact => <li key={impact.constant}>{animationTitle(impact.constant)} → <code>{impact.routine}</code><Source source={impact.source} title="Reaction routine" /></li>)}</ul></details>
          </section>
          <Source source={script.source} title="Full animation script" />
        </>}
        {selectedEffect && <><h3>{animationTitle(selectedEffect.constant)}</h3><p className="muted-code">{selectedEffect.constant} → {selectedEffect.routine}</p><p>Called directly by {effectUsers.length} move scripts.</p><div className="animation-use-list">{effectUsers.map(move => <button type="button" key={move.id} onClick={() => chooseMove(move.id)}>{move.name}</button>)}</div><p className="help-text">This list shows direct script calls. Engine hooks and other routines may call the same effect.</p><Source source={selectedEffect.source} title="Effect binding" /><Source source={selectedEffect.routineSource} title="Effect routine" /></>}
      </div>
    </div></>}
  </section>;
}
