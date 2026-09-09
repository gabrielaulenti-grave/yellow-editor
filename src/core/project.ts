import {
  parseBaseStats,
  parseMoves,
  parsePokemonDetails,
  parsePokemonIndex,
  parsePokemonTmhmMoves,
} from "./parsers";
import { createProjectHistoryManager, hashText } from "./history";
import { parsePokemonPalette } from "./palettes";
import {
  loadPokemonBaseStatsEditDocument,
  preparePokemonBaseStatsWrite,
  validatePokemonBaseStats,
} from "./pokemonEditing";
import { getSaveCompatibilityDescriptor } from "./saveCompatibility";
import {
  loadEncounterTableEditDocument,
  parseEncounterIndex,
  prepareEncounterTableWrite,
  validateEncounterVersions,
} from "./encounterEditing";
import {
  loadFishingEditDocument,
  prepareFishingWrites,
  validateFishingData,
} from "./fishingEditing";
import { parseTrainerBaseCatalog } from "./trainerBaseIndex";
import { parseTrainerCatalog } from "./trainerIndex";
import { createTrainerScanSource } from "./trainerScanSource";
import { enrichTrainerScriptSummaries } from "./trainerScriptSummary";
import {
  prepareTrainerPartyWrites,
  validateTrainerPartyValues,
} from "./trainerEditing";
import type {
  BuildService,
  ProjectSession,
  ProjectSource,
  TextWriteRequest,
  TrainerCatalog,
  TrainerPartyEditValues,
} from "./types";

const REQUIRED_FILES = ["main.asm", "Makefile"];
const REQUIRED_DIRS = ["data", "engine", "maps"];
const PARTIES_PATH = "data/trainers/parties.asm";
const SPECIAL_MOVES_PATH = "data/trainers/special_moves.asm";

interface TrainerCatalogCache {
  load(): Promise<TrainerCatalog | null>;
  save(catalog: TrainerCatalog): Promise<void>;
  clear(): Promise<void>;
}

interface CacheCapableProjectSource extends ProjectSource {
  trainerCatalogCache?: TrainerCatalogCache;
}

type PreparedTextWriteRequest = TextWriteRequest & {
  beforeContents?: string;
};

export interface ProgressiveTrainerSession {
  getTrainerBaseCatalog(): Promise<TrainerCatalog>;
}

function clarifyTrainerMovementPaths(catalog: TrainerCatalog): void {
  for (const trainer of catalog.trainers) {
    for (const reference of trainer.scriptReferences) {
      reference.routineSource = reference.routineSource
        .split("\n")
        .map((line) => {
          const match = line.match(/^(\s*Path:\s*)(.*)$/);
          if (!match) {
            return line;
          }

          // Keep movement notation deliberately simple. Direction arrows are
          // converted to plain words first; any right arrows that remain are
          // only the semantic summary's sequence separators.
          const path = match[2]
            .replace(/↑ Up/g, "Up")
            .replace(/↓ Down/g, "Down")
            .replace(/← Left/g, "Left")
            .replace(/→ Right/g, "Right")
            .replace(/ → /g, ", ");
          return `${match[1]}${path}`;
        })
        .join("\n");
    }
  }
}

function trainerCacheAffected(paths: string[]): boolean {
  return paths.some((path) =>
    path === "maps.asm" ||
    path === "text.asm" ||
    path.startsWith("scripts/") ||
    path.startsWith("data/maps/objects/") ||
    path.startsWith("text/"),
  );
}

function trainerBaseAffected(paths: string[]): boolean {
  return paths.some((path) => path === PARTIES_PATH || path === SPECIAL_MOVES_PATH);
}

export async function createProjectSession(
  source: ProjectSource,
  buildService: BuildService,
): Promise<ProjectSession> {
  for (const file of REQUIRED_FILES) {
    if (!(await source.exists(file))) {
      throw new Error(
        `This does not appear to be a Pokémon disassembly project: missing ${file}`,
      );
    }
  }

  for (const directory of REQUIRED_DIRS) {
    if (!(await source.exists(directory))) {
      throw new Error(
        `This does not appear to be a Pokémon disassembly project: missing ${directory} directory`,
      );
    }
  }

  const projectName = (await source.exists("data/pokemon/mew.asm"))
    ? "pokered"
    : "pokeyellow";
  const history = createProjectHistoryManager(source);
  const trainerBaseSource = createTrainerScanSource(source);
  const trainerCatalogCache = (source as CacheCapableProjectSource).trainerCatalogCache;
  let trainerBaseCatalogPromise: Promise<TrainerCatalog> | null = null;

  function getTrainerBaseCatalog(): Promise<TrainerCatalog> {
    if (!trainerBaseCatalogPromise) {
      trainerBaseCatalogPromise = parseTrainerBaseCatalog(trainerBaseSource, projectName).catch((error) => {
        trainerBaseCatalogPromise = null;
        throw error;
      });
    }
    return trainerBaseCatalogPromise;
  }

  function invalidateTrainerBaseCatalog(paths?: string[]): void {
    trainerBaseSource.invalidate(paths);
    trainerBaseCatalogPromise = null;
  }

  async function updateTrainerBaseAfterSave(
    partyId: string,
    values: TrainerPartyEditValues,
    changes: TextWriteRequest[],
  ): Promise<void> {
    const changedPaths = changes.map((change) => change.path);
    trainerBaseSource.invalidate(changedPaths);
    if (!trainerBaseCatalogPromise) {
      return;
    }

    let catalog: TrainerCatalog;
    try {
      catalog = await trainerBaseCatalogPromise;
    } catch {
      trainerBaseCatalogPromise = null;
      return;
    }

    const trainer = catalog.trainers.find((entry) => entry.id === partyId);
    if (!trainer) {
      trainerBaseCatalogPromise = null;
      return;
    }

    const specialMoves = values.specialMoves.map((move) => ({ ...move }));
    trainer.partyFormat = values.partyFormat;
    trainer.specialMoves = specialMoves;
    trainer.pokemon = values.pokemon.map((pokemon, index) => ({
      ...pokemon,
      specialMoves: specialMoves
        .filter((move) => move.pokemonIndex === index + 1)
        .map((move) => ({ ...move })),
    }));
    const finalLevel = trainer.pokemon[trainer.pokemon.length - 1]?.level ?? 0;
    trainer.calculatedPrize = trainer.baseRewardPerLevel === null
      ? null
      : trainer.baseRewardPerLevel * finalLevel;

    const changedHashes = new Map<string, string>();
    for (const change of changes) {
      changedHashes.set(change.path, await hashText(change.contents));
    }
    catalog.editSources = catalog.editSources.map((document) => {
      const sourceHash = changedHashes.get(document.path);
      return sourceHash ? { ...document, sourceHash } : document;
    });

    const trainerClass = catalog.classes.find((entry) => entry.constant === trainer.classConstant);
    if (trainerClass) {
      const classMoves = new Map<string, (typeof specialMoves)[number]>();
      for (const party of catalog.trainers.filter((entry) => entry.classConstant === trainer.classConstant)) {
        for (const move of party.specialMoves) {
          if (move.scope === "class") {
            classMoves.set(`${move.pokemonIndex}:${move.moveSlot}:${move.moveConstant}`, move);
          }
        }
      }
      trainerClass.classSpecialMoves = [...classMoves.values()];
    }
  }

  const session: ProjectSession & ProgressiveTrainerSession = {
    info: {
      path: source.displayPath,
      valid: true,
      projectName,
      storageKey: source.storageKey,
    },
    getPokemonIndex: () => parsePokemonIndex(source),
    getPokemonDetails: (internalId, sourceSlug) =>
      parsePokemonDetails(source, internalId, sourceSlug),
    getPokemonTmhmMoves: (sourceSlug) =>
      parsePokemonTmhmMoves(source, sourceSlug),
    getPokemonPalette: async (sourceSlug) => {
      const stats = await parseBaseStats(source, sourceSlug);
      return parsePokemonPalette(source, stats.dexConstant);
    },
    getPokemonBaseStatsEditDocument: (sourceSlug) =>
      loadPokemonBaseStatsEditDocument(source, sourceSlug),
    savePokemonBaseStats: async (sourceSlug, expectedHash, values) => {
      validatePokemonBaseStats(values);
      const change = await preparePokemonBaseStatsWrite(source, sourceSlug, values);
      return history.save(`Edit ${sourceSlug} base stats`, [
        {
          path: change.path,
          contents: change.contents,
          expectedHash,
        },
      ]);
    },
    getMoves: () => parseMoves(source),
    getTrainerBaseCatalog,
    getTrainers: async (onProgress) => {
      const cachedCatalog = await trainerCatalogCache?.load();
      if (cachedCatalog) {
        onProgress?.({
          stage: "complete",
          message: "Loaded cached trainer locations and scripted battles",
          completed: cachedCatalog.trainers.length,
          total: cachedCatalog.trainers.length,
          percent: 100,
        });
        return cachedCatalog;
      }

      // A full trainer scan is intentionally isolated behind a read-through
      // cache. On mobile, the wrapper limits concurrent filesystem reads while
      // still overlapping enough small reads to keep modern phones busy. The
      // same cached source is reused by script-summary enrichment, avoiding a
      // second trip to the filesystem for dialogue files.
      const scanSource = createTrainerScanSource(source);
      const catalog = await parseTrainerCatalog(scanSource, projectName, onProgress);
      try {
        await enrichTrainerScriptSummaries(scanSource, catalog);
        clarifyTrainerMovementPaths(catalog);
      } catch (error) {
        catalog.warnings.push(
          `Beginner-friendly script summaries could not be fully generated: ${String(error)}`,
        );
      }
      try {
        await trainerCatalogCache?.save(catalog);
      } catch (error) {
        catalog.warnings.push(`Trainer location cache could not be saved: ${String(error)}`);
      }
      return catalog;
    },
    saveTrainerParty: async (
      partyId,
      sourceLine,
      sources,
      values,
      knownSpecies,
      knownMoves,
    ) => {
      validateTrainerPartyValues(
        partyId,
        projectName,
        values,
        new Set(knownSpecies),
        new Set(knownMoves),
      );

      // Capture the exact source snapshots used to prepare the edit so the
      // history layer does not have to reread the same files before writing.
      const preparedReads = new Map<string, string>();
      const preparationSource: ProjectSource = {
        ...source,
        readText: async (path) => {
          const contents = await source.readText(path);
          preparedReads.set(path, contents);
          return contents;
        },
      };
      const changes = await prepareTrainerPartyWrites(
        preparationSource,
        projectName,
        partyId,
        sourceLine,
        sources,
        values,
      );
      for (const change of changes) {
        const beforeContents = preparedReads.get(change.path);
        if (beforeContents !== undefined) {
          (change as PreparedTextWriteRequest).beforeContents = beforeContents;
        }
      }

      const result = await history.save(`Edit trainer party ${partyId}`, changes);
      await updateTrainerBaseAfterSave(partyId, values, changes);
      return result;
    },
    getEncounterIndex: () => parseEncounterIndex(source, projectName),
    getEncounterTable: (path) =>
      loadEncounterTableEditDocument(source, projectName, path),
    saveEncounterTable: async (path, expectedHash, versions, knownSpecies) => {
      const species = new Set(knownSpecies);
      validateEncounterVersions(versions, species);
      const change = await prepareEncounterTableWrite(
        source,
        projectName,
        path,
        versions,
        species,
      );
      const label = path.split("/").pop()?.replace(/\.asm$/, "") ?? path;
      return history.save(`Edit ${label} wild encounters`, [
        { path: change.path, contents: change.contents, expectedHash },
      ]);
    },
    getFishing: () => loadFishingEditDocument(source, projectName),
    saveFishing: async (sources, data, knownSpecies) => {
      const species = new Set(knownSpecies);
      validateFishingData(data, species);
      const changes = await prepareFishingWrites(
        source,
        projectName,
        sources,
        data,
        species,
      );
      return history.save("Edit fishing encounters", changes);
    },
    getHistorySummary: () => history.getSummary(),
    saveTextChanges: async (label, changes) => {
      const result = await history.save(label, changes);
      if (trainerCacheAffected(changes.map((change) => change.path))) {
        await trainerCatalogCache?.clear();
      }
      return result;
    },
    undoLastSave: async () => {
      const state = await history.getState();
      const entry = state.cursor > 0 ? state.entries[state.cursor - 1] : null;
      const paths = entry?.files.map((file) => file.path) ?? [];
      const result = await history.undo();
      if (trainerBaseAffected(paths)) {
        invalidateTrainerBaseCatalog(paths);
      }
      if (trainerCacheAffected(paths)) {
        await trainerCatalogCache?.clear();
      }
      return result;
    },
    redoLastUndo: async () => {
      const state = await history.getState();
      const entry = state.cursor < state.entries.length ? state.entries[state.cursor] : null;
      const paths = entry?.files.map((file) => file.path) ?? [];
      const result = await history.redo();
      if (trainerBaseAffected(paths)) {
        invalidateTrainerBaseCatalog(paths);
      }
      if (trainerCacheAffected(paths)) {
        await trainerCatalogCache?.clear();
      }
      return result;
    },
    getBuildEnvironment: () => buildService.inspect(),
    getSaveCompatibility: (target) => getSaveCompatibilityDescriptor(source, target),
    buildRom: (target, onProgress) => buildService.build(target, onProgress),
    dispose: () => source.dispose?.(),
  };

  return session;
}
