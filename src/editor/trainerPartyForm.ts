import type {
  TrainerPartyEditValues,
  TrainerPartyEntry,
  TrainerPartyFormat,
  TrainerSpecialMoveSourceKind,
  TrainerSpecialMoveScope,
} from "../core/types";

export interface TrainerPokemonDraft {
  level: string;
  speciesConstant: string;
}

export interface TrainerSpecialMoveDraft {
  scope: TrainerSpecialMoveScope;
  pokemonIndex: string;
  moveSlot: string;
  moveConstant: string;
  sourceKind: TrainerSpecialMoveSourceKind;
  sourceKey: string;
}

export interface TrainerPartyDraft {
  partyFormat: TrainerPartyFormat;
  pokemon: TrainerPokemonDraft[];
  specialMoves: TrainerSpecialMoveDraft[];
}

export function trainerDraftFromParty(party: TrainerPartyEntry): TrainerPartyDraft {
  return {
    partyFormat: party.partyFormat,
    pokemon: party.pokemon.map((pokemon) => ({
      level: String(pokemon.level),
      speciesConstant: pokemon.speciesConstant,
    })),
    specialMoves: party.specialMoves.map((move) => ({
      scope: move.scope,
      pokemonIndex: move.pokemonIndex === null ? "" : String(move.pokemonIndex),
      moveSlot: move.moveSlot === null ? "" : String(move.moveSlot),
      moveConstant: move.moveConstant,
      sourceKind: move.sourceKind,
      sourceKey: move.sourceKey,
    })),
  };
}

export function trainerLevelError(level: string): string | null {
  return /^\d+$/.test(level) && Number(level) >= 1 && Number(level) <= 100
    ? null
    : "Enter a whole number from 1 to 100.";
}

export function trainerSpecialMoveError(
  move: TrainerSpecialMoveDraft,
  pokemonCount: number,
  knownMoves: Set<string>,
): string | null {
  const pokemonIndex = Number(move.pokemonIndex);
  const moveSlot = Number(move.moveSlot);
  if (
    !/^\d+$/.test(move.pokemonIndex) ||
    pokemonIndex < 1 ||
    (pokemonIndex > pokemonCount && move.sourceKind !== "red-class")
  ) {
    return `Pokémon must be between 1 and ${pokemonCount}.`;
  }
  if (!/^\d+$/.test(move.moveSlot) || moveSlot < 1 || moveSlot > 4) {
    return "Move slot must be between 1 and 4.";
  }
  if (!knownMoves.has(move.moveConstant)) {
    return "Choose a known move.";
  }
  return null;
}

export function trainerDraftIsValid(
  draft: TrainerPartyDraft | null,
  knownSpecies: Set<string>,
  knownMoves: Set<string>,
): boolean {
  if (!draft || draft.pokemon.length < 1 || draft.pokemon.length > 6) {
    return false;
  }
  if (draft.pokemon.some((pokemon) =>
    trainerLevelError(pokemon.level) || !knownSpecies.has(pokemon.speciesConstant),
  )) {
    return false;
  }
  if (
    draft.partyFormat === "shared-level" &&
    draft.pokemon.some((pokemon) => pokemon.level !== draft.pokemon[0].level)
  ) {
    return false;
  }
  const occupied = new Set<string>();
  for (const move of draft.specialMoves) {
    if (trainerSpecialMoveError(move, draft.pokemon.length, knownMoves)) {
      return false;
    }
    const key = `${move.pokemonIndex}:${move.moveSlot}`;
    if (occupied.has(key)) {
      return false;
    }
    occupied.add(key);
  }
  return true;
}

export function trainerDraftIsDirty(
  draft: TrainerPartyDraft | null,
  party: TrainerPartyEntry | null,
): boolean {
  return Boolean(draft && party && JSON.stringify(draft) !== JSON.stringify(trainerDraftFromParty(party)));
}

export function parseTrainerDraft(draft: TrainerPartyDraft): TrainerPartyEditValues | null {
  const pokemon = draft.pokemon.map((entry) => ({
    level: Number(entry.level),
    speciesConstant: entry.speciesConstant,
  }));
  const specialMoves = draft.specialMoves.map((move) => ({
    scope: move.scope,
    pokemonIndex: Number(move.pokemonIndex),
    moveSlot: Number(move.moveSlot),
    moveConstant: move.moveConstant,
    sourceKind: move.sourceKind,
    sourceKey: move.sourceKey,
  }));
  if (
    pokemon.some((entry) => !Number.isInteger(entry.level)) ||
    specialMoves.some((move) => !Number.isInteger(move.pokemonIndex) || !Number.isInteger(move.moveSlot))
  ) {
    return null;
  }
  return { partyFormat: draft.partyFormat, pokemon, specialMoves };
}

export function updateTrainerFormat(
  draft: TrainerPartyDraft,
  partyFormat: TrainerPartyFormat,
): TrainerPartyDraft {
  const sharedLevel = draft.pokemon[0]?.level ?? "5";
  return {
    ...draft,
    partyFormat,
    pokemon: partyFormat === "shared-level"
      ? draft.pokemon.map((pokemon) => ({ ...pokemon, level: sharedLevel }))
      : draft.pokemon,
  };
}

export function updateTrainerPokemon(
  draft: TrainerPartyDraft,
  index: number,
  field: keyof TrainerPokemonDraft,
  value: string,
): TrainerPartyDraft {
  return {
    ...draft,
    pokemon: draft.pokemon.map((pokemon, pokemonIndex) => {
      if (field === "level" && draft.partyFormat === "shared-level") {
        return { ...pokemon, level: value };
      }
      return pokemonIndex === index ? { ...pokemon, [field]: value } : pokemon;
    }),
  };
}

export function addTrainerPokemon(
  draft: TrainerPartyDraft,
  defaultSpecies: string,
): TrainerPartyDraft {
  if (draft.pokemon.length >= 6) {
    return draft;
  }
  const previous = draft.pokemon[draft.pokemon.length - 1];
  return {
    ...draft,
    pokemon: [...draft.pokemon, {
      level: draft.partyFormat === "shared-level"
        ? draft.pokemon[0]?.level ?? "5"
        : previous?.level ?? "5",
      speciesConstant: previous?.speciesConstant ?? defaultSpecies,
    }],
  };
}

export function removeTrainerPokemon(
  draft: TrainerPartyDraft,
  index: number,
): TrainerPartyDraft {
  if (draft.pokemon.length <= 1) {
    return draft;
  }
  const removedNumber = index + 1;
  return {
    ...draft,
    pokemon: draft.pokemon.filter((_pokemon, pokemonIndex) => pokemonIndex !== index),
    specialMoves: draft.specialMoves
      .filter((move) => Number(move.pokemonIndex) !== removedNumber || move.sourceKind !== "yellow-party")
      .map((move) => move.sourceKind !== "red-class" && Number(move.pokemonIndex) > removedNumber
        ? { ...move, pokemonIndex: String(Number(move.pokemonIndex) - 1) }
        : move),
  };
}

export function updateTrainerSpecialMove(
  draft: TrainerPartyDraft,
  index: number,
  field: "pokemonIndex" | "moveSlot" | "moveConstant",
  value: string,
): TrainerPartyDraft {
  return {
    ...draft,
    specialMoves: draft.specialMoves.map((move, moveIndex) =>
      moveIndex === index ? { ...move, [field]: value } : move,
    ),
  };
}

export function addYellowSpecialMove(
  draft: TrainerPartyDraft,
  partyId: string,
  defaultMove: string,
): TrainerPartyDraft {
  const occupied = new Set(draft.specialMoves.map((move) => `${move.pokemonIndex}:${move.moveSlot}`));
  let pokemonIndex = 1;
  let moveSlot = 1;
  for (let pokemon = 1; pokemon <= draft.pokemon.length; pokemon += 1) {
    const availableSlot = [1, 2, 3, 4].find((slot) => !occupied.has(`${pokemon}:${slot}`));
    if (availableSlot) {
      pokemonIndex = pokemon;
      moveSlot = availableSlot;
      break;
    }
  }
  if (occupied.size >= draft.pokemon.length * 4) {
    return draft;
  }
  return {
    ...draft,
    specialMoves: [...draft.specialMoves, {
      scope: "party",
      pokemonIndex: String(pokemonIndex),
      moveSlot: String(moveSlot),
      moveConstant: defaultMove,
      sourceKind: "yellow-party",
      sourceKey: partyId,
    }],
  };
}

export function removeYellowSpecialMove(
  draft: TrainerPartyDraft,
  index: number,
): TrainerPartyDraft {
  if (draft.specialMoves[index]?.sourceKind !== "yellow-party") {
    return draft;
  }
  return {
    ...draft,
    specialMoves: draft.specialMoves.filter((_move, moveIndex) => moveIndex !== index),
  };
}
