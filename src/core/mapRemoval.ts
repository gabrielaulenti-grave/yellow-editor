import { hashText } from "./history";
import { existingObjectEncodingReason } from "./mapObjectAnalysis";
import { loadMapSignDocument, loadMapRecordState, mapRecordCode, mapRecordLines, spliceMapLines } from "./mapSigns";
import type { MapSourceSnapshot, ProjectSource, TextWriteRequest } from "./types";

export interface MapRemovalDocument {
  mapConstant: string; mapName: string; kind: "sign" | "object"; id: number; name: string;
  sourcePath: string; sourceLine: number; blockers: string[]; effects: string[];
  references: Array<{ path: string; line: number; code: string }>; sources: MapSourceSnapshot[];
}
export async function loadMapRemovalDocument(source: ProjectSource, map: string, kind: "sign" | "object", id: number): Promise<MapRemovalDocument> {
  if (kind !== "sign" && kind !== "object") throw new Error("Choose a sign or map object.");
  const s = await loadMapRecordState(source, map), rows = kind === "sign" ? s.signs : s.events, row = rows[id - 1];
  if (!Number.isInteger(id) || !row) throw new Error("This record no longer exists. Refresh the map.");
  const blockers: string[] = [], references: MapRemovalDocument["references"] = [];
  const effects = ["Remove the selected map record in one undoable change.", "Keep text pointers, dialogue, party data and event flags. Shared callers and existing text IDs remain unchanged."];
  let name = `Sign #${id}`;
  if (kind === "sign") {
    await loadMapSignDocument(source, map, id); // Verify the emitted sign encoding.
    const countMacro = s.files.find(f => f.path === "macros/scripts/maps.asm")?.contents.match(/^MACRO def_bg_events\r?\n([\s\S]*?)^ENDM/m)?.[1];
    if (!countMacro || mapRecordLines(countMacro).map(mapRecordCode).filter(Boolean).join("\n") !== 'REDEF _NUM_BG_EVENTS EQUS "_NUM_BG_EVENTS_\\@"\ndb {_NUM_BG_EVENTS}\nDEF {_NUM_BG_EVENTS} = 0') blockers.push("The sign-count macro needs a source review before removing records.");
    effects.push("Other signs may receive new editor list numbers; their in-game text IDs do not change.");
  } else {
    const constants = s.rows.flatMap((l, line) => mapRecordCode(l).match(/^const_export\s+([A-Za-z_]\w*)$/)?.[1] ? [{ line, name: mapRecordCode(l).split(/\s+/)[1] }] : []), constant = constants[id - 1];
    name = constant?.name ?? `Object #${id}`;
    const macros = s.files.find(f => f.path === "macros/scripts/maps.asm")?.contents ?? "";
    const encoding = existingObjectEncodingReason(macros, s.constants); if (encoding) blockers.push(encoding);
    const enumMacro = macros.match(/^MACRO object_const_def\r?\n([\s\S]*?)^ENDM/m)?.[1];
    if (!enumMacro || mapRecordLines(enumMacro).map(mapRecordCode).filter(Boolean).join("\n") !== "const_def 1") blockers.push("The object-ID enumeration needs source review before removal.");
    const countMacro = macros.match(/^MACRO def_object_events\r?\n([\s\S]*?)^ENDM/m)?.[1];
    if (!countMacro || mapRecordLines(countMacro).map(mapRecordCode).filter(Boolean).join("\n") !== 'REDEF _NUM_OBJECT_EVENTS EQUS "_NUM_OBJECT_EVENTS_\\@"\ndb {_NUM_OBJECT_EVENTS}\nDEF {_NUM_OBJECT_EVENTS} = 0') blockers.push("The object-count macro needs a source review before removing records.");
    if (constants.length !== s.events.length || !constant) blockers.push("Named object constants must match the existing slots before removal.");
    if (id !== s.events.length) blockers.push(`Removing this record would renumber ${s.events.length - id} later object slots. Those slots need a reference and save-state migration; they will not be shifted automatically.`);
    if (row.args.length !== 6 || row.args[2] === "SPRITE_BOULDER" || row.args[5] === "BoulderText") blockers.push("This object has pickup, trainer, encounter or Strength behavior. Its owner and saved-state bindings need a dedicated removal adapter.");
    if (constant) for (const file of s.files) for (const [line, raw] of mapRecordLines(file.contents).entries()) {
      if (file.path === s.objectPath && line === constant.line) continue;
      const code = raw.trim().startsWith("; yellow-editor-") ? raw.trim() : mapRecordCode(raw);
      if (new RegExp(`\\b${constant.name}\\b`).test(code)) references.push({ path: file.path, line: line + 1, code });
    }
    if (references.length) blockers.push("Scripts, visibility tables or managed features reference this object. Resolve the listed dependencies before removing it.");
    if (/^\s*; yellow-editor-(?:interaction|strength|map-trainers|pc-tutorial):/m.test(s.script)) blockers.push("This map contains managed scenes, trainers or Strength hooks. Removing their cast needs coordination with their owning tools.");
    const script = s.script.match(new RegExp(`^${s.view.mapSourceLabel}_Script:{1,2}\\r?\\n([\\s\\S]*?)(?=^[A-Za-z_]\\w*:{1,2}|$(?![\\s\\S]))`, "m"))?.[1];
    const entry = script && mapRecordLines(script).map(mapRecordCode).filter(Boolean).join("\n");
    if (!entry || !["ret", "jp EnableAutoTextBoxDrawing", "call EnableAutoTextBoxDrawing\nret"].includes(entry) || /\btext_asm\b/.test(s.script)) blockers.push("The map has custom executable behavior. Numeric object references and movement routes need source review before deleting a slot.");
    effects.push("Only an unreferenced final ordinary NPC can be removed in this pass. Earlier object IDs remain unchanged; no saved flags are reclaimed.");
  }
  return { mapConstant: map, mapName: s.view.map.displayName, kind, id, name, sourcePath: s.objectPath, sourceLine: row.line + 1, blockers: [...new Set(blockers)], effects, references, sources: s.sources };
}
export async function prepareMapRemovalWrites(source: ProjectSource, document: MapRemovalDocument): Promise<TextWriteRequest[]> {
  const current = await loadMapRemovalDocument(source, document.mapConstant, document.kind, document.id);
  if (JSON.stringify(current.sources) !== JSON.stringify(document.sources)) throw new Error("Map sources changed. Reopen the removal review before continuing.");
  if (current.blockers.length) throw new Error(current.blockers.join(" "));
  const text = await source.readText(current.sourcePath), rows = mapRecordLines(text), remove = new Set([current.sourceLine - 1]);
  if (current.kind === "object") {
    const declaration = rows.findIndex(l => mapRecordCode(l) === `const_export ${current.name}`);
    if (declaration < 0) throw new Error("The object declaration changed.");
    remove.add(declaration);
  }
  let contents = text;
  for (const line of [...remove].sort((a, b) => b - a)) {
    const comment = rows[line].includes(";") ? rows[line].slice(rows[line].indexOf(";")) : null;
    contents = spliceMapLines(contents, line, 1, comment ? [`\t${comment}`] : []);
  }
  return [{ path: current.sourcePath, contents, expectedHash: await hashText(text) }];
}
