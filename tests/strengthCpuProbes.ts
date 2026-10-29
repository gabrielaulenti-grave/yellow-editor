import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { projectConstantCatalogFromSources } from "../src/core/projectConstants";
import { parseMapIndex } from "../src/core/mapVisualization";
import type { ProjectSource } from "../src/core/types";
import type { MapStrengthDocument } from "../src/core/mapStrength";

export async function strengthCpuProbes(root: string, directory: string, rgbds: string, cpu: string, run: (cmd: string, args: string[], cwd?: string) => string, document: MapStrengthDocument, scripts: Map<string, string>) {
  const constants = await Promise.all((await readdir(join(root, "constants"))).filter(p => /\.(asm|inc)$/.test(p)).map(async p => ({ path: `constants/${p}`, contents: await readFile(join(root, "constants", p), "utf8") })));
  const symbols = new Map(projectConstantCatalogFromSources(constants).constants.map(c => [c.symbol, c.value]));
  const maps = await parseMapIndex({ readText: async p => scripts.get(p) ?? readFile(join(root, p), "utf8") } as ProjectSource);
  symbols.set("NUM_MAPS", maps.length);
  for (const map of maps) symbols.set(map.constant, map.id);
  assert.ok(Number.isInteger(symbols.get("BIT_PUSHED_BOULDER")));
  const source = scripts.get("scripts/EditorStrengthCave.asm")!, engine = scripts.get("engine/overworld/toggleable_objects.asm")!;
  const generated = source.split("; yellow-editor-strength-code-begin\n")[1].split("; yellow-editor-strength-code-end")[0].replace(/\tpredef ReplaceTileBlock/g, "\tcall ReplaceTileBlock");
  const visibility = engine.split("; yellow-editor-strength-visibility-begin\n")[1].split("; yellow-editor-strength-visibility-end")[0];
  const waterLanding = scripts.get("engine/overworld/player_state.asm")!.split("; yellow-editor-strength-water-begin\n")[1].split("; yellow-editor-strength-water-end")[0];
  const native = await readFile(join(root, "home/map_objects.asm"), "utf8");
  const coordinates = native.slice(native.indexOf("CheckCoords::"), native.indexOf("GetPointerWithinSpriteStateData1::"));
  const update = await readFile(join(root, "engine/overworld/update_map.asm"), "utf8");
  const replace = update.slice(update.indexOf("ReplaceTileBlock:"), update.indexOf("\tld a, [wCurrentTileBlockMapViewPointer]")) + "\tret\n";
  const extract = (label: string) => native.match(new RegExp(`^${label}::{0,1}\\n[\\s\\S]*?(?=^[A-Za-z_]\\w*:{1,2}|$(?![\\s\\S]))`, "m"))![0];
  const movement = extract("DecodeRLEList") + extract("StartSimulatingJoypadStates");
  const extra = [`DEF NUM_MAPS EQU ${symbols.get("NUM_MAPS")}`,"DEF wStatusFlags5 EQU $c02a", "DEF wSimulatedJoypadStatesIndex EQU $c02b", "DEF wWalkBikeSurfState EQU $c028", "DEF wWalkBikeSurfStateCopy EQU $c029", "DEF wXCoord EQU $c02c", "DEF wYCoord EQU $c02d", "DEF wOverrideSimulatedJoypadStatesMask EQU $c02e", "DEF wSpritePlayerStateData2MovementByte1 EQU $c02f", "DEF wRLEByteCount EQU $c030", "DEF hRLEByteValue EQU $ff93", "DEF wSimulatedJoypadStatesEnd EQU $ca00", "DEF wTileMap EQU $cc00", "DEF SCREEN_WIDTH EQU 20", "DEF SCREEN_HEIGHT EQU 18", "DEF wCurMapTileset EQU $c025", "DEF wWarpedFromWhichMap EQU $c026", "DEF wDestinationWarpID EQU $c027", ...["PAD_UP", "PAD_DOWN", "PAD_LEFT", "PAD_RIGHT", "CAVERN", "BIT_SCRIPTED_MOVEMENT_STATE"].map(name => `DEF ${name} EQU ${symbols.get(name)}`)];
  const defs = ["DEF wOverworldMap EQU $c200", "DEF wEventFlags EQU $c800", "DEF wSpritePlayerStateData2MapY EQU $c100", "DEF wMiscFlags EQU $c020", "DEF wNewTileBlockID EQU $c021", "DEF wCurMapWidth EQU $c022", "DEF wCurMap EQU $c023", "DEF wCoordIndex EQU $c024", "DEF hSpriteIndex EQU $ff90", "DEF hCurrentSpriteOffset EQU $ff91", "DEF hIsToggleableObjectOff EQU $ff92", `DEF BIT_PUSHED_BOULDER EQU ${symbols.get("BIT_PUSHED_BOULDER")}`, `DEF EDITOR_STRENGTH_CAVE EQU ${document.visualization.map.id}`, `DEF REDS_HOUSE_1F EQU ${symbols.get("REDS_HOUSE_1F")}`];
  const set = (name: string, value: number) => [`ld a, ${value}`, `ld [${name}], a`];
  const observe = (name: string, address: number) => [`ld a, [${name}]`, `ld [$${address.toString(16)}], a`];
  const call = "call EditorStrengthCaveEditorStrength", [a, b] = document.values.goals;
  assert.equal(a.kind, "switch"); assert.equal(b.kind, "hole");
  const pushed = 1 << symbols.get("BIT_PUSHED_BOULDER")!;
  const place = (id: number, x: number, y: number) => [...set("hSpriteIndex", id), ...set(`$${(0xc100 + id * 16).toString(16)}`, y + 4), ...set(`$${(0xc101 + id * 16).toString(16)}`, x + 4)];
  const inspect = (map: string, id: number, out: number) => [...set("wCurMap", symbols.get(map) ?? document.visualization.map.id), ...set("hCurrentSpriteOffset", id * 16), "call EditorStrengthObjectVisibility", ...observe("hIsToggleableObjectOff", out)];
  const flagTest = [`CheckEvent ${a.event}`, "ld a, 0", "jr z, .flagClear", "inc a", ".flagClear", "ld [$c000], a"];
  const destination = b.destination!;
  const gate = document.values.changes[0], gateAddress = 0xc200 + (gate.y + 3) * (document.visualization.map.width + 6) + gate.x + 3;
  const current = document.values.currents[0];
  const currentFlow = [...set("wXCoord", current.x), ...set("wYCoord", current.y), ...set("wWalkBikeSurfState", 0), call, ...observe("wSimulatedJoypadStatesIndex", 0xc010), ...set("wWalkBikeSurfState", 2), call, ...observe("wSimulatedJoypadStatesIndex", 0xc00a), ...observe("$ca00", 0xc00b), ...observe("$ca01", 0xc00c), ...observe("$ca02", 0xc00d), ...set("wSimulatedJoypadStatesIndex", 1), call, ...observe("wSimulatedJoypadStatesIndex", 0xc00e), ...set("wStatusFlags5", 0), ...set("wSimulatedJoypadStatesIndex", 0), ...set("wXCoord", current.x + 1)];
  const waterFlow = [...set("wCurMap", symbols.get(destination.map)!), ...set("wCurMapTileset", symbols.get("CAVERN")!), ...set("wWarpedFromWhichMap", 0), ...set("wDestinationWarpID", destination.warpId - 1), ...set("$ccbc", 0x14), ...set("wWalkBikeSurfState", 0), "call EditorStrengthWaterLanding", ...observe("wWalkBikeSurfState", 0xc012), ...set("wWarpedFromWhichMap", document.visualization.map.id), "call EditorStrengthWaterLanding", ...observe("wWalkBikeSurfState", 0xc013), ...observe("wWalkBikeSurfStateCopy", 0xc014)];
  const flow = [
    ...set("wCurMap", document.visualization.map.id), ...set("wCurMapWidth", document.visualization.map.width), ...currentFlow,
    ...place(a.boulderId, a.x, a.y), call, ...flagTest,
    ...set("wMiscFlags", pushed), ...place(15, a.x, a.y), call, `CheckEvent ${a.event}`, "ld a, 0", "jr z, .followerClear", "inc a", ".followerClear", "ld [$c015], a",
    ...set("wMiscFlags", pushed), ...place(a.boulderId, a.x, a.y), call, ...observe(`$${gateAddress.toString(16)}`, 0xc001),
    ...inspect("EDITOR_STRENGTH_CAVE", b.boulderId, 0xc002), ...inspect(destination.map, destination.objectId, 0xc003),
    ...set("wCurMap", document.visualization.map.id), ...set("wMiscFlags", pushed), ...place(b.boulderId, b.x, b.y), call,
    ...inspect("EDITOR_STRENGTH_CAVE", b.boulderId, 0xc004), ...inspect(destination.map, destination.objectId, 0xc005), ...observe("wMiscFlags", 0xc006), ...observe(`$${gateAddress.toString(16)}`, 0xc007),
    ...set(`$${gateAddress.toString(16)}`, 0), ...set("wCurMap", document.visualization.map.id), call, ...observe(`$${gateAddress.toString(16)}`, 0xc008), ...set("wXCoord", current.x), ...set("wYCoord", current.y), call, ...observe("wSimulatedJoypadStatesIndex", 0xc00f), ...waterFlow,
  ];
  const asm = ['INCLUDE "macros/const.asm"', 'INCLUDE "macros/code.asm"', 'INCLUDE "macros/coords.asm"', ...defs, ...extra, scripts.get("constants/event_constants.asm")!, await readFile(join(root, "macros/scripts/events.asm"), "utf8"), 'SECTION "Header", ROM0[$100]', 'jp Entry', 'ds $150 - @, 0', 'SECTION "Code", ROM0[$150]', 'Entry:', 'di', 'ld sp, $dfff', 'ld hl, $c000', 'ld bc, $1000', '.clear', 'xor a', 'ld [hli], a', 'dec bc', 'ld a, b', 'or c', 'jr nz, .clear', ...flow, 'ProbeDone:', 'halt', 'jr ProbeDone', generated, visibility, waterLanding, coordinates, movement, replace, "FillMemory:", "ld [hli], a", "dec bc", "push af", "ld a, b", "or c", "jr z, .done", "pop af", "jr FillMemory", ".done", "pop af", "ret", "ForceBikeOrSurf:", "ld a, 1", "ld [$c011], a", "ret", 'GetPredefRegisters:', 'UpdateSprites:', 'ret'].join("\n");
  const file = join(directory, "strength-probe.asm"), object = join(directory, "strength-probe.o"), rom = join(directory, "strength-probe.gb"), sym = join(directory, "strength-probe.sym");
  await writeFile(file, asm); run(join(rgbds, "rgbasm"), ["-I", `${root}/`, "-o", object, file]); run(join(rgbds, "rgblink"), ["-n", sym, "-o", rom, object]); run(join(rgbds, "rgbfix"), ["-v", "-p", "0", rom]);
  const stop = (await readFile(sym, "utf8")).match(/^00:([0-9a-f]+) ProbeDone$/mi)![1];
  run(cpu, [rom, stop, "c000=0", "c001=0", "c002=0", "c003=1", "c004=1", "c005=0", "c006=0", `c007=${gate.block.toString(16)}`, `c008=${gate.block.toString(16)}`, "c00a=3", `c00b=${symbols.get("PAD_DOWN")!.toString(16)}`, `c00c=${symbols.get("PAD_RIGHT")!.toString(16)}`, `c00d=${symbols.get("PAD_RIGHT")!.toString(16)}`, "c00e=1", "c00f=0", "c010=0", "c011=1", "c012=0", "c013=2", "c014=2", "c015=0"]);
  console.log(`${root}: Strength CPU probes passed: real coordinate checks, push requirement, follower exclusion, joint switches, floor transfer, visibility and gate restoration`);
}
