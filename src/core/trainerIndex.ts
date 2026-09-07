import { mapConstantDisplayName } from "./mapMetadata";
import type {
  ProjectSource,
  TrainerCatalog,
  TrainerDialogue,
  TrainerInstance,
  TrainerLoadProgressListener,
  TrainerPartyEntry,
  TrainerSpecialMove,
} from "./types";

const PARTIES_PATH = "data/trainers/parties.asm";
const NAMES_PATH = "data/trainers/names.asm";
const MONEY_PATH = "data/trainers/pic_pointers_money.asm";
const AI_PATH = "data/trainers/ai_pointers.asm";
const MOVE_CHOICES_PATH = "data/trainers/move_choices.asm";
const SPECIAL_MOVES_PATH = "data/trainers/special_moves.asm";
const MAPS_PATH = "maps.asm";

interface TrainerClassData {
  constant: string;
  label: string;
  name: string;
  baseRewardPerLevel: number | null;
  aiRoutine: string | null;
  aiUsesPerPokemon: number | null;
  moveChoiceModifiers: number[];
}

interface ParsedHeader {
  label: string;
  eventFlag: string;
  viewRange: number;
  beforeLabel: string;
  defeatLabel: string;
  afterLabel: string;
}

interface TextSourceBlock {
  block: string;
  path: string;
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

function includedPaths(contents: string, prefix: string): string[] {
  return [...contents.matchAll(/^\s*INCLUDE\s+"([^"]+)"/gm)]
    .map((match) => match[1])
    .filter((path) => path.startsWith(prefix));
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
  const blocks = labelBlocks(contents);
  const lines = contents.split(/\r?\n/);
  const lineByText = new Map<string, number[]>();
  lines.forEach((line, index) => {
    const clean = withoutComment(line);
    const existing = lineByText.get(clean) ?? [];
    existing.push(index + 1);
    lineByText.set(clean, existing);
  });

  const entries: TrainerPartyEntry[] = [];
  for (const trainerClass of classes) {
    const block = blocks.get(trainerClass.label);
    if (!block) {
      continue;
    }
    let partyNumber = 0;
    for (const line of block.split(/\r?\n/)) {
      const values = splitArguments(line, "db");
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
      const sourceLine = lineByText.get(withoutComment(line))?.shift() ?? 0;
      const finalLevel = pokemon[pokemon.length - 1].level;
      entries.push({
        id: `${trainerClass.constant}:${partyNumber}`,
        classConstant: trainerClass.constant,
        className: trainerClass.name,
        partyNumber,
        partyFormat: first === 0xff ? "individual-levels" : "shared-level",
        pokemon,
        instances: [],
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
    }]);
  }
  const loneMoves = labelBlocks(contents).get("LoneMoves") ?? "";
  let loneMoveIndex = 0;
  for (const line of loneMoves.split(/\r?\n/)) {
    const values = splitArguments(line, "db");
    if (!values || values.length !== 2) {
      continue;
    }
    const pokemonIndex = parseNumber(values[0]);
    if (pokemonIndex === null) {
      continue;
    }
    loneMoveIndex += 1;
    result.set(`LONE:${loneMoveIndex}`, [{
      scope: "party",
      pokemonIndex,
      moveSlot: 3,
      moveConstant: values[1],
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

function parseHeaders(contents: string): Map<string, ParsedHeader> {
  const lines = contents.split(/\r?\n/);
  const headers = new Map<string, ParsedHeader>();
  for (let index = 0; index < lines.length; index += 1) {
    const label = lines[index].match(/^\s*([A-Za-z_][A-Za-z0-9_]*):{1,2}\s*(?:;.*)?$/)?.[1];
    if (!label) {
      continue;
    }
    let trainerLine = index + 1;
    while (trainerLine < lines.length && withoutComment(lines[trainerLine]) === "") {
      trainerLine += 1;
    }
    const values = splitArguments(lines[trainerLine] ?? "", "trainer");
    if (!values || values.length < 5) {
      continue;
    }
    const viewRange = parseNumber(values[1]);
    if (viewRange === null) {
      continue;
    }
    headers.set(label, {
      label,
      eventFlag: values[0],
      viewRange,
      beforeLabel: values[2],
      defeatLabel: values[3],
      afterLabel: values[4],
    });
  }
  return headers;
}

function textPointerLabels(contents: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of contents.matchAll(/^\s*dw_const\s+([A-Za-z_.][A-Za-z0-9_.]*)\s*,\s*(TEXT_[A-Z0-9_]+)\b/gm)) {
    result.set(match[2], match[1]);
  }
  return result;
}

function headerForWrapper(
  wrapperLabel: string,
  blocks: Map<string, string>,
  headers: Map<string, ParsedHeader>,
): ParsedHeader | null {
  const block = blocks.get(wrapperLabel) ?? "";
  for (const match of block.matchAll(/^\s*ld\s+hl\s*,\s*([A-Za-z_][A-Za-z0-9_]*)\b/gm)) {
    const header = headers.get(match[1]);
    if (header) {
      return header;
    }
  }
  return null;
}

function parseQuotedText(block: string): string | null {
  const parts: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    const clean = withoutComment(line);
    const match = clean.match(/^(text|line|cont|para|page|next)\s+"((?:[^"\\]|\\.)*)"/);
    if (!match) {
      continue;
    }
    const separator = match[1] === "para" || match[1] === "page" ? "\n\n" : parts.length ? "\n" : "";
    parts.push(`${separator}${match[2].replace(/\\"/g, '"')}`);
  }
  return parts.length ? parts.join("") : null;
}

function dialogueFor(
  wrapperLabel: string,
  scriptBlocks: Map<string, string>,
  textBlocks: Map<string, TextSourceBlock>,
): TrainerDialogue {
  const wrapper = scriptBlocks.get(wrapperLabel) ?? "";
  const textLabel = wrapper.match(/^\s*text_far\s+([A-Za-z_.][A-Za-z0-9_.]*)\b/m)?.[1] ?? null;
  const sourceBlock = textLabel ? textBlocks.get(textLabel) : null;
  return {
    wrapperLabel,
    textLabel,
    text: sourceBlock ? parseQuotedText(sourceBlock.block) : null,
    sourcePath: sourceBlock?.path ?? null,
  };
}

function objectConstants(contents: string): string[] {
  return [...contents.matchAll(/^\s*const_export\s+([A-Z][A-Z0-9_]*)\b/gm)]
    .map((match) => match[1]);
}

async function readTextFiles(
  source: ProjectSource,
  paths: string[],
  onProgress: (completed: number, total: number) => void,
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  let nextIndex = 0;
  let completed = 0;
  const workerCount = Math.min(12, paths.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < paths.length) {
      const path = paths[nextIndex];
      nextIndex += 1;
      files.set(path, await source.readText(path));
      completed += 1;
      const updateInterval = Math.max(1, Math.ceil(paths.length / 20));
      if (completed === paths.length || completed % updateInterval === 0) {
        onProgress(completed, paths.length);
      }
    }
  });
  await Promise.all(workers);
  return files;
}

function parseMapInstances(
  objectPath: string,
  objectContents: string,
  scriptPath: string | null,
  scriptContents: string,
  textBlocks: Map<string, TextSourceBlock>,
): Array<{ partyId: string; instance: TrainerInstance; loneMoveIndex: number | null }> {
  const mapConstant = objectContents.match(/^\s*def_warps_to\s+([A-Z][A-Z0-9_]*)\b/m)?.[1]
    ?? objectPath.split("/").pop()?.replace(/\.asm$/, "").toUpperCase()
    ?? "UNKNOWN_MAP";
  const scriptBlocks = labelBlocks(scriptContents);
  const headers = parseHeaders(scriptContents);
  const pointers = textPointerLabels(scriptContents);
  const constants = objectConstants(objectContents);
  const loneMoveIndex = parseNumber(
    scriptContents.match(/^\s*ld\s+a\s*,\s*([^\s;]+)\s*(?:;.*)?\r?\n\s*ld\s+\[wGymLeaderNo\]\s*,\s*a\b/m)?.[1] ?? "",
  );
  const results: Array<{ partyId: string; instance: TrainerInstance; loneMoveIndex: number | null }> = [];
  let objectIndex = 0;
  for (const line of objectContents.split(/\r?\n/)) {
    const values = splitArguments(line, "object_event");
    if (!values) {
      continue;
    }
    const objectConstant = constants[objectIndex] ?? null;
    objectIndex += 1;
    if (values.length < 8 || !/^OPP_[A-Z0-9_]+$/.test(values[6])) {
      continue;
    }
    const x = parseNumber(values[0]);
    const y = parseNumber(values[1]);
    const partyNumber = parseNumber(values[7]);
    if (x === null || y === null || partyNumber === null) {
      continue;
    }
    const classConstant = values[6].slice(4);
    const wrapperLabel = pointers.get(values[5]) ?? null;
    const header = wrapperLabel ? headerForWrapper(wrapperLabel, scriptBlocks, headers) : null;
    const dialogue = header ? {
      before: dialogueFor(header.beforeLabel, scriptBlocks, textBlocks),
      defeat: dialogueFor(header.defeatLabel, scriptBlocks, textBlocks),
      after: dialogueFor(header.afterLabel, scriptBlocks, textBlocks),
    } : { before: null, defeat: null, after: null };
    results.push({
      partyId: `${classConstant}:${partyNumber}`,
      loneMoveIndex,
      instance: {
        id: `${mapConstant}:${objectConstant ?? objectIndex}`,
        mapConstant,
        locationName: mapConstantDisplayName(mapConstant),
        objectConstant,
        objectPath,
        scriptPath,
        x,
        y,
        spriteConstant: values[2],
        facingConstant: values[4],
        textConstant: values[5],
        triggerKind: header ? (header.viewRange === 0 ? "talk" : "sight") : "scripted",
        viewRange: header?.viewRange ?? null,
        eventFlag: header?.eventFlag ?? null,
        trainerHeaderLabel: header?.label ?? null,
        dialogue,
      },
    });
  }
  return results;
}

function pathStem(path: string): string {
  return path.split("/").pop()?.replace(/\.asm$/, "") ?? "";
}

function addTextBlocks(
  textBlocks: Map<string, TextSourceBlock>,
  files: Map<string, string>,
): void {
  for (const [path, contents] of files) {
    for (const [label, block] of labelBlocks(contents)) {
      textBlocks.set(label, { block, path });
    }
  }
}

function unresolvedDialogueLabels(
  mapResults: Array<Array<{ partyId: string; instance: TrainerInstance; loneMoveIndex: number | null }>>,
): Set<string> {
  const labels = new Set<string>();
  for (const result of mapResults.flat()) {
    for (const dialogue of Object.values(result.instance.dialogue)) {
      if (dialogue?.textLabel && !dialogue.sourcePath) {
        labels.add(dialogue.textLabel);
      }
    }
  }
  return labels;
}

export async function parseTrainerCatalog(
  source: ProjectSource,
  projectName: string,
  onProgress?: TrainerLoadProgressListener,
): Promise<TrainerCatalog> {
  onProgress?.({
    stage: "tables",
    message: "Reading trainer tables",
    completed: 0,
    total: 1,
    percent: 10,
  });
  const required = [PARTIES_PATH, NAMES_PATH, MONEY_PATH, AI_PATH, MOVE_CHOICES_PATH, MAPS_PATH];
  for (const path of required) {
    if (!(await source.exists(path))) {
      throw new Error(`Trainer browser requires ${path}.`);
    }
  }
  const [partiesContents, constantsContents, namesContents, moneyContents, aiContents, choicesContents, mapsContents] = await Promise.all([
    source.readText(PARTIES_PATH),
    source.readText("constants/trainer_constants.asm"),
    source.readText(NAMES_PATH),
    source.readText(MONEY_PATH),
    source.readText(AI_PATH),
    source.readText(MOVE_CHOICES_PATH),
    source.readText(MAPS_PATH),
  ]);
  const constants = trainerConstants(constantsContents);
  const labels = partyPointerLabels(partiesContents);
  const names = trainerNames(namesContents);
  const rewards = rewardRates(moneyContents);
  const ai = aiEntries(aiContents);
  const choices = moveChoiceEntries(choicesContents);
  const warnings: string[] = [];
  const lengths = { constants: constants.length, labels: labels.length, names: names.length, rewards: rewards.length, ai: ai.length, choices: choices.length };
  const expected = constants.length;
  for (const [label, length] of Object.entries(lengths)) {
    if (length !== expected) {
      warnings.push(`Trainer ${label} table has ${length} entries; expected ${expected}.`);
    }
  }

  const classes = parseClassData(constants, labels, names, rewards, ai, choices);
  const trainers = parsePartyEntries(partiesContents, classes);
  const specialMoves = await source.exists(SPECIAL_MOVES_PATH)
    ? parseSpecialMoves(await source.readText(SPECIAL_MOVES_PATH), projectName)
    : new Map<string, TrainerSpecialMove[]>();
  applySpecialMoves(trainers, specialMoves);
  onProgress?.({
    stage: "tables",
    message: `${trainers.length} trainer parties found`,
    completed: 1,
    total: 1,
    percent: 15,
  });

  const byId = new Map(trainers.map((trainer) => [trainer.id, trainer]));
  const objectPaths = includedPaths(mapsContents, "data/maps/objects/");
  const objectFiles = await readTextFiles(source, objectPaths, (completed, total) => {
    onProgress?.({
      stage: "maps",
      message: "Scanning maps for trainer instances",
      completed,
      total,
      percent: 15 + Math.round((completed / Math.max(total, 1)) * 30),
    });
  });
  const trainerObjectPaths = objectPaths.filter((path) =>
    /^\s*object_event\b.*\bOPP_[A-Z0-9_]+\b/m.test(objectFiles.get(path) ?? ""),
  );

  const scriptPaths = includedPaths(mapsContents, "scripts/");
  const scriptPathByStem = new Map(scriptPaths.map((path) => [pathStem(path), path]));
  const trainerScriptPaths = [...new Set(trainerObjectPaths
    .map((path) => scriptPathByStem.get(pathStem(path)))
    .filter((path): path is string => Boolean(path)))];
  const scriptFiles = await readTextFiles(source, trainerScriptPaths, (completed, total) => {
    onProgress?.({
      stage: "scripts",
      message: "Resolving trainer triggers and event flags",
      completed,
      total,
      percent: 45 + Math.round((completed / Math.max(total, 1)) * 20),
    });
  });

  const textBlocks = new Map<string, TextSourceBlock>();
  let textPaths: string[] = [];
  if (await source.exists("text.asm")) {
    const textIndex = await source.readText("text.asm");
    textPaths = includedPaths(textIndex, "text/");
    const trainerMapStems = trainerObjectPaths.map(pathStem);
    const likelyTextPaths = textPaths.filter((path) => {
      const stem = pathStem(path);
      return trainerMapStems.some((mapStem) =>
        stem === mapStem || stem.startsWith(`${mapStem}_`),
      );
    });
    const textFiles = await readTextFiles(source, likelyTextPaths, (completed, total) => {
      onProgress?.({
        stage: "dialogue",
        message: "Loading trainer dialogue",
        completed,
        total,
        percent: 65 + Math.round((completed / Math.max(total, 1)) * 28),
      });
    });
    addTextBlocks(textBlocks, textFiles);
  } else {
    warnings.push("Could not resolve trainer dialogue because text.asm is missing.");
  }

  const parseMaps = () => trainerObjectPaths.map((path) => {
    const scriptPath = scriptPathByStem.get(pathStem(path)) ?? null;
    return parseMapInstances(
      path,
      objectFiles.get(path) ?? "",
      scriptPath,
      scriptPath ? scriptFiles.get(scriptPath) ?? "" : "",
      textBlocks,
    );
  });
  let mapResults = parseMaps();
  const unresolvedLabels = unresolvedDialogueLabels(mapResults);
  if (unresolvedLabels.size > 0 && textPaths.length > 0) {
    const loadedPaths = new Set([...textBlocks.values()].map((entry) => entry.path));
    const fallbackPaths = textPaths.filter((path) => !loadedPaths.has(path));
    const fallbackFiles = await readTextFiles(source, fallbackPaths, (completed, total) => {
      onProgress?.({
        stage: "dialogue",
        message: `Searching for ${unresolvedLabels.size} relocated dialogue label${unresolvedLabels.size === 1 ? "" : "s"}`,
        completed,
        total,
        percent: 93 + Math.round((completed / Math.max(total, 1)) * 6),
      });
    });
    addTextBlocks(textBlocks, fallbackFiles);
    mapResults = parseMaps();
  }
  for (const result of mapResults.flat()) {
    const trainer = byId.get(result.partyId);
    if (trainer) {
      trainer.instances.push(result.instance);
      if (result.loneMoveIndex !== null && result.instance.triggerKind === "scripted") {
        for (const move of specialMoves.get(`LONE:${result.loneMoveIndex}`) ?? []) {
          if (!trainer.specialMoves.some((existing) =>
            existing.scope === move.scope &&
            existing.pokemonIndex === move.pokemonIndex &&
            existing.moveSlot === move.moveSlot &&
            existing.moveConstant === move.moveConstant
          )) {
            trainer.specialMoves.push(move);
            if (move.pokemonIndex !== null) {
              trainer.pokemon[move.pokemonIndex - 1]?.specialMoves.push(move);
            }
          }
        }
      }
    } else {
      warnings.push(`${result.instance.locationName} references missing trainer party ${result.partyId}.`);
    }
  }
  trainers.forEach((trainer) => trainer.instances.sort((left, right) => left.locationName.localeCompare(right.locationName)));
  onProgress?.({
    stage: "complete",
    message: `${trainers.length} trainer parties indexed`,
    completed: trainers.length,
    total: trainers.length,
    percent: 100,
  });
  return { trainers, warnings };
}
