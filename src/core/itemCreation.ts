import { hashText } from "./history";
import { parseItemConstantDefinitions } from "./itemConstants";
import type {
  ItemCreateDocument,
  ItemCreateSlot,
  ItemCreateTemplate,
  ItemCreateValues,
  ProjectSource,
  TextWriteRequest,
} from "./types";

const ITEM_CONSTANTS_PATH = "constants/item_constants.asm";
const ITEM_NAMES_PATH = "data/items/names.asm";
const ITEM_PRICES_PATH = "data/items/prices.asm";
const KEY_ITEMS_PATH = "data/items/key_items.asm";
const ITEM_EFFECTS_PATH = "engine/items/item_effects.asm";
const PARTY_USE_PATH = "data/items/use_party.asm";
const OVERWORLD_USE_PATH = "data/items/use_overworld.asm";
const TEXT_CONSTANTS_PATH = "constants/text_constants.asm";

const SOURCE_PATHS = [
  ITEM_CONSTANTS_PATH,
  ITEM_NAMES_PATH,
  ITEM_PRICES_PATH,
  KEY_ITEMS_PATH,
  ITEM_EFFECTS_PATH,
  PARTY_USE_PATH,
  OVERWORLD_USE_PATH,
  TEXT_CONSTANTS_PATH,
] as const;

interface TemplateDefinition {
  routine: string;
  partyMenu: boolean;
  closeMenu: boolean;
}

const TEMPLATES: Record<ItemCreateTemplate, TemplateDefinition> = {
  unusable: {
    routine: "UnusableItem",
    partyMenu: false,
    closeMenu: false,
  },
  evolution: {
    routine: "ItemUseEvoStone",
    partyMenu: true,
    closeMenu: false,
  },
  repel: {
    routine: "ItemUseRepel",
    partyMenu: false,
    closeMenu: false,
  },
  "super-repel": {
    routine: "ItemUseSuperRepel",
    partyMenu: false,
    closeMenu: false,
  },
  "max-repel": {
    routine: "ItemUseMaxRepel",
    partyMenu: false,
    closeMenu: false,
  },
  "x-accuracy": {
    routine: "ItemUseXAccuracy",
    partyMenu: false,
    closeMenu: false,
  },
  "guard-spec": {
    routine: "ItemUseGuardSpec",
    partyMenu: false,
    closeMenu: false,
  },
  "dire-hit": {
    routine: "ItemUseDireHit",
    partyMenu: false,
    closeMenu: false,
  },
  "escape-rope": {
    routine: "ItemUseEscapeRope",
    partyMenu: false,
    closeMenu: true,
  },
  bicycle: {
    routine: "ItemUseBicycle",
    partyMenu: false,
    closeMenu: false,
  },
  "poke-doll": {
    routine: "ItemUsePokeDoll",
    partyMenu: false,
    closeMenu: false,
  },
};

function codeOnly(line: string): string {
  return (line.split(";", 1)[0] || "").trim();
}

function maxItemNameLength(contents: string): number {
  const match = contents.match(/^\s*DEF\s+ITEM_NAME_LENGTH\s+EQU\s+(\d+)\b/m);
  return Math.max(1, (match ? Number.parseInt(match[1], 10) : 13) - 1);
}

function tableRow(
  contents: string,
  label: string,
  endPattern: RegExp,
  rowPattern: RegExp,
  rowIndex: number,
): {
  lines: string[];
  newline: string;
  lineIndex: number;
  match: RegExpMatchArray;
} {
  const newline = contents.includes("\r\n") ? "\r\n" : "\n";
  const lines = contents.split(/\r?\n/);
  let active = false;
  let current = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const clean = codeOnly(lines[lineIndex]);
    if (clean === label + ":" || clean === label + "::") {
      active = true;
      continue;
    }
    if (!active) continue;
    if (endPattern.test(clean)) break;

    const match = lines[lineIndex].match(rowPattern);
    if (!match) continue;
    if (current === rowIndex) {
      return { lines, newline, lineIndex, match };
    }
    current += 1;
  }

  throw new Error(`Could not locate row ${rowIndex + 1} in ${label}.`);
}

function readName(contents: string, index: number): string {
  return tableRow(
    contents,
    "ItemNames",
    /^assert_list_length\s+NUM_ITEMS\b/,
    /^(\s*li\s+)"([^"]*)"(.*)$/,
    index,
  ).match[2];
}

function readUseRoutines(contents: string): string[] {
  const result: string[] = [];
  let active = false;
  for (const rawLine of contents.split(/\r?\n/)) {
    const clean = codeOnly(rawLine);
    if (clean === "ItemUsePtrTable:" || clean === "ItemUsePtrTable::") {
      active = true;
      continue;
    }
    if (!active) continue;
    const match = clean.match(/^dw\s+([A-Za-z0-9_.]+)/);
    if (match) {
      result.push(match[1]);
      continue;
    }
    if (result.length > 0 && clean) break;
  }
  return result;
}

function constantList(contents: string, label: string): Set<string> {
  const result = new Set<string>();
  let active = false;
  for (const rawLine of contents.split(/\r?\n/)) {
    const clean = codeOnly(rawLine);
    if (clean === label + ":" || clean === label + "::") {
      active = true;
      continue;
    }
    if (!active) continue;
    if (clean === "db -1") break;
    const match = clean.match(/^db\s+([A-Za-z0-9_]+)/);
    if (match) result.add(match[1]);
  }
  return result;
}

function regularDefinitions(constants: string) {
  return parseItemConstantDefinitions(constants)
    .filter((definition) => definition.machineKind === null);
}

function unusedSlots(
  constants: string,
  names: string,
  effects: string,
  partyUse: string,
  overworldUse: string,
): ItemCreateSlot[] {
  const definitions = regularDefinitions(constants);
  const routines = readUseRoutines(effects);
  const party = constantList(partyUse, "UsableItems_PartyMenu");
  const overworld = constantList(overworldUse, "UsableItems_CloseMenu");

  return definitions.flatMap((definition, index) => {
    if (
      !/^ITEM_[0-9A-F]{2}$/i.test(definition.constant)
      || routines[index] !== "UnusableItem"
      || party.has(definition.constant)
      || overworld.has(definition.constant)
    ) {
      return [];
    }
    return [{
      id: definition.id,
      constant: definition.constant,
      displayName: readName(names, index),
    }];
  });
}

function guardHash(document: ItemCreateDocument, path: string): string {
  const source = document.sources.find((entry) => entry.path === path);
  if (!source) throw new Error(`Missing add-item source guard for ${path}.`);
  return source.sourceHash;
}

function rewriteConstant(
  contents: string,
  oldConstant: string,
  newConstant: string,
  itemId: number,
): string {
  const newline = contents.includes("\r\n") ? "\r\n" : "\n";
  const lines = contents.split(/\r?\n/);
  const pattern = new RegExp(`^(\\s*const\\s+)${oldConstant}\\b.*$`);
  const index = lines.findIndex((line) => pattern.test(line));
  if (index < 0) {
    throw new Error(`Could not locate unused item constant ${oldConstant}.`);
  }

  const prefix = lines[index].match(/^\s*/)?.[0] ?? "";
  lines[index] = `${prefix}const ${newConstant} ; $${itemId
    .toString(16)
    .toUpperCase()
    .padStart(2, "0")} ; Yellow Editor custom item`;
  lines.splice(
    index + 1,
    0,
    `DEF ${oldConstant} EQU ${newConstant} ; Yellow Editor unused-slot compatibility alias`,
  );
  return lines.join(newline);
}

function rewriteName(
  contents: string,
  rowIndex: number,
  name: string,
  constant: string,
): string {
  const row = tableRow(
    contents,
    "ItemNames",
    /^assert_list_length\s+NUM_ITEMS\b/,
    /^(\s*li\s+)"([^"]*)"(.*)$/,
    rowIndex,
  );
  row.lines[row.lineIndex] = `${row.match[1]}"${name}" ; ${constant}`;
  return row.lines.join(row.newline);
}

function rewritePrice(
  contents: string,
  rowIndex: number,
  price: number,
  constant: string,
): string {
  const row = tableRow(
    contents,
    "ItemPrices",
    /^assert_table_length\s+NUM_ITEMS\b/,
    /^(\s*bcd3\s+)(\d+)(.*)$/,
    rowIndex,
  );
  row.lines[row.lineIndex] = `${row.match[1]}${price} ; ${constant}`;
  return row.lines.join(row.newline);
}

function rewriteKeyFlag(
  contents: string,
  rowIndex: number,
  keyItem: boolean,
  constant: string,
): string {
  const row = tableRow(
    contents,
    "KeyItemFlags",
    /^end_bit_array\b/,
    /^(\s*dbit\s+)(TRUE|FALSE)(.*)$/i,
    rowIndex,
  );
  row.lines[row.lineIndex] =
    `${row.match[1]}${keyItem ? "TRUE" : "FALSE"} ; ${constant}`;
  return row.lines.join(row.newline);
}

function rewriteRoutine(
  contents: string,
  rowIndex: number,
  routine: string,
  constant: string,
): string {
  const row = tableRow(
    contents,
    "ItemUsePtrTable",
    /^ItemUseBall:?$/,
    /^(\s*dw\s+)([A-Za-z0-9_.]+)(.*)$/,
    rowIndex,
  );
  row.lines[row.lineIndex] = `${row.match[1]}${routine} ; ${constant}`;
  return row.lines.join(row.newline);
}

function rewriteConstantList(
  contents: string,
  label: string,
  oldConstant: string,
  newConstant: string,
  enabled: boolean,
): string {
  const newline = contents.includes("\r\n") ? "\r\n" : "\n";
  const lines = contents.split(/\r?\n/);
  const labelIndex = lines.findIndex((line) => {
    const clean = codeOnly(line);
    return clean === label + ":" || clean === label + "::";
  });
  if (labelIndex < 0) throw new Error(`Could not locate ${label}.`);

  let endIndex = -1;
  const kept: string[] = [];
  for (let index = labelIndex + 1; index < lines.length; index += 1) {
    const clean = codeOnly(lines[index]);
    if (clean === "db -1") {
      endIndex = index;
      break;
    }
    if (
      clean === `db ${oldConstant}`
      || clean === `db ${newConstant}`
    ) {
      continue;
    }
    kept.push(lines[index]);
  }
  if (endIndex < 0) throw new Error(`Could not locate the end of ${label}.`);

  if (enabled) kept.push(`\tdb ${newConstant}`);
  lines.splice(
    labelIndex + 1,
    endIndex - labelIndex - 1,
    ...kept,
  );
  return lines.join(newline);
}

function validateConstant(value: string): string {
  const constant = value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*$/.test(constant)) {
    throw new Error(
      "Item constant must start with A-Z and contain only A-Z, 0-9, and underscores.",
    );
  }
  return constant;
}

function validateValues(
  document: ItemCreateDocument,
  values: ItemCreateValues,
  constants: string,
): {
  slot: ItemCreateSlot;
  constant: string;
  name: string;
  template: TemplateDefinition;
} {
  const slot = document.slots.find((entry) => entry.id === values.slotId);
  if (!slot) {
    throw new Error("Choose one of the currently available unused item slots.");
  }

  const constant = validateConstant(values.constant);
  const name = values.name.trim();
  if (!name || name.length > document.maxNameLength || /["@\r\n]/.test(name)) {
    throw new Error(
      `Item name must be 1-${document.maxNameLength} characters and cannot contain ", @, or line breaks.`,
    );
  }
  if (!Number.isInteger(values.price) || values.price < 0 || values.price > 999999) {
    throw new Error("Item price must be a whole number from 0 to 999999.");
  }

  const template = TEMPLATES[values.template];
  if (!template) throw new Error("Choose a supported item behavior template.");

  const symbolPattern = new RegExp(
    `^\\s*(?:const|DEF)\\s+${constant}\\b`,
    "m",
  );
  if (constant !== slot.constant && symbolPattern.test(constants)) {
    throw new Error(`The assembly symbol ${constant} already exists.`);
  }
  if (/^(?:NO_ITEM|HM\d\d|TM\d\d)$/i.test(constant)) {
    throw new Error("That constant name is reserved for the item system.");
  }

  return { slot, constant, name, template };
}

async function readSources(source: ProjectSource): Promise<Map<string, string>> {
  return new Map(
    await Promise.all(
      SOURCE_PATHS.map(async (path) => [path, await source.readText(path)] as const),
    ),
  );
}

export async function loadItemCreateDocument(
  source: ProjectSource,
): Promise<ItemCreateDocument> {
  const byPath = await readSources(source);
  const constants = byPath.get(ITEM_CONSTANTS_PATH)!;
  const names = byPath.get(ITEM_NAMES_PATH)!;
  const effects = byPath.get(ITEM_EFFECTS_PATH)!;
  const partyUse = byPath.get(PARTY_USE_PATH)!;
  const overworldUse = byPath.get(OVERWORLD_USE_PATH)!;

  return {
    slots: unusedSlots(constants, names, effects, partyUse, overworldUse),
    maxNameLength: maxItemNameLength(byPath.get(TEXT_CONSTANTS_PATH)!),
    sources: SOURCE_PATHS.map((path) => ({
      path,
      sourceHash: hashText(byPath.get(path)!),
    })),
  };
}

export async function prepareItemCreateWrites(
  source: ProjectSource,
  document: ItemCreateDocument,
  values: ItemCreateValues,
): Promise<TextWriteRequest[]> {
  const fresh = await loadItemCreateDocument(source);
  for (const guard of document.sources) {
    const current = fresh.sources.find((entry) => entry.path === guard.path);
    if (!current || current.sourceHash !== guard.sourceHash) {
      throw new Error(
        `${guard.path} changed since the Add Item wizard opened. Reopen the wizard and try again.`,
      );
    }
  }

  const byPath = await readSources(source);
  const constants = byPath.get(ITEM_CONSTANTS_PATH)!;
  const { slot, constant, name, template } = validateValues(
    document,
    values,
    constants,
  );

  const definitions = regularDefinitions(constants);
  const rowIndex = definitions.findIndex((entry) => entry.id === slot.id);
  if (rowIndex < 0 || definitions[rowIndex].constant !== slot.constant) {
    throw new Error("The selected unused item slot changed. Reopen the wizard.");
  }

  const after = new Map<string, string>(byPath);
  after.set(
    ITEM_CONSTANTS_PATH,
    rewriteConstant(constants, slot.constant, constant, slot.id),
  );
  after.set(
    ITEM_NAMES_PATH,
    rewriteName(byPath.get(ITEM_NAMES_PATH)!, rowIndex, name, constant),
  );
  after.set(
    ITEM_PRICES_PATH,
    rewritePrice(
      byPath.get(ITEM_PRICES_PATH)!,
      rowIndex,
      values.price,
      constant,
    ),
  );
  after.set(
    KEY_ITEMS_PATH,
    rewriteKeyFlag(
      byPath.get(KEY_ITEMS_PATH)!,
      rowIndex,
      values.keyItem,
      constant,
    ),
  );
  after.set(
    ITEM_EFFECTS_PATH,
    rewriteRoutine(
      byPath.get(ITEM_EFFECTS_PATH)!,
      rowIndex,
      template.routine,
      constant,
    ),
  );
  after.set(
    PARTY_USE_PATH,
    rewriteConstantList(
      byPath.get(PARTY_USE_PATH)!,
      "UsableItems_PartyMenu",
      slot.constant,
      constant,
      template.partyMenu,
    ),
  );
  after.set(
    OVERWORLD_USE_PATH,
    rewriteConstantList(
      byPath.get(OVERWORLD_USE_PATH)!,
      "UsableItems_CloseMenu",
      slot.constant,
      constant,
      template.closeMenu,
    ),
  );

  return SOURCE_PATHS.flatMap((path) => {
    const beforeContents = byPath.get(path)!;
    const contents = after.get(path)!;
    if (contents === beforeContents) return [];
    return [{
      path,
      contents,
      expectedHash: guardHash(document, path),
    }];
  });
}
