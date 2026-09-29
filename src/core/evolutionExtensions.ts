import type { TextWriteRequest } from "./types";

export const POKEMON_DATA_CONSTANTS_PATH = "constants/pokemon_data_constants.asm";
export const EVOLUTION_ENGINE_PATH = "engine/pokemon/evos_moves.asm";
export const ITEM_EFFECTS_PATH = "engine/items/item_effects.asm";

const MOVE_SUPPORT_MARKER = "; Yellow Editor extended evolution: move-known support";

export function hasMoveEvolutionSupport(constants: string): boolean {
  return /^\s*const\s+EVOLVE_MOVE\b/m.test(constants);
}

function installEvolutionConstant(contents: string): string {
  if (hasMoveEvolutionSupport(contents)) return contents;
  const pattern = /^(\s*const\s+EVOLVE_TRADE\s*;\s*3[^\r\n]*)(\r?\n)/m;
  if (!pattern.test(contents)) {
    throw new Error(
      "Could not install EVOLVE_MOVE because the evolution-type constants are not in a supported Red/Blue/Yellow layout.",
    );
  }
  return contents.replace(
    pattern,
    "$1$2\tconst EVOLVE_MOVE  ; 4 ; Yellow Editor: level up while knowing a move$2",
  );
}

function installEvolutionEngine(contents: string): string {
  if (contents.includes(MOVE_SUPPORT_MARKER)) return contents;

  const dispatchPattern =
    /\tld a, b\r?\n\tcp EVOLVE_ITEM\r?\n\tjr z, \.checkItemEvo\r?\n\tld a, \[wForceEvolution\]\r?\n\tand a\r?\n\tjr nz, Evolution_PartyMonLoop\r?\n\tld a, b\r?\n\tcp EVOLVE_LEVEL\r?\n\tjr z, \.checkLevel\r?\n(?=\.checkTradeEvo)/;
  if (!dispatchPattern.test(contents)) {
    throw new Error(
      "Could not install move-known evolution support because EvolutionAfterBattle has an unsupported layout.",
    );
  }

  let next = contents.replace(
    dispatchPattern,
    [
      "\tld a, b",
      "\tcp EVOLVE_ITEM",
      "\tjr z, .checkItemEvo",
      "\tld a, b",
      "\tcp EVOLVE_MOVE",
      "\tjr z, .checkMoveEvo",
      "\tld a, [wForceEvolution]",
      "\tand a",
      "\tjp nz, .nextEvoEntry1 ; forced item use skips level evolutions",
      "\tld a, b",
      "\tcp EVOLVE_LEVEL",
      "\tjr z, .checkLevel",
      "",
    ].join("\n"),
  );

  const itemLabel = /^\.checkItemEvo\s*$/m;
  if (!itemLabel.test(next)) {
    throw new Error("Could not locate the item-evolution check in EvolutionAfterBattle.");
  }

  const moveBlock = [
    MOVE_SUPPORT_MARKER,
    ".checkMoveEvo",
    "\tld a, [wForceEvolution]",
    "\tand a",
    "\tjr z, .checkMoveRequirement",
    "\tinc hl ; move",
    "\tinc hl ; minimum level",
    "\tinc hl ; target",
    "\tjp .evoEntryLoop",
    ".checkMoveRequirement",
    "\tld a, [hli] ; required move",
    "\tld c, a",
    "\tpush hl ; save pointer to minimum level",
    "\tld hl, wLoadedMonMoves",
    "\tld b, NUM_MOVES",
    ".checkRequiredMove",
    "\tld a, [hli]",
    "\tcp c",
    "\tjr z, .requiredMoveKnown",
    "\tdec b",
    "\tjr nz, .checkRequiredMove",
    "\tpop hl",
    "\tjp .nextEvoEntry1 ; skip minimum level and target",
    ".requiredMoveKnown",
    "\tpop hl",
    "\tjr .checkLevel ; same-level move learning is already complete before this check",
    "",
  ].join("\n");

  next = next.replace(itemLabel, moveBlock + ".checkItemEvo");
  return next;
}

function installStoneScanner(contents: string): string {
  const marker = "; Yellow Editor extended evolution: variable-size stone scan";
  if (contents.includes(marker)) return contents;

  const funcStart = contents.indexOf("Func_d85d:");
  if (funcStart < 0) {
    // pret/pokered does not have Yellow's pre-flight stone scanner.
    return contents;
  }

  const loopPattern =
    /\.loop\r?\n\tld a, \[hli\]\r?\n\tand a\r?\n\tjr z, \.cannotEvolveWithUsedStone\r?\n\tinc hl\r?\n\tinc hl\r?\n\tcp EVOLVE_ITEM\r?\n\tjr nz, \.loop\r?\n\tdec hl\r?\n\tdec hl\r?\n\tld b, \[hl\]\r?\n\tld a, \[wCurItem\]\r?\n\tinc hl\r?\n\tinc hl\r?\n\tinc hl\r?\n\tcp b\r?\n\tjr nz, \.loop\r?\n\tscf\r?\n\tret\r?\n\r?\n/;

  if (!loopPattern.test(contents.slice(funcStart))) {
    throw new Error(
      "Could not install move-known evolution support because Func_d85d is not the supported vanilla scanner.",
    );
  }

  const replacement = [
    marker,
    ".loop",
    "\tld a, [hli]",
    "\tand a",
    "\tjr z, .cannotEvolveWithUsedStone",
    "\tcp EVOLVE_ITEM",
    "\tjr z, .checkItemEvolution",
    "\tcp EVOLVE_MOVE",
    "\tjr z, .skipFourByteEvolution",
    "\tinc hl ; level/trade requirement",
    "\tinc hl ; target",
    "\tjr .loop",
    ".skipFourByteEvolution",
    "\tinc hl ; move",
    "\tinc hl ; minimum level",
    "\tinc hl ; target",
    "\tjr .loop",
    ".checkItemEvolution",
    "\tld b, [hl]",
    "\tld a, [wCurItem]",
    "\tinc hl ; item",
    "\tinc hl ; minimum level",
    "\tinc hl ; target",
    "\tcp b",
    "\tjr nz, .loop",
    "\tscf",
    "\tret",
    "",
    "",
  ].join("\n");

  return contents.slice(0, funcStart)
    + contents.slice(funcStart).replace(loopPattern, replacement);
}

export function installMoveEvolutionSupport(
  constants: string,
  evolutionEngine: string,
  itemEffects: string,
): {
  constants: string;
  evolutionEngine: string;
  itemEffects: string;
} {
  return {
    constants: installEvolutionConstant(constants),
    evolutionEngine: installEvolutionEngine(evolutionEngine),
    itemEffects: installStoneScanner(itemEffects),
  };
}

export function moveEvolutionSupportWrites(
  before: Map<string, string>,
  expectedHash: (path: string) => string,
): TextWriteRequest[] {
  const constants = before.get(POKEMON_DATA_CONSTANTS_PATH);
  const evolutionEngine = before.get(EVOLUTION_ENGINE_PATH);
  const itemEffects = before.get(ITEM_EFFECTS_PATH);
  if (constants === undefined || evolutionEngine === undefined || itemEffects === undefined) {
    throw new Error("Missing source files required for extended evolution support.");
  }

  const next = installMoveEvolutionSupport(constants, evolutionEngine, itemEffects);
  const pairs: Array<[string, string]> = [
    [POKEMON_DATA_CONSTANTS_PATH, next.constants],
    [EVOLUTION_ENGINE_PATH, next.evolutionEngine],
    [ITEM_EFFECTS_PATH, next.itemEffects],
  ];
  return pairs.flatMap(([path, contents]) =>
    contents === before.get(path)
      ? []
      : [{ path, contents, expectedHash: expectedHash(path) }],
  );
}
