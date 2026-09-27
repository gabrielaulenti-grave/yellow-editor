import type {
  TrainerClassEditValues,
  TrainerClassEntry,
} from "../core/types";

export interface TrainerClassDraft {
  name: string;
  picLabel: string;
  baseRewardPerLevel: string;
  aiRoutine: string;
  aiUsesPerPokemon: string;
  moveChoiceModifiers: number[];
}

export function trainerClassDraftFromEntry(
  entry: TrainerClassEntry,
): TrainerClassDraft {
  return {
    name: entry.name,
    picLabel: entry.picLabel ?? "",
    baseRewardPerLevel: entry.baseRewardPerLevel === null
      ? ""
      : String(entry.baseRewardPerLevel),
    aiRoutine: entry.aiRoutine ?? "",
    aiUsesPerPokemon: entry.aiUsesPerPokemon === null
      ? ""
      : String(entry.aiUsesPerPokemon),
    moveChoiceModifiers: [...entry.moveChoiceModifiers],
  };
}

export function trainerClassDraftIsDirty(
  draft: TrainerClassDraft | null,
  entry: TrainerClassEntry | null,
): boolean {
  if (!draft || !entry) return false;
  const original = trainerClassDraftFromEntry(entry);
  return (
    draft.name !== original.name
    || draft.picLabel !== original.picLabel
    || draft.baseRewardPerLevel !== original.baseRewardPerLevel
    || draft.aiRoutine !== original.aiRoutine
    || draft.aiUsesPerPokemon !== original.aiUsesPerPokemon
    || draft.moveChoiceModifiers.join(",") !== original.moveChoiceModifiers.join(",")
  );
}

export function trainerClassDraftIsValid(
  draft: TrainerClassDraft | null,
  knownPicLabels: Set<string>,
  knownAiRoutines: Set<string>,
): boolean {
  if (!draft) return false;
  const name = draft.name.trim();
  if (!name || name.length > 12 || /["@\r\n]/.test(name)) return false;
  if (!knownPicLabels.has(draft.picLabel)) return false;
  if (!knownAiRoutines.has(draft.aiRoutine)) return false;

  const reward = Number(draft.baseRewardPerLevel);
  if (
    !/^\d+$/.test(draft.baseRewardPerLevel)
    || !Number.isInteger(reward)
    || reward < 0
    || reward > 99
  ) {
    return false;
  }

  const aiUses = Number(draft.aiUsesPerPokemon);
  if (
    !/^\d+$/.test(draft.aiUsesPerPokemon)
    || !Number.isInteger(aiUses)
    || aiUses < 0
    || aiUses > 255
  ) {
    return false;
  }

  const unique = new Set(draft.moveChoiceModifiers);
  return (
    unique.size === draft.moveChoiceModifiers.length
    && draft.moveChoiceModifiers.every((value) =>
      Number.isInteger(value) && value >= 1 && value <= 3
    )
  );
}

export function parseTrainerClassDraft(
  draft: TrainerClassDraft,
): TrainerClassEditValues | null {
  const reward = Number(draft.baseRewardPerLevel);
  const aiUses = Number(draft.aiUsesPerPokemon);
  if (
    !Number.isInteger(reward)
    || !Number.isInteger(aiUses)
  ) {
    return null;
  }

  return {
    name: draft.name.trim(),
    picLabel: draft.picLabel,
    baseRewardPerLevel: reward,
    aiRoutine: draft.aiRoutine,
    aiUsesPerPokemon: aiUses,
    moveChoiceModifiers: [...draft.moveChoiceModifiers].sort((a, b) => a - b),
  };
}
