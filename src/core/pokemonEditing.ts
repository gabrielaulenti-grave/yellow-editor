import { hashText } from "./history";
import type {
  PokemonBaseStatsEditDocument,
  PokemonBaseStatValues,
  ProjectSource,
} from "./types";

const BASE_STAT_KEYS = ["hp", "attack", "defense", "speed", "special"] as const;

function baseStatsPath(sourceSlug: string): string {
  return `data/pokemon/base_stats/${sourceSlug}.asm`;
}

function validateBaseStatValue(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 255) {
    throw new Error(`${name} must be an integer between 1 and 255.`);
  }
}

export function validatePokemonBaseStats(values: PokemonBaseStatValues): void {
  for (const key of BASE_STAT_KEYS) {
    validateBaseStatValue(key, values[key]);
  }
}

function findBaseStatsLine(contents: string): {
  start: number;
  end: number;
  prefix: string;
  suffix: string;
  values: PokemonBaseStatValues;
} {
  const linePattern = /^([ \t]*db[ \t]+)([^;\r\n]*)([ \t]*(?:;[^\r\n]*)?)$/gm;
  let dataLineIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = linePattern.exec(contents)) !== null) {
    dataLineIndex += 1;
    if (dataLineIndex !== 2) {
      continue;
    }

    const rawValues = match[2]
      .split(",")
      .map((value) => value.trim());

    if (rawValues.length !== 5) {
      throw new Error(`Expected 5 base stats, found ${rawValues.length}.`);
    }

    const parsed = rawValues.map((value) => {
      if (!/^\d+$/.test(value)) {
        throw new Error(`Expected numeric base stat value, got '${value}'.`);
      }
      return Number(value);
    });

    const values: PokemonBaseStatValues = {
      hp: parsed[0],
      attack: parsed[1],
      defense: parsed[2],
      speed: parsed[3],
      special: parsed[4],
    };

    return {
      start: match.index,
      end: match.index + match[0].length,
      prefix: match[1],
      suffix: match[3],
      values,
    };
  }

  throw new Error("Could not locate the Pokémon base-stat row.");
}

export function updatePokemonBaseStatsContents(
  contents: string,
  values: PokemonBaseStatValues,
): string {
  validatePokemonBaseStats(values);
  const line = findBaseStatsLine(contents);
  const replacement = `${line.prefix}${values.hp}, ${values.attack}, ${values.defense}, ${values.speed}, ${values.special}${line.suffix}`;
  return contents.slice(0, line.start) + replacement + contents.slice(line.end);
}

export async function loadPokemonBaseStatsEditDocument(
  source: ProjectSource,
  sourceSlug: string,
): Promise<PokemonBaseStatsEditDocument> {
  const path = baseStatsPath(sourceSlug);
  const contents = await source.readText(path);
  const line = findBaseStatsLine(contents);

  return {
    path,
    sourceHash: await hashText(contents),
    values: line.values,
  };
}

export async function preparePokemonBaseStatsWrite(
  source: ProjectSource,
  sourceSlug: string,
  values: PokemonBaseStatValues,
): Promise<{ path: string; contents: string }> {
  const path = baseStatsPath(sourceSlug);
  const contents = await source.readText(path);
  return {
    path,
    contents: updatePokemonBaseStatsContents(contents, values),
  };
}
