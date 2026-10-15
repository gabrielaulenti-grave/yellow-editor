import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { projectConstantCatalogFromSources } from "../src/core/projectConstants";
import { renderScene } from "../src/core/interactionScene";
import type { ManagedInteraction } from "../src/core/scriptInteractions";

// Execute the generated dispatcher, delivery checkpoint, branches and cleanup.
// Native text/menu and movement engines are instrumented boundaries; the real
// GivePokemon/GiveItem success/carry contracts are covered by the gift suite.
export async function sceneGiftCpuProbes(root: string, temporary: string, rgbds: string, cpu: string,
  run: (cmd: string, args: string[], cwd?: string) => string, template: ManagedInteraction, alternate: ManagedInteraction, events: string, engine: string) {
  const files = await Promise.all((await readdir(join(root, "constants"))).filter(path => path.endsWith(".asm"))
    .map(async path => ({ path: `constants/${path}`, contents: await readFile(join(root, "constants", path), "utf8") })));
  const constants = new Map(projectConstantCatalogFromSources(files).constants.map(entry => [entry.symbol, entry.value]));
  const nativeTable = (await readFile(join(root, "home/array2.asm"), "utf8")).split("IsInArray::")[0];
  const macros = await readFile(join(root, "macros/scripts/events.asm"), "utf8");
  const runtime = engine.slice(engine.indexOf("; yellow-editor-scene-runtime: 1"));
  let count = 0;
  for (const kind of ["pokemon", "item"] as const) for (const scenario of ["success", "decline", "abort", "abort-retry", "full-retry", "reload", "repeat", "repeat-abort-retry", ...(kind === "pokemon" ? ["alternate-retry"] : [])]) {
    const model = structuredClone(scenario === "alternate-retry" ? alternate : template), p = model.prefix, plan = model.scene!;
    const repeat = scenario.startsWith("repeat");
    model.values.once = !repeat;
    for (const node of plan.nodes) if (node.action?.kind === "pokemon") {
      node.action = kind === "pokemon" ? node.action : { kind: "item", item: "POTION", quantity: 1 };
    }
    const actor = plan.actors.find(actor => plan.nodes.some(node => node.npc === actor.constant))!;
    const blocker = plan.frozen.find(id => id !== actor.id)!;
    const varFor = (id: number, field: string) => `wSprite${String(id).padStart(2, "0")}${field}`;
    const code = renderScene(model).replaceAll("\ttext_asm", "\tdb 8").replaceAll("\ttext_promptbutton", "\tdb 0")
      .replaceAll("\ttext_end", "\tdb 0").replaceAll("\tpredef ", "\tcall ");
    const vars = new Map<string, number>([["wEventFlags", 0xc800]]); let address = 0xc100, high = 0xff90;
    for (const name of [...(code + runtime).matchAll(/\b([wh][A-Z]\w*)\b/g)].map(match => match[1])) if (!vars.has(name)) {
      vars.set(name, name.startsWith("h") ? high++ : address);
      if (!name.startsWith("h")) address += name === "wMapSpriteData" ? 32 : /wEditorScene(?:Directions|Movements|Visibility)$/.test(name) ? 14 : 1;
    }
    const defs = [...vars].map(([name, value]) => `DEF ${name} EQU $${value.toString(16)}`);
    constants.set(plan.mapConstant, 0);
    constants.set(actor.constant, actor.id);
    for (const name of new Set([...(code + runtime).matchAll(/\b[A-Z][A-Z0-9_]+\b/g)].map(match => match[0]))) {
      if (!name.startsWith("EVENT_") && !name.startsWith("TEXT_") && name !== "EQU" && name !== "SFX_GET_ITEM_1" && constants.has(name)) defs.push(`DEF ${name} EQU ${constants.get(name)}`);
    }
    defs.push("DEF SFX_GET_ITEM_1 EQU 1");
    plan.textNodes.forEach((_, i) => defs.push(`DEF TEXT_${p.toUpperCase()}_SCENE_${i} EQU ${i + 1}`));
    const set = (name: string, value: number) => [`ld a, ${value}`, `ld [${name}], a`];
    const reset = [
      ...set("wEditorSceneActive", 0), ...set("wEditorSceneState", 0), ...set("wStatusFlags5", 0),
      ...set("wXCoord", 8), ...set("wYCoord", 9), ...set("wCurMap", constants.get(plan.mapConstant)!),
      ...set("wJoyIgnore", 0x12), ...set("wOverrideSimulatedJoypadStatesMask", 0x34), ...set("wStatusFlags4", 5),
      ...(plan.stateVariable ? set(plan.stateVariable, 0) : []),
      ...plan.frozen.flatMap(id => [
        ...(vars.has(varFor(id, "StateData1PictureID")) ? set(varFor(id, "StateData1PictureID"), 1) : []),
        ...(vars.has(varFor(id, "StateData2MapX")) ? set(varFor(id, "StateData2MapX"), id === actor.id ? 12 : 4) : []),
        ...(vars.has(varFor(id, "StateData2MapY")) ? set(varFor(id, "StateData2MapY"), id === actor.id ? 12 : 4) : []),
        ...set(varFor(id, "StateData2MovementByte1"), 0xff), ...set(`wMapSpriteData + ${(id - 1) * 2}`, 12 + id),
      ]),
    ];
    const abort = scenario.includes("abort") || scenario === "alternate-retry";
    const setup = ["di", "ld sp, $dfff", "ld hl, $c000", "ld bc, $1000", ".clear", "xor a", "ld [hli], a", "dec bc", "ld a, b", "or c", "jr nz, .clear",
      ...reset, ...set("$c004", abort ? 1 : 0), ...set("$c005", scenario === "full-retry" ? 1 : 0), ...set("$c006", scenario === "decline" ? 1 : 0)];
    // c000 counts successful deliveries; c001 counts attempts. c002/c003 count
    // movement/text. c004 blocks the exit after delivery; c005 fails delivery;
    // c006 selects No. c00a detects a missing checkpoint before success prompts.
    const stubs = [
      "DisplayTextID:", "ldh a, [hTextID]", "dec a", "ld hl, ProbeTextPointers", "call CallFunctionInTable", "ret",
      "ProbeTextPointers:", ...plan.textNodes.map((_, i) => `dw ${p}SceneText${i} + 1`),
      "PrintText:", "ld hl, $c003", "inc [hl]", "ret", "YesNoChoice:", "ld a, [$c006]", "ld [wCurrentMenuItem], a", "ret",
      "MoveSprite:", "ld hl, $c002", "inc [hl]", "ld a, [de]", "cp NPC_MOVEMENT_LEFT", `ld hl, ${varFor(actor.id, "StateData2MapX")}`, "jr nz, .right", "dec [hl]", "ret", ".right", "inc [hl]", "ret",
      "GiveItem:", "ld hl, $c00d", "inc [hl]", "jr Give", "GivePokemon:", "ld hl, $c00c", "inc [hl]", "Give:",
      "ld hl, $c001", "inc [hl]", "ld a, [$c005]", "and a", "ret nz", // AND clears carry on failed delivery.
      "ld hl, $c000", "inc [hl]", "ld a, [$c004]", "and a", "jr z, .success",
      ...set(varFor(blocker, "StateData2MapX"), 12), ...set(varFor(blocker, "StateData2MapY"), 12),
      ".success", "scf", "ret",
      "WaitForTextScrollButtonPress:", "EnableAutoTextBoxDrawing:", "PlaySound:", "WaitForSoundToFinish:",
      `CheckEvent ${plan.giftFlag}`, "ret nz", "ld hl, $c00a", "inc [hl]", "ret",
      "IsObjectHidden:", "call EditorSceneObjectHidden", "ret c", "xor a", "ldh [hIsToggleableObjectOff], a", "ret",
      "UpdateSprites:", "StartSimulatingJoypadStates:", "TextScriptEnd:", "ret",
      ...["Original", "AlreadyText", "BagFullText", ...plan.nodes.flatMap(node => node.textKey ? [`${node.textKey}Text`] : [])].map(suffix => `${p}${suffix}:\ndb 0`),
      "Frames:", "ld b, 80", ".frame", "push bc", `call ${p}SceneFrame`, "pop bc", "dec b", "jr nz, .frame", "ret",
      "Reload:",
      // Discard all working scene/sprite RAM, retaining only the saved event
      // array and probe counters. Restart from authored map coordinates.
      "ld hl, $c100", "ld bc, $600", ".clear", "xor a", "ld [hli], a", "dec bc", "ld a, b", "or c", "jr nz, .clear", ...reset, "ret",
      "Rearm:", ...set("wXCoord", 9), `call ${p}SceneFrame`, ...set("wXCoord", 8), "ret",
    ];
    const flow: string[] = [];
    if (scenario === "reload") {
      flow.push("ld b, 80", ".untilGift", "push bc", `call ${p}SceneFrame`, "pop bc", "ld a, [$c000]", "and a", "jr nz, .saved", "dec b", "jr nz, .untilGift", ".saved", "call Reload", "call Rearm", "call Frames");
    } else flow.push("call Frames");
    if (scenario.endsWith("retry")) flow.push("call Reload", "call Rearm", ...set("$c004", 0), ...set("$c005", 0),
      ...(scenario === "alternate-retry" ? set("$c006", 1) : []), "call Frames");
    if (repeat) flow.push("call Rearm", "call Frames");
    else if (scenario !== "abort") flow.push("call Reload", "call Rearm", "call Frames"); // Completed one-time scenes cannot give again.
    const asm = ['INCLUDE "macros/const.asm"', 'INCLUDE "macros/code.asm"', ...defs, events, macros,
      'SECTION "Header", ROM0[$100]', "jp Entry", "ds $150 - @, 0", 'SECTION "Code", ROM0[$150]', "Entry:", ...setup, ...flow,
      "ProbeDone:", "halt", "jr ProbeDone", nativeTable, code, runtime, ...stubs].join("\n");
    const file = join(temporary, "scene-gift-probe.asm"), obj = join(temporary, "scene-gift-probe.o"), rom = join(temporary, "scene-gift-probe.gb"), sym = join(temporary, "scene-gift-probe.sym");
    await writeFile(file, asm); run(join(rgbds, "rgbasm"), ["-I", `${root}/`, "-o", obj, file]); run(join(rgbds, "rgblink"), ["-n", sym, "-o", rom, obj]); run(join(rgbds, "rgbfix"), ["-v", "-p", "0", rom]);
    const stop = (await readFile(sym, "utf8")).match(/^00:([0-9a-f]+) ProbeDone$/mi)![1];
    const expected = (name: string, value: number) => `${vars.get(name)!.toString(16)}=${value.toString(16)}`;
    const delivered = scenario === "decline" ? 0 : repeat ? 2 : 1;
    const checks = [`c000=${delivered}`, `c001=${scenario === "full-retry" ? 2 : delivered}`, "c00a=0",
      expected("wEditorSceneActive", 0), expected("wJoyIgnore", 0x12), expected("wOverrideSimulatedJoypadStatesMask", 0x34), expected("wStatusFlags4", 5)];
    if (scenario === "alternate-retry") checks.push("c00c=1", "c00d=0");
    const flags = new Map<number, number>();
    const flag = (name: string, value: boolean) => {
      const bit = Number.parseInt(events.match(new RegExp(`DEF ${name} EQU \\$([a-f0-9]+)`))![1], 16), address = 0xc800 + Math.floor(bit / 8);
      flags.set(address, (flags.get(address) ?? 0) | (value ? 1 << bit % 8 : 0));
    };
    flag(model.flag!, !repeat && scenario !== "abort");
    flag(plan.giftFlag!, scenario === "abort");
    flag(plan.latchFlag!, repeat || scenario === "abort");
    flag(plan.visibility[0].flag, false);
    flags.forEach((value, address) => checks.push(`${address.toString(16)}=${value.toString(16)}`));
    try { run(cpu, [rom, stop, ...checks]); }
    catch (error) { throw new Error(`${kind} ${scenario}: ${String(error)}`); }
    count++;
  }
  console.log(`${root}: ${count} gift scene CPU probes passed: gifts before exit, success checkpoints before prompts, blocked exits, retry, failed delivery, persisted events after RAM reset, declines and repeatable scenes`);
}
