import { hashText } from "./history";
import { tmhmMoveOptions } from "./itemConstants";
import type {
  Evolution,
  LearnsetMove,
  PokedexTextLine,
  PokemonEditDocument,
  PokemonEditOptions,
  PokemonEditSourceDocument,
  PokemonEditValues,
  PokemonPaletteChoice,
  PokemonSpriteChoice,
  ProjectSource,
  TextWriteRequest,
} from "./types";

const NAMES_PATH = "data/pokemon/names.asm";
const EVOS_PATH = "data/pokemon/evos_moves.asm";
const DEX_ENTRIES_PATH = "data/pokemon/dex_entries.asm";
const DEX_TEXT_PATH = "data/pokemon/dex_text.asm";
const MON_PALETTES_PATH = "data/pokemon/palettes.asm";
const PALETTE_DEFS_PATH = "data/sgb/sgb_palettes.asm";
const PICS_PATH = "gfx/pics.asm";

const SPECIAL_POKEMON_CONSTANTS = new Set([
  "FOSSIL_KABUTOPS",
  "FOSSIL_AERODACTYL",
  "MON_GHOST",
]);

function basePath(slug: string): string {
  return "data/pokemon/base_stats/" + slug + ".asm";
}

function codeOnly(line: string): string {
  return (line.split(";", 1)[0] || "").trim();
}

function parseByte(value: string, field: string, max = 255): number {
  const clean = value.trim();
  if (!/^\d+$/.test(clean)) throw new Error("Expected numeric " + field + ", got '" + value + "'.");
  const parsed = Number(clean);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) {
    throw new Error(field + " must be between 0 and " + max + ".");
  }
  return parsed;
}

type DbRow = { start: number; end: number; prefix: string; body: string; suffix: string };

function dbRows(contents: string): DbRow[] {
  const result: DbRow[] = [];
  const pattern = /^([ \t]*db[ \t]+)([^;\r\n]*)([ \t]*(?:;[^\r\n]*)?)$/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(contents)) !== null) {
    result.push({
      start: match.index,
      end: match.index + match[0].length,
      prefix: match[1],
      body: match[2].trim(),
      suffix: match[3],
    });
  }
  return result;
}

function replaceRange(contents: string, start: number, end: number, next: string): string {
  return contents.slice(0, start) + next + contents.slice(end);
}

function replaceDb(contents: string, index: number, body: string): string {
  const row = dbRows(contents)[index];
  if (!row) throw new Error("Could not locate Pokémon base-data row " + (index + 1) + ".");
  return replaceRange(contents, row.start, row.end, row.prefix + body + row.suffix);
}

type BaseData = {
  dexConstant: string;
  hp: number;
  attack: number;
  defense: number;
  speed: number;
  special: number;
  type1: string;
  type2: string;
  catchRate: number;
  baseExp: number;
  frontLabel: string;
  backLabel: string;
  dimensionPath: string;
  startingMoves: string[];
  growthRate: string;
};

function parseBaseData(contents: string): BaseData {
  const rows = dbRows(contents);
  if (rows.length < 7) throw new Error("Pokémon base-data file is missing required rows.");
  const stats = rows[1].body.split(",").map((value) => value.trim());
  const types = rows[2].body.split(",").map((value) => value.trim());
  const startingMoves = rows[5].body.split(",").map((value) => value.trim());
  if (stats.length !== 5 || types.length !== 2 || startingMoves.length !== 4) {
    throw new Error("Pokémon base-data rows are not in the expected format.");
  }

  const pointer = contents.match(/^[ \t]*dw[ \t]+([^,;\r\n]+)[ \t]*,[ \t]*([^;\r\n]+)(?:[ \t]*;[^\r\n]*)?$/m);
  const dimension = contents.match(/^[ \t]*INCBIN[ \t]+"([^"]+\.pic)"[ \t]*,[ \t]*0[ \t]*,[ \t]*1(?:[ \t]*;[^\r\n]*)?$/m);
  if (!pointer || !dimension) throw new Error("Could not locate this Pokémon's sprite metadata.");

  return {
    dexConstant: rows[0].body.split(",")[0].trim(),
    hp: parseByte(stats[0], "HP"),
    attack: parseByte(stats[1], "Attack"),
    defense: parseByte(stats[2], "Defense"),
    speed: parseByte(stats[3], "Speed"),
    special: parseByte(stats[4], "Special"),
    type1: types[0],
    type2: types[1],
    catchRate: parseByte(rows[3].body, "catch rate"),
    baseExp: parseByte(rows[4].body, "base EXP"),
    frontLabel: pointer[1].trim(),
    backLabel: pointer[2].trim(),
    dimensionPath: dimension[1],
    startingMoves,
    growthRate: rows[6].body.split(",")[0].trim(),
  };
}

function tmhmBlock(contents: string): { start: number; end: number; indent: string; moves: string[] } {
  const lines = contents.match(/[^\r\n]*(?:\r?\n|$)/g) || [];
  let offset = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index].replace(/\r?\n$/, "");
    const match = raw.match(/^([ \t]*)tmhm(?:[ \t]+(.*))?$/);
    if (!match) {
      offset += lines[index].length;
      continue;
    }
    const start = offset;
    let end = offset + raw.length;
    let current = (match[2] || "").trim();
    const parts: string[] = [];
    while (true) {
      const clean = (current.split(";", 1)[0] || "").trimEnd();
      const continues = clean.endsWith("\\");
      const values = (continues ? clean.slice(0, -1) : clean).trim();
      if (values) parts.push(values);
      if (!continues) break;
      offset += lines[index].length;
      index += 1;
      if (index >= lines.length) throw new Error("TM/HM block has an unfinished continuation.");
      const continuation = lines[index].replace(/\r?\n$/, "");
      end = offset + continuation.length;
      current = continuation.trim();
    }
    return {
      start,
      end,
      indent: match[1],
      moves: parts.join(" ").split(",").map((value) => value.trim()).filter(Boolean),
    };
  }
  throw new Error("Could not locate the TM/HM compatibility block.");
}

function replaceTmhm(contents: string, moves: string[]): string {
  const block = tmhmBlock(contents);
  const next = block.indent + "tmhm" + (moves.length ? " " + moves.join(", ") : "");
  return replaceRange(contents, block.start, block.end, next);
}

type PicDef = { label: string; path: string };

function picDefinitions(contents: string): Map<string, PicDef> {
  const result = new Map<string, PicDef>();
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^[ \t]*([A-Za-z0-9_.]+)::?[ \t]+INCBIN[ \t]+"([^"]+\.pic)"/);
    if (match) result.set(match[1], { label: match[1], path: match[2] });
  }
  return result;
}

function choiceLabel(path: string): string {
  const file = path.split("/").pop() || path;
  const name = file.replace(/\.pic$/i, "").replace(/[._-]+/g, " ");
  return name.replace(/\b\w/g, (character) => character.toUpperCase());
}

function spriteChoices(contents: string): PokemonSpriteChoice[] {
  const defs = picDefinitions(contents);
  const result: PokemonSpriteChoice[] = [];
  for (const front of defs.values()) {
    if (!front.label.endsWith("PicFront")) continue;
    const backLabel = front.label.replace(/PicFront$/, "PicBack");
    const back = defs.get(backLabel);
    if (!back) continue;
    result.push({
      id: front.label + "|" + backLabel,
      label: choiceLabel(front.path),
      frontLabel: front.label,
      backLabel,
      dimensionPath: front.path,
      frontAssetPath: front.path.replace(/\.pic$/i, ".png"),
      backAssetPath: back.path.replace(/\.pic$/i, ".png"),
    });
  }
  return result.sort((left, right) => left.label.localeCompare(right.label));
}

function currentSpriteChoice(base: BaseData, choices: PokemonSpriteChoice[], pics: string): PokemonSpriteChoice {
  const id = base.frontLabel + "|" + base.backLabel;
  const existing = choices.find((choice) => choice.id === id);
  if (existing) return existing;
  const defs = picDefinitions(pics);
  const front = defs.get(base.frontLabel);
  const back = defs.get(base.backLabel);
  return {
    id,
    label: "Current (" + base.frontLabel + " / " + base.backLabel + ")",
    frontLabel: base.frontLabel,
    backLabel: base.backLabel,
    dimensionPath: base.dimensionPath,
    frontAssetPath: (front?.path || base.dimensionPath).replace(/\.pic$/i, ".png"),
    backAssetPath: (back?.path || base.dimensionPath.replace(/\.pic$/i, "b.pic")).replace(/\.pic$/i, ".png"),
  };
}

function replaceSprite(contents: string, choice: PokemonSpriteChoice): string {
  const dimension = contents.match(/^[ \t]*INCBIN[ \t]+"([^"]+\.pic)"[ \t]*,[ \t]*0[ \t]*,[ \t]*1(?:[ \t]*;[^\r\n]*)?$/m);
  if (!dimension || dimension.index === undefined) throw new Error("Could not locate sprite dimensions.");
  let next = replaceRange(contents, dimension.index, dimension.index + dimension[0].length, dimension[0].replace(dimension[1], choice.dimensionPath));
  const pointer = next.match(/^([ \t]*dw[ \t]+)([^,;\r\n]+)([ \t]*,[ \t]*)([^;\r\n]+)([ \t]*(?:;[^\r\n]*)?)$/m);
  if (!pointer || pointer.index === undefined) throw new Error("Could not locate sprite pointers.");
  next = replaceRange(next, pointer.index, pointer.index + pointer[0].length, pointer[1] + choice.frontLabel + pointer[3] + choice.backLabel + pointer[5]);
  return next;
}

function consts(contents: string, filter?: (constant: string) => boolean): string[] {
  const result: string[] = [];
  for (const line of contents.split(/\r?\n/)) {
    const match = codeOnly(line).match(/^const[ \t]+([A-Za-z0-9_]+)/);
    if (match && (!filter || filter(match[1]))) result.push(match[1]);
  }
  return result;
}

function moveConstants(contents: string): string[] {
  const result: string[] = [];
  for (const line of contents.split(/\r?\n/)) {
    const clean = codeOnly(line);
    if (/^DEF[ \t]+NUM_ATTACKS\b/.test(clean)) break;
    const match = clean.match(/^const[ \t]+([A-Za-z0-9_]+)/);
    if (match && match[1] !== "NO_MOVE") result.push(match[1]);
  }
  return result;
}

function items(contents: string): string[] {
  return consts(contents.split("DEF NUM_ITEMS", 1)[0] || contents).filter((constant) => constant !== "NO_ITEM");
}

function nameRows(contents: string): string[] {
  const result: string[] = [];
  let active = false;
  for (const line of contents.split(/\r?\n/)) {
    const clean = line.trim();
    if (clean === "MonsterNames:" || clean === "MonsterNames::") {
      active = true;
      continue;
    }
    if (!active) continue;
    if (clean.startsWith("assert_table_length")) break;
    const match = codeOnly(line).match(/^dname[ \t]+"([^"]*)"/);
    if (match) result.push(match[1].replace(/@+$/, ""));
  }
  return result;
}

function replaceName(contents: string, internalId: number, name: string): string {
  const pattern = /^[ \t]*dname[ \t]+"[^"]*"[ \t]*(?:;[^\r\n]*)?$/gm;
  const rows: RegExpExecArray[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(contents)) !== null) rows.push(match);
  const row = rows[internalId - 1];
  if (!row || row.index === undefined) throw new Error("Could not locate Pokémon name row.");
  const indent = row[0].match(/^([ \t]*)/)?.[1] || "";
  const suffix = row[0].match(/([ \t]*;[^\r\n]*)$/)?.[1] || "";
  return replaceRange(contents, row.index, row.index + row[0].length, indent + 'dname "' + name + '"' + suffix);
}

function pointerTable(contents: string, label: string): string[] {
  const result: string[] = [];
  let active = false;
  for (const line of contents.split(/\r?\n/)) {
    const clean = codeOnly(line);
    if (clean === label || clean === label.replace(/:$/, "::")) {
      active = true;
      continue;
    }
    if (!active) continue;
    if (clean.startsWith("assert_table_length")) break;
    const match = clean.match(/^dw[ \t]+([^, \t;]+)/);
    if (match) result.push(match[1]);
  }
  return result;
}

function labelBlock(contents: string, label: string): { start: number; end: number } {
  const marker = new RegExp("^" + label + "::?[ \\t]*$", "m").exec(contents);
  if (!marker || marker.index === undefined) throw new Error("Could not find source label " + label + ".");
  const start = marker.index + marker[0].length;
  const rest = contents.slice(start);
  const next = /^[A-Za-z_][A-Za-z0-9_.]*::?[ \t]*$/m.exec(rest);
  return { start, end: next?.index === undefined ? contents.length : start + next.index };
}

function replaceBlock(contents: string, label: string, body: string): string {
  const block = labelBlock(contents, label);
  return replaceRange(contents, block.start, block.end, body);
}

function evolution(values: string[]): Evolution {
  if (values[0] === "EVOLVE_LEVEL" && values.length === 3) {
    return { method: "level", level: parseByte(values[1], "evolution level"), item: null, target: values[2] };
  }
  if (values[0] === "EVOLVE_ITEM" && values.length === 4) {
    return { method: "item", level: parseByte(values[2], "evolution minimum level"), item: values[1], target: values[3] };
  }
  if (values[0] === "EVOLVE_TRADE" && values.length === 3) {
    return { method: "trade", level: parseByte(values[1], "trade minimum level"), item: null, target: values[2] };
  }
  throw new Error("Unknown evolution format: " + values.join(", "));
}

function evosMoves(contents: string, label: string): { evolutions: Evolution[]; learnset: LearnsetMove[] } {
  const block = labelBlock(contents, label);
  const evolutions: Evolution[] = [];
  const learnset: LearnsetMove[] = [];
  let phase: "evolutions" | "learnset" = "evolutions";
  for (const line of contents.slice(block.start, block.end).split(/\r?\n/)) {
    const clean = codeOnly(line);
    if (!clean.startsWith("db ")) continue;
    const values = clean.slice(3).split(",").map((value) => value.trim());
    if (values.length === 1 && values[0] === "0") {
      if (phase === "evolutions") phase = "learnset";
      else break;
      continue;
    }
    if (phase === "evolutions") evolutions.push(evolution(values));
    else if (values.length === 2) learnset.push({ level: parseByte(values[0], "learnset level"), moveConstant: values[1] });
  }
  return { evolutions, learnset };
}

function formatEvosMoves(evolutions: Evolution[], learnset: LearnsetMove[]): string {
  const lines = ["", "; Evolutions"];
  for (const item of evolutions) {
    if (item.method === "level") lines.push("\tdb EVOLVE_LEVEL, " + item.level + ", " + item.target);
    else if (item.method === "item") lines.push("\tdb EVOLVE_ITEM, " + item.item + ", " + (item.level || 1) + ", " + item.target);
    else lines.push("\tdb EVOLVE_TRADE, " + (item.level || 1) + ", " + item.target);
  }
  lines.push("\tdb 0", "; Learnset");
  for (const move of learnset) lines.push("\tdb " + move.level + ", " + move.moveConstant);
  lines.push("\tdb 0", "", "");
  return lines.join("\n");
}

function dexEntry(contents: string, label: string): {
  category: string;
  heightFeet: number;
  heightInches: number;
  weightTenthsLb: number;
  textLabel: string;
} {
  const block = labelBlock(contents, label);
  const lines = contents.slice(block.start, block.end).split(/\r?\n/).map(codeOnly).filter(Boolean);
  const category = lines[0]?.match(/^db[ \t]+"([^"]*)"/);
  const height = lines[1]?.match(/^db[ \t]+([^,]+),[ \t]*([^,]+)$/);
  const weight = lines[2]?.match(/^dw[ \t]+(.+)$/);
  const text = lines[3]?.match(/^text_far[ \t]+([A-Za-z0-9_.]+)/);
  if (!category || !height || !weight || !text) throw new Error("Unsupported Pokédex entry format for " + label + ".");
  return {
    category: category[1].replace(/@+$/, ""),
    heightFeet: parseByte(height[1], "height in feet"),
    heightInches: parseByte(height[2], "height in inches"),
    weightTenthsLb: parseByte(weight[1], "weight", 65535),
    textLabel: text[1],
  };
}

function dexText(contents: string, label: string): PokedexTextLine[] {
  const block = labelBlock(contents, label);
  const result: PokedexTextLine[] = [];
  for (const line of contents.slice(block.start, block.end).split(/\r?\n/)) {
    const clean = line.trim();
    if (clean === "dex") break;
    const match = clean.match(/^(text|next|page)[ \t]+"([^"]*)"$/);
    if (match) result.push({ kind: match[1] as PokedexTextLine["kind"], text: match[2] });
  }
  return result;
}

function formatDexEntry(values: NonNullable<PokemonEditValues["pokedex"]>, textLabel: string): string {
  return [
    "",
    '\tdb "' + values.category + '@"',
    "\tdb " + values.heightFeet + "," + values.heightInches,
    "\tdw " + values.weightTenthsLb,
    "\ttext_far " + textLabel,
    "\ttext_end",
    "",
    "",
  ].join("\n");
}

function formatDexText(lines: PokedexTextLine[]): string {
  return ["", ...lines.map((line) => '\t' + line.kind + ' "' + line.text + '"'), "\tdex", "", ""].join("\n");
}

function asmInteger(value: string): number {
  const clean = value.trim();
  if (/^\$[0-9a-f]+$/i.test(clean)) return Number.parseInt(clean.slice(1), 16);
  if (/^\d+$/.test(clean)) return Number.parseInt(clean, 10);
  throw new Error("Expected assembly integer, got '" + value + "'.");
}

function dexNumbers(contents: string): Map<string, number> {
  const result = new Map<string, number>();
  let current = 0;
  for (const line of contents.split(/\r?\n/)) {
    const clean = codeOnly(line);
    if (clean.startsWith("const_def")) {
      const value = clean.slice("const_def".length).trim();
      current = value ? asmInteger(value) : 0;
    } else if (clean === "const_skip") {
      current += 1;
    } else {
      const match = clean.match(/^const[ \t]+([A-Za-z0-9_]+)/);
      if (match) {
        result.set(match[1], current);
        current += 1;
      }
    }
  }
  return result;
}

function hexChannel(value: number): string {
  return Math.round(value / 31 * 255).toString(16).padStart(2, "0");
}

function rgbHex(red: number, green: number, blue: number): string {
  return "#" + hexChannel(red) + hexChannel(green) + hexChannel(blue);
}

function rgb5(hex: string): [number, number, number] {
  const match = hex.match(/^#([0-9a-f]{6})$/i);
  if (!match) throw new Error("Invalid palette color '" + hex + "'.");
  const values = [0, 2, 4].map((offset) => Math.round(Number.parseInt(match[1].slice(offset, offset + 2), 16) / 255 * 31));
  return values as [number, number, number];
}

function paletteRows(contents: string, label: string): Map<string, [string, string, string, string]> {
  const result = new Map<string, [string, string, string, string]>();
  const block = labelBlock(contents, label);
  for (const line of contents.slice(block.start, block.end).split(/\r?\n/)) {
    const semicolon = line.indexOf(";");
    if (semicolon < 0) continue;
    const code = line.slice(0, semicolon).trim();
    const constant = line.slice(semicolon + 1).trim().split(/\s+/)[0];
    if (!code.startsWith("RGB ") || !constant) continue;
    const values = code.slice(4).split(",").map((value) => Number.parseInt(value.trim(), 10));
    if (values.length !== 12 || values.some((value) => !Number.isInteger(value))) continue;
    result.set(constant, [0, 3, 6, 9].map((offset) => rgbHex(values[offset], values[offset + 1], values[offset + 2])) as [string, string, string, string]);
  }
  return result;
}

function paletteChoices(contents: string): PokemonPaletteChoice[] {
  const cgb = paletteRows(contents, "CGBBasePalettes");
  const sgb = paletteRows(contents, "SuperPalettes");
  return [...new Set([...cgb.keys(), ...sgb.keys()])].map((constant) => ({
    constant,
    cgbColors: cgb.get(constant) || null,
    sgbColors: sgb.get(constant) || null,
  }));
}

function paletteAssignments(contents: string): string[] {
  const block = labelBlock(contents, "MonsterPalettes");
  const result: string[] = [];
  for (const line of contents.slice(block.start, block.end).split(/\r?\n/)) {
    const match = codeOnly(line).match(/^db[ \t]+([A-Za-z0-9_]+)/);
    if (match) result.push(match[1]);
  }
  return result;
}

function replacePaletteAssignment(contents: string, dexNumber: number, constant: string): string {
  const block = labelBlock(contents, "MonsterPalettes");
  const body = contents.slice(block.start, block.end);
  const pattern = /^([ \t]*db[ \t]+)([A-Za-z0-9_]+)([ \t]*(?:;[^\r\n]*)?)$/gm;
  const rows: RegExpExecArray[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) rows.push(match);
  const row = rows[dexNumber];
  if (!row || row.index === undefined) throw new Error("Could not locate palette assignment for Pokédex #" + dexNumber + ".");
  const changed = replaceRange(body, row.index, row.index + row[0].length, row[1] + constant + row[3]);
  return contents.slice(0, block.start) + changed + contents.slice(block.end);
}

function replacePaletteRow(
  contents: string,
  label: string,
  constant: string,
  colors: [string, string, string, string],
): string {
  const block = labelBlock(contents, label);
  const body = contents.slice(block.start, block.end);
  const lines = body.match(/[^\r\n]*(?:\r?\n|$)/g) || [];
  let offset = 0;
  for (const withEnding of lines) {
    const line = withEnding.replace(/\r?\n$/, "");
    const semicolon = line.indexOf(";");
    if (semicolon >= 0 && line.slice(semicolon + 1).trim().split(/\s+/)[0] === constant) {
      const code = line.slice(0, semicolon);
      if (code.trim().startsWith("RGB ")) {
        const indent = code.match(/^([ \t]*)/)?.[1] || "";
        const numbers = colors.flatMap(rgb5);
        const groups: string[] = [];
        for (let index = 0; index < numbers.length; index += 3) {
          groups.push(numbers.slice(index, index + 3).map((value) => String(value).padStart(2, "0")).join(","));
        }
        const replacement = indent + "RGB " + groups.join(", ") + " ; " + constant;
        return replaceRange(contents, block.start + offset, block.start + offset + line.length, replacement);
      }
    }
    offset += withEnding.length;
  }
  throw new Error("Could not locate " + constant + " in " + label + ".");
}

async function editSources(entries: Array<[string, string]>): Promise<PokemonEditSourceDocument[]> {
  return Promise.all(entries.map(async ([path, contents]) => ({
    path,
    sourceHash: await hashText(contents),
  })));
}

export async function loadPokemonEditDocument(
  source: ProjectSource,
  internalId: number,
  sourceSlug: string,
): Promise<PokemonEditDocument> {
  if (!Number.isInteger(internalId) || internalId <= 0) throw new Error("Only real Pokémon entries can be edited.");

  const baseStatsPath = basePath(sourceSlug);
  const paths = [
    baseStatsPath,
    NAMES_PATH,
    EVOS_PATH,
    DEX_ENTRIES_PATH,
    DEX_TEXT_PATH,
    MON_PALETTES_PATH,
    PALETTE_DEFS_PATH,
    PICS_PATH,
    "constants/type_constants.asm",
    "constants/pokemon_data_constants.asm",
    "constants/move_constants.asm",
    "constants/pokemon_constants.asm",
    "constants/item_constants.asm",
    "constants/pokedex_constants.asm",
  ];
  const read = await Promise.all(paths.map((path) => source.readText(path)));
  const byPath = new Map(paths.map((path, index) => [path, read[index]]));

  const baseContents = byPath.get(baseStatsPath)!;
  const namesContents = byPath.get(NAMES_PATH)!;
  const evosContents = byPath.get(EVOS_PATH)!;
  const dexEntriesContents = byPath.get(DEX_ENTRIES_PATH)!;
  const dexTextContents = byPath.get(DEX_TEXT_PATH)!;
  const monPaletteContents = byPath.get(MON_PALETTES_PATH)!;
  const paletteDefsContents = byPath.get(PALETTE_DEFS_PATH)!;
  const picsContents = byPath.get(PICS_PATH)!;
  const base = parseBaseData(baseContents);

  const names = nameRows(namesContents);
  const displayName = names[internalId - 1];
  if (displayName === undefined) throw new Error("Could not locate this Pokémon's name.");

  const evosLabel = pointerTable(evosContents, "EvosMovesPointerTable:")[internalId - 1];
  if (!evosLabel) throw new Error("Could not resolve this Pokémon's evolution/move block.");
  const evolutionData = evosMoves(evosContents, evosLabel);

  const dexLabel = pointerTable(dexEntriesContents, "PokedexEntryPointers:")[internalId - 1];
  if (!dexLabel) throw new Error("Could not resolve this Pokémon's Pokédex entry.");
  const entry = dexEntry(dexEntriesContents, dexLabel);

  const dexNumber = dexNumbers(byPath.get("constants/pokedex_constants.asm")!).get(base.dexConstant);
  if (dexNumber === undefined) throw new Error("Could not resolve Pokédex constant " + base.dexConstant + ".");
  const paletteConstant = paletteAssignments(monPaletteContents)[dexNumber];
  if (!paletteConstant) throw new Error("Could not resolve this Pokémon's palette.");

  const assignedPaletteConstants = new Set(paletteAssignments(monPaletteContents));
  const palettes = paletteChoices(paletteDefsContents).filter(
    (choice) => assignedPaletteConstants.has(choice.constant) || choice.constant.endsWith("MON"),
  );
  const palette = palettes.find((choice) => choice.constant === paletteConstant);
  if (!palette) throw new Error("Could not resolve colors for " + paletteConstant + ".");

  const sprites = spriteChoices(picsContents);
  const currentSprite = currentSpriteChoice(base, sprites, picsContents);
  if (!sprites.some((choice) => choice.id === currentSprite.id)) sprites.unshift(currentSprite);

  const options: PokemonEditOptions = {
    types: consts(byPath.get("constants/type_constants.asm")!),
    growthRates: consts(byPath.get("constants/pokemon_data_constants.asm")!, (constant) => constant.startsWith("GROWTH_")),
    moves: moveConstants(byPath.get("constants/move_constants.asm")!),
    species: consts(byPath.get("constants/pokemon_constants.asm")!).filter(
      (constant) => constant !== "NO_MON" && !SPECIAL_POKEMON_CONSTANTS.has(constant),
    ),
    items: items(byPath.get("constants/item_constants.asm")!),
    tmhmMoves: tmhmMoveOptions(byPath.get("constants/item_constants.asm")!),
    spriteChoices: sprites,
    paletteChoices: palettes,
  };

  return {
    internalId,
    sourceSlug,
    dexConstant: base.dexConstant,
    sources: await editSources([
      [baseStatsPath, baseContents],
      [NAMES_PATH, namesContents],
      [EVOS_PATH, evosContents],
      [DEX_ENTRIES_PATH, dexEntriesContents],
      [DEX_TEXT_PATH, dexTextContents],
      [MON_PALETTES_PATH, monPaletteContents],
      [PALETTE_DEFS_PATH, paletteDefsContents],
    ]),
    values: {
      displayName,
      hp: base.hp,
      attack: base.attack,
      defense: base.defense,
      speed: base.speed,
      special: base.special,
      type1: base.type1,
      type2: base.type2,
      catchRate: base.catchRate,
      baseExp: base.baseExp,
      growthRate: base.growthRate,
      startingMoves: base.startingMoves,
      spriteChoiceId: currentSprite.id,
      paletteConstant,
      cgbPalette: palette.cgbColors,
      sgbPalette: palette.sgbColors,
      evolutions: evolutionData.evolutions,
      learnset: evolutionData.learnset,
      tmhmMoves: tmhmBlock(baseContents).moves,
      pokedex: {
        category: entry.category,
        heightFeet: entry.heightFeet,
        heightInches: entry.heightInches,
        weightTenthsLb: entry.weightTenthsLb,
        textLines: dexText(dexTextContents, entry.textLabel),
      },
    },
    options,
  };
}

function validateName(name: string): void {
  if (name.length < 1 || name.length > 10) throw new Error("Pokémon name must be 1–10 characters.");
  if (/["@\r\n]/.test(name)) throw new Error("Pokémon name cannot contain quotes, @, or line breaks.");
}

function validPalette(colors: [string, string, string, string] | null): void {
  for (const color of colors || []) rgb5(color);
}

export function validatePokemonEditValues(values: PokemonEditValues, options: PokemonEditOptions): void {
  validateName(values.displayName);
  for (const key of ["hp", "attack", "defense", "speed", "special"] as const) {
    const value = values[key];
    if (!Number.isInteger(value) || value < 1 || value > 255) throw new Error(key + " must be between 1 and 255.");
  }
  parseByte(String(values.catchRate), "catch rate");
  parseByte(String(values.baseExp), "base EXP");

  if (!options.types.includes(values.type1) || !options.types.includes(values.type2)) throw new Error("Select valid Pokémon types.");
  if (!options.growthRates.includes(values.growthRate)) throw new Error("Select a valid growth rate.");

  const moves = new Set(options.moves);
  if (values.startingMoves.length !== 4) throw new Error("Exactly four level-1 move slots are required.");
  for (const move of values.startingMoves) {
    if (move !== "NO_MOVE" && !moves.has(move)) throw new Error("Unknown starting move " + move + ".");
  }

  if (!options.spriteChoices.some((choice) => choice.id === values.spriteChoiceId)) throw new Error("Select a project-defined sprite pair.");
  const palette = options.paletteChoices.find((choice) => choice.constant === values.paletteConstant);
  if (!palette) throw new Error("Select a project-defined palette.");
  if (palette.cgbColors && !values.cgbPalette) throw new Error("This palette requires CGB colors.");
  if (palette.sgbColors && !values.sgbPalette) throw new Error("This palette requires SGB colors.");
  validPalette(values.cgbPalette);
  validPalette(values.sgbPalette);

  const species = new Set(options.species);
  const itemSet = new Set(options.items);
  for (const item of values.evolutions) {
    if (!species.has(item.target)) throw new Error("Unknown evolution target " + item.target + ".");
    if (!Number.isInteger(item.level) || (item.level || 0) < 1 || (item.level || 0) > 255) throw new Error("Evolution levels must be 1–255.");
    if (item.method === "item") {
      if (!item.item || !itemSet.has(item.item)) throw new Error("Item evolutions require a valid item.");
    } else if (item.item !== null) {
      throw new Error("Only item evolutions can specify an item.");
    }
  }

  let previousLevel = 0;
  for (const move of values.learnset) {
    if (!Number.isInteger(move.level) || move.level < 1 || move.level > 100) throw new Error("Learnset levels must be 1–100.");
    if (move.level < previousLevel) throw new Error("Level-up moves must be ordered by level.");
    if (!moves.has(move.moveConstant)) throw new Error("Unknown level-up move " + move.moveConstant + ".");
    previousLevel = move.level;
  }

  const allowedTmhm = new Set(options.tmhmMoves);
  if (new Set(values.tmhmMoves).size !== values.tmhmMoves.length) throw new Error("TM/HM compatibility contains duplicates.");
  for (const move of values.tmhmMoves) {
    if (!allowedTmhm.has(move)) throw new Error(move + " is not a TM/HM move in this project.");
  }

  if (!values.pokedex) throw new Error("Pokédex data is required.");
  if (values.pokedex.category.length < 1 || values.pokedex.category.length > 11) throw new Error("Pokédex category must be 1–11 characters.");
  if (/["@\r\n]/.test(values.pokedex.category)) throw new Error("Pokédex category contains an unsupported character.");
  parseByte(String(values.pokedex.heightFeet), "height in feet");
  if (!Number.isInteger(values.pokedex.heightInches) || values.pokedex.heightInches < 0 || values.pokedex.heightInches > 11) throw new Error("Height inches must be 0–11.");
  parseByte(String(values.pokedex.weightTenthsLb), "weight", 65535);
  if (!values.pokedex.textLines.length || values.pokedex.textLines[0].kind !== "text") throw new Error("Pokédex text must begin with a text line.");
  for (const line of values.pokedex.textLines) {
    if (!["text", "next", "page"].includes(line.kind)) throw new Error("Unsupported Pokédex text command.");
    if (line.text.length > 18 || /["\r\n]/.test(line.text)) throw new Error("Pokédex text lines must be at most 18 characters and cannot contain quotes.");
  }
}

function expectedHash(sources: PokemonEditSourceDocument[], path: string): string {
  const found = sources.find((source) => source.path === path);
  if (!found) throw new Error("Missing source guard for " + path + ". Reload this Pokémon before saving.");
  return found.sourceHash;
}

export async function preparePokemonWrites(
  source: ProjectSource,
  internalId: number,
  sourceSlug: string,
  sources: PokemonEditSourceDocument[],
  values: PokemonEditValues,
): Promise<TextWriteRequest[]> {
  const current = await loadPokemonEditDocument(source, internalId, sourceSlug);
  validatePokemonEditValues(values, current.options);
  const sprite = current.options.spriteChoices.find((choice) => choice.id === values.spriteChoiceId);
  if (!sprite) throw new Error("Selected sprite pair is no longer available.");

  const baseStatsPath = basePath(sourceSlug);
  const writePaths = [baseStatsPath, NAMES_PATH, EVOS_PATH, DEX_ENTRIES_PATH, DEX_TEXT_PATH, MON_PALETTES_PATH, PALETTE_DEFS_PATH];
  const read = await Promise.all(writePaths.map((path) => source.readText(path)));
  const before = new Map(writePaths.map((path, index) => [path, read[index]]));

  const original = current.values;
  let baseContents = before.get(baseStatsPath)!;
  if (
    values.hp !== original.hp
    || values.attack !== original.attack
    || values.defense !== original.defense
    || values.speed !== original.speed
    || values.special !== original.special
  ) {
    baseContents = replaceDb(
      baseContents,
      1,
      [values.hp, values.attack, values.defense, values.speed, values.special].join(", "),
    );
  }
  if (values.type1 !== original.type1 || values.type2 !== original.type2) {
    baseContents = replaceDb(baseContents, 2, values.type1 + ", " + values.type2);
  }
  if (values.catchRate !== original.catchRate) {
    baseContents = replaceDb(baseContents, 3, String(values.catchRate));
  }
  if (values.baseExp !== original.baseExp) {
    baseContents = replaceDb(baseContents, 4, String(values.baseExp));
  }
  if (JSON.stringify(values.startingMoves) !== JSON.stringify(original.startingMoves)) {
    baseContents = replaceDb(baseContents, 5, values.startingMoves.join(", "));
  }
  if (values.growthRate !== original.growthRate) {
    baseContents = replaceDb(baseContents, 6, values.growthRate);
  }
  if (values.spriteChoiceId !== original.spriteChoiceId) {
    baseContents = replaceSprite(baseContents, sprite);
  }
  if (JSON.stringify(values.tmhmMoves) !== JSON.stringify(original.tmhmMoves)) {
    baseContents = replaceTmhm(baseContents, values.tmhmMoves);
  }

  const namesContents = values.displayName === original.displayName
    ? before.get(NAMES_PATH)!
    : replaceName(before.get(NAMES_PATH)!, internalId, values.displayName);

  let evosContents = before.get(EVOS_PATH)!;
  if (
    JSON.stringify(values.evolutions) !== JSON.stringify(original.evolutions)
    || JSON.stringify(values.learnset) !== JSON.stringify(original.learnset)
  ) {
    const evosLabel = pointerTable(evosContents, "EvosMovesPointerTable:")[internalId - 1];
    if (!evosLabel) throw new Error("Could not resolve evolution/move block.");
    evosContents = replaceBlock(
      evosContents,
      evosLabel,
      formatEvosMoves(values.evolutions, values.learnset),
    );
  }

  let dexEntriesContents = before.get(DEX_ENTRIES_PATH)!;
  let dexTextContents = before.get(DEX_TEXT_PATH)!;
  const originalPokedex = original.pokedex;
  const pokedex = values.pokedex!;
  if (!originalPokedex) throw new Error("Could not resolve the original Pokédex entry.");

  const dexMetadataChanged =
    pokedex.category !== originalPokedex.category
    || pokedex.heightFeet !== originalPokedex.heightFeet
    || pokedex.heightInches !== originalPokedex.heightInches
    || pokedex.weightTenthsLb !== originalPokedex.weightTenthsLb;
  const dexTextChanged =
    JSON.stringify(pokedex.textLines) !== JSON.stringify(originalPokedex.textLines);

  if (dexMetadataChanged || dexTextChanged) {
    const dexLabel = pointerTable(dexEntriesContents, "PokedexEntryPointers:")[internalId - 1];
    if (!dexLabel) throw new Error("Could not resolve Pokédex entry.");
    const oldDex = dexEntry(dexEntriesContents, dexLabel);
    if (dexMetadataChanged) {
      dexEntriesContents = replaceBlock(
        dexEntriesContents,
        dexLabel,
        formatDexEntry(pokedex, oldDex.textLabel),
      );
    }
    if (dexTextChanged) {
      dexTextContents = replaceBlock(
        dexTextContents,
        oldDex.textLabel,
        formatDexText(pokedex.textLines),
      );
    }
  }

  let monPaletteContents = before.get(MON_PALETTES_PATH)!;
  if (values.paletteConstant !== original.paletteConstant) {
    const originalBase = parseBaseData(before.get(baseStatsPath)!);
    const dexConstants = await source.readText("constants/pokedex_constants.asm");
    const dexNumber = dexNumbers(dexConstants).get(originalBase.dexConstant);
    if (dexNumber === undefined) {
      throw new Error("Could not resolve Pokédex constant " + originalBase.dexConstant + ".");
    }
    monPaletteContents = replacePaletteAssignment(
      monPaletteContents,
      dexNumber,
      values.paletteConstant,
    );
  }

  let paletteDefsContents = before.get(PALETTE_DEFS_PATH)!;
  const selectedPalette = current.options.paletteChoices.find(
    (choice) => choice.constant === values.paletteConstant,
  );
  if (!selectedPalette) throw new Error("Selected palette is no longer available.");
  if (
    values.cgbPalette
    && JSON.stringify(values.cgbPalette) !== JSON.stringify(selectedPalette.cgbColors)
  ) {
    paletteDefsContents = replacePaletteRow(
      paletteDefsContents,
      "CGBBasePalettes",
      values.paletteConstant,
      values.cgbPalette,
    );
  }
  if (
    values.sgbPalette
    && JSON.stringify(values.sgbPalette) !== JSON.stringify(selectedPalette.sgbColors)
  ) {
    paletteDefsContents = replacePaletteRow(
      paletteDefsContents,
      "SuperPalettes",
      values.paletteConstant,
      values.sgbPalette,
    );
  }

  const after = new Map<string, string>([
    [baseStatsPath, baseContents],
    [NAMES_PATH, namesContents],
    [EVOS_PATH, evosContents],
    [DEX_ENTRIES_PATH, dexEntriesContents],
    [DEX_TEXT_PATH, dexTextContents],
    [MON_PALETTES_PATH, monPaletteContents],
    [PALETTE_DEFS_PATH, paletteDefsContents],
  ]);

  return writePaths.flatMap((path) => {
    const contents = after.get(path)!;
    if (contents === before.get(path)) {
      return [];
    }
    return [{
      path,
      contents,
      expectedHash: expectedHash(sources, path),
    }];
  });
}
