import { useEffect, useRef, useState } from "react";
import type {
  EncounterTableEditDocument,
  EncounterTableIndexEntry,
  EncounterTerrain,
  EncounterVersion,
  FishingEditDocument,
  HistorySummary,
  ItemCreateDocument,
  ItemCreateValues,
  ItemData,
  ItemEditDocument,
  ItemEditValues,
  MoveData,
  PokemonCatchProfile,
  PokemonEditDocument,
  PokemonDetails,
  PokemonIndexEntry,
  PokemonTmhmCompatibilityReference,
  ProjectInfo,
  TrainerCatalog,
  TrainerClassCreateValues,
  TrainerClassEntry,
  TrainerEditSourceDocument,
  TrainerLoadProgress,
  TrainerPartyEntry,
  TmEditDocument,
} from "./core/types";
import { BuildTestTab } from "./BuildTestTab";
import { EncountersTab, type EncounterSection } from "./EncountersTab";
import { EditorToolbar } from "./EditorToolbar";
import { ItemsTab } from "./ItemsTab";
import { MapsTab } from "./MapsTab";
import { MovesTab } from "./MovesTab";
import { PokemonTab } from "./PokemonTab";
import { TrainersTab, type TrainerSection } from "./TrainersTab";
import {
  parsePokemonDraft,
  pokemonDraftFromDocument,
  pokemonDraftIsDirty,
  pokemonDraftIsValid,
  updatePokemonPaletteConstant,
  type PokemonDraft,
} from "./editor/pokemonForm";
import type { EditorController } from "./editor/types";
import {
  parseTrainerClassDraft,
  trainerClassDraftFromEntry,
  trainerClassDraftIsDirty,
  trainerClassDraftIsValid,
  type TrainerClassDraft,
} from "./editor/trainerClassForm";
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

type Tab = "pokemon" | "moves" | "items" | "trainers" | "encounters" | "maps" | "build";

function App() {
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("pokemon");
  const [pokemonIndex, setPokemonIndex] = useState<PokemonIndexEntry[]>([]);
  const [status, setStatus] = useState("No project loaded.");
  const [selectedPokemonId, setSelectedPokemonId] = useState<number | null>(null);
  const [selectedPokemon, setSelectedPokemon] = useState<PokemonDetails | null>(null);
  const [moves, setMoves] = useState<MoveData[]>([]);
  const [selectedMoveId, setSelectedMoveId] = useState<number | null>(null);
  const [moveSearch, setMoveSearch] = useState("");
  const [items, setItems] = useState<ItemData[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [itemSearch, setItemSearch] = useState("");
  const [itemAffectedPokemon, setItemAffectedPokemon] =
    useState<PokemonTmhmCompatibilityReference[]>([]);
  const [itemCompatibilityLoading, setItemCompatibilityLoading] = useState(false);
  const [itemCompatibilityError, setItemCompatibilityError] = useState<string | null>(null);
  const [itemCompatibilitySelections, setItemCompatibilitySelections] =
    useState<Record<number, number[]>>({});
  const [tmEditDocument, setTmEditDocument] = useState<TmEditDocument | null>(null);
  const [tmMoveDraft, setTmMoveDraft] = useState<string | null>(null);
  const [itemEditDocument, setItemEditDocument] = useState<ItemEditDocument | null>(null);
  const [itemEditDraft, setItemEditDraft] = useState<ItemEditValues | null>(null);
  const [itemEditLoading, setItemEditLoading] = useState(false);
  const [itemEditError, setItemEditError] = useState<string | null>(null);
  const [itemCreateDocument, setItemCreateDocument] =
    useState<ItemCreateDocument | null>(null);
  const [itemCreateLoading, setItemCreateLoading] = useState(false);
  const [itemCreateError, setItemCreateError] = useState<string | null>(null);
  const [pokemonCatchProfiles, setPokemonCatchProfiles] = useState<PokemonCatchProfile[]>([]);
  const [catchProfilesLoading, setCatchProfilesLoading] = useState(false);
  const [catchProfilesError, setCatchProfilesError] = useState<string | null>(null);
  const [trainers, setTrainers] = useState<TrainerPartyEntry[]>([]);
  const [trainerClasses, setTrainerClasses] = useState<TrainerClassEntry[]>([]);
  const [trainerEditSources, setTrainerEditSources] = useState<TrainerEditSourceDocument[]>([]);
  const [trainerDraft, setTrainerDraft] = useState<TrainerPartyDraft | null>(null);
  const [trainerClassDraft, setTrainerClassDraft] =
    useState<TrainerClassDraft | null>(null);
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
  const [mapFocusConstant, setMapFocusConstant] = useState<string | null>(null);
  const [fishingFocusMapConstant, setFishingFocusMapConstant] =
    useState<string | null>(null);
  const [fishingDocument, setFishingDocument] =
    useState<FishingEditDocument | null>(null);
  const [fishingDraft, setFishingDraft] = useState<FishingDraft | null>(null);
  const [fishingError, setFishingError] = useState<string | null>(null);
  const [pokemonEditDocument, setPokemonEditDocument] =
    useState<PokemonEditDocument | null>(null);
  const [pokemonDraft, setPokemonDraft] = useState<PokemonDraft | null>(null);
  const [historySummary, setHistorySummary] = useState<HistorySummary | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const projectLoadGeneration = useRef(0);

  useEffect(() => {
    function handleHistoryChanged(event: Event) {
      const history = (event as CustomEvent<HistorySummary>).detail;
      if (history) {
        setHistorySummary(history);
      }
    }

    function handleTrainerEditSourcesChanged(event: Event) {
      const detail = (event as CustomEvent<TrainerEditSourceDocument[]>).detail;
      if (Array.isArray(detail)) {
        setTrainerEditSources(detail);
      }
    }

    function handleTrainerRewardChanged(event: Event) {
      const detail = (event as CustomEvent<{
        path: string;
        sourceLine: number;
        itemConstant: string;
        quantity: number;
      }>).detail;
      if (!detail) return;

      const updateInteraction = (interaction: TrainerPartyEntry["instances"][number]["interaction"]) => ({
        ...interaction,
        rewards: interaction.rewards.map((reward) =>
          reward.sourcePath === detail.path && reward.sourceLine === detail.sourceLine
            ? { ...reward, constant: detail.itemConstant, quantity: detail.quantity }
            : reward,
        ),
      });

      setTrainers((current) => current.map((trainer) => ({
        ...trainer,
        instances: trainer.instances.map((instance) => ({
          ...instance,
          interaction: updateInteraction(instance.interaction),
        })),
        scriptReferences: trainer.scriptReferences.map((reference) => ({
          ...reference,
          interaction: updateInteraction(reference.interaction),
        })),
      })));
    }

    window.addEventListener("yellow-editor:history-changed", handleHistoryChanged);
    window.addEventListener("yellow-editor:trainer-edit-sources-changed", handleTrainerEditSourcesChanged);
    window.addEventListener("yellow-editor:trainer-reward-changed", handleTrainerRewardChanged);
    return () => {
      window.removeEventListener("yellow-editor:history-changed", handleHistoryChanged);
      window.removeEventListener("yellow-editor:trainer-edit-sources-changed", handleTrainerEditSourcesChanged);
      window.removeEventListener("yellow-editor:trainer-reward-changed", handleTrainerRewardChanged);
    };
  }, []);

  const selectedPokemonEntry =
    pokemonIndex.find((entry) => entry.internalId === selectedPokemonId) ?? null;
  const selectedItem =
    items.find((entry) => entry.id === selectedItemId) ?? null;

  useEffect(() => {
    if (
      !project
      || !selectedItem
      || selectedItem.kind === "tm"
      || selectedItem.kind === "hm"
    ) {
      setItemEditDocument(null);
      setItemEditDraft(null);
      setItemEditLoading(false);
      setItemEditError(null);
      return;
    }

    let cancelled = false;
    setItemEditDocument(null);
    setItemEditDraft(null);
    setItemEditLoading(true);
    setItemEditError(null);

    void invoke<ItemEditDocument>("get_item_edit_document", {
      itemId: selectedItem.id,
    }).then((document) => {
      if (cancelled) return;
      setItemEditDocument(document);
      setItemEditDraft({
        name: document.name,
        price: document.price,
        keyItem: document.keyItem,
        routineParameters: document.routineParameters,
        itemEvolution: document.itemEvolution,
      });
    }).catch((error) => {
      if (cancelled) return;
      setItemEditError(String(error));
    }).finally(() => {
      if (!cancelled) setItemEditLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [
    project,
    selectedItem?.id,
    selectedItem?.kind,
    historySummary?.appliedCount,
  ]);

  useEffect(() => {
    if (!project || itemEditDraft?.routineParameters.kind !== "ball") {
      setCatchProfilesLoading(false);
      setCatchProfilesError(null);
      return;
    }

    let cancelled = false;
    setCatchProfilesLoading(true);
    setCatchProfilesError(null);

    void invoke<PokemonCatchProfile[]>("get_pokemon_catch_profiles")
      .then((profiles) => {
        if (cancelled) return;
        setPokemonCatchProfiles(profiles);
      })
      .catch((error) => {
        if (cancelled) return;
        setCatchProfilesError(String(error));
      })
      .finally(() => {
        if (!cancelled) setCatchProfilesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    project,
    itemEditDraft?.routineParameters.kind,
    historySummary?.appliedCount,
  ]);

  useEffect(() => {
    if (
      !project
      || !selectedItem?.moveConstant
      || (selectedItem.kind !== "tm" && selectedItem.kind !== "hm")
    ) {
      setItemAffectedPokemon([]);
      setItemCompatibilityLoading(false);
      setItemCompatibilityError(null);
      setTmEditDocument(null);
      setTmMoveDraft(null);
      return;
    }

    let cancelled = false;
    setItemAffectedPokemon([]);
    setItemCompatibilityLoading(true);
    setItemCompatibilityError(null);
    setTmEditDocument(null);
    setTmMoveDraft(null);

    const request = selectedItem.kind === "tm"
      ? invoke<TmEditDocument>("get_tm_edit_document", { itemId: selectedItem.id })
          .then((document) => ({
            affected: document.affectedPokemon,
            document,
          }))
      : invoke<PokemonTmhmCompatibilityReference[]>("get_tmhm_compatibility", {
          moveConstant: selectedItem.moveConstant,
        }).then((affected) => ({ affected, document: null }));

    void request.then(({ affected, document }) => {
      if (cancelled) return;
      setItemAffectedPokemon(affected);
      setTmEditDocument(document);
      setTmMoveDraft(document?.moveConstant ?? null);
      setItemCompatibilitySelections((current) => {
        const affectedIds = affected.map((pokemon) => pokemon.internalId);
        if (!(selectedItem.id in current)) {
          return { ...current, [selectedItem.id]: affectedIds };
        }
        const affectedSet = new Set(affectedIds);
        return {
          ...current,
          [selectedItem.id]: current[selectedItem.id].filter((id) => affectedSet.has(id)),
        };
      });
    }).catch((error) => {
      if (cancelled) return;
      setItemCompatibilityError(String(error));
      setItemAffectedPokemon([]);
      setTmEditDocument(null);
      setTmMoveDraft(null);
    }).finally(() => {
      if (!cancelled) setItemCompatibilityLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [
    project,
    selectedItem?.id,
    selectedItem?.kind,
    selectedItem?.moveConstant,
    historySummary?.appliedCount,
  ]);

  const selectedTrainer =
    trainers.find((trainer) => trainer.id === selectedTrainerId) ?? null;
  const selectedTrainerClassEntry =
    trainerClasses.find((entry) => entry.constant === selectedTrainerClass) ?? null;

  const pokemonDirty = pokemonDraftIsDirty(pokemonDraft, pokemonEditDocument);
  const pokemonValid = pokemonDraftIsValid(pokemonDraft, pokemonEditDocument);
  const tmDirty = Boolean(
    selectedItem?.kind === "tm"
    && tmEditDocument
    && tmMoveDraft
    && tmMoveDraft !== tmEditDocument.moveConstant,
  );
  const tmValid = Boolean(
    !tmDirty
    || (
      tmEditDocument
      && tmMoveDraft
      && tmEditDocument.replacementMoveConstants.includes(tmMoveDraft)
    ),
  );
  const itemDirty = Boolean(
    itemEditDocument
    && itemEditDraft
    && (
      itemEditDraft.name !== itemEditDocument.name
      || itemEditDraft.price !== itemEditDocument.price
      || itemEditDraft.keyItem !== itemEditDocument.keyItem
      || JSON.stringify(itemEditDraft.routineParameters)
        !== JSON.stringify(itemEditDocument.routineParameters)
      || JSON.stringify(itemEditDraft.itemEvolution)
        !== JSON.stringify(itemEditDocument.itemEvolution)
    )
  );
  const itemRoutineValid = (() => {
    if (!itemEditDraft) return false;
    const routine = itemEditDraft.routineParameters;
    if (routine.kind === "fixed-heal") {
      return Number.isInteger(routine.healAmount)
        && routine.healAmount >= 0
        && routine.healAmount <= 255;
    }
    if (routine.kind === "ball") {
      const byteValues = [
        routine.greatRandomCeiling,
        routine.ultraSafariRandomCeiling,
        routine.minorStatusCatchBonus,
        routine.majorStatusCatchBonus,
        routine.minorStatusShakeBonus,
        routine.majorStatusShakeBonus,
        routine.shakeOneThreshold,
        routine.shakeTwoThreshold,
        routine.shakeThreeThreshold,
      ];
      const positiveByteValues = [
        routine.greatHpDivisor,
        routine.otherHpDivisor,
        routine.currentHpDivisor,
        routine.pokeShakeDivisor,
        routine.greatShakeDivisor,
        routine.ultraSafariShakeDivisor,
      ];
      return routine.masterBallGuaranteed
        && byteValues.every((value) =>
          Number.isInteger(value) && value >= 0 && value <= 255
        )
        && positiveByteValues.every((value) =>
          Number.isInteger(value) && value >= 1 && value <= 255
        )
        && routine.shakeOneThreshold < routine.shakeTwoThreshold
        && routine.shakeTwoThreshold < routine.shakeThreeThreshold;
    }
    if (routine.kind === "repel") {
      return Number.isInteger(routine.steps)
        && routine.steps >= 1
        && routine.steps <= 255;
    }
    if (routine.kind === "vitamin") {
      return Number.isInteger(routine.statExpAdded)
        && routine.statExpAdded >= 256
        && routine.statExpAdded <= 65280
        && routine.statExpAdded % 256 === 0
        && Number.isInteger(routine.useThreshold)
        && routine.useThreshold >= 256
        && routine.useThreshold <= 65280
        && routine.useThreshold % 256 === 0;
    }
    if (routine.kind === "revive") {
      return routine.restoreMode === "quarter"
        || routine.restoreMode === "half"
        || routine.restoreMode === "full";
    }
    if (routine.kind === "pp-restore") {
      return routine.fullRestore
        ? routine.restoreAmount === null
        : routine.restoreAmount !== null
          && Number.isInteger(routine.restoreAmount)
          && routine.restoreAmount >= 1
          && routine.restoreAmount <= 63;
    }
    if (routine.kind === "pp-up") {
      return Number.isInteger(routine.bonusDivisor)
        && routine.bonusDivisor >= 1
        && routine.bonusDivisor <= 255
        && Number.isInteger(routine.perUseCap)
        && routine.perUseCap >= 1
        && routine.perUseCap <= 7
        && routine.maxUses === 3;
    }
    if (routine.kind === "bicycle") {
      return routine.speedMultiplier === 1
        || routine.speedMultiplier === 2
        || routine.speedMultiplier === 4;
    }
    if (routine.kind === "status-cure") {
      return ["poison", "burn", "freeze", "sleep", "paralysis", "all"]
        .includes(routine.effect);
    }
    if (routine.kind === "x-stat") {
      return (routine.stageBoost === 1 || routine.stageBoost === 2)
        && ["Attack", "Defense", "Speed", "Special"].includes(routine.stat);
    }
    if (routine.kind === "battle-flag") {
      return ["x-accuracy", "mist", "focus-energy"].includes(routine.effect);
    }
    if (routine.kind === "evolution-stone") {
      const allowed = new Set(routine.stoneConstants);
      return routine.stoneConstants.length > 0
        && routine.references.every((reference) =>
          allowed.has(reference.itemConstant)
          && Number.isInteger(reference.internalId)
          && reference.internalId > 0
          && Number.isInteger(reference.minimumLevel)
          && reference.minimumLevel >= 1
          && reference.minimumLevel <= 255
          && Number.isInteger(reference.evolutionIndex)
          && reference.evolutionIndex >= 0
        );
    }
    return true;
  })();
  const itemEvolutionValid = (() => {
    if (!itemEditDraft || !itemEditDocument) return false;
    const draftEvolution = itemEditDraft.itemEvolution;
    const documentEvolution = itemEditDocument.itemEvolution;
    if ((draftEvolution === null) !== (documentEvolution === null)) return false;
    if (!draftEvolution || !documentEvolution) return true;
    if (
      draftEvolution.triggerMode !== documentEvolution.triggerMode
      || draftEvolution.eligibleItemConstants.join("|")
        !== documentEvolution.eligibleItemConstants.join("|")
    ) {
      return false;
    }
    const allowed = new Set(draftEvolution.eligibleItemConstants);
    return draftEvolution.references.length === documentEvolution.references.length
      && draftEvolution.references.every((reference, index) => {
        const original = documentEvolution.references[index];
        return Boolean(
          original
          && reference.internalId === original.internalId
          && reference.evolutionIndex === original.evolutionIndex
          && reference.sourceConstant === original.sourceConstant
          && reference.targetConstant === original.targetConstant
          && reference.minimumLevel === original.minimumLevel
          && allowed.has(reference.itemConstant)
        );
      });
  })();

  const itemValid = Boolean(
    itemEditDocument
    && itemEditDraft
    && itemEditDraft.name.trim().length >= 1
    && itemEditDraft.name.trim().length <= itemEditDocument.maxNameLength
    && !/["@\r\n]/.test(itemEditDraft.name)
    && Number.isInteger(itemEditDraft.price)
    && itemEditDraft.price >= 0
    && itemEditDraft.price <= 999999
    && itemRoutineValid
    && itemEvolutionValid
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
  const knownTrainerPicLabels = new Set(
    trainerClasses.flatMap((entry) => entry.picLabel ? [entry.picLabel] : []),
  );
  const knownTrainerAiRoutines = new Set(
    trainerClasses.flatMap((entry) => entry.aiRoutine ? [entry.aiRoutine] : []),
  );
  const trainerClassDirty = trainerClassDraftIsDirty(
    trainerClassDraft,
    selectedTrainerClassEntry,
  );
  const trainerClassValid = trainerClassDraftIsValid(
    trainerClassDraft,
    knownTrainerPicLabels,
    knownTrainerAiRoutines,
  );
  const hasUnsavedChanges =
    pokemonDirty
    || tmDirty
    || itemDirty
    || encounterDirty
    || fishingDirty
    || trainerDirty
    || trainerClassDirty;

  function clearPokemonEditor() {
    setSelectedPokemon(null);
    setSelectedPokemonId(null);
    setPokemonEditDocument(null);
    setPokemonDraft(null);
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
    setTrainerClassDraft(null);
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
    setTrainerClassDraft(trainerClass ? trainerClassDraftFromEntry(trainerClass) : null);
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
    setTrainerClassDraft((current) =>
      current ?? (catalog.classes[0] ? trainerClassDraftFromEntry(catalog.classes[0]) : null),
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
    setTrainerClassDraft(trainerClass ? trainerClassDraftFromEntry(trainerClass) : null);
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
      setPokemonEditDocument(null);
      setPokemonDraft(null);
      return;
    }

    try {
      const [details, editDocument] = await Promise.all([
        invoke<PokemonDetails>("get_pokemon_details", {
          projectPath: project.path,
          internalId: entry.internalId,
          sourceSlug: entry.sourceSlug,
        }),
        invoke<PokemonEditDocument>("get_pokemon_edit_document", {
          internalId: entry.internalId,
          sourceSlug: entry.sourceSlug,
        }),
      ]);

      setSelectedPokemon(details);
      setPokemonEditDocument(editDocument);
      setPokemonDraft(pokemonDraftFromDocument(editDocument));
      setStatus(successMessage);
    } catch (error) {
      setSelectedPokemon(null);
      setPokemonEditDocument(null);
      setPokemonDraft(null);
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

      const [index, moveData, itemData, encounterData, fishingResult, history, trainerBaseResult] = await Promise.all([
        invoke<PokemonIndexEntry[]>("get_pokemon_index", { projectPath: result.path }),
        invoke<MoveData[]>("get_moves", { projectPath: result.path }),
        invoke<ItemData[]>("get_items", { projectPath: result.path }),
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
      setItems(itemData);
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
      setSelectedItemId(itemData[0]?.id ?? null);
      setItemSearch("");
      setItemCompatibilitySelections({});
      setItemCreateDocument(null);
      setItemCreateLoading(false);
      setItemCreateError(null);
      setPokemonCatchProfiles([]);
      setCatchProfilesLoading(false);
      setCatchProfilesError(null);
      setTrainerSearch("");
      setTrainerClassSearch("");
      setTrainerSection("parties");
      setEncounterSearch("");
      setEncounterSection("walking");
      setMapFocusConstant(null);
      setFishingFocusMapConstant(null);
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
      setItems([]);
      clearTrainerEditor();
      setEncounters([]);
      clearPokemonEditor();
      clearEncounterEditor();
      setMapFocusConstant(null);
      setFishingFocusMapConstant(null);
      setSelectedMoveId(null);
      setSelectedItemId(null);
      setItemCompatibilitySelections({});
      setItemCreateDocument(null);
      setItemCreateLoading(false);
      setItemCreateError(null);
      setPokemonCatchProfiles([]);
      setCatchProfilesLoading(false);
      setCatchProfilesError(null);
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
      pokemonDirty &&
      entry.internalId !== selectedPokemonId &&
      !window.confirm("Discard the unsaved Pokémon changes and switch Pokémon?")
    ) {
      return;
    }

    await loadPokemon(entry);
  }

  function selectItem(itemId: number) {
    if (itemId === selectedItemId) return;
    if (
      (tmDirty || itemDirty)
      && !window.confirm("Discard the unsaved item changes and switch items?")
    ) {
      return;
    }
    if (tmEditDocument) {
      setTmMoveDraft(tmEditDocument.moveConstant);
    }
    setSelectedItemId(itemId);
  }

  async function openItemWizard() {
    if (!project || editBusy || itemCreateLoading) return;
    if (tmDirty || itemDirty) {
      setStatus("Save or revert the current item changes before adding a new item.");
      return;
    }

    setItemCreateLoading(true);
    setItemCreateError(null);
    try {
      const document = await invoke<ItemCreateDocument>("get_item_create_document");
      setItemCreateDocument(document);
      setStatus(
        document.slots.length > 0
          ? `Add Item wizard ready with ${document.slots.length} unused slot${document.slots.length === 1 ? "" : "s"}.`
          : "No unused vanilla item slots remain in this project.",
      );
    } catch (error) {
      const message = String(error);
      setItemCreateError(message);
      setStatus(message);
    } finally {
      setItemCreateLoading(false);
    }
  }

  function closeItemWizard() {
    if (editBusy) return;
    setItemCreateDocument(null);
    setItemCreateError(null);
  }

  async function createItem(values: ItemCreateValues) {
    if (!itemCreateDocument || editBusy) return;

    setEditBusy(true);
    setItemCreateError(null);
    try {
      const history = await invoke<HistorySummary>("create_item", {
        document: itemCreateDocument,
        values,
      });
      setHistorySummary(history);

      const refreshedItems = await invoke<ItemData[]>("get_items");
      setItems(refreshedItems);
      setItemCompatibilitySelections({});
      setSelectedItemId(values.slotId);
      setItemSearch("");
      setItemCreateDocument(null);

      const created = refreshedItems.find((item) => item.id === values.slotId);
      const label = created?.name ?? values.name.trim();
      if (selectedPokemonEntry?.sourceSlug) {
        await loadPokemon(
          selectedPokemonEntry,
          `${label} added successfully. Pokémon evolution options refreshed.`,
        );
      } else {
        setStatus(`${label} added successfully.`);
      }
    } catch (error) {
      const message = String(error);
      setItemCreateError(message);
      setStatus(message);
    } finally {
      setEditBusy(false);
    }
  }

  async function openPokemonFromItem(internalId: number) {
    const entry = pokemonIndex.find((pokemon) => pokemon.internalId === internalId);
    if (!entry?.sourceSlug) {
      setStatus("That Pokémon could not be opened from the item cross-reference.");
      return;
    }
    if (
      tmDirty
      && !window.confirm(
        "Discard the unsaved TM move assignment before opening this Pokémon? Your retain checkboxes will be preserved.",
      )
    ) {
      return;
    }
    if (
      itemDirty
      && !window.confirm(
        "Discard the unsaved item changes before opening this Pokémon?",
      )
    ) {
      return;
    }
    if (tmEditDocument) {
      setTmMoveDraft(tmEditDocument.moveConstant);
    }
    if (itemDirty && itemEditDocument) {
      setItemEditDraft({
        name: itemEditDocument.name,
        price: itemEditDocument.price,
        keyItem: itemEditDocument.keyItem,
        routineParameters: itemEditDocument.routineParameters,
        itemEvolution: itemEditDocument.itemEvolution,
      });
    }
    setActiveTab("pokemon");
    await loadPokemon(entry, `${entry.displayName} loaded from the item cross-reference.`);
  }

  function setItemCompatibilityRetained(internalId: number, retained: boolean) {
    if (selectedItemId === null) return;
    setItemCompatibilitySelections((current) => {
      const existing = new Set(
        current[selectedItemId] ?? itemAffectedPokemon.map((pokemon) => pokemon.internalId),
      );
      if (retained) existing.add(internalId);
      else existing.delete(internalId);
      return { ...current, [selectedItemId]: [...existing] };
    });
  }

  function selectAllItemCompatibility() {
    if (selectedItemId === null) return;
    setItemCompatibilitySelections((current) => ({
      ...current,
      [selectedItemId]: itemAffectedPokemon.map((pokemon) => pokemon.internalId),
    }));
  }

  function deselectAllItemCompatibility() {
    if (selectedItemId === null) return;
    setItemCompatibilitySelections((current) => ({
      ...current,
      [selectedItemId]: [],
    }));
  }

  function changePokemonPaletteConstant(value: string) {
    setPokemonDraft((current) =>
      current && pokemonEditDocument
        ? updatePokemonPaletteConstant(current, pokemonEditDocument, value)
        : current,
    );
  }

  async function saveItem() {
    if (
      !selectedItem
      || selectedItem.kind === "tm"
      || selectedItem.kind === "hm"
      || !itemEditDocument
      || !itemEditDraft
      || !itemDirty
      || !itemValid
    ) {
      return;
    }

    setEditBusy(true);
    try {
      const history = await invoke<HistorySummary>("save_item_edit", {
        document: itemEditDocument,
        values: itemEditDraft,
      });
      setHistorySummary(history);
      const refreshedItems = await invoke<ItemData[]>("get_items");
      setItems(refreshedItems);
      if (
        JSON.stringify(itemEditDraft.itemEvolution)
          !== JSON.stringify(itemEditDocument.itemEvolution)
        && selectedPokemonEntry?.sourceSlug
      ) {
        await loadPokemon(
          selectedPokemonEntry,
          `${itemEditDraft.name} saved successfully.`,
        );
      } else {
        setStatus(`${itemEditDraft.name} saved successfully.`);
      }
    } catch (error) {
      setStatus(String(error));
    } finally {
      setEditBusy(false);
    }
  }

  async function revertItemChanges() {
    if (!itemEditDocument || !itemEditDraft || !itemDirty || editBusy) return;
    setItemEditDraft({
      name: itemEditDocument.name,
      price: itemEditDocument.price,
      keyItem: itemEditDocument.keyItem,
      routineParameters: itemEditDocument.routineParameters,
      itemEvolution: itemEditDocument.itemEvolution,
    });
    setStatus(`Unsaved ${itemEditDocument.name} changes reverted.`);
  }

  async function saveTm() {
    if (
      !selectedItem
      || selectedItem.kind !== "tm"
      || !tmEditDocument
      || !tmMoveDraft
      || !tmDirty
      || !tmValid
    ) {
      return;
    }

    const retainedPokemonIds =
      itemCompatibilitySelections[selectedItem.id]
      ?? itemAffectedPokemon.map((pokemon) => pokemon.internalId);

    setEditBusy(true);
    try {
      const history = await invoke<HistorySummary>("save_tm_edit", {
        document: tmEditDocument,
        values: {
          moveConstant: tmMoveDraft,
          retainedPokemonIds,
        },
      });
      setHistorySummary(history);

      const refreshedItems = await invoke<ItemData[]>("get_items");
      setItems(refreshedItems);

      const previouslySelectedPokemon = selectedPokemonEntry;
      if (previouslySelectedPokemon?.sourceSlug) {
        await loadPokemon(previouslySelectedPokemon, "TM assignment saved successfully.");
      } else {
        setStatus(
          `TM${String(tmEditDocument.tmNumber).padStart(2, "0")} now teaches ${tmMoveDraft}.`,
        );
      }
    } catch (error) {
      setStatus(String(error));
    } finally {
      setEditBusy(false);
    }
  }

  async function revertTmChanges() {
    if (!tmEditDocument || !tmDirty || editBusy) return;
    setTmMoveDraft(tmEditDocument.moveConstant);
    setItemCompatibilitySelections((current) => ({
      ...current,
      [tmEditDocument.itemId]: tmEditDocument.affectedPokemon.map(
        (pokemon) => pokemon.internalId,
      ),
    }));
    setStatus(`Unsaved TM${String(tmEditDocument.tmNumber).padStart(2, "0")} changes reverted.`);
  }

  async function savePokemon() {
    if (
      !selectedPokemonEntry?.sourceSlug ||
      !pokemonEditDocument ||
      !pokemonDraft ||
      !pokemonDirty ||
      !pokemonValid
    ) {
      return;
    }

    const values = parsePokemonDraft(pokemonDraft, pokemonEditDocument);
    if (!values) {
      setStatus("Fix the invalid Pokémon fields before saving.");
      return;
    }

    setEditBusy(true);
    try {
      const history = await invoke<HistorySummary>("save_pokemon", {
        internalId: selectedPokemonEntry.internalId,
        sourceSlug: selectedPokemonEntry.sourceSlug,
        sources: pokemonEditDocument.sources,
        values,
      });
      setHistorySummary(history);
      const refreshedIndex = await invoke<PokemonIndexEntry[]>("get_pokemon_index");
      setPokemonIndex(refreshedIndex);
      const refreshedEntry = refreshedIndex.find(
        (entry) => entry.internalId === selectedPokemonEntry.internalId,
      ) ?? selectedPokemonEntry;
      await loadPokemon(refreshedEntry, "Pokémon saved successfully.");
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

  async function createTrainerClass(values: TrainerClassCreateValues): Promise<void> {
    if (!project) {
      throw new Error("Open a project before adding a trainer class.");
    }
    setEditBusy(true);
    try {
      const history = await invoke<HistorySummary>("create_trainer_class", {
        sources: trainerEditSources,
        values,
        knownSpecies: [...knownTrainerSpecies],
      });
      setHistorySummary(history);
      const catalog = await invoke<TrainerCatalog>("get_trainer_base_catalog");
      refreshTrainerBaseCatalog(catalog, `${values.constant}:1`, values.constant);
      setTrainerSection("classes");
      setStatus(`Trainer class ${values.name} added successfully.`);
    } catch (error) {
      setStatus(String(error));
      throw error;
    } finally {
      setEditBusy(false);
    }
  }

  async function saveTrainerClass() {
    if (
      !project
      || !selectedTrainerClassEntry
      || !trainerClassDraft
      || !trainerClassDirty
      || !trainerClassValid
    ) {
      return;
    }
    const values = parseTrainerClassDraft(trainerClassDraft);
    if (!values) {
      setStatus("Fix the invalid trainer class values before saving.");
      return;
    }

    setEditBusy(true);
    try {
      const history = await invoke<HistorySummary>("save_trainer_class", {
        classConstant: selectedTrainerClassEntry.constant,
        sources: trainerEditSources,
        values,
      });
      setHistorySummary(history);
      const catalog = await invoke<TrainerCatalog>("get_trainer_base_catalog");
      refreshTrainerBaseCatalog(
        catalog,
        selectedTrainerId,
        selectedTrainerClassEntry.constant,
      );
      setStatus(`Trainer class ${values.name} saved successfully.`);
    } catch (error) {
      setStatus(String(error));
    } finally {
      setEditBusy(false);
    }
  }

  function selectTrainerClass(constant: string) {
    if (constant === selectedTrainerClass) {
      return;
    }
    if (
      trainerClassDirty
      && !window.confirm("Discard the unsaved trainer class changes and switch classes?")
    ) {
      return;
    }
    const trainerClass = trainerClasses.find((entry) => entry.constant === constant) ?? null;
    setSelectedTrainerClass(trainerClass?.constant ?? null);
    setTrainerClassDraft(trainerClass ? trainerClassDraftFromEntry(trainerClass) : null);
  }

  function changeTrainerClassField(
    field: "name" | "picLabel" | "baseRewardPerLevel" | "aiRoutine" | "aiUsesPerPokemon",
    value: string,
  ) {
    setTrainerClassDraft((current) => current ? { ...current, [field]: value } : current);
  }

  function toggleTrainerClassMoveChoice(modifier: number) {
    setTrainerClassDraft((current) => {
      if (!current) return current;
      const hasModifier = current.moveChoiceModifiers.includes(modifier);
      return {
        ...current,
        moveChoiceModifiers: hasModifier
          ? current.moveChoiceModifiers.filter((value) => value !== modifier)
          : [...current.moveChoiceModifiers, modifier].sort((a, b) => a - b),
      };
    });
  }

  function revertTrainerClassChanges() {
    if (!trainerClassDirty || !selectedTrainerClassEntry || editBusy) {
      return;
    }
    setTrainerClassDraft(trainerClassDraftFromEntry(selectedTrainerClassEntry));
    setStatus("Unsaved trainer class changes reverted.");
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
      window.dispatchEvent(new CustomEvent("yellow-editor:history-changed", { detail: history }));
      const refreshTrainerBase = Boolean(
        historySummary.latestLabel?.startsWith("Edit trainer party ")
        || historySummary.latestLabel?.startsWith("Add trainer class ")
        || historySummary.latestLabel?.startsWith("Edit trainer class ")
        || historySummary.latestLabel?.startsWith("Edit trainer portrait "),
      );
      const refreshTrainerRewards = historySummary.latestLabel?.startsWith("Edit trainer reward ") ?? false;
      const [refreshedEncounters, refreshedTrainerBase, refreshedTrainerCatalog, refreshedItems] = await Promise.all([
        invoke<EncounterTableIndexEntry[]>("get_encounter_index"),
        refreshTrainerBase ? invoke<TrainerCatalog>("get_trainer_base_catalog") : Promise.resolve(null),
        refreshTrainerRewards ? invoke<TrainerCatalog>("get_trainers") : Promise.resolve(null),
        invoke<ItemData[]>("get_items"),
      ]);
      setEncounters(refreshedEncounters);
      setItems(refreshedItems);
      if (refreshedTrainerCatalog) {
        installTrainerCatalog(refreshedTrainerCatalog, selectedTrainerId, selectedTrainerClass);
      } else if (refreshedTrainerBase) {
        refreshTrainerBaseCatalog(refreshedTrainerBase, selectedTrainerId, selectedTrainerClass);
      }
      await loadFishing("Undid the last saved change.");
      const refreshedPokemonIndex = await invoke<PokemonIndexEntry[]>("get_pokemon_index");
      setPokemonIndex(refreshedPokemonIndex);
      const refreshedPokemonEntry = refreshedPokemonIndex.find(
        (entry) => entry.internalId === selectedPokemonId,
      ) ?? selectedPokemonEntry;
      if (refreshedPokemonEntry?.sourceSlug) {
        await loadPokemon(refreshedPokemonEntry, "Undid the last saved change.");
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
      window.dispatchEvent(new CustomEvent("yellow-editor:history-changed", { detail: history }));
      const refreshTrainerBase = Boolean(
        history.latestLabel?.startsWith("Edit trainer party ")
        || history.latestLabel?.startsWith("Add trainer class ")
        || history.latestLabel?.startsWith("Edit trainer class ")
        || history.latestLabel?.startsWith("Edit trainer portrait "),
      );
      const refreshTrainerRewards = history.latestLabel?.startsWith("Edit trainer reward ") ?? false;
      const [refreshedEncounters, refreshedTrainerBase, refreshedTrainerCatalog, refreshedItems] = await Promise.all([
        invoke<EncounterTableIndexEntry[]>("get_encounter_index"),
        refreshTrainerBase ? invoke<TrainerCatalog>("get_trainer_base_catalog") : Promise.resolve(null),
        refreshTrainerRewards ? invoke<TrainerCatalog>("get_trainers") : Promise.resolve(null),
        invoke<ItemData[]>("get_items"),
      ]);
      setEncounters(refreshedEncounters);
      setItems(refreshedItems);
      if (refreshedTrainerCatalog) {
        installTrainerCatalog(refreshedTrainerCatalog, selectedTrainerId, selectedTrainerClass);
      } else if (refreshedTrainerBase) {
        refreshTrainerBaseCatalog(refreshedTrainerBase, selectedTrainerId, selectedTrainerClass);
      }
      await loadFishing("Redid the last saved change.");
      const refreshedPokemonIndex = await invoke<PokemonIndexEntry[]>("get_pokemon_index");
      setPokemonIndex(refreshedPokemonIndex);
      const refreshedPokemonEntry = refreshedPokemonIndex.find(
        (entry) => entry.internalId === selectedPokemonId,
      ) ?? selectedPokemonEntry;
      if (refreshedPokemonEntry?.sourceSlug) {
        await loadPokemon(refreshedPokemonEntry, "Redid the last saved change.");
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
    if (!pokemonDirty || !selectedPokemonEntry?.sourceSlug || editBusy) {
      return;
    }

    setEditBusy(true);
    try {
      await loadPokemon(selectedPokemonEntry, "Unsaved Pokémon changes reverted.");
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
    const currentDirty = trainerSection === "parties" ? trainerDirty : trainerClassDirty;
    if (
      currentDirty
      && !window.confirm("Discard the unsaved trainer changes and switch sections?")
    ) {
      return;
    }
    if (trainerSection === "parties" && trainerDirty && selectedTrainer) {
      setTrainerDraft(trainerDraftFromParty(selectedTrainer));
    }
    if (
      trainerSection === "classes"
      && trainerClassDirty
      && selectedTrainerClassEntry
    ) {
      setTrainerClassDraft(trainerClassDraftFromEntry(selectedTrainerClassEntry));
    }
    setTrainerSection(nextSection);
  }

  const pokemonEditorController: EditorController = {
    dirty: pokemonDirty,
    valid: pokemonValid,
    busy: editBusy,
    save: savePokemon,
    revert: revertUnsavedChanges,
  };
  const tmEditorController: EditorController = {
    dirty: tmDirty,
    valid: tmValid,
    busy: editBusy || itemCompatibilityLoading,
    save: saveTm,
    revert: revertTmChanges,
  };
  const itemEditorController: EditorController = {
    dirty: itemDirty,
    valid: itemValid,
    busy: editBusy || itemEditLoading,
    save: saveItem,
    revert: revertItemChanges,
  };
  const encounterEditorController: EditorController = {
    dirty: encounterSection === "walking" ? encounterDirty : fishingDirty,
    valid: encounterSection === "walking" ? encounterValid : fishingValid,
    busy: editBusy,
    save: encounterSection === "walking" ? saveEncounters : saveFishing,
    revert: encounterSection === "walking" ? revertEncounterChanges : revertFishingChanges,
  };
  const trainerPartyEditorController: EditorController = {
    dirty: trainerDirty,
    valid: trainerValid,
    busy: editBusy,
    save: saveTrainerParty,
    revert: async () => revertTrainerChanges(),
  };
  const trainerClassEditorController: EditorController = {
    dirty: trainerClassDirty,
    valid: trainerClassValid,
    busy: editBusy,
    save: saveTrainerClass,
    revert: async () => revertTrainerClassChanges(),
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
    : activeTab === "items" && selectedItem?.kind === "tm"
      ? tmEditorController
      : activeTab === "items" && selectedItem?.kind !== "hm"
        ? itemEditorController
        : activeTab === "encounters"
        ? encounterEditorController
        : activeTab === "trainers"
          ? trainerSection === "parties"
            ? trainerPartyEditorController
            : trainerClassEditorController
          : readOnlyEditorController;

  async function selectTab(nextTab: Tab): Promise<boolean> {
    if (nextTab === activeTab) {
      return true;
    }
    if (
      hasUnsavedChanges &&
      !window.confirm("Discard the unsaved changes and switch tabs?")
    ) {
      return false;
    }
    if (pokemonDirty) {
      await revertUnsavedChanges();
    }
    if (tmDirty) {
      await revertTmChanges();
    }
    if (itemDirty) {
      await revertItemChanges();
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
    if (trainerClassDirty) {
      revertTrainerClassChanges();
    }
    setActiveTab(nextTab);
    return true;
  }

  async function openMapFromEncounter(mapConstant: string) {
    if (!(await selectTab("maps"))) return;
    setMapFocusConstant(mapConstant);
  }

  async function openWalkingEncounterFromMap(entry: EncounterTableIndexEntry) {
    if (!(await selectTab("encounters"))) return;
    setEncounterSection("walking");
    setFishingFocusMapConstant(null);
    await selectEncounter(entry);
  }

  async function openFishingFromMap(mapConstant: string) {
    if (!(await selectTab("encounters"))) return;
    setEncounterSection("fishing");
    setFishingFocusMapConstant(mapConstant);
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
          className={activeTab === "items" ? "active" : ""}
          onClick={() => void selectTab("items")}
        >
          Items
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
          className={activeTab === "maps" ? "active" : ""}
          onClick={() => void selectTab("maps")}
        >
          Maps
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
          document={pokemonEditDocument}
          draft={pokemonDraft}
          dirty={pokemonDirty}
          editBusy={editBusy}
          onSelectPokemon={selectPokemon}
          onDraftChange={setPokemonDraft}
          onPaletteConstantChange={changePokemonPaletteConstant}
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

      {activeTab === "items" && (
        <ItemsTab
          project={project}
          items={items}
          moves={moves}
          selectedItemId={selectedItemId}
          itemSearch={itemSearch}
          affectedPokemon={itemAffectedPokemon}
          retainedPokemonIds={
            selectedItemId === null
              ? []
              : itemCompatibilitySelections[selectedItemId]
                ?? itemAffectedPokemon.map((pokemon) => pokemon.internalId)
          }
          tmEditDocument={tmEditDocument}
          tmMoveDraft={tmMoveDraft}
          itemEditDocument={itemEditDocument}
          itemEditDraft={itemEditDraft}
          itemEditLoading={itemEditLoading}
          itemEditError={itemEditError}
          itemCreateDocument={itemCreateDocument}
          itemCreateLoading={itemCreateLoading}
          itemCreateError={itemCreateError}
          pokemonCatchProfiles={pokemonCatchProfiles}
          catchProfilesLoading={catchProfilesLoading}
          catchProfilesError={catchProfilesError}
          editBusy={editBusy}
          compatibilityLoading={itemCompatibilityLoading}
          compatibilityError={itemCompatibilityError}
          onSelectItem={selectItem}
          onSearchChange={setItemSearch}
          onTmMoveChange={setTmMoveDraft}
          onItemEditDraftChange={setItemEditDraft}
          onCompatibilityRetainedChange={setItemCompatibilityRetained}
          onSelectAllCompatibility={selectAllItemCompatibility}
          onDeselectAllCompatibility={deselectAllItemCompatibility}
          onOpenPokemon={(internalId) => void openPokemonFromItem(internalId)}
          onOpenItemWizard={() => void openItemWizard()}
          onCloseItemWizard={closeItemWizard}
          onCreateItem={(values) => void createItem(values)}
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
          classDraft={trainerClassDraft}
          pokemonIndex={pokemonIndex}
          moves={moves}
          dirty={trainerDirty}
          classDirty={trainerClassDirty}
          busy={editBusy}
          onSectionChange={selectTrainerSection}
          onSelectTrainer={selectTrainerParty}
          onSelectClass={selectTrainerClass}
          onPartySearchChange={setTrainerSearch}
          onClassSearchChange={setTrainerClassSearch}
          onUpdateFormat={changeTrainerFormat}
          onUpdatePokemon={changeTrainerPokemon}
          onAddPokemon={appendTrainerPokemon}
          onRemovePokemon={deleteTrainerPokemon}
          onUpdateSpecialMove={changeTrainerSpecialMove}
          onAddSpecialMove={appendTrainerSpecialMove}
          onRemoveSpecialMove={deleteTrainerSpecialMove}
          onUpdateClassField={changeTrainerClassField}
          onToggleClassMoveChoice={toggleTrainerClassMoveChoice}
          onCreateClass={createTrainerClass}
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
          fishingFocusMapConstant={fishingFocusMapConstant}
          onOpenMap={(mapConstant) => void openMapFromEncounter(mapConstant)}
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

      {activeTab === "maps" && (
        <MapsTab
          project={project}
          encounters={encounters}
          fishingDocument={fishingDocument}
          pokemonIndex={pokemonIndex}
          focusMapConstant={mapFocusConstant}
          onOpenWalkingEncounter={(entry) => void openWalkingEncounterFromMap(entry)}
          onOpenFishing={(mapConstant) => void openFishingFromMap(mapConstant)}
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
