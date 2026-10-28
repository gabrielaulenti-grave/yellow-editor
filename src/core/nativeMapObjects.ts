import { hashText } from "./history";
import { loadMapNpcSourceState } from "./npcCreation";
import { loadMapNpcEditDocument, refreshMapNpcInteractions } from "./npcEditing";
import { parseItemConstantDefinitions } from "./itemConstants";
import { evaluateRgbdsExpression } from "./projectConstants";
import { objectSourceConstants, sourceTrainerHeaders, type ObjectSourceEvidence, type SourceTrainerHeader } from "./mapObjectAnalysis";
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
  appearanceReason: string | null;
  itemReason: string | null; partyReason: string | null; sightReason: string | null; evidence: ObjectSourceEvidence[];
  event: string | null; visibility: string | null; notes: string[];
  placement: MapNpcEditDocument; items: string[]; parties: TrainerPartyEntry[];
  dialogues: Array<{ role: string; document: TextDocument }>;
  values: NativeMapObjectValues; sources: MapSourceSnapshot[];
}
const clean = (s: string) => s.split(";")[0].trim();
async function importedTextLeaves(session: ReturnType<typeof attachTextEditing>, files: Array<{ path: string; contents: string }>, path: string, label: string, seen = new Set<string>()): Promise<TextDocument[]> {
  const key = `${path}:${label}`; if (seen.has(key) || seen.size > 32) throw new Error("Dialogue paths are cyclic or too deep."); seen.add(key);
  try { const leaves = await session.getTextLeafDocuments(path, label); if (leaves.some(l => l.editable && l.segments.length)) return leaves; } catch { /* Try actual definitions rather than filename conventions. */ }
  const definitions = files.filter(f => f.contents.includes(`${label}:`) && f.contents.split(/\r?\n/).some(l => clean(l) === `${label}:` || clean(l) === `${label}::`));
  if (definitions.length !== 1) throw new Error("The dialogue label is missing or ambiguous.");
  const file = definitions[0], lines = file.contents.split(/\r?\n/), at = lines.findIndex(l => clean(l) === `${label}:` || clean(l) === `${label}::`);
  let end = at + 1; while (end < lines.length && !/^[A-Za-z_]\w*:{1,2}$/.test(clean(lines[end]))) end++;
  const targets = lines.slice(at + 1, end).flatMap(l => clean(l).match(/^text_far\s+([.\w]+)$/)?.[1] ?? []);
  if (targets.length === 1) return importedTextLeaves(session, files, file.path, targets[0], seen);
  return session.getTextLeafDocuments(file.path, label);
}
async function inspect(source: ProjectSource, map: string, id: number) {
  const s = await loadMapNpcSourceState(source, map, id), placement = await loadMapNpcEditDocument(source, map, id);
  const row = s.events[id - 1];
  if (!row || row.length < 7) throw new Error("Choose a native pickup, trainer or special encounter.");
  const managed = s.script.match(/^; yellow-editor-map-trainers: (.+)$/m);
  if (managed && (JSON.parse(managed[1]) as { trainers: Array<{ id: number }> }).trainers.some(t => t.id === id)) throw new Error("Use Edit trainer for a trainer created by these tools.");
  const constants = objectSourceConstants(s.files);
  const opponent = evaluateRgbdsExpression(row[6], constants), partyNumber = row[7] ? evaluateRgbdsExpression(row[7], constants) : null;
  const knownClass = opponent !== null && [...constants].some(([name, value]) => name.startsWith("#opponent:") && value === opponent);
  const kind = row.length === 7 ? "item" : knownClass || /^OPP_\w+$/.test(row[6]) ? "trainer" : "special";
  const label = s.pointers.find(p => p.constant === row[5])?.label;
  const reason: string | null = null;
  let itemReason: string | null = null, partyReason: string | null = null, sightReason: string | null = null;
  let event: string | null = null, header: SourceTrainerHeader | null = null, partyId: string | null = null;
  const evidence: ObjectSourceEvidence[] = [];
  let sight: number | null = null, visibility: string | null = null;
  const notes: string[] = [], dialogues: NativeMapObjectDocument["dialogues"] = [];
  if (!s.objectConstants[id - 1]) notes.push(`This record has no declared source constant; it is identified by its existing object slot ${id}.`);
  let slot = 0;
  const objectLine = s.objects.split(/\r?\n/).findIndex(l => /^object_event\b/.test(clean(l)) && ++slot === id);
  evidence.push({ path: s.objectPath, line: objectLine + 1, detail: `Encoded object slot ${id}; its script and saved-state identities are retained.` });
  const itemDefinitions = parseItemConstantDefinitions(s.read("constants/item_constants.asm")).filter(i => i.id > 0 && i.id < 255);
  const items = itemDefinitions.map(i => i.constant);
  const item = kind === "item" ? itemDefinitions.find(i => i.constant === row[6] || i.id === evaluateRgbdsExpression(row[6], constants))?.constant ?? row[6] : null;
  let parties: TrainerPartyEntry[] = [];
  if (kind === "item") {
    const toggleSection = s.read("data/maps/toggleable_objects.asm").match(new RegExp(`^[ \\t]*toggleable_objects_for[ \\t]+${map}[ \\t]*(?:;[^\\r\\n]*)?\\r?\\n([\\s\\S]*?)(?=^[ \\t]*toggleable_objects_for\\b|$(?![\\s\\S]))`, "m"))?.[1] ?? "";
    const toggles = [...toggleSection.matchAll(new RegExp(`\\btoggle_object_state[ \\t]+${placement.objectConstant},[ \\t]*(ON|OFF)\\b`, "g"))];
    if (toggles.length === 1) visibility = toggles[0][1] === "ON" ? "Initially visible; collection keeps the existing saved object state." : "Initially hidden; existing story logic controls when it appears.";
    if (!item || !items.includes(item)) itemReason = "The item expression could not be matched to this project's item table.";
    if (toggles.length !== 1) notes.push("Visibility has a custom or unresolved binding. Its source is preserved; item and placement edits do not require changing it.");
    notes.push("This record stores the item. Quantity and conditions remain in the imported handler; record edits preserve its script links and collection state.");
  } else if (kind === "trainer") {
    const analysis = label ? sourceTrainerHeaders(s.files, s.scriptPath, label, constants) : { headers: [], notes: ["The text pointer could not be resolved."] };
    notes.push(...analysis.notes);
    header = analysis.headers.length === 1 && !analysis.notes.some(n => /limit|unresolved control/.test(n)) ? analysis.headers[0] : null;
    if (!header) sightReason = "A unique trainer header could not be resolved through this object's script paths. Party and placement are independent of this field.";
    else {
      event = header.event; sight = header.sight; evidence.push(...header.evidence);
      if (sight === null) sightReason = "The header's sight expression could not be evaluated.";
      const textSession = attachTextEditing({} as never, source);
      for (const [role, textLabel] of [["Challenge dialogue", header.texts[0]], ["Defeat dialogue", header.texts[1]], ["Post-battle dialogue", header.texts[2]]]) {
        try {
          const leaves = await importedTextLeaves(textSession, s.files, header.path, textLabel);
          if (leaves.length === 1 && leaves[0].editable && leaves[0].segments.length) dialogues.push({ role, document: leaves[0] });
          else notes.push(`${role} has multiple or custom paths; edit those through map logic.`);
        } catch { notes.push(`${role} could not be resolved; inspect its map logic.`); }
      }
    }
    try {
      const catalog = await parseTrainerBaseCatalog(source, s.files.some(f => f.path === "scripts/OaksLab_2.asm") ? "pokeyellow" : "pokered");
      parties = catalog.trainers.filter(p => p.partyNumber <= 255);
      partyId = parties.find(p => constants.get(`#opponent:${p.classConstant}`) === opponent && p.partyNumber === partyNumber)?.id ?? null;
      if (!partyId) partyReason = "The opponent and party expressions could not be matched to this project's trainer table.";
    } catch {
      partyReason = "The imported trainer table could not be decoded. Party data stays unchanged; placement, sight and supported dialogue remain independent.";
    }
    notes.push("The original defeat flag, trainer header and battle scripts are preserved. Parties and native dialogue may be shared; edits to them affect every caller.");
  } else notes.push("This is a special encounter. Its encoded position and appearance can be edited when unbound; its custom behavior stays in map logic.");
  const refs = s.files.filter(f => /^(scripts|engine|home)\//.test(f.path) && new RegExp(`\\b${placement.objectConstant}\\b`).test(f.contents.split(/\r?\n/).map(clean).join("\n")));
  const placementReason = refs.length ? `An existing script refers to this object (${refs[0].path}). Its placement and appearance need a route review; its other supported fields remain editable.` : null;
  const appearanceReason = placement.appearanceReason ?? (row[3] !== "STAY" || !["DOWN", "UP", "LEFT", "RIGHT", "NONE"].includes(row[4]) ? "The imported movement mode is preserved. Appearance changes need a movement adapter." : null);
  const values: NativeMapObjectValues = { x: +row[0], y: +row[1], sprite: row[2], direction: row[4], item, partyId, sight, dialogues: dialogues.map(d => structuredClone(d.document.segments)) };
  const sources = [...await Promise.all(s.files.map(async f => ({ path: f.path, hash: await hashText(f.contents) }))), ...placement.sources.filter(f => !s.files.some(a => a.path === f.path))];
  // Keep the native placement reader's binary hash convention private to it.
  const document: NativeMapObjectDocument = { mapConstant: map, mapName: s.document.mapName, objectId: id, objectConstant: placement.objectConstant, kind, reason, itemReason, partyReason, sightReason, evidence, placementReason, appearanceReason, event, visibility, notes, placement, items, parties, dialogues, values, sources };
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
  const appearanceChanged = values.sprite !== d.values.sprite || values.direction !== d.values.direction;
  if (appearanceChanged && d.appearanceReason) throw new Error(d.appearanceReason);
  if (appearanceChanged && (!d.placement.sprites.includes(values.sprite) || !["DOWN", "UP", "LEFT", "RIGHT", ...(d.kind === "item" ? ["NONE"] : [])].includes(values.direction))) throw new Error("Choose compatible native graphics and facing.");
  if (values.sprite !== d.values.sprite && d.placement.stationarySprites.includes(values.sprite) && d.kind === "trainer") throw new Error("A native trainer needs animated character graphics.");
  if (values.item !== d.values.item && (d.kind !== "item" || d.itemReason || !values.item || !d.items.includes(values.item))) throw new Error("Choose an available pickup item.");
  if (values.partyId !== d.values.partyId && (d.kind !== "trainer" || d.partyReason || !d.parties.some(p => p.id === values.partyId))) throw new Error(d.partyReason ?? "Choose an existing party.");
  if (values.sight !== d.values.sight && (d.kind !== "trainer" || d.sightReason || !Number.isInteger(values.sight) || values.sight! < 0 || values.sight! > 15)) throw new Error(d.sightReason ?? "Choose a sight range from 0 to 15.");
  if (!Array.isArray(values.dialogues) || values.dialogues.length !== d.dialogues.length) throw new Error("Keep the resolved native dialogue bindings.");
  const changed = new Map<string, string>(), nl = fresh.s.objects.includes("\r\n") ? "\r\n" : "\n";
  const lines = fresh.s.objects.split(/\r?\n/); let slot = 0;
  for (let i = 0; i < lines.length; i++) if (/^object_event\b/.test(clean(lines[i])) && ++slot === d.objectId) {
    const args = clean(lines[i]).replace(/^object_event\s+/, "").split(",").map(a => a.trim());
    if (values.x !== d.values.x) args[0] = String(values.x);
    if (values.y !== d.values.y) args[1] = String(values.y);
    if (values.sprite !== d.values.sprite) args[2] = values.sprite;
    if (values.direction !== d.values.direction) args[4] = values.direction;
    if (values.item !== d.values.item) args[6] = values.item!;
    if (values.partyId !== d.values.partyId) {
      const [cls, party] = values.partyId!.split(":"), constants = objectSourceConstants(fresh.s.files), prefix = `#opponentAlias:${cls}:`;
      const symbol = [...constants.keys()].find(name => name.startsWith(prefix))?.slice(prefix.length);
      if (!symbol) throw new Error("The selected opponent's source constant could not be resolved.");
      args[6] = symbol; args[7] = party;
    }
    let operand = 0;
    lines[i] = lines[i].replace(/^(\s*object_event\s+)([^;]+)(.*)$/, (_all, prefix, fields: string, suffix) => prefix + fields.split(",").map(field => { const value = args[operand++]; return field.trim() === value ? field : field.replace(/\S(?:[\s\S]*\S)?/, value); }).join(",") + suffix);
    break;
  }
  changed.set(fresh.s.objectPath, lines.join(nl));
  if (d.kind === "trainer" && values.sight !== d.values.sight) {
    const binding = fresh.header!;
    const original = fresh.s.read(binding.path), scriptLines = original.split(/\r?\n/);
    scriptLines[binding.line] = scriptLines[binding.line].replace(/(trainer\s+[^,]+,)([^,]+)(,)/, (_all, prefix, operand: string, suffix) => prefix + operand.replace(/\S(?:[\s\S]*\S)?/, String(values.sight)) + suffix);
    changed.set(binding.path, scriptLines.join(original.includes("\r\n") ? "\r\n" : "\n"));
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
