import { loadMoveBehaviors, prepareMoveBehaviorWrites, validateBehaviorFamily, type MoveBehaviorValues, type MoveBehaviorSupport } from "./moveBehaviors";
import { criticalMovesPath, loadHighCritical, setHighCritical, type HighCriticalSupport } from "./moveProperties";
import { hashText } from "./history";
import { parseMoves } from "./parsers";
import { projectConstantCatalogFromSources, readProjectRgbdsSources } from "./projectConstants";
import { checkStamps, code, freeSections, gameText, type CreationStamp } from "./creationSupport";
import type { ProjectSource, TextWriteRequest } from "./types";
import { moveOptions, moveOptionPaths } from "./moveOptions";

export interface MoveEditValues { name: string; power: number; accuracy: number; pp: number; moveType: string; effect: string; highCritical?: boolean; behavior?: MoveBehaviorValues }
export interface MoveEditDocument {
  id: number; constant: string; sources: CreationStamp[]; values: MoveEditValues;
  options: { types: string[]; effects: string[] }; maxNameLength: number; highCritical: HighCriticalSupport; behaviors: MoveBehaviorSupport;
}
const dataPath = "data/moves/moves.asm", namesPath = "data/moves/names.asm";
const paths = [dataPath, namesPath, "constants/move_constants.asm", ...moveOptionPaths, "constants/pokemon_data_constants.asm", "constants/text_constants.asm", "main.asm", "text.asm", "layout.link"];
interface Row { raw: string; start: number; end: number }
function table(text: string, label: string, directive: string) {
  const rows: Row[] = []; let active = false, ended = false;
  for (const line of text.matchAll(/^([^\r\n]*)/gm)) {
    const raw = line[1], clean = code(raw);
    if (new RegExp(`^${label}::{0,1}$`).test(clean)) { if (active) throw new Error(`Duplicate ${label} table.`); active = true; continue; }
    if (!active) continue;
    if (/^assert_(?:table|list)_length\s+NUM_ATTACKS\s*$/.test(clean)) { ended = true; break; }
    if (!clean || /^(?:table_width|list_start)\s/.test(clean)) continue;
    if (!new RegExp(`^${directive}\\s`).test(clean)) throw new Error(`${label} has an unsupported table structure. Its source was preserved.`);
    rows.push({ raw, start: line.index!, end: line.index! + raw.length });
  }
  if (!active || !ended) throw new Error(`Cannot locate a bounded ${label} table.`);
  return rows;
}
function fields(row: Row) {
  const match = row.raw.match(/^([ \t]*move[ \t]+)([^;]*)(;.*)?$/);
  const args = match?.[2].split(",");
  if (!match || args?.length !== 6) throw new Error("The selected move needs a standard six-field move row.");
  return { prefix: match[1], args, comment: match[3] ?? "" };
}
function numeric(s: string, field: string) {
  if (!/^\d+$/.test(s.trim())) throw new Error(`${field} uses a source expression that this editor cannot safely rewrite.`);
  return Number(s.trim());
}
async function state(source: ProjectSource, id: number) {
  if (!Number.isInteger(id) || id < 1) throw new Error("Choose an existing move.");
  const contents = await Promise.all(paths.map(async path => ({ path, contents: await source.readText(path) })));
  const text = new Map(contents.map(file => [file.path, file.contents]));
  const symbols = new Map(projectConstantCatalogFromSources(contents, { resolveConstCounters: true }).constants.map(entry => [entry.symbol, entry.value]));
  const moveRows = table(text.get(dataPath)!, "Moves", "move"), names = table(text.get(namesPath)!, "MoveNames", "li");
  const moves = await parseMoves(source), move = moves.find(move => move.id === id);
  if (!move || symbols.get("NUM_ATTACKS") !== moveRows.length || names.length !== moveRows.length || moves.length !== moveRows.length) throw new Error("Move names, constants and stats must have synchronized table lengths before editing.");
  const macro = text.get(dataPath)!.match(/^MACRO move\s*\r?\n([\s\S]*?)^ENDM\s*$/m)?.[1];
  const body = macro?.split(/\r?\n/).map(code).filter(Boolean) ?? [];
  if (body.slice(0, 6).join("\n") !== ['db \\1', 'db \\2', 'db \\3', 'db \\4', 'db \\5 percent', 'db \\6'].join("\n") || !(body.length === 6 || body.length === 7 && /^ASSERT \\6 <= 40(?:,.*)?$/.test(body[6]))) throw new Error("The move macro needs source review before editing its values.");
  if (!/^[ \t]*list_start MOVE_NAME_LENGTH - 2[ \t]*(?:;.*)?$/m.test(text.get(namesPath)!)) throw new Error("The move-name width needs source review before editing.");
  const args = fields(moveRows[id - 1]).args.map(s => s.trim());
  const name = names[id - 1].raw.match(/^[ \t]*li[ \t]+"([^"\r\n]*)"[ \t]*(?:;.*)?$/)?.[1];
  if (name === undefined || !/^[A-Za-z_]\w*$/.test(args[1]) || !/^[A-Za-z_]\w*$/.test(args[3])) throw new Error("The selected move's name, type or behavior uses unsupported source syntax.");
  const maxNameLength = Math.min(12, (symbols.get("MOVE_NAME_LENGTH") ?? 14) - 2);
  const critical = await loadHighCritical(source, moves);
  const behaviors = await loadMoveBehaviors(source, moves);
  for (const [path, contents] of critical.text) text.set(path, contents);
  const document: MoveEditDocument = {
    id, constant: move.constant, sources: [...await Promise.all(contents.map(async file => ({ path: file.path, hash: await hashText(file.contents) }))), ...critical.sources, ...behaviors.sources].filter((stamp, i, all) => all.findIndex(other => other.path === stamp.path) === i), highCritical: critical.support, behaviors: behaviors.support,
    values: { name, behavior: behaviors.support.moves[move.constant], highCritical: critical.support.moves.includes(move.constant), effect: args[1], power: numeric(args[2], "Power"), moveType: args[3], accuracy: numeric(args[4], "Accuracy"), pp: numeric(args[5], "PP") },
    options: moveOptions(text, symbols), maxNameLength,
  };
  // Load inconsistent imported combinations so the GUI can repair them.
  validateMoveEditValues({ ...document.values, behavior: undefined }, document);
  return { document, text, moveRows, names, moves };
}
export function validateMoveEditValues(values: MoveEditValues, document: Pick<MoveEditDocument, "options" | "maxNameLength">) {
  if (values.highCritical !== undefined && typeof values.highCritical !== "boolean") throw new Error("High critical-hit rate must be on or off.");
  if (values.behavior) validateBehaviorFamily(values.behavior, values.effect, values.power);
  gameText(values.name, document.maxNameLength, "Move name");
  for (const [field, value, minimum, maximum] of [["Power", values.power, 0, 255], ["Accuracy", values.accuracy, 0, 100], ["PP", values.pp, 1, 40]] as const) {
    if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${field} must be an integer from ${minimum} to ${maximum}.`);
  }
  if (!document.options.types.includes(values.moveType) || !document.options.effects.includes(values.effect)) throw new Error("Choose a type and battle behavior already supported by this project.");
}
export async function loadMoveEditDocument(source: ProjectSource, id: number) { return (await state(source, id)).document; }
export async function prepareMoveEditWrites(source: ProjectSource, previous: MoveEditDocument, values: MoveEditValues): Promise<TextWriteRequest[]> {
  const current = await state(source, previous.id), doc = current.document;
  try { checkStamps(previous.sources, doc.sources); }
  catch { throw new Error("Move sources changed outside this editor. Reload move sources before saving."); }
  if (previous.constant !== doc.constant) throw new Error("The selected move's identity changed. Reload the move before saving.");
  validateMoveEditValues(values, doc);
  const changes = new Map<string, string>(), row = current.moveRows[doc.id - 1], parsed = fields(row);
  for (const [index, key] of [[1, "effect"], [2, "power"], [3, "moveType"], [4, "accuracy"], [5, "pp"]] as const) {
    if (values[key] !== doc.values[key]) { const part = parsed.args[index]; parsed.args[index] = part.match(/^\s*/)![0] + values[key] + part.match(/\s*$/)![0]; }
  }
  const replacement = parsed.prefix + parsed.args.join(",") + parsed.comment;
  if (replacement !== row.raw) changes.set(dataPath, current.text.get(dataPath)!.slice(0, row.start) + replacement + current.text.get(dataPath)!.slice(row.end));
  if (values.name !== doc.values.name) {
    const name = current.names[doc.id - 1], replacement = name.raw.replace(/(^[ \t]*li[ \t]+)"[^"]*"/, `$1"${values.name}"`);
    changes.set(namesPath, current.text.get(namesPath)!.slice(0, name.start) + replacement + current.text.get(namesPath)!.slice(name.end));
    const files = await readProjectRgbdsSources(source);
    if (files.some(file => file.readError)) throw new Error("All assembly sources must be readable before relocating the growing move-name table.");
    changes.set("layout.link", freeSections(current.text.get("layout.link")!, files, [namesPath]));
  }
  if (values.highCritical !== undefined && values.highCritical !== doc.values.highCritical) {
    if (doc.highCritical.reason) throw new Error(doc.highCritical.reason);
    changes.set(criticalMovesPath, setHighCritical(current.text, current.moves, doc.constant, values.highCritical));
    const files = await readProjectRgbdsSources(source);
    if (files.some(file => file.readError)) throw new Error("All assembly sources must be readable before relocating the critical-hit list.");
    changes.set("layout.link", freeSections(changes.get("layout.link") ?? current.text.get("layout.link")!, files, [criticalMovesPath]));
  }
  const staged: ProjectSource = { ...source, readText: async path => changes.get(path) ?? source.readText(path) };
  const behaviorWrites = await prepareMoveBehaviorWrites(staged, current.moves, current.moves, doc.constant, values.behavior);
  const creates = new Set(behaviorWrites.filter(write => write.operation === "create").map(write => write.path));
  for (const write of behaviorWrites) changes.set(write.path, write.contents);
  return [...changes].filter(([path, contents]) => contents !== current.text.get(path)).map(([path, contents]) => ({ path, contents, ...(creates.has(path) ? { operation: "create" as const } : { expectedHash: doc.sources.find(stamp => stamp.path === path)!.hash }) }));
}
