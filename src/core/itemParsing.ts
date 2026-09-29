import { parseItemConstantDefinitions } from "./itemConstants";
import type { ItemData, ItemMenuBehavior, ProjectSource } from "./types";

function codeOnly(line: string): string {
  return (line.split(";", 1)[0] || "").trim();
}

function parseItemNames(contents: string): string[] {
  const result: string[] = [];
  let active = false;
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "ItemNames:" || line === "ItemNames::") {
      active = true;
      continue;
    }
    if (!active) continue;
    if (/^assert_list_length[ \t]+NUM_ITEMS\b/.test(codeOnly(rawLine))) break;
    const match = codeOnly(rawLine).match(/^li[ \t]+"([^"]*)"/);
    if (match) result.push(match[1]);
  }
  return result;
}

function parseItemPrices(contents: string): number[] {
  const result: number[] = [];
  let active = false;
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = codeOnly(rawLine);
    if (line === "ItemPrices:" || line === "ItemPrices::") {
      active = true;
      continue;
    }
    if (!active) continue;
    if (/^assert_table_length[ \t]+NUM_ITEMS\b/.test(line)) break;
    const match = line.match(/^bcd3[ \t]+(\d+)/);
    if (match) result.push(Number.parseInt(match[1], 10));
  }
  return result;
}

function parseKeyItemFlags(contents: string): boolean[] {
  const result: boolean[] = [];
  let active = false;
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = codeOnly(rawLine);
    if (line === "KeyItemFlags:" || line === "KeyItemFlags::") {
      active = true;
      continue;
    }
    if (!active) continue;
    if (/^end_bit_array\b/.test(line)) break;
    const match = line.match(/^dbit[ \t]+(TRUE|FALSE)\b/i);
    if (match) result.push(match[1].toUpperCase() === "TRUE");
  }
  return result;
}

function parseItemUseRoutines(contents: string): string[] {
  const result: string[] = [];
  let active = false;
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = codeOnly(rawLine);
    if (line === "ItemUsePtrTable:" || line === "ItemUsePtrTable::") {
      active = true;
      continue;
    }
    if (!active) continue;
    const match = line.match(/^dw[ \t]+([A-Za-z0-9_.]+)/);
    if (match) {
      result.push(match[1]);
      continue;
    }
    if (result.length > 0 && line) break;
  }
  return result;
}

function parseConstantList(contents: string, label: string): Set<string> {
  const result = new Set<string>();
  let active = false;
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = codeOnly(rawLine);
    if (line === label + ":" || line === label + "::") {
      active = true;
      continue;
    }
    if (!active) continue;
    if (line === "db -1") break;
    const match = line.match(/^db[ \t]+([A-Za-z0-9_]+)/);
    if (match) result.add(match[1]);
  }
  return result;
}

function parseTmPrices(contents: string): number[] {
  const result: number[] = [];
  let active = false;
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = codeOnly(rawLine);
    if (line === "TechnicalMachinePrices:" || line === "TechnicalMachinePrices::") {
      active = true;
      continue;
    }
    if (!active) continue;
    if (/^end_nybble_array\b/.test(line)) break;
    const match = line.match(/^nybble[ \t]+(\d+)/);
    if (match) result.push(Number.parseInt(match[1], 10) * 1000);
  }
  return result;
}

function menuBehavior(
  constant: string,
  routine: string | null,
  partyItems: Set<string>,
  overworldItems: Set<string>,
  machine: boolean,
): ItemMenuBehavior {
  if (machine) return "tmhm";
  if (routine === "UnusableItem") return "unusable";
  if (partyItems.has(constant)) return "party";
  if (overworldItems.has(constant)) return "overworld";
  return "direct";
}

export async function parseItems(source: ProjectSource): Promise<ItemData[]> {
  const [
    constantsContents,
    namesContents,
    pricesContents,
    keyItemsContents,
    effectsContents,
    partyContents,
    overworldContents,
    tmPricesContents,
  ] = await Promise.all([
    source.readText("constants/item_constants.asm"),
    source.readText("data/items/names.asm"),
    source.readText("data/items/prices.asm"),
    source.readText("data/items/key_items.asm"),
    source.readText("engine/items/item_effects.asm"),
    source.readText("data/items/use_party.asm"),
    source.readText("data/items/use_overworld.asm"),
    source.readText("data/items/tm_prices.asm"),
  ]);

  const definitions = parseItemConstantDefinitions(constantsContents);
  const regularDefinitions = definitions.filter((item) => item.machineKind === null);
  const regularIndex = new Map(regularDefinitions.map((item, index) => [item.id, index]));
  const names = parseItemNames(namesContents);
  const prices = parseItemPrices(pricesContents);
  const keyFlags = parseKeyItemFlags(keyItemsContents);
  const routines = parseItemUseRoutines(effectsContents);
  const partyItems = parseConstantList(partyContents, "UsableItems_PartyMenu");
  const overworldItems = parseConstantList(overworldContents, "UsableItems_CloseMenu");
  const tmPrices = parseTmPrices(tmPricesContents);

  return definitions.map((definition): ItemData => {
    const regularPosition = regularIndex.get(definition.id);
    const machine = definition.machineKind !== null;
    const machineNumber = definition.machineNumber;
    const machineName = definition.machineKind && machineNumber
      ? definition.machineKind.toUpperCase() + String(machineNumber).padStart(2, "0")
      : null;

    const keyItem = definition.machineKind === "hm"
      ? true
      : regularPosition !== undefined
        ? (keyFlags[regularPosition] ?? false)
        : false;

    const useRoutine = machine
      ? "ItemUseTMHM"
      : regularPosition !== undefined
        ? (routines[regularPosition] ?? null)
        : null;

    const kind = definition.machineKind
      ?? (definition.constant.startsWith("ITEM_")
        ? "unused"
        : keyItem
          ? "key-item"
          : "item");

    return {
      id: definition.id,
      constant: definition.constant,
      name: machineName
        ?? (regularPosition !== undefined ? (names[regularPosition] ?? definition.constant) : definition.constant),
      kind,
      price: definition.machineKind === "tm" && machineNumber
        ? (tmPrices[machineNumber - 1] ?? null)
        : definition.machineKind === "hm"
          ? null
          : regularPosition !== undefined
            ? (prices[regularPosition] ?? null)
            : null,
      keyItem,
      useRoutine,
      menuBehavior: menuBehavior(
        definition.constant,
        useRoutine,
        partyItems,
        overworldItems,
        machine,
      ),
      machineNumber,
      moveConstant: definition.moveConstant,
    };
  });
}
