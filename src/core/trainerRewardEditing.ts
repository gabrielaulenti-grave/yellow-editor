import { hashText } from "./history";
import type {
  ProjectSource,
  TextWriteRequest,
  TrainerRewardEditDocument,
  TrainerRewardItemOption,
} from "./types";

const ITEM_CONSTANTS_PATH = "constants/item_constants.asm";
const ITEM_NAMES_PATH = "data/items/names.asm";

interface RewardLine {
  prefix: string;
  itemConstant: string;
  separator: string;
  quantity: number;
  suffix: string;
}

function withoutComment(line: string): string {
  return line.split(";", 1)[0].trim();
}

function parseNumber(value: string): number | null {
  const clean = value.trim();
  if (/^\d+$/.test(clean)) return Number(clean);
  if (/^\$[0-9a-f]+$/i.test(clean)) return Number.parseInt(clean.slice(1), 16);
  return null;
}

function titleCaseConstant(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part ? part[0].toUpperCase() + part.slice(1) : part)
    .join(" ");
}

function rewardLine(line: string): RewardLine | null {
  const match = line.match(
    /^(\s*lb\s+bc\s*,\s*)([A-Z][A-Z0-9_]*)(\s*,\s*)(\$[0-9a-f]+|\d+)(\s*(?:;.*)?)$/i,
  );
  if (!match) return null;
  const quantity = parseNumber(match[4]);
  if (quantity === null) return null;
  return {
    prefix: match[1],
    itemConstant: match[2],
    separator: match[3],
    quantity,
    suffix: match[5],
  };
}

function hasGiveItemCall(lines: string[], lineIndex: number): boolean {
  for (let index = lineIndex + 1; index < Math.min(lines.length, lineIndex + 7); index += 1) {
    const clean = withoutComment(lines[index]);
    if (!clean) continue;
    if (/^[A-Za-z_.][A-Za-z0-9_.]*:{1,2}$/.test(clean)) return false;
    if (/^call\s+GiveItem\b/i.test(clean)) return true;
  }
  return false;
}

function ordinaryItemConstants(contents: string): string[] {
  const beforeFloors = contents.split(/\bDEF\s+NUM_ITEMS\b/i, 1)[0] ?? "";
  return [...beforeFloors.matchAll(/^\s*const\s+([A-Z][A-Z0-9_]*)\b/gm)]
    .map((match) => match[1])
    .filter((constant) => constant !== "NO_ITEM");
}

function itemNames(contents: string): string[] {
  const beforeAssert = contents.split(/^\s*assert_list_length\s+NUM_ITEMS\b/m, 1)[0] ?? "";
  return [...beforeAssert.matchAll(/^\s*li\s+"([^"]*)"/gm)].map((match) => match[1]);
}

function tmHmOptions(contents: string): TrainerRewardItemOption[] {
  const result: TrainerRewardItemOption[] = [];
  let hmNumber = 0;
  let tmNumber = 0;
  for (const line of contents.split(/\r?\n/)) {
    const hm = withoutComment(line).match(/^add_hm\s+([A-Z][A-Z0-9_]*)\b/i)?.[1];
    if (hm) {
      hmNumber += 1;
      result.push({
        constant: `HM_${hm}`,
        label: `HM${String(hmNumber).padStart(2, "0")} — ${titleCaseConstant(hm)}`,
        kind: "hm",
      });
      continue;
    }
    const tm = withoutComment(line).match(/^add_tm\s+([A-Z][A-Z0-9_]*)\b/i)?.[1];
    if (tm) {
      tmNumber += 1;
      result.push({
        constant: `TM_${tm}`,
        label: `TM${String(tmNumber).padStart(2, "0")} — ${titleCaseConstant(tm)}`,
        kind: "tm",
      });
    }
  }
  return result;
}

async function rewardItemOptions(
  source: ProjectSource,
  currentConstant?: string,
): Promise<TrainerRewardItemOption[]> {
  if (!(await source.exists(ITEM_CONSTANTS_PATH))) {
    throw new Error(`Missing ${ITEM_CONSTANTS_PATH}; reward items cannot be listed safely.`);
  }

  const constantsSource = await source.readText(ITEM_CONSTANTS_PATH);
  const constants = ordinaryItemConstants(constantsSource);
  const names = await source.exists(ITEM_NAMES_PATH)
    ? itemNames(await source.readText(ITEM_NAMES_PATH))
    : [];

  const options: TrainerRewardItemOption[] = constants.map((constant, index) => ({
    constant,
    label: names[index] || titleCaseConstant(constant),
    kind: "item",
  }));
  options.push(...tmHmOptions(constantsSource));

  if (currentConstant && !options.some((option) => option.constant === currentConstant)) {
    options.unshift({
      constant: currentConstant,
      label: titleCaseConstant(currentConstant),
      kind: "item",
    });
  }

  return options;
}

export async function loadTrainerRewardEditDocument(
  source: ProjectSource,
  path: string,
  sourceLine: number,
): Promise<TrainerRewardEditDocument> {
  if (!Number.isInteger(sourceLine) || sourceLine < 1) {
    throw new Error("Trainer reward source line is invalid.");
  }
  if (!(await source.exists(path))) {
    throw new Error(`Trainer reward source file '${path}' was not found.`);
  }

  const contents = await source.readText(path);
  const lines = contents.split(/\r?\n/);
  const lineIndex = sourceLine - 1;
  const parsed = lineIndex < lines.length ? rewardLine(lines[lineIndex]) : null;
  if (!parsed || !hasGiveItemCall(lines, lineIndex)) {
    throw new Error(
      `Yellow Editor could not verify a direct GiveItem reward at ${path}:${sourceLine}.`,
    );
  }

  return {
    path,
    sourceLine,
    sourceHash: await hashText(contents),
    itemConstant: parsed.itemConstant,
    quantity: parsed.quantity,
    itemOptions: await rewardItemOptions(source, parsed.itemConstant),
  };
}

export async function prepareTrainerRewardWrite(
  source: ProjectSource,
  path: string,
  sourceLine: number,
  itemConstant: string,
  quantity: number,
): Promise<TextWriteRequest> {
  if (!/^[A-Z][A-Z0-9_]*$/.test(itemConstant)) {
    throw new Error("Choose a valid item from this project's reward list.");
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 255) {
    throw new Error("Reward quantity must be a whole number from 1 to 255.");
  }

  const contents = await source.readText(path);
  const lines = contents.split(/\r?\n/);
  const lineIndex = sourceLine - 1;
  const parsed = lineIndex >= 0 && lineIndex < lines.length
    ? rewardLine(lines[lineIndex])
    : null;
  if (!parsed || !hasGiveItemCall(lines, lineIndex)) {
    throw new Error(
      `The reward at ${path}:${sourceLine} changed structure. Reload the trainer before saving.`,
    );
  }

  const options = await rewardItemOptions(source, parsed.itemConstant);
  if (!options.some((option) => option.constant === itemConstant)) {
    throw new Error(
      `Item '${itemConstant}' is not defined as an item, TM, or HM in this project.`,
    );
  }

  lines[lineIndex] =
    `${parsed.prefix}${itemConstant}${parsed.separator}${quantity}${parsed.suffix}`;

  return {
    path,
    contents: lines.join(contents.includes("\r\n") ? "\r\n" : "\n"),
  };
}
