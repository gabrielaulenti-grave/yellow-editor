import { hashText } from "./history";
import { mapConstantDisplayName } from "./mapMetadata";
import type {
  FishingData,
  FishingEditDocument,
  FishingSlot,
  FishingSourceDocument,
  ProjectSource,
  SuperRodTable,
  TextWriteRequest,
} from "./types";

const OLD_ROD_PATH = "engine/items/item_effects.asm";
const GOOD_ROD_PATH = "data/wild/good_rod.asm";
const SUPER_ROD_PATH = "data/wild/super_rod.asm";

interface FishingSources {
  oldRod: string;
  goodRod: string;
  superRod: string;
}

function parseSlotLine(line: string, sourceLine: number): FishingSlot | null {
  const match = line.match(/^\s*db\s+(\d+)\s*,\s*([A-Za-z_][A-Za-z0-9_]*)\b/);
  return match
    ? { level: Number(match[1]), speciesConstant: match[2], sourceLine }
    : null;
}

function parseOldRod(contents: string): FishingSlot {
  const lines = contents.split(/\r?\n/);
  const start = lines.findIndex((line) => /^ItemUseOldRod:\s*$/.test(line));
  const end = lines.findIndex((line, index) => index > start && /^ItemUseGoodRod:\s*$/.test(line));
  if (start < 0 || end < 0) {
    throw new Error("Could not locate the Old Rod item routine.");
  }
  for (let index = start + 1; index < end; index += 1) {
    const match = lines[index].match(/^\s*lb\s+bc\s*,\s*(\d+)\s*,\s*([A-Za-z_][A-Za-z0-9_]*)\b/);
    if (match) {
      return { level: Number(match[1]), speciesConstant: match[2], sourceLine: index };
    }
  }
  throw new Error("Could not locate the Old Rod Pokémon and level.");
}

function parseGoodRod(contents: string): FishingSlot[] {
  const lines = contents.split(/\r?\n/);
  const label = lines.findIndex((line) => /^GoodRodMons:\s*(?:;.*)?$/.test(line));
  if (label < 0) {
    throw new Error("Could not locate GoodRodMons.");
  }
  const slots: FishingSlot[] = [];
  for (let index = label + 1; index < lines.length; index += 1) {
    const slot = parseSlotLine(lines[index], index);
    if (slot) {
      slots.push(slot);
    }
  }
  if (slots.length !== 2) {
    throw new Error(`Expected 2 Good Rod encounters, found ${slots.length}.`);
  }
  return slots;
}

function parseYellowSuperRod(contents: string): SuperRodTable[] {
  const lines = contents.split(/\r?\n/);
  const label = lines.findIndex((line) => /^SuperRodFishingSlots::?\s*(?:;.*)?$/.test(line));
  if (label < 0) {
    throw new Error("Could not locate SuperRodFishingSlots.");
  }

  const tables: SuperRodTable[] = [];
  for (let index = label + 1; index < lines.length; index += 1) {
    if (/^\s*db\s+-1\b/.test(lines[index])) {
      break;
    }
    const code = lines[index].split(";", 1)[0].trim();
    if (!code.startsWith("db ")) {
      continue;
    }
    const fields = code.slice(3).split(",").map((field) => field.trim());
    if (fields.length !== 9 || !/^[A-Z][A-Z0-9_]*$/.test(fields[0])) {
      throw new Error(`Unsupported Yellow Super Rod row: ${lines[index].trim()}`);
    }
    const slots: FishingSlot[] = [];
    for (let slotIndex = 0; slotIndex < 4; slotIndex += 1) {
      const speciesConstant = fields[1 + slotIndex * 2];
      const levelText = fields[2 + slotIndex * 2];
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(speciesConstant) || !/^\d+$/.test(levelText)) {
        throw new Error(`Unsupported Yellow Super Rod slot: ${lines[index].trim()}`);
      }
      slots.push({ speciesConstant, level: Number(levelText), sourceLine: index });
    }
    tables.push({
      id: fields[0],
      displayName: mapConstantDisplayName(fields[0]),
      affectedLocations: [mapConstantDisplayName(fields[0])],
      slots,
    });
  }
  if (tables.length === 0) {
    throw new Error("No Yellow Super Rod tables were found.");
  }
  return tables;
}

function groupDisplayName(group: string): string {
  return group
    .replace(/^\./, "Fishing ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2");
}

function parseRedBlueSuperRod(contents: string): SuperRodTable[] {
  const lines = contents.split(/\r?\n/);
  const label = lines.findIndex((line) => /^SuperRodData:\s*(?:;.*)?$/.test(line));
  if (label < 0) {
    throw new Error("Could not locate SuperRodData.");
  }

  const mapsByGroup = new Map<string, string[]>();
  const groupOrder: string[] = [];
  for (let index = label + 1; index < lines.length; index += 1) {
    if (/^\s*db\s+-1\b/.test(lines[index])) {
      break;
    }
    const match = lines[index].match(
      /^\s*dbw\s+([A-Z][A-Z0-9_]*)\s*,\s*(\.[A-Za-z_][A-Za-z0-9_]*)\b/,
    );
    if (!match) {
      continue;
    }
    if (!mapsByGroup.has(match[2])) {
      mapsByGroup.set(match[2], []);
      groupOrder.push(match[2]);
    }
    mapsByGroup.get(match[2])?.push(mapConstantDisplayName(match[1]));
  }

  return groupOrder.map((group) => {
    const groupLine = lines.findIndex((line) =>
      new RegExp(`^\\s*\\${group}:\\s*(?:;.*)?$`).test(line),
    );
    if (groupLine < 0) {
      throw new Error(`Could not locate Super Rod group ${group}.`);
    }
    let countLine = groupLine + 1;
    while (countLine < lines.length && !lines[countLine].trim()) {
      countLine += 1;
    }
    const countMatch = lines[countLine]?.match(/^\s*db\s+(\d+)\b/);
    if (!countMatch) {
      throw new Error(`Could not read the encounter count for ${group}.`);
    }
    const expectedCount = Number(countMatch[1]);
    const slots: FishingSlot[] = [];
    for (let index = countLine + 1; index < lines.length && slots.length < expectedCount; index += 1) {
      const slot = parseSlotLine(lines[index], index);
      if (slot) {
        slots.push(slot);
      } else if (/^\s*\.[A-Za-z_][A-Za-z0-9_]*:/.test(lines[index])) {
        break;
      }
    }
    if (slots.length !== expectedCount || expectedCount < 1 || expectedCount > 4) {
      throw new Error(`${group} must contain between 1 and 4 encounters.`);
    }
    return {
      id: group,
      displayName: groupDisplayName(group),
      affectedLocations: mapsByGroup.get(group) ?? [],
      slots,
    };
  });
}

async function readFishingSources(source: ProjectSource): Promise<FishingSources> {
  return {
    oldRod: await source.readText(OLD_ROD_PATH),
    goodRod: await source.readText(GOOD_ROD_PATH),
    superRod: await source.readText(SUPER_ROD_PATH),
  };
}

function parseFishingData(contents: FishingSources, projectName: string): FishingData {
  const format = projectName === "pokered" ? "red-blue" : "yellow";
  return {
    format,
    oldRod: parseOldRod(contents.oldRod),
    goodRod: parseGoodRod(contents.goodRod),
    superRodTables: format === "red-blue"
      ? parseRedBlueSuperRod(contents.superRod)
      : parseYellowSuperRod(contents.superRod),
  };
}

export async function loadFishingEditDocument(
  source: ProjectSource,
  projectName: string,
): Promise<FishingEditDocument> {
  const contents = await readFishingSources(source);
  const data = parseFishingData(contents, projectName);
  return {
    ...data,
    sources: await Promise.all([
      [OLD_ROD_PATH, contents.oldRod],
      [GOOD_ROD_PATH, contents.goodRod],
      [SUPER_ROD_PATH, contents.superRod],
    ].map(async ([path, text]) => ({ path, sourceHash: await hashText(text) }))),
  };
}

function validateSlot(slot: FishingSlot, label: string, knownSpecies: Set<string>): void {
  if (!Number.isInteger(slot.level) || slot.level < 1 || slot.level > 100) {
    throw new Error(`${label} level must be an integer from 1 to 100.`);
  }
  if (!knownSpecies.has(slot.speciesConstant)) {
    throw new Error(`${label} uses unknown Pokémon constant '${slot.speciesConstant}'.`);
  }
}

export function validateFishingData(data: FishingData, knownSpecies: Set<string>): void {
  validateSlot(data.oldRod, "Old Rod", knownSpecies);
  if (data.goodRod.length !== 2) {
    throw new Error("Good Rod must contain exactly 2 encounters.");
  }
  data.goodRod.forEach((slot, index) => validateSlot(slot, `Good Rod slot ${index + 1}`, knownSpecies));
  if (data.superRodTables.length === 0) {
    throw new Error("At least one Super Rod table is required.");
  }
  for (const table of data.superRodTables) {
    const expected = data.format === "yellow" ? 4 : table.slots.length;
    if (table.slots.length !== expected || expected < 1 || expected > 4) {
      throw new Error(`${table.displayName} must contain ${data.format === "yellow" ? "exactly 4" : "between 1 and 4"} encounters.`);
    }
    table.slots.forEach((slot, index) =>
      validateSlot(slot, `${table.displayName} slot ${index + 1}`, knownSpecies),
    );
  }
}

function replaceSlotLine(line: string, slot: FishingSlot): string {
  return line.replace(
    /^(\s*db\s+)\d+(\s*,\s*)[A-Za-z_][A-Za-z0-9_]*(.*)$/,
    (_match, prefix: string, separator: string, suffix: string) =>
      `${prefix}${slot.level}${separator}${slot.speciesConstant}${suffix}`,
  );
}

function updateOldRod(contents: string, slot: FishingSlot): string {
  const newline = contents.includes("\r\n") ? "\r\n" : "\n";
  const lines = contents.split(/\r?\n/);
  const original = parseOldRod(contents);
  lines[original.sourceLine] = lines[original.sourceLine].replace(
    /^(\s*lb\s+bc\s*,\s*)\d+(\s*,\s*)[A-Za-z_][A-Za-z0-9_]*(.*)$/,
    (_match, prefix: string, separator: string, suffix: string) =>
      `${prefix}${slot.level}${separator}${slot.speciesConstant}${suffix}`,
  );
  return lines.join(newline);
}

function updateGoodRod(contents: string, slots: FishingSlot[]): string {
  const newline = contents.includes("\r\n") ? "\r\n" : "\n";
  const lines = contents.split(/\r?\n/);
  const original = parseGoodRod(contents);
  original.forEach((slot, index) => {
    lines[slot.sourceLine] = replaceSlotLine(lines[slot.sourceLine], slots[index]);
  });
  return lines.join(newline);
}

function suffixAfterData(line: string): string {
  const commentIndex = line.indexOf(";");
  const code = commentIndex >= 0 ? line.slice(0, commentIndex) : line;
  const whitespace = code.match(/\s*$/)?.[0] ?? "";
  return whitespace + (commentIndex >= 0 ? line.slice(commentIndex) : "");
}

function updateYellowSuperRod(contents: string, tables: SuperRodTable[]): string {
  const newline = contents.includes("\r\n") ? "\r\n" : "\n";
  const lines = contents.split(/\r?\n/);
  const original = parseYellowSuperRod(contents);
  original.forEach((table, index) => {
    const requested = tables[index];
    if (!requested || requested.id !== table.id || requested.slots.length !== 4) {
      throw new Error("Yellow Super Rod table structure changed while it was being edited.");
    }
    const sourceLine = table.slots[0].sourceLine;
    const prefix = lines[sourceLine].match(/^(\s*db\s+)/)?.[1] ?? "\tdb ";
    const fields = requested.slots.flatMap((slot) => [slot.speciesConstant, String(slot.level)]);
    lines[sourceLine] = `${prefix}${table.id}, ${fields.join(", ")}${suffixAfterData(lines[sourceLine])}`;
  });
  return lines.join(newline);
}

function updateRedBlueSuperRod(contents: string, tables: SuperRodTable[]): string {
  const newline = contents.includes("\r\n") ? "\r\n" : "\n";
  const lines = contents.split(/\r?\n/);
  const original = parseRedBlueSuperRod(contents);
  original.forEach((table, tableIndex) => {
    const requested = tables[tableIndex];
    if (!requested || requested.id !== table.id || requested.slots.length !== table.slots.length) {
      throw new Error("Red/Blue Super Rod group structure changed while it was being edited.");
    }
    table.slots.forEach((slot, slotIndex) => {
      lines[slot.sourceLine] = replaceSlotLine(lines[slot.sourceLine], requested.slots[slotIndex]);
    });
  });
  return lines.join(newline);
}

function expectedHash(sources: FishingSourceDocument[], path: string): string {
  const result = sources.find((source) => source.path === path)?.sourceHash;
  if (!result) {
    throw new Error(`Missing source hash for ${path}.`);
  }
  return result;
}

export async function prepareFishingWrites(
  source: ProjectSource,
  projectName: string,
  sources: FishingSourceDocument[],
  data: FishingData,
  knownSpecies: Set<string>,
): Promise<TextWriteRequest[]> {
  validateFishingData(data, knownSpecies);
  const contents = await readFishingSources(source);
  const original = parseFishingData(contents, projectName);
  if (original.format !== data.format || original.superRodTables.length !== data.superRodTables.length) {
    throw new Error("Fishing table structure changed while it was being edited.");
  }
  return [
    {
      path: OLD_ROD_PATH,
      contents: updateOldRod(contents.oldRod, data.oldRod),
      expectedHash: expectedHash(sources, OLD_ROD_PATH),
    },
    {
      path: GOOD_ROD_PATH,
      contents: updateGoodRod(contents.goodRod, data.goodRod),
      expectedHash: expectedHash(sources, GOOD_ROD_PATH),
    },
    {
      path: SUPER_ROD_PATH,
      contents: data.format === "red-blue"
        ? updateRedBlueSuperRod(contents.superRod, data.superRodTables)
        : updateYellowSuperRod(contents.superRod, data.superRodTables),
      expectedHash: expectedHash(sources, SUPER_ROD_PATH),
    },
  ];
}
