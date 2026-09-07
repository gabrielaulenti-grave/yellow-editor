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
import { parseTrainerCatalog } from "./trainerIndex";
import type { BuildService, ProjectSession, ProjectSource } from "./types";

const REQUIRED_FILES = ["main.asm", "Makefile"];
const REQUIRED_DIRS = ["data", "engine", "maps"];

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

  return {
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
    getTrainers: (onProgress) => parseTrainerCatalog(source, projectName, onProgress),
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
    undoLastSave: () => history.undo(),
    redoLastUndo: () => history.redo(),
    getBuildEnvironment: () => buildService.inspect(),
    getSaveCompatibility: (target) => getSaveCompatibilityDescriptor(source, target),
    buildRom: (target, onProgress) => buildService.build(target, onProgress),
    dispose: () => source.dispose?.(),
  };
}
