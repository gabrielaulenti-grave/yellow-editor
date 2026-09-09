import {
  parseBaseStats,
  parseMoves,
  parsePokemonDetails,
  parsePokemonIndex,
  parsePokemonTmhmMoves,
} from "./parsers";
import { createProjectHistoryManager } from "./history";
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
  TrainerCatalog,
} from "./types";

const REQUIRED_FILES = ["main.asm", "Makefile"];
const REQUIRED_DIRS = ["data", "engine", "maps"];

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
  let trainerBaseCatalogPromise: Promise<TrainerCatalog> | null = null;

  function getTrainerBaseCatalog(): Promise<TrainerCatalog> {
    if (!trainerBaseCatalogPromise) {
      trainerBaseCatalogPromise = parseTrainerBaseCatalog(source, projectName).catch((error) => {
        trainerBaseCatalogPromise = null;
        throw error;
      });
    }
    return trainerBaseCatalogPromise;
  }

  function invalidateTrainerBaseCatalog(): void {
    trainerBaseCatalogPromise = null;
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
      // A full trainer scan is intentionally isolated behind a short-lived
      // read-through cache. On mobile, the wrapper also limits concurrent
      // filesystem reads so the browser is not flooded by twelve file reads
      // at once. The same cached source is reused by script-summary enrichment,
      // avoiding a second trip to the filesystem for dialogue files.
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
      const changes = await prepareTrainerPartyWrites(
        source,
        projectName,
        partyId,
        sourceLine,
        sources,
        values,
      );
      const result = await history.save(`Edit trainer party ${partyId}`, changes);
      invalidateTrainerBaseCatalog();
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
    saveTextChanges: (label, changes) => history.save(label, changes),
    undoLastSave: async () => {
      const result = await history.undo();
      invalidateTrainerBaseCatalog();
      return result;
    },
    redoLastUndo: async () => {
      const result = await history.redo();
      invalidateTrainerBaseCatalog();
      return result;
    },
    getBuildEnvironment: () => buildService.inspect(),
    getSaveCompatibility: (target) => getSaveCompatibilityDescriptor(source, target),
    buildRom: (target, onProgress) => buildService.build(target, onProgress),
    dispose: () => source.dispose?.(),
  };

  return session;
}
