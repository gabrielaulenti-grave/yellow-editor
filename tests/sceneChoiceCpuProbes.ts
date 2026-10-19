import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { projectConstantCatalogFromSources } from "../src/core/projectConstants";
import { renderScene } from "../src/core/interactionScene";
import type { sceneChoiceChecks } from "./sceneChoiceChecks";

export async function sceneChoiceCpuProbes(root: string, temporary: string, rgbds: string, cpu: string,
  run: (cmd: string, args: string[], cwd?: string) => string, models: Awaited<ReturnType<typeof sceneChoiceChecks>>, events: string) {
  const files = await Promise.all((await readdir(join(root, "constants"))).filter(path => path.endsWith(".asm")).map(async path => ({ path: `constants/${path}`, contents: await readFile(join(root, "constants", path), "utf8") })));
  const constants = new Map(projectConstantCatalogFromSources(files).constants.map(entry => [entry.symbol, entry.value]));
  const all = [models.guardian, models.dome, models.helix], plans = all.map(model => model.scene!);
  const code = all.map(renderScene).join("\n").replaceAll("\ttext_asm", "\tdb 8").replaceAll("\ttext_promptbutton", "\tdb 0").replaceAll("\ttext_end", "\tdb 0").replaceAll("\tpredef ", "\tcall ").replaceAll("\tfarcall ", "\tcall ");
  const vars = new Map<string, number>([["wEventFlags", 0xc800]]); let address = 0xc100, high = 0xff90;
  for (const name of [...(code + " wCurMap hIsToggleableObjectOff").matchAll(/\b([wh][A-Z]\w*)\b/g)].map(match => match[1])) if (!vars.has(name)) {
    vars.set(name, name.startsWith("h") ? high++ : address);
    if (!name.startsWith("h")) address += name === "wMapSpriteData" ? 32 : /wEditorScene(?:Directions|Movements|Visibility)$/.test(name) ? 14 : 1;
  }
  const defs = [...vars].map(([name, value]) => `DEF ${name} EQU $${value.toString(16)}`);
  constants.set("OPP_SUPER_NERD", 201); constants.set("SAFARI_ZONE_EAST", 200); constants.set("SAFARI_ZONE_CENTER_REST_HOUSE", 205);
  constants.set(plans[0].mapConstant, 0); constants.set("SFX_GET_ITEM_1", 1);
  plans[0].actors.forEach(actor => constants.set(actor.constant, actor.id));
  for (const name of new Set([...code.matchAll(/\b[A-Z][A-Z0-9_]+\b/g)].map(match => match[0]))) if (!name.startsWith("EVENT_") && !name.startsWith("TEXT_") && name !== "EQU" && constants.has(name)) defs.push(`DEF ${name} EQU ${constants.get(name)}`);
  let text = 0;
  const texts = all.flatMap(model => model.scene!.textNodes.map((_, i) => {
    defs.push(`DEF TEXT_${model.prefix.toUpperCase()}_SCENE_${i} EQU ${++text}`); return `dw ${model.prefix}SceneText${i} + 1`;
  }));
  const nerd = plans[0].actors.find(actor => actor.constant.includes("EDITOR_NPC"))!;
  const variable = (id: number, field: string) => `wSprite${String(id).padStart(2, "0")}${field}`;
  const set = (name: string, value: number) => [`ld a, ${value}`, `ld [${name}], a`];
  const [won, group, domeFlag, helixFlag] = models.flags.map(flag => flag.event);
  const nativeTable = (await readFile(join(root, "home/array2.asm"), "utf8")).split("IsInArray::")[0];
  const macros = await readFile(join(root, "macros/scripts/events.asm"), "utf8");
  const stubs = ["Frames:", "ld b, 120", ".frame", "push bc", ...all.map(model => `call ${model.prefix}SceneFrame`), "call BattleTick", "pop bc", "dec b", "jr nz, .frame", "ret",
    "UntilGift:", "ld b, 120", ".frame", "push bc", ...all.map(model => `call ${model.prefix}SceneFrame`), "pop bc", "ld a, [$c000]", "and a", "ret nz", "dec b", "jr nz, .frame", "ret",
    "BattleTick:", "ld a, [wEditorSceneBattle]", "cp 1", "ret nz", "ld hl, $c002", "inc [hl]", "ld a, [$c006]", "and a", "jr z, .won", ...set("wIsInBattle", constants.get("LOST_BATTLE")!), "ret", ".won", ...set("wEditorSceneBattle", 2), "xor a", "ld [wIsInBattle], a", "ld [wCurOpponent], a", "ld [wEditorSceneBattleResult], a", "ret",
    "AnyPartyAlive:", "ld d, 1", "ret",
    "DisplayTextID:", "ldh a, [hTextID]", "dec a", "ld hl, ProbeTextPointers", "call CallFunctionInTable", "ret", "ProbeTextPointers:", ...texts,
    "YesNoChoice:", "ld a, [$c004]", "ld [wCurrentMenuItem], a", "ret",
    "GiveItem:", "ld a, [$c005]", "and a", "jr z, .give", "and a", "ret", ".give", "ld hl, $c000", "inc [hl]", "ld a, b", "ld [$c001], a", "scf", "ret",
    "MoveSprite:", "ld a, [de]", "cp NPC_MOVEMENT_UP", `ld hl, ${variable(nerd.id, "StateData2MapY")}`, "jr nz, .right", "dec [hl]", "ret", ".right", `ld hl, ${variable(nerd.id, "StateData2MapX")}`, "inc [hl]", "ret",
    "IsObjectHidden:", "xor a", "ldh [hIsToggleableObjectOff], a", "ret",
    "PrintText:", "ld hl, $c008", "inc [hl]", "ret", "TextScriptEnd:", "UpdateSprites:", "PlaySound:", "WaitForSoundToFinish:", "PlayDefaultMusic:", "GBFadeOutToBlack:", "GBFadeInFromBlack:", "LoadGBPal:", "ret",
    ...all.flatMap(model => ["Original", "AlreadyText", "BagFullText", ...model.scene!.nodes.flatMap(node => node.textKey ? [`${node.textKey}Text`] : [])].map(suffix => `${model.prefix}${suffix}:\ndb 0`)),
  ];
  const reset = [...set("wJoyIgnore", 0x12), ...set("wOverrideSimulatedJoypadStatesMask", 0x34), ...set("wStatusFlags4", 5), ...set("wPartyCount", 1), ...set("wIsInBattle", 0), ...set("wCurOpponent", 0), ...set("wEditorSceneActive", 0), ...set("wEditorSceneBattle", 0),
    ...plans[0].frozen.flatMap(id => {
      const actor = plans[0].actors.find(actor => actor.id === id);
      return ["StateData1PictureID", "StateData2MapX", "StateData2MapY", "StateData2MovementByte1"].flatMap(field => {
        const name = variable(id, field);
        return vars.has(name) ? set(name, field.endsWith("MapX") ? (actor?.x ?? 0) + 4 : field.endsWith("MapY") ? (actor?.y ?? 0) + 4 : field.endsWith("PictureID") ? 1 : 0xff) : [];
      });
    })];
  function launch(which: "guardian" | "dome" | "helix", start = 0, frames = true) {
    const model = models[which], point = model.scene!.starts?.[start] ?? { x: model.values.scene!.playerX, y: model.values.scene!.playerY };
    return [...reset, ...set("wXCoord", point.x), ...set("wYCoord", point.y), `call ${model.label} + 1`, ...(frames ? ["call Frames"] : [])];
  }
  const flagValue = (name: string) => parseInt(events.match(new RegExp(`DEF ${name} EQU \\$([a-f0-9]+)`))![1], 16);
  let count = 0;
  for (const scenario of ["dome0", "dome1", "dome2", "helix0", "helix1", "helix2", "locked", "decline", "full-retry", "abort-other", "abort-resume", "reload-other", "reload-same", "guardian-win", "guardian-loss", "automatic-win", "automatic-disabled", "automatic-not-selected"]) {
    const helix = scenario.startsWith("helix") || scenario === "full-retry", selected = helix ? "helix" : "dome";
    const success = !["locked", "decline", "guardian-loss", "automatic-disabled", "automatic-not-selected"].includes(scenario), complete = success && !["abort-other", "reload-other"].includes(scenario);
    const flow = ["di", "ld sp, $dfff", "ld hl, $c000", "ld bc, $1000", ".clear", "xor a", "ld [hli], a", "dec bc", "ld a, b", "or c", "jr nz, .clear"];
    if (!scenario.startsWith("guardian") && !["locked", "automatic-win", "automatic-not-selected"].includes(scenario)) flow.push(`SetEvent ${won}`);
    if (scenario.startsWith("guardian")) flow.push(...set("$c006", scenario === "guardian-loss" ? 1 : 0), ...launch("guardian"));
    if (scenario.startsWith("automatic")) {
      const point = scenario === "automatic-not-selected" ? { x: 6, y: 5 } : { x: 8, y: 6 };
      flow.push(...reset, ...set("wXCoord", point.x), ...set("wYCoord", point.y), "call Frames");
    }
    if (scenario === "decline") flow.push(...set("$c004", 1));
    if (scenario === "full-retry") flow.push(...set("$c005", 1), ...launch("dome"), `CheckEvent ${group}`, "ld a, 0", "jr z, .unclaimed", "inc a", ".unclaimed", "ld [$c007], a", ...set("$c005", 0));
    if (scenario.startsWith("abort") || scenario.startsWith("reload")) {
      flow.push(...launch("dome", 0, false), "call UntilGift", `call ${models.dome.prefix}Abort`);
      if (scenario.startsWith("reload")) flow.push(`ResetEvent ${models.dome.scene!.giftFlag}`); // Persistent group identity survives losing the temporary checkpoint.
      flow.push(...launch("helix"));
      if (scenario.endsWith("resume") || scenario.endsWith("same")) flow.push(...launch("dome"));
    } else if (!["automatic-disabled", "automatic-not-selected"].includes(scenario)) flow.push(...launch(selected, /[0-2]$/.test(scenario) ? Number(scenario.slice(-1)) : 0));
    if (/^(dome|helix)[0-2]$/.test(scenario)) flow.push(...launch(helix ? "dome" : "helix")); // Force a sibling attempt even though both sprites are now hidden.
    if (scenario === "guardian-win") flow.push(...launch("guardian", 1));
    if (/^(dome|helix)[0-2]$/.test(scenario)) flow.push(
      ...set("wXCoord", helix ? 6 : 8), ...set("wYCoord", helix ? 5 : 6), ...set("$c008", 0),
      `call ${models.guardian.label} + 1`, "call Frames",
    ); // Talk after the route without resetting the guardian to its original tile.
    const asm = ['INCLUDE "macros/const.asm"', 'INCLUDE "macros/code.asm"', ...defs, events, macros, 'SECTION "Header", ROM0[$100]', "jp Entry", "ds $150 - @, 0", 'SECTION "Code", ROM0[$150]', "Entry:", ...flow, "ProbeDone:", "halt", "jr ProbeDone", nativeTable, code, ...stubs].join("\n");
    const file = join(temporary, "choices.asm"), obj = join(temporary, "choices.o"), rom = join(temporary, "choices.gb"), sym = join(temporary, "choices.sym");
    const checks = [`c000=${success ? 1 : 0}`, `c001=${success ? constants.get(helix ? "HELIX_FOSSIL" : "DOME_FOSSIL")!.toString(16) : 0}`, `c002=${scenario.startsWith("guardian") || scenario === "automatic-win" ? 1 : 0}`, `${vars.get("wEditorSceneActive")!.toString(16)}=0`, `${vars.get("wJoyIgnore")!.toString(16)}=12`];
    if (scenario === "full-retry") checks.push("c007=0");
    if (/^(dome|helix)[0-2]$/.test(scenario)) checks.push("c008=1");
    const bytes = new Map<number, number>();
    for (const [name, enabled] of [[won, ! ["locked", "guardian-loss", "automatic-not-selected"].includes(scenario)], [group, success], [domeFlag, success && !helix], [helixFlag, success && helix], ...plans[1].visibility.map(entry => [entry.flag, complete])] as Array<[string, boolean]>) {
      const bit = flagValue(name), address = 0xc800 + Math.floor(bit / 8);
      bytes.set(address, (bytes.get(address) ?? 0) | (enabled ? 1 << bit % 8 : 0));
    }
    // Other live checkpoint bits may share a byte; inspect only the selected bits.
    const flagChecks = [...bytes].map(([address, expected], i) => ({ address, expected, slot: 0xc020 + i }));
    const masks = new Map<number, number>();
    for (const name of [won, group, domeFlag, helixFlag, ...plans[1].visibility.map(entry => entry.flag)]) { const bit = flagValue(name), a = 0xc800 + Math.floor(bit / 8); masks.set(a, (masks.get(a) ?? 0) | 1 << bit % 8); }
    const inspected = asm.replace("ProbeDone:\n", flagChecks.flatMap(({ address, slot }) => [`ld a, [$${address.toString(16)}]`, `and ${masks.get(address)}`, `ld [$${slot.toString(16)}], a`]).join("\n") + "\nProbeDone:\n");
    await writeFile(file, inspected); run(join(rgbds, "rgbasm"), ["-I", `${root}/`, "-o", obj, file]); run(join(rgbds, "rgblink"), ["-n", sym, "-o", rom, obj]); run(join(rgbds, "rgbfix"), ["-v", "-p", "0", rom]);
    const endpoint = (await readFile(sym, "utf8")).match(/^00:([0-9a-f]+) ProbeDone$/mi)![1];
    flagChecks.forEach(({ expected, slot }) => checks.push(`${slot.toString(16)}=${expected.toString(16)}`));
    run(cpu, [rom, endpoint, ...checks]); count++;
  }
  assert.equal(count, 18);
  console.log(`${root}: ${count} linked-choice CPU probes passed: six approaches, battle gate/win/loss, No, full-bag retry, both rewards, sibling exclusion, interruption, reload and same-choice resumption`);
}
