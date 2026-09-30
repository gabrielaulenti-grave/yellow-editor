import { useEffect, useMemo, useRef, useState } from "react";
import type {
  MapIndexEntry,
  MapVisualization,
  ProjectInfo,
} from "./core/types";
import { invoke } from "./platform/compat";

type MapView = "map" | "blocks" | "tiles";

const SHADE_RGB: ReadonlyArray<readonly [number, number, number]> = [
  [248, 248, 248],
  [168, 168, 168],
  [88, 88, 88],
  [16, 16, 16],
];

function tileShade(bytes: number[], tileId: number, x: number, y: number): number {
  const offset = tileId * 16 + y * 2;
  const low = bytes[offset];
  const high = bytes[offset + 1];
  if (low === undefined || high === undefined) return 0;
  const bit = 7 - x;
  return ((high >> bit) & 1) * 2 + ((low >> bit) & 1);
}

function setPixel(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  shade: number,
) {
  const rgb = SHADE_RGB[shade] ?? SHADE_RGB[0];
  const offset = (y * width + x) * 4;
  data[offset] = rgb[0];
  data[offset + 1] = rgb[1];
  data[offset + 2] = rgb[2];
  data[offset + 3] = 255;
}

function drawTileIntoImage(
  image: ImageData,
  gfx: number[],
  tileId: number,
  targetX: number,
  targetY: number,
) {
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      setPixel(
        image.data,
        image.width,
        targetX + x,
        targetY + y,
        tileShade(gfx, tileId, x, y),
      );
    }
  }
}

function renderTiles(
  canvas: HTMLCanvasElement,
  visualization: MapVisualization,
) {
  const columns = 16;
  const rows = Math.max(1, Math.ceil(visualization.tileCount / columns));
  canvas.width = columns * 8;
  canvas.height = rows * 8;
  const context = canvas.getContext("2d");
  if (!context) return;

  const image = context.createImageData(canvas.width, canvas.height);
  for (let tileId = 0; tileId < visualization.tileCount; tileId += 1) {
    drawTileIntoImage(
      image,
      visualization.tilesetGfx,
      tileId,
      (tileId % columns) * 8,
      Math.floor(tileId / columns) * 8,
    );
  }
  context.putImageData(image, 0, 0);
}

function renderBlocks(
  canvas: HTMLCanvasElement,
  visualization: MapVisualization,
) {
  const columns = 8;
  const rows = Math.max(1, Math.ceil(visualization.blockCount / columns));
  canvas.width = columns * 32;
  canvas.height = rows * 32;
  const context = canvas.getContext("2d");
  if (!context) return;

  const image = context.createImageData(canvas.width, canvas.height);
  for (let blockId = 0; blockId < visualization.blockCount; blockId += 1) {
    const blockX = (blockId % columns) * 32;
    const blockY = Math.floor(blockId / columns) * 32;
    const blockOffset = blockId * 16;

    for (let tileY = 0; tileY < 4; tileY += 1) {
      for (let tileX = 0; tileX < 4; tileX += 1) {
        const tileId = visualization.blockset[blockOffset + tileY * 4 + tileX];
        if (tileId === undefined) continue;
        drawTileIntoImage(
          image,
          visualization.tilesetGfx,
          tileId,
          blockX + tileX * 8,
          blockY + tileY * 8,
        );
      }
    }
  }
  context.putImageData(image, 0, 0);
}

function renderMap(
  canvas: HTMLCanvasElement,
  visualization: MapVisualization,
  showGrid: boolean,
) {
  const width = visualization.map.width * 32;
  const height = visualization.map.height * 32;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return;

  const image = context.createImageData(width, height);
  for (let blockY = 0; blockY < visualization.map.height; blockY += 1) {
    for (let blockX = 0; blockX < visualization.map.width; blockX += 1) {
      const mapIndex = blockY * visualization.map.width + blockX;
      const blockId = visualization.mapBlocks[mapIndex];
      const blockOffset = blockId === undefined ? -1 : blockId * 16;

      for (let tileY = 0; tileY < 4; tileY += 1) {
        for (let tileX = 0; tileX < 4; tileX += 1) {
          const tileId = blockOffset < 0
            ? undefined
            : visualization.blockset[blockOffset + tileY * 4 + tileX];

          for (let pixelY = 0; pixelY < 8; pixelY += 1) {
            for (let pixelX = 0; pixelX < 8; pixelX += 1) {
              const targetX = blockX * 32 + tileX * 8 + pixelX;
              const targetY = blockY * 32 + tileY * 8 + pixelY;
              const shade = tileId === undefined
                ? ((pixelX + pixelY) % 2 === 0 ? 1 : 2)
                : tileShade(
                    visualization.tilesetGfx,
                    tileId,
                    pixelX,
                    pixelY,
                  );
              setPixel(image.data, width, targetX, targetY, shade);
            }
          }
        }
      }
    }
  }
  context.putImageData(image, 0, 0);

  if (showGrid) {
    context.save();
    context.strokeStyle = "rgba(0, 0, 0, 0.34)";
    context.lineWidth = 1;
    for (let x = 32; x < width; x += 32) {
      context.beginPath();
      context.moveTo(x + 0.5, 0);
      context.lineTo(x + 0.5, height);
      context.stroke();
    }
    for (let y = 32; y < height; y += 32) {
      context.beginPath();
      context.moveTo(0, y + 0.5);
      context.lineTo(width, y + 0.5);
      context.stroke();
    }
    context.restore();
  }
}

function MapCanvas({
  visualization,
  view,
  zoom,
  showGrid,
  showWarps,
  selectedWarpId,
  arrivalWarpId,
  onSelectWarp,
}: {
  visualization: MapVisualization;
  view: MapView;
  zoom: number;
  showGrid: boolean;
  showWarps: boolean;
  selectedWarpId: number | null;
  arrivalWarpId: number | null;
  onSelectWarp: (warpId: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (view === "tiles") {
      renderTiles(canvas, visualization);
    } else if (view === "blocks") {
      renderBlocks(canvas, visualization);
    } else {
      renderMap(canvas, visualization, showGrid);
    }
  }, [visualization, view, showGrid]);

  const scale = view === "tiles" ? Math.max(zoom, 2) : zoom;
  const intrinsicSize = view === "map"
    ? {
        width: visualization.map.width * 32,
        height: visualization.map.height * 32,
      }
    : view === "blocks"
      ? {
          width: 8 * 32,
          height: Math.max(1, Math.ceil(visualization.blockCount / 8)) * 32,
        }
      : {
          width: 16 * 8,
          height: Math.max(1, Math.ceil(visualization.tileCount / 16)) * 8,
        };

  const displayWidth = intrinsicSize.width * scale;
  const displayHeight = intrinsicSize.height * scale;

  return (
    <div
      className="world-map-stage"
      style={{ width: displayWidth, height: displayHeight }}
    >
      <canvas
        ref={canvasRef}
        className="world-map-canvas"
        style={{
          width: displayWidth,
          height: displayHeight,
        }}
        aria-label={
          view === "map"
            ? `${visualization.map.displayName} map preview`
            : view === "blocks"
              ? `${visualization.tilesetName} blockset preview`
              : `${visualization.tilesetName} tile preview`
        }
      />

      {view === "map" && showWarps && visualization.warps.map((warp) => (
        <button
          key={warp.id}
          type="button"
          className={[
            "world-map-warp-marker",
            warp.id === selectedWarpId ? "selected" : "",
            warp.id === arrivalWarpId ? "arrival" : "",
          ].filter(Boolean).join(" ")}
          style={{
            left: (warp.x * 16 + 8) * scale,
            top: (warp.y * 16 + 8) * scale,
          }}
          onClick={() => onSelectWarp(warp.id)}
          aria-label={`Warp ${warp.id} at ${warp.x}, ${warp.y}`}
          title={`Warp #${warp.id} · (${warp.x}, ${warp.y})`}
        >
          {warp.id}
        </button>
      ))}
    </div>
  );
}

function formatMapId(id: number): string {
  return `$${id.toString(16).toUpperCase().padStart(2, "0")}`;
}

export function MapsTab({ project }: { project: ProjectInfo | null }) {
  const [maps, setMaps] = useState<MapIndexEntry[]>([]);
  const [selectedConstant, setSelectedConstant] = useState<string | null>(null);
  const [visualization, setVisualization] = useState<MapVisualization | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<MapView>("map");
  const [zoom, setZoom] = useState(1);
  const [showGrid, setShowGrid] = useState(false);
  const [showWarps, setShowWarps] = useState(true);
  const [selectedWarpId, setSelectedWarpId] = useState<number | null>(null);
  const [arrivalWarpId, setArrivalWarpId] = useState<number | null>(null);
  const [navigationStack, setNavigationStack] = useState<string[]>([]);
  const [lastOutdoorMap, setLastOutdoorMap] = useState<string | null>(null);
  const [indexLoading, setIndexLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!project) {
      setMaps([]);
      setSelectedConstant(null);
      setVisualization(null);
      setSelectedWarpId(null);
      setArrivalWarpId(null);
      setNavigationStack([]);
      setLastOutdoorMap(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setIndexLoading(true);
    setError(null);

    void invoke<MapIndexEntry[]>("get_map_index")
      .then((entries) => {
        if (cancelled) return;
        setMaps(entries);
        const firstDrawable = entries.find(
          (entry) => !entry.isUnused && entry.width > 0 && entry.height > 0,
        ) ?? entries[0] ?? null;
        setSelectedConstant(firstDrawable?.constant ?? null);
      })
      .catch((reason) => {
        if (!cancelled) setError(String(reason));
      })
      .finally(() => {
        if (!cancelled) setIndexLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [project?.storageKey]);

  const selectedMap = maps.find(
    (entry) => entry.constant === selectedConstant,
  ) ?? null;

  function selectMapFromBrowser(mapConstant: string) {
    setSelectedConstant(mapConstant);
    setSelectedWarpId(null);
    setArrivalWarpId(null);
    setNavigationStack([]);
    setLastOutdoorMap(null);
  }

  function navigateToMap(mapConstant: string, destinationWarpId: number | null) {
    if (!maps.some((entry) => entry.constant === mapConstant)) {
      setError(`Destination map ${mapConstant} is not present in this project.`);
      return;
    }

    if (selectedConstant) {
      setNavigationStack((stack) => [...stack, selectedConstant]);
    }
    if (
      visualization
      && (
        visualization.tilesetConstant === "OVERWORLD"
        || visualization.connections.length > 0
      )
    ) {
      setLastOutdoorMap(visualization.map.constant);
    }

    setSelectedConstant(mapConstant);
    setSelectedWarpId(null);
    setArrivalWarpId(destinationWarpId);
    setError(null);
  }

  function goBack() {
    const destination = navigationStack[navigationStack.length - 1];
    if (!destination) return;
    setNavigationStack((stack) => stack.slice(0, -1));
    setSelectedConstant(destination);
    setSelectedWarpId(null);
    setArrivalWarpId(null);
    setError(null);
  }

  useEffect(() => {
    if (!project || !selectedMap) {
      setVisualization(null);
      return;
    }
    if (selectedMap.width <= 0 || selectedMap.height <= 0) {
      setVisualization(null);
      setPreviewLoading(false);
      setError(
        `${selectedMap.displayName} is an unused map ID with no drawable dimensions.`,
      );
      return;
    }

    let cancelled = false;
    setPreviewLoading(true);
    setVisualization(null);
    setError(null);

    void invoke<MapVisualization>("get_map_visualization", {
      mapConstant: selectedMap.constant,
    })
      .then((result) => {
        if (cancelled) return;
        setVisualization(result);
        const arrived = arrivalWarpId !== null
          && result.warps.some((warp) => warp.id === arrivalWarpId);
        setSelectedWarpId(arrived ? arrivalWarpId : null);
      })
      .catch((reason) => {
        if (!cancelled) setError(String(reason));
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [project?.storageKey, selectedMap?.constant, arrivalWarpId]);

  const filteredMaps = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return maps;
    return maps.filter((entry) =>
      entry.displayName.toLowerCase().includes(needle)
      || entry.constant.toLowerCase().includes(needle)
      || entry.headerLabel?.toLowerCase().includes(needle),
    );
  }, [maps, search]);

  const selectedWarp = visualization?.warps.find(
    (warp) => warp.id === selectedWarpId,
  ) ?? null;
  const resolvedWarpDestination = selectedWarp?.isLastMap
    ? lastOutdoorMap
    : selectedWarp?.destinationMapConstant ?? null;
  const resolvedWarpDestinationMap = resolvedWarpDestination
    ? maps.find((entry) => entry.constant === resolvedWarpDestination) ?? null
    : null;

  function navigateSelectedWarp() {
    if (!selectedWarp || !resolvedWarpDestination) return;
    navigateToMap(resolvedWarpDestination, selectedWarp.destinationWarpId);
  }

  if (!project) {
    return (
      <section className="editor-card">
        <h2>Maps</h2>
        <p className="empty-state">
          Open a Pokémon Red, Blue, or Yellow disassembly to browse its world.
        </p>
      </section>
    );
  }

  return (
    <section className="editor-card">
      <div className="tab-heading-row">
        <div>
          <h2>Maps</h2>
          <p>
            Source-backed Gen I map visualization: 8×8 tiles assemble into 4×4
            tile blocks, and each map's .blk file places those blocks into the
            game world.
          </p>
        </div>
        <span className="read-only-badge">Visualization foundation</span>
      </div>

      <div className="world-map-browser">
        <aside>
          <input
            className="full-width-input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search maps…"
          />
          <p className="browser-count">
            {indexLoading ? "Reading map index…" : `${filteredMaps.length} maps`}
          </p>
          <div className="world-map-list">
            {filteredMaps.map((entry) => (
              <button
                key={`${entry.id}:${entry.constant}`}
                type="button"
                className={entry.constant === selectedConstant ? "active" : ""}
                onClick={() => selectMapFromBrowser(entry.constant)}
              >
                <strong>{entry.displayName}</strong>
                <small>
                  {formatMapId(entry.id)} · {entry.width}×{entry.height} blocks
                  {entry.isAlias ? " · shared header" : ""}
                  {entry.isUnused ? " · unused" : ""}
                </small>
              </button>
            ))}
          </div>
        </aside>

        <div className="world-map-details">
          {selectedMap && (
            <div className="world-map-title">
              <div>
                <h3>{selectedMap.displayName}</h3>
                <code>{selectedMap.constant}</code>
              </div>
              <span>{formatMapId(selectedMap.id)}</span>
            </div>
          )}

          {previewLoading && (
            <div className="world-map-loading" aria-live="polite">
              <strong>Assembling map preview…</strong>
              <p>Reading the selected map, blockset, and 2bpp tileset graphics.</p>
            </div>
          )}

          {error && !previewLoading && (
            <div className="world-map-warning">
              <strong>Preview unavailable</strong>
              <p>{error}</p>
            </div>
          )}

          {visualization && !previewLoading && (
            <>
              <div className="world-map-facts">
                <div>
                  <span>Tileset</span>
                  <strong>{visualization.tilesetName}</strong>
                  <code>{visualization.tilesetConstant}</code>
                </div>
                <div>
                  <span>Map Size</span>
                  <strong>
                    {visualization.map.width}×{visualization.map.height} blocks
                  </strong>
                  <small>
                    {visualization.map.width * 4}×{visualization.map.height * 4} tiles
                  </small>
                </div>
                <div>
                  <span>Tiles</span>
                  <strong>{visualization.tileCount}</strong>
                  <small>8×8 pixels each</small>
                </div>
                <div>
                  <span>Blocks</span>
                  <strong>{visualization.blockCount}</strong>
                  <small>4×4 tiles each</small>
                </div>
              </div>

              <div className="world-map-controls">
                <div className="segmented-control world-map-view-control">
                  <button
                    type="button"
                    className={view === "map" ? "active" : ""}
                    onClick={() => setView("map")}
                  >
                    Map
                  </button>
                  <button
                    type="button"
                    className={view === "blocks" ? "active" : ""}
                    onClick={() => setView("blocks")}
                  >
                    Blocks
                  </button>
                  <button
                    type="button"
                    className={view === "tiles" ? "active" : ""}
                    onClick={() => setView("tiles")}
                  >
                    Tiles
                  </button>
                </div>

                <label className="world-map-zoom">
                  <span>Zoom</span>
                  <select
                    value={zoom}
                    onChange={(event) => setZoom(Number.parseInt(event.target.value, 10))}
                  >
                    <option value={1}>1×</option>
                    <option value={2}>2×</option>
                    <option value={3}>3×</option>
                  </select>
                </label>

                {view === "map" && (
                  <label className="world-map-grid-toggle">
                    <input
                      type="checkbox"
                      checked={showGrid}
                      onChange={(event) => setShowGrid(event.target.checked)}
                    />
                    <span>Block grid</span>
                  </label>
                )}
              </div>

              <div className="world-map-canvas-wrap">
                <MapCanvas
                  visualization={visualization}
                  view={view}
                  zoom={zoom}
                  showGrid={showGrid}
                />
              </div>

              <p className="help-text">
                {view === "tiles"
                  ? "Tile IDs run left-to-right, top-to-bottom. Each tile is decoded directly from the selected .2bpp source."
                  : view === "blocks"
                    ? "Block IDs run left-to-right, top-to-bottom. Every block is assembled from 16 tile IDs in the .bst blockset."
                    : "The map preview expands each .blk block ID through the selected .bst blockset and .2bpp tileset."}
              </p>

              {visualization.warnings.length > 0 && (
                <details className="world-map-warnings">
                  <summary>
                    {visualization.warnings.length} source-layout warning
                    {visualization.warnings.length === 1 ? "" : "s"}
                  </summary>
                  <ul>
                    {visualization.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </details>
              )}

              <details className="world-map-sources">
                <summary>Source files</summary>
                <dl>
                  <div>
                    <dt>Header</dt>
                    <dd><code>{visualization.map.headerPath}</code></dd>
                  </div>
                  <div>
                    <dt>Map blocks</dt>
                    <dd><code>{visualization.mapBlockPath}</code></dd>
                  </div>
                  <div>
                    <dt>Blockset</dt>
                    <dd><code>{visualization.blocksetPath}</code></dd>
                  </div>
                  <div>
                    <dt>Tileset graphics</dt>
                    <dd><code>{visualization.tilesetGfxPath}</code></dd>
                  </div>
                </dl>
              </details>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
