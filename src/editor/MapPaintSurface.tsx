import { useEffect, useRef } from "react";
import type { MapVisualization } from "../core/types";
import { renderBlocks, renderMap, renderTiles } from "./mapCanvasDrawing";

export function MapPaintSurface({ visualization, kind = "map", zoom = 1, cellSize = 32, selected, onCell, onStart, onEnd, label, disabled = false }: {
  visualization: MapVisualization; kind?: "map" | "blocks" | "tiles"; zoom?: number; cellSize?: number;
  selected?: { x: number; y: number }; label: string; disabled?: boolean;
  onCell?(x: number, y: number): void; onStart?(): void; onEnd?(): void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null), drawing = useRef(false);
  const width = kind === "map" ? visualization.map.width * 32 : kind === "blocks" ? 256 : 128;
  const height = kind === "map" ? visualization.map.height * 32 : kind === "blocks" ? Math.ceil(visualization.blockCount / 8) * 32 : Math.ceil(visualization.tileCount / 16) * 8;
  const size = kind === "map" ? cellSize : kind === "blocks" ? 32 : 8;
  useEffect(() => {
    if (!canvas.current) return;
    if (kind === "blocks") renderBlocks(canvas.current, visualization);
    else if (kind === "tiles") renderTiles(canvas.current, visualization);
    else renderMap(canvas.current, visualization, true, cellSize);
  }, [visualization, kind, cellSize]);
  function hit(event: React.PointerEvent<HTMLCanvasElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.floor((event.clientX - bounds.left) * width / bounds.width / size);
    const y = Math.floor((event.clientY - bounds.top) * height / bounds.height / size);
    if (x >= 0 && y >= 0 && x < width / size && y < height / size) onCell?.(x, y);
  }
  return <div className="terrain-scroll"><div className="terrain-surface" style={{ width: width * zoom, height: height * zoom }}>
    <canvas ref={canvas} aria-label={label} style={{ width: width * zoom, height: height * zoom, touchAction: onCell && !disabled ? "none" : "auto", cursor: onCell && !disabled ? "crosshair" : "default" }}
      onPointerDown={event => { if (disabled || !onCell || event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); drawing.current = true; onStart?.(); hit(event); }}
      onPointerMove={event => { if (drawing.current) hit(event); }}
      onPointerUp={event => { if (!drawing.current) return; drawing.current = false; event.currentTarget.releasePointerCapture(event.pointerId); onEnd?.(); }}
      onPointerCancel={() => { drawing.current = false; onEnd?.(); }} />
    {selected && <span className="terrain-selection" style={{ left: selected.x * size * zoom, top: selected.y * size * zoom, width: size * zoom, height: size * zoom }} />}
  </div></div>;
}
