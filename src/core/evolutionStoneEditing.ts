import type {
  EvolutionStoneReference,
  EvolutionStoneRoutineParameters,
  PokemonIndexEntry,
} from "./types";

export const EVOS_MOVES_PATH = "data/pokemon/evos_moves.asm";

function codeOnly(line: string): string {
  return (line.split(";", 1)[0] || "").trim();
}

function pointerTable(contents: string): string[] {
  const result: string[] = [];
  let active = false;
  for (const line of contents.split(/\r?\n/)) {
    const clean = codeOnly(line);
    if (clean === "EvosMovesPointerTable:" || clean === "EvosMovesPointerTable::") {
      active = true;
      continue;
    }
    if (!active) continue;
    if (clean.startsWith("assert_table_length")) break;
    const match = clean.match(/^dw[ \t]+([^, \t;]+)/);
    if (match) result.push(match[1]);
  }
  return result;
}

function labelLineIndex(lines: string[], label: string): number {
  const index = lines.findIndex((line) => {
    const clean = codeOnly(line);
    return clean === label + ":" || clean === label + "::";
  });
  if (index < 0) throw new Error(`Could not locate evolution block ${label}.`);
  return index;
}

function itemEvolutionRows(
  lines: string[],
  label: string,
): Array<{
  lineIndex: number;
  evolutionIndex: number;
  itemConstant: string;
  minimumLevel: number;
  targetConstant: string;
}> {
  const start = labelLineIndex(lines, label);
  const result: Array<{
    lineIndex: number;
    evolutionIndex: number;
    itemConstant: string;
    minimumLevel: number;
    targetConstant: string;
  }> = [];
  let evolutionIndex = 0;

  for (let lineIndex = start + 1; lineIndex < lines.length; lineIndex += 1) {
    const clean = codeOnly(lines[lineIndex]);
    if (!clean) continue;
    if (/^[A-Za-z_][A-Za-z0-9_.]*::?$/.test(clean) && !clean.startsWith(".")) break;
    if (!clean.startsWith("db ")) continue;

    const body = clean.slice(3).trim();
    if (body === "0") break;

    const values = body.split(",").map((value) => value.trim());
    if (values[0] === "EVOLVE_ITEM" && values.length === 4) {
      const minimumLevel = Number.parseInt(values[2], 10);
      if (!Number.isInteger(minimumLevel)) {
        throw new Error(`Unsupported item-evolution level in ${label}.`);
      }
      result.push({
        lineIndex,
        evolutionIndex,
        itemConstant: values[1],
        minimumLevel,
        targetConstant: values[3],
      });
    }
    evolutionIndex += 1;
  }

  return result;
}

export function parseEvolutionStoneRoutine(
  contents: string,
  pokemonIndex: PokemonIndexEntry[],
  stoneConstant: string,
  stoneConstants: string[],
): EvolutionStoneRoutineParameters {
  const pointers = pointerTable(contents);
  const displayByConstant = new Map(
    pokemonIndex
      .filter((entry) => entry.constant)
      .map((entry) => [entry.constant as string, entry.displayName]),
  );
  const references: EvolutionStoneReference[] = [];
  const lines = contents.split(/\r?\n/);

  for (const entry of pokemonIndex) {
    if (
      entry.internalId <= 0
      || entry.kind !== "pokemon"
      || !entry.constant
    ) {
      continue;
    }
    const label = pointers[entry.internalId - 1];
    if (!label) continue;

    for (const evolution of itemEvolutionRows(lines, label)) {
      if (evolution.itemConstant !== stoneConstant) continue;
      references.push({
        internalId: entry.internalId,
        sourceConstant: entry.constant,
        sourceDisplayName: entry.displayName,
        targetConstant: evolution.targetConstant,
        targetDisplayName:
          displayByConstant.get(evolution.targetConstant) ?? evolution.targetConstant,
        minimumLevel: evolution.minimumLevel,
        evolutionIndex: evolution.evolutionIndex,
        itemConstant: evolution.itemConstant,
      });
    }
  }

  return {
    kind: "evolution-stone",
    stoneConstants: [...stoneConstants],
    references,
  };
}

function referenceKey(
  reference: Pick<EvolutionStoneReference, "internalId" | "evolutionIndex" | "targetConstant">,
): string {
  return `${reference.internalId}:${reference.evolutionIndex}:${reference.targetConstant}`;
}

export function rewriteEvolutionStoneRoutine(
  contents: string,
  original: EvolutionStoneRoutineParameters,
  values: EvolutionStoneRoutineParameters,
): string {
  const allowed = new Set(original.stoneConstants);
  if (
    original.stoneConstants.length !== values.stoneConstants.length
    || original.stoneConstants.some((constant, index) => constant !== values.stoneConstants[index])
  ) {
    throw new Error("The available evolution-stone list changed. Reload the item.");
  }

  const originalByKey = new Map(
    original.references.map((reference) => [referenceKey(reference), reference]),
  );
  if (values.references.length !== original.references.length) {
    throw new Error("Evolution references cannot be added or removed from the stone panel.");
  }

  const pointers = pointerTable(contents);
  const newline = contents.includes("\r\n") ? "\r\n" : "\n";
  const lines = contents.split(/\r?\n/);

  for (const value of values.references) {
    const key = referenceKey(value);
    const before = originalByKey.get(key);
    if (!before) {
      throw new Error("An evolution reference changed. Reload the item.");
    }
    if (
      value.internalId !== before.internalId
      || value.sourceConstant !== before.sourceConstant
      || value.sourceDisplayName !== before.sourceDisplayName
      || value.targetConstant !== before.targetConstant
      || value.targetDisplayName !== before.targetDisplayName
      || value.minimumLevel !== before.minimumLevel
      || value.evolutionIndex !== before.evolutionIndex
    ) {
      throw new Error("Only the evolution stone assignment can be changed here.");
    }
    if (!allowed.has(value.itemConstant)) {
      throw new Error(`${value.itemConstant} is not an item using ItemUseEvoStone.`);
    }
    if (value.itemConstant === before.itemConstant) continue;

    const label = pointers[value.internalId - 1];
    if (!label) throw new Error(`Could not resolve ${value.sourceConstant}'s evolution block.`);
    const row = itemEvolutionRows(lines, label).find(
      (candidate) => candidate.evolutionIndex === value.evolutionIndex,
    );
    if (!row || row.targetConstant !== value.targetConstant) {
      throw new Error(`${value.sourceConstant}'s evolution data changed. Reload the item.`);
    }
    if (row.itemConstant !== before.itemConstant) {
      throw new Error(`${value.sourceConstant}'s evolution stone changed outside Yellow Editor.`);
    }

    const pattern =
      /^(\s*db\s+EVOLVE_ITEM,\s*)([A-Z0-9_]+)(\s*,\s*[^,]+,\s*[A-Z0-9_]+.*)$/i;
    if (!pattern.test(lines[row.lineIndex])) {
      throw new Error(`Could not rewrite ${value.sourceConstant}'s item evolution.`);
    }
    lines[row.lineIndex] = lines[row.lineIndex].replace(
      pattern,
      `$1${value.itemConstant}$3`,
    );
  }

  return lines.join(newline);
}
