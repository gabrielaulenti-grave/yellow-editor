import { useRef, useState } from "react";
import type {
  EncounterTableEditDocument,
  EncounterTableIndexEntry,
  EncounterTerrain,
  EncounterVersion,
  FishingEditDocument,
  HistorySummary,
  MoveData,
  PokemonBaseStatsEditDocument,
  PokemonDetails,
  PokemonIndexEntry,
  ProjectInfo,
  TrainerCatalog,
  TrainerClassEntry,
  TrainerEditSourceDocument,
  TrainerLoadProgress,
  TrainerPartyEntry,
} from "./core/types";
import { BuildTestTab } from "./BuildTestTab";
import { EncountersTab, type EncounterSection } from "./EncountersTab";
import { EditorToolbar } from "./EditorToolbar";
import { MovesTab } from "./MovesTab";
import { PokemonTab } from "./PokemonTab";
import { TrainersTab, type TrainerSection } from "./TrainersTab";
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
  addTrainerPokemon,
  addYellowSpecialMove,
  parseTrainerDraft,
  removeTrainerPokemon,
  removeYellowSpecialMove,
  trainerDraftFromParty,
  trainerDraftIsDirty,
  trainerDraftIsValid,
  updateTrainerFormat,
  updateTrainerPokemon,
  updateTrainerSpecialMove,
  type TrainerPartyDraft,
} from "./editor/trainerPartyForm";
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
import {
  fishingDraftFromDocument,
  fishingDraftIsDirty,
  fishingDraftIsValid,
  parseFishingDraft,
  updateFishingSlot,
  type FishingDraft,
  type FishingRod,
} from "./editor/fishingForm";
import { invoke, open } from "./platform/compat";
import "./App.css";

type Tab = "pokemon" | "moves" | "trainers" | "encounters" | "build";

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
  const [trainers, setTrainers] = useState<TrainerPartyEntry[]>([]);
  const [trainerClasses, setTrainerClasses] = useState<TrainerClassEntry[]>([]);
  const [trainerEditSources, setTrainerEditSources] = useState<TrainerEditSourceDocument[]>([]);
  const [trainerDraft, setTrainerDraft] = useState<TrainerPartyDraft | null>(null);
  const [trainerWarnings, setTrainerWarnings] = useState<string[]>([]);
  const [selectedTrainerId, setSelectedTrainerId] = useState<string | null>(null);
  const [selectedTrainerClass, setSelectedTrainerClass] = useState<string | null>(null);
  const [trainerSearch, setTrainerSearch] = useState("");
  const [trainerClassSearch, setTrainerClassSearch] = useState("");
  const [trainerSection, setTrainerSection] = useState<TrainerSection>("parties");
  const [projectLoadProgress, setProjectLoadProgress] =
    useState<TrainerLoadProgress | null>(null);
  const [encounters, setEncounters] = useState<EncounterTableIndexEntry[]>([]);
  const [selectedEncounterPath, setSelectedEncounterPath] = useState<string | null>(null);
  const [encounterDocument, setEncounterDocument] =
    useState<EncounterTableEditDocument | null>(null);
  const [encounterDraft, setEncounterDraft] = useState<EncounterDraft>([]);
  const [encounterSearch, setEncounterSearch] = useState("");
  const [encounterSection, setEncounterSection] =
    useState<EncounterSection>("walking");
  const [fishingDocument, setFishingDocument] =
    useState<FishingEditDocument | null>(null);
  const [fishingDraft, setFishingDraft] = useState<FishingDraft | null>(null);
  const [fishingError, setFishingError] = useState<string | null>(null);
  const [baseStatsDocument, setBaseStatsDocument] =
    useState<PokemonBaseStatsEditDocument | null>(null);
  const [baseStatsDraft, setBaseStatsDraft] =
    useState<BaseStatsDraft>(EMPTY_BASE_STATS_DRAFT);
  const [historySummary, setHistorySummary] = useState<HistorySummary | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const projectLoadGeneration = useRef(0);

  const selectedPokemonEntry =
    pokemonIndex.find((entry) => entry.internalId === selectedPokemonId) ?? null;
  const selectedTrainer =
    trainers.find((trainer) => trainer.id === selectedTrainerId) ?? null;

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
  const fishingDirty = fishingDraftIsDirty(fishingDraft, fishingDocument);
  const fishingValid = fishingDraftIsValid(fishingDraft);
  const knownTrainerSpecies = new Set(pokemonIndex
    .filter((entry) => entry.kind === "pokemon" && entry.constant)
    .map((entry) => entry.constant as string));
  const knownTrainerMoves = new Set(moves.map((move) => move.constant));
  const trainerDirty = trainerDraftIsDirty(trainerDraft, selectedTrainer);
  const trainerValid = trainerDraftIsValid(
    trainerDraft,
    knownTrainerSpecies,
    knownTrainerMoves,
  );
  const hasUnsavedChanges = baseStatsDirty || encounterDirty || fishingDirty || trainerDirty;

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
    setFishingDocument(null);
    setFishingDraft(null);
    setFishingError(null);
  }

  function clearTrainerEditor() {
    setTrainers([]);
    setTrainerClasses([]);
    setTrainerEditSources([]);
    setTrainerWarnings([]);
    setSelectedTrainerId(null);
    setSelectedTrainerClass(null);
    setTrainerDraft(null);
  }

  function installTrainerCatalog(
    catalog: TrainerCatalog,
    preferredTrainerId?: string | null,
    preferredClassConstant?: string | null,
  ) {
    const trainer = catalog.trainers.find((entry) => entry.id === preferredTrainerId)
      ?? catalog.trainers[0]
      ?? null;
    const trainerClass = catalog.classes.find((entry) =>
      entry.constant === preferredClassConstant,
    ) ?? catalog.classes[0] ?? null;
    setTrainers(catalog.trainers);
    setTrainerClasses(catalog.classes);
    setTrainerEditSources(catalog.editSources);
    setTrainerWarnings(catalog.warnings);
    setSelectedTrainerId(trainer?.id ?? null);
    setSelectedTrainerClass(trainerClass?.constant ?? null);
    setTrainerDraft(trainer ? trainerDraftFromParty(trainer) : null);
  }

  function mergeTrainerEnrichment(catalog: TrainerCatalog) {
    setTrainers((current) => {
      if (current.length === 0) {
        return catalog.trainers;
      }
      const enrichedById = new Map(catalog.trainers.map((trainer) => [trainer.id, trainer]));
      return current.map((trainer) => {
        const enriched = enrichedById.get(trainer.id);
        return enriched
          ? {
              ...trainer,
              instances: enriched.instances,
              scriptReferences: enriched.scriptReferences,
            }
          : trainer;
      });
    });
    setTrainerClasses((current) => {
      if (current.length === 0) {
        return catalog.classes;
      }
      const enrichedByConstant = new Map(catalog.classes.map((entry) => [entry.constant, entry]));
      return current.map((entry) => {
        const enriched = enrichedByConstant.get(entry.constant);
        return enriched
          ? {
              ...entry,
              placedInstanceCount: enriched.placedInstanceCount,
              scriptReferenceCount: enriched.scriptReferenceCount,
              affectedLocations: enriched.affectedLocations,
            }
          : entry;
      });
    });
    setTrainerEditSources((current) => current.length > 0 ? current : catalog.editSources);
    setTrainerWarnings((current) => [...new Set([...current, ...catalog.warnings])]);
    setSelectedTrainerId((current) =>
      current && catalog.trainers.some((entry) => entry.id === current)
        ? current
        : catalog.trainers[0]?.id ?? null,
    );
    setSelectedTrainerClass((current) =>
      current && catalog.classes.some((entry) => entry.constant === current)
        ? current
        : catalog.classes[0]?.constant ?? null,
    );
    setTrainerDraft((current) =>
      current ?? (catalog.trainers[0] ? trainerDraftFromParty(catalog.trainers[0]) : null),
    );
  }

  function refreshTrainerBaseCatalog(
    catalog: TrainerCatalog,
    preferredTrainerId?: string | null,
    preferredClassConstant?: string | null,
  ) {
    setTrainers((current) => {
      const existingById = new Map(current.map((trainer) => [trainer.id, trainer]));
      return catalog.trainers.map((trainer) => {
        const existing = existingById.get(trainer.id);
        return existing
          ? {
              ...trainer,
              instances: existing.instances,
              scriptReferences: existing.scriptReferences,
            }
          : trainer;
      });
    });
    setTrainerClasses((current) => {
      const existingByConstant = new Map(current.map((entry) => [entry.constant, entry]));
      return catalog.classes.map((entry) => {
        const existing = existingByConstant.get(entry.constant);
        return existing
          ? {
              ...entry,
              placedInstanceCount: existing.placedInstanceCount,
              scriptReferenceCount: existing.scriptReferenceCount,
              affectedLocations: existing.affectedLocations,
            }
          : entry;
      });
    });
    setTrainerEditSources(catalog.editSources);
    setTrainerWarnings((current) => [...new Set([...catalog.warnings, ...current])]);

    const trainer = catalog.trainers.find((entry) => entry.id === preferredTrainerId)
      ?? catalog.trainers[0]
      ?? null;
    const trainerClass = catalog.classes.find((entry) =>
      entry.constant === preferredClassConstant,
    ) ?? catalog.classes[0] ?? null;
    setSelectedTrainerId(trainer?.id ?? null);
    setSelectedTrainerClass(trainerClass?.constant ?? null);
    setTrainerDraft(trainer ? trainerDraftFromParty(trainer) : null);
  }

  async function loadFishing(successMessage = "Fishing encounters loaded successfully.") {
    try {
      const document = await invoke<FishingEditDocument>("get_fishing");
      setFishingDocument(document);
      setFishingDraft(fishingDraftFromDocument(document));
      setFishingError(null);
      setStatus(successMessage);
    } catch (error) {
      setFishingDocument(null);
      setFishingDraft(null);
      setFishingError(String(error));
      setStatus(String(error));
    }
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

  async function loadTrainerCatalog(
    loadGeneration: number,
    fishingLoadError: string | null,
  ) {
    try {
      const catalog = await invoke<TrainerCatalog>("get_trainers", {
        onProgress: (progress: TrainerLoadProgress) => {
          if (projectLoadGeneration.current === loadGeneration) {
            setProjectLoadProgress(progress);
            setStatus(progress.message);
          }
        },
      });
      if (projectLoadGeneration.current !== loadGeneration) {
        return;
      }
      mergeTrainerEnrichment(catalog);
      setStatus(
        fishingLoadError
          ? `Project loaded, but fishing data is unavailable. ${fishingLoadError}`
          : "Project and trainer location index loaded successfully.",
      );
    } catch (error) {
      if (projectLoadGeneration.current !== loadGeneration) {
        return;
      }
      setTrainerWarnings((current) => [
        ...new Set([...current, `Trainer map/script indexing did not finish: ${String(error)}`]),
      ]);
      setStatus(`Trainer parties are available, but map/script indexing did not finish. ${String(error)}`);
    } finally {
      if (projectLoadGeneration.current === loadGeneration) {
        setProjectLoadProgress(null);
      }
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

    let loadGeneration = projectLoadGeneration.current;
    setProjectLoadProgress({
      stage: "tables",
      message: "Waiting for a project folder",
      completed: 0,
      total: 1,
      percent: 1,
    });
    setStatus("Waiting for a project folder.");

    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Pokémon disassembly project",
      });

      if (!selected) {
        setProjectLoadProgress(null);
        setStatus(project ? "Project selection cancelled." : "No project loaded.");
        return;
      }

      loadGeneration = projectLoadGeneration.current + 1;
      projectLoadGeneration.current = loadGeneration;

      setProjectLoadProgress({
        stage: "tables",
        message: "Reading core project data",
        completed: 0,
        total: 1,
        percent: 5,
      });
      setStatus("Reading core project data.");

      const result = await invoke<ProjectInfo>("open_project", { path: selected });

      const [index, moveData, encounterData, fishingResult, history, trainerBaseResult] = await Promise.all([
        invoke<PokemonIndexEntry[]>("get_pokemon_index", { projectPath: result.path }),
        invoke<MoveData[]>("get_moves", { projectPath: result.path }),
        invoke<EncounterTableIndexEntry[]>("get_encounter_index"),
        invoke<FishingEditDocument>("get_fishing")
          .then((document) => ({ document, error: null }))
          .catch((error) => ({ document: null, error: String(error) })),
        invoke<HistorySummary>("get_history_summary"),
        invoke<TrainerCatalog>("get_trainer_base_catalog")
          .then((catalog) => ({ catalog, error: null }))
          .catch((error) => ({ catalog: null, error: String(error) })),
      ]);

      setProject(result);
      setPokemonIndex(index);
      setMoves(moveData);
      clearTrainerEditor();
      if (trainerBaseResult.catalog) {
        installTrainerCatalog(trainerBaseResult.catalog);
      } else if (trainerBaseResult.error) {
        setTrainerWarnings([trainerBaseResult.error]);
      }
      setEncounters(encounterData);
      clearPokemonEditor();
      clearEncounterEditor();
      setFishingDocument(fishingResult.document);
      setFishingDraft(
        fishingResult.document ? fishingDraftFromDocument(fishingResult.document) : null,
      );
      setFishingError(fishingResult.error);
      setSelectedMoveId(moveData[0]?.id ?? null);
      setMoveSearch("");
      setTrainerSearch("");
      setTrainerClassSearch("");
      setTrainerSection("parties");
      setEncounterSearch("");
      setEncounterSection("walking");
      setHistorySummary(history);
      if (encounterData[0]) {
        await loadEncounter(encounterData[0], "Project loaded successfully.");
      } else {
        setStatus("Project loaded successfully.");
      }
      if (fishingResult.error) {
        setStatus(`Project loaded, but fishing data is unavailable. ${fishingResult.error}`);
      }
      if (projectLoadGeneration.current === loadGeneration) {
        setProjectLoadProgress({
          stage: "tables",
          message: trainerBaseResult.catalog
            ? "Trainer parties ready; finding map instances in the background"
            : "Core editor ready; indexing trainers in the background",
          completed: 0,
          total: 1,
          percent: 8,
        });
        setStatus(
          trainerBaseResult.catalog
            ? "Trainer parties are ready; finding locations and scripted battles in the background."
            : "Core editor ready; indexing trainers in the background.",
        );
        void loadTrainerCatalog(loadGeneration, fishingResult.error);
      }
    } catch (error) {
      if (projectLoadGeneration.current !== loadGeneration) {
        return;
      }
      setProject(null);
      setPokemonIndex([]);
      setMoves([]);
      clearTrainerEditor();
      setEncounters([]);
      clearPokemonEditor();
      clearEncounterEditor();
      setSelectedMoveId(null);
      setHistorySummary(null);
      setProjectLoadProgress(null);
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

  async function saveFishing() {
    if (!fishingDocument || !fishingDirty || !fishingValid) {
      return;
    }
    const data = parseFishingDraft(fishingDraft);
    if (!data) {
      setStatus("Fix the invalid fishing levels or Pokémon before saving.");
      return;
    }
    setEditBusy(true);
    try {
      const knownSpecies = pokemonIndex
        .filter((entry) => entry.kind === "pokemon" && entry.constant)
        .map((entry) => entry.constant as string);
      const history = await invoke<HistorySummary>("save_fishing", {
        sources: fishingDocument.sources,
        data,
        knownSpecies,
      });
      setHistorySummary(history);
      await loadFishing("Fishing encounters saved successfully.");
    } catch (error) {
      setStatus(String(error));
    } finally {
      setEditBusy(false);
    }
  }

  async function saveTrainerParty() {
    if (!project || !selectedTrainer || !trainerDraft || !trainerDirty || !trainerValid) {
      return;
    }
    const values = parseTrainerDraft(trainerDraft);
    if (!values) {
      setStatus("Fix the invalid trainer party or special move values before saving.");
      return;
    }

    setEditBusy(true);
    try {
      const history = await invoke<HistorySummary>("save_trainer_party", {
        partyId: selectedTrainer.id,
        sourceLine: selectedTrainer.sourceLine,
        sources: trainerEditSources,
        values,
        knownSpecies: [...knownTrainerSpecies],
        knownMoves: [...knownTrainerMoves],
      });
      setHistorySummary(history);
      const catalog = await invoke<TrainerCatalog>("get_trainer_base_catalog");
      refreshTrainerBaseCatalog(catalog, selectedTrainer.id, selectedTrainer.classConstant);
      setStatus(`Trainer party ${selectedTrainer.id} saved successfully.`);
    } catch (error) {
      setStatus(String(error));
    } finally {
      setEditBusy(false);
    }
  }

  function selectTrainerParty(id: string) {
    if (id === selectedTrainerId) {
      return;
    }
    if (trainerDirty && !window.confirm("Discard the unsaved trainer changes and switch parties?")) {
      return;
    }
    const trainer = trainers.find((entry) => entry.id === id) ?? null;
    setSelectedTrainerId(trainer?.id ?? null);
    setTrainerDraft(trainer ? trainerDraftFromParty(trainer) : null);
  }

  function changeTrainerFormat(partyFormat: TrainerPartyEntry["partyFormat"]) {
    setTrainerDraft((current) => current ? updateTrainerFormat(current, partyFormat) : current);
  }

  function changeTrainerPokemon(
    index: number,
    field: "level" | "speciesConstant",
    value: string,
  ) {
    setTrainerDraft((current) =>
      current ? updateTrainerPokemon(current, index, field, value) : current,
    );
  }

  function appendTrainerPokemon() {
    const defaultSpecies = [...knownTrainerSpecies][0];
    if (!defaultSpecies) {
      return;
    }
    setTrainerDraft((current) => current
      ? addTrainerPokemon(current, defaultSpecies)
      : current);
  }

  function deleteTrainerPokemon(index: number) {
    if (!trainerDraft) {
      return;
    }
    const removedNumber = index + 1;
    const lockedMove = trainerDraft.specialMoves.find((move) =>
      move.sourceKind === "red-lone" && Number(move.pokemonIndex) === removedNumber,
    );
    if (lockedMove) {
      setStatus("That Pokémon is required by a fixed Red/Blue special-move record. Change the special-move target first.");
      return;
    }
    setTrainerDraft((current) => current ? removeTrainerPokemon(current, index) : current);
  }

  function changeTrainerSpecialMove(
    index: number,
    field: "pokemonIndex" | "moveSlot" | "moveConstant",
    value: string,
  ) {
    setTrainerDraft((current) =>
      current ? updateTrainerSpecialMove(current, index, field, value) : current,
    );
  }

  function appendTrainerSpecialMove() {
    const defaultMove = moves[0]?.constant;
    if (!trainerDraft || !selectedTrainer || project?.projectName !== "pokeyellow" || !defaultMove) {
      return;
    }
    setTrainerDraft(addYellowSpecialMove(trainerDraft, selectedTrainer.id, defaultMove));
  }

  function deleteTrainerSpecialMove(index: number) {
    setTrainerDraft((current) =>
      current ? removeYellowSpecialMove(current, index) : current,
    );
  }

  function revertTrainerChanges() {
    if (!trainerDirty || !selectedTrainer || editBusy) {
      return;
    }
    setTrainerDraft(trainerDraftFromParty(selectedTrainer));
    setStatus("Unsaved trainer changes reverted.");
  }

  async function undoLastSave() {
    if (!historySummary?.canUndo || hasUnsavedChanges || editBusy) {
      return;
    }

    setEditBusy(true);
    try {
      const history = await invoke<HistorySummary>("undo_last_save");
      setHistorySummary(history);
      const refreshTrainers = historySummary.latestLabel?.startsWith("Edit trainer party ") ?? false;
      const [refreshedEncounters, refreshedTrainers] = await Promise.all([
        invoke<EncounterTableIndexEntry[]>("get_encounter_index"),
        refreshTrainers ? invoke<TrainerCatalog>("get_trainer_base_catalog") : Promise.resolve(null),
      ]);
      setEncounters(refreshedEncounters);
      if (refreshedTrainers) {
        refreshTrainerBaseCatalog(refreshedTrainers, selectedTrainerId, selectedTrainerClass);
      }
      await loadFishing("Undid the last saved change.");
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
      const refreshTrainers = history.latestLabel?.startsWith("Edit trainer party ") ?? false;
      const [refreshedEncounters, refreshedTrainers] = await Promise.all([
        invoke<EncounterTableIndexEntry[]>("get_encounter_index"),
        refreshTrainers ? invoke<TrainerCatalog>("get_trainer_base_catalog") : Promise.resolve(null),
      ]);
      setEncounters(refreshedEncounters);
      if (refreshedTrainers) {
        refreshTrainerBaseCatalog(refreshedTrainers, selectedTrainerId, selectedTrainerClass);
      }
      await loadFishing("Redid the last saved change.");
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

  async function revertFishingChanges() {
    if (!fishingDirty || !fishingDocument || editBusy) {
      return;
    }
    setEditBusy(true);
    try {
      await loadFishing("Unsaved fishing changes reverted.");
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

  function changeFishingSlot(
    rod: FishingRod,
    tableId: string | null,
    slotIndex: number,
    field: "level" | "speciesConstant",
    value: string,
  ) {
    setFishingDraft((current) =>
      current
        ? updateFishingSlot(current, rod, tableId, slotIndex, field, value)
        : current,
    );
  }

  async function selectEncounterSection(nextSection: EncounterSection) {
    if (nextSection === encounterSection) {
      return;
    }
    const currentDirty = encounterSection === "walking" ? encounterDirty : fishingDirty;
    if (
      currentDirty &&
      !window.confirm("Discard the unsaved changes and switch encounter sections?")
    ) {
      return;
    }
    if (encounterSection === "walking" && encounterDirty) {
      await revertEncounterChanges();
    }
    if (encounterSection === "fishing" && fishingDirty) {
      await revertFishingChanges();
    }
    setEncounterSection(nextSection);
  }

  function selectTrainerSection(nextSection: TrainerSection) {
    if (nextSection === trainerSection) {
      return;
    }
    if (trainerDirty && !window.confirm("Discard the unsaved trainer changes and switch sections?")) {
      return;
    }
    if (trainerDirty && selectedTrainer) {
      setTrainerDraft(trainerDraftFromParty(selectedTrainer));
    }
    setTrainerSection(nextSection);
  }

  const pokemonEditorController: EditorController = {
    dirty: baseStatsDirty,
    valid: baseStatsValid,
    busy: editBusy,
    save: saveBaseStats,
    revert: revertUnsavedChanges,
  };
  const encounterEditorController: EditorController = {
    dirty: encounterSection === "walking" ? encounterDirty : fishingDirty,
    valid: encounterSection === "walking" ? encounterValid : fishingValid,
    busy: editBusy,
    save: encounterSection === "walking" ? saveEncounters : saveFishing,
    revert: encounterSection === "walking" ? revertEncounterChanges : revertFishingChanges,
  };
  const trainerEditorController: EditorController = {
    dirty: trainerDirty,
    valid: trainerValid,
    busy: editBusy,
    save: saveTrainerParty,
    revert: async () => revertTrainerChanges(),
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
      : activeTab === "trainers" && trainerSection === "parties"
        ? trainerEditorController
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
    if (fishingDirty) {
      await revertFishingChanges();
    }
    if (trainerDirty) {
      revertTrainerChanges();
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

      {projectLoadProgress && (
        <section className="project-loading-panel" aria-live="polite">
          <div>
            <strong>{projectLoadProgress.message}</strong>
            <span>{projectLoadProgress.percent}%</span>
          </div>
          <progress max="100" value={projectLoadProgress.percent} />
          {projectLoadProgress.total > 1 && (
            <small>
              {projectLoadProgress.completed} of {projectLoadProgress.total} files in this stage
            </small>
          )}
        </section>
      )}

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
          className={activeTab === "trainers" ? "active" : ""}
          onClick={() => void selectTab("trainers")}
        >
          Trainers
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

      {activeTab === "trainers" && (
        <TrainersTab
          project={project}
          section={trainerSection}
          trainers={trainers}
          classes={trainerClasses}
          warnings={trainerWarnings}
          selectedTrainerId={selectedTrainerId}
          selectedClassConstant={selectedTrainerClass}
          partySearch={trainerSearch}
          classSearch={trainerClassSearch}
          draft={trainerDraft}
          pokemonIndex={pokemonIndex}
          moves={moves}
          dirty={trainerDirty}
          busy={editBusy}
          onSectionChange={selectTrainerSection}
          onSelectTrainer={selectTrainerParty}
          onSelectClass={setSelectedTrainerClass}
          onPartySearchChange={setTrainerSearch}
          onClassSearchChange={setTrainerClassSearch}
          onUpdateFormat={changeTrainerFormat}
          onUpdatePokemon={changeTrainerPokemon}
          onAddPokemon={appendTrainerPokemon}
          onRemovePokemon={deleteTrainerPokemon}
          onUpdateSpecialMove={changeTrainerSpecialMove}
          onAddSpecialMove={appendTrainerSpecialMove}
          onRemoveSpecialMove={deleteTrainerSpecialMove}
        />
      )}

      {activeTab === "encounters" && (
        <EncountersTab
          project={project}
          section={encounterSection}
          encounters={encounters}
          selectedPath={selectedEncounterPath}
          document={encounterDocument}
          draft={encounterDraft}
          fishingDocument={fishingDocument}
          fishingDraft={fishingDraft}
          fishingError={fishingError}
          pokemonIndex={pokemonIndex}
          search={encounterSearch}
          dirty={encounterDirty}
          fishingDirty={fishingDirty}
          busy={editBusy}
          onSectionChange={selectEncounterSection}
          onSearchChange={setEncounterSearch}
          onSelect={selectEncounter}
          onUpdateRate={changeEncounterRate}
          onUpdateSlot={changeEncounterSlot}
          onUpdateFishingSlot={changeFishingSlot}
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
