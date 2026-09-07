import { useState } from "react";
import type {
  EncounterTableEditDocument,
  EncounterTableIndexEntry,
  EncounterTerrain,
  EncounterVersion,
  HistorySummary,
  MoveData,
  PokemonBaseStatsEditDocument,
  PokemonDetails,
  PokemonIndexEntry,
  ProjectInfo,
} from "./core/types";
import { BuildTestTab } from "./BuildTestTab";
import { EncountersTab } from "./EncountersTab";
import { EditorToolbar } from "./EditorToolbar";
import { MovesTab } from "./MovesTab";
import { PokemonTab } from "./PokemonTab";
import {
  BASE_STAT_FIELDS,
  EMPTY_BASE_STATS_DRAFT,
  draftFromValues,
  parseBaseStatsDraft,
  type BaseStatKey,
  type BaseStatsDraft,
  validateBaseStatInput,
} from "./editor/pokemonBaseStatsForm";
import type { EditorController } from "./editor/types";
import {
  disableEncounterArea,
  enableEncounterArea,
  encounterDraftFromDocument,
  encounterDraftIsDirty,
  encounterDraftIsValid,
  parseEncounterDraft,
  updateEncounterRate,
  updateEncounterSlot,
  type EncounterDraft,
} from "./editor/encounterForm";
import { invoke, open } from "./platform/compat";
import "./App.css";

type Tab = "pokemon" | "moves" | "encounters" | "build";

function App() {
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("pokemon");
  const [pokemonIndex, setPokemonIndex] = useState<PokemonIndexEntry[]>([]);
  const [status, setStatus] = useState("No project loaded.");
  const [selectedPokemonId, setSelectedPokemonId] = useState<number | null>(null);
  const [selectedPokemon, setSelectedPokemon] = useState<PokemonDetails | null>(null);
  const [tmhmMoves, setTmhmMoves] = useState<string[]>([]);
  const [moves, setMoves] = useState<MoveData[]>([]);
  const [selectedMoveId, setSelectedMoveId] = useState<number | null>(null);
  const [moveSearch, setMoveSearch] = useState("");
  const [encounters, setEncounters] = useState<EncounterTableIndexEntry[]>([]);
  const [selectedEncounterPath, setSelectedEncounterPath] = useState<string | null>(null);
  const [encounterDocument, setEncounterDocument] =
    useState<EncounterTableEditDocument | null>(null);
  const [encounterDraft, setEncounterDraft] = useState<EncounterDraft>([]);
  const [encounterSearch, setEncounterSearch] = useState("");
  const [baseStatsDocument, setBaseStatsDocument] =
    useState<PokemonBaseStatsEditDocument | null>(null);
  const [baseStatsDraft, setBaseStatsDraft] =
    useState<BaseStatsDraft>(EMPTY_BASE_STATS_DRAFT);
  const [historySummary, setHistorySummary] = useState<HistorySummary | null>(null);
  const [editBusy, setEditBusy] = useState(false);

  const selectedPokemonEntry =
    pokemonIndex.find((entry) => entry.internalId === selectedPokemonId) ?? null;

  const baseStatErrors = Object.fromEntries(
    BASE_STAT_FIELDS.map((field) => [field.key, validateBaseStatInput(baseStatsDraft[field.key])]),
  ) as Record<BaseStatKey, string | null>;

  const baseStatsValid = BASE_STAT_FIELDS.every((field) => !baseStatErrors[field.key]);
  const baseStatsDirty = Boolean(
    baseStatsDocument &&
      BASE_STAT_FIELDS.some(
        (field) => baseStatsDraft[field.key] !== String(baseStatsDocument.values[field.key]),
      ),
  );
  const encounterDirty = encounterDraftIsDirty(encounterDraft, encounterDocument);
  const encounterValid = encounterDraftIsValid(encounterDraft);
  const hasUnsavedChanges = baseStatsDirty || encounterDirty;

  function clearPokemonEditor() {
    setSelectedPokemon(null);
    setSelectedPokemonId(null);
    setTmhmMoves([]);
    setBaseStatsDocument(null);
    setBaseStatsDraft(EMPTY_BASE_STATS_DRAFT);
  }

  function clearEncounterEditor() {
    setSelectedEncounterPath(null);
    setEncounterDocument(null);
    setEncounterDraft([]);
  }

  async function loadEncounter(
    entry: EncounterTableIndexEntry,
    successMessage = "Encounter table loaded successfully.",
  ) {
    setSelectedEncounterPath(entry.path);
    if (entry.error) {
      setEncounterDocument(null);
      setEncounterDraft([]);
      setStatus(entry.error);
      return;
    }
    try {
      const document = await invoke<EncounterTableEditDocument>("get_encounter_table", {
        path: entry.path,
      });
      setEncounterDocument(document);
      setEncounterDraft(encounterDraftFromDocument(document));
      setStatus(successMessage);
    } catch (error) {
      setEncounterDocument(null);
      setEncounterDraft([]);
      setStatus(String(error));
    }
  }

  async function loadPokemon(
    entry: PokemonIndexEntry,
    successMessage = "Pokémon loaded successfully.",
  ) {
    setSelectedPokemonId(entry.internalId);

    if (!project || !entry.sourceSlug) {
      setSelectedPokemon(null);
      setTmhmMoves([]);
      setBaseStatsDocument(null);
      setBaseStatsDraft(EMPTY_BASE_STATS_DRAFT);
      return;
    }

    try {
      const [details, compatibleMoves, editDocument] = await Promise.all([
        invoke<PokemonDetails>("get_pokemon_details", {
          projectPath: project.path,
          internalId: entry.internalId,
          sourceSlug: entry.sourceSlug,
        }),
        invoke<string[]>("get_pokemon_tmhm_moves", {
          projectPath: project.path,
          sourceSlug: entry.sourceSlug,
        }),
        invoke<PokemonBaseStatsEditDocument>("get_pokemon_base_stats_edit_document", {
          sourceSlug: entry.sourceSlug,
        }),
      ]);

      setSelectedPokemon(details);
      setTmhmMoves(compatibleMoves);
      setBaseStatsDocument(editDocument);
      setBaseStatsDraft(draftFromValues(editDocument.values));
      setStatus(successMessage);
    } catch (error) {
      setSelectedPokemon(null);
      setTmhmMoves([]);
      setBaseStatsDocument(null);
      setBaseStatsDraft(EMPTY_BASE_STATS_DRAFT);
      setStatus(String(error));
    }
  }

  async function selectProject() {
    if (
      hasUnsavedChanges &&
      !window.confirm("Discard the unsaved changes and open another project?")
    ) {
      return;
    }

    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Pokémon disassembly project",
      });

      if (!selected) {
        return;
      }

      const result = await invoke<ProjectInfo>("open_project", { path: selected });

      const [index, moveData, encounterData, history] = await Promise.all([
        invoke<PokemonIndexEntry[]>("get_pokemon_index", { projectPath: result.path }),
        invoke<MoveData[]>("get_moves", { projectPath: result.path }),
        invoke<EncounterTableIndexEntry[]>("get_encounter_index"),
        invoke<HistorySummary>("get_history_summary"),
      ]);

      setProject(result);
      setPokemonIndex(index);
      setMoves(moveData);
      setEncounters(encounterData);
      clearPokemonEditor();
      clearEncounterEditor();
      setSelectedMoveId(moveData[0]?.id ?? null);
      setMoveSearch("");
      setEncounterSearch("");
      setHistorySummary(history);
      if (encounterData[0]) {
        await loadEncounter(encounterData[0], "Project loaded successfully.");
      } else {
        setStatus("Project loaded successfully.");
      }
    } catch (error) {
      setProject(null);
      setPokemonIndex([]);
      setMoves([]);
      setEncounters([]);
      clearPokemonEditor();
      clearEncounterEditor();
      setSelectedMoveId(null);
      setHistorySummary(null);
      setStatus(String(error));
    }
  }

  async function selectEncounter(entry: EncounterTableIndexEntry) {
    if (
      encounterDirty &&
      entry.path !== selectedEncounterPath &&
      !window.confirm("Discard the unsaved encounter changes and switch locations?")
    ) {
      return;
    }
    await loadEncounter(entry);
  }

  async function selectPokemon(entry: PokemonIndexEntry) {
    if (
      baseStatsDirty &&
      entry.internalId !== selectedPokemonId &&
      !window.confirm("Discard the unsaved base stat changes and switch Pokémon?")
    ) {
      return;
    }

    await loadPokemon(entry);
  }

  function updateBaseStat(key: BaseStatKey, value: string) {
    setBaseStatsDraft((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function saveBaseStats() {
    if (
      !selectedPokemonEntry?.sourceSlug ||
      !baseStatsDocument ||
      !baseStatsDirty ||
      !baseStatsValid
    ) {
      return;
    }

    const values = parseBaseStatsDraft(baseStatsDraft);
    if (!values) {
      setStatus("Base stats must be integer values between 1 and 255.");
      return;
    }

    setEditBusy(true);
    try {
      const history = await invoke<HistorySummary>("save_pokemon_base_stats", {
        sourceSlug: selectedPokemonEntry.sourceSlug,
        expectedHash: baseStatsDocument.sourceHash,
        values,
      });
      setHistorySummary(history);
      await loadPokemon(selectedPokemonEntry, "Base stats saved successfully.");
    } catch (error) {
      setStatus(String(error));
    } finally {
      setEditBusy(false);
    }
  }

  async function saveEncounters() {
    if (!encounterDocument || !encounterDirty || !encounterValid) {
      return;
    }
    const versions = parseEncounterDraft(encounterDraft);
    if (!versions) {
      setStatus("Fix the invalid encounter rate or slot values before saving.");
      return;
    }
    const selected = encounters.find((entry) => entry.path === encounterDocument.path);
    if (!selected) {
      return;
    }

    setEditBusy(true);
    try {
      const knownSpecies = pokemonIndex
        .filter((entry) => entry.kind === "pokemon" && entry.constant)
        .map((entry) => entry.constant as string);
      const history = await invoke<HistorySummary>("save_encounter_table", {
        path: encounterDocument.path,
        expectedHash: encounterDocument.sourceHash,
        versions,
        knownSpecies,
      });
      setHistorySummary(history);
      await loadEncounter(selected, "Wild encounters saved successfully.");
      setEncounters((current) => current.map((entry) =>
        entry.path === selected.path
          ? {
              ...entry,
              hasGrass: versions.some((item) => item.grass.rate > 0),
              hasWater: versions.some((item) => item.water.rate > 0),
            }
          : entry,
      ));
    } catch (error) {
      setStatus(String(error));
    } finally {
      setEditBusy(false);
    }
  }

  async function undoLastSave() {
    if (!historySummary?.canUndo || hasUnsavedChanges || editBusy) {
      return;
    }

    setEditBusy(true);
    try {
      const history = await invoke<HistorySummary>("undo_last_save");
      setHistorySummary(history);
      const refreshedEncounters = await invoke<EncounterTableIndexEntry[]>("get_encounter_index");
      setEncounters(refreshedEncounters);
      if (selectedPokemonEntry?.sourceSlug) {
        await loadPokemon(selectedPokemonEntry, "Undid the last saved change.");
      }
      const selectedEncounter = refreshedEncounters.find(
        (entry) => entry.path === selectedEncounterPath,
      );
      if (selectedEncounter) {
        await loadEncounter(selectedEncounter, "Undid the last saved change.");
      } else {
        setStatus("Undid the last saved change.");
      }
    } catch (error) {
      setStatus(String(error));
    } finally {
      setEditBusy(false);
    }
  }

  async function redoLastUndo() {
    if (!historySummary?.canRedo || hasUnsavedChanges || editBusy) {
      return;
    }

    setEditBusy(true);
    try {
      const history = await invoke<HistorySummary>("redo_last_undo");
      setHistorySummary(history);
      const refreshedEncounters = await invoke<EncounterTableIndexEntry[]>("get_encounter_index");
      setEncounters(refreshedEncounters);
      if (selectedPokemonEntry?.sourceSlug) {
        await loadPokemon(selectedPokemonEntry, "Redid the last saved change.");
      }
      const selectedEncounter = refreshedEncounters.find(
        (entry) => entry.path === selectedEncounterPath,
      );
      if (selectedEncounter) {
        await loadEncounter(selectedEncounter, "Redid the last saved change.");
      } else {
        setStatus("Redid the last saved change.");
      }
    } catch (error) {
      setStatus(String(error));
    } finally {
      setEditBusy(false);
    }
  }

  async function revertUnsavedChanges() {
    if (!baseStatsDirty || !selectedPokemonEntry?.sourceSlug || editBusy) {
      return;
    }

    setEditBusy(true);
    try {
      await loadPokemon(selectedPokemonEntry, "Unsaved base stat changes reverted.");
    } finally {
      setEditBusy(false);
    }
  }

  async function revertEncounterChanges() {
    if (!encounterDirty || !encounterDocument || editBusy) {
      return;
    }
    const selected = encounters.find((entry) => entry.path === encounterDocument.path);
    if (!selected) {
      return;
    }
    setEditBusy(true);
    try {
      await loadEncounter(selected, "Unsaved encounter changes reverted.");
    } finally {
      setEditBusy(false);
    }
  }

  function changeEncounterRate(terrain: EncounterTerrain, value: string) {
    setEncounterDraft((current) => updateEncounterRate(current, terrain, value));
  }

  function changeEncounterSlot(
    version: EncounterVersion,
    terrain: EncounterTerrain,
    index: number,
    field: "level" | "speciesConstant",
    value: string,
  ) {
    setEncounterDraft((current) =>
      updateEncounterSlot(current, version, terrain, index, field, value),
    );
  }

  function enableEncounters(terrain: EncounterTerrain) {
    const otherTerrain = terrain === "grass" ? "water" : "grass";
    const defaultSpecies = encounterDraft[0]?.[otherTerrain].slots[0]?.speciesConstant ?? pokemonIndex.find(
      (entry) => entry.kind === "pokemon" && entry.constant,
    )?.constant;
    if (defaultSpecies) {
      setEncounterDraft((current) => enableEncounterArea(current, terrain, defaultSpecies));
    }
  }

  function disableEncounters(terrain: EncounterTerrain) {
    if (
      window.confirm(
        `Disable all ${terrain === "water" ? "surfing" : "grass"} encounters for this location?`,
      )
    ) {
      setEncounterDraft((current) => disableEncounterArea(current, terrain));
    }
  }

  const pokemonEditorController: EditorController = {
    dirty: baseStatsDirty,
    valid: baseStatsValid,
    busy: editBusy,
    save: saveBaseStats,
    revert: revertUnsavedChanges,
  };
  const encounterEditorController: EditorController = {
    dirty: encounterDirty,
    valid: encounterValid,
    busy: editBusy,
    save: saveEncounters,
    revert: revertEncounterChanges,
  };
  const readOnlyEditorController: EditorController = {
    dirty: false,
    valid: true,
    busy: editBusy,
    save: async () => undefined,
    revert: async () => undefined,
  };
  const editorController = activeTab === "pokemon"
    ? pokemonEditorController
    : activeTab === "encounters"
      ? encounterEditorController
      : readOnlyEditorController;

  async function selectTab(nextTab: Tab) {
    if (nextTab === activeTab) {
      return;
    }
    if (
      hasUnsavedChanges &&
      !window.confirm("Discard the unsaved changes and switch tabs?")
    ) {
      return;
    }
    if (baseStatsDirty) {
      await revertUnsavedChanges();
    }
    if (encounterDirty) {
      await revertEncounterChanges();
    }
    setActiveTab(nextTab);
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <h1>Yellow Editor</h1>
          <p className="status-line">{status}</p>
        </div>
        <button onClick={selectProject}>Open Project</button>
      </header>

      {project && (
        <>
          <section className="project-strip">
            <strong>{project.projectName}</strong>
            <span>{project.path}</span>
          </section>

          <EditorToolbar
            editor={editorController}
            history={historySummary}
            onUndo={undoLastSave}
            onRedo={redoLastUndo}
          />
        </>
      )}

      <nav className="tab-bar">
        <button
          className={activeTab === "pokemon" ? "active" : ""}
          onClick={() => void selectTab("pokemon")}
        >
          Pokémon
        </button>
        <button
          className={activeTab === "moves" ? "active" : ""}
          onClick={() => void selectTab("moves")}
        >
          Moves
        </button>
        <button
          className={activeTab === "encounters" ? "active" : ""}
          onClick={() => void selectTab("encounters")}
        >
          Wild Encounters
        </button>
        <button
          className={activeTab === "build" ? "active" : ""}
          onClick={() => void selectTab("build")}
        >
          Build &amp; Test
        </button>
      </nav>

      {activeTab === "pokemon" && (
        <PokemonTab
          project={project}
          pokemonIndex={pokemonIndex}
          selectedPokemonId={selectedPokemonId}
          selectedPokemonEntry={selectedPokemonEntry}
          selectedPokemon={selectedPokemon}
          tmhmMoves={tmhmMoves}
          baseStatsDraft={baseStatsDraft}
          baseStatErrors={baseStatErrors}
          baseStatsDirty={baseStatsDirty}
          editBusy={editBusy}
          onSelectPokemon={selectPokemon}
          onUpdateBaseStat={updateBaseStat}
        />
      )}

      {activeTab === "moves" && (
        <MovesTab
          project={project}
          moves={moves}
          selectedMoveId={selectedMoveId}
          moveSearch={moveSearch}
          onSelectMove={setSelectedMoveId}
          onSearchChange={setMoveSearch}
        />
      )}

      {activeTab === "encounters" && (
        <EncountersTab
          project={project}
          encounters={encounters}
          selectedPath={selectedEncounterPath}
          document={encounterDocument}
          draft={encounterDraft}
          pokemonIndex={pokemonIndex}
          search={encounterSearch}
          dirty={encounterDirty}
          busy={editBusy}
          onSearchChange={setEncounterSearch}
          onSelect={selectEncounter}
          onUpdateRate={changeEncounterRate}
          onUpdateSlot={changeEncounterSlot}
          onEnable={enableEncounters}
          onDisable={disableEncounters}
        />
      )}

      <BuildTestTab
        project={project}
        hasUnsavedChanges={hasUnsavedChanges}
        hidden={activeTab !== "build"}
      />
    </main>
  );
}

export default App;
