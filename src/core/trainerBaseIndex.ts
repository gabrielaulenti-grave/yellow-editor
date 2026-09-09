import { hashText } from "./history";
import type {
  ProjectSource,
  TrainerCatalog,
  TrainerClassEntry,
  TrainerPartyEntry,
  TrainerSpecialMove,
} from "./types";

const PARTIES_PATH = "data/trainers/parties.asm";
const NAMES_PATH = "data/trainers/names.asm";
const MONEY_PATH = "data/trainers/pic_pointers_money.asm";
const AI_PATH = "data/trainers/ai_pointers.asm";
const MOVE_CHOICES_PATH = "data/trainers/move_choices.asm";
const SPECIAL_MOVES_PATH = "data/trainers/special_moves.asm";
const CONSTANTS_PATH = "constants/trainer_constants.asm";

interface TrainerClassData {
  constant: string;
  label: string;
  name: string;
  baseRewardPerLevel: number | null;
  aiRoutine: string | null;
  aiUsesPerPokemon: number | null;
  moveChoiceModifiers: number[];
}

interface GlobalLabelSection {
  label: string;
  startLine: number;
  source: string;
}

function withoutComment(line: string): string {
  return line.split(";", 1)[0].trim();
}

function splitArguments(line: string, directive: string): string[] | null {
  const clean = withoutComment(line);
  const match = clean.match(new RegExp(`^${directive}\\s+(.+)$`, "i"));
  return match ? match[1].split(",").map((part) => part.trim()) : null;
}

function parseNumber(value: string): number | null {
  if (/^\d+$/.test(value)) {
    return Number(value);
  }
  if (/^\$[0-9a-f]+$/i.test(value)) {
    return Number.parseInt(value.slice(1), 16);
  }
  return null;
}

function labelBlocks(contents: string): Map<string, string> {
  const lines = contents.split(/\r?\n/);
  const starts: Array<{ label: string; index: number }> = [];
  lines.forEach((line, index) => {
    const match = line.match(/^\s*([A-Za-z_.][A-Za-z0-9_.]*):{1,2}\s*(?:;.*)?$/);
    if (match) {
      starts.push({ label: match[1], index });
    }
  });
  const blocks = new Map<string, string>();
  starts.forEach((start, index) => {
    const end = starts[index + 1]?.index ?? lines.length;
    blocks.set(start.label, lines.slice(start.index + 1, end).join("\n"));
  });
  return blocks;
}

function globalLabelSections(contents: string): GlobalLabelSection[] {
  const lines = contents.split(/\r?\n/);
  const starts: Array<{ label: string; index: number }> = [];
  lines.forEach((line, index) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*):{1,2}\s*(?:;.*)?$/);
    if (match) {
      starts.push({ label: match[1], index });
    }
  });
  return starts.map((start, index) => {
    const end = starts[index + 1]?.index ?? lines.length;
    return {
      label: start.label,
      startLine: start.index + 1,
      source: lines.slice(start.index, end).join("\n").trimEnd(),
    };
  });
}

function trainerConstants(contents: string): string[] {
  return [...contents.matchAll(/^\s*trainer_const\s+([A-Z][A-Z0-9_]*)\b/gm)]
    .map((match) => match[1])
    .filter((constant) => constant !== "NOBODY");
}

function partyPointerLabels(contents: string): string[] {
  const pointerBlock = labelBlocks(contents).get("TrainerDataPointers") ?? "";
  return [...pointerBlock.matchAll(/^\s*dw\s+([A-Za-z_][A-Za-z0-9_]*)\b/gm)]
    .map((match) => match[1]);
}

function trainerNames(contents: string): string[] {
  return [...contents.matchAll(/^\s*li\s+"([^"]*)"/gm)].map((match) => match[1]);
}

function rewardRates(contents: string): number[] {
  return [...contents.matchAll(/^\s*pic_money\s+[^,]+,\s*(\d+)\b/gm)]
    .map((match) => Number(match[1]) / 100);
}

function aiEntries(contents: string): Array<{ uses: number; routine: string }> {
  return [...contents.matchAll(/^\s*dbw\s+(\d+)\s*,\s*([A-Za-z_][A-Za-z0-9_]*)/gm)]
    .map((match) => ({ uses: Number(match[1]), routine: match[2] }));
}

function moveChoiceEntries(contents: string): number[][] {
  const result: number[][] = [];
  for (const line of contents.split(/\r?\n/)) {
    const match = withoutComment(line).match(/^move_choices(?:\s+(.+))?$/);
    if (!match) {
      continue;
    }
    result.push(match[1]
      ? match[1].split(",").map((item) => Number(item.trim())).filter(Number.isFinite)
      : []);
  }
  return result;
}

function parseClassData(
  constants: string[],
  labels: string[],
  names: string[],
  rewards: number[],
  ai: Array<{ uses: number; routine: string }>,
  choices: number[][],
): TrainerClassData[] {
  return constants.map((constant, index) => ({
    constant,
    label: labels[index] ?? "",
    name: names[index] ?? constant,
    baseRewardPerLevel: rewards[index] ?? null,
    aiRoutine: ai[index]?.routine ?? null,
    aiUsesPerPokemon: ai[index]?.uses ?? null,
    moveChoiceModifiers: choices[index] ?? [],
  }));
}

function parsePartyEntries(
  contents: string,
  classes: TrainerClassData[],
): TrainerPartyEntry[] {
  const sections = new Map(globalLabelSections(contents).map((section) => [
    section.label,
    section,
  ]));
  const entries: TrainerPartyEntry[] = [];

  for (const trainerClass of classes) {
    const section = sections.get(trainerClass.label);
    if (!section) {
      continue;
    }
    let partyNumber = 0;
    const sectionLines = section.source.split(/\r?\n/);
    for (let lineIndex = 1; lineIndex < sectionLines.length; lineIndex += 1) {
      const values = splitArguments(sectionLines[lineIndex], "db");
      if (!values) {
        continue;
      }
      const first = parseNumber(values[0]);
      if (first === null || values[values.length - 1] !== "0") {
        continue;
      }
      partyNumber += 1;
      const pokemon: TrainerPartyEntry["pokemon"] = [];
      if (first === 0xff) {
        for (let index = 1; index + 1 < values.length; index += 2) {
          const level = parseNumber(values[index]);
          if (level === null) {
            throw new Error(`${trainerClass.label} party ${partyNumber} has a non-numeric level.`);
          }
          pokemon.push({ level, speciesConstant: values[index + 1], specialMoves: [] });
        }
      } else {
        for (const speciesConstant of values.slice(1, -1)) {
          pokemon.push({ level: first, speciesConstant, specialMoves: [] });
        }
      }
      if (pokemon.length === 0) {
        throw new Error(`${trainerClass.label} party ${partyNumber} has no Pokémon.`);
      }
      const sourceLine = section.startLine + lineIndex;
      const finalLevel = pokemon[pokemon.length - 1].level;
      entries.push({
        id: `${trainerClass.constant}:${partyNumber}`,
        classConstant: trainerClass.constant,
        className: trainerClass.name,
        partyNumber,
        partyFormat: first === 0xff ? "individual-levels" : "shared-level",
        pokemon,
        instances: [],
        scriptReferences: [],
        baseRewardPerLevel: trainerClass.baseRewardPerLevel,
        calculatedPrize: trainerClass.baseRewardPerLevel === null
          ? null
          : trainerClass.baseRewardPerLevel * finalLevel,
        aiRoutine: trainerClass.aiRoutine,
        aiUsesPerPokemon: trainerClass.aiUsesPerPokemon,
        moveChoiceModifiers: trainerClass.moveChoiceModifiers,
        specialMoves: [],
        sourcePath: PARTIES_PATH,
        sourceLine,
      });
    }
  }
  return entries;
}

function parseSpecialMoves(contents: string, projectName: string): Map<string, TrainerSpecialMove[]> {
  const result = new Map<string, TrainerSpecialMove[]>();
  if (projectName === "pokeyellow") {
    const block = labelBlocks(contents).get("SpecialTrainerMoves") ?? "";
    let activeKey: string | null = null;
    for (const line of block.split(/\r?\n/)) {
      const values = splitArguments(line, "db");
      if (!values) {
        continue;
      }
      if (values.length === 1) {
        if (values[0] === "0") {
          activeKey = null;
        }
        if (values[0] === "-1") {
          break;
        }
        continue;
      }
      if (values.length === 2) {
        const party = parseNumber(values[1]);
        activeKey = party === null ? null : `${values[0]}:${party}`;
        if (activeKey && !result.has(activeKey)) {
          result.set(activeKey, []);
        }
        continue;
      }
      if (values.length === 3 && activeKey) {
        const pokemonIndex = parseNumber(values[0]);
        const moveSlot = parseNumber(values[1]);
        if (pokemonIndex !== null && moveSlot !== null) {
          result.get(activeKey)?.push({
            scope: "party",
            pokemonIndex,
            moveSlot,
            moveConstant: values[2],
            sourceKind: "yellow-party",
            sourceKey: activeKey,
          });
        }
      }
    }
    return result;
  }

  const block = labelBlocks(contents).get("TeamMoves") ?? "";
  for (const line of block.split(/\r?\n/)) {
    const values = splitArguments(line, "db");
    if (!values || values.length !== 2 || values[0] === "-1") {
      continue;
    }
    result.set(`${values[0]}:*`, [{
      scope: "class",
      pokemonIndex: 5,
      moveSlot: 3,
      moveConstant: values[1],
      sourceKind: "red-class",
      sourceKey: `${values[0]}:*`,
    }]);
  }
  return result;
}

function applySpecialMoves(
  trainers: TrainerPartyEntry[],
  specialMoves: Map<string, TrainerSpecialMove[]>,
): void {
  for (const trainer of trainers) {
    trainer.specialMoves = [
      ...(specialMoves.get(`${trainer.classConstant}:*`) ?? []),
      ...(specialMoves.get(trainer.id) ?? []),
    ];
    for (const specialMove of trainer.specialMoves) {
      if (specialMove.pokemonIndex !== null) {
        trainer.pokemon[specialMove.pokemonIndex - 1]?.specialMoves.push(specialMove);
      }
    }
  }
}

function buildClassCatalog(
  classes: TrainerClassData[],
  trainers: TrainerPartyEntry[],
): TrainerClassEntry[] {
  return classes.map((trainerClass) => {
    const parties = trainers.filter((trainer) => trainer.classConstant === trainerClass.constant);
    const classSpecialMoves = new Map<string, TrainerSpecialMove>();
    for (const move of parties.flatMap((party) => party.specialMoves)) {
      if (move.scope === "class") {
        classSpecialMoves.set(
          `${move.pokemonIndex}:${move.moveSlot}:${move.moveConstant}`,
          move,
        );
      }
    }
    return {
      constant: trainerClass.constant,
      name: trainerClass.name,
      partyIds: parties.map((party) => party.id),
      partyCount: parties.length,
      placedInstanceCount: 0,
      scriptReferenceCount: 0,
      affectedLocations: [],
      baseRewardPerLevel: trainerClass.baseRewardPerLevel,
      aiRoutine: trainerClass.aiRoutine,
      aiUsesPerPokemon: trainerClass.aiUsesPerPokemon,
      moveChoiceModifiers: trainerClass.moveChoiceModifiers,
      classSpecialMoves: [...classSpecialMoves.values()],
      sourcePaths: [
        CONSTANTS_PATH,
        NAMES_PATH,
        MONEY_PATH,
        AI_PATH,
        MOVE_CHOICES_PATH,
        PARTIES_PATH,
      ],
    };
  });
}

export async function parseTrainerBaseCatalog(
  source: ProjectSource,
  projectName: string,
): Promise<TrainerCatalog> {
  const required = [
    PARTIES_PATH,
    CONSTANTS_PATH,
    NAMES_PATH,
    MONEY_PATH,
    AI_PATH,
    MOVE_CHOICES_PATH,
  ];
  const exists = await Promise.all(required.map((path) => source.exists(path)));
  const missingIndex = exists.findIndex((present) => !present);
  if (missingIndex >= 0) {
    throw new Error(`Trainer browser requires ${required[missingIndex]}.`);
  }

  const [
    partiesContents,
    constantsContents,
    namesContents,
    moneyContents,
    aiContents,
    choicesContents,
  ] = await Promise.all([
    source.readText(PARTIES_PATH),
    source.readText(CONSTANTS_PATH),
    source.readText(NAMES_PATH),
    source.readText(MONEY_PATH),
    source.readText(AI_PATH),
    source.readText(MOVE_CHOICES_PATH),
  ]);

  const constants = trainerConstants(constantsContents);
  const labels = partyPointerLabels(partiesContents);
  const names = trainerNames(namesContents);
  const rewards = rewardRates(moneyContents);
  const ai = aiEntries(aiContents);
  const choices = moveChoiceEntries(choicesContents);
  const warnings: string[] = [];
  const lengths = {
    constants: constants.length,
    labels: labels.length,
    names: names.length,
    rewards: rewards.length,
    ai: ai.length,
    choices: choices.length,
  };
  const expected = constants.length;
  for (const [label, length] of Object.entries(lengths)) {
    if (length !== expected) {
      warnings.push(`Trainer ${label} table has ${length} entries; expected ${expected}.`);
    }
  }

  const classes = parseClassData(constants, labels, names, rewards, ai, choices);
  const trainers = parsePartyEntries(partiesContents, classes);
  const specialMovesContents = await source.exists(SPECIAL_MOVES_PATH)
    ? await source.readText(SPECIAL_MOVES_PATH)
    : null;
  if (specialMovesContents !== null) {
    applySpecialMoves(trainers, parseSpecialMoves(specialMovesContents, projectName));
  }

  const editSourceContents: Array<[string, string]> = [
    [PARTIES_PATH, partiesContents],
    ...(specialMovesContents === null
      ? []
      : [[SPECIAL_MOVES_PATH, specialMovesContents] as [string, string]]),
  ];

  return {
    trainers,
    classes: buildClassCatalog(classes, trainers),
    editSources: await Promise.all(editSourceContents.map(async ([path, contents]) => ({
      path,
      sourceHash: await hashText(contents),
    }))),
    warnings,
  };
}
