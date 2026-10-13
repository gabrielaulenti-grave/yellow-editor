import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { projectConstantCatalogFromSources } from "../src/core/projectConstants";
import type { ManagedInteraction } from "../src/core/scriptInteractions";

export async function sceneCpuProbes(root: string, temporary: string, rgbds: string, cpu: string,
  run: (cmd: string, args: string[], cwd?: string) => string, model: ManagedInteraction, script: string, events: string, engine: string) {
  const plan = model.scene!, p = model.prefix, actor = plan.actors.find(actor => plan.nodes.some(node => node.npc === actor.constant))!;
  const code = script.slice(script.indexOf(`${model.label}:`), script.indexOf(`; yellow-editor-interaction-code-end ${model.label}`))
    .replaceAll("\ttext_asm", "\tdb 8").replaceAll("\ttext_promptbutton", "\tdb 0").replaceAll("\ttext_end", "\tdb 0").replaceAll("\tpredef ", "\tcall ");
  const runtime = engine.slice(engine.indexOf("; yellow-editor-scene-runtime: 1"));
  const files = await Promise.all((await readdir(join(root, "constants"))).filter(path => path.endsWith(".asm")).map(async path => ({ path: `constants/${path}`, contents: await readFile(join(root, "constants", path), "utf8") })));
  const catalog = projectConstantCatalogFromSources(files);
  const constants = new Map(catalog.constants.map(entry => [entry.symbol, entry.value]));
  constants.set(plan.mapConstant, 0);
  constants.set(actor.constant, actor.id);
  constants.set("PAD_UP", 0x40); constants.set("PAD_LEFT", 0x20);
  const vars = new Map<string, number>([["wEventFlags", 0xc800]]); let address = 0xc100, high = 0xff90;
  for (const name of [...(code + runtime).matchAll(/\b([wh][A-Z]\w*)\b/g)].map(match => match[1])) if (!vars.has(name)) {
    if (name === "wEventFlags") vars.set(name, 0xc800);
    else if (name.startsWith("h")) vars.set(name, high++);
    else { vars.set(name, address); address += name === "wMapSpriteData" ? 32 : /wEditorScene(?:Directions|Movements|Visibility)$/.test(name) ? 14 : 1; }
  }
  const defs = [...vars].map(([key, value]) => `DEF ${key} EQU $${value.toString(16)}`);
  for (const name of new Set([...(code + runtime).matchAll(/\b[A-Z][A-Z0-9_]+\b/g)].map(match => match[0]))) {
    if (name.startsWith("EVENT_") || name.startsWith("TEXT_") || name === "EQU") continue;
    if (constants.has(name)) defs.push(`DEF ${name} EQU ${constants.get(name)}`);
  }
  defs.push("DEF SFX_GET_ITEM_1 EQU 1");
  plan.textNodes.forEach((_, i) => defs.push(`DEF TEXT_${p.toUpperCase()}_SCENE_${i} EQU ${i + 1}`));
  const set = (name: string, value: number) => [`ld a, ${value}`, `ld [${name}], a`];
  const actorVar = (id: number, field: string) => `wSprite${String(id).padStart(2, "0")}${field}`;
  const expected = (name: string, value: number) => `${vars.get(name)!.toString(16)}=${value.toString(16)}`;
  const flag = (name: string | null) => name ? Number.parseInt(events.match(new RegExp(`DEF ${name} EQU \\$([a-f0-9]+)`))![1], 16) : -1;
  const done = flag(model.flag), latch = flag(plan.latchFlag), visible = flag(plan.visibility[0].flag);
  const nativeTable = (await readFile(join(root, "home/array2.asm"), "utf8")).split("IsInArray::")[0];
  let count = 0;
  for (const scenario of ["success", "decline", "decline-rearm", "wrong-tile", "busy-native-map", "blocked", ...(plan.follower ? ["pikachu"] : [])]) {
    const starts = !["wrong-tile", "busy-native-map"].includes(scenario), success = scenario === "success";
    const setup = ["di", "ld sp, $dfff", "ld hl, $c000", "ld bc, $1000", ".clear", "xor a", "ld [hli], a", "dec bc", "ld a, b", "or c", "jr nz, .clear",
      ...set("wXCoord", scenario === "wrong-tile" ? 9 : 8), ...set("wYCoord", 9), ...set("wCurMap", constants.get(plan.mapConstant)!), ...set("wJoyIgnore", 0x12), ...set("wOverrideSimulatedJoypadStatesMask", 0x34), ...set("wStatusFlags4", 5), ...set("$c003", scenario.startsWith("decline") ? 1 : 0)];
    if (plan.stateVariable) setup.push(...set(plan.stateVariable, scenario === "busy-native-map" ? 1 : 0));
    for (const id of plan.frozen) {
      const a = plan.actors.find(actor => actor.id === id);
      if (vars.has(actorVar(id, "StateData1PictureID"))) setup.push(...set(actorVar(id, "StateData1PictureID"), 1));
      if (vars.has(actorVar(id, "StateData2MapX"))) setup.push(...set(actorVar(id, "StateData2MapX"), (scenario === "blocked" && id === 2 ? 7 : a?.x ?? 0) + 4));
      if (vars.has(actorVar(id, "StateData2MapY"))) setup.push(...set(actorVar(id, "StateData2MapY"), (scenario === "blocked" && id === 2 ? 8 : a?.y ?? 0) + 4));
      setup.push(...set(actorVar(id, "StateData2MovementByte1"), id === 2 ? 0xfe : 0xff), ...set(`wMapSpriteData + ${(id - 1) * 2}`, 12 + id), ...set(`wMapSpriteData + ${(id - 1) * 2 + 1}`, 64 + id));
    }
    if (scenario === "pikachu") setup.push(...set("wSpritePikachuStateData1PictureID", 1), ...set("wSpritePikachuStateData2MapX", 11), ...set("wSpritePikachuStateData2MapY", 12));
    const tick = [
      "Tick:", "ld a, [$c004]", "and a", "jr z, .player", "dec a", "ld [$c004], a", "jr nz, .player", "ld hl, wStatusFlags5", "res BIT_SCRIPTED_NPC_MOVEMENT, [hl]",
      ".player", "ld a, [$c005]", "and a", "ret z", "dec a", "ld [$c005], a", "jr nz, .notEnd", "ld hl, wStatusFlags5", "res BIT_SCRIPTED_MOVEMENT_STATE, [hl]", "ret",
      ".notEnd", "xor a", "ld [wSimulatedJoypadStatesIndex], a", "ld a, [$c005]", "dec a", "ld [wWalkCounter], a", "ret",
    ];
    const stubs = [
      "DisplayTextID:", "ld a, [wJoyIgnore]", "and a", "jr z, .enabled", "ld hl, $c00a", "inc [hl]", ".enabled", "ldh a, [hTextID]", "dec a", "ld hl, ProbeTextPointers", "call CallFunctionInTable", "ret",
      "ProbeTextPointers:", ...plan.textNodes.map((_, i) => `dw ${p}SceneText${i} + 1`),
      "PrintText:", "ld hl, $c000", "inc [hl]", "ret", "YesNoChoice:", "ld a, [$c003]", "ld [wCurrentMenuItem], a", "ret",
      "MoveSprite:", "ld a, [de]", "cp NPC_MOVEMENT_LEFT", "jr nz, .up", `ld hl, ${actorVar(actor.id, "StateData2MapX")}`, "dec [hl]", "jr .finish", ".up", `ld hl, ${actorVar(actor.id, "StateData2MapY")}`, "dec [hl]", ".finish", "ld a, 3", "ld [$c004], a", "ld hl, $c001", "inc [hl]", "ld hl, wStatusFlags5", "set BIT_SCRIPTED_NPC_MOVEMENT, [hl]", "ret",
      "StartSimulatingJoypadStates:", "ld a, [wSimulatedJoypadStatesEnd]", "cp PAD_UP", "jr nz, .left", "ld hl, wYCoord", "dec [hl]", "jr .finish", ".left", "ld hl, wXCoord", "dec [hl]", ".finish", "xor a", "ld [wOverrideSimulatedJoypadStatesMask], a", "ld a, 3", "ld [$c005], a", "ld a, 2", "ld [wWalkCounter], a", "ld hl, $c002", "inc [hl]", "ld hl, wStatusFlags5", "set BIT_SCRIPTED_MOVEMENT_STATE, [hl]", "ret",
      "IsObjectHidden:", "call EditorSceneObjectHidden", "ret c", "xor a", "ldh [hIsToggleableObjectOff], a", "ret",
      "UpdateSprites:", "TextScriptEnd:", "GiveItem:", "GivePokemon:", "WaitForTextScrollButtonPress:", "EnableAutoTextBoxDrawing:", "WaitForSoundToFinish:", "PlaySound:", "ret",
      ...["Original", "AlreadyText", "BagFullText", ...plan.nodes.flatMap(node => node.textKey ? [`${node.textKey}Text`] : [])].map(suffix => `${p}${suffix}:\ndb 0`), ...tick,
    ];
    const asm = ['INCLUDE "macros/const.asm"', 'INCLUDE "macros/code.asm"', ...defs, events, await readFile(join(root, "macros/scripts/events.asm"), "utf8"),
      'SECTION "Header", ROM0[$100]', "jp Entry", "ds $150 - @, 0", 'SECTION "Code", ROM0[$150]', "Entry:", ...setup, "ld b, 120", ".frames", "push bc", "ld a, [wEditorSceneState]", "ld [$c006], a", "ld a, [$c004]", "ld c, a", "ld a, [$c005]", "or c", "ld [$c007], a", `call ${p}SceneFrame`,
      "ld a, [$c007]", "and a", "jr z, .tick", "ld a, [wEditorSceneState]", "ld c, a", "ld a, [$c006]", "cp c", "jr z, .tick", "ld hl, $c00b", "inc [hl]", ".tick", "call Tick", "pop bc", "dec b", "jr nz, .frames", ...(scenario === "decline-rearm" ? [...set("wXCoord", 9), `call ${p}SceneFrame`, ...set("wXCoord", 8), "ld b, 40", ".rearm", "push bc", `call ${p}SceneFrame`, "call Tick", "pop bc", "dec b", "jr nz, .rearm"] : []), "ProbeDone:", "halt", "jr ProbeDone", nativeTable, code, runtime, ...stubs].join("\n");
    const file = join(temporary, "scene-probe.asm"), obj = join(temporary, "scene-probe.o"), rom = join(temporary, "scene-probe.gb"), sym = join(temporary, "scene-probe.sym");
    await writeFile(file, asm); run(join(rgbds, "rgbasm"), ["-I", `${root}/`, "-o", obj, file]); run(join(rgbds, "rgblink"), ["-n", sym, "-o", rom, obj]); run(join(rgbds, "rgbfix"), ["-v", "-p", "0", rom]);
    const stop = (await readFile(sym, "utf8")).match(/^00:([0-9a-f]+) ProbeDone$/mi)![1];
    const checks = ["c00a=0", "c00b=0", `c000=${starts ? success || scenario === "decline-rearm" ? 2 : 1 : 0}`, `c001=${success ? 2 : 0}`, `c002=${success ? 2 : 0}`, expected("wEditorSceneActive", 0), expected("wJoyIgnore", 0x12), expected("wOverrideSimulatedJoypadStatesMask", 0x34), expected("wStatusFlags4", 5), expected("wXCoord", success ? 7 : scenario === "wrong-tile" ? 9 : 8), expected("wYCoord", success ? 8 : 9)];
    if (success) checks.push(expected(actorVar(actor.id, "StateData2MapX"), 11), expected(actorVar(actor.id, "StateData2MapY"), 11));
    for (const id of plan.frozen) checks.push(expected(actorVar(id, "StateData2MovementByte1"), id === 2 ? 0xfe : 0xff), `${(vars.get("wMapSpriteData")! + (id - 1) * 2).toString(16)}=${(12 + id).toString(16)}`, `${(vars.get("wMapSpriteData")! + (id - 1) * 2 + 1).toString(16)}=${(64 + id).toString(16)}`);
    const bytes = new Map<number, number>();
    for (const bit of [done, latch, visible]) if (bit >= 0) bytes.set(0xc800 + Math.floor(bit / 8), 0);
    if (success) bytes.set(0xc800 + Math.floor(done / 8), 1 << done % 8);
    else if (starts) bytes.set(0xc800 + Math.floor(latch / 8), 1 << latch % 8);
    bytes.forEach((value, address) => checks.push(`${address.toString(16)}=${value.toString(16)}`));
    run(cpu, [rom, stop, ...checks]); count++;
  }
  console.log(`${root}: ${count} CPU scene probes passed: route waits, final player frame, input restoration, native field/text IDs, hidden actors, coordinate latch and blockers`);
}
