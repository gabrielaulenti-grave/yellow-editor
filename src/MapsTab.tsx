import { MapCreateWizard } from "./MapCreateWizard";
import { MapEncounterEditor } from "./MapEncounterEditor";
import { MapItemEditor } from "./MapItemEditor";
import { MapTrainerEditor } from "./MapTrainerEditor";
import { NativeMapObjectEditor } from "./NativeMapObjectEditor";
import { renderTiles, renderBlocks, renderMap } from "./editor/mapCanvasDrawing";
import { SearchableSelect } from "./editor/SearchableSelect";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  EncounterTableEditDocument,
  EncounterTableIndexEntry,
  FishingEditDocument,
  MapIndexEntry,
  MapVisualization,
  PokemonIndexEntry,
  ProjectInfo,
} from "./core/types";
import { invoke } from "./platform/compat";
import { MapInteractionEditor } from "./MapInteractionEditor";
import { MapTerrainEditor } from "./MapTerrainEditor";
import { MapStrengthEditor } from "./MapStrengthEditor";
import { MapPropertiesEditor } from "./MapPropertiesEditor";
import type { MapCheckReport } from "./core/mapValidation";
import { MapWarpEditor } from "./MapWarpEditor";
import { MapNpcEditor } from "./MapNpcEditor";
import { MapNpcWizard } from "./MapNpcWizard";
import { MapScriptsPanel } from "./MapScriptsPanel";

type MapView = "map" | "blocks" | "tiles";

function MapCanvas({
  visualization,
  view,
  zoom,
  showGrid,
  showWarps,
  showSigns,
  showNpcs,
  selectedWarpId,
  selectedSignId,
  selectedNpcId,
  arrivalWarpId,
  onSelectWarp,
  onSelectSign,
  onSelectNpc,
  placement,
}: {
  visualization: MapVisualization;
  view: MapView;
  zoom: number;
  showGrid: boolean;
  showWarps: boolean;
  showSigns: boolean;
  showNpcs: boolean;
  selectedWarpId: number | null;
  selectedSignId: number | null;
  selectedNpcId: number | null;
  arrivalWarpId: number | null;
  onSelectWarp: (warpId: number) => void;
  onSelectSign: (signId: number) => void;
  onSelectNpc: (npcId: number) => void;
  placement?: { x: number; y: number; onPlace(x: number, y: number): void };
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
      renderMap(canvas, visualization, showGrid, placement ? 16 : 32);
    }
  }, [visualization, view, showGrid, Boolean(placement)]);

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
      onClick={placement ? event => {
        const bounds = event.currentTarget.getBoundingClientRect();
        placement.onPlace(Math.floor((event.clientX - bounds.left) / (16 * scale)), Math.floor((event.clientY - bounds.top) / (16 * scale)));
      } : undefined}
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

      {placement && Number.isInteger(placement.x) && Number.isInteger(placement.y) && <span className="npc-placement-marker" aria-label={`New NPC at ${placement.x}, ${placement.y}`}
        style={{ left: placement.x * 16 * scale, top: placement.y * 16 * scale, width: 16 * scale, height: 16 * scale }}>+</span>}

      {view === "map" && showWarps && visualization.warps.filter(w => Number.isFinite(w.x) && Number.isFinite(w.y)).map((warp) => (
        <button
          key={`warp:${warp.id}`}
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
      {view === "map" && showSigns && visualization.signs.filter(s => Number.isFinite(s.x) && Number.isFinite(s.y)).map((sign) => (
        <button
          key={`sign:${sign.id}`}
          type="button"
          className={[
            "world-map-sign-marker",
            sign.id === selectedSignId ? "selected" : "",
          ].filter(Boolean).join(" ")}
          style={{
            left: (sign.x * 16 + 8) * scale,
            top: (sign.y * 16 + 8) * scale,
          }}
          onClick={() => onSelectSign(sign.id)}
          aria-label={`Sign ${sign.id} at ${sign.x}, ${sign.y}`}
          title={`Sign #${sign.id} · (${sign.x}, ${sign.y}) · ${sign.textConstant}`}
        >
          S
        </button>
      ))}
      {view === "map" && showNpcs && visualization.npcs.filter(n => Number.isFinite(n.x) && Number.isFinite(n.y)).map((npc) => (
        <button
          key={`npc:${npc.id}`}
          type="button"
          className={[
            "world-map-npc-marker",
            npc.objectKind === "item" ? "world-map-item-marker" : npc.trainerPartyId ? "world-map-trainer-marker" : "",
            npc.initiallyHidden ? "initially-hidden" : "",
            npc.id === selectedNpcId ? "selected" : "",
          ].filter(Boolean).join(" ")}
          style={{
            left: (npc.x * 16 + 8) * scale,
            top: (npc.y * 16 + 8) * scale,
          }}
          onClick={() => onSelectNpc(npc.id)}
          aria-label={`${npc.trainerPartyId ? "Trainer" : npc.objectKind === "item" ? "Item" : "NPC"} ${npc.id} at ${npc.x}, ${npc.y}`}
          title={`${npc.objectConstant ?? `Object #${npc.id}`} · (${npc.x}, ${npc.y}) · ${npc.itemConstant ?? npc.spriteConstant}${npc.initiallyHidden ? " · initially hidden" : ""}`}
        >
          {npc.trainerPartyId ? "T" : npc.objectKind === "item" ? "I" : npc.objectKind === "special" ? "?" : "N"}
        </button>
      ))}
    </div>
  );
}

function formatMapId(id: number): string {
  return `$${id.toString(16).toUpperCase().padStart(2, "0")}`;
}

interface MapsTabProps {
  project: ProjectInfo | null;
  encounters: EncounterTableIndexEntry[];
  fishingDocument: FishingEditDocument | null;
  pokemonIndex: PokemonIndexEntry[];
  focusMapConstant: string | null;
  onOpenWalkingEncounter(entry: EncounterTableIndexEntry): void;
  onEncountersChanged?(entries: EncounterTableIndexEntry[]): void;
  onOpenTrainerParty?(partyId: string): void;
  onOpenFishing(mapConstant: string): void;
  onOpenScript(path: string, routineLabel?: string | null): void;
  onDirtyChange?(dirty: boolean): void;
}

export function MapsTab({
  project,
  encounters,
  fishingDocument,
  pokemonIndex,
  focusMapConstant,
  onOpenWalkingEncounter,
  onEncountersChanged,
  onOpenTrainerParty,
  onOpenFishing,
  onOpenScript,
  onDirtyChange,
}: MapsTabProps) {
  const [maps, setMaps] = useState<MapIndexEntry[]>([]);
  const [mapLogic, setMapLogic] = useState<{ path: string; label?: string | null } | null>(null);
  const [selectedConstant, setSelectedConstant] = useState<string | null>(null);
  const [visualization, setVisualization] = useState<MapVisualization | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<MapView>("map");
  const [zoom, setZoom] = useState(1);
  const [showGrid, setShowGrid] = useState(false);
  const [showWarps, setShowWarps] = useState(true);
  const [showSigns, setShowSigns] = useState(true);
  const [showNpcs, setShowNpcs] = useState(true);
  const [selectedWarpId, setSelectedWarpId] = useState<number | null>(null);
  const [selectedSignId, setSelectedSignId] = useState<number | null>(null);
  const [selectedNpcId, setSelectedNpcId] = useState<number | null>(null);
  const [arrivalWarpId, setArrivalWarpId] = useState<number | null>(null);
  const [navigationStack, setNavigationStack] = useState<string[]>([]);
  const [lastOutdoorMap, setLastOutdoorMap] = useState<string | null>(null);
  const [indexLoading, setIndexLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [encounterSummary, setEncounterSummary] =
    useState<EncounterTableEditDocument | null>(null);
  const [encounterSummaryLoading, setEncounterSummaryLoading] = useState(false);
  const [encounterSummaryError, setEncounterSummaryError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createMapOpen, setCreateMapOpen] = useState(false);
  const [encounterEditorOpen, setEncounterEditorOpen] = useState(false), [itemEditorOpen, setItemEditorOpen] = useState(false);
  const [trainerEditor, setTrainerEditor] = useState<{ id: number | null } | null>(null);
  const [mapEncounters, setMapEncounters] = useState(encounters);
  useEffect(() => { setMapEncounters(encounters); }, [encounters]);
  const appliedMapFocus = useRef<string | null>(null);
  const [terrainOpen, setTerrainOpen] = useState(false);
  const [strengthOpen, setStrengthOpen] = useState(false);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [mapCheck, setMapCheck] = useState<MapCheckReport | null>(null), [checkingMap, setCheckingMap] = useState(false);
  const checkSequence = useRef(0);
  const [warpEditor, setWarpEditor] = useState<{ id: number | null } | null>(null);
  const [npcWizardOpen, setNpcWizardOpen] = useState(false);
  const [editingNpcId, setEditingNpcId] = useState<number | null>(null);
  const [nativeObjectId, setNativeObjectId] = useState<number | null>(null);
  const [mapRevision, setMapRevision] = useState(0);
  useEffect(() => { checkSequence.current++; setMapCheck(null); setCheckingMap(false); }, [selectedConstant]);
  const newNpcSelection = useRef<{ map: string; id: number } | null>(null);
  const dirtyCallback = useRef(onDirtyChange);
  dirtyCallback.current = onDirtyChange;
  useEffect(() => () => dirtyCallback.current?.(false), []);

  useEffect(() => {
    const refresh = () => { checkSequence.current++; setMapCheck(null); setCheckingMap(false); setMapRevision(value => value + 1); };
    window.addEventListener("yellow-editor:history-changed", refresh);
    return () => window.removeEventListener("yellow-editor:history-changed", refresh);
  }, []);

  useEffect(() => {
    appliedMapFocus.current = null;
    setCreateMapOpen(false);
    setEncounterEditorOpen(false); setItemEditorOpen(false);
    setTrainerEditor(null);
    setTerrainOpen(false);
    setStrengthOpen(false);
    setPropertiesOpen(false);
    setWarpEditor(null);
    setNpcWizardOpen(false);
    setEditingNpcId(null);
    setNativeObjectId(null);
    newNpcSelection.current = null;
    if (!project) {
      setMaps([]);
      setSelectedConstant(null);
      setVisualization(null);
      setSelectedWarpId(null);
      setSelectedSignId(null);
      setSelectedNpcId(null);
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

  useEffect(() => {
    if (!project || !mapRevision) return;
    let cancelled = false;
    void invoke<MapIndexEntry[]>("get_map_index").then(entries => {
      if (cancelled) return;
      setMaps(entries);
      setSelectedConstant(current => entries.some(entry => entry.constant === current) ? current : entries.find(entry => !entry.isUnused)?.constant ?? null);
    }).catch(reason => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
  }, [project?.storageKey, mapRevision]);

  const selectedMap = maps.find(
    (entry) => entry.constant === selectedConstant,
  ) ?? null;

  useEffect(() => {
    if (
      !focusMapConstant
      || maps.length === 0
      || !maps.some((entry) => entry.constant === focusMapConstant)
      || appliedMapFocus.current === focusMapConstant
    ) {
      return;
    }
    appliedMapFocus.current = focusMapConstant;
    selectMapFromBrowser(focusMapConstant);
  }, [focusMapConstant, maps]);

  function selectMapFromBrowser(mapConstant: string) {
    setSelectedConstant(mapConstant);
    setSelectedWarpId(null);
    setSelectedSignId(null);
    setSelectedNpcId(null);
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
    setSelectedSignId(null);
    setSelectedNpcId(null);
    setArrivalWarpId(destinationWarpId);
    setError(null);
  }

  function goBack() {
    const destination = navigationStack[navigationStack.length - 1];
    if (!destination) return;
    setNavigationStack((stack) => stack.slice(0, -1));
    setSelectedConstant(destination);
    setSelectedWarpId(null);
    setSelectedSignId(null);
    setSelectedNpcId(null);
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
        setSelectedSignId(previous => result.signs.some(sign => sign.id === previous) ? previous : null);
        const created = newNpcSelection.current;
        setSelectedNpcId(previous => {
          const id = created?.map === result.map.constant ? created.id : previous;
          return result.npcs.some(npc => npc.id === id) ? id : null;
        });
        newNpcSelection.current = null;
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
  }, [project?.storageKey, selectedMap?.constant, arrivalWarpId, mapRevision]);

  const selectedEncounterEntry = selectedConstant
    ? mapEncounters.find((entry) =>
        entry.affectedMaps.some((map) => map.constant === selectedConstant),
      ) ?? null
    : null;
  const selectedFishingTable = selectedConstant
    ? fishingDocument?.superRodTables.find((table) =>
        table.affectedMaps.some((map) => map.constant === selectedConstant),
      ) ?? null
    : null;

  useEffect(() => {
    if (!selectedEncounterEntry) {
      setEncounterSummary(null);
      setEncounterSummaryError(null);
      setEncounterSummaryLoading(false);
      return;
    }
    if (selectedEncounterEntry.error) {
      setEncounterSummary(null);
      setEncounterSummaryError(selectedEncounterEntry.error);
      setEncounterSummaryLoading(false);
      return;
    }

    let cancelled = false;
    setEncounterSummaryLoading(true);
    setEncounterSummaryError(null);
    void invoke<EncounterTableEditDocument>("get_encounter_table", {
      path: selectedEncounterEntry.path,
    })
      .then((document) => {
        if (!cancelled) setEncounterSummary(document);
      })
      .catch((reason) => {
        if (!cancelled) {
          setEncounterSummary(null);
          setEncounterSummaryError(String(reason));
        }
      })
      .finally(() => {
        if (!cancelled) setEncounterSummaryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedEncounterEntry?.path, selectedEncounterEntry?.error, mapRevision]);

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
  const selectedSign = visualization?.signs.find(
    (sign) => sign.id === selectedSignId,
  ) ?? null;
  const selectedNpc = visualization?.npcs.find(
    (npc) => npc.id === selectedNpcId,
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

  function speciesName(constant: string): string {
    return pokemonIndex.find((pokemon) => pokemon.constant === constant)?.displayName
      ?? constant.replace(/_/g, " ");
  }

  function speciesSummary(slots: Array<{ speciesConstant: string }>): string {
    return [...new Set(slots.map((slot) => speciesName(slot.speciesConstant)))].join(", ");
  }

  function versionLabel(version: string): string {
    return version[0]?.toUpperCase() + version.slice(1);
  }

  function constantLabel(value: string, prefix = ""): string {
    const trimmed = prefix && value.startsWith(prefix)
      ? value.slice(prefix.length)
      : value;
    return trimmed
      .replace(/_/g, " ")
      .toLowerCase()
      .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
  }

  function npcMovementSummary(
    movementConstant: string,
    directionOrRangeConstant: string,
  ): string {
    if (movementConstant === "WALK") {
      const range = directionOrRangeConstant === "ANY_DIR"
        ? "any direction"
        : directionOrRangeConstant === "UP_DOWN"
          ? "up/down"
          : directionOrRangeConstant === "LEFT_RIGHT"
            ? "left/right"
            : constantLabel(directionOrRangeConstant).toLowerCase();
      return `Walks · ${range}`;
    }
    if (movementConstant === "STAY") {
      return directionOrRangeConstant === "NONE"
        ? "Stays in place"
        : `Stays · faces ${constantLabel(directionOrRangeConstant).toLowerCase()}`;
    }
    return `${constantLabel(movementConstant)} · ${constantLabel(directionOrRangeConstant)}`;
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
        <button type="button" className="primary-button" onClick={() => setCreateMapOpen(true)}>Create map</button>
      </div>

      {createMapOpen && <MapCreateWizard exterior={visualization} onDirtyChange={onDirtyChange} onClose={() => setCreateMapOpen(false)} onCreated={result => {
        setCreateMapOpen(false);
        void invoke<MapIndexEntry[]>("get_map_index").then(entries => {
          setMaps(entries); selectMapFromBrowser(result.mapConstant);
          window.dispatchEvent(new CustomEvent("yellow-editor:history-changed", { detail: result.history }));
        }).catch(reason => setError(String(reason)));
      }} />}
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
                <div>
                  <span>Warps</span>
                  <strong>{visualization.warps.length}</strong>
                  <small>Doors, stairs, ladders, exits</small>
                </div>
                <div>
                  <span>Signs</span>
                  <strong>{visualization.signs.length}</strong>
                  <small>Background text events</small>
                </div>
                <div>
                  <span>NPCs</span>
                  <strong>{visualization.npcs.length}</strong>
                  <small>Ordinary object events</small>
                </div>
                <div>
                  <span>Connections</span>
                  <strong>{visualization.connections.length}</strong>
                  <small>Outdoor map edges</small>
                </div>
              </div>

              <section className="world-map-script-link">
                <div>
                  <strong>Map scripts</strong>
                  <small>
                    Inspect and edit this map's states, NPC logic and trainer triggers here. Shared routines remain available through Scripts.
                  </small>
                  <code>{`scripts/${visualization.mapSourceLabel}.asm`}</code>
                </div>
                <button
                  type="button"
                  className="small-button primary-action"
                  onClick={() => setMapLogic({ path: `scripts/${visualization.mapSourceLabel}.asm` })}
                >
                  Edit map logic
                </button>
              </section>

              {mapLogic && <MapScriptsPanel key={`${project?.storageKey}:${mapLogic.path}:${mapLogic.label ?? ""}`} project={project} path={mapLogic.path} label={mapLogic.label} onClose={() => setMapLogic(null)} onDirtyChange={onDirtyChange} />}

              <section className="world-map-encounters">
                {encounterEditorOpen && <MapEncounterEditor key={visualization.map.constant} mapConstant={visualization.map.constant} onClose={() => setEncounterEditorOpen(false)} onDirtyChange={onDirtyChange}
                  onSaved={history => { setEncounterEditorOpen(false); void invoke<EncounterTableIndexEntry[]>("get_encounter_index").then(entries => { setMapEncounters(entries); onEncountersChanged?.(entries); }).catch(reason => setError(String(reason))); window.dispatchEvent(new CustomEvent("yellow-editor:history-changed", { detail: history })); }} />}
                <div className="world-map-encounters-heading">
                  <div>
                    <strong>Wild encounters</strong>
                    <small>
                      Gameplay data linked to this map. Terrain-specific encounter tiles are not visualized yet.
                    </small>
                  </div>
                </div>

                <div className="world-map-encounter-grid">
                  <div className="world-map-encounter-card">
                    <div className="world-map-encounter-card-heading">
                      <div>
                        <strong>Grass &amp; Surfing</strong>
                        {selectedEncounterEntry && (
                          <small>
                            {selectedEncounterEntry.affectedMaps.length > 1
                              ? `Shared by ${selectedEncounterEntry.affectedMaps.length} maps`
                              : selectedEncounterEntry.displayName}
                          </small>
                        )}
                      </div>
                      <button type="button" className="small-button" onClick={() => setEncounterEditorOpen(true)}>Assign encounters</button>
                      {selectedEncounterEntry && (
                        <button
                          type="button"
                          className="small-button"
                          onClick={() => onOpenWalkingEncounter(selectedEncounterEntry)}
                        >
                          Open in Wild Encounters →
                        </button>
                      )}
                    </div>

                    {encounterSummaryLoading ? (
                      <p className="help-text">Reading encounter table…</p>
                    ) : encounterSummaryError ? (
                      <p className="world-map-encounter-error">{encounterSummaryError}</p>
                    ) : encounterSummary ? (
                      <div className="world-map-encounter-versions">
                        {encounterSummary.versions.map((entry) => (
                          <div key={entry.version}>
                            {encounterSummary.versions.length > 1 && (
                              <strong>{versionLabel(entry.version)}</strong>
                            )}
                            {entry.grass.rate > 0 && (
                              <p>
                                <b>Grass</b>
                                <span>Rate {entry.grass.rate} · {speciesSummary(entry.grass.slots)}</span>
                              </p>
                            )}
                            {entry.water.rate > 0 && (
                              <p>
                                <b>Surfing</b>
                                <span>Rate {entry.water.rate} · {speciesSummary(entry.water.slots)}</span>
                              </p>
                            )}
                            {entry.grass.rate === 0 && entry.water.rate === 0 && (
                              <p className="help-text">No active grass or surfing encounters.</p>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="help-text">No grass or surfing encounter table is assigned to this map.</p>
                    )}
                  </div>

                  <div className="world-map-encounter-card">
                    <div className="world-map-encounter-card-heading">
                      <div>
                        <strong>Fishing</strong>
                        <small>
                          {selectedFishingTable
                            ? selectedFishingTable.affectedMaps.length > 1
                              ? `Super Rod table shared by ${selectedFishingTable.affectedMaps.length} maps`
                              : "Map-specific Super Rod table"
                            : "No map-specific Super Rod table"}
                        </small>
                      </div>
                      {selectedConstant && fishingDocument && (
                        <button
                          type="button"
                          className="small-button"
                          onClick={() => onOpenFishing(selectedConstant)}
                        >
                          Open Fishing →
                        </button>
                      )}
                    </div>

                    {fishingDocument ? (
                      <div className="world-map-fishing-summary">
                        <p>
                          <b>Old Rod</b>
                          <span>
                            {speciesName(fishingDocument.oldRod.speciesConstant)}
                            {" Lv. "}{fishingDocument.oldRod.level}
                          </span>
                        </p>
                        <p>
                          <b>Good Rod</b>
                          <span>{fishingDocument.goodRod.map((slot) =>
                            `${speciesName(slot.speciesConstant)} Lv. ${slot.level}`
                          ).join(", ")}</span>
                        </p>
                        {selectedFishingTable ? (
                          <p>
                            <b>Super Rod</b>
                            <span>{speciesSummary(selectedFishingTable.slots)}</span>
                          </p>
                        ) : (
                          <p className="help-text">No Super Rod table is assigned specifically to this map.</p>
                        )}
                        <small>
                          Old and Good Rod contents are global when fishing is permitted; this does not identify fishable tiles.
                        </small>
                      </div>
                    ) : (
                      <p className="help-text">Fishing data is unavailable for this project.</p>
                    )}
                  </div>
                </div>
              </section>

              <div className="terrain-toolbar">
                <button type="button" className="primary-button" onClick={() => setTerrainOpen(true)}>Edit terrain</button>
                <button type="button" onClick={() => setStrengthOpen(true)}>Strength puzzles</button>
                <button type="button" onClick={() => setPropertiesOpen(true)}>Map properties</button>
                <button type="button" disabled={checkingMap} onClick={() => {
                  const sequence = ++checkSequence.current; setCheckingMap(true); setMapCheck(null);
                  void invoke<MapCheckReport>("check_map", { mapConstant: visualization.map.constant }).then(report => { if (sequence === checkSequence.current) setMapCheck(report); }).catch(reason => { if (sequence === checkSequence.current) setError(String(reason)); }).finally(() => { if (sequence === checkSequence.current) setCheckingMap(false); });
                }}>{checkingMap ? "Checking map…" : "Check map"}</button>
                <button type="button" onClick={() => setWarpEditor({ id: null })}>Add warp</button>
                <button type="button" disabled={selectedWarpId === null} onClick={() => setWarpEditor({ id: selectedWarpId })}>Edit selected warp</button>
              </div>
              {mapCheck && <section className="strength-row" aria-label="Map check results"><h4>Map checks</h4><p>{mapCheck.checkedWarps} warps checked. {mapCheck.issues.length ? "Review these possible issues; one-way routes and custom scripts may be intentional." : "No issues found in warp destinations, ordinary warp terrain, return routes or object overlaps."}</p>{mapCheck.issues.length > 0 && <ul>{mapCheck.issues.map((issue, i) => <li key={i}>{issue.message}</li>)}</ul>}</section>}
              {propertiesOpen && <MapPropertiesEditor key={`${project.storageKey}:${visualization.map.constant}`} mapConstant={visualization.map.constant}
                onDirtyChange={onDirtyChange} onClose={() => setPropertiesOpen(false)} onSaved={history => {
                  setPropertiesOpen(false); window.dispatchEvent(new CustomEvent("yellow-editor:history-changed", { detail: history }));
                }} />}
              {strengthOpen && <MapStrengthEditor key={`${project.storageKey}:${visualization.map.constant}`} mapConstant={visualization.map.constant}
                onDirtyChange={onDirtyChange} onClose={() => setStrengthOpen(false)} onSaved={history => {
                  setStrengthOpen(false); window.dispatchEvent(new CustomEvent("yellow-editor:history-changed", { detail: history }));
                }} />}
              {terrainOpen && <MapTerrainEditor key={`${project.storageKey}:${visualization.map.constant}`} mapConstant={visualization.map.constant}
                onDirtyChange={onDirtyChange} onClose={() => setTerrainOpen(false)} onSaved={history => {
                  setTerrainOpen(false); window.dispatchEvent(new CustomEvent("yellow-editor:history-changed", { detail: history }));
                }} />}
              {warpEditor && <MapWarpEditor key={`${project.storageKey}:${visualization.map.constant}:${warpEditor.id}`} visualization={visualization} warpId={warpEditor.id}
                onDirtyChange={onDirtyChange} onClose={() => setWarpEditor(null)} onSaved={history => {
                  setWarpEditor(null); window.dispatchEvent(new CustomEvent("yellow-editor:history-changed", { detail: history }));
                }} />}
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
                  <SearchableSelect
                    value={zoom}
                    onChange={(event) => setZoom(Number.parseInt(event.target.value, 10))}
                  >
                    <option value={1}>1×</option>
                    <option value={2}>2×</option>
                    <option value={3}>3×</option>
                  </SearchableSelect>
                </label>

                {view === "map" && (
                  <>
                    <label className="world-map-grid-toggle">
                      <input
                        type="checkbox"
                        checked={showGrid}
                        onChange={(event) => setShowGrid(event.target.checked)}
                      />
                      <span>Block grid</span>
                    </label>
                    <label className="world-map-grid-toggle">
                      <input
                        type="checkbox"
                        checked={showWarps}
                        onChange={(event) => setShowWarps(event.target.checked)}
                      />
                      <span>Warp markers</span>
                    </label>
                    <label className="world-map-grid-toggle">
                      <input
                        type="checkbox"
                        checked={showSigns}
                        onChange={(event) => setShowSigns(event.target.checked)}
                      />
                      <span>Sign markers</span>
                    </label>
                    <label className="world-map-grid-toggle">
                      <input
                        type="checkbox"
                        checked={showNpcs}
                        onChange={(event) => setShowNpcs(event.target.checked)}
                      />
                      <span>Object markers (N / T / I)</span>
                    </label>
                  </>
                )}
              </div>

              {view === "map" && (
                <div className="world-map-navigation">
                  <div className="world-map-navigation-heading">
                    <div>
                      <strong>Navigate the world</strong>
                      <small>
                        Follow outdoor connections or select a numbered warp on the map.
                      </small>
                    </div>
                    {navigationStack.length > 0 && (
                      <button type="button" className="small-button" onClick={goBack}>
                        ← Back
                      </button>
                    )}
                  </div>

                  {visualization.connections.length > 0 && (
                    <div className="world-map-connection-list">
                      {visualization.connections.map((connection) => {
                        const arrow = connection.direction === "north"
                          ? "↑"
                          : connection.direction === "south"
                            ? "↓"
                            : connection.direction === "east"
                              ? "→"
                              : "←";
                        return (
                          <button
                            key={`${connection.direction}:${connection.destinationMapConstant}`}
                            type="button"
                            onClick={() => navigateToMap(
                              connection.destinationMapConstant,
                              null,
                            )}
                          >
                            <span>{arrow}</span>
                            <strong>
                              {connection.destinationMapDisplayName
                                ?? connection.destinationMapConstant}
                            </strong>
                            <small>{connection.direction}</small>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              <div className="world-map-canvas-wrap">
                <MapCanvas
                  visualization={visualization}
                  view={view}
                  zoom={zoom}
                  showGrid={showGrid}
                  showWarps={showWarps}
                  showSigns={showSigns}
                  showNpcs={showNpcs}
                  selectedWarpId={selectedWarpId}
                  selectedSignId={selectedSignId}
                  selectedNpcId={selectedNpcId}
                  arrivalWarpId={arrivalWarpId}
                  onSelectWarp={(warpId) => {
                    setSelectedWarpId(warpId);
                    setSelectedSignId(null);
                    setSelectedNpcId(null);
                  }}
                  onSelectSign={(signId) => {
                    setSelectedSignId(signId);
                    setSelectedWarpId(null);
                    setSelectedNpcId(null);
                  }}
                  onSelectNpc={(npcId) => {
                    setSelectedNpcId(npcId);
                    setSelectedWarpId(null);
                    setSelectedSignId(null);
                  }}
                />
              </div>

              {view === "map" && visualization.warps.length > 0 && (
                <div className="world-map-warp-panel">
                  <div className="world-map-warp-list" aria-label="Map warps">
                    {visualization.warps.map((warp) => (
                      <button
                        key={warp.id}
                        type="button"
                        className={warp.id === selectedWarpId ? "active" : ""}
                        onClick={() => {
                          setSelectedWarpId(warp.id);
                          setSelectedSignId(null);
                          setSelectedNpcId(null);
                        }}
                      >
                        <strong>#{warp.id}</strong>
                        <span>({warp.x}, {warp.y})</span>
                      </button>
                    ))}
                  </div>

                  {selectedWarp ? (
                    <div className="world-map-warp-inspector">
                      <div>
                        <span>Selected warp</span>
                        <strong>Warp #{selectedWarp.id}</strong>
                        <code>x {selectedWarp.x}, y {selectedWarp.y}</code>
                      </div>
                      <div>
                        <span>Destination</span>
                        <strong>
                          {selectedWarp.isLastMap
                            ? resolvedWarpDestinationMap?.displayName
                              ?? "Last outdoor map"
                            : selectedWarp.destinationMapDisplayName
                              ?? selectedWarp.destinationMapConstant
                              ?? "Unknown"}
                        </strong>
                        <code>
                          {selectedWarp.isLastMap
                            ? "LAST_MAP"
                            : selectedWarp.destinationMapConstant}
                          {" · warp #"}{selectedWarp.destinationWarpId}
                        </code>
                      </div>
                      <div className="world-map-warp-action">
                        <button
                          type="button"
                          className="primary-button"
                          disabled={!resolvedWarpDestination}
                          onClick={navigateSelectedWarp}
                        >
                          {resolvedWarpDestinationMap
                            ? `Go to ${resolvedWarpDestinationMap.displayName}`
                            : selectedWarp.isLastMap
                              ? "Enter from an outdoor map to resolve LAST_MAP"
                              : "Destination unavailable"}
                        </button>
                        {selectedWarp.isLastMap && (
                          <small>
                            Gen I stores LAST_MAP as the last outdoor map visited.
                            Yellow Editor resolves it when you navigate here from the world map.
                          </small>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="world-map-warp-empty">
                      Select a numbered marker to inspect its destination.
                    </p>
                  )}
                </div>
              )}

              {view === "map" && visualization.signs.length > 0 && (
                <div className="world-map-sign-panel">
                  <div className="world-map-sign-list" aria-label="Map signs">
                    {visualization.signs.map((sign) => (
                      <button
                        key={sign.id}
                        type="button"
                        className={sign.id === selectedSignId ? "active" : ""}
                        onClick={() => {
                          setSelectedSignId(sign.id);
                          setSelectedWarpId(null);
                          setSelectedNpcId(null);
                        }}
                      >
                        <strong>Sign #{sign.id}</strong>
                        <span>({sign.x}, {sign.y})</span>
                      </button>
                    ))}
                  </div>

                  {selectedSign ? (
                    <div className="world-map-sign-inspector">
                      <div className="world-map-sign-details">
                        <span>Selected sign</span>
                        <strong>Sign #{selectedSign.id}</strong>
                        <code>x {selectedSign.x}, y {selectedSign.y}</code>
                        <code>{selectedSign.textConstant}</code>
                      </div>
                      <MapInteractionEditor
                        key={`sign:${selectedSign.scriptPath}:${selectedSign.id}:${selectedSign.textLabel ?? selectedSign.textConstant}`}
                        title={`Sign #${selectedSign.id} text`}
                        target={selectedSign.textLabel
                          ? { path: selectedSign.scriptPath, label: selectedSign.textLabel }
                          : null}
                        dialogueTarget={selectedSign.textLabel
                          ? { path: selectedSign.scriptPath, label: selectedSign.textLabel }
                          : null}
                        onOpenScript={onOpenScript}
                        onInspectHere={(path, label) => setMapLogic({ path, label })}
                        onDirtyChange={onDirtyChange}
                      />
                    </div>
                  ) : (
                    <p className="world-map-warp-empty">
                      Select an S marker to edit that sign's text and interaction.
                    </p>
                  )}
                </div>
              )}

              {view === "map" && (
                <div className="world-map-npc-panel">
                  <div className="world-map-npc-heading">
                    <div>
                      <strong>NPCs, trainers &amp; items</strong>
                      <small>
                        Select a character to edit their placement, appearance, dialogue and interaction, or add a new NPC.
                      </small>
                    </div>
                    <div className="world-map-npc-actions"><button type="button" onClick={() => setTrainerEditor({ id: null })}>Place trainer</button><button type="button" onClick={() => setItemEditorOpen(true)}>Place item</button><button type="button" className="primary-button" onClick={() => setNpcWizardOpen(true)}>Add NPC</button></div>
                  </div>
                  {itemEditorOpen && <MapItemEditor key={visualization.map.constant} visualization={visualization} onClose={() => setItemEditorOpen(false)} onDirtyChange={onDirtyChange}
                    onSaved={(id, history) => { newNpcSelection.current = { map: visualization.map.constant, id }; setItemEditorOpen(false); window.dispatchEvent(new CustomEvent("yellow-editor:history-changed", { detail: history })); }} />}
                  {trainerEditor && <MapTrainerEditor key={`${visualization.map.constant}:${trainerEditor.id}`} visualization={visualization} objectId={trainerEditor.id} onClose={() => setTrainerEditor(null)} onDirtyChange={onDirtyChange}
                    onSaved={(id, history) => { newNpcSelection.current = { map: visualization.map.constant, id }; setTrainerEditor(null); window.dispatchEvent(new CustomEvent("yellow-editor:history-changed", { detail: history })); }} />}
                  {npcWizardOpen && <MapNpcWizard key={`${project?.storageKey}:${visualization.map.constant}`} mapConstant={visualization.map.constant}
                    renderPlacement={(x, y, onPlace) => <div className="npc-placement-map"><MapCanvas visualization={visualization} view="map" zoom={1}
                      showGrid={true} showWarps={true} showSigns={true} showNpcs={true} selectedWarpId={null} selectedSignId={null} selectedNpcId={null} arrivalWarpId={null}
                      onSelectWarp={() => {}} onSelectSign={() => {}} onSelectNpc={() => {}} placement={{ x, y, onPlace }} /></div>}
                    onClose={() => setNpcWizardOpen(false)}
                    onSaved={(id, history) => {
                      newNpcSelection.current = { map: visualization.map.constant, id };
                      setNpcWizardOpen(false);
                      window.dispatchEvent(new CustomEvent("yellow-editor:history-changed", { detail: history }));
                    }} />}
                  {editingNpcId !== null && <MapNpcEditor key={`${project?.storageKey}:${visualization.map.constant}:${editingNpcId}`} mapConstant={visualization.map.constant} objectId={editingNpcId}
                    renderPlacement={(x, y, onPlace) => <div className="npc-placement-map"><MapCanvas visualization={visualization} view="map" zoom={1}
                      showGrid={true} showWarps={true} showSigns={true} showNpcs={true} selectedWarpId={null} selectedSignId={null} selectedNpcId={editingNpcId} arrivalWarpId={null}
                      onSelectWarp={() => {}} onSelectSign={() => {}} onSelectNpc={() => {}} placement={{ x, y, onPlace }} /></div>}
                    onClose={() => setEditingNpcId(null)} onDirtyChange={onDirtyChange}
                    onSaved={(id, history) => {
                      newNpcSelection.current = { map: visualization.map.constant, id };
                      setEditingNpcId(null);
                      window.dispatchEvent(new CustomEvent("yellow-editor:history-changed", { detail: history }));
                    }} />}
                  {nativeObjectId !== null && <NativeMapObjectEditor key={`${project?.storageKey}:${visualization.map.constant}:${nativeObjectId}`} visualization={visualization} objectId={nativeObjectId} onClose={() => setNativeObjectId(null)} onDirtyChange={onDirtyChange}
                    onSaved={(id, history) => { newNpcSelection.current = { map: visualization.map.constant, id }; setNativeObjectId(null); window.dispatchEvent(new CustomEvent("yellow-editor:history-changed", { detail: history })); }} />}
                  <div className="world-map-npc-list" aria-label="Map NPCs">
                    {visualization.npcs.map((npc) => (
                      <button
                        key={npc.id}
                        type="button"
                        className={npc.id === selectedNpcId ? "active" : ""}
                        onClick={() => {
                          setSelectedNpcId(npc.id);
                          setSelectedWarpId(null);
                          setSelectedSignId(null);
                        }}
                      >
                        <strong>
                          {npc.objectConstant
                            ? constantLabel(npc.objectConstant)
                            : `NPC #${npc.id}`}
                        </strong>
                        <span>{npc.trainerPartyId ? "Trainer · " : npc.objectKind === "item" ? "Item · " : npc.objectKind === "special" ? "Special encounter · " : ""}({Number.isFinite(npc.x) ? npc.x : "?"}, {Number.isFinite(npc.y) ? npc.y : "?"}) · {npc.itemConstant ? constantLabel(npc.itemConstant) : constantLabel(npc.spriteConstant, "SPRITE_")}{npc.initiallyHidden ? " · initially hidden" : ""}</span>
                      </button>
                    ))}
                  </div>

                  {selectedNpc ? (
                    <div className="world-map-npc-inspector">
                      <div className="world-map-npc-details">
                        <span>{selectedNpc.trainerPartyId ? "Selected trainer" : selectedNpc.objectKind === "item" ? "Selected item" : selectedNpc.objectKind === "special" ? "Selected special encounter" : "Selected NPC"}</span>
                        <strong>
                          {selectedNpc.objectConstant
                            ? constantLabel(selectedNpc.objectConstant)
                            : `NPC #${selectedNpc.id}`}
                        </strong>
                        <code>x {Number.isFinite(selectedNpc.x) ? selectedNpc.x : "?"}, y {Number.isFinite(selectedNpc.y) ? selectedNpc.y : "?"}</code>
                        {selectedNpc.sourceIssue && <p role="status">{selectedNpc.sourceIssue}</p>}
                        {selectedNpc.itemConstant && <p>Item: <code>{selectedNpc.itemConstant}</code></p>}
                        {selectedNpc.initiallyHidden !== undefined && <p>{selectedNpc.initiallyHidden ? "Initially hidden; shown here so you can inspect its story placement." : "Initially visible; the game controls its saved visibility state."}</p>}
                        <dl>
                          <div>
                            <dt>Sprite</dt>
                            <dd>
                              {constantLabel(selectedNpc.spriteConstant, "SPRITE_")}
                              <code>{selectedNpc.spriteConstant}</code>
                            </dd>
                          </div>
                          <div>
                            <dt>Movement</dt>
                            <dd>
                              {npcMovementSummary(
                                selectedNpc.movementConstant,
                                selectedNpc.directionOrRangeConstant,
                              )}
                              <code>
                                {selectedNpc.movementConstant}
                                {" · "}{selectedNpc.directionOrRangeConstant}
                              </code>
                            </dd>
                          </div>
                          <div>
                            <dt>Text ID</dt>
                            <dd><code>{selectedNpc.textConstant}</code></dd>
                          </div>
                        </dl>
                      </div>

                      <div className="world-map-npc-actions">{selectedNpc.nativeObject
                        ? <button type="button" className="small-button" onClick={() => setNativeObjectId(selectedNpc.id)}>{selectedNpc.trainerPartyId ? "Edit trainer" : selectedNpc.objectKind === "item" ? "Edit item" : "Inspect object"}</button>
                        : selectedNpc.trainerPartyId ? <button type="button" className="small-button" onClick={() => setTrainerEditor({ id: selectedNpc.id })}>Edit trainer</button>
                        : <button type="button" className="small-button" onClick={() => setEditingNpcId(selectedNpc.id)}>Edit NPC</button>}
                        {selectedNpc.trainerPartyId && onOpenTrainerParty && <button type="button" className="small-button" onClick={() => onOpenTrainerParty(selectedNpc.trainerPartyId!)}>Edit trainer party</button>}
                        {selectedNpc.nativeObject && selectedNpc.textLabel && <button type="button" className="small-button" onClick={() => setMapLogic({ path: selectedNpc.scriptPath, label: selectedNpc.textLabel })}>Inspect map logic</button>}
                        {selectedNpc.sourcePath && <button type="button" className="small-button" onClick={() => onOpenScript(selectedNpc.sourcePath!)}>View object source</button>}
                      </div>
                      {!selectedNpc.trainerPartyId && !(selectedNpc.objectKind === "item" && selectedNpc.nativeObject) && <div className="world-map-npc-dialogue">
                        <MapInteractionEditor
                          key={`npc:${selectedNpc.scriptPath}:${selectedNpc.id}:${selectedNpc.textLabel ?? selectedNpc.textConstant}`}
                          title="NPC dialogue"
                          target={selectedNpc.textLabel
                            ? { path: selectedNpc.scriptPath, label: selectedNpc.textLabel }
                            : null}
                          dialogueTarget={selectedNpc.dialogueLabel
                            ? {
                                path: selectedNpc.dialoguePath,
                                label: selectedNpc.dialogueLabel,
                              }
                            : null}
                          onOpenScript={onOpenScript}
                        onInspectHere={(path, label) => setMapLogic({ path, label })}
                          onDirtyChange={onDirtyChange}
                        />
                        <small className="help-text">
                          Scripted NPCs can choose different dialogue based on game state
                          or Yes/No choices. Yellow Editor exposes safely resolved text leaves
                          as separate dialogue paths while preserving the surrounding script logic.
                        </small>
                      </div>}
                    </div>
                  ) : (
                    <p className="world-map-warp-empty">
                      Select an N, T or I marker or object card to inspect and edit it. Special encounters use ? markers.
                    </p>
                  )}
                </div>
              )}

              <p className="help-text">
                {view === "tiles"
                  ? "Tile IDs run left-to-right, top-to-bottom. Each tile is decoded directly from the selected .2bpp source."
                  : view === "blocks"
                    ? "Block IDs run left-to-right, top-to-bottom. Every block is assembled from 16 tile IDs in the .bst blockset."
                    : "Map markers use the game's 16×16 movement coordinates. Numbers mark warps, S signs, N NPCs, T trainers, I pickups and ? special encounters. Dashed markers are initially hidden objects."}
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
                    <dt>Map objects</dt>
                    <dd><code>{visualization.objectPath}</code></dd>
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
