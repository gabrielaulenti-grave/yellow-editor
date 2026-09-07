import type { PokemonBaseStatValues } from "../core/types";

export type BaseStatKey = keyof PokemonBaseStatValues;
export type BaseStatsDraft = Record<BaseStatKey, string>;

export const BASE_STAT_FIELDS: { key: BaseStatKey; label: string }[] = [
  { key: "hp", label: "HP" },
  { key: "attack", label: "Attack" },
  { key: "defense", label: "Defense" },
  { key: "speed", label: "Speed" },
  { key: "special", label: "Special" },
];

export const EMPTY_BASE_STATS_DRAFT: BaseStatsDraft = {
  hp: "",
  attack: "",
  defense: "",
  speed: "",
  special: "",
};

export function draftFromValues(values: PokemonBaseStatValues): BaseStatsDraft {
  return {
    hp: String(values.hp),
    attack: String(values.attack),
    defense: String(values.defense),
    speed: String(values.speed),
    special: String(values.special),
  };
}
export function validateBaseStatInput(value: string): string | null {
  if (!/^\d+$/.test(value)) {
    return "Enter a whole number.";
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 255) {
    return "Must be between 1 and 255.";
  }

  return null;
}

export function parseBaseStatsDraft(
  draft: BaseStatsDraft,
): PokemonBaseStatValues | null {
  for (const field of BASE_STAT_FIELDS) {
    if (validateBaseStatInput(draft[field.key])) {
      return null;
    }
  }

  return {
    hp: Number(draft.hp),
    attack: Number(draft.attack),
    defense: Number(draft.defense),
    speed: Number(draft.speed),
    special: Number(draft.special),
  };
}
