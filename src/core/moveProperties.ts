import { code, newline, type CreationStamp } from "./creationSupport";
import { hashText } from "./history";
import type { MoveData, ProjectSource } from "./types";

export const criticalMovesPath = "data/battle/critical_hit_moves.asm";
const enginePath = "engine/battle/core.asm";
export interface HighCriticalSupport { reason: string | null; moves: string[] }
interface Entry { constant: string; start: number; end: number }
function inspect(text: Map<string, string>, moves: MoveData[]) {
  const engine = text.get(enginePath), table = text.get(criticalMovesPath);
  if (engine === undefined || table === undefined) throw new Error("The project's high-critical-hit sources are unavailable.");
  const clean = engine.split(/\r?\n/).map(code).join("\n");
  if ((clean.match(/^INCLUDE "data\/battle\/critical_hit_moves\.asm"$/gm) ?? []).length !== 1
    || !/ld hl, HighCriticalMoves\n\.Loop\nld a, \[hli\]\ncp c\njr z, \.HighCritical\ninc a\njr nz, \.Loop/.test(clean)) throw new Error("The project's critical-hit lookup needs source review before editing this property.");
  const entries: Entry[] = [], ids = new Set<number>(); let active = false, terminator = -1;
  const byConstant = new Map(moves.map(move => [move.constant, move.id]));
  for (const line of table.matchAll(/^([^\r\n]*)(\r?\n|$)/gm)) {
    const raw = line[1], value = code(raw);
    if (!value) continue;
    if (/^HighCriticalMoves::{0,1}$/.test(value) && !active) { active = true; continue; }
    if (!active || terminator >= 0) throw new Error("The high-critical-hit list has an unsupported structure.");
    if (/^db\s+(?:-1|\$ff|255)$/i.test(value)) { terminator = line.index!; continue; }
    const constant = value.match(/^db\s+([A-Za-z_]\w*)$/)?.[1], id = constant ? byConstant.get(constant) : undefined;
    if (!constant || id === undefined || id < 1 || id >= 255 || ids.has(id)) throw new Error("The high-critical-hit list needs unique, named moves and a final terminator.");
    ids.add(id); entries.push({ constant, start: line.index!, end: line.index! + line[0].length });
  }
  if (!active || terminator < 0) throw new Error("The high-critical-hit list needs a final terminator.");
  return { entries, terminator, table };
}
export async function loadHighCritical(source: ProjectSource, moves: MoveData[]) {
  const contents = await Promise.all([enginePath, criticalMovesPath].map(async path => await source.exists(path) ? { path, contents: await source.readText(path) } : null));
  const text = new Map(contents.filter(file => file !== null).map(file => [file.path, file.contents]));
  const sources: CreationStamp[] = await Promise.all([...text].map(async ([path, contents]) => ({ path, hash: await hashText(contents) })));
  let support: HighCriticalSupport;
  try { support = { reason: null, moves: inspect(text, moves).entries.map(entry => entry.constant) }; }
  catch (error) { support = { reason: error instanceof Error ? error.message : String(error), moves: [] }; }
  return { text, sources, support };
}
/** Edit only membership of the selected move; preserve unrelated rows and comments. */
export function setHighCritical(text: Map<string, string>, moves: MoveData[], constant: string, enabled: boolean) {
  const { entries, terminator, table } = inspect(text, moves), entry = entries.find(entry => entry.constant === constant);
  if (Boolean(entry) === enabled) return table;
  if (enabled) return table.slice(0, terminator) + `\tdb ${constant}${newline(table)}` + table.slice(terminator);
  // Retain comments attached to removed memberships as standalone comments.
  const comment = table.slice(entry!.start, entry!.end).match(/;[^\r\n]*/)?.[0];
  return table.slice(0, entry!.start) + (comment ? `\t${comment}${newline(table)}` : "") + table.slice(entry!.end);
}
