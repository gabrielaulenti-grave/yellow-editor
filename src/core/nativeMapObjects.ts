import { hashText } from "./history";
import { loadMapNpcSourceState } from "./npcCreation";
import { loadMapNpcEditDocument, refreshMapNpcInteractions } from "./npcEditing";
import { parseItemConstantDefinitions } from "./itemConstants";
import { parseTrainerBaseCatalog } from "./trainerBaseIndex";
import { attachTextEditing, applyTextDocumentEdits, type TextDocument, type TextSegment } from "./textEditing";
import type { MapNpcEditDocument, MapSourceSnapshot, ProjectSource, TextWriteRequest, TrainerPartyEntry } from "./types";

export interface NativeMapObjectValues {
  x: number; y: number; sprite: string; direction: string;
  item: string | null; partyId: string | null; sight: number | null;
  dialogues: TextSegment[][];
}
export interface NativeMapObjectDocument {
  mapConstant: string; mapName: string; objectId: number; objectConstant: string;
  kind: "item" | "trainer" | "special"; reason: string | null; placementReason: string | null;
  event: string | null; visibility: string | null; notes: string[];
  placement: MapNpcEditDocument; items: string[]; parties: TrainerPartyEntry[];
  dialogues: Array<{ role: string; document: TextDocument }>;
  values: NativeMapObjectValues; sources: MapSourceSnapshot[];
}
const clean = (s: string) => s.split(";")[0].trim();
function body(text: string, label: string) {
  const lines = text.split(/\r?\n/), at = lines.findIndex(l => clean(l) === `${label}:` || clean(l) === `${label}::`);
  if (at < 0) return "";
  let end = at + 1;
  while (end < lines.length && !/^[A-Za-z_]\w*:{1,2}$/.test(clean(lines[end]))) end++;
  return lines.slice(at + 1, end).map(clean).filter(Boolean).join("\n");
}
function trainerHeader(text: string, label: string) {
  const wrapper = body(text, label);
  const direct = wrapper.match(/^text_asm\nld hl, (\w+)\ncall TalkToTrainer\njp TextScriptEnd$/);
  if (direct) return direct[1];
  // Yellow often shares the final TalkToTrainer tail, reached by a jump or
  // a fallthrough from the last wrapper. Resolve only this transparent tail.
  const shared = wrapper.match(/^text_asm\nld hl, (\w+)(?:\n(?:jr|jp) (\w+))?$/);
  if (!shared) return null;
  const start = text.match(new RegExp(`^${label}:{1,2}[^\\n]*\\n`, "m"));
  const next = start && text.slice(start.index! + start[0].length).match(/^([A-Za-z_]\w*):{1,2}/m)?.[1];
  return body(text, shared[2] ?? next ?? "") === "call TalkToTrainer\njp TextScriptEnd" ? shared[1] : null;
}
async function inspect(source: ProjectSource, map: string, id: number) {
  const s = await loadMapNpcSourceState(source, map, id), placement = await loadMapNpcEditDocument(source, map, id);
  const row = s.events[id - 1];
  if (!row || row.length < 7) throw new Error("Choose a native pickup, trainer or special encounter.");
  const managed = s.script.match(/^; yellow-editor-map-trainers: (.+)$/m);
  if (managed && (JSON.parse(managed[1]) as { trainers: Array<{ id: number }> }).trainers.some(t => t.id === id)) throw new Error("Use Edit trainer for a trainer created by these tools.");
  const kind = row.length === 7 ? "item" : /^OPP_\w+$/.test(row[6]) && /^\d+$/.test(row[7]) ? "trainer" : "special";
  const label = s.pointers.find(p => p.constant === row[5])?.label;
  let reason: string | null = null, event: string | null = null, header: string | null = null;
  let sight: number | null = null, visibility: string | null = null;
  const notes: string[] = [], dialogues: NativeMapObjectDocument["dialogues"] = [];
  const items = parseItemConstantDefinitions(s.read("constants/item_constants.asm")).filter(i => i.id > 0 && i.id < 255).map(i => i.constant);
  let parties: TrainerPartyEntry[] = [];
  if (kind === "item") {
    const toggleSection = s.read("data/maps/toggleable_objects.asm").match(new RegExp(`^[ \\t]*toggleable_objects_for[ \\t]+${map}[ \\t]*(?:;[^\\r\\n]*)?\\r?\\n([\\s\\S]*?)(?=^[ \\t]*toggleable_objects_for\\b|$(?![\\s\\S]))`, "m"))?.[1] ?? "";
    const toggles = [...toggleSection.matchAll(new RegExp(`\\btoggle_object_state[ \\t]+${placement.objectConstant},[ \\t]*(ON|OFF)\\b`, "g"))];
    if (toggles.length === 1) visibility = toggles[0][1] === "ON" ? "Initially visible; collection keeps the existing saved object state." : "Initially hidden; existing story logic controls when it appears.";
    if (label !== "PickUpItemText" || toggles.length !== 1 || !items.includes(row[6])) reason = "This pickup has a custom handler or visibility binding. Inspect its map logic before changing it.";
    notes.push("Native pickups give one item. Moving or changing the item preserves its object ID, pickup handler and collected state in existing saves.");
  } else if (kind === "trainer") {
    header = label ? trainerHeader(s.script, label) : null;
    const fields = header && body(s.script, header).match(/^trainer (EVENT_\w+),\s*(\d+),\s*(\w+),\s*(\w+),\s*(\w+)$/m);
    if (!fields) reason = "This trainer uses custom story or battle logic. Its party is available from Edit trainer party; inspect map logic for its scripted behavior.";
    else {
      event = fields[1]; sight = +fields[2];
      // A shared header changes multiple interactions. Keep its native ownership
      // explicit instead of quietly editing every referring trainer's range.
      if ([...s.script.matchAll(new RegExp(`\\bld hl, ${header}\\b`, "g"))].length !== 1) reason = "This trainer header is shared by multiple interactions. Review its callers before editing it.";
      const textSession = attachTextEditing({} as never, source);
      for (const [role, textLabel] of [["Challenge dialogue", fields[3]], ["Defeat dialogue", fields[4]], ["Post-battle dialogue", fields[5]]]) {
        try {
          const leaves = await textSession.getTextLeafDocuments(s.scriptPath, textLabel);
          if (leaves.length === 1 && leaves[0].editable && leaves[0].segments.length) dialogues.push({ role, document: leaves[0] });
          else notes.push(`${role} has multiple or custom paths; edit those through map logic.`);
        } catch { notes.push(`${role} could not be resolved; inspect its map logic.`); }
      }
    }
    const catalog = await parseTrainerBaseCatalog(source, s.files.some(f => f.path === "scripts/OaksLab_2.asm") ? "pokeyellow" : "pokered");
    parties = catalog.trainers.filter(p => p.partyNumber <= 255);
    if (!parties.some(p => p.id === `${row[6].slice(4)}:${row[7]}`)) reason ??= "This trainer's native party could not be resolved.";
    notes.push("The original defeat flag, trainer header and battle scripts are preserved. Parties and native dialogue may be shared; edits to them affect every caller.");
  } else reason = "This object is a special encounter rather than an ordinary trainer or pickup. Inspect its map logic to edit its behavior.";
  const refs = s.files.filter(f => /^(scripts|engine|home)\//.test(f.path) && new RegExp(`\\b${placement.objectConstant}\\b`).test(f.contents.split(/\r?\n/).map(clean).join("\n")));
  const placementReason = refs.length ? `An existing script refers to this object (${refs[0].path}). Its placement and appearance need a route review; its other supported fields remain editable.` : row[3] !== "STAY" || !["DOWN", "UP", "LEFT", "RIGHT", "NONE"].includes(row[4]) ? "This object has a specialized movement mode; its placement and appearance need source review." : null;
  const values: NativeMapObjectValues = { x: +row[0], y: +row[1], sprite: row[2], direction: row[4], item: kind === "item" ? row[6] : null, partyId: kind === "trainer" ? `${row[6].slice(4)}:${row[7]}` : null, sight, dialogues: dialogues.map(d => structuredClone(d.document.segments)) };
  const sources = [...await Promise.all(s.files.map(async f => ({ path: f.path, hash: await hashText(f.contents) }))), ...placement.sources.filter(f => !s.files.some(a => a.path === f.path))];
  // Keep the native placement reader's binary hash convention private to it.
  const document: NativeMapObjectDocument = { mapConstant: map, mapName: s.document.mapName, objectId: id, objectConstant: placement.objectConstant, kind, reason, placementReason, event, visibility, notes, placement, items, parties, dialogues, values, sources };
  return { s, row, header, document };
}
export async function loadNativeMapObjectDocument(source: ProjectSource, map: string, id: number) { return (await inspect(source, map, id)).document; }
export function nativeObjectPlacementError(d: NativeMapObjectDocument, v: NativeMapObjectValues) {
  const p = d.placement;
  if (!Number.isInteger(v.x) || !Number.isInteger(v.y) || v.x < 0 || v.y < 0 || v.x >= Math.min(p.width, 252) || v.y >= Math.min(p.height, 252)) return "Choose a whole-number position inside the map.";
  const moved = v.x !== d.values.x || v.y !== d.values.y;
  if (moved && !p.walkable.some(w => w.x === v.x && w.y === v.y)) return "Choose walkable ground.";
  if (moved && p.occupied.some(w => w.x === v.x && w.y === v.y)) return "This tile contains an object, warp or sign.";
  return null;
}
export async function prepareNativeMapObjectWrites(source: ProjectSource, document: NativeMapObjectDocument, values: NativeMapObjectValues): Promise<TextWriteRequest[]> {
  const fresh = await inspect(source, document.mapConstant, document.objectId), d = fresh.document;
  if (JSON.stringify(d.sources) !== JSON.stringify(document.sources)) throw new Error("Object sources changed. Reopen the editor before saving.");
  if (JSON.stringify(values) === JSON.stringify(d.values)) return [];
  if (d.reason) throw new Error(d.reason);
  const positionError = nativeObjectPlacementError(d, values); if (positionError) throw new Error(positionError);
  const placementChanged = ["x", "y", "sprite", "direction"].some(k => values[k as keyof NativeMapObjectValues] !== d.values[k as keyof NativeMapObjectValues]);
  if (placementChanged && d.placementReason) throw new Error(d.placementReason);
  if (!d.placement.sprites.includes(values.sprite) || !["DOWN", "UP", "LEFT", "RIGHT", ...(d.kind === "item" ? ["NONE"] : [])].includes(values.direction)) throw new Error("Choose compatible native graphics and facing.");
  if (values.sprite !== d.values.sprite && d.placement.stationarySprites.includes(values.sprite) && d.kind === "trainer") throw new Error("A native trainer needs animated character graphics.");
  if (d.kind === "item" && (!values.item || !d.items.includes(values.item) || values.partyId !== null || values.sight !== null)) throw new Error("Choose an available pickup item.");
  if (d.kind === "trainer" && (values.item !== null || !d.parties.some(p => p.id === values.partyId) || !Number.isInteger(values.sight) || values.sight! < 0 || values.sight! > 15)) throw new Error("Choose an existing party and a sight range from 0 to 15.");
  if (!Array.isArray(values.dialogues) || values.dialogues.length !== d.dialogues.length) throw new Error("Keep the resolved native dialogue bindings.");
  const changed = new Map<string, string>(), nl = fresh.s.objects.includes("\r\n") ? "\r\n" : "\n";
  const lines = fresh.s.objects.split(/\r?\n/); let slot = 0;
  for (let i = 0; i < lines.length; i++) if (/^object_event\b/.test(clean(lines[i])) && ++slot === d.objectId) {
    const args = [...fresh.row]; args[0] = String(values.x); args[1] = String(values.y); args[2] = values.sprite; args[4] = values.direction;
    if (d.kind === "item") args[6] = values.item!;
    else { const [cls, party] = values.partyId!.split(":"); args[6] = `OPP_${cls}`; args[7] = party; }
    let operand = 0;
    lines[i] = lines[i].replace(/^(\s*object_event\s+)([^;]+)(.*)$/, (_all, prefix, fields: string, suffix) => prefix + fields.split(",").map(field => { const value = args[operand++]; return field.trim() === value ? field : field.replace(/\S(?:[\s\S]*\S)?/, value); }).join(",") + suffix);
    break;
  }
  changed.set(fresh.s.objectPath, lines.join(nl));
  if (d.kind === "trainer" && values.sight !== d.values.sight) {
    const scriptLines = fresh.s.script.split(/\r?\n/), start = scriptLines.findIndex(l => clean(l) === `${fresh.header}:` || clean(l) === `${fresh.header}::`);
    const at = scriptLines.findIndex((l, i) => i > start && /^trainer\b/.test(clean(l)));
    scriptLines[at] = scriptLines[at].replace(/(trainer\s+EVENT_\w+,\s*)\d+/, `$1${values.sight}`);
    changed.set(fresh.s.scriptPath, scriptLines.join(fresh.s.script.includes("\r\n") ? "\r\n" : "\n"));
  }
  const leafChanges = new Map<string, string>();
  const chars = new Set([...fresh.s.read("constants/charmap.asm").matchAll(/^\s*charmap "([^"\\]+)",/gm)].map(m => m[1]));
  for (const [i, dialogue] of d.dialogues.entries()) {
    if (JSON.stringify(values.dialogues[i]) === JSON.stringify(d.values.dialogues[i])) continue;
    const leaf = dialogue.document, key = `${leaf.path}:${leaf.label}`, serialized = JSON.stringify(values.dialogues[i]);
    if (!Array.isArray(values.dialogues[i]) || values.dialogues[i].some(segment => typeof segment.text !== "string" || /[\r\n@\\"]/.test(segment.text) || (segment.text.match(/<[^>]*>|./gu) ?? []).some(char => !chars.has(char)))) throw new Error("Dialogue contains characters unavailable in this game's font.");
    if (leafChanges.has(key) && leafChanges.get(key) !== serialized) throw new Error("Two dialogue roles share the same native text. Keep their edits identical.");
    leafChanges.set(key, serialized);
    const before = changed.get(leaf.path) ?? fresh.s.read(leaf.path);
    changed.set(leaf.path, applyTextDocumentEdits(before, leaf.label, values.dialogues[i]));
  }
  // A moved native object can block a scene authored elsewhere on this map.
  // Reuse the NPC editor's existing route checks rather than bypassing them.
  if (placementChanged && fresh.s.script.includes("; yellow-editor-interaction:")) await refreshMapNpcInteractions(source, d.mapConstant, d.objectId, { ...d.placement.values, x: values.x, y: values.y, sprite: values.sprite, direction: values.direction, moveSceneStart: false }, changed);
  return (await Promise.all([...changed].map(async ([path, contents]) => contents === fresh.s.read(path) ? null : { path, contents, expectedHash: await hashText(fresh.s.read(path)) }))).filter(w => w !== null);
}
