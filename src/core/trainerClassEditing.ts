import type {
  ProjectSource,
  TextWriteRequest,
  TrainerClassCreateValues,
  TrainerClassEditValues,
  TrainerClassEntry,
  TrainerEditSourceDocument,
} from "./types";

const CONSTANTS_PATH = "constants/trainer_constants.asm";
const NAMES_PATH = "data/trainers/names.asm";
const NAME_POINTERS_PATH = "data/trainers/name_pointers.asm";
const PARTIES_PATH = "data/trainers/parties.asm";
const MONEY_PATH = "data/trainers/pic_pointers_money.asm";
const AI_PATH = "data/trainers/ai_pointers.asm";
const MOVE_CHOICES_PATH = "data/trainers/move_choices.asm";

export const VANILLA_MAX_TRAINER_CLASSES = 55;

const CLASS_SOURCE_PATHS = [
  CONSTANTS_PATH,
  NAMES_PATH,
  NAME_POINTERS_PATH,
  PARTIES_PATH,
  MONEY_PATH,
  AI_PATH,
  MOVE_CHOICES_PATH,
] as const;

function sourceDocument(
  sources: TrainerEditSourceDocument[],
  path: string,
): TrainerEditSourceDocument {
  const document = sources.find((source) => source.path === path);
  if (!document) {
    throw new Error(`Trainer class creation requires ${path}.`);
  }
  return document;
}

function newlineInfo(contents: string): { newline: string; trailing: boolean } {
  const newline = contents.includes("\r\n") ? "\r\n" : "\n";
  return { newline, trailing: contents.endsWith(newline) };
}

function splitLines(contents: string): string[] {
  const { trailing } = newlineInfo(contents);
  const lines = contents.split(/\r?\n/);
  if (trailing && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function joinLines(lines: string[], contents: string): string {
  const { newline, trailing } = newlineInfo(contents);
  return lines.join(newline) + (trailing ? newline : "");
}

function insertBefore(
  contents: string,
  predicate: (line: string) => boolean,
  line: string,
  description: string,
): string {
  const lines = splitLines(contents);
  const index = lines.findIndex(predicate);
  if (index < 0) {
    throw new Error(`Could not find ${description} while creating the trainer class.`);
  }
  lines.splice(index, 0, line);
  return joinLines(lines, contents);
}

function appendBlock(contents: string, linesToAppend: string[]): string {
  const lines = splitLines(contents);
  if (lines.length > 0 && lines[lines.length - 1].trim() !== "") {
    lines.push("");
  }
  lines.push(...linesToAppend);
  return joinLines(lines, contents);
}

function withoutComment(line: string): string {
  return line.split(";", 1)[0].trim();
}

function parseAsmNumber(value: string): number | null {
  const clean = value.trim();
  if (/^\$[0-9a-f]+$/i.test(clean)) {
    return Number.parseInt(clean.slice(1), 16);
  }
  if (/^\d+$/.test(clean)) {
    return Number.parseInt(clean, 10);
  }
  return null;
}

function trainerConstants(contents: string): string[] {
  return [...contents.matchAll(/^\s*trainer_const\s+([A-Z][A-Z0-9_]*)\b/gm)]
    .map((match) => match[1])
    .filter((constant) => constant !== "NOBODY");
}

function opponentIdOffset(contents: string): number | null {
  const value = contents.match(/^\s*DEF\s+OPP_ID_OFFSET\s+EQU\s+([^\s;]+)/im)?.[1];
  return value ? parseAsmNumber(value) : null;
}

function pointerEntries(contents: string, label: string): string[] {
  const lines = contents.split(/\r?\n/);
  const start = lines.findIndex((line) =>
    new RegExp(`^\\s*${label}::{0,1}\\s*(?:;.*)?$`, "i").test(line),
  );
  if (start < 0) return [];

  const entries: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const clean = withoutComment(lines[index]);
    if (/^assert_table_length\b/i.test(clean)) break;
    const pointer = clean.match(/^dw\s+([A-Za-z_.][A-Za-z0-9_.]*)\b/i)?.[1];
    if (pointer) entries.push(pointer);
  }
  return entries;
}

function trainerNames(contents: string): string[] {
  return [...contents.matchAll(/^\s*li\s+"([^"]*)"/gm)].map((match) => match[1]);
}

function picMoneyEntries(contents: string): Array<{ picLabel: string; amount: number }> {
  return [...contents.matchAll(
    /^\s*pic_money\s+([A-Za-z_][A-Za-z0-9_]*)\s*,\s*(\d+)\b/gm,
  )].map((match) => ({
    picLabel: match[1],
    amount: Number(match[2]),
  }));
}

function aiEntries(contents: string): Array<{ uses: number; routine: string }> {
  return [...contents.matchAll(
    /^\s*dbw\s+(\d+)\s*,\s*([A-Za-z_][A-Za-z0-9_]*)\b/gm,
  )].map((match) => ({
    uses: Number(match[1]),
    routine: match[2],
  }));
}

function moveChoiceEntries(contents: string): string[] {
  return contents.split(/\r?\n/)
    .map(withoutComment)
    .filter((line) => /^move_choices(?:\s|$)/i.test(line));
}
function replaceNthMatchingLine(
  contents: string,
  matches: (line: string) => boolean,
  index: number,
  replacement: (line: string) => string,
  description: string,
): string {
  const lines = splitLines(contents);
  let seen = 0;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    if (!matches(lines[lineIndex])) continue;
    if (seen === index) {
      lines[lineIndex] = replacement(lines[lineIndex]);
      return joinLines(lines, contents);
    }
    seen += 1;
  }
  throw new Error(`Could not find trainer class ${description} entry ${index + 1}.`);
}

function lineComment(line: string): string {
  const index = line.indexOf(";");
  return index >= 0 ? line.slice(index).trimEnd() : "";
}

function leadingWhitespace(line: string): string {
  return line.match(/^\s*/)?.[0] ?? "";
}

function replaceStaticTrainerName(
  contents: string,
  label: string,
  name: string,
): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\function moveChoiceEntries(contents: string): string[] {
  return contents.split(/\r?\n/)
    .map(withoutComment)
    .filter((line) => /^move_choices(?:\s|$)/i.test(line));
}
");
  const pattern = new RegExp(`^(\\s*${escaped}:\\s*db\\s+")[^"]*("@.*)import type {
  ProjectSource,
  TextWriteRequest,
  TrainerClassCreateValues,
  TrainerClassEditValues,
  TrainerClassEntry,
  TrainerEditSourceDocument,
} from "./types";

const CONSTANTS_PATH = "constants/trainer_constants.asm";
const NAMES_PATH = "data/trainers/names.asm";
const NAME_POINTERS_PATH = "data/trainers/name_pointers.asm";
const PARTIES_PATH = "data/trainers/parties.asm";
const MONEY_PATH = "data/trainers/pic_pointers_money.asm";
const AI_PATH = "data/trainers/ai_pointers.asm";
const MOVE_CHOICES_PATH = "data/trainers/move_choices.asm";

export const VANILLA_MAX_TRAINER_CLASSES = 55;

const CLASS_SOURCE_PATHS = [
  CONSTANTS_PATH,
  NAMES_PATH,
  NAME_POINTERS_PATH,
  PARTIES_PATH,
  MONEY_PATH,
  AI_PATH,
  MOVE_CHOICES_PATH,
] as const;

function sourceDocument(
  sources: TrainerEditSourceDocument[],
  path: string,
): TrainerEditSourceDocument {
  const document = sources.find((source) => source.path === path);
  if (!document) {
    throw new Error(`Trainer class creation requires ${path}.`);
  }
  return document;
}

function newlineInfo(contents: string): { newline: string; trailing: boolean } {
  const newline = contents.includes("\r\n") ? "\r\n" : "\n";
  return { newline, trailing: contents.endsWith(newline) };
}

function splitLines(contents: string): string[] {
  const { trailing } = newlineInfo(contents);
  const lines = contents.split(/\r?\n/);
  if (trailing && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function joinLines(lines: string[], contents: string): string {
  const { newline, trailing } = newlineInfo(contents);
  return lines.join(newline) + (trailing ? newline : "");
}

function insertBefore(
  contents: string,
  predicate: (line: string) => boolean,
  line: string,
  description: string,
): string {
  const lines = splitLines(contents);
  const index = lines.findIndex(predicate);
  if (index < 0) {
    throw new Error(`Could not find ${description} while creating the trainer class.`);
  }
  lines.splice(index, 0, line);
  return joinLines(lines, contents);
}

function appendBlock(contents: string, linesToAppend: string[]): string {
  const lines = splitLines(contents);
  if (lines.length > 0 && lines[lines.length - 1].trim() !== "") {
    lines.push("");
  }
  lines.push(...linesToAppend);
  return joinLines(lines, contents);
}

function withoutComment(line: string): string {
  return line.split(";", 1)[0].trim();
}

function parseAsmNumber(value: string): number | null {
  const clean = value.trim();
  if (/^\$[0-9a-f]+$/i.test(clean)) {
    return Number.parseInt(clean.slice(1), 16);
  }
  if (/^\d+$/.test(clean)) {
    return Number.parseInt(clean, 10);
  }
  return null;
}

function trainerConstants(contents: string): string[] {
  return [...contents.matchAll(/^\s*trainer_const\s+([A-Z][A-Z0-9_]*)\b/gm)]
    .map((match) => match[1])
    .filter((constant) => constant !== "NOBODY");
}

function opponentIdOffset(contents: string): number | null {
  const value = contents.match(/^\s*DEF\s+OPP_ID_OFFSET\s+EQU\s+([^\s;]+)/im)?.[1];
  return value ? parseAsmNumber(value) : null;
}

function pointerEntries(contents: string, label: string): string[] {
  const lines = contents.split(/\r?\n/);
  const start = lines.findIndex((line) =>
    new RegExp(`^\\s*${label}::{0,1}\\s*(?:;.*)?$`, "i").test(line),
  );
  if (start < 0) return [];

  const entries: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const clean = withoutComment(lines[index]);
    if (/^assert_table_length\b/i.test(clean)) break;
    const pointer = clean.match(/^dw\s+([A-Za-z_.][A-Za-z0-9_.]*)\b/i)?.[1];
    if (pointer) entries.push(pointer);
  }
  return entries;
}

function trainerNames(contents: string): string[] {
  return [...contents.matchAll(/^\s*li\s+"([^"]*)"/gm)].map((match) => match[1]);
}

function picMoneyEntries(contents: string): Array<{ picLabel: string; amount: number }> {
  return [...contents.matchAll(
    /^\s*pic_money\s+([A-Za-z_][A-Za-z0-9_]*)\s*,\s*(\d+)\b/gm,
  )].map((match) => ({
    picLabel: match[1],
    amount: Number(match[2]),
  }));
}

function aiEntries(contents: string): Array<{ uses: number; routine: string }> {
  return [...contents.matchAll(
    /^\s*dbw\s+(\d+)\s*,\s*([A-Za-z_][A-Za-z0-9_]*)\b/gm,
  )].map((match) => ({
    uses: Number(match[1]),
    routine: match[2],
  }));
}

);
  const lines = splitLines(contents);
  const index = lines.findIndex((line) => pattern.test(line));
  if (index < 0) {
    throw new Error(`Trainer defeat-speech name ${label} is not a simple editable string.`);
  }
  lines[index] = lines[index].replace(pattern, `$1${name}$2`);
  return joinLines(lines, contents);
}

function validateCommonClassValues(values: TrainerClassEditValues): void {
  const name = values.name.trim();
  if (!name || name.length > 12 || /["@\r\n]/.test(name)) {
    throw new Error("Trainer class name must be 1 to 12 characters and cannot contain quotes or @.");
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(values.picLabel)) {
    throw new Error("Trainer portrait label is invalid.");
  }
  if (!Number.isInteger(values.baseRewardPerLevel) || values.baseRewardPerLevel < 0 || values.baseRewardPerLevel > 99) {
    throw new Error("Base prize rate must be a whole number from 0 to 99.");
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(values.aiRoutine)) {
    throw new Error("Trainer AI routine is invalid.");
  }
  if (!Number.isInteger(values.aiUsesPerPokemon) || values.aiUsesPerPokemon < 0 || values.aiUsesPerPokemon > 255) {
    throw new Error("AI uses per Pokémon must be a whole number from 0 to 255.");
  }

  const modifiers = new Set<number>();
  for (const modifier of values.moveChoiceModifiers) {
    if (!Number.isInteger(modifier) || modifier < 1 || modifier > 3) {
      throw new Error("Move-choice groups must use the vanilla groups 1, 2, or 3.");
    }
    if (modifiers.has(modifier)) {
      throw new Error("Move-choice groups cannot contain duplicates.");
    }
    modifiers.add(modifier);
  }
}

export function validateTrainerClassEditValues(
  values: TrainerClassEditValues,
): void {
  validateCommonClassValues(values);
}

function pascalConstant(constant: string): string {
  return constant
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
}

function partyDataLine(values: TrainerClassCreateValues): string {
  const pokemon = values.initialParty.pokemon;
  if (values.initialParty.partyFormat === "individual-levels") {
    return `\tdb $ff, ${pokemon
      .flatMap((entry) => [entry.level, entry.speciesConstant])
      .join(", ")}, 0`;
  }
  return `\tdb ${pokemon[0].level}, ${pokemon.map((entry) => entry.speciesConstant).join(", ")}, 0`;
}

export function validateTrainerClassCreateValues(
  values: TrainerClassCreateValues,
  existingClasses: TrainerClassEntry[],
  knownSpecies: Set<string>,
): void {
  if (!/^[A-Z][A-Z0-9_]*$/.test(values.constant)) {
    throw new Error("Trainer class constant must use uppercase letters, numbers, and underscores and start with a letter.");
  }
  if (existingClasses.some((entry) => entry.constant === values.constant)) {
    throw new Error(`Trainer class ${values.constant} already exists.`);
  }
  if (existingClasses.length >= VANILLA_MAX_TRAINER_CLASSES) {
    throw new Error("The vanilla opponent-ID range has no remaining trainer class slots.");
  }

  const name = values.name.trim();
  if (!name || name.length > 12 || /["@\r\n]/.test(name)) {
    throw new Error("Trainer class name must be 1 to 12 characters and cannot contain quotes or @.");
  }
  if (!existingClasses.some((entry) => entry.constant === values.portraitClassConstant)) {
    throw new Error("Choose an existing trainer class portrait.");
  }
  if (!Number.isInteger(values.baseRewardPerLevel) || values.baseRewardPerLevel < 0 || values.baseRewardPerLevel > 99) {
    throw new Error("Base prize rate must be a whole number from 0 to 99.");
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(values.aiRoutine)) {
    throw new Error("Trainer AI routine is invalid.");
  }
  if (!Number.isInteger(values.aiUsesPerPokemon) || values.aiUsesPerPokemon < 0 || values.aiUsesPerPokemon > 255) {
    throw new Error("AI uses per Pokémon must be a whole number from 0 to 255.");
  }

  const modifiers = new Set<number>();
  for (const modifier of values.moveChoiceModifiers) {
    if (!Number.isInteger(modifier) || modifier < 1 || modifier > 3) {
      throw new Error("Move-choice groups must use the vanilla groups 1, 2, or 3.");
    }
    if (modifiers.has(modifier)) {
      throw new Error("Move-choice groups cannot contain duplicates.");
    }
    modifiers.add(modifier);
  }

  const party = values.initialParty;
  if (party.partyFormat !== "shared-level" && party.partyFormat !== "individual-levels") {
    throw new Error("Initial trainer party encoding is invalid.");
  }
  if (party.pokemon.length < 1 || party.pokemon.length > 6) {
    throw new Error("The initial trainer party must contain between 1 and 6 Pokémon.");
  }
  for (const [index, pokemon] of party.pokemon.entries()) {
    if (!Number.isInteger(pokemon.level) || pokemon.level < 1 || pokemon.level > 100) {
      throw new Error(`Initial party slot ${index + 1} level must be a whole number from 1 to 100.`);
    }
    if (!knownSpecies.has(pokemon.speciesConstant)) {
      throw new Error(`Initial party slot ${index + 1} uses unknown Pokémon '${pokemon.speciesConstant}'.`);
    }
  }
  if (
    party.partyFormat === "shared-level" &&
    party.pokemon.some((pokemon) => pokemon.level !== party.pokemon[0].level)
  ) {
    throw new Error("Every Pokémon in a shared-level initial party must use the same level.");
  }
}

export async function prepareTrainerClassEditWrites(
  source: ProjectSource,
  sources: TrainerEditSourceDocument[],
  classConstant: string,
  values: TrainerClassEditValues,
): Promise<TextWriteRequest[]> {
  validateCommonClassValues(values);

  const requiredPaths = [
    CONSTANTS_PATH,
    NAMES_PATH,
    NAME_POINTERS_PATH,
    MONEY_PATH,
    AI_PATH,
    MOVE_CHOICES_PATH,
  ] as const;
  const sourceDocuments = new Map(
    requiredPaths.map((path) => [path, sourceDocument(sources, path)]),
  );
  const contents = new Map<string, string>();
  await Promise.all(requiredPaths.map(async (path) => {
    contents.set(path, await source.readText(path));
  }));

  const constantsContents = contents.get(CONSTANTS_PATH)!;
  const constants = trainerConstants(constantsContents);
  const classIndex = constants.indexOf(classConstant);
  if (classIndex < 0) {
    throw new Error(`Trainer class ${classConstant} no longer exists.`);
  }

  const namesContents = contents.get(NAMES_PATH)!;
  const namePointersContents = contents.get(NAME_POINTERS_PATH)!;
  const moneyContents = contents.get(MONEY_PATH)!;
  const aiContents = contents.get(AI_PATH)!;
  const choicesContents = contents.get(MOVE_CHOICES_PATH)!;

  const names = trainerNames(namesContents);
  const namePointers = pointerEntries(namePointersContents, "TrainerNamePointers");
  const money = picMoneyEntries(moneyContents);
  const ai = aiEntries(aiContents);
  const choices = moveChoiceEntries(choicesContents);
  const lengths = {
    constants: constants.length,
    names: names.length,
    namePointers: namePointers.length,
    money: money.length,
    ai: ai.length,
    moveChoices: choices.length,
  };
  for (const [label, length] of Object.entries(lengths)) {
    if (length !== constants.length) {
      throw new Error(
        `Trainer class editing requires synchronized trainer tables; ${label} has ${length} entries but constants has ${constants.length}.`,
      );
    }
  }

  if (!money.some((entry) => entry.picLabel === values.picLabel)) {
    throw new Error(`Trainer portrait ${values.picLabel} is not used by an existing class.`);
  }
  if (!ai.some((entry) => entry.routine === values.aiRoutine)) {
    throw new Error(`AI routine ${values.aiRoutine} is not used by an existing trainer class.`);
  }

  const updatedNames = replaceNthMatchingLine(
    namesContents,
    (line) => /^\s*li\s+"[^"]*"/.test(line),
    classIndex,
    (line) => {
      const comment = lineComment(line);
      return `${leadingWhitespace(line)}li "${values.name.trim()}"${comment ? ` ${comment}` : ""}`;
    },
    "name",
  );

  const defeatNamePointer = namePointers[classIndex];
  let updatedNamePointers = namePointersContents;
  if (defeatNamePointer?.startsWith(".")) {
    updatedNamePointers = replaceStaticTrainerName(
      namePointersContents,
      defeatNamePointer,
      values.name.trim(),
    );
  } else if (defeatNamePointer !== "wTrainerName") {
    throw new Error(
      `Trainer class ${classConstant} uses unsupported defeat-speech name pointer '${defeatNamePointer ?? "missing"}'.`,
    );
  }

  const updatedMoney = replaceNthMatchingLine(
    moneyContents,
    (line) => /^\s*pic_money\s+/i.test(withoutComment(line)),
    classIndex,
    (line) => {
      const comment = lineComment(line);
      return `${leadingWhitespace(line)}pic_money ${values.picLabel}, ${values.baseRewardPerLevel * 100}${comment ? ` ${comment}` : ""}`;
    },
    "portrait/money",
  );

  const updatedAi = replaceNthMatchingLine(
    aiContents,
    (line) => /^\s*dbw\s+/i.test(withoutComment(line)),
    classIndex,
    (line) => `${leadingWhitespace(line)}dbw ${values.aiUsesPerPokemon}, ${values.aiRoutine} ; ${classConstant}`,
    "AI",
  );

  const choiceArgs = values.moveChoiceModifiers.length > 0
    ? ` ${[...values.moveChoiceModifiers].sort((a, b) => a - b).join(", ")}`
    : "";
  const updatedChoices = replaceNthMatchingLine(
    choicesContents,
    (line) => /^\s*move_choices(?:\s|$)/i.test(withoutComment(line)),
    classIndex,
    (line) => `${leadingWhitespace(line)}move_choices${choiceArgs} ; ${classConstant}`,
    "move-choice",
  );

  const updates = new Map<string, string>([
    [NAMES_PATH, updatedNames],
    [NAME_POINTERS_PATH, updatedNamePointers],
    [MONEY_PATH, updatedMoney],
    [AI_PATH, updatedAi],
    [MOVE_CHOICES_PATH, updatedChoices],
  ]);

  return [...updates.entries()]
    .filter(([path, nextContents]) => nextContents !== contents.get(path))
    .map(([path, nextContents]) => ({
      path,
      contents: nextContents,
      expectedHash: sourceDocuments.get(path)!.sourceHash,
    }));
}
export async function prepareTrainerClassWrites(
  source: ProjectSource,
  sources: TrainerEditSourceDocument[],
  values: TrainerClassCreateValues,
): Promise<TextWriteRequest[]> {
  const sourceDocuments = new Map(
    CLASS_SOURCE_PATHS.map((path) => [path, sourceDocument(sources, path)]),
  );

  const contents = new Map<string, string>();
  await Promise.all(CLASS_SOURCE_PATHS.map(async (path) => {
    contents.set(path, await source.readText(path));
  }));

  const constantsContents = contents.get(CONSTANTS_PATH)!;
  const namesContents = contents.get(NAMES_PATH)!;
  const namePointersContents = contents.get(NAME_POINTERS_PATH)!;
  const partiesContents = contents.get(PARTIES_PATH)!;
  const moneyContents = contents.get(MONEY_PATH)!;
  const aiContents = contents.get(AI_PATH)!;
  const moveChoicesContents = contents.get(MOVE_CHOICES_PATH)!;

  const constants = trainerConstants(constantsContents);
  const partyPointers = pointerEntries(partiesContents, "TrainerDataPointers");
  const names = trainerNames(namesContents);
  const namePointers = pointerEntries(namePointersContents, "TrainerNamePointers");
  const money = picMoneyEntries(moneyContents);
  const ai = aiEntries(aiContents);
  const choices = moveChoiceEntries(moveChoicesContents);

  const lengths = {
    constants: constants.length,
    partyPointers: partyPointers.length,
    names: names.length,
    namePointers: namePointers.length,
    money: money.length,
    ai: ai.length,
    moveChoices: choices.length,
  };
  for (const [label, length] of Object.entries(lengths)) {
    if (length !== constants.length) {
      throw new Error(
        `Trainer class creation requires synchronized trainer tables; ${label} has ${length} entries but constants has ${constants.length}.`,
      );
    }
  }

  if (constants.includes(values.constant)) {
    throw new Error(`Trainer class ${values.constant} already exists.`);
  }

  const offset = opponentIdOffset(constantsContents);
  if (offset === null) {
    throw new Error("Could not determine OPP_ID_OFFSET from trainer constants.");
  }
  const nextClassId = constants.length + 1;
  if (offset + nextClassId > 0xff) {
    throw new Error("The vanilla one-byte opponent ID range has no remaining trainer class slots.");
  }

  const portraitIndex = constants.indexOf(values.portraitClassConstant);
  if (portraitIndex < 0 || !money[portraitIndex]) {
    throw new Error("Could not resolve the selected existing trainer portrait.");
  }
  if (!ai.some((entry) => entry.routine === values.aiRoutine)) {
    throw new Error(`AI routine ${values.aiRoutine} is not used by an existing trainer class.`);
  }

  const stem = pascalConstant(values.constant);
  const partyLabel = `${stem}Data`;
  const nameLabel = `.${stem}Name`;
  if (new RegExp(`^\\s*${partyLabel}::{0,1}\\s*(?:;.*)?$`, "m").test(partiesContents)) {
    throw new Error(`Party data label ${partyLabel} already exists.`);
  }
  if (namePointersContents.includes(`${nameLabel}:`)) {
    throw new Error(`Trainer name label ${nameLabel} already exists.`);
  }

  let updatedConstants = insertBefore(
    constantsContents,
    (line) => /^\s*DEF\s+NUM_TRAINERS\s+EQU\b/i.test(line),
    `\ttrainer_const ${values.constant}`,
    "NUM_TRAINERS",
  );

  let updatedNames = insertBefore(
    namesContents,
    (line) => /^\s*assert_list_length\s+NUM_TRAINERS\b/i.test(line),
    `\tli "${values.name.trim()}"`,
    "trainer name table assertion",
  );

  let updatedNamePointers = insertBefore(
    namePointersContents,
    (line) => /^\s*assert_table_length\s+NUM_TRAINERS\b/i.test(line),
    `\tdw ${nameLabel}`,
    "trainer name pointer assertion",
  );
  updatedNamePointers = appendBlock(updatedNamePointers, [
    `${nameLabel}: db "${values.name.trim()}@"`,
  ]);

  let updatedParties = insertBefore(
    partiesContents,
    (line) => /^\s*assert_table_length\s+NUM_TRAINERS\b/i.test(line),
    `\tdw ${partyLabel}`,
    "trainer party pointer assertion",
  );
  updatedParties = appendBlock(updatedParties, [
    `${partyLabel}:`,
    partyDataLine(values),
  ]);

  const updatedMoney = insertBefore(
    moneyContents,
    (line) => /^\s*assert_table_length\s+NUM_TRAINERS\b/i.test(line),
    `\tpic_money ${money[portraitIndex].picLabel}, ${values.baseRewardPerLevel * 100}`,
    "trainer picture/money assertion",
  );

  const updatedAi = insertBefore(
    aiContents,
    (line) => /^\s*assert_table_length\s+NUM_TRAINERS\b/i.test(line),
    `\tdbw ${values.aiUsesPerPokemon}, ${values.aiRoutine} ; ${values.constant}`,
    "trainer AI assertion",
  );

  const choiceArgs = values.moveChoiceModifiers.length > 0
    ? ` ${values.moveChoiceModifiers.join(", ")}`
    : "";
  const updatedChoices = insertBefore(
    moveChoicesContents,
    (line) => /^\s*assert\s+__move_choices__\s*==\s*NUM_TRAINERS\b/i.test(line),
    `\tmove_choices${choiceArgs} ; ${values.constant}`,
    "trainer move-choice assertion",
  );

  const updates = new Map<string, string>([
    [CONSTANTS_PATH, updatedConstants],
    [NAMES_PATH, updatedNames],
    [NAME_POINTERS_PATH, updatedNamePointers],
    [PARTIES_PATH, updatedParties],
    [MONEY_PATH, updatedMoney],
    [AI_PATH, updatedAi],
    [MOVE_CHOICES_PATH, updatedChoices],
  ]);

  return CLASS_SOURCE_PATHS.map((path) => ({
    path,
    contents: updates.get(path)!,
    expectedHash: sourceDocuments.get(path)!.sourceHash,
  }));
}
