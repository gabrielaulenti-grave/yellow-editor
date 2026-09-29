import { hashText } from "./history";
import { parseDeepItemRoutine, rewriteDeepItemRoutine } from "./deepItemRoutines";
import { parseItemConstantDefinitions } from "./itemConstants";
import type {
  BallRoutineParameters,
  ItemEditDocument,
  ItemEditValues,
  ItemRoutineParameters,
  ProjectSource,
  TextWriteRequest,
} from "./types";

const ITEM_CONSTANTS_PATH = "constants/item_constants.asm";
const ITEM_NAMES_PATH = "data/items/names.asm";
const ITEM_PRICES_PATH = "data/items/prices.asm";
const KEY_ITEMS_PATH = "data/items/key_items.asm";
const ITEM_EFFECTS_PATH = "engine/items/item_effects.asm";
const TEXT_CONSTANTS_PATH = "constants/text_constants.asm";
const OVERWORLD_PATH = "home/overworld.asm";

const FIXED_HEALS: Record<string, string> = {
  POTION: "Potion",
  SUPER_POTION: "Super Potion",
  HYPER_POTION: "Hyper Potion",
  FRESH_WATER: "Fresh Water",
  SODA_POP: "Soda Pop",
  LEMONADE: "Lemonade",
};

function codeOnly(line: string): string {
  return (line.split(";", 1)[0] || "").trim();
}

function regularItem(constants: string, itemId: number): { index: number; constant: string } {
  const rows = parseItemConstantDefinitions(constants).filter((row) => row.machineKind === null);
  const index = rows.findIndex((row) => row.id === itemId);
  if (index < 0) throw new Error("Only ordinary item-table entries can be edited here.");
  return { index, constant: rows[index].constant };
}

function tableRow(
  contents: string,
  label: string,
  endPattern: RegExp,
  rowPattern: RegExp,
  rowIndex: number,
): { lines: string[]; newline: string; lineIndex: number; match: RegExpMatchArray } {
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
    if (current === rowIndex) return { lines, newline, lineIndex, match };
    current += 1;
  }
  throw new Error(`Could not locate row ${rowIndex + 1} in ${label}.`);
}

function readName(contents: string, index: number): string {
  return tableRow(
    contents, "ItemNames", /^assert_list_length\s+NUM_ITEMS\b/,
    /^(\s*li\s+)"([^"]*)"(.*)$/, index,
  ).match[2];
}

function readPrice(contents: string, index: number): number {
  return Number.parseInt(tableRow(
    contents, "ItemPrices", /^assert_table_length\s+NUM_ITEMS\b/,
    /^(\s*bcd3\s+)(\d+)(.*)$/, index,
  ).match[2], 10);
}

function readKeyItem(contents: string, index: number): boolean {
  return tableRow(
    contents, "KeyItemFlags", /^end_bit_array\b/,
    /^(\s*dbit\s+)(TRUE|FALSE)(.*)$/i, index,
  ).match[2].toUpperCase() === "TRUE";
}

function readUseRoutine(contents: string, index: number): string | null {
  const lines = contents.split(/\r?\n/);
  let active = false;
  let current = 0;
  for (const rawLine of lines) {
    const clean = codeOnly(rawLine);
    if (clean === "ItemUsePtrTable:" || clean === "ItemUsePtrTable::") {
      active = true;
      continue;
    }
    if (!active) continue;
    const match = rawLine.match(/^\s*dw\s+([A-Za-z0-9_.]+)/);
    if (!match) {
      if (current > 0 && clean) break;
      continue;
    }
    if (current === index) return match[1];
    current += 1;
  }
  return null;
}

function maxItemNameLength(contents: string): number {
  const match = contents.match(/^\s*DEF\s+ITEM_NAME_LENGTH\s+EQU\s+(\d+)\b/m);
  return Math.max(1, (match ? Number.parseInt(match[1], 10) : 13) - 1);
}

function nextCodeLine(lines: string[], start: number, pattern: RegExp, label: string): number {
  for (let index = start; index < lines.length; index += 1) {
    if (pattern.test(codeOnly(lines[index]))) return index;
  }
  throw new Error(`Could not locate ${label} in ItemUseBall.`);
}

function operand(line: string, register: "a" | "b" | "c"): number {
  const match = codeOnly(line).match(new RegExp(`^ld ${register},\\s*(\\d+)\\b`, "i"));
  if (!match) throw new Error(`Expected numeric ld ${register} operand.`);
  return Number.parseInt(match[1], 10);
}

function compareOperand(line: string): number {
  const match = codeOnly(line).match(/^cp\s+(\d+)\b/i);
  if (!match) throw new Error("Expected numeric cp operand.");
  return Number.parseInt(match[1], 10);
}

function currentHpDivisor(lines: string[]): number {
  const start = lines.findIndex((line) =>
    line.includes("Divide the enemy's current HP by"));
  if (start < 0) throw new Error("Could not locate the current-HP scaling block.");

  let shiftPairs = 0;
  for (let index = start + 1; index < lines.length; index += 1) {
    const clean = codeOnly(lines[index]);
    if (clean === ".skip2") break;
    if (clean === "srl b") {
      const next = codeOnly(lines[index + 1] ?? "");
      if (next === "rr a") {
        shiftPairs += 1;
        index += 1;
      }
    }
  }

  if (shiftPairs < 1 || shiftPairs > 7) {
    throw new Error("Unsupported current-HP divisor structure.");
  }
  return 2 ** shiftPairs;
}

function ballLocations(contents: string) {
  const lines = contents.split(/\r?\n/);
  const greatComment = lines.findIndex((line) =>
    line.includes("Great/Ultra/Safari Ball and Rand1 is greater than"));
  const ultraComment = lines.findIndex((line) =>
    line.includes("If it's an Ultra/Safari Ball and Rand1 is greater than"));
  const catchStatusComment = lines.findIndex((line) =>
    line.includes("no status ailment:") && line.includes("Status = 0"));
  const factorComment = lines.findIndex((line) => line.includes("Determine BallFactor."));
  const factor2Comment = lines.findIndex((line) => line.includes("Determine BallFactor2."));
  const shakeStatusComment = lines.findIndex((line) =>
    line.includes("no status ailment:") && line.includes("Status2 = 0"));
  const shakeThresholdComment = lines.findIndex((line) =>
    line.includes("Finally determine the number of shakes."));

  if (
    [
      greatComment,
      ultraComment,
      catchStatusComment,
      factorComment,
      factor2Comment,
      shakeStatusComment,
      shakeThresholdComment,
    ].some((value) => value < 0)
  ) {
    throw new Error("Unsupported ItemUseBall routine structure.");
  }

  const greatRandom = nextCodeLine(
    lines,
    greatComment + 1,
    /^ld a,\s*\d+\b/i,
    "Great/Ultra/Safari first-roll ceiling",
  );
  const ultraRandom = nextCodeLine(
    lines,
    ultraComment + 1,
    /^ld a,\s*\d+\b/i,
    "Ultra/Safari second first-roll ceiling",
  );

  const minorStatusCatch = nextCodeLine(
    lines,
    catchStatusComment + 1,
    /^ld c,\s*\d+\b/i,
    "minor-status catch bonus",
  );
  const majorStatusCatch = nextCodeLine(
    lines,
    minorStatusCatch + 1,
    /^ld c,\s*\d+\b/i,
    "sleep/freeze catch bonus",
  );

  const cpGreat = nextCodeLine(
    lines,
    factorComment + 1,
    /^cp GREAT_BALL\b/i,
    "Great Ball factor check",
  );
  const otherHp = nextCodeLine(
    lines,
    cpGreat + 1,
    /^ld a,\s*\d+\b/i,
    "Poké/Ultra/Safari HP divisor",
  );
  const greatHp = nextCodeLine(
    lines,
    otherHp + 1,
    /^ld a,\s*\d+\b/i,
    "Great Ball HP divisor",
  );

  const pokeShake = nextCodeLine(
    lines,
    factor2Comment + 1,
    /^ld b,\s*\d+\b/i,
    "Poké Ball shake divisor",
  );
  const cpPoke = nextCodeLine(
    lines,
    pokeShake + 1,
    /^cp POKE_BALL\b/i,
    "Poké Ball shake check",
  );
  const greatShake = nextCodeLine(
    lines,
    cpPoke + 1,
    /^ld b,\s*\d+\b/i,
    "Great Ball shake divisor",
  );
  const cpGreatShake = nextCodeLine(
    lines,
    greatShake + 1,
    /^cp GREAT_BALL\b/i,
    "Great Ball shake check",
  );
  const ultraShake = nextCodeLine(
    lines,
    cpGreatShake + 1,
    /^ld b,\s*\d+\b/i,
    "Ultra/Safari shake divisor",
  );

  const minorStatusShake = nextCodeLine(
    lines,
    shakeStatusComment + 1,
    /^ld b,\s*\d+\b/i,
    "minor-status shake bonus",
  );
  const majorStatusShake = nextCodeLine(
    lines,
    minorStatusShake + 1,
    /^ld b,\s*\d+\b/i,
    "sleep/freeze shake bonus",
  );

  const shakeOne = nextCodeLine(
    lines,
    shakeThresholdComment + 1,
    /^cp\s+\d+\b/i,
    "one-shake threshold",
  );
  const shakeTwo = nextCodeLine(
    lines,
    shakeOne + 1,
    /^cp\s+\d+\b/i,
    "two-shake threshold",
  );
  const shakeThree = nextCodeLine(
    lines,
    shakeTwo + 1,
    /^cp\s+\d+\b/i,
    "three-shake threshold",
  );

  return {
    lines,
    greatRandom,
    ultraRandom,
    minorStatusCatch,
    majorStatusCatch,
    otherHp,
    greatHp,
    pokeShake,
    greatShake,
    ultraShake,
    minorStatusShake,
    majorStatusShake,
    shakeOne,
    shakeTwo,
    shakeThree,
  };
}

function readBall(contents: string): BallRoutineParameters {
  const at = ballLocations(contents);
  return {
    kind: "ball",
    masterBallGuaranteed: true,
    greatRandomCeiling: operand(at.lines[at.greatRandom], "a"),
    ultraSafariRandomCeiling: operand(at.lines[at.ultraRandom], "a"),
    minorStatusCatchBonus: operand(at.lines[at.minorStatusCatch], "c"),
    majorStatusCatchBonus: operand(at.lines[at.majorStatusCatch], "c"),
    greatHpDivisor: operand(at.lines[at.greatHp], "a"),
    otherHpDivisor: operand(at.lines[at.otherHp], "a"),
    currentHpDivisor: currentHpDivisor(at.lines),
    pokeShakeDivisor: operand(at.lines[at.pokeShake], "b"),
    greatShakeDivisor: operand(at.lines[at.greatShake], "b"),
    ultraSafariShakeDivisor: operand(at.lines[at.ultraShake], "b"),
    minorStatusShakeBonus: operand(at.lines[at.minorStatusShake], "b"),
    majorStatusShakeBonus: operand(at.lines[at.majorStatusShake], "b"),
    shakeOneThreshold: compareOperand(at.lines[at.shakeOne]),
    shakeTwoThreshold: compareOperand(at.lines[at.shakeTwo]),
    shakeThreeThreshold: compareOperand(at.lines[at.shakeThree]),
  };
}

function fixedHealAmount(contents: string, constant: string): number | null {
  const label = FIXED_HEALS[constant];
  if (!label) return null;
  const pattern = new RegExp(
    `^\\s*ld b,\\s*(\\d+)\\s*;\\s*${label} heal amount\\s*$`, "im",
  );
  const match = contents.match(pattern);
  return match ? Number.parseInt(match[1], 10) : null;
}

function parseRoutine(
  constant: string,
  useRoutine: string | null,
  effects: string,
  overworld: string | null,
): ItemRoutineParameters {
  const deep = parseDeepItemRoutine(constant, effects, overworld);
  if (deep) return deep;

  if (useRoutine === "ItemUseBall") {
    try {
      return readBall(effects);
    } catch (error) {
      return { kind: "routine", description: `Ball formula could not be parameterized safely: ${String(error)}` };
    }
  }

  if (useRoutine === "ItemUseMedicine") {
    const amount = fixedHealAmount(effects, constant);
    if (amount !== null) return { kind: "fixed-heal", healAmount: amount };

    const special: Record<string, { behavior: "full-hp" | "half-max-hp" | "full-hp-and-status" | "status-only"; description: string }> = {
      FULL_RESTORE: { behavior: "full-hp-and-status", description: "Restores HP to maximum and cures status." },
      MAX_POTION: { behavior: "full-hp", description: "Restores HP to maximum." },
      REVIVE: { behavior: "half-max-hp", description: "Revives a fainted Pokémon at half maximum HP." },
      MAX_REVIVE: { behavior: "full-hp", description: "Revives a fainted Pokémon at full HP." },
      FULL_HEAL: { behavior: "status-only", description: "Cures any status condition." },
      ANTIDOTE: { behavior: "status-only", description: "Cures poison." },
      BURN_HEAL: { behavior: "status-only", description: "Cures burn." },
      ICE_HEAL: { behavior: "status-only", description: "Cures freeze." },
      AWAKENING: { behavior: "status-only", description: "Cures sleep." },
      PARLYZ_HEAL: { behavior: "status-only", description: "Cures paralysis." },
    };
    if (special[constant]) return { kind: "special-heal", ...special[constant] };
  }

  return {
    kind: "routine",
    description: useRoutine
      ? `This item uses ${useRoutine}. Structured parameters are not exposed for this routine yet.`
      : "No item-use routine was resolved.",
  };
}

function guardHash(document: ItemEditDocument, path: string): string {
  const source = document.sources.find((entry) => entry.path === path);
  if (!source) throw new Error(`Missing item edit source guard for ${path}.`);
  return source.sourceHash;
}

function rewriteTable(
  contents: string,
  label: string,
  endPattern: RegExp,
  rowPattern: RegExp,
  index: number,
  build: (match: RegExpMatchArray) => string,
): string {
  const row = tableRow(contents, label, endPattern, rowPattern, index);
  row.lines[row.lineIndex] = build(row.match);
  return row.lines.join(row.newline);
}

function validateByte(value: number, label: string, allowZero = true): void {
  const min = allowZero ? 0 : 1;
  if (!Number.isInteger(value) || value < min || value > 255) {
    throw new Error(`${label} must be a whole number from ${min} to 255.`);
  }
}

function replaceOperand(
  line: string,
  register: "a" | "b" | "c",
  value: number,
): string {
  return line.replace(
    new RegExp(`^(\\s*ld ${register},\\s*)\\d+\\b`, "i"),
    `$1${value}`,
  );
}

function replaceCompareOperand(line: string, value: number): string {
  return line.replace(/^(\s*cp\s+)\d+\b/i, `$1${value}`);
}

function validateShakeThresholds(values: BallRoutineParameters): void {
  const thresholds = [
    values.shakeOneThreshold,
    values.shakeTwoThreshold,
    values.shakeThreeThreshold,
  ];
  thresholds.forEach((value, index) =>
    validateByte(value, ["One-shake threshold", "Two-shake threshold", "Three-shake threshold"][index]),
  );
  if (!(thresholds[0] < thresholds[1] && thresholds[1] < thresholds[2])) {
    throw new Error("Shake thresholds must increase from one shake to two shakes to three shakes.");
  }
}

function rewriteBall(contents: string, values: BallRoutineParameters): string {
  validateByte(values.greatRandomCeiling, "Great/Ultra/Safari first-roll ceiling");
  validateByte(values.ultraSafariRandomCeiling, "Ultra/Safari second first-roll ceiling");
  validateByte(values.minorStatusCatchBonus, "Burn/poison/paralysis catch bonus");
  validateByte(values.majorStatusCatchBonus, "Sleep/freeze catch bonus");
  validateByte(values.greatHpDivisor, "Great Ball HP divisor", false);
  validateByte(values.otherHpDivisor, "Poké/Ultra/Safari HP divisor", false);
  validateByte(values.pokeShakeDivisor, "Poké Ball shake divisor", false);
  validateByte(values.greatShakeDivisor, "Great Ball shake divisor", false);
  validateByte(values.ultraSafariShakeDivisor, "Ultra/Safari shake divisor", false);
  validateByte(values.minorStatusShakeBonus, "Burn/poison/paralysis shake bonus");
  validateByte(values.majorStatusShakeBonus, "Sleep/freeze shake bonus");
  validateShakeThresholds(values);

  if (!values.masterBallGuaranteed) {
    throw new Error("Master Ball guaranteed capture is structural and cannot be disabled here.");
  }

  const at = ballLocations(contents);
  const parsedHpDivisor = currentHpDivisor(at.lines);
  if (values.currentHpDivisor !== parsedHpDivisor) {
    throw new Error(
      "The current-HP divisor is encoded as CPU shift instructions and is read-only in this editor.",
    );
  }

  const newline = contents.includes("\r\n") ? "\r\n" : "\n";
  at.lines[at.greatRandom] = replaceOperand(
    at.lines[at.greatRandom], "a", values.greatRandomCeiling,
  );
  at.lines[at.ultraRandom] = replaceOperand(
    at.lines[at.ultraRandom], "a", values.ultraSafariRandomCeiling,
  );
  at.lines[at.minorStatusCatch] = replaceOperand(
    at.lines[at.minorStatusCatch], "c", values.minorStatusCatchBonus,
  );
  at.lines[at.majorStatusCatch] = replaceOperand(
    at.lines[at.majorStatusCatch], "c", values.majorStatusCatchBonus,
  );
  at.lines[at.otherHp] = replaceOperand(
    at.lines[at.otherHp], "a", values.otherHpDivisor,
  );
  at.lines[at.greatHp] = replaceOperand(
    at.lines[at.greatHp], "a", values.greatHpDivisor,
  );
  at.lines[at.pokeShake] = replaceOperand(
    at.lines[at.pokeShake], "b", values.pokeShakeDivisor,
  );
  at.lines[at.greatShake] = replaceOperand(
    at.lines[at.greatShake], "b", values.greatShakeDivisor,
  );
  at.lines[at.ultraShake] = replaceOperand(
    at.lines[at.ultraShake], "b", values.ultraSafariShakeDivisor,
  );
  at.lines[at.minorStatusShake] = replaceOperand(
    at.lines[at.minorStatusShake], "b", values.minorStatusShakeBonus,
  );
  at.lines[at.majorStatusShake] = replaceOperand(
    at.lines[at.majorStatusShake], "b", values.majorStatusShakeBonus,
  );
  at.lines[at.shakeOne] = replaceCompareOperand(
    at.lines[at.shakeOne], values.shakeOneThreshold,
  );
  at.lines[at.shakeTwo] = replaceCompareOperand(
    at.lines[at.shakeTwo], values.shakeTwoThreshold,
  );
  at.lines[at.shakeThree] = replaceCompareOperand(
    at.lines[at.shakeThree], values.shakeThreeThreshold,
  );

  const effectiveUltraCeiling = Math.min(
    values.greatRandomCeiling,
    values.ultraSafariRandomCeiling,
  );

  for (let i = 0; i < at.lines.length; i += 1) {
    const line = at.lines[i];
    if (line.includes("; Great Ball:        [0,")) {
      at.lines[i] = `; Great Ball:        [0, ${values.greatRandomCeiling}]`;
    } else if (line.includes("; Ultra/Safari Ball: [0,")) {
      at.lines[i] = `; Ultra/Safari Ball: [0, ${effectiveUltraCeiling}]`;
    } else if (line.includes("Great/Ultra/Safari Ball and Rand1 is greater than")) {
      at.lines[i] =
        `; If it's a Great/Ultra/Safari Ball and Rand1 is greater than ${values.greatRandomCeiling}, try again.`;
    } else if (line.includes("good enough for a Great Ball")) {
      at.lines[i] =
        `; Less than or equal to ${values.greatRandomCeiling} is good enough for a Great Ball.`;
    } else if (line.includes("If it's an Ultra/Safari Ball and Rand1 is greater than")) {
      at.lines[i] =
        `; If it's an Ultra/Safari Ball and Rand1 is greater than ${values.ultraSafariRandomCeiling}, try again.`;
    } else if (line.includes("; Burn/Paralysis/Poison: Status =")) {
      at.lines[i] =
        `; Burn/Paralysis/Poison: Status = ${values.minorStatusCatchBonus}`;
    } else if (line.includes("; Freeze/Sleep:") && line.includes("Status =")) {
      at.lines[i] = `; Freeze/Sleep:          Status = ${values.majorStatusCatchBonus}`;
    } else if (line.includes("; Determine BallFactor. It's")) {
      at.lines[i] =
        `; Determine BallFactor. It's ${values.greatHpDivisor} for Great Balls and ${values.otherHpDivisor} for the others.`;
    } else if (line.includes("; Poké Ball:") && line.includes("BallFactor2")) {
      at.lines[i] = `; Poké Ball:         BallFactor2 = ${values.pokeShakeDivisor}`;
    } else if (line.includes("; Great Ball:") && line.includes("BallFactor2")) {
      at.lines[i] = `; Great Ball:        BallFactor2 = ${values.greatShakeDivisor}`;
    } else if (line.includes("; Ultra/Safari Ball:") && line.includes("BallFactor2")) {
      at.lines[i] =
        `; Ultra/Safari Ball: BallFactor2 = ${values.ultraSafariShakeDivisor}`;
    } else if (line.includes("; Burn/Paralysis/Poison: Status2 =")) {
      at.lines[i] =
        `; Burn/Paralysis/Poison: Status2 = ${values.minorStatusShakeBonus}`;
    } else if (line.includes("; Freeze/Sleep:") && line.includes("Status2 =")) {
      at.lines[i] = `; Freeze/Sleep:          Status2 = ${values.majorStatusShakeBonus}`;
    } else if (/^; 0\s+≤ Z </.test(line)) {
      at.lines[i] =
        `; 0  ≤ Z < ${values.shakeOneThreshold}: 0 shakes (the ball misses)`;
    } else if (/^; \d+ ≤ Z </.test(line) && line.includes("1 shake")) {
      at.lines[i] =
        `; ${values.shakeOneThreshold} ≤ Z < ${values.shakeTwoThreshold}: 1 shake`;
    } else if (/^; \d+ ≤ Z </.test(line) && line.includes("2 shakes")) {
      at.lines[i] =
        `; ${values.shakeTwoThreshold} ≤ Z < ${values.shakeThreeThreshold}: 2 shakes`;
    } else if (line.includes("≤ Z:") && line.includes("3 shakes")) {
      at.lines[i] = `; ${values.shakeThreeThreshold} ≤ Z:      3 shakes`;
    } else if (line.includes("; The maximum value of Y is")) {
      at.lines[i] = "; The maximum value of Y depends on the configured BallFactor2.";
    }
  }

  return at.lines.join(newline);
}

function rewriteFixedHeal(contents: string, constant: string, amount: number): string {
  validateByte(amount, "HP restored");
  const label = FIXED_HEALS[constant];
  if (!label) throw new Error(`${constant} is not a supported fixed-HP healing item.`);
  const pattern = new RegExp(
    `^(\\s*ld b,\\s*)\\d+(\\s*;\\s*${label} heal amount\\s*)$`, "im",
  );
  if (!pattern.test(contents)) {
    throw new Error(`Could not locate ${label}'s healing amount.`);
  }
  return contents.replace(pattern, `$1${amount}$2`);
}

export async function loadItemEditDocument(
  source: ProjectSource,
  itemId: number,
): Promise<ItemEditDocument> {
  const [
    constants, names, prices, keyItems, effects, textConstants,
  ] = await Promise.all([
    source.readText(ITEM_CONSTANTS_PATH),
    source.readText(ITEM_NAMES_PATH),
    source.readText(ITEM_PRICES_PATH),
    source.readText(KEY_ITEMS_PATH),
    source.readText(ITEM_EFFECTS_PATH),
    source.readText(TEXT_CONSTANTS_PATH),
  ]);

  const { index, constant } = regularItem(constants, itemId);
  const useRoutine = readUseRoutine(effects, index);
  const overworld = constant === "BICYCLE"
    ? await source.readText(OVERWORLD_PATH)
    : null;
  const sources = new Map<string, string>([
    [ITEM_CONSTANTS_PATH, constants],
    [ITEM_NAMES_PATH, names],
    [ITEM_PRICES_PATH, prices],
    [KEY_ITEMS_PATH, keyItems],
    [ITEM_EFFECTS_PATH, effects],
    [TEXT_CONSTANTS_PATH, textConstants],
  ]);
  if (overworld !== null) sources.set(OVERWORLD_PATH, overworld);

  return {
    itemId,
    constant,
    name: readName(names, index),
    price: readPrice(prices, index),
    keyItem: readKeyItem(keyItems, index),
    useRoutine,
    maxNameLength: maxItemNameLength(textConstants),
    routineParameters: parseRoutine(constant, useRoutine, effects, overworld),
    sources: await Promise.all([...sources].map(async ([path, contents]) => ({
      path,
      sourceHash: await hashText(contents),
    }))),
  };
}

function sameRoutine(left: ItemRoutineParameters, right: ItemRoutineParameters): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function prepareItemEditWrites(
  source: ProjectSource,
  document: ItemEditDocument,
  values: ItemEditValues,
): Promise<TextWriteRequest[]> {
  const fresh = await loadItemEditDocument(source, document.itemId);
  if (
    fresh.constant !== document.constant
    || fresh.name !== document.name
    || fresh.price !== document.price
    || fresh.keyItem !== document.keyItem
    || fresh.useRoutine !== document.useRoutine
    || !sameRoutine(fresh.routineParameters, document.routineParameters)
  ) {
    throw new Error("This item changed outside Yellow Editor. Reload it before saving.");
  }

  for (const sourceDocument of document.sources) {
    const current = await source.readText(sourceDocument.path);
    if (await hashText(current) !== sourceDocument.sourceHash) {
      throw new Error(`${sourceDocument.path} changed outside Yellow Editor. Reload the item before saving.`);
    }
  }

  const name = values.name.trim();
  if (!name || name.length > document.maxNameLength) {
    throw new Error(`Item name must be 1–${document.maxNameLength} characters.`);
  }
  if (/["@\r\n]/.test(name)) throw new Error("Item name cannot contain quotes, @, or line breaks.");
  if (!Number.isInteger(values.price) || values.price < 0 || values.price > 999999) {
    throw new Error("Item price must be a whole number from 0 to 999999.");
  }
  if (values.routineParameters.kind !== document.routineParameters.kind) {
    throw new Error("The item routine structure changed. Reload the item before saving.");
  }

  const constants = await source.readText(ITEM_CONSTANTS_PATH);
  const { index } = regularItem(constants, document.itemId);
  const writes: TextWriteRequest[] = [];

  if (name !== document.name) {
    const contents = await source.readText(ITEM_NAMES_PATH);
    writes.push({
      path: ITEM_NAMES_PATH,
      expectedHash: guardHash(document, ITEM_NAMES_PATH),
      contents: rewriteTable(
        contents, "ItemNames", /^assert_list_length\s+NUM_ITEMS\b/,
        /^(\s*li\s+)"([^"]*)"(.*)$/, index,
        (match) => match[1] + `"${name}"` + match[3],
      ),
    });
  }

  if (values.price !== document.price) {
    const contents = await source.readText(ITEM_PRICES_PATH);
    writes.push({
      path: ITEM_PRICES_PATH,
      expectedHash: guardHash(document, ITEM_PRICES_PATH),
      contents: rewriteTable(
        contents, "ItemPrices", /^assert_table_length\s+NUM_ITEMS\b/,
        /^(\s*bcd3\s+)(\d+)(.*)$/, index,
        (match) => match[1] + String(values.price) + match[3],
      ),
    });
  }

  if (values.keyItem !== document.keyItem) {
    const contents = await source.readText(KEY_ITEMS_PATH);
    writes.push({
      path: KEY_ITEMS_PATH,
      expectedHash: guardHash(document, KEY_ITEMS_PATH),
      contents: rewriteTable(
        contents, "KeyItemFlags", /^end_bit_array\b/,
        /^(\s*dbit\s+)(TRUE|FALSE)(.*)$/i, index,
        (match) => match[1] + (values.keyItem ? "TRUE" : "FALSE") + match[3],
      ),
    });
  }

  if (!sameRoutine(values.routineParameters, document.routineParameters)) {
    const effectsContents = await source.readText(ITEM_EFFECTS_PATH);
    const overworldContents = document.constant === "BICYCLE"
      ? await source.readText(OVERWORLD_PATH)
      : null;

    if (
      document.routineParameters.kind === "fixed-heal"
      && values.routineParameters.kind === "fixed-heal"
    ) {
      const next = rewriteFixedHeal(
        effectsContents,
        document.constant,
        values.routineParameters.healAmount,
      );
      writes.push({
        path: ITEM_EFFECTS_PATH,
        expectedHash: guardHash(document, ITEM_EFFECTS_PATH),
        contents: next,
      });
    } else if (
      document.routineParameters.kind === "ball"
      && values.routineParameters.kind === "ball"
    ) {
      const next = rewriteBall(effectsContents, values.routineParameters);
      writes.push({
        path: ITEM_EFFECTS_PATH,
        expectedHash: guardHash(document, ITEM_EFFECTS_PATH),
        contents: next,
      });
    } else {
      const deep = rewriteDeepItemRoutine(
        document.constant,
        document.routineParameters,
        values.routineParameters,
        effectsContents,
        overworldContents,
      );
      if (!deep) {
        throw new Error("This routine is informational and cannot be edited yet.");
      }
      if (deep.effectsContents !== effectsContents) {
        writes.push({
          path: ITEM_EFFECTS_PATH,
          expectedHash: guardHash(document, ITEM_EFFECTS_PATH),
          contents: deep.effectsContents,
        });
      }
      if (
        overworldContents !== null
        && deep.overworldContents !== null
        && deep.overworldContents !== overworldContents
      ) {
        writes.push({
          path: OVERWORLD_PATH,
          expectedHash: guardHash(document, OVERWORLD_PATH),
          contents: deep.overworldContents,
        });
      }
    }
  }

  return writes;
}
