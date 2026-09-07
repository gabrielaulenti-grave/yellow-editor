import { useState } from "react";
import type {
  HistorySummary,
  MoveData,
  PokemonBaseStatsEditDocument,
  PokemonDetails,
  PokemonIndexEntry,
  ProjectInfo,
} from "./core/types";
import { BuildTestTab } from "./BuildTestTab";
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
import { invoke, open } from "./platform/compat";
import "./App.css";

type Tab = "pokemon" | "moves" | "build";

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

  function clearPokemonEditor() {
    setSelectedPokemon(null);
    setSelectedPokemonId(null);
    setTmhmMoves([]);
    setBaseStatsDocument(null);
    setBaseStatsDraft(EMPTY_BASE_STATS_DRAFT);
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
      baseStatsDirty &&
      !window.confirm("Discard the unsaved base stat changes and open another project?")
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

      const [index, moveData, history] = await Promise.all([
        invoke<PokemonIndexEntry[]>("get_pokemon_index", { projectPath: result.path }),
        invoke<MoveData[]>("get_moves", { projectPath: result.path }),
        invoke<HistorySummary>("get_history_summary"),
      ]);

      setProject(result);
      setPokemonIndex(index);
      setMoves(moveData);
      clearPokemonEditor();
      setSelectedMoveId(moveData[0]?.id ?? null);
      setMoveSearch("");
      setHistorySummary(history);
      setStatus("Project loaded successfully.");
    } catch (error) {
      setProject(null);
      setPokemonIndex([]);
      setMoves([]);
      clearPokemonEditor();
      setSelectedMoveId(null);
      setHistorySummary(null);
      setStatus(String(error));
    }
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

  async function undoLastSave() {
    if (!historySummary?.canUndo || baseStatsDirty || editBusy) {
      return;
    }

    setEditBusy(true);
    try {
      const history = await invoke<HistorySummary>("undo_last_save");
      setHistorySummary(history);
      if (selectedPokemonEntry?.sourceSlug) {
        await loadPokemon(selectedPokemonEntry, "Undid the last saved change.");
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
    if (!historySummary?.canRedo || baseStatsDirty || editBusy) {
      return;
    }

    setEditBusy(true);
    try {
      const history = await invoke<HistorySummary>("redo_last_undo");
      setHistorySummary(history);
      if (selectedPokemonEntry?.sourceSlug) {
        await loadPokemon(selectedPokemonEntry, "Redid the last saved change.");
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

  const editorController: EditorController = {
    dirty: baseStatsDirty,
    valid: baseStatsValid,
    busy: editBusy,
    save: saveBaseStats,
    revert: revertUnsavedChanges,
  };

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
          onClick={() => setActiveTab("pokemon")}
        >
          Pokémon
        </button>
        <button
          className={activeTab === "moves" ? "active" : ""}
          onClick={() => setActiveTab("moves")}
        >
          Moves
        </button>
        <button
          className={activeTab === "build" ? "active" : ""}
          onClick={() => setActiveTab("build")}
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

      <BuildTestTab
        project={project}
        hasUnsavedChanges={editorController.dirty}
        hidden={activeTab !== "build"}
      />
    </main>
  );
}

export default App;
