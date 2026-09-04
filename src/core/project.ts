import {
  parseMoves,
  parsePokemonDetails,
  parsePokemonIndex,
  parsePokemonTmhmMoves,
} from "./parsers";
import { parsePokemonPalette } from "./palettes";
import type { ProjectSession, ProjectSource } from "./types";

const REQUIRED_FILES = ["main.asm", "Makefile"];
const REQUIRED_DIRS = ["data", "engine", "maps"];

export async function createProjectSession(
  source: ProjectSource,
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

  return {
    info: {
      path: source.displayPath,
      valid: true,
      projectName,
    },
    getPokemonIndex: () => parsePokemonIndex(source),
    getPokemonDetails: (internalId, sourceSlug) =>
      parsePokemonDetails(source, internalId, sourceSlug),
    getPokemonTmhmMoves: (sourceSlug) =>
      parsePokemonTmhmMoves(source, sourceSlug),
    getPokemonPalette: async (sourceSlug) => {
      const stats = await parseBaseStatsForPalette(source, sourceSlug);
      return parsePokemonPalette(source, stats.dexConstant);
    },
    getMoves: () => parseMoves(source),
    dispose: () => source.dispose?.(),
  };
}

async function parseBaseStatsForPalette(source: ProjectSource, sourceSlug: string) {
  const { parseBaseStats } = await import("./parsers");
  return parseBaseStats(source, sourceSlug);
}
