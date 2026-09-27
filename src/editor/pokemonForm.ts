import type {
  Evolution,
  PokedexTextLine,
  PokemonEditDocument,
  PokemonEditValues,
} from "../core/types";

export interface PokemonEvolutionDraft {
  method: Evolution["method"];
  level: string;
  item: string;
  target: string;
}

export interface PokemonLearnsetDraft {
  level: string;
  moveConstant: string;
}

export interface PokemonPokedexDraft {
  category: string;
  heightFeet: string;
  heightInches: string;
  weightLb: string;
  textLines: PokedexTextLine[];
}

export interface PokemonDraft {
  displayName: string;
  hp: string;
  attack: string;
  defense: string;
  speed: string;
  special: string;
  type1: string;
  type2: string;
  catchRate: string;
  baseExp: string;
  growthRate: string;
  startingMoves: string[];
  spriteChoiceId: string;
  paletteConstant: string;
  cgbPalette: [string, string, string, string] | null;
  sgbPalette: [string, string, string, string] | null;
  evolutions: PokemonEvolutionDraft[];
  learnset: PokemonLearnsetDraft[];
  tmhmMoves: string[];
  pokedex: PokemonPokedexDraft | null;
}

function copyPalette(
  colors: [string, string, string, string] | null,
): [string, string, string, string] | null {
  return colors ? [...colors] as [string, string, string, string] : null;
}

export function pokemonDraftFromDocument(document: PokemonEditDocument): PokemonDraft {
  const values = document.values;
  return {
    displayName: values.displayName,
    hp: String(values.hp),
    attack: String(values.attack),
    defense: String(values.defense),
    speed: String(values.speed),
    special: String(values.special),
    type1: values.type1,
    type2: values.type2,
    catchRate: String(values.catchRate),
    baseExp: String(values.baseExp),
    growthRate: values.growthRate,
    startingMoves: [...values.startingMoves],
    spriteChoiceId: values.spriteChoiceId,
    paletteConstant: values.paletteConstant,
    cgbPalette: copyPalette(values.cgbPalette),
    sgbPalette: copyPalette(values.sgbPalette),
    evolutions: values.evolutions.map((item) => ({
      method: item.method,
      level: String(item.level ?? 1),
      item: item.item ?? "",
      target: item.target,
    })),
    learnset: values.learnset.map((item) => ({
      level: String(item.level),
      moveConstant: item.moveConstant,
    })),
    tmhmMoves: [...values.tmhmMoves],
    pokedex: values.pokedex
      ? {
          category: values.pokedex.category,
          heightFeet: String(values.pokedex.heightFeet),
          heightInches: String(values.pokedex.heightInches),
          weightLb: (values.pokedex.weightTenthsLb / 10).toFixed(1),
          textLines: values.pokedex.textLines.map((line) => ({ ...line })),
        }
      : null,
  };
}

function integerValue(value: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

function weightTenths(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  const tenths = Math.round(parsed * 10);
  if (Math.abs(parsed * 10 - tenths) > 0.00001 || tenths > 65535) return null;
  return tenths;
}

function validText(value: string, max: number): boolean {
  return value.length > 0 && value.length <= max && !/["\r\n]/.test(value);
}

export function parsePokemonDraft(
  draft: PokemonDraft | null,
  document: PokemonEditDocument | null,
): PokemonEditValues | null {
  if (!draft || !document) return null;

  const hp = integerValue(draft.hp, 1, 255);
  const attack = integerValue(draft.attack, 1, 255);
  const defense = integerValue(draft.defense, 1, 255);
  const speed = integerValue(draft.speed, 1, 255);
  const special = integerValue(draft.special, 1, 255);
  const catchRate = integerValue(draft.catchRate, 0, 255);
  const baseExp = integerValue(draft.baseExp, 0, 255);
  if ([hp, attack, defense, speed, special, catchRate, baseExp].some((value) => value === null)) {
    return null;
  }

  if (
    !validText(draft.displayName, 10)
    || draft.displayName.includes("@")
    || !document.options.types.includes(draft.type1)
    || !document.options.types.includes(draft.type2)
    || !document.options.growthRates.includes(draft.growthRate)
    || draft.startingMoves.length !== 4
    || !document.options.spriteChoices.some((choice) => choice.id === draft.spriteChoiceId)
    || !document.options.paletteChoices.some((choice) => choice.constant === draft.paletteConstant)
  ) {
    return null;
  }

  const moves = new Set(document.options.moves);
  if (draft.startingMoves.some((move) => move !== "NO_MOVE" && !moves.has(move))) return null;

  const evolutions: Evolution[] = [];
  for (const item of draft.evolutions) {
    const level = integerValue(item.level, 1, 255);
    if (
      level === null
      || !document.options.species.includes(item.target)
      || (item.method === "item" && !document.options.items.includes(item.item))
    ) {
      return null;
    }
    evolutions.push({
      method: item.method,
      level,
      item: item.method === "item" ? item.item : null,
      target: item.target,
    });
  }

  const learnset = [];
  let previousLevel = 0;
  for (const item of draft.learnset) {
    const level = integerValue(item.level, 1, 100);
    if (level === null || level < previousLevel || !moves.has(item.moveConstant)) return null;
    previousLevel = level;
    learnset.push({ level, moveConstant: item.moveConstant });
  }

  const allowedTmhm = new Set(document.options.tmhmMoves);
  if (
    new Set(draft.tmhmMoves).size !== draft.tmhmMoves.length
    || draft.tmhmMoves.some((move) => !allowedTmhm.has(move))
  ) {
    return null;
  }

  let pokedex: PokemonEditValues["pokedex"] = null;
  if (draft.pokedex) {
    const heightFeet = integerValue(draft.pokedex.heightFeet, 0, 255);
    const heightInches = integerValue(draft.pokedex.heightInches, 0, 11);
    const weight = weightTenths(draft.pokedex.weightLb);
    if (
      heightFeet === null
      || heightInches === null
      || weight === null
      || !validText(draft.pokedex.category, 11)
      || draft.pokedex.category.includes("@")
      || draft.pokedex.textLines.length === 0
      || draft.pokedex.textLines[0].kind !== "text"
      || draft.pokedex.textLines.some((line) =>
        line.text.length > 18 || /["\r\n]/.test(line.text),
      )
    ) {
      return null;
    }
    pokedex = {
      category: draft.pokedex.category,
      heightFeet,
      heightInches,
      weightTenthsLb: weight,
      textLines: draft.pokedex.textLines.map((line) => ({ ...line })),
    };
  }

  const palette = document.options.paletteChoices.find(
    (choice) => choice.constant === draft.paletteConstant,
  );
  if (!palette) return null;
  if (palette.cgbColors && !draft.cgbPalette) return null;
  if (palette.sgbColors && !draft.sgbPalette) return null;

  return {
    displayName: draft.displayName,
    hp: hp!,
    attack: attack!,
    defense: defense!,
    speed: speed!,
    special: special!,
    type1: draft.type1,
    type2: draft.type2,
    catchRate: catchRate!,
    baseExp: baseExp!,
    growthRate: draft.growthRate,
    startingMoves: [...draft.startingMoves],
    spriteChoiceId: draft.spriteChoiceId,
    paletteConstant: draft.paletteConstant,
    cgbPalette: copyPalette(draft.cgbPalette),
    sgbPalette: copyPalette(draft.sgbPalette),
    evolutions,
    learnset,
    tmhmMoves: [...draft.tmhmMoves],
    pokedex,
  };
}

export function pokemonDraftIsValid(
  draft: PokemonDraft | null,
  document: PokemonEditDocument | null,
): boolean {
  return parsePokemonDraft(draft, document) !== null;
}

export function pokemonDraftIsDirty(
  draft: PokemonDraft | null,
  document: PokemonEditDocument | null,
): boolean {
  if (!draft || !document) return false;
  return JSON.stringify(draft) !== JSON.stringify(pokemonDraftFromDocument(document));
}

export function updatePokemonPaletteConstant(
  draft: PokemonDraft,
  document: PokemonEditDocument,
  constant: string,
): PokemonDraft {
  const palette = document.options.paletteChoices.find((choice) => choice.constant === constant);
  if (!palette) return draft;
  return {
    ...draft,
    paletteConstant: constant,
    cgbPalette: copyPalette(palette.cgbColors),
    sgbPalette: copyPalette(palette.sgbColors),
  };
}
