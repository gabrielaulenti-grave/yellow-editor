import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { projectConstantCatalogFromSources } from "../src/core/projectConstants";
import { renderScene } from "../src/core/interactionScene";
import { renderPositionTest } from "../src/core/scenePosition";
import type { ManagedInteraction } from "../src/core/scriptInteractions";

export async function scenePositionCpuProbes(root: string, temporary: string, rgbds: string, cpu: string,
  run: (cmd: string, args: string[], cwd?: string) => string, model: ManagedInteraction, events: string) {
  const files = await Promise.all((await readdir(join(root, "constants"))).filter(path => path.endsWith(".asm")).map(async path => ({ path, contents: await readFile(join(root, "constants", path), "utf8") })));
  const constants = new Map(projectConstantCatalogFromSources(files).constants.map(entry => [entry.symbol, entry.value]));
  const plan = model.scene!, p = model.prefix, actor = plan.actors.find(actor => actor.constant.includes("EDITOR_NPC"))!;
  const variable = (field: string) => `wSprite${String(actor.id).padStart(2, "0")}${field}`;
  const code = renderScene(model).replaceAll("\ttext_asm", "\tdb 8").replaceAll("\ttext_promptbutton", "\tdb 0").replaceAll("\ttext_end", "\tdb 0").replaceAll("\tpredef ", "\tcall ");
  const nativeTable = (await readFile(join(root, "home/array2.asm"), "utf8")).split("IsInArray::")[0];
  const macros = await readFile(join(root, "macros/scripts/events.asm"), "utf8");
  const tests = ["LEFT", "RIGHT", "UP", "DOWN"] as const;
  const comparisons = tests.flatMap((side, index) => [`Compare${index}:`, ...renderPositionTest({ mode: "relative", npc: actor.constant, side }, actor.id, ".yes", ".no"), ".yes", "ld a, 1", "ret", ".no", "xor a", "ret"]);
  const vars = new Map<string, number>([["wEventFlags", 0xc800]]); let address = 0xc100, high = 0xff90;
  for (const name of [...(code + comparisons.join("\n") + ` wCurMap hIsToggleableObjectOff ${variable("StateData2MapX")} ${variable("StateData2MapY")}`).matchAll(/\b([wh][A-Z]\w*)\b/g)].map(match => match[1])) if (!vars.has(name)) {
    vars.set(name, name.startsWith("h") ? high++ : address);
    if (!name.startsWith("h")) address += name === "wMapSpriteData" ? 32 : /wEditorScene(?:Directions|Movements|Visibility)$/.test(name) ? 14 : 1;
  }
  constants.set(plan.mapConstant, 0); constants.set(actor.constant, actor.id);
  const defs = [...vars].map(([name, value]) => `DEF ${name} EQU $${value.toString(16)}`);
  for (const name of new Set([...code.matchAll(/\b[A-Z][A-Z0-9_]+\b/g)].map(match => match[0]))) if (!name.startsWith("EVENT_") && !name.startsWith("TEXT_") && name !== "EQU" && constants.has(name)) defs.push(`DEF ${name} EQU ${constants.get(name)}`);
  plan.textNodes.forEach((_, i) => defs.push(`DEF TEXT_${p.toUpperCase()}_SCENE_${i} EQU ${i + 1}`));
  const set = (name: string, value: number) => [`ld a, ${value}`, `ld [${name}], a`];
  const stubs = ["Frames:", "ld b, 80", ".frame", "push bc", `call ${p}SceneFrame`, "pop bc", "dec b", "jr nz, .frame", "ret",
    "DisplayTextID:", "ldh a, [hTextID]", "dec a", "ld hl, ProbeTextPointers", "call CallFunctionInTable", "ret", "ProbeTextPointers:", ...plan.textNodes.map((_, i) => `dw ${p}SceneText${i} + 1`),
    "PrintText:", "ld hl, $c000", "inc [hl]", `ld a, [${variable("StateData1FacingDirection")}]`, "ld [$c001], a", "ld a, [wSpritePlayerStateData1FacingDirection]", "ld [$c002], a", "ld a, [wPlayerMovingDirection]", "ld [$c003], a", "ret",
    "MoveSprite:", "ld a, [de]", "cp NPC_MOVEMENT_UP", "jr nz, .down", `ld hl, ${variable("StateData2MapY")}`, "dec [hl]", "ret", ".down", "cp NPC_MOVEMENT_DOWN", "jr nz, .left", `ld hl, ${variable("StateData2MapY")}`, "inc [hl]", "ret", ".left", "cp NPC_MOVEMENT_LEFT", `ld hl, ${variable("StateData2MapX")}`, "jr nz, .right", "dec [hl]", "ret", ".right", "inc [hl]", "ret",
    "IsObjectHidden:", "xor a", "ldh [hIsToggleableObjectOff], a", "ret", "TextScriptEnd:", "UpdateSprites:", "ret",
    ...["Original", "AlreadyText", ...plan.nodes.flatMap(node => node.textKey ? [`${node.textKey}Text`] : [])].map(suffix => `${p}${suffix}:\ndb 0`),
  ];
  let count = 0;
  for (const scenario of ["left", "right", "displaced", "comparisons"]) {
    const index = scenario === "right" ? 1 : 0, point = plan.starts![index];
    const reset = [...set("wCurMap", 0), ...set("wJoyIgnore", 0x12), ...set("wOverrideSimulatedJoypadStatesMask", 0x34), ...set("wStatusFlags4", 5), ...set("wXCoord", point.x), ...set("wYCoord", point.y), ...set("wPlayerMovingDirection", constants.get("PLAYER_DIR_DOWN")!),
      ...plan.frozen.flatMap(id => {
        const npc = plan.actors.find(actor => actor.id === id);
        return ["StateData1PictureID", "StateData2MapX", "StateData2MapY", "StateData2MovementByte1"].flatMap(field => {
          const name = `wSprite${String(id).padStart(2, "0")}${field}`;
          return vars.has(name) ? set(name, field.endsWith("MapX") ? (npc?.x ?? 0) + 4 : field.endsWith("MapY") ? (npc?.y ?? 0) + 4 : field.endsWith("PictureID") ? 1 : 0xff) : [];
        });
      })];
    const flow = scenario === "comparisons" ? [
      ...set(variable("StateData2MapX"), 12), ...set(variable("StateData2MapY"), 8),
      ...[[7, 4], [9, 4], [8, 3], [8, 5], [8, 4]].flatMap(([x, y], index) => [...set("wXCoord", x), ...set("wYCoord", y), ...tests.flatMap((_, test) => [`call Compare${test}`, `ld [$${(0xc010 + index * 4 + test).toString(16)}], a`])]),
    ] : [`call ${model.label} + 1`, ...(scenario === "displaced" ? [`call ${p}SceneFrame`, ...set("wXCoord", 9)] : []), "call Frames"];
    const asm = ['INCLUDE "macros/const.asm"', 'INCLUDE "macros/code.asm"', ...defs, events, macros, 'SECTION "Header", ROM0[$100]', "jp Entry", "ds $150 - @, 0", 'SECTION "Code", ROM0[$150]', "Entry:", "di", "ld sp, $dfff", "ld hl, $c000", "ld bc, $1000", ".clear", "xor a", "ld [hli], a", "dec bc", "ld a, b", "or c", "jr nz, .clear", ...reset, ...flow, "ProbeDone:", "halt", "jr ProbeDone", nativeTable, code, ...comparisons, ...stubs].join("\n");
    const file = join(temporary, "position.asm"), obj = join(temporary, "position.o"), rom = join(temporary, "position.gb"), sym = join(temporary, "position.sym");
    await writeFile(file, asm); run(join(rgbds, "rgbasm"), ["-I", `${root}/`, "-o", obj, file]); run(join(rgbds, "rgblink"), ["-n", sym, "-o", rom, obj]); run(join(rgbds, "rgbfix"), ["-v", "-p", "0", rom]);
    const stop = (await readFile(sym, "utf8")).match(/^00:([0-9a-f]+) ProbeDone$/mi)![1];
    const expected = (name: string, value: number) => `${vars.get(name)!.toString(16)}=${value.toString(16)}`;
    const checks = scenario === "comparisons" ? Array.from({ length: 20 }, (_, i) => `${(0xc010 + i).toString(16)}=${i < 16 && i % 4 === Math.floor(i / 4) ? 1 : 0}`) : [
      `c000=${scenario === "displaced" ? 0 : 2}`, expected("wEditorSceneActive", 0), expected("wJoyIgnore", 0x12),
      ...(scenario === "displaced" ? [] : [`c001=${constants.get(index ? "SPRITE_FACING_LEFT" : "SPRITE_FACING_RIGHT")!.toString(16)}`, `c002=${constants.get(index ? "SPRITE_FACING_RIGHT" : "SPRITE_FACING_LEFT")!.toString(16)}`, "c003=0", expected(variable("StateData2MapX"), (index ? 10 : 6) + 4), expected(variable("StateData2MapY"), 8), expected("wXCoord", point.x), expected("wYCoord", point.y)]),
    ];
    run(cpu, [rom, stop, ...checks]); count++;
  }
  assert.equal(count, 4);
  console.log(`${root}: position/facing CPU probes passed: both approach paths, reciprocal turns without movement, exact/relative conditions, equality and unexpected displacement`);
}
