import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { projectConstantCatalogFromSources } from "../src/core/projectConstants";
import { renderScene } from "../src/core/interactionScene";
import type { ManagedInteraction } from "../src/core/scriptInteractions";

// Run the real generated instructions and native table dispatcher on the CPU.
// Movement/text/item routines are instrumented boundaries, as in sceneCpuProbes.
export async function sceneStartsCpuProbes(root: string, temporary: string, rgbds: string, cpu: string,
  run: (cmd: string, args: string[], cwd?: string) => string, models: { interaction: ManagedInteraction; coordinate: ManagedInteraction }, events: string) {
  const files = await Promise.all((await readdir(join(root, "constants"))).filter(path => path.endsWith(".asm")).map(async path => ({ path: `constants/${path}`, contents: await readFile(join(root, "constants", path), "utf8") })));
  const catalog = projectConstantCatalogFromSources(files), constants = new Map(catalog.constants.map(entry => [entry.symbol, entry.value]));
  constants.set("PAD_UP", 0x40); constants.set("PAD_LEFT", 0x20); constants.set("PAD_RIGHT", 0x10); constants.set("SFX_GET_ITEM_1", 1);
  const macros = await readFile(join(root, "macros/scripts/events.asm"), "utf8");
  const nativeTable = (await readFile(join(root, "home/array2.asm"), "utf8")).split("IsInArray::")[0];
  const actor = models.interaction.scene!.actors.find(actor => models.interaction.scene!.nodes.some(node => node.npc === actor.constant))!;
  const variable = (field: string) => `wSprite${String(actor.id).padStart(2, "0")}${field}`;
  let count = 0;
  for (const kind of ["interaction", "coordinate"] as const) for (const scenario of ["start0", "start1", "start2", "excluded", "native-busy", ...(kind === "interaction" ? ["gift-abort-other-start"] : ["latch-union"])]) {
    const model = models[kind], plan = model.scene!, p = model.prefix;
    const code = renderScene(model).replaceAll("\ttext_asm", "\tdb 8").replaceAll("\ttext_promptbutton", "\tdb 0").replaceAll("\ttext_end", "\tdb 0").replaceAll("\tpredef ", "\tcall ");
    const vars = new Map<string, number>([["wEventFlags", 0xc800]]); let address = 0xc100, high = 0xff90;
    for (const name of [...(code + " wCurMap hIsToggleableObjectOff " + variable("StateData2MapY")).matchAll(/\b([wh][A-Z]\w*)\b/g)].map(match => match[1])) if (!vars.has(name)) {
      vars.set(name, name.startsWith("h") ? high++ : address);
      if (!name.startsWith("h")) address += name === "wMapSpriteData" ? 32 : /wEditorScene(?:Directions|Movements|Visibility)$/.test(name) ? 14 : 1;
    }
    const defs = [...vars].map(([name, value]) => `DEF ${name} EQU $${value.toString(16)}`);
    constants.set(plan.mapConstant, 0); constants.set(actor.constant, actor.id);
    for (const name of new Set([...(code + " PAD_UP PAD_LEFT").matchAll(/\b[A-Z][A-Z0-9_]+\b/g)].map(match => match[0]))) {
      if (!name.startsWith("EVENT_") && !name.startsWith("TEXT_") && name !== "EQU" && constants.has(name)) defs.push(`DEF ${name} EQU ${constants.get(name)}`);
    }
    plan.textNodes.forEach((_, i) => defs.push(`DEF TEXT_${p.toUpperCase()}_SCENE_${i} EQU ${i + 1}`));
    const set = (name: string, value: number) => [`ld a, ${value}`, `ld [${name}], a`];
    const position = (index: number) => [...set("wXCoord", plan.starts![index].x), ...set("wYCoord", plan.starts![index].y)];
    const reset = [...set("wCurMap", 0), ...set("wLinkState", scenario === "native-busy" ? 1 : 0), ...set("wJoyIgnore", 0x12), ...set("wOverrideSimulatedJoypadStatesMask", 0x34), ...set("wStatusFlags4", 5),
      ...(plan.stateVariable ? set(plan.stateVariable, scenario === "native-busy" ? 1 : 0) : []),
      ...plan.frozen.flatMap(id => {
        const actor = plan.actors.find(actor => actor.id === id)!;
        return ["StateData1PictureID", "StateData2MapX", "StateData2MapY", "StateData2MovementByte1"].flatMap(field => {
          const name = `wSprite${String(id).padStart(2, "0")}${field}`;
          return vars.has(name) ? set(name, field.endsWith("MapX") ? (actor?.x ?? 0) + 4 : field.endsWith("MapY") ? (actor?.y ?? 0) + 4 : field.endsWith("PictureID") ? 1 : 0xff) : [];
        });
      })];
    const excluded = scenario === "excluded", busy = scenario === "native-busy", accepted = !excluded && !busy;
    const index = scenario.startsWith("start") ? Number(scenario.slice(-1)) : 0;
    const launch = kind === "interaction" ? [`call ${model.label} + 1`] : [];
    const setup = ["di", "ld sp, $dfff", "ld hl, $c000", "ld bc, $1000", ".clear", "xor a", "ld [hli], a", "dec bc", "ld a, b", "or c", "jr nz, .clear", ...reset,
      ...(excluded ? [...set("wXCoord", 8), ...set("wYCoord", 6)] : position(index)), ...launch];
    const stubs = ["Frames:", "ld b, 80", ".frame", "push bc", `call ${p}SceneFrame`, "pop bc", "dec b", "jr nz, .frame", "ret",
      "DisplayTextID:", "ldh a, [hTextID]", "dec a", "ld hl, ProbeTextPointers", "call CallFunctionInTable", "ret", "ProbeTextPointers:", ...plan.textNodes.map((_, i) => `dw ${p}SceneText${i} + 1`),
      "GiveItem:", "ld hl, $c000", "inc [hl]", "scf", "ret",
      "MoveSprite:", `ld hl, ${variable("StateData2MapY")}`, "dec [hl]", "ret",
      "StartSimulatingJoypadStates:", "ld a, [wSimulatedJoypadStatesEnd]", "ld [$c001], a", "cp PAD_UP", "jr nz, .horizontal", "ld hl, wYCoord", "dec [hl]", "jr .finish", ".horizontal", "cp PAD_LEFT", "ld hl, wXCoord", "jr nz, .right", "dec [hl]", "jr .finish", ".right", "inc [hl]", ".finish", "xor a", "ld [wSimulatedJoypadStatesIndex], a", "ret",
      "IsObjectHidden:", "xor a", "ldh [hIsToggleableObjectOff], a", "ret", "TextScriptEnd:", "PrintText:", "UpdateSprites:", "PlaySound:", "WaitForSoundToFinish:", "GivePokemon:", "WaitForTextScrollButtonPress:", "EnableAutoTextBoxDrawing:", "ret",
      ...[...new Set(["Original", "AlreadyText", "BagFullText", ...plan.nodes.flatMap(node => node.textKey ? [`${node.textKey}Text`] : [])])].map(suffix => `${p}${suffix}:\ndb 0`),
    ];
    const flow = scenario === "gift-abort-other-start" ? [
      "ld b, 80", ".untilGift", "push bc", `call ${p}SceneFrame`, "pop bc", "ld a, [$c000]", "and a", "jr nz, .gift", "dec b", "jr nz, .untilGift", ".gift", `call ${p}Abort`,
      ...reset, ...position(2), ...launch, "call Frames",
    ] : ["call Frames"];
    if (kind === "interaction" && accepted) flow.push(...reset, ...position((index + 1) % 3), ...launch, "call Frames"); // Shared once flag prevents another delivery.
    if (scenario === "latch-union") flow.push(...position(1), "call Frames", "ld a, [$c000]", "ld [$c002], a", ...set("wXCoord", 8), ...set("wYCoord", 6), `call ${p}SceneFrame`, ...position(2), "call Frames");
    const asm = ['INCLUDE "macros/const.asm"', 'INCLUDE "macros/code.asm"', ...defs, events, macros, 'SECTION "Header", ROM0[$100]', "jp Entry", "ds $150 - @, 0", 'SECTION "Code", ROM0[$150]', "Entry:", ...setup, ...flow,
      "ProbeDone:", "halt", "jr ProbeDone", nativeTable, code, ...stubs].join("\n");
    const file = join(temporary, "starts.asm"), obj = join(temporary, "starts.o"), rom = join(temporary, "starts.gb"), sym = join(temporary, "starts.sym");
    await writeFile(file, asm); run(join(rgbds, "rgbasm"), ["-I", `${root}/`, "-o", obj, file]); run(join(rgbds, "rgblink"), ["-n", sym, "-o", rom, obj]); run(join(rgbds, "rgbfix"), ["-v", "-p", "0", rom]);
    const stop = (await readFile(sym, "utf8")).match(/^00:([0-9a-f]+) ProbeDone$/mi)![1];
    const checks = [`c000=${accepted ? scenario === "latch-union" ? 2 : 1 : 0}`, ...["wEditorSceneActive", "wSimulatedJoypadStatesIndex"].filter(name => vars.has(name)).map(name => `${vars.get(name)!.toString(16)}=0`), `${vars.get("wJoyIgnore")!.toString(16)}=12`];
    if (kind === "interaction" && accepted) checks.push(`c001=${(constants.get(["PAD_UP", "PAD_RIGHT", "PAD_LEFT"][scenario === "gift-abort-other-start" ? 2 : index])!).toString(16)}`);
    if (scenario === "latch-union") checks.push("c002=1");
    run(cpu, [rom, stop, ...checks]); count++;
  }
  assert.equal(count, 12);
  console.log(`${root}: ${count} multi-start CPU probes passed: all sides, per-start following, excluded/native busy starts, shared once/gift checkpoint and coordinate latch union`);
}
