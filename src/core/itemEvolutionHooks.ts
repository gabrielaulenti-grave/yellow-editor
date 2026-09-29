import { parseItemConstantDefinitions } from "./itemConstants";

export const ITEM_EFFECTS_PATH = "engine/items/item_effects.asm";

const SUPPORT_MARKER = "; Yellow Editor extended evolution: medicine item hooks";
const TABLE_LABEL = "YellowEditorMedicineEvolutionItems:";

export function ordinaryItemRoutines(
  itemConstants: string,
  itemEffects: string,
): Map<string, string> {
  const definitions = parseItemConstantDefinitions(itemConstants)
    .filter((item) => item.machineKind === null);
  const routines: string[] = [];
  let active = false;

  for (const rawLine of itemEffects.split(/\r?\n/)) {
    const line = (rawLine.split(";", 1)[0] || "").trim();
    if (line === "ItemUsePtrTable:" || line === "ItemUsePtrTable::") {
      active = true;
      continue;
    }
    if (!active) continue;
    const match = line.match(/^dw\s+([A-Za-z0-9_.]+)/);
    if (match) {
      routines.push(match[1]);
      continue;
    }
    if (routines.length && line) break;
  }

  if (routines.length < definitions.length) {
    throw new Error("ItemUsePtrTable is shorter than the ordinary item table.");
  }

  return new Map(
    definitions.map((definition, index) => [
      definition.constant,
      routines[index],
    ]),
  );
}

export function supportedItemEvolutionConstants(
  itemConstants: string,
  itemEffects: string,
): string[] {
  const routines = ordinaryItemRoutines(itemConstants, itemEffects);
  return [...routines.entries()].flatMap(([constant, routine]) =>
    routine === "ItemUseEvoStone" || routine === "ItemUseMedicine"
      ? [constant]
      : [],
  );
}

export function nativeEvolutionItemConstants(
  itemConstants: string,
  itemEffects: string,
): string[] {
  const routines = ordinaryItemRoutines(itemConstants, itemEffects);
  return [...routines.entries()].flatMap(([constant, routine]) =>
    routine === "ItemUseEvoStone" ? [constant] : [],
  );
}

export function medicineEvolutionItemConstants(
  itemConstants: string,
  itemEffects: string,
): string[] {
  const routines = ordinaryItemRoutines(itemConstants, itemEffects);
  return [...routines.entries()].flatMap(([constant, routine]) =>
    routine === "ItemUseMedicine" ? [constant] : [],
  );
}

export function itemEvolutionReferences(contents: string): string[] {
  const result: string[] = [];
  const pattern = /^\s*db\s+EVOLVE_ITEM,\s*([A-Z0-9_]+)\s*,/gim;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(contents)) !== null) result.push(match[1]);
  return result;
}

function installMedicineHookSupport(contents: string): string {
  if (contents.includes(SUPPORT_MARKER)) return contents;

  const insertionPoint = contents.indexOf("ItemUseVitamin:");
  if (insertionPoint < 0) {
    throw new Error("Could not locate ItemUseVitamin for medicine evolution support.");
  }

  const helper = [
    SUPPORT_MARKER,
    TABLE_LABEL,
    "\tdb 0",
    "",
    "YellowEditorMedicineCanEvolve:",
    "\tld a, [wIsInBattle]",
    "\tand a",
    "\tret nz ; custom item evolutions only occur outside battle",
    "\tld a, [wCurItem]",
    "\tld b, a",
    "\tld hl, YellowEditorMedicineEvolutionItems",
    ".itemLoop",
    "\tld a, [hli]",
    "\tand a",
    "\tret z",
    "\tcp b",
    "\tjr nz, .itemLoop",
    "; Load the selected party Pokémon and copy its evolution records.",
    "\txor a ; PLAYER_PARTY_DATA",
    "\tld [wMonDataLocation], a",
    "\tcall LoadMonData",
    "\tld hl, EvosMovesPointerTable",
    "\tld a, [wLoadedMonSpecies]",
    "\tdec a",
    "\tld c, a",
    "\tld b, 0",
    "\tadd hl, bc",
    "\tadd hl, bc",
    "\tld de, wEvoDataBuffer",
    "\tld a, BANK(TryEvolvingMon)",
    "\tld bc, 2",
    "\tcall FarCopyData",
    "\tld hl, wEvoDataBuffer",
    "\tld a, [hli]",
    "\tld h, [hl]",
    "\tld l, a",
    "\tld de, wEvoDataBuffer",
    "\tld a, BANK(TryEvolvingMon)",
    "\tld bc, NUM_EVOS_IN_BUFFER * 4 + 1",
    "\tcall FarCopyData",
    "\tld hl, wEvoDataBuffer",
    ".evolutionLoop",
    "\tld a, [hli]",
    "\tand a",
    "\tret z",
    "\tcp EVOLVE_ITEM",
    "\tjr z, .checkItemEvolution",
    "IF DEF(EVOLVE_MOVE)",
    "\tcp EVOLVE_MOVE",
    "\tjr z, .skipFourByteEvolution",
    "ENDC",
    "\tinc hl ; level/trade requirement",
    "\tinc hl ; target",
    "\tjr .evolutionLoop",
    ".skipFourByteEvolution",
    "\tinc hl ; move",
    "\tinc hl ; minimum level",
    "\tinc hl ; target",
    "\tjr .evolutionLoop",
    ".checkItemEvolution",
    "\tld a, [hli] ; required item",
    "\tld b, a",
    "\tld a, [wCurItem]",
    "\tcp b",
    "\tjr nz, .skipItemEvolution",
    "\tld a, [hli] ; minimum level",
    "\tld c, a",
    "\tld a, [wLoadedMonLevel]",
    "\tcp c",
    "\tjr c, .skipItemTarget",
    "\tscf",
    "\tret",
    ".skipItemTarget",
    "\tinc hl ; target",
    "\tjr .evolutionLoop",
    ".skipItemEvolution",
    "\tinc hl ; minimum level",
    "\tinc hl ; target",
    "\tjr .evolutionLoop",
    "",
    "YellowEditorMedicineForceEvolution:",
    "\tld a, TRUE",
    "\tld [wForceEvolution], a",
    "\tcallfar TryEvolvingMon",
    "\tret",
    "",
    "YellowEditorMedicineTryEvolution:",
    "\tld a, [wWhichPokemon]",
    "\tpush af",
    "\tld a, [wUsedItemOnWhichPokemon]",
    "\tld [wWhichPokemon], a",
    "\tcall YellowEditorMedicineCanEvolve",
    "\tjr nc, .restoreSelection",
    "\tcall YellowEditorMedicineForceEvolution",
    ".restoreSelection",
    "\tpop af",
    "\tld [wWhichPokemon], a",
    "\tret",
    "",
  ].join("\n");

  let next = contents.slice(0, insertionPoint) + helper + contents.slice(insertionPoint);

  const noEffectPattern =
    /\.healingItemNoEffect\r?\n\tcall ItemUseNoEffect\r?\n\tjp \.done/;
  if (!noEffectPattern.test(next)) {
    throw new Error(
      "Could not install medicine item evolutions because ItemUseMedicine's no-effect path is unsupported.",
    );
  }
  next = next.replace(
    noEffectPattern,
    [
      ".healingItemNoEffect",
      "\tld a, [wWhichPokemon]",
      "\tpush af",
      "\tld a, [wUsedItemOnWhichPokemon]",
      "\tld [wWhichPokemon], a",
      "\tcall YellowEditorMedicineCanEvolve",
      "\tjr nc, .healingItemReallyNoEffect",
      "\tcall RemoveUsedItem",
      "\tcall YellowEditorMedicineForceEvolution",
      "\tpop af",
      "\tld [wWhichPokemon], a",
      "\tjp .done",
      ".healingItemReallyNoEffect",
      "\tpop af",
      "\tld [wWhichPokemon], a",
      "\tcall ItemUseNoEffect",
      "\tjp .done",
    ].join("\n"),
  );

  const successPattern =
    /(\.showHealingItemMessage[\s\S]*?\tcall WaitForTextScrollButtonPress\r?\n)(\tjr \.done)/;
  if (!successPattern.test(next)) {
    throw new Error(
      "Could not install medicine item evolutions because ItemUseMedicine's success path is unsupported.",
    );
  }
  next = next.replace(
    successPattern,
    "$1\tcall YellowEditorMedicineTryEvolution\n$2",
  );

  return next;
}

function rewriteManagedTable(contents: string, constants: string[]): string {
  const markerIndex = contents.indexOf(SUPPORT_MARKER);
  const tableIndex = contents.indexOf(TABLE_LABEL, markerIndex);
  if (markerIndex < 0 || tableIndex < 0) {
    throw new Error("Medicine evolution hook table is missing.");
  }

  const afterLabel = tableIndex + TABLE_LABEL.length;
  const rest = contents.slice(afterLabel);
  const terminator = /^\s*db\s+0\s*$/m.exec(rest);
  if (!terminator || terminator.index === undefined) {
    throw new Error("Medicine evolution hook table terminator is missing.");
  }
  const end = afterLabel + terminator.index + terminator[0].length;
  const newline = contents.includes("\r\n") ? "\r\n" : "\n";
  const body = [
    TABLE_LABEL,
    ...constants.map((constant) => "\tdb " + constant),
    "\tdb 0",
  ].join(newline);

  return contents.slice(0, tableIndex) + body + contents.slice(end);
}

export function configuredMedicineEvolutionItems(itemEffects: string): string[] {
  const tableIndex = itemEffects.indexOf(TABLE_LABEL);
  if (tableIndex < 0) return [];
  const rest = itemEffects.slice(tableIndex + TABLE_LABEL.length);
  const result: string[] = [];
  for (const rawLine of rest.split(/\r?\n/)) {
    const line = (rawLine.split(";", 1)[0] || "").trim();
    const match = line.match(/^db\s+([A-Z0-9_]+)$/);
    if (!match) continue;
    if (match[1] === "0") break;
    result.push(match[1]);
  }
  return result;
}

export function syncMedicineEvolutionHooks(
  evosContents: string,
  itemConstants: string,
  itemEffects: string,
): string {
  const medicine = new Set(
    medicineEvolutionItemConstants(itemConstants, itemEffects),
  );
  const needed = [...new Set(itemEvolutionReferences(evosContents))]
    .filter((constant) => medicine.has(constant))
    .sort();

  if (needed.length === 0 && !itemEffects.includes(SUPPORT_MARKER)) {
    return itemEffects;
  }

  const installed = installMedicineHookSupport(itemEffects);
  return rewriteManagedTable(installed, needed);
}
