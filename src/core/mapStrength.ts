import { hashText, bytesToHex } from "./history";
import { insertAfterTrainerResume } from "./mapTrainerRuntime";
import { sceneVisibilityHook, conditionVisibilityHook } from "./objectVisibilityHooks";
import { loadMapVisualization, parseMapIndex } from "./mapVisualization";
import { loadMapNpcSourceState, prepareMapNpcWrites } from "./npcCreation";
import { loadMapWarpDocument, prepareMapWarpWrites } from "./mapEditing";
import { readProjectRgbdsSources, projectConstantCatalogFromSources, evaluateRgbdsExpression } from "./projectConstants";
import type { MapVisualization, ProjectSource, TextWriteRequest } from "./types";

const clean = (line: string) => line.split(";")[0].trim();
const rows = (text: string) => text.split(/\r?\n/);
async function reviewEngine(files: Map<string, string>) {
  for (const [path, expected] of [["engine/overworld/push_boulder.asm", "0318f76b582768f28615d465b3cd4132fd7014ab781c7f795ff900f46a697243"], ["engine/overworld/update_map.asm", "d2c130e37d04b2630e55d47717069b664400cda61b491a16795093dcb783e7a7"]]) {
    if (await hashText(rows(files.get(path) ?? "").map(clean).filter(Boolean).join("\n")) !== expected) throw new Error(`${path}: Strength authoring requires the reviewed native pushing and block replacement routines.`);
  }
}
const marker = "; yellow-editor-strength: ";
const begin = "; yellow-editor-strength-code-begin", end = "; yellow-editor-strength-code-end";
export interface StrengthGoal {
  id: number; event: string; x: number; y: number; boulderId: number;
  kind: "switch" | "hole";
  destination: { map: string; objectId: number; warpId: number } | null;
  warpId?: number;
}
export interface StrengthGate { x: number; y: number; block: number; goals: number[] }
export interface StrengthCurrent { x: number; y: number; events: string[]; path: Array<{ direction: "UP" | "DOWN" | "LEFT" | "RIGHT"; steps: number }> }
export interface MapStrengthValues {
  boulders: Array<{ id: number; x: number; y: number }>;
  targets: Array<{ line: number; x: number; y: number }>;
  gates: Array<{ line: number; x: number; y: number; block: number }>;
  landings: Array<{ line: number; map: string; x: number; y: number }>;
  nativeMoves: Array<{ line: number; route: string; direction: "UP" | "DOWN" | "LEFT" | "RIGHT"; steps: number }>;
  goals: StrengthGoal[]; changes: StrengthGate[]; currents: StrengthCurrent[];
}
interface Managed { version: 1; map: string; name: string; goals: StrengthGoal[]; changes: StrengthGate[]; currents?: StrengthCurrent[] }
export interface MapStrengthDocument {
  mapConstant: string; mapName: string; visualization: MapVisualization; values: MapStrengthValues;
  boulders: Array<{ id: number; constant: string; x: number; y: number }>;
  destinations: Array<{ map: string; name: string; width: number; height: number; boulders: Array<{ id: number; constant: string; x: number; y: number }>; warps: number[] }>;
  native: boolean; notes: string[]; sources: Array<{ path: string; hash: string; encoding?: "hex" }>;
  completionFlags: Array<{ event: string; label: string }>;
}
function integer(n: number, min: number, max: number, label: string) {
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label} must be a whole number from ${min} to ${max}.`);
}
function metadata(text: string): Managed | null {
  const found = rows(text).filter(line => line.startsWith(marker));
  if (!found.length) return null;
  if (found.length !== 1) throw new Error("Multiple managed Strength records need source review.");
  const m = JSON.parse(found[0].slice(marker.length)) as Managed;
  if (m.version !== 1 || !/^[A-Z][A-Z0-9_]*$/.test(m.map) || !/^\w+$/.test(m.name) || !Array.isArray(m.goals) || !Array.isArray(m.changes)) throw new Error("Unsupported managed Strength puzzle.");
  for (const [i, g] of m.goals.entries()) {
    if (g.id !== i + 1 || !/^EVENT_[A-Z0-9_]+$/.test(g.event) || !Number.isInteger(g.boulderId) || g.boulderId < 1 || g.boulderId > 15 || !["hole", "switch"].includes(g.kind)) throw new Error("A managed Strength target identity was changed in source.");
    if (g.kind === "switch" && (g.destination !== null || g.warpId !== undefined) || g.kind === "hole" && (!g.destination || !/^[A-Z][A-Z0-9_]*$/.test(g.destination.map) || !Number.isInteger(g.destination.objectId) || g.destination.objectId < 1 || g.destination.objectId > 15 || !Number.isInteger(g.destination.warpId) || g.destination.warpId < 1 || !Number.isInteger(g.warpId) || g.warpId! < 1)) throw new Error("A managed Strength hole link was changed in source.");
  }
  return m;
}
function objects(text: string) {
  const constants = [...text.matchAll(/^\s*const_export (\w+)/gm)].map(m => m[1]);
  return rows(text).flatMap((line, i) => {
    const m = clean(line).match(/^object_event\s+(\d+),\s*(\d+),\s*SPRITE_BOULDER,\s*STAY,\s*BOULDER_MOVEMENT_BYTE_2,\s*(\w+)$/);
    if (!m) return [];
    const id = rows(text).slice(0, i + 1).filter(row => /^object_event\b/.test(clean(row))).length;
    return [{ id, line: i, constant: constants[id - 1], x: +m[1], y: +m[2] }];
  });
}
function goalCode(m: Managed, width: number) {
  const out = [`${m.name}EditorStrength:`, "\tpush af", "\tpush bc", "\tpush de", "\tpush hl", "\tldh a, [hSpriteIndex]", "\tpush af"];
  for (const g of m.goals) {
    out.push(`.goal${g.id}`, `\tCheckEvent ${g.event}`, `\tjp nz, .goal${g.id}Done`, "\tld hl, wMiscFlags", "\tbit BIT_PUSHED_BOULDER, [hl]", `\tjp z, .goal${g.id}Done`, "\tldh a, [hSpriteIndex]", `\tcp ${g.boulderId}`, `\tjp nz, .goal${g.id}Done`, `\tld hl, .target${g.id}`, "\tcall CheckBoulderCoords", `\tjp nc, .goal${g.id}Done`, `\tSetEvent ${g.event}`, ...(g.kind === "hole" ? ["\tcall UpdateSprites", "\tjp .goalsDone"] : []), `.goal${g.id}Done`);
  }
  out.push(".goalsDone");
  for (const [i, gate] of m.changes.entries()) {
    for (const id of gate.goals) out.push(`\tCheckEvent ${m.goals.find(g => g.id === id)!.event}`, `\tjp z, .gate${i}Done`);
    const offset = (gate.y + 3) * (width + 6) + gate.x + 3;
    out.push(`\tld a, [wOverworldMap + ${offset}]`, `\tcp ${gate.block}`, `\tjr z, .gate${i}Done`, `\tld a, ${gate.block}`, "\tld [wNewTileBlockID], a", `\tlb bc, ${gate.y}, ${gate.x}`, "\tpredef ReplaceTileBlock", `.gate${i}Done`);
  }
  for (const [i, current] of (m.currents ?? []).entries()) {
    for (const event of current.events) out.push(`\tCheckEvent ${event}`, `\tjp z, .current${i}Active`);
    out.push(`\tjp .current${i}Done`, `.current${i}Active`, "\tld a, [wStatusFlags5]", "\tbit BIT_SCRIPTED_MOVEMENT_STATE, a", `\tjp nz, .current${i}Done`, "\tld a, [wSimulatedJoypadStatesIndex]", "\tand a", `\tjp nz, .current${i}Done`, "\tld a, [wWalkBikeSurfState]", "\tcp 2", `\tjp nz, .current${i}Done`, "\tld a, [wXCoord]", `\tcp ${current.x}`, `\tjp nz, .current${i}Done`, "\tld a, [wYCoord]", `\tcp ${current.y}`, `\tjp nz, .current${i}Done`, "\tld hl, wSimulatedJoypadStatesEnd", `\tld de, .current${i}Path`, "\tcall DecodeRLEList", "\tdec a", "\tld [wSimulatedJoypadStatesIndex], a", "\tcall StartSimulatingJoypadStates", `.current${i}Done`);
  }
  out.push("\tld hl, wMiscFlags", "\tres BIT_PUSHED_BOULDER, [hl]", "\tpop af", "\tldh [hSpriteIndex], a", "\tpop hl", "\tpop de", "\tpop bc", "\tpop af", "\tret");
  for (const g of m.goals) out.push(`.target${g.id}`, `\tdbmapcoord ${g.x}, ${g.y}`, "\tdb -1");
  for (const [i, current] of (m.currents ?? []).entries()) out.push(`.current${i}Path`, ...[...current.path].reverse().map(step => `\tdb PAD_${step.direction}, ${step.steps}`), "\tdb -1");
  return out.join("\n") + "\n";
}
function managedBlock(m: Managed, width: number) { return `${marker}${JSON.stringify(m)}\n${begin}\n${goalCode(m, width)}${end}\n`; }
function visibilityCode(all: Managed[]) {
  const conditions = new Map<string, { map: string; object: number; incoming?: string; outgoing?: string }>();
  for (const m of all) for (const g of m.goals.filter(g => g.kind === "hole")) {
    for (const [map, object, direction] of [[m.map, g.boulderId, "outgoing"], [g.destination!.map, g.destination!.objectId, "incoming"]] as const) {
      const key = `${map}:${object}`, value = conditions.get(key) ?? { map, object };
      if (value[direction] && value[direction] !== g.event) throw new Error("A boulder can have only one incoming and one outgoing hole.");
      value[direction] = g.event; conditions.set(key, value);
    }
  }
  const grouped = new Map<string, Array<{ object: number; incoming?: string; outgoing?: string }>>();
  for (const c of conditions.values()) grouped.set(c.map, [...(grouped.get(c.map) ?? []), c]);
  const maps = [...grouped];
  const out = ['PUSHS', 'SECTION "Editor Strength Visibility", ROMX', "EditorStrengthObjectVisibility::", "\tpush bc", "\tpush de", "\tpush hl", "\tld a, [wCurMap]", "\tcp NUM_MAPS", "\tjp nc, .ordinary", "\tld l, a", "\tld h, 0", "\tadd hl, hl", "\tld de, .maps", "\tadd hl, de", "\tld a, [hli]", "\tld h, [hl]", "\tld l, a", "\tjp hl"];
  for (const [mapIndex, [, entries]] of maps.entries()) {
    out.push(`.map${mapIndex}`);
    for (const [objectIndex, c] of entries.entries()) {
      const suffix = `${mapIndex}_${objectIndex}`;
      out.push("\tldh a, [hCurrentSpriteOffset]", "\tswap a", `\tcp ${c.object}`, `\tjp nz, .next${suffix}`);
      if (c.outgoing) out.push(`\tCheckEvent ${c.outgoing}`, `\tjr nz, .hidden${suffix}`);
      if (c.incoming) out.push(`\tCheckEvent ${c.incoming}`, `\tjr z, .hidden${suffix}`);
      out.push("\txor a", `\tjr .store${suffix}`, `.hidden${suffix}`, "\tld a, 1", `.store${suffix}`, "\tldh [hIsToggleableObjectOff], a", "\tpop hl", "\tpop de", "\tpop bc", "\tscf", "\tret", `.next${suffix}`);
    }
    out.push("\tjp .ordinary");
  }
  out.push(".ordinary", "\tpop hl", "\tpop de", "\tpop bc", "\tand a", "\tret", ".maps", "FOR n, NUM_MAPS");
  maps.forEach(([map], i) => out.push(`${i ? "ELIF" : "IF"} n == ${map}`, `\tdw .map${i}`));
  if (maps.length) out.push("ELSE");
  out.push("\tdw .ordinary");
  if (maps.length) out.push("ENDC");
  out.push("ENDR", "POPS");
  return out.join("\n") + "\n";
}
function waterLandingCode(all: Managed[]) {
  const drops = all.flatMap(m => m.goals.filter(g => g.kind === "hole").map(g => ({ source: m.map, destination: g.destination! })));
  return ["PUSHS", 'SECTION "Editor Strength Water Landings", ROMX', "EditorStrengthWaterLanding::", "\tld a, [wCurMapTileset]", "\tcp CAVERN", "\tjp nz, .ordinary", "\tlda_coord 8, 9", "\tcp $14", "\tjp nz, .ordinary", ...drops.flatMap((drop, i) => ["\tld a, [wCurMap]", `\tcp ${drop.destination.map}`, `\tjp nz, .next${i}`, "\tld a, [wWarpedFromWhichMap]", `\tcp ${drop.source}`, `\tjp nz, .next${i}`, "\tld a, [wDestinationWarpID]", `\tcp ${drop.destination.warpId - 1}`, `\tjp nz, .next${i}`, "\tld a, 2", "\tld [wWalkBikeSurfState], a", "\tld [wWalkBikeSurfStateCopy], a", "\tcall ForceBikeOrSurf", "\tscf", "\tret", `.next${i}`]), ".ordinary", "\tand a", "\tret", "POPS", ""].join("\n");
}
const visibilityBegin = "; yellow-editor-strength-visibility-begin", visibilityEnd = "; yellow-editor-strength-visibility-end";
const visibilityHook = "\tpush bc\n\tpush hl\n\tfarcall EditorStrengthObjectVisibility\n\tpop hl\n\tpop bc\n\tret c\n";
export function reviewStrengthVisibility(text: string, files: Array<{ path: string; contents: string }>) {
  text = text.replace(/\r\n/g, "\n");
  if (!text.includes(visibilityBegin) && !text.includes("call EditorStrengthObjectVisibility")) return text;
  const all = files.filter(f => f.path.startsWith("scripts/")).flatMap(f => { const m = metadata(f.contents); return m ? [m] : []; });
  const block = `${visibilityBegin}\n${visibilityCode(all)}${visibilityEnd}\n`;
  if (!text.includes(block) || text.split(visibilityHook).length !== 2) throw new Error("The managed Strength visibility runtime was changed in source.");
  return text.replace(block, "").replace(visibilityHook, "");
}
export function strengthControlsVisibility(files: Array<{ path: string; contents: string }>, map: string, id: number) {
  return files.filter(f => f.path.startsWith("scripts/")).some(f => {
    const m = metadata(f.contents);
    return m?.goals.some(g => g.kind === "hole" && (m.map === map && g.boulderId === id || g.destination?.map === map && g.destination.objectId === id));
  });
}
async function state(source: ProjectSource, mapConstant: string) {
  const files = await readProjectRgbdsSources(source);
  if (files.some(f => f.readError)) throw new Error("Could not inspect the project's Strength puzzle sources.");
  const byPath = new Map(files.map(f => [f.path, f.contents])), index = await parseMapIndex(source);
  const map = index.find(m => m.constant === mapConstant);
  if (!map || !map.headerPath || map.isAlias || map.isUnused) throw new Error("Choose a map with its own header.");
  const name = byPath.get(map.headerPath)?.match(/map_header\s+(\w+),/)?.[1];
  if (!name) throw new Error("Could not resolve this map's scripts.");
  const scriptPath = `scripts/${name}.asm`, objectPath = `data/maps/objects/${name}.asm`;
  const script = byPath.get(scriptPath), object = byPath.get(objectPath);
  if (script === undefined || object === undefined) throw new Error("Map scripts or objects are missing.");
  const old = metadata(script), all = files.filter(f => f.path.startsWith("scripts/")).flatMap(f => { const m = metadata(f.contents); return m ? [m] : []; });
  if (old && (old.map !== mapConstant || old.name !== name || !script.includes(managedBlock(old, map.width).replace(/\n/g, script.includes("\r\n") ? "\r\n" : "\n")) || rows(script).filter(line => clean(line) === `call ${name}EditorStrength`).length !== 1)) throw new Error("The managed Strength hook or generated code was edited in source.");
  return { files, byPath, index, map, name, scriptPath, objectPath, script, object, old, all };
}
export async function loadMapStrengthDocument(source: ProjectSource, mapConstant: string): Promise<MapStrengthDocument> {
  const s = await state(source, mapConstant), visualization = await loadMapVisualization(source, mapConstant);
  // Managed tables are excluded by scanning only the original portion of a managed map script.
  const original = s.old ? s.script.slice(0, s.script.indexOf(marker)) : s.script;
  const native = /\b(?:CheckBoulderCoords|BIT_PUSHED_BOULDER)\b|RLEList_\w*Current/.test(original);
  const labels = new Set([...original.matchAll(/ld hl, ([.\w]+)\s*\r?\n\s*call CheckBoulderCoords/g)].map(m => m[1]));
  const targets: MapStrengthValues["targets"] = [];
  let active = false;
  rows(original).forEach((line, i) => {
    const code = clean(line), label = code.match(/^([.\w]+):?$/)?.[1];
    if (label && !/^\w+\s/.test(code)) active = labels.has(label);
    if (active) { const m = code.match(/^dbmapcoord\s+(\d+),\s*(\d+)$/); if (m) targets.push({ line: i, x: +m[1], y: +m[2] }); }
  });
  const gates: MapStrengthValues["gates"] = [];
  const scriptLines = rows(original);
  for (let i = 0; i < scriptLines.length; i++) {
    const c = clean(scriptLines[i]).match(/^lb bc,\s*(\d+),\s*(\d+)$/);
    if (!c) continue;
    const before = scriptLines.slice(Math.max(0, i - 4), i).map(clean).join("\n"), after = scriptLines.slice(i + 1, i + 5).map(clean).join("\n");
    const block = before.match(/ld a, (\$[\da-f]+|\d+)/i);
    if (block && /(?:ReplaceTileBlock|ReplaceTileBlockScript)/.test(after)) gates.push({ line: i, x: +c[2], y: +c[1], block: block[1].startsWith("$") ? parseInt(block[1].slice(1), 16) : +block[1] });
  }
  const destinations = s.index.filter(m => !m.isAlias && !m.isUnused && m.headerPath).flatMap(m => {
    const name = s.byPath.get(m.headerPath!)?.match(/map_header\s+(\w+),/)?.[1];
    const text = s.byPath.get(`data/maps/objects/${name}.asm`);
    if (!text) return [];
    return [{ map: m.constant, name: m.displayName, width: m.width * 2, height: m.height * 2, boulders: objects(text), warps: [...text.matchAll(/^\s*warp_event\b/gm)].map((_, i) => i + 1) }];
  });
  const landings: MapStrengthValues["landings"] = [];
  const destination = original.match(/ld a, (\w+)\s*\r?\n\s*ld \[wDungeonWarpDestinationMap\], a/)?.[1];
  if (destination) rows(s.byPath.get("data/maps/special_warps.asm") ?? "").forEach((line, i) => {
    const m = clean(line).match(/^fly_warp\s+(\w+),\s*(\d+),\s*(\d+)$/);
    if (m && m[1] === destination) landings.push({ line: i, map: m[1], x: +m[2], y: +m[3] });
  });
  const boulders = objects(s.object);
  const nativeMoves: MapStrengthValues["nativeMoves"] = []; let route = "";
  rows(original).forEach((line, i) => {
    const label = clean(line).match(/^([.\w]+):?$/)?.[1];
    if (label) route = /RLEList_\w*Current/.test(label) ? label : "";
    const move = clean(line).match(/^db PAD_(UP|DOWN|LEFT|RIGHT),\s*(\d+)$/);
    if (route && move) nativeMoves.push({ line: i, route, direction: move[1] as "UP" | "DOWN" | "LEFT" | "RIGHT", steps: +move[2] });
  });
  const flagLabels = new Map(s.all.flatMap(m => m.goals.map(g => [g.event, `${s.index.find(map => map.constant === m.map)?.displayName ?? m.map}: target ${g.id}`] as const)));
  const completionFlags = projectConstantCatalogFromSources(s.files.filter(f => f.path === "constants/event_constants.asm")).constants.filter(c => c.symbol.startsWith("EVENT_") && /BOULDER|STRENGTH|EDITOR_SHARED/.test(c.symbol)).map(c => ({ event: c.symbol, label: flagLabels.get(c.symbol) ?? c.symbol.replace(/^EVENT_/, "").replace(/_/g, " ") }));
  const binary = [visualization.mapBlockPath, visualization.blocksetPath];
  return { mapConstant, mapName: s.map.displayName, visualization, boulders, destinations, native,
    completionFlags,
    values: { boulders: boulders.map(({ id, x, y }) => ({ id, x, y })), targets, gates, landings, nativeMoves, goals: s.old?.goals ?? [], changes: s.old?.changes ?? [], currents: s.old?.currents ?? [] },
    notes: native ? ["Existing event flags, reset rules, cross-floor object links and Seafoam current scripts are preserved. Coordinates below edit the original puzzle.", "Switches and holes use the 16×16 movement grid. Terrain changes use the 32×32 block grid."] : ["Switch completion and boulder drops persist across map changes and saved games. Terrain changes can require several switches together.", "Use existing hole terrain for drops. The player follows an ordinary warp to the chosen destination entrance; the arriving boulder uses its own starting position."],
    sources: [...await Promise.all(s.files.map(async f => ({ path: f.path, hash: await hashText(f.contents) }))), ...await Promise.all(binary.map(async path => ({ path, hash: await hashText(bytesToHex(await source.readBytes(path))), encoding: "hex" as const })))],
  };
}
function overlay(source: ProjectSource, changes: Map<string, string>): ProjectSource {
  return { ...source, readBytes: source.readBytes.bind(source), listFiles: source.listFiles?.bind(source), readText: async p => changes.get(p) ?? source.readText(p), exists: async p => changes.has(p) || source.exists(p) };
}
export async function prepareAddBoulderWrites(source: ProjectSource, map: string, x: number, y: number) {
  const s = await loadMapNpcSourceState(source, map);
  await reviewEngine(new Map(s.files.map(f => [f.path, f.contents])));
  return prepareMapNpcWrites(source, s.document, { x, y, boulder: true, sprite: "SPRITE_BOULDER", movement: "STAY", direction: "BOULDER_MOVEMENT_BYTE_2", dialogue: { kind: "new", lines: [] } });
}
export async function prepareMapStrengthWrites(source: ProjectSource, document: MapStrengthDocument, values: MapStrengthValues): Promise<TextWriteRequest[]> {
  for (const f of document.sources) {
    const contents = f.encoding ? bytesToHex(await source.readBytes(f.path)) : await source.readText(f.path);
    if (await hashText(contents) !== f.hash) throw new Error(`${f.path}: puzzle sources changed. Reopen Strength puzzles before saving.`);
  }
  const fresh = await loadMapStrengthDocument(source, document.mapConstant), s = await state(source, document.mapConstant);
  if (JSON.stringify(values) === JSON.stringify(fresh.values)) return [];
  const changes = new Map<string, string>(), scriptLines = rows(s.script), objectLines = rows(s.object);
  if (values.boulders.length !== fresh.values.boulders.length || values.targets.length !== fresh.values.targets.length || values.gates.length !== fresh.values.gates.length || values.landings.length !== fresh.values.landings.length || values.nativeMoves.length !== fresh.values.nativeMoves.length) throw new Error("Existing puzzle rows cannot be removed or reordered.");
  for (const [i, b] of values.boulders.entries()) {
    const old = fresh.boulders[i]; if (b.id !== old.id) throw new Error("Boulder IDs must stay in place.");
    if (b.x === old.x && b.y === old.y) continue;
    integer(b.x, 0, fresh.visualization.map.width * 2 - 1, "Boulder X"); integer(b.y, 0, fresh.visualization.map.height * 2 - 1, "Boulder Y");
    if (fresh.visualization.warps.some(w => w.x === b.x && w.y === b.y) || fresh.visualization.signs.some(w => w.x === b.x && w.y === b.y) || fresh.visualization.npcs.some(n => n.id !== b.id && !fresh.boulders.some(b => b.id === n.id) && n.x === b.x && n.y === b.y) || values.boulders.some(other => other.id !== b.id && other.x === b.x && other.y === b.y)) throw new Error("A boulder's starting position overlaps another object, sign or warp.");
    const at = objects(s.object)[i].line;
    objectLines[at] = objectLines[at].replace(/(object_event\s+)\d+,\s*\d+/, `$1${b.x}, ${b.y}`);
  }
  for (const [i, target] of values.targets.entries()) {
    if (target.line !== fresh.values.targets[i].line) throw new Error("Target IDs must stay in place.");
    if (target.x === fresh.values.targets[i].x && target.y === fresh.values.targets[i].y) continue;
    integer(target.x, 0, fresh.visualization.map.width * 2 - 1, "Target X"); integer(target.y, 0, fresh.visualization.map.height * 2 - 1, "Target Y");
    scriptLines[target.line] = scriptLines[target.line].replace(/(dbmapcoord\s+)\d+,\s*\d+/, `$1${target.x}, ${target.y}`);
  }
  for (const [i, gate] of values.gates.entries()) {
    if (gate.line !== fresh.values.gates[i].line) throw new Error("Terrain effect IDs must stay in place.");
    if (JSON.stringify(gate) === JSON.stringify(fresh.values.gates[i])) continue;
    integer(gate.x, 0, fresh.visualization.map.width - 1, "Terrain X"); integer(gate.y, 0, fresh.visualization.map.height - 1, "Terrain Y"); integer(gate.block, 0, fresh.visualization.blockCount - 1, "Open block");
    scriptLines[gate.line] = scriptLines[gate.line].replace(/(lb bc,\s*)\d+,\s*\d+/, `$1${gate.y}, ${gate.x}`);
    let at = gate.line - 1;
    while (at >= 0 && !/^ld a, (\$[\da-f]+|\d+)$/i.test(clean(scriptLines[at]))) at--;
    if (at < 0) throw new Error("Could not locate the terrain block operand.");
    scriptLines[at] = scriptLines[at].replace(/(ld a, )(\$[\da-f]+|\d+)/i, `$1${gate.block}`);
  }
  for (const [i, move] of values.nativeMoves.entries()) {
    const old = fresh.values.nativeMoves[i];
    if (move.line !== old.line || move.route !== old.route || !["UP", "DOWN", "LEFT", "RIGHT"].includes(move.direction)) throw new Error("Native current route identities must stay in place.");
    integer(move.steps, 1, 64, "Current movement steps");
    if (values.nativeMoves.filter(m => m.route === move.route).reduce((sum, m) => sum + m.steps, 0) > 64) throw new Error("A current route can queue at most 64 movement steps.");
    if (move.steps !== old.steps || move.direction !== old.direction) scriptLines[move.line] = scriptLines[move.line].replace(/(db PAD_)(UP|DOWN|LEFT|RIGHT),\s*\d+/, `$1${move.direction}, ${move.steps}`);
  }
  const special = rows(s.byPath.get("data/maps/special_warps.asm") ?? "");
  for (const [i, landing] of values.landings.entries()) {
    const old = fresh.values.landings[i], dest = fresh.destinations.find(d => d.map === old.map)!;
    if (landing.line !== old.line || landing.map !== old.map) throw new Error("Native landing maps and IDs must stay in place.");
    if (landing.x === old.x && landing.y === old.y) continue;
    integer(landing.x, 0, dest.width - 1, "Landing X"); integer(landing.y, 0, dest.height - 1, "Landing Y");
    special[landing.line] = special[landing.line].replace(/(fly_warp\s+\w+,\s*)\d+,\s*\d+/, `$1${landing.x}, ${landing.y}`);
  }
  const nl = s.script.includes("\r\n") ? "\r\n" : "\n";
  changes.set(s.objectPath, objectLines.join(s.object.includes("\r\n") ? "\r\n" : "\n"));
  changes.set(s.scriptPath, scriptLines.join(nl));
  if (values.landings.length) changes.set("data/maps/special_warps.asm", special.join((s.byPath.get("data/maps/special_warps.asm") ?? "").includes("\r\n") ? "\r\n" : "\n"));
  if (fresh.native && (values.goals.length || values.changes.length || values.currents.length)) throw new Error("Edit this native puzzle's existing targets and current routes. New managed puzzles require a map without native boulder or current scripts.");
  if (!fresh.native && (values.goals.length || values.currents.length || s.old)) {
    await reviewEngine(s.byPath);
    if (values.goals.length > 8 || values.changes.length > 8 || values.goals.length < (s.old?.goals.length ?? 0)) throw new Error("Keep existing targets; up to eight targets and eight terrain changes are supported per map.");
    const symbols = new Map(projectConstantCatalogFromSources(s.files.filter(f => f.path.startsWith("constants/"))).constants.map(c => [c.symbol, c.value]));
    let constants = s.byPath.get("constants/event_constants.asm")!;
    let eventValue = 0;
    for (const row of rows(constants)) {
      const line = clean(row), directive = line.match(/^(const_def|const_next|const_skip)(?:\s+(.+))?$/);
      if (directive) {
        const value = evaluateRgbdsExpression(directive[2] ?? (directive[1] === "const_def" ? "0" : "1"), symbols);
        if (value === null) throw new Error("Cannot derive the existing event flag layout.");
        eventValue = directive[1] === "const_skip" ? eventValue + value : value;
      }
      if (/^const EVENT_\w+$/.test(line)) eventValue++;
      const snapshot = line.match(/^DEF (\w+) EQU (.*\bconst_value\b.*)$/);
      if (snapshot) {
        const value = evaluateRgbdsExpression(snapshot[2].replace(/\bconst_value\b/g, String(eventValue)), symbols);
        if (value !== null) symbols.set(snapshot[1], value);
      }
    }
    const reserved = new Set<number>();
    function allocate(event: string) {
      const capacity = symbols.get("NUM_EVENTS");
      if (!capacity || !/wEventFlags:: flag_array NUM_EVENTS/.test(s.byPath.get("ram/wram.asm") ?? "")) throw new Error("The existing save layout cannot supply puzzle flags.");
      const high = Math.max(...projectConstantCatalogFromSources(s.files.filter(f => f.path === "constants/event_constants.asm")).constants.filter(c => c.symbol.startsWith("EVENT_") && c.groupId !== null).map(c => c.value));
      for (let n = capacity - 1; n > high; n--) {
        if (reserved.has(n) || [...symbols.values()].includes(n) && [...symbols].some(([key, v]) => key.startsWith("EVENT_") && v === n)) continue;
        const byte = Math.floor(n / 8), numeric = `(?:\\$${byte.toString(16)}|${byte})`;
        if (s.files.some(f => new RegExp(`wEventFlags\\s*\\+\\s*${numeric}\\b`, "i").test(f.contents))) continue;
        // Range writes can affect unnamed bits; fail closed for uncertain endpoints.
        if (s.files.some(f => !f.path.startsWith("macros/") && rows(f.contents).some(line => {
          const m = clean(line).match(/^(?:Set|Reset)EventRange\s+([^,]+),\s*([^,]+)(?:,.*)?$/); if (!m) return false;
          const a = symbols.get(m[1]), b = symbols.get(m[2]); return a === undefined || b === undefined || n >= a && n <= b;
        }))) continue;
        reserved.add(n); constants += `\nDEF ${event} EQU $${n.toString(16)}\n`; return;
      }
      throw new Error("No verified unused puzzle flag remains in the existing save layout.");
    }
    const goals = structuredClone(values.goals);
    for (const [i, g] of goals.entries()) {
      const old = s.old?.goals[i];
      if (old && (g.id !== old.id || g.event !== old.event || g.kind !== old.kind)) throw new Error("Keep each target's identity and type. Its position, boulder and destination can be edited.");
      g.id = i + 1;
      if (!old) { g.event = `EVENT_${s.map.constant}_EDITOR_STRENGTH_${g.id}`; if (symbols.has(g.event)) throw new Error("A puzzle event name already exists."); allocate(g.event); }
      integer(g.x, 0, s.map.width * 2 - 1, "Target X"); integer(g.y, 0, s.map.height * 2 - 1, "Target Y");
      if (!fresh.boulders.some(b => b.id === g.boulderId)) throw new Error("Choose a native Strength boulder on this map.");
      if (goals.some(other => other !== g && other.x === g.x && other.y === g.y)) throw new Error("Two puzzle targets cannot share the same position.");
      if (g.kind !== "switch" && g.kind !== "hole") throw new Error("Choose a switch or hole target.");
      if (g.kind === "hole") {
        const v = fresh.visualization, block = v.mapBlocks[Math.floor(g.y / 2) * v.map.width + Math.floor(g.x / 2)];
        const tile = v.blockset[block * 16 + (g.y % 2 * 2 + 1) * 4 + g.x % 2 * 2];
        if (v.tilesetConstant !== "CAVERN" || tile !== 0x22) throw new Error("A new drop needs an existing CAVERN hole tile at the target. Paint the hole terrain before creating its puzzle.");
        const dest = fresh.destinations.find(d => d.map === g.destination?.map);
        if (!dest || dest.map === s.map.constant || !dest.boulders.some(b => b.id === g.destination?.objectId) || !dest.warps.includes(g.destination?.warpId ?? -1)) throw new Error("A hole needs a different destination map, a receiving boulder, and an existing landing warp.");
        const receiving = dest.boulders.find(b => b.id === g.destination!.objectId)!, sourceBoulder = fresh.boulders.find(b => b.id === g.boulderId)!;
        const toggles = s.byPath.get("data/maps/toggleable_objects.asm") ?? "";
        if ([receiving.constant, sourceBoulder.constant].some(name => new RegExp(`\\btoggle_object_state\\s+${name}\\s*,`).test(toggles))) throw new Error("This boulder is already controlled by a native puzzle. Add an independent boulder for a new hole link.");
        for (const file of s.files.filter(f => f.path.startsWith("scripts/"))) for (const record of file.contents.matchAll(/^\s*; yellow-editor-interaction: (.+)$/gm)) {
          const model = JSON.parse(record[1]) as { scene?: { mapConstant: string; visibility: Array<{ id: number }> }; visibilityRule?: { map: string; object: number } }, scene = model.scene;
          if (model.visibilityRule && (model.visibilityRule.map === s.map.constant && model.visibilityRule.object === g.boulderId || model.visibilityRule.map === dest.map && model.visibilityRule.object === receiving.id)) throw new Error("An NPC condition already controls this boulder's visibility. Choose an independent boulder for the hole link.");
          if (scene && (scene.mapConstant === s.map.constant && scene.visibility.some(v => v.id === g.boulderId) || scene.mapConstant === dest.map && scene.visibility.some(v => v.id === receiving.id))) throw new Error("This boulder's visibility is already controlled by a scene. Choose an independent boulder for the hole link.");
        }
        const staged = overlay(source, changes), sourceDoc = await loadMapWarpDocument(staged, s.map.constant), destDoc = await loadMapWarpDocument(staged, dest.map);
        const writes = await prepareMapWarpWrites(staged, sourceDoc, { id: old?.warpId ?? null, x: g.x, y: g.y, destinationMap: dest.map, destinationWarpId: g.destination!.warpId, destinationDocument: destDoc, pair: null }, { strengthOwner: true });
        for (const w of writes) changes.set(w.path, w.contents);
        g.warpId = old?.warpId ?? sourceDoc.warps.length + 1;
      } else { if (g.destination !== null) throw new Error("Switches do not have a receiving boulder."); delete g.warpId; }
    }
    for (const gate of values.changes) {
      integer(gate.x, 0, s.map.width - 1, "Terrain X"); integer(gate.y, 0, s.map.height - 1, "Terrain Y"); integer(gate.block, 0, fresh.visualization.blockCount - 1, "Open block");
      if (!gate.goals.length || new Set(gate.goals).size !== gate.goals.length || gate.goals.some(id => !goals.some(g => g.id === id))) throw new Error("Choose the switches or holes required for this terrain change.");
    }
    if (values.currents.length > 8) throw new Error("Use at most eight current triggers per map.");
    for (const current of values.currents) {
      integer(current.x, 0, s.map.width * 2 - 1, "Current X"); integer(current.y, 0, s.map.height * 2 - 1, "Current Y");
      if (!current.events.length || current.events.some(e => !fresh.completionFlags.some(f => f.event === e))) throw new Error("Choose saved puzzle completion flags to stop this current.");
      if (!current.path.length || current.path.length > 16 || current.path.reduce((n, step) => n + step.steps, 0) > 64) throw new Error("Use 1–16 current movement runs totaling at most 64 steps.");
      let x = current.x, y = current.y;
      function water() {
        const v = fresh.visualization, block = v.mapBlocks[Math.floor(y / 2) * v.map.width + Math.floor(x / 2)], tile = v.blockset[block * 16 + (y % 2 * 2 + 1) * 4 + x % 2 * 2];
        if (v.tilesetConstant !== "CAVERN" || tile !== 0x14) throw new Error("Current triggers and routes must stay on CAVERN water tiles. Paint the water route first.");
      }
      water();
      for (const step of current.path) {
        if (!["UP", "DOWN", "LEFT", "RIGHT"].includes(step.direction)) throw new Error("Choose a cardinal current direction."); integer(step.steps, 1, 64, "Current steps");
        for (let n = 0; n < step.steps; n++) {
          x += step.direction === "RIGHT" ? 1 : step.direction === "LEFT" ? -1 : 0; y += step.direction === "DOWN" ? 1 : step.direction === "UP" ? -1 : 0;
          integer(x, 0, s.map.width * 2 - 1, "Current route X"); integer(y, 0, s.map.height * 2 - 1, "Current route Y"); water();
        }
      }
      if (x === current.x && y === current.y) throw new Error("A current route must finish away from its trigger.");
    }
    if (values.currents.length) for (const [label, expected] of [["StartSimulatingJoypadStates", "a216f85375fd9e619af43b317e745b3f12e8bc4fa6317f7fbf9d52a99c1bbcf9"], ["DecodeRLEList", "6e1739d78cc15acfc6b2b8bdd6056631904cfd7ecbecd95148387cead9084943"]]) {
      const text = s.byPath.get("home/map_objects.asm") ?? "", body = text.match(new RegExp(`^${label}::{0,1}\\r?\\n([\\s\\S]*?)(?=^[A-Za-z_]\\w*:{1,2}|$(?![\\s\\S]))`, "m"))?.[1];
      if (!body || await hashText(rows(body).map(clean).filter(Boolean).join("\n")) !== expected) throw new Error("Currents need the reviewed native movement queue and decoder.");
    }
    const m: Managed = { version: 1, map: s.map.constant, name: s.name, goals, changes: values.changes, currents: values.currents };
    let script = changes.get(s.scriptPath)!;
    if (s.old) { const at = script.indexOf(marker); script = script.slice(0, at) + script.slice(script.indexOf(end, at) + end.length).replace(/^\r?\n/, ""); }
    else {
      const root = new RegExp(`^${s.name}_Script:{1,2}\\r?\\n`, "m");
      if (!root.test(script)) throw new Error("This map needs a unique script entry point.");
      script = insertAfterTrainerResume(script, s.name, `\tcall ${s.name}EditorStrength\n`);
    }
    changes.set(s.scriptPath, script + (script.endsWith("\n") ? nl : nl + nl) + managedBlock(m, s.map.width).replace(/\n/g, nl));
    changes.set("constants/event_constants.asm", constants);
    const enginePath = "engine/overworld/toggleable_objects.asm", engine = s.byPath.get(enginePath)!;
    const all = [...s.all.filter(old => old.map !== m.map), m];
    if (all.some(map => map.goals.some(g => g.kind === "hole")) || engine.includes(visibilityBegin)) {
      let engineText = engine;
      const oldCode = visibilityCode(s.all), engineNl = engine.includes("\r\n") ? "\r\n" : "\n";
      const generated = `${visibilityBegin}\n${visibilityCode(all)}${visibilityEnd}\n`.replace(/\n/g, engineNl);
      if (engine.includes(visibilityBegin)) {
        const block = `${visibilityBegin}\n${oldCode}${visibilityEnd}\n`.replace(/\n/g, engineNl);
        if (!engine.includes(block)) throw new Error("The Strength object-visibility engine was edited in source.");
        engineText = engine.replace(block, generated);
      } else {
        const native = engineText.replace(/\r\n/g, "\n").replace(sceneVisibilityHook, "").replace(conditionVisibilityHook, "");
        const body = native.match(/^IsObjectHidden:\n([\s\S]*?)(?=^[A-Za-z_]\w*:{1,2})/m)?.[1];
        if (!body || await hashText(rows(body).map(clean).filter(Boolean).join("\n")) !== "f78a101337f2f157e91014ea8ad83876e16bc65120172c6cf098c16215ac7008") throw new Error("Strength drops need the reviewed native object-visibility routine.");
        engineText = engineText.replace(/IsObjectHidden:\r?\n/, match => match + visibilityHook.replace(/\n/g, engineNl));
        const sceneAt = engineText.indexOf("; yellow-editor-scene-runtime:");
        engineText = sceneAt < 0 ? engineText + engineNl + generated : engineText.slice(0, sceneAt) + generated + engineNl + engineText.slice(sceneAt);
      }
      changes.set(enginePath, engineText);
    }
    const playerPath = "engine/overworld/player_state.asm", player = s.byPath.get(playerPath)!;
    const playerNl = player.includes("\r\n") ? "\r\n" : "\n", playerBegin = "; yellow-editor-strength-water-begin", playerEnd = "; yellow-editor-strength-water-end";
    const oldPlayer = `${playerBegin}\n${waterLandingCode(s.all)}${playerEnd}\n`.replace(/\n/g, playerNl);
    let playerText = player;
    const playerHook = "\tpush bc\n\tpush hl\n\tfarcall EditorStrengthWaterLanding\n\tpop hl\n\tpop bc\n\tret c\n".replace(/\n/g, playerNl);
    if (player.includes(playerBegin)) {
      if (!player.includes(oldPlayer)) throw new Error("The Strength water-landing runtime was edited in source.");
      playerText = player.replace(oldPlayer, `${playerBegin}\n${waterLandingCode(all)}${playerEnd}\n`.replace(/\n/g, playerNl));
    } else if (all.some(map => map.goals.some(g => g.kind === "hole"))) {
      const body = player.replace(/\r\n/g, "\n").match(/^CheckForceBikeOrSurf::\n([\s\S]*?)(?=^[A-Za-z_]\w*:{1,2})/m)?.[1];
      if (!body || !["c0bb4fd7a3232be5a6e81262315de4ba399bc11a2261a01cbb5429051520d88e", "567166a53e73cb8c9d355e013e3bb1a932996a28b7160d4857e4ff616c71981a"].includes(await hashText(rows(body).map(clean).filter(Boolean).join("\n")))) throw new Error("Water landings need the reviewed forced-movement routine.");
      playerText = player.replace(/CheckForceBikeOrSurf::\r?\n/, match => match + playerHook);
      if (playerText === player) throw new Error("Could not find the native forced-movement entry for water landings.");
    }
    if (playerText !== player || player.includes(playerBegin)) {
      if (playerText.split(playerHook).length !== 2) throw new Error("The Strength water-landing hook was edited in source.");
      if (!player.includes(playerBegin)) playerText += playerNl + `${playerBegin}\n${waterLandingCode(all)}${playerEnd}\n`.replace(/\n/g, playerNl);
      changes.set(playerPath, playerText);
    }
  }
  return (await Promise.all([...changes].map(async ([path, contents]) => ({ path, contents, expectedHash: await hashText(s.byPath.get(path)!) })))).filter(w => w.contents !== s.byPath.get(w.path));
}
