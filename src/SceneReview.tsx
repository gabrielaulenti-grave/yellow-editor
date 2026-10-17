import { useEffect, useRef, useState } from "react";
import type { InteractionDocument, InteractionValues } from "./core/scriptInteractions";
import { actionPathLabel, type InteractionCheckReport } from "./core/interactionValidation";
import type { MapVisualization } from "./core/types";
import { renderMap } from "./editor/mapCanvasDrawing";
import { invoke } from "./platform/compat";

export function SceneReview({ document, values, report, checking, onCheck, onLocate, onPlayerStart }: {
  document: InteractionDocument; values: InteractionValues; report: InteractionCheckReport | null; checking: boolean;
  onCheck(): void; onLocate(path: string): void; onPlayerStart(x: number, y: number): void;
}) {
  const [map, setMap] = useState<MapVisualization | null>(null), [mapError, setMapError] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null), viewport = useRef<HTMLDivElement>(null), options = values.scene!;
  const problem = report?.issues.find(issue => issue.tile)?.tile;
  useEffect(() => {
    let cancelled = false;
    void invoke<MapVisualization>("get_map_visualization", { mapConstant: document.scene.mapConstant }).then(next => {
      if (!cancelled) { setMap(next); setMapError(null); }
    }, error => { if (!cancelled) setMapError(String(error)); });
    return () => { cancelled = true; };
  }, [document]);
  useEffect(() => {
    if (!map || !canvas.current) return;
    renderMap(canvas.current, map, true, 16);
    const ctx = canvas.current.getContext("2d"); if (!ctx) return;
    const marker = (x: number, y: number, color: string, label: string) => {
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= map.map.width * 2 || y >= map.map.height * 2) return;
      ctx.fillStyle = color; ctx.fillRect(x * 16 + 1, y * 16 + 1, 14, 14);
      ctx.font = "bold 10px sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = "white"; ctx.fillText(label, x * 16 + 8, y * 16 + 12);
    };
    map.npcs.forEach(npc => marker(npc.x, npc.y, "#59636d", String(npc.id)));
    marker(options.playerX, options.playerY, "#236eb2", "P");
    if (problem) marker(problem.x, problem.y, "#b32823", "!");
  }, [map, options.playerX, options.playerY, problem]);
  useEffect(() => {
    const focus = problem ?? { x: options.playerX, y: options.playerY }, box = viewport.current;
    if (map && box && Number.isFinite(focus.x) && Number.isFinite(focus.y)) {
      box.scrollLeft = focus.x * 16 - box.clientWidth / 2; box.scrollTop = focus.y * 16 - box.clientHeight / 2;
    }
  }, [map, problem]);
  const idle = document.scene.idleStates.find(state => state.id === options.idleState);
  return <section className="scene-review" aria-label="Scene review">
    <strong>Scene review</strong>
    <p>{options.trigger === "coordinate" ? "Starts when the player reaches" : "Interact with the NPC or sign while the player stands at"} ({options.playerX}, {options.playerY}) on {document.scene.mapConstant.replace(/_/g, " ")}.</p>
    {document.scene.stateVariable && <p>Requires map state {options.idleState}: {idle?.label ?? "unknown state"}. Story events can change this state; choose the state that applies when this scene should run.</p>}
    {values.condition && <p>Also requires {values.condition.event.replace(/^EVENT_/, "").replace(/_/g, " ")} to be {values.condition.set ? "set" : "clear"}.</p>}
    {values.once && <p>Runs once per save file after successful completion.</p>}
    {document.scene.actors.some(actor => actor.canWalk === false) && <p>Stationary sprites can speak, emote, hide and start battles. They cannot walk or lead the player.</p>}
    <button type="button" className="small-button" disabled={checking} onClick={onCheck}>{checking ? "Checking scene…" : "Check scene"}</button>
    {report?.valid && <p role="status">Scene checks passed. This checks the current project; the player's save must also meet the trigger and state requirements.</p>}
    {report?.issues.map((issue, i) => <div key={i} role="alert" className="text-editor-error">
      <p>{issue.actionPath && <strong>{actionPathLabel(issue.actionPath)}: </strong>}{issue.message}</p>
      {issue.tile && <p>Problem tile: ({issue.tile.x}, {issue.tile.y}){map && (issue.tile.x < 0 || issue.tile.y < 0 || issue.tile.x >= map.map.width * 2 || issue.tile.y >= map.map.height * 2) ? " is outside this map." : ", marked red below."}</p>}
      {issue.actionPath && <button type="button" className="small-button" onClick={() => onLocate(issue.actionPath!)}>Go to action</button>}
    </div>)}
    {mapError && <p>Map preview unavailable: {mapError}</p>}
    {map && <><p className="help-text">P: player start. Numbers: NPCs. Red !: problem tile. Click the map to change the player start, or use the X/Y fields.</p>
      <div className="scene-review-map" ref={viewport}><canvas ref={canvas} aria-label="Scene player start and problem tiles" onClick={event => {
        const bounds = event.currentTarget.getBoundingClientRect();
        onPlayerStart(Math.floor((event.clientX - bounds.left) * event.currentTarget.width / bounds.width / 16), Math.floor((event.clientY - bounds.top) * event.currentTarget.height / bounds.height / 16));
      }} /></div></>}
  </section>;
}
