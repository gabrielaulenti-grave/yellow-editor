import type {
  FishingData,
  FishingEditDocument,
  FishingFormat,
  FishingSlot,
  SuperRodTable,
} from "../core/types";
import { encounterLevelError } from "./encounterForm";

export interface FishingSlotDraft {
  level: string;
  speciesConstant: string;
  sourceLine: number;
}

export interface SuperRodTableDraft {
  id: string;
  displayName: string;
  affectedLocations: string[];
  slots: FishingSlotDraft[];
}

export interface FishingDraft {
  format: FishingFormat;
  oldRod: FishingSlotDraft;
  goodRod: FishingSlotDraft[];
  superRodTables: SuperRodTableDraft[];
}

function slotDraft(slot: FishingSlot): FishingSlotDraft {
  return {
    level: String(slot.level),
    speciesConstant: slot.speciesConstant,
    sourceLine: slot.sourceLine,
  };
}

export function fishingDraftFromDocument(document: FishingEditDocument): FishingDraft {
  return {
    format: document.format,
    oldRod: slotDraft(document.oldRod),
    goodRod: document.goodRod.map(slotDraft),
    superRodTables: document.superRodTables.map((table) => ({
      ...table,
      slots: table.slots.map(slotDraft),
    })),
  };
}

export function fishingDraftIsDirty(
  draft: FishingDraft | null,
  document: FishingEditDocument | null,
): boolean {
  return Boolean(
    draft && document &&
    JSON.stringify(draft) !== JSON.stringify(fishingDraftFromDocument(document)),
  );
}

function slotIsValid(slot: FishingSlotDraft): boolean {
  return encounterLevelError(slot.level) === null && Boolean(slot.speciesConstant);
}

export function fishingDraftIsValid(draft: FishingDraft | null): boolean {
  if (!draft || !slotIsValid(draft.oldRod) || draft.goodRod.length !== 2) {
    return false;
  }
  if (!draft.goodRod.every(slotIsValid) || draft.superRodTables.length === 0) {
    return false;
  }
  return draft.superRodTables.every((table) =>
    table.slots.length >= 1 &&
    table.slots.length <= 4 &&
    (draft.format !== "yellow" || table.slots.length === 4) &&
    table.slots.every(slotIsValid),
  );
}

function parseSlot(slot: FishingSlotDraft): FishingSlot | null {
  if (!slotIsValid(slot)) {
    return null;
  }
  return {
    level: Number(slot.level),
    speciesConstant: slot.speciesConstant,
    sourceLine: slot.sourceLine,
  };
}

export function parseFishingDraft(draft: FishingDraft | null): FishingData | null {
  if (!draft || !fishingDraftIsValid(draft)) {
    return null;
  }
  const oldRod = parseSlot(draft.oldRod);
  const goodRod = draft.goodRod.map(parseSlot);
  const superRodTables: SuperRodTable[] = [];
  if (!oldRod || goodRod.some((slot) => !slot)) {
    return null;
  }
  for (const table of draft.superRodTables) {
    const slots = table.slots.map(parseSlot);
    if (slots.some((slot) => !slot)) {
      return null;
    }
    superRodTables.push({
      id: table.id,
      displayName: table.displayName,
      affectedLocations: table.affectedLocations,
      slots: slots as FishingSlot[],
    });
  }
  return {
    format: draft.format,
    oldRod,
    goodRod: goodRod as FishingSlot[],
    superRodTables,
  };
}

export type FishingRod = "old" | "good" | "super";

export function updateFishingSlot(
  draft: FishingDraft,
  rod: FishingRod,
  tableId: string | null,
  slotIndex: number,
  field: "level" | "speciesConstant",
  value: string,
): FishingDraft {
  if (rod === "old") {
    return { ...draft, oldRod: { ...draft.oldRod, [field]: value } };
  }
  if (rod === "good") {
    return {
      ...draft,
      goodRod: draft.goodRod.map((slot, index) =>
        index === slotIndex ? { ...slot, [field]: value } : slot,
      ),
    };
  }
  return {
    ...draft,
    superRodTables: draft.superRodTables.map((table) =>
      table.id === tableId
        ? {
            ...table,
            slots: table.slots.map((slot, index) =>
              index === slotIndex ? { ...slot, [field]: value } : slot,
            ),
          }
        : table,
    ),
  };
}
