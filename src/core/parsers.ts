import type {
  Evolution,
  LearnsetMove,
  MoveData,
  PokedexInfo,
  PokedexTextLine,
  PokemonBaseStats,
  PokemonDetails,
  PokemonIndexEntry,
  ProjectSource,
} from "./types";

function codeOnly(line: string): string {
  return (line.split(";", 1)[0] ?? "").trim();
}

function parseU8(value: string, field = "integer"): number {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`Expected ${field}, got '${value}'`);
  }

  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 0xff) {
    throw new Error(`Expected byte-sized ${field}, got '${value}'`);
  }

  return parsed;
}

function parseU16(value: string, field = "integer"): number {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`Expected ${field}, got '${value}'`);
  }

  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 0xffff) {
    throw new Error(`Expected 16-bit ${field}, got '${value}'`);
  }

  return parsed;
}

function parseDbValues(line: string): string[] {
  const withoutComment = codeOnly(line);
  if (!withoutComment.startsWith("db")) {
    throw new Error(`Expected db directive: ${line}`);
  }

  const data = withoutComment.slice(2).trim();
  return data.split(",").map((value) => value.trim());
}

function parseSingleU8(line: string): number {
  const values = parseDbValues(line);
  if (values.length !== 1) {
    throw new Error(`Expected one value, found ${values.length}`);
  }
  return parseU8(values[0]);
}

function normalizeSpeciesName(name: string): string {
  return [...name]
    .filter((character) => /[A-Za-z0-9]/.test(character))
    .join("")
    .toLowerCase();
}

function formatDisplayName(constant: string): string {
  const specialNames: Record<string, string> = {
    NIDORAN_M: "Nidoran♂",
    NIDORAN_F: "Nidoran♀",
    MR_MIME: "Mr. Mime",
    FARFETCHD: "Farfetch'd",
    FOSSIL_KABUTOPS: "Fossil Kabutops",
    FOSSIL_AERODACTYL: "Fossil Aerodactyl",
    MON_GHOST: "Ghost",
    NO_MON: "No Pokémon",
  };

  const special = specialNames[constant];
  if (special) {
    return special;
  }

  const lowercase = constant.toLowerCase();
  return lowercase.length > 0
    ? lowercase[0].toUpperCase() + lowercase.slice(1)
    : "";
}

async function parseBaseStatsSlugs(
  source: ProjectSource,
): Promise<Map<string, string>> {
  const contents = await source.readText("data/pokemon/base_stats.asm");
  const result = new Map<string, string>();

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    const prefix = 'INCLUDE "';
    if (!line.startsWith(prefix) || !line.endsWith('"')) {
      continue;
    }

    const includePath = line.slice(prefix.length, -1);
    const basePrefix = "data/pokemon/base_stats/";
    if (!includePath.startsWith(basePrefix) || !includePath.endsWith(".asm")) {
      continue;
    }

    const slug = includePath.slice(basePrefix.length, -4);
    result.set(normalizeSpeciesName(slug), slug);
  }

  return result;
}

export async function parsePokemonIndex(
  source: ProjectSource,
): Promise<PokemonIndexEntry[]> {
  const [sourceSlugs, contents] = await Promise.all([
    parseBaseStatsSlugs(source),
    source.readText("constants/pokemon_constants.asm"),
  ]);

  const entries: PokemonIndexEntry[] = [];
  let currentId = 0;

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = codeOnly(rawLine);
    if (!line) {
      continue;
    }

    if (line === "const_def") {
      currentId = 0;
      continue;
    }

    if (line === "const_skip") {
      entries.push({
        internalId: currentId,
        constant: null,
        displayName: "MissingNo.",
        kind: "missingno",
        sourceSlug: null,
      });
      currentId += 1;
      continue;
    }

    if (!line.startsWith("const ")) {
      continue;
    }

    const constant = line.slice("const ".length).trim();
    let kind: PokemonIndexEntry["kind"] = "pokemon";
    if (
      constant === "FOSSIL_KABUTOPS" ||
      constant === "FOSSIL_AERODACTYL" ||
      constant === "MON_GHOST"
    ) {
      kind = "special";
    } else if (constant === "NO_MON") {
      kind = "system";
    }

    entries.push({
      internalId: currentId,
      constant,
      displayName: formatDisplayName(constant),
      kind,
      sourceSlug: sourceSlugs.get(normalizeSpeciesName(constant)) ?? null,
    });
    currentId += 1;
  }

  if (await source.exists("data/pokemon/base_stats/mew.asm")) {
    const mew = entries.find((entry) => entry.constant === "MEW");
    if (mew && !mew.sourceSlug) {
      mew.sourceSlug = "mew";
    }
  }

  return entries;
}

export async function parseBaseStats(
  source: ProjectSource,
  sourceSlug: string,
): Promise<PokemonBaseStats> {
  const contents = await source.readText(
    `data/pokemon/base_stats/${sourceSlug}.asm`,
  );

  const dataLines = contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith(";"));

  const dexLine = dataLines.shift();
  if (!dexLine) {
    throw new Error("Missing Pokédex ID");
  }
  const dexValues = parseDbValues(dexLine);
  const dexConstant = dexValues[0];
  if (!dexConstant) {
    throw new Error("Missing Pokédex constant");
  }

  const statsLine = dataLines.shift();
  if (!statsLine) {
    throw new Error("Missing base stats");
  }
  const stats = parseDbValues(statsLine);
  if (stats.length !== 5) {
    throw new Error(`Expected 5 base stats, found ${stats.length}`);
  }

  const typesLine = dataLines.shift();
  if (!typesLine) {
    throw new Error("Missing types");
  }
  const types = parseDbValues(typesLine);
  if (types.length !== 2) {
    throw new Error("Expected exactly 2 Pokémon types");
  }

  const catchRateLine = dataLines.shift();
  if (!catchRateLine) {
    throw new Error("Missing catch rate");
  }

  const baseExpLine = dataLines.shift();
  if (!baseExpLine) {
    throw new Error("Missing base experience");
  }

  return {
    dexConstant,
    hp: parseU8(stats[0]),
    attack: parseU8(stats[1]),
    defense: parseU8(stats[2]),
    speed: parseU8(stats[3]),
    special: parseU8(stats[4]),
    type1: types[0],
    type2: types[1],
    catchRate: parseSingleU8(catchRateLine),
    baseExp: parseSingleU8(baseExpLine),
  };
}

export async function parsePokemonTmhmMoves(
  source: ProjectSource,
  sourceSlug: string,
): Promise<string[]> {
  const contents = await source.readText(
    `data/pokemon/base_stats/${sourceSlug}.asm`,
  );

  const moves: string[] = [];
  let collecting = false;

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = codeOnly(rawLine);
    if (!line) {
      continue;
    }

    let values: string | null = null;
    if (line.startsWith("tmhm ")) {
      collecting = true;
      values = line.slice("tmhm ".length);
    } else if (collecting) {
      values = line;
    }

    if (values === null) {
      continue;
    }

    const trimmedEnd = values.trimEnd();
    const continues = trimmedEnd.endsWith("\\");
    const moveList = (continues ? trimmedEnd.slice(0, -1) : trimmedEnd).trim();

    for (const value of moveList.split(",")) {
      const move = value.trim();
      if (move) {
        moves.push(move);
      }
    }

    if (!continues) {
      break;
    }
  }

  return moves;
}

function parsePointerTable(
  contents: string,
  startLabel: string,
): string[] {
  const labels: string[] = [];
  let inTable = false;

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === startLabel) {
      inTable = true;
      continue;
    }
    if (!inTable) {
      continue;
    }
    if (line.startsWith("assert_table_length")) {
      break;
    }
    if (line.startsWith("dw ")) {
      labels.push(line.slice(3).trim());
    }
  }

  return labels;
}

function parseEvolution(values: string[]): Evolution {
  const [method] = values;

  if (method === "EVOLVE_LEVEL" && values.length === 3) {
    return {
      method: "level",
      level: parseU8(values[1], "evolution level"),
      item: null,
      target: values[2],
    };
  }

  if (method === "EVOLVE_ITEM" && values.length === 4) {
    return {
      method: "item",
      level: parseU8(values[2], "evolution minimum level"),
      item: values[1],
      target: values[3],
    };
  }

  if (method === "EVOLVE_TRADE" && values.length === 3) {
    return {
      method: "trade",
      level: parseU8(values[1], "trade evolution minimum level"),
      item: null,
      target: values[2],
    };
  }

  throw new Error(`Unknown evolution format: ${values.join(", ")}`);
}

function parseEvosMovesBlock(block: string): {
  evolutions: Evolution[];
  learnset: LearnsetMove[];
} {
  const evolutions: Evolution[] = [];
  const learnset: LearnsetMove[] = [];
  let phase: "evolutions" | "learnset" = "evolutions";

  for (const rawLine of block.split(/\r?\n/)) {
    const line = codeOnly(rawLine);
    if (!line) {
      continue;
    }
    if (line.endsWith(":")) {
      break;
    }
    if (!line.startsWith("db ")) {
      continue;
    }

    const values = line
      .slice(3)
      .split(",")
      .map((value) => value.trim());

    if (values.length === 1 && values[0] === "0") {
      if (phase === "evolutions") {
        phase = "learnset";
        continue;
      }
      break;
    }

    if (phase === "evolutions") {
      evolutions.push(parseEvolution(values));
    } else {
      if (values.length !== 2) {
        throw new Error(`Invalid learnset row: ${line}`);
      }
      learnset.push({
        level: parseU8(values[0], "level"),
        moveConstant: values[1],
      });
    }
  }

  return { evolutions, learnset };
}

async function parseEvosMoves(
  source: ProjectSource,
  internalId: number,
): Promise<{ evolutions: Evolution[]; learnset: LearnsetMove[] }> {
  if (internalId === 0) {
    return { evolutions: [], learnset: [] };
  }

  const contents = await source.readText("data/pokemon/evos_moves.asm");
  const labels = parsePointerTable(contents, "EvosMovesPointerTable:");
  const label = labels[internalId - 1];
  if (!label) {
    throw new Error("No EvosMoves pointer for internal ID");
  }

  const marker = `${label}:`;
  const start = contents.indexOf(marker);
  if (start < 0) {
    throw new Error(`Could not find ${marker}`);
  }

  return parseEvosMovesBlock(contents.slice(start + marker.length));
}

function parsePokedexText(
  contents: string,
  textLabel: string,
): PokedexTextLine[] {
  const marker = `${textLabel}::`;
  const start = contents.indexOf(marker);
  if (start < 0) {
    throw new Error(`Could not find Pokédex text label ${marker}`);
  }

  const lines: PokedexTextLine[] = [];
  const block = contents.slice(start + marker.length);

  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (line === "dex" || line.endsWith("::")) {
      break;
    }

    for (const kind of ["text", "next", "page"] as const) {
      const prefix = `${kind} \"`;
      if (line.startsWith(prefix) && line.endsWith('"')) {
        lines.push({
          kind,
          text: line.slice(prefix.length, -1),
        });
        break;
      }
    }
  }

  return lines;
}

async function parsePokedexInfo(
  source: ProjectSource,
  internalId: number,
): Promise<PokedexInfo | null> {
  if (internalId === 0) {
    return null;
  }

  const [entriesContents, textContents] = await Promise.all([
    source.readText("data/pokemon/dex_entries.asm"),
    source.readText("data/pokemon/dex_text.asm"),
  ]);

  const labels = parsePointerTable(entriesContents, "PokedexEntryPointers:");
  const label = labels[internalId - 1];
  if (!label) {
    throw new Error("No Pokédex pointer for internal ID");
  }

  const marker = `${label}:`;
  const start = entriesContents.indexOf(marker);
  if (start < 0) {
    throw new Error(`Could not find Pokédex entry label ${marker}`);
  }

  const lines = entriesContents
    .slice(start + marker.length)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith(";"));

  const categoryLine = lines.shift();
  if (!categoryLine) {
    throw new Error("Missing Pokédex category");
  }
  if (!categoryLine.startsWith('db "') || !categoryLine.endsWith('"')) {
    throw new Error(`Invalid Pokédex category line: ${categoryLine}`);
  }
  const category = categoryLine.slice(4, -1).replace(/@+$/, "");

  const heightLine = lines.shift();
  if (!heightLine) {
    throw new Error("Missing Pokédex height");
  }
  const heightValues = parseDbValues(heightLine);
  if (heightValues.length !== 2) {
    throw new Error(`Expected 2 height values, found ${heightValues.length}`);
  }

  const weightLine = lines.shift();
  if (!weightLine) {
    throw new Error("Missing Pokédex weight");
  }
  if (!weightLine.startsWith("dw")) {
    throw new Error(`Expected dw directive for weight: ${weightLine}`);
  }
  const weightTenthsLb = parseU16(weightLine.slice(2).trim(), "Pokédex weight");

  const textLine = lines.shift();
  if (!textLine) {
    throw new Error("Missing Pokédex text label");
  }
  if (!textLine.startsWith("text_far ")) {
    throw new Error(`Expected text_far directive: ${textLine}`);
  }
  const textLabel = textLine.slice("text_far ".length).trim();

  return {
    category,
    heightFeet: parseU8(heightValues[0]),
    heightInches: parseU8(heightValues[1]),
    weightTenthsLb,
    textLabel,
    textLines: parsePokedexText(textContents, textLabel),
  };
}

export async function parsePokemonDetails(
  source: ProjectSource,
  internalId: number,
  sourceSlug: string,
): Promise<PokemonDetails> {
  const [stats, evolutionData, pokedex, front, back] = await Promise.all([
    parseBaseStats(source, sourceSlug),
    parseEvosMoves(source, internalId),
    parsePokedexInfo(source, internalId),
    source.assetUrl(`gfx/pokemon/front/${sourceSlug}.png`),
    source.assetUrl(`gfx/pokemon/back/${sourceSlug}b.png`),
  ]);

  return {
    stats,
    evolutions: evolutionData.evolutions,
    learnset: evolutionData.learnset,
    pokedex,
    sprites: { front, back },
  };
}

interface MoveRow {
  animation: string;
  effect: string;
  power: number;
  moveType: string;
  accuracy: number;
  pp: number;
}

function parseMoveRows(contents: string): MoveRow[] {
  const rows: MoveRow[] = [];

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = codeOnly(rawLine);
    if (!line.startsWith("move ")) {
      continue;
    }

    const fields = line
      .slice("move ".length)
      .split(",")
      .map((field) => field.trim());
    if (fields.length !== 6) {
      continue;
    }

    rows.push({
      animation: fields[0],
      effect: fields[1],
      power: parseU8(fields[2], "move power"),
      moveType: fields[3],
      accuracy: parseU8(fields[4], "move accuracy"),
      pp: parseU8(fields[5], "move PP"),
    });
  }

  if (rows.length === 0) {
    throw new Error("No move rows found in data/moves/moves.asm");
  }

  return rows;
}

function parseMoveConstants(contents: string): string[] {
  const constants: string[] = [];
  let inMoveIds = false;

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = codeOnly(rawLine);

    if (line === "const_def" && !inMoveIds) {
      inMoveIds = true;
      continue;
    }
    if (!inMoveIds) {
      continue;
    }

    if (line.startsWith("const ")) {
      const name = line.slice("const ".length).trim();
      if (name === "NO_MOVE" && constants.length === 0) {
        continue;
      }
      constants.push(name);
      continue;
    }

    if (constants.length > 0 && line.length > 0) {
      break;
    }
  }

  return constants;
}

function parseMoveNames(contents: string): string[] {
  const names: string[] = [];

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('li "') && line.endsWith('"')) {
      names.push(line.slice(4, -1));
    }
  }

  return names;
}

function parseAnimationLabels(contents: string): string[] {
  return parsePointerTable(contents, "AttackAnimationPointers:");
}

function parseAnimationScript(contents: string, label: string): string[] {
  const marker = `${label}:`;
  const start = contents.indexOf(marker);
  if (start < 0) {
    throw new Error(`Could not find animation label ${marker}`);
  }

  const lines: string[] = [];
  const block = contents.slice(start + marker.length);

  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";")) {
      continue;
    }

    lines.push(line);
    if (codeOnly(line) === "db -1") {
      break;
    }
  }

  return lines;
}

export async function parseMoves(source: ProjectSource): Promise<MoveData[]> {
  const [movesContents, constantsContents, namesContents, animationsContents] =
    await Promise.all([
      source.readText("data/moves/moves.asm"),
      source.readText("constants/move_constants.asm"),
      source.readText("data/moves/names.asm"),
      source.readText("data/moves/animations.asm"),
    ]);

  const rows = parseMoveRows(movesContents);
  const constants = parseMoveConstants(constantsContents);
  const names = parseMoveNames(namesContents);
  const animationLabels = parseAnimationLabels(animationsContents);

  return rows.map((row, index) => {
    const id = index + 1;
    const constant = constants[index] ?? row.animation;
    const name = names[index] ?? constant;
    const animationLabel = animationLabels[index] ?? null;

    return {
      id,
      constant,
      name,
      animation: row.animation,
      effect: row.effect,
      power: row.power,
      moveType: row.moveType,
      accuracy: row.accuracy,
      pp: row.pp,
      animationLabel,
      animationScript: animationLabel
        ? parseAnimationScript(animationsContents, animationLabel)
        : [],
    };
  });
}
