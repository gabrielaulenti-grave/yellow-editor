import { hashText } from "./history";
import { loadMapVisualization } from "./mapVisualization";
import { readProjectRgbdsSources, evaluateRgbdsExpression } from "./projectConstants";
import { objectSourceConstants } from "./mapObjectAnalysis";
import { importedTextLeaves } from "./nativeMapObjects";
import { npcDialogueSegments } from "./npcCreation";
import { applyTextDocumentEdits, attachTextEditing, parseTextDocument, type TextDocument, type TextSegment } from "./textEditing";
import type { MapSourceSnapshot, ProjectSource, TextWriteRequest } from "./types";

export const mapRecordCode = (line: string) => {
  let quoted = false;
  for (let i = 0; i < line.length; i++) { if (line[i] === "\\") { i++; continue; } if (line[i] === '"') quoted = !quoted; if (line[i] === ";" && !quoted) return line.slice(0, i).trim(); }
  return line.trim();
};
export function mapRecordLines(text: string) { return text.split(/\r?\n/); }
export function spliceMapLines(text: string, at: number, count: number, added: string[] = []) {
  const rows = mapRecordLines(text); rows.splice(at, count, ...added); return rows.join(text.includes("\r\n") ? "\r\n" : "\n");
}
export async function loadMapRecordState(source: ProjectSource, mapConstant: string) {
  const files = await readProjectRgbdsSources(source);
  if (files.some(f => f.readError)) throw new Error("Some assembly files could not be inspected. Reopen the complete project before editing records.");
  const view = await loadMapVisualization(source, mapConstant);
  if (view.map.isAlias) throw new Error("This map shares its header. Review the shared source before editing records.");
  const objectPath = view.objectPath, scriptPath = `scripts/${view.mapSourceLabel}.asm`;
  const objects = files.find(f => f.path === objectPath)?.contents, script = files.find(f => f.path === scriptPath)?.contents;
  if (objects === undefined || script === undefined) throw new Error("The map's object or script source could not be resolved.");
  const rows = mapRecordLines(objects), scriptRows = mapRecordLines(script), clean = mapRecordCode;
  const boundary = (name: string) => { const matches = rows.flatMap((l, i) => clean(l) === name ? [i] : []); if (matches.length !== 1) throw new Error(`Expected one ${name} table boundary.`); return matches[0]; };
  const bgStart = boundary("def_bg_events"), objectStart = boundary("def_object_events"), end = boundary(`def_warps_to ${mapConstant}`);
  if (!(bgStart < objectStart && objectStart < end)) throw new Error("Unrecognized map record table order.");
  const section = (start: number, end: number, macro: string) => rows.flatMap((raw, line) => {
    if (line <= start || line >= end || !clean(raw)) return [];
    const match = clean(raw).match(new RegExp(`^${macro}\\s+(.+)$`));
    if (!match) throw new Error(`The ${macro} table contains conditional or unsupported source.`);
    return [{ line, args: match[1].split(",").map(a => a.trim()) }];
  });
  const signs = section(bgStart, objectStart, "bg_event"), events = section(objectStart, end, "object_event");
  const starts = scriptRows.flatMap((l, i) => clean(l).match(new RegExp(`^${view.mapSourceLabel}_TextPointers:{1,2}$`)) ? [i] : []);
  if (starts.length !== 1) throw new Error("The map text pointer table is missing or ambiguous.");
  const pointerStart = starts[0]; let pointerEnd = pointerStart + 1;
  while (pointerEnd < scriptRows.length && !/^[A-Za-z_]\w*:{1,2}$/.test(clean(scriptRows[pointerEnd]))) pointerEnd++;
  const pointers: Array<{ line: number; label: string; constant: string }> = [];
  let pointerReason: string | null = null;
  for (let line = pointerStart + 1; line < pointerEnd; line++) {
    const code = clean(scriptRows[line]); if (!code || code === "def_text_pointers" || code === "text_end") continue;
    const m = code.match(/^dw_const\s+([A-Za-z_]\w*),\s*([A-Za-z_]\w*)$/), plain = code.match(/^dw\s+([A-Za-z_]\w*)$/);
    if (m) pointers.push({ line, label: m[1], constant: m[2] });
    else if (plain) pointers.push({ line, label: plain[1], constant: String(pointers.length + 1) });
    else pointerReason = "This text table contains directives that require source review before adding pointers.";
  }
  const constants = objectSourceConstants(files);
  pointers.forEach((p, i) => constants.set(p.constant, i + 1));
  const sources = await Promise.all(files.map(async f => ({ path: f.path, hash: await hashText(f.contents) })));
  return { view, files, objects, script, objectPath, scriptPath, rows, scriptRows, bgStart, objectStart, end, signs, events, pointers, pointerEnd, pointerReason, constants, sources };
}
export interface MapSignValues { x: number; y: number; lines: string[]; segments: TextSegment[] }
export interface MapSignDocument {
  mapConstant: string; mapName: string; signId: number | null; width: number; height: number;
  values: MapSignValues; occupied: Array<{ x: number; y: number }>; createReason: string | null;
  dialogue: TextDocument | null; dialogueReason: string | null; sharedCallers: Array<{ path: string; line: number }>;
  sources: MapSourceSnapshot[];
}
function bgEncodingReason(text: string, constants: Map<string, number>) {
  const macros = [...text.matchAll(/^MACRO\?? bg_event\r?\n([\s\S]*?)^ENDM/gm)];
  if (macros.length !== 1) return "The bg_event macro is missing or ambiguous.";
  for (const args of [[3, 7, 11], [9, 5, 13]]) {
    const bytes: number[] = [];
    for (const raw of mapRecordLines(macros[0][1])) {
      const code = mapRecordCode(raw); if (!code || /^(DEF|REDEF)\s/.test(code)) continue;
      const db = code.match(/^db\s+(.+)$/); if (!db) return "The sign byte layout needs a source adapter.";
      for (const field of db[1].split(",")) { const n = evaluateRgbdsExpression(field.replace(/\\([1-3])/g, (_, n) => String(args[+n - 1])), constants); if (n === null) return "The sign byte layout could not be resolved."; bytes.push(n); }
    }
    if (JSON.stringify(bytes) !== JSON.stringify([args[1], args[0], args[2]])) return "The sign byte layout needs a source adapter.";
  }
  return null;
}
export async function loadMapSignDocument(source: ProjectSource, map: string, signId: number | null): Promise<MapSignDocument> {
  const s = await loadMapRecordState(source, map), sign = signId === null ? null : s.view.signs.find(p => p.id === signId);
  if (signId !== null && !sign) throw new Error("This sign no longer exists. Refresh the map.");
  if (s.signs.some(r => r.args.length !== 3)) throw new Error("A sign record has an unfamiliar layout.");
  const encoding = bgEncodingReason(s.files.find(f => f.path === "macros/scripts/maps.asm")?.contents ?? "", s.constants);
  if (encoding) throw new Error(encoding);
  let createReason = s.pointerReason;
  const maxSigns = s.constants.get("MAX_BG_EVENTS"), textLimit = s.constants.get("TRAINER");
  if (!Number.isInteger(maxSigns) || !Number.isInteger(textLimit)) createReason = "The engine's sign/text limits could not be resolved.";
  else if (s.signs.length >= maxSigns! || s.pointers.length + 1 >= textLimit!) createReason = "This map has no free sign or ordinary text slots.";
  const mapMacros = s.files.find(f => f.path === "macros/scripts/maps.asm")?.contents ?? "";
  const countBody = mapMacros.match(/^MACRO def_bg_events\r?\n([\s\S]*?)^ENDM/m)?.[1];
  if (!countBody || mapRecordLines(countBody).map(mapRecordCode).filter(Boolean).join("\n") !== 'REDEF _NUM_BG_EVENTS EQUS "_NUM_BG_EVENTS_\\@"\ndb {_NUM_BG_EVENTS}\nDEF {_NUM_BG_EVENTS} = 0') createReason = "Adding signs needs a reviewed sign-count macro.";
  const mixedPointers = s.pointers.some(p => /^\d+$/.test(p.constant)) && s.pointers.some(p => !/^\d+$/.test(p.constant));
  if (mixedPointers) createReason = "Mixed numeric and symbolic text tables need a source review before adding pointers.";
  if (s.pointers.some(p => !/^\d+$/.test(p.constant)) || !s.pointers.length) {
    const definition = mapMacros.match(/^MACRO def_text_pointers\r?\n([\s\S]*?)^ENDM/m)?.[1];
    if (!definition || mapRecordLines(definition).map(mapRecordCode).filter(Boolean).join("\n") !== "const_def 1") createReason = "Adding symbolic text pointers needs a one-based def_text_pointers macro.";
    const word = s.files.flatMap(f => [...f.contents.matchAll(/^MACRO\?? dw_const\r?\n([\s\S]*?)^ENDM/gm)]).map(m => mapRecordLines(m[1]).map(mapRecordCode).filter(Boolean).join("\n"));
    if (word.length !== 1 || word[0] !== "dw \\1\nconst \\2") createReason = "Adding symbolic text pointers needs a reviewed dw_const word/constant encoding.";
  }
  let dialogue: TextDocument | null = null, dialogueReason: string | null = null;
  if (sign) {
    try {
      if (!sign.textLabel) throw new Error("Unresolved pointer");
      const wrapper = s.files.find(f => f.path === sign.scriptPath)?.contents ?? "";
      const wrapperRows = mapRecordLines(wrapper), start = wrapperRows.findIndex(l => mapRecordCode(l) === `${sign.textLabel}:` || mapRecordCode(l) === `${sign.textLabel}::`);
      if (start >= 0) { let end = start + 1; while (end < wrapperRows.length && !/^[A-Za-z_]\w*:{1,2}$/.test(mapRecordCode(wrapperRows[end]))) end++; if (wrapperRows.slice(start + 1, end).some(l => /^text_asm\b/.test(mapRecordCode(l)))) throw new Error("Executable sign handler"); }
      const leaves = await importedTextLeaves(attachTextEditing({} as never, source), s.files, sign.scriptPath, sign.textLabel);
      if (leaves.length !== 1 || !leaves[0].editable || !leaves[0].segments.length) throw new Error("Custom text paths");
      dialogue = leaves[0];
    } catch { dialogueReason = "This sign has unresolved or custom dialogue. Its position can still be edited; use Inspect map logic for its behavior."; }
  }
  const sharedCallers = dialogue ? s.files.flatMap(f => mapRecordLines(f.contents).flatMap((raw, line) => new RegExp(`\\b${dialogue!.label}\\b`).test(mapRecordCode(raw)) && !new RegExp(`^${dialogue!.label}:{1,2}$`).test(mapRecordCode(raw)) ? [{ path: f.path, line: line + 1 }] : [])) : [];
  return { mapConstant: map, mapName: s.view.map.displayName, signId, width: s.view.map.width * 2, height: s.view.map.height * 2,
    values: { x: sign?.x ?? 0, y: sign?.y ?? 0, lines: [""], segments: structuredClone(dialogue?.segments ?? []) },
    occupied: [...s.view.warps, ...s.view.npcs, ...s.view.signs.filter(p => p.id !== signId)], createReason, dialogue, dialogueReason, sharedCallers, sources: s.sources };
}
export function mapSignPositionError(d: MapSignDocument, v: MapSignValues) {
  if (!Number.isInteger(v.x) || !Number.isInteger(v.y) || v.x < 0 || v.y < 0 || v.x >= Math.min(d.width, 256) || v.y >= Math.min(d.height, 256)) return "Choose a whole-number position inside this map.";
  if (v.x === d.values.x && v.y === d.values.y && d.signId !== null) return null;
  if (d.occupied.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return "An existing object's position is unresolved. Review its source before choosing a new position.";
  return d.occupied.some(p => p.x === v.x && p.y === v.y) ? "This position contains an object, warp or sign." : null;
}
export async function prepareMapSignWrites(source: ProjectSource, document: MapSignDocument, values: MapSignValues): Promise<TextWriteRequest[]> {
  const current = await loadMapSignDocument(source, document.mapConstant, document.signId);
  if (JSON.stringify(current.sources) !== JSON.stringify(document.sources)) throw new Error("Map sources changed. Reopen the sign editor before saving.");
  const error = mapSignPositionError(current, values); if (error) throw new Error(error);
  const s = await loadMapRecordState(source, document.mapConstant), changed = new Map<string, string>();
  if (current.signId === null) {
    if (current.createReason) throw new Error(current.createReason);
    const input = values.lines;
    if (!Array.isArray(input) || input.length < 1 || input.length > 16 || input.some(l => typeof l !== "string" || /[\r\n@<>\\"]/u.test(l)) || !input.some(l => l.trim())) throw new Error("Enter 1–16 plain dialogue lines without control tokens.");
    const charmap = s.files.find(f => f.path.endsWith("charmap.asm"))?.contents ?? "";
    const characters = new Set([...charmap.matchAll(/^\s*charmap "([^"\\])",\s*\$([\da-f]{2})\b/gmi)].filter(m => parseInt(m[2], 16) >= 0x60 || m[1] === "#" && m[2] === "54").map(m => m[1]));
    if (input.some(l => [...l].some(c => !characters.has(c)))) throw new Error("Dialogue contains a character unavailable in this project's font.");
    let suffix = 1, label: string, constant: string;
    do { label = `${s.view.mapSourceLabel}EditorSign${suffix}Text`; constant = `TEXT_${current.mapConstant}_EDITOR_SIGN_${suffix++}`; } while (s.files.some(f => new RegExp(`\\b(?:${label}|${constant})\\b`).test(f.contents)));
    const numeric = s.pointers.length > 0 && s.pointers.every(p => /^\d+$/.test(p.constant));
    const textId = numeric ? String(s.pointers.length + 1) : constant;
    const segments = npcDialogueSegments(input), template = `${label}:\n${segments.map(p => `\t${p.control} ""`).join("\n")}\n\tdone\n`;
    const generated = applyTextDocumentEdits(template, label, segments);
    const parsed = await parseTextDocument(s.scriptPath, label, generated); if (!parsed.editable || JSON.stringify(parsed.segments) !== JSON.stringify(segments)) throw new Error("Generated sign dialogue did not reparse correctly.");
    const textMacros = s.files.find(f => f.path === "macros/scripts/text.asm")?.contents ?? "";
    for (const [name, expected] of Object.entries({ text: "db TX_START, \\#", line: 'db "<LINE>", \\#', cont: 'db "<CONT>", \\#', done: 'db "<DONE>"' })) {
      const macro = textMacros.match(new RegExp(`^MACRO ${name}\\r?\\n([\\s\\S]*?)^ENDM`, "m"));
      if (!macro || mapRecordLines(macro[1]).map(mapRecordCode).filter(Boolean).join("\n") !== expected) throw new Error(`Creating dialogue needs a reviewed ${name} macro.`);
    }
    const at = s.pointers.length ? s.pointers[s.pointers.length - 1].line + 1 : s.scriptRows.findIndex((l, i) => i > s.scriptRows.findIndex(l => mapRecordCode(l) === `${s.view.mapSourceLabel}_TextPointers:`) && mapRecordCode(l) === "def_text_pointers") + 1;
    if (at < 1 || !numeric && !s.scriptRows.some(l => mapRecordCode(l) === "def_text_pointers")) throw new Error("A symbolic text table needs its one-based def_text_pointers declaration.");
    const newline = s.script.includes("\r\n") ? "\r\n" : "\n";
    changed.set(s.scriptPath, spliceMapLines(s.script, at, 0, [numeric ? `\tdw ${label}` : `\tdw_const ${label}, ${constant}`]) + newline + generated.replace(/\n/g, newline));
    changed.set(s.objectPath, spliceMapLines(s.objects, s.objectStart, 0, [`\tbg_event ${values.x}, ${values.y}, ${textId}`]));
  } else {
    const moved = values.x !== current.values.x || values.y !== current.values.y;
    if (moved) {
      const row = s.signs[current.signId - 1], raw = s.rows[row.line];
      const patched = raw.replace(/^(\s*bg_event\s+)([^;]+)(.*)$/, (_, prefix, operands, comment) => { const args = operands.split(","); for (const [i, n] of [values.x, values.y].entries()) if (n !== [current.values.x, current.values.y][i]) args[i] = args[i].replace(/\S(?:[\s\S]*\S)?/, String(n)); return prefix + args.join(",") + comment; });
      changed.set(s.objectPath, spliceMapLines(s.objects, row.line, 1, [patched]));
    }
    if (JSON.stringify(values.segments) !== JSON.stringify(current.values.segments)) {
      if (!current.dialogue) throw new Error(current.dialogueReason ?? "This dialogue is not editable.");
      const d = current.dialogue, text = s.files.find(f => f.path === d.path)?.contents;
      if (text === undefined || await hashText(text) !== d.sourceHash) throw new Error("The sign dialogue source changed. Reopen the editor.");
      changed.set(d.path, applyTextDocumentEdits(changed.get(d.path) ?? text, d.label, values.segments));
    }
  }
  return Promise.all([...changed].map(async ([path, contents]) => ({ path, contents, expectedHash: await hashText(s.files.find(f => f.path === path)!.contents) })));
}
