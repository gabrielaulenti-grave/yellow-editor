import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TextWriteRequest } from "../src/core/types";
import assert from "node:assert/strict";
export async function mapPropertyCpuProbes(directory: string, rgbds: string, cpu: string, run: (cmd: string, args: string[], cwd?: string) => string, writes: TextWriteRequest[], map: string, id: number) {
  const assembled = writes.flatMap(w => [...w.contents.matchAll(/; yellow-editor-map-rule (?:bike-code|escape-code|field-code|light-code) begin\n([\s\S]*?); yellow-editor-map-rule [a-z-]+ end/g)].map(m => m[1])).join("\n");
  const code = ["EditorMapBicyclePermission", "EditorMapEscapePermission", "EditorMapTeleportPermission", "EditorMapFlyPermission", "EditorMapFlashPermission", "EditorMapLightingBefore", "EditorMapLightingAfter"].map(name => assembled.match(new RegExp(`^${name}::{0,1}\\n[\\s\\S]*?(?=^[A-Za-z_]\\w*:{1,2}|^POPS|$(?![\\s\\S]))`, "m"))![0]).join("\n");
  const call = (name: string, at: number) => [`call ${name}`, `ld [$${at.toString(16)}], a`, "push af", "pop bc", "ld a, c", `ld [$${(at + 1).toString(16)}], a`];
  const set = (name: string, n: number) => [`ld a, ${n}`, `ld [${name}], a`];
  const asm = [`DEF ${map} EQU ${id}`, "DEF wCurMap EQU $c020", "DEF wMapPalOffset EQU $c021", 'SECTION "Header", ROM0[$100]', "jp Entry", "ds $150 - @, 0", 'SECTION "Code", ROM0[$150]', "Entry:", "di", "ld sp, $dfff", ...set("wCurMap", id), ...call("EditorMapBicyclePermission", 0xc000), ...call("EditorMapEscapePermission", 0xc002), ...call("EditorMapTeleportPermission", 0xc004), ...call("EditorMapFlyPermission", 0xc006), ...call("EditorMapFlashPermission", 0xc008), "call EditorMapLightingAfter", "ld a, [wMapPalOffset]", "ld [$c00a], a", "call EditorMapLightingBefore", "ld a, [wMapPalOffset]", "ld [$c00b], a", ...set("wCurMap", 0), ...call("EditorMapBicyclePermission", 0xc00c), "ProbeDone:", "halt", "jr ProbeDone", code].join("\n");
  const file = join(directory, "properties-probe.asm"), object = join(directory, "properties-probe.o"), rom = join(directory, "properties-probe.gb"), sym = join(directory, "properties-probe.sym");
  await writeFile(file, asm); run(join(rgbds, "rgbasm"), ["-o", object, file]); run(join(rgbds, "rgblink"), ["-n", sym, "-o", rom, object]); run(join(rgbds, "rgbfix"), ["-v", "-p", "0", rom]);
  const stop = (await readFile(sym, "utf8")).match(/^00:([0-9a-f]+) ProbeDone$/mi)![1];
  assert.ok(code.includes("EditorMapLightingAfter"));
  run(cpu, [rom, stop, "c000=0", "c001=80", "c002=0", "c003=80", "c004=1", "c005=10", "c006=1", "c007=10", "c008=0", "c009=80", "c00a=6", "c00b=0", "c00c=2", "c00d=20"]);
  console.log("Map permission CPU probes passed: allow/block/default flags, isolated map matching, dark entry and lighting cleanup");
}
