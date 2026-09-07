import type {
  EncounterArea,
  EncounterSlot,
  EncounterTableEditDocument,
  EncounterTerrain,
  EncounterVersion,
  EncounterVersionData,
} from "../core/types";

export interface EncounterSlotDraft {
  level: string;
  speciesConstant: string;
  sourceLine: number | null;
}

export interface EncounterAreaDraft {
  rate: string;
  slots: EncounterSlotDraft[];
}

export interface EncounterVersionDraft {
  version: EncounterVersion;
  grass: EncounterAreaDraft;
  water: EncounterAreaDraft;
}

export type EncounterDraft = EncounterVersionDraft[];

function slotDraft(slot: EncounterSlot): EncounterSlotDraft {
  return {
    level: String(slot.level),
    speciesConstant: slot.speciesConstant,
    sourceLine: slot.sourceLine,
  };
}

function areaDraft(area: EncounterArea): EncounterAreaDraft {
  return { rate: String(area.rate), slots: area.slots.map(slotDraft) };
}

export function encounterDraftFromDocument(
  document: EncounterTableEditDocument,
): EncounterDraft {
  return document.versions.map((entry) => ({
    version: entry.version,
    grass: areaDraft(entry.grass),
    water: areaDraft(entry.water),
  }));
}

function integerInRange(value: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

export function encounterRateError(value: string): string | null {
  return integerInRange(value, 0, 255) === null
    ? "Use a whole number from 0 to 255."
    : null;
}

export function encounterLevelError(value: string): string | null {
  return integerInRange(value, 1, 100) === null
    ? "Use a level from 1 to 100."
    : null;
}

export function encounterDraftIsValid(draft: EncounterDraft): boolean {
  if (draft.length === 0) {
    return false;
  }
  for (const entry of draft) {
    for (const terrain of ["grass", "water"] as const) {
      const area = entry[terrain];
      const rate = integerInRange(area.rate, 0, 255);
      if (rate === null || (rate > 0 && area.slots.length !== 10)) {
        return false;
      }
      if (
        rate > 0 &&
        area.slots.some(
          (slot) =>
            encounterLevelError(slot.level) !== null || !slot.speciesConstant,
        )
      ) {
        return false;
      }
    }
  }
  return (["grass", "water"] as const).every((terrain) =>
    draft.every((entry) => entry[terrain].rate === draft[0][terrain].rate),
  );
}

export function encounterDraftIsDirty(
  draft: EncounterDraft,
  document: EncounterTableEditDocument | null,
): boolean {
  if (!document) {
    return false;
  }
  return JSON.stringify(draft) !== JSON.stringify(encounterDraftFromDocument(document));
}

function parseArea(area: EncounterAreaDraft): EncounterArea | null {
  const rate = integerInRange(area.rate, 0, 255);
  if (rate === null || (rate > 0 && area.slots.length !== 10)) {
    return null;
  }
  if (rate === 0) {
    return { rate, slots: [] };
  }
  const slots: EncounterSlot[] = [];
  for (const slot of area.slots) {
    const level = integerInRange(slot.level, 1, 100);
    if (level === null || !slot.speciesConstant) {
      return null;
    }
    slots.push({
      level,
      speciesConstant: slot.speciesConstant,
      sourceLine: slot.sourceLine,
    });
  }
  return { rate, slots };
}

export function parseEncounterDraft(draft: EncounterDraft): EncounterVersionData[] | null {
  if (!encounterDraftIsValid(draft)) {
    return null;
  }
  const result: EncounterVersionData[] = [];
  for (const entry of draft) {
    const grass = parseArea(entry.grass);
    const water = parseArea(entry.water);
    if (!grass || !water) {
      return null;
    }
    result.push({ version: entry.version, grass, water });
  }
  return result;
}

export function updateEncounterRate(
  draft: EncounterDraft,
  terrain: EncounterTerrain,
  value: string,
): EncounterDraft {
  return draft.map((entry) => ({
    ...entry,
    [terrain]: { ...entry[terrain], rate: value },
  }));
}

export function updateEncounterSlot(
  draft: EncounterDraft,
  version: EncounterVersion,
  terrain: EncounterTerrain,
  slotIndex: number,
  field: "level" | "speciesConstant",
  value: string,
): EncounterDraft {
  const selectedArea = draft.find((entry) => entry.version === version)?.[terrain];
  const sourceLine = selectedArea?.slots[slotIndex]?.sourceLine;
  return draft.map((entry) => ({
    ...entry,
    grass: {
      ...entry.grass,
      slots: entry.grass.slots.map((slot, index) =>
        (sourceLine !== null && sourceLine !== undefined && slot.sourceLine === sourceLine) ||
        (entry.version === version && terrain === "grass" && index === slotIndex)
          ? { ...slot, [field]: value }
          : slot,
      ),
    },
    water: {
      ...entry.water,
      slots: entry.water.slots.map((slot, index) =>
        (sourceLine !== null && sourceLine !== undefined && slot.sourceLine === sourceLine) ||
        (entry.version === version && terrain === "water" && index === slotIndex)
          ? { ...slot, [field]: value }
          : slot,
      ),
    },
  }));
}

export function enableEncounterArea(
  draft: EncounterDraft,
  terrain: EncounterTerrain,
  defaultSpecies: string,
): EncounterDraft {
  const allHaveExistingSlots = draft.every((entry) => entry[terrain].slots.length === 10);
  const newSlots = Array.from({ length: 10 }, (_, index) => ({
    level: "5",
    speciesConstant: defaultSpecies,
    sourceLine: -(index + 1),
  }));
  return draft.map((entry) => ({
    ...entry,
    [terrain]: {
      rate: "10",
      slots: (allHaveExistingSlots ? entry[terrain].slots : newSlots).map((slot) => ({ ...slot })),
    },
  }));
}

export function disableEncounterArea(
  draft: EncounterDraft,
  terrain: EncounterTerrain,
): EncounterDraft {
  return updateEncounterRate(draft, terrain, "0");
}
