import { hashText, bytesToHex } from "./history";
import { loadMapNpcSourceState, prepareMapNpcWrites, npcDialogueSegments } from "./npcCreation";
import { evaluateRgbdsExpression, projectConstantCatalogFromSources } from "./projectConstants";
import { parseTrainerBaseCatalog } from "./trainerBaseIndex";
import { applyTextDocumentEdits, parseTextDocument } from "./textEditing";
import { textLineLengthError } from "./textEditing";
import { inspectSceneEffects } from "./sceneEffects";
import { scenePlayerStarts } from "./interactionScene";
import { loadScriptInteractionDocument, prepareScriptInteractionWrites, type ManagedInteraction } from "./scriptInteractions";
import { sceneBattleReturnHook } from "./sceneEffectRuntime";
import { renderMapTrainers, trainerResumeHook, trainerFrameHook, trainerScratch, trainerScratchReservation, trainerBattleHook, trainerBattleRuntime, trainerEntryHook, type MapTrainerModel, type MapTrainerValues, type PlacedTrainer } from "./mapTrainerRuntime";
import type { MapNpcCreateDocument, MapSourceSnapshot, ProjectSource, TextWriteRequest, TrainerPartyEntry } from "./types";

export type { MapTrainerValues } from "./mapTrainerRuntime";
export interface MapTrainerDocument {
  mapConstant: string; mapName: string; objectId: number | null; npc: MapNpcCreateDocument;
  values: MapTrainerValues & { copyParty: boolean }; parties: TrainerPartyEntry[];
  walkable: Array<{ x: number; y: number }>; occupied: Array<{ x: number; y: number }>;
  sources: MapSourceSnapshot[];
}
const clean = (s: string) => s.split(/\r?\n/).map(l => l.split(";")[0].trim()).filter(Boolean).join("\n");
const nl = (s: string) => s.includes("\r\n") ? "\r\n" : "\n";
function section(text: string, label: string) {
  const matches = [...text.matchAll(new RegExp(`^${label}:{1,2}[ \t]*(?:;[^\\r\\n]*)?\\r?\\n`, "gm"))];
  if (matches.length !== 1) throw new Error(`Expected one ${label} definition.`);
  const from = matches[0].index!, start = from + matches[0][0].length;
  const next = text.slice(start).search(/^[A-Za-z_]\w*:{1,2}(?:[ \t]*;[^\r\n]*)?\r?$/m);
  return { from, start, to: next < 0 ? text.length : start + next, body: text.slice(start, next < 0 ? text.length : start + next) };
}
function readModel(script: string): MapTrainerModel | null {
  const matches = [...script.matchAll(/^; yellow-editor-map-trainers: (.+)$/gm)];
  if (!matches.length) return null;
  if (matches.length !== 1) throw new Error("Duplicate managed trainer records on this map.");
  const m = JSON.parse(matches[0][1]) as MapTrainerModel;
  if (m.version !== 1 || !Array.isArray(m.trainers) || !m.trainers.length || !script.includes(renderMapTrainers(m).replace(/\n/g, nl(script)))) throw new Error("Managed trainer code changed in source. Restore it before editing trainers.");
  return m;
}
function reviewRoot(script: string, name: string, old: MapTrainerModel | null) {
  let body = section(script, `${name}_Script`).body.replace(/\r\n/g, "\n");
  if (old) for (const hook of [trainerResumeHook(name), trainerFrameHook(name)]) {
    if (body.split(hook).length !== 2) throw new Error("The trainer dispatcher hook changed in source."); body = body.replace(hook, "");
  }
  body = body.replace(/\t; yellow-editor-scene-hook \w+\n[\s\S]*?\t; yellow-editor-scene-hook-end \w+\n/g, "");
  if (script.includes("; yellow-editor-strength: ")) body = body.replace(`\tcall ${name}EditorStrength\n`, "");
  if (!["jp EnableAutoTextBoxDrawing", "call EnableAutoTextBoxDrawing\nret"].includes(clean(body))) throw new Error("Place trainers on a new map or a map with a simple script. Existing custom trainer dispatchers need a separate source review.");
}
async function reviewRuntime(files: Map<string, string>, source: ProjectSource) {
  for (const [name, expected] of [["def_trainers", "b14dd394740939b1bcab050975ef2bb2d9f8979cd022e8a65ab07763b48c7d42"], ["trainer", "8e12a738ffd399bbe6e05af56ce2aae4cb44ce0becf56773b042092c9cf10dd8"]]) {
    const macros = [...(files.get("macros/scripts/maps.asm") ?? "").matchAll(new RegExp(`^MACRO ${name}\\r?\\n([\\s\\S]*?)^ENDM`, "gm"))];
    if (macros.length !== 1 || await hashText(clean(macros[0][1])) !== expected) throw new Error(`Trainer placement needs the reviewed ${name} macro.`);
  }
  for (const [path, hashes] of [["home/trainers.asm", ["be17e4d5c31ff28c3e2880a908db0a76d5aec256bf5acc335a029f4aaac3d973", "b5798cb3b54c6e1603e44556f535202809ffde57f104b68eebbaf52b746b1fce"]], ["engine/overworld/trainer_sight.asm", ["a7c6f172552bedf6ba8b6b19b99e15c94606adf157ab1b8a755898606b3ee520"]]] as const) if (!hashes.includes(await hashText(clean(files.get(path) ?? "")) as never)) throw new Error("Trainer placement needs the reviewed native trainer battle and sight routines.");
  const effects = await inspectSceneEffects(source, files);
  if (effects.battleReason) throw new Error(effects.battleReason);
  const ram = (files.get("ram/wram.asm") ?? "").replace(/\r\n/g, "\n"), clear = (files.get("engine/overworld/clear_variables.asm") ?? "").replace(/\r\n/g, "\n"), overworld = (files.get("home/overworld.asm") ?? "").replace(/\r\n/g, "\n");
  if (ram.includes("yellow-editor-trainer-scratch")) {
    if (ram.split(trainerScratch).length !== 2 || clear.split(trainerEntryHook).length !== 2 || overworld.split(trainerBattleHook).length !== 2 || overworld.split(trainerBattleRuntime).length !== 2) throw new Error("The shared trainer runtime changed in source.");
  } else if (ram.split(trainerScratchReservation).length !== 2 || /wEditorMapTrainer\w+/.test(ram + clear + overworld)) throw new Error("Trainer placement requires the reviewed six-byte unused WRAM reservation.");
  const nativeClear = clear.replace(trainerEntryHook, "").replace(/\t; yellow-editor-scene-map-entry-hook\n[\s\S]*?\t; yellow-editor-scene-map-entry-hook-end\n/, "");
  if (await hashText(clean(nativeClear)) !== "95544452ace4f24dcbb52eb2ea2601a24785d8fbd9446993c79b57d136a19977") throw new Error("Trainer placement needs the reviewed map-entry cleanup routine.");
}
async function inspect(source: ProjectSource, map: string, id?: number) {
  const s = await loadMapNpcSourceState(source, map, id), files = new Map(s.files.map(f => [f.path, f.contents])), old = readModel(s.script);
  if (old && (old.name !== s.name || old.map !== map)) throw new Error("The trainer record belongs to a different map.");
  reviewRoot(s.script, s.name, old); await reviewRuntime(files, source);
  const owned = old?.trainers.find(t => t.id === id);
  if (id !== undefined && !owned) throw new Error("This trainer was not placed by these map tools. Edit its party and dialogue through the existing trainer editor.");
  const constants = new Map(projectConstantCatalogFromSources(s.files.filter(f => f.path.startsWith("constants/"))).constants.map(e => [e.symbol, e.value]));
  let eventValue = 0;
  for (const row of s.read("constants/event_constants.asm").split(/\r?\n/)) {
    const line = clean(row), directive = line.match(/^(const_def|const_next|const_skip)(?:\s+(.+))?$/);
    if (directive) { const v = evaluateRgbdsExpression(directive[2] ?? (directive[1] === "const_def" ? "0" : "1"), constants); if (v === null) throw new Error("Cannot derive the event array layout."); eventValue = directive[1] === "const_skip" ? eventValue + v : v; }
    if (/^const EVENT_\w+$/.test(line)) eventValue++;
    const snapshot = line.match(/^DEF (\w+) EQU (.*\bconst_value\b.*)$/);
    if (snapshot) { const v = evaluateRgbdsExpression(snapshot[2].replace(/\bconst_value\b/g, String(eventValue)), constants); if (v !== null) constants.set(snapshot[1], v); }
  }
  const tilesetConstant = s.read(`data/maps/headers/${s.name}.asm`).match(/map_header\s+\w+,\s*\w+,\s*(\w+)/)?.[1];
  const tilesets = [...s.read("data/tilesets/tileset_headers.asm").matchAll(/^\s*tileset\s+(\w+),/gm)].map(m => m[1]);
  const tileset = tilesetConstant ? tilesets[constants.get(tilesetConstant)!] : null;
  const passable = tileset ? s.read("data/tilesets/collision_tile_ids.asm").slice(s.read("data/tilesets/collision_tile_ids.asm").indexOf(`${tileset}_Coll::`)).match(/coll_tiles\s+([^\r\n;]+)/)?.[1].split(",").map(v => evaluateRgbdsExpression(v.trim(), constants)) : null;
  const asset = tileset ? s.read("gfx/tilesets.asm").slice(s.read("gfx/tilesets.asm").indexOf(`${tileset}_Block::`)).match(/INCBIN "([^"]+)"/)?.[1] : null;
  if (!asset || !passable || passable.includes(null)) throw new Error("Cannot verify this map's trainer placement surfaces.");
  const blockPath = `maps/${s.name}.blk`, blocks = await source.readBytes(blockPath), blockset = await source.readBytes(asset), walkable: Array<{ x: number; y: number }> = [];
  if (blocks.length !== s.document.width / 2 * s.document.height / 2) throw new Error("Map layout dimensions do not match its header.");
  for (let y = 0; y < s.document.height; y++) for (let x = 0; x < s.document.width; x++) if (passable.includes(blockset[blocks[Math.floor(y / 2) * s.document.width / 2 + Math.floor(x / 2)] * 16 + (y % 2 * 2 + 1) * 4 + x % 2 * 2])) walkable.push({ x, y });
  const occupied = s.events.flatMap((e, i) => i + 1 === id ? [] : [{ x: +e[0], y: +e[1] }]);
  for (const m of s.objects.matchAll(/^\s*(?:warp_event|bg_event)\s+(\d+),\s*(\d+)/gm)) occupied.push({ x: +m[1], y: +m[2] });
  const projectName = files.has("scripts/OaksLab_2.asm") ? "pokeyellow" : "pokered", catalog = await parseTrainerBaseCatalog(source, projectName);
  if (catalog.warnings.length) throw new Error("Trainer party data has unsupported entries. Resolve its warnings before placing a trainer.");
  if (owned) {
    const row = s.events[id! - 1], v = owned.values, party = v.partyId.split(":");
    if (row.join(",") !== [v.x, v.y, v.sprite, "STAY", v.facing, owned.text, `OPP_${party[0]}`, party[1]].join(",") || !s.pointers.some(p => p.constant === owned.text && p.label === `${s.name}EditorTrainerText${id}`)) throw new Error("The trainer object or text binding changed in source.");
  }
  const values = owned ? { ...structuredClone(owned.values), copyParty: false } : { x: walkable.find(p => !occupied.some(o => o.x === p.x && o.y === p.y))?.x ?? 0, y: walkable.find(p => !occupied.some(o => o.x === p.x && o.y === p.y))?.y ?? 0, sprite: s.document.sprites.find(v => v === "SPRITE_HIKER") ?? s.document.sprites.find(v => !s.document.stationarySprites.includes(v)) ?? s.document.sprites[0], facing: "DOWN" as const, sight: 0, partyId: catalog.trainers.find(t => t.classConstant === "HIKER")?.id ?? catalog.trainers[0]?.id ?? "", before: ["Let's battle!"], defeat: ["You win!"], after: ["That was fun!"], copyParty: true };
  const document: MapTrainerDocument = { mapConstant: map, mapName: s.document.mapName, objectId: id ?? null, npc: s.document, values, parties: catalog.trainers.filter(t => t.partyNumber <= 255), walkable, occupied,
    sources: [...await Promise.all(s.files.map(async f => ({ path: f.path, hash: await hashText(f.contents) }))), ...await Promise.all([[blockPath, blocks], [asset, blockset]].map(async ([path, bytes]) => ({ path: path as string, hash: await hashText(bytesToHex(bytes as Uint8Array)), encoding: "hex" as const })))] };
  return { s, old, owned, document, files, constants, projectName };
}
export async function loadMapTrainerDocument(source: ProjectSource, map: string, id?: number) { return (await inspect(source, map, id)).document; }
export const trainerDelta = { DOWN: { x: 0, y: 1 }, UP: { x: 0, y: -1 }, LEFT: { x: -1, y: 0 }, RIGHT: { x: 1, y: 0 } };
export function trainerPlacementError(d: MapTrainerDocument, v: MapTrainerValues): string | null {
  if (!Number.isInteger(v.x) || !Number.isInteger(v.y) || v.x < 0 || v.y < 0 || v.x >= Math.min(d.npc.width, 252) || v.y >= Math.min(d.npc.height, 252) || !d.walkable.some(p => p.x === v.x && p.y === v.y)) return "Choose walkable ground inside the map.";
  if (d.occupied.some(p => p.x === v.x && p.y === v.y)) return "This position contains an object, sign or warp.";
  if (!trainerDelta[v.facing] || !Number.isInteger(v.sight) || v.sight < 0 || v.sight > 8) return "Choose a facing direction and sight range from 0 to 8.";
  if (!d.npc.sprites.includes(v.sprite) || v.sight > 0 && d.npc.stationarySprites.includes(v.sprite)) return "Choose compatible walking graphics for a trainer who approaches the player.";
  const step = trainerDelta[v.facing];
  for (let i = 1; i <= v.sight; i++) { const p = { x: v.x + step.x * i, y: v.y + step.y * i }; if (!d.walkable.some(w => w.x === p.x && w.y === p.y) || d.occupied.some(o => o.x === p.x && o.y === p.y)) return `Sight tile ${i} is blocked or reserved. Shorten the sight range or choose another position.`; }
  return null;
}
function reserveEvent(state: Awaited<ReturnType<typeof inspect>>, id: number) {
  const { s, constants } = state, cap = constants.get("NUM_EVENTS");
  const high = Math.max(...projectConstantCatalogFromSources(s.files.filter(f => f.path === "constants/event_constants.asm")).constants.filter(c => c.symbol.startsWith("EVENT_") && c.groupId !== null).map(c => c.value));
  if (!cap || cap % 8 || !/wEventFlags:: flag_array NUM_EVENTS/.test(s.read("ram/wram.asm"))) throw new Error("Cannot reserve a defeat flag without changing save layout.");
  const used = [...constants].filter(([key]) => key.startsWith("EVENT_")).map(([, value]) => value);
  for (let bit = cap - 1; bit > high; bit--) {
    if (bit % 8 !== id % 8 || used.includes(bit)) continue;
    const byte = Math.floor(bit / 8), literal = new RegExp(`wEventFlags\\s*\\+\\s*(?:\\$${byte.toString(16)}|${byte})\\b`, "i");
    if (s.files.some(f => literal.test(f.contents))) continue;
    if (s.files.some(f => !f.path.startsWith("macros/") && f.contents.split(/\r?\n/).some(l => { const m = clean(l).match(/^(?:Set|Reset)EventRange\s+([^,]+),\s*([^,]+)(?:,.*)?$/); if (!m) return false; const a = evaluateRgbdsExpression(m[1], constants), b = evaluateRgbdsExpression(m[2], constants); return a === null || b === null || bit >= a && bit <= b; }))) continue;
    return bit;
  }
  throw new Error("No verified unused defeat flag with the required native trainer bit remains. Existing flags and save arrays were left unchanged.");
}
function copyParty(state: Awaited<ReturnType<typeof inspect>>, selected: TrainerPartyEntry, changed: Map<string, string>) {
  const peers = state.document.parties.filter(p => p.classConstant === selected.classConstant), last = peers[peers.length - 1]!;
  if (last.partyNumber >= 255) throw new Error("This trainer class has no free party IDs.");
  const path = "data/trainers/parties.asm", original = state.files.get(path)!, lines = original.split(/\r?\n/), record = lines[selected.sourceLine - 1];
  if (!/^\s*db\s+.+,\s*0\s*(?:;.*)?$/.test(record)) throw new Error("The selected party does not have a supported native record.");
  const next = last.partyNumber + 1; lines.splice(last.sourceLine, 0, record.replace(/;.*$/, "").trimEnd() + ` ; editor party ${next}`); changed.set(path, lines.join(nl(original)));
  const moves = selected.specialMoves.filter(m => m.sourceKind === "yellow-party");
  if (moves.length) {
    const path = "data/trainers/special_moves.asm", text = state.files.get(path)!, all = text.split(/\r?\n/), ends = all.flatMap((l, i) => /^db\s+-1$/.test(clean(l)) ? [i] : []);
    if (ends.length !== 1) throw new Error("Cannot locate the native special-move list terminator.");
    all.splice(ends[0], 0, `\tdb ${selected.classConstant}, ${next}`, ...moves.map(m => `\tdb ${m.pokemonIndex}, ${m.moveSlot}, ${m.moveConstant}`), "\tdb 0", ""); changed.set(path, all.join(nl(text)));
  }
  return `${selected.classConstant}:${next}`;
}
export async function prepareMapTrainerWrites(source: ProjectSource, document: MapTrainerDocument, requested: MapTrainerDocument["values"]): Promise<TextWriteRequest[]> {
  const state = await inspect(source, document.mapConstant, document.objectId ?? undefined), d = state.document, { s } = state;
  if (JSON.stringify(d.sources) !== JSON.stringify(document.sources)) throw new Error("Trainer sources changed. Reopen Place trainer before saving.");
  const error = trainerPlacementError(d, requested); if (error) throw new Error(error);
  const selected = d.parties.find(p => p.id === requested.partyId); if (!selected) throw new Error("Choose an existing trainer party.");
  if (typeof requested.copyParty !== "boolean") throw new Error("Choose whether to copy or share the party.");
  for (const [role, texts] of [["challenge", requested.before], ["defeat", requested.defeat], ["after battle", requested.after]] as const) {
    if (!Array.isArray(texts) || !texts.length || texts.length > 16 || texts.some((t, i) => typeof t !== "string" || textLineLengthError(t, i === 0 ? 18 : 17) || /[\r\n@<>\\"]/u.test(t)) || !texts.some(t => t.trim())) throw new Error(`Enter readable ${role} dialogue: up to 18 spaces on the first row and 17 afterward.`);
    // Reuse the native NPC text validator for font and control-code validation.
    const label = "EditorTrainerDialogueCheck", template = `${label}:\n${npcDialogueSegments(texts).map(t => `\t${t.control} ""`).join("\n")}\n\tdone\n`;
    const text = applyTextDocumentEdits(template, label, npcDialogueSegments(texts));
    const chars = new Set([...s.read("constants/charmap.asm").matchAll(/^\s*charmap "([^"\\])",\s*\$([\da-f]{2})\b/gmi)].filter(m => parseInt(m[2], 16) >= 0x60 || m[1] === "#" && m[2] === "54").map(m => m[1]));
    if (texts.some(t => [...t].some(c => !chars.has(c))) || !(await parseTextDocument(s.scriptPath, label, text)).editable) throw new Error("Trainer dialogue contains characters unavailable in this game's font.");
  }
  const changed = new Map<string, string>();
  const partyId = requested.copyParty ? copyParty(state, selected, changed) : requested.partyId, values: MapTrainerValues = { ...requested, partyId }; delete (values as Partial<MapTrainerDocument["values"]>).copyParty;
  const id = document.objectId ?? s.document.objectId, prefix = `${s.name}EditorTrainer`;
  let object: string, text: string, script = s.script, objects = s.objects;
  if (document.objectId === null) {
    if (!state.old && s.files.some(f => f.contents.includes(prefix))) throw new Error("A trainer helper symbol already uses this map's generated prefix.");
    if (state.old && s.files.some(f => new RegExp(`\\b${prefix}(?:Text|Header|Before|Defeat|After)${id}\\b`).test(f.path === s.scriptPath ? f.contents.replace(renderMapTrainers(state.old!), "") : f.contents))) throw new Error("A generated trainer symbol already exists.");
    for (const w of await prepareMapNpcWrites(source, s.document, { x: values.x, y: values.y, sprite: values.sprite, movement: "STAY", direction: values.facing, dialogue: { kind: "new", lines: values.before } })) changed.set(w.path, w.contents);
    objects = changed.get(s.objectPath)!; script = changed.get(s.scriptPath)!;
    object = [...objects.matchAll(/^\s*const_export (\w+)\s*$/gm)][id - 1][1];
    const row = objects.split(/\r?\n/).filter(l => /^\s*object_event\s+/.test(l))[id - 1]; text = row.split(",")[5].trim();
    const oldLabel = script.match(new RegExp(`dw_const\\s+(\\w+)\\s*,\\s*${text}\\b`))![1], r = section(script, oldLabel);
    script = script.slice(0, r.from) + script.slice(r.to);
    script = script.replace(new RegExp(`(dw_const\\s+)${oldLabel}(\\s*,\\s*${text}\\b)`), `$1${prefix}Text${id}$2`);
  } else { object = state.owned!.object; text = state.owned!.text; }
  let event = state.owned?.event;
  if (!event) {
    const bit = reserveEvent(state, id); event = `EVENT_${object}_BEATEN`;
    if (state.constants.has(event)) throw new Error("The trainer's defeat flag name is already defined.");
    const path = "constants/event_constants.asm", before = state.files.get(path)!; changed.set(path, before + `${nl(before)}DEF ${event} EQU $${bit.toString(16)}${nl(before)}`);
  }
  const trainer: PlacedTrainer = { id, object, text, label: `${prefix}Text${id}`, event, values }, model: MapTrainerModel = { version: 1, name: s.name, map: document.mapConstant, trainers: [...(state.old?.trainers.filter(t => t.id !== id) ?? []), trainer].sort((a, b) => a.id - b.id) };
  const parts = partyId.split(":"), all = objects.split(/\r?\n/), line = all.flatMap((l, i) => /^\s*object_event\s+/.test(l) ? [i] : [])[id - 1];
  all[line] = `\tobject_event ${values.x}, ${values.y}, ${values.sprite}, STAY, ${values.facing}, ${text}, OPP_${parts[0]}, ${parts[1]}`; changed.set(s.objectPath, all.join(nl(objects)));
  if (state.old) script = script.replace(renderMapTrainers(state.old).replace(/\n/g, nl(script)), renderMapTrainers(model).replace(/\n/g, nl(script)));
  else {
    const r = section(script, `${s.name}_Script`), root = script.slice(r.from, r.to), newline = nl(script);
    const tail = /(?:\tjp EnableAutoTextBoxDrawing|\tret)(?:\s*;[^\r\n]*)?\r?\n?\s*$/.exec(root);
    if (!tail) throw new Error("Could not install the trainer frame hook.");
    const rootNext = root.slice(0, root.indexOf("\n") + 1) + trainerResumeHook(s.name).replace(/\n/g, newline) + root.slice(root.indexOf("\n") + 1, tail.index) + trainerFrameHook(s.name).replace(/\n/g, newline) + tail[0];
    script = script.slice(0, r.from) + rootNext + script.slice(r.to);
  }
  if (!state.old) script += (script.endsWith("\n") ? nl(script) : nl(script) + nl(script)) + renderMapTrainers(model).replace(/\n/g, nl(script)); changed.set(s.scriptPath, script);
  if (!state.files.get("ram/wram.asm")!.includes("yellow-editor-trainer-scratch")) {
    const ram = state.files.get("ram/wram.asm")!, clear = state.files.get("engine/overworld/clear_variables.asm")!, overworld = state.files.get("home/overworld.asm")!;
    changed.set("ram/wram.asm", ram.replace(trainerScratchReservation.replace(/\n/g, nl(ram)), trainerScratch.replace(/\n/g, nl(ram))));
    changed.set("engine/overworld/clear_variables.asm", clear.replace(/^(ClearVariablesOnEnterMap::\r?\n)/m, `$1${trainerEntryHook.replace(/\n/g, nl(clear))}`));
    const anchor = `\n.battleOccurred\n${overworld.replace(/\r\n/g, "\n").includes(sceneBattleReturnHook) ? sceneBattleReturnHook : ""}`.replace(/\n/g, nl(overworld));
    if (!overworld.includes(anchor)) throw new Error("Cannot find the native battle-return boundary.");
    changed.set("home/overworld.asm", overworld.replace(anchor, anchor + trainerBattleHook.replace(/\n/g, nl(overworld))) + nl(overworld) + trainerBattleRuntime.replace(/\n/g, nl(overworld)));
  }
  const staged: ProjectSource = { ...source, readBytes: source.readBytes.bind(source), listFiles: source.listFiles?.bind(source), readText: async p => changed.get(p) ?? source.readText(p), exists: async p => changed.has(p) || source.exists(p) };
  const scenes = [...s.script.matchAll(/^\s*; yellow-editor-interaction: (.+)$/gm)].map(m => JSON.parse(m[1]) as ManagedInteraction).filter(m => m.version === 3 && m.scene);
  for (const scene of scenes) {
    if (scene.values.scene && scenePlayerStarts(scene.values.scene).some(p => p.x === values.x && p.y === values.y) && !scene.values.scene.hiddenNpcs.includes(object)) throw new Error(`The trainer would occupy interaction ${scene.label}'s player start. Choose another tile.`);
    try {
      const doc = await loadScriptInteractionDocument(staged, s.scriptPath, scene.label);
      for (const w of await prepareScriptInteractionWrites(staged, doc, doc.values)) changed.set(w.path, w.contents);
    } catch (e) { throw new Error(`The trainer placement would invalidate interaction ${scene.label}: ${String(e)}`); }
  }
  return Promise.all([...changed].filter(([p, content]) => content !== state.files.get(p)).map(async ([path, contents]) => ({ path, contents, expectedHash: await hashText(state.files.get(path)!) })));
}
