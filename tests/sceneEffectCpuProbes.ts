import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { projectConstantCatalogFromSources } from "../src/core/projectConstants";
import { renderScene } from "../src/core/interactionScene";
import { sequenceDialogue } from "../src/core/interactionSequence";
import type { ManagedInteraction } from "../src/core/scriptInteractions";

// Execute generated scenes with native NewBattle/control gates, AnyPartyAlive,
// full ClearVariablesOnEnterMap/FillMemory, music wrappers and palette fades.
// The battle/menu/inventory boundaries are instrumented; this does not replay
// turns, capture RNG or the blackout destination UI.
export async function sceneEffectCpuProbes(root: string, temporary: string, rgbds: string, cpu: string,
  run: (cmd: string, args: string[], cwd?: string) => string, model: ManagedInteraction, symbolsText: string, variants?: { persistent: ManagedInteraction; automaticFade: ManagedInteraction }) {
  const p = model.prefix, plan = model.scene!, yellow = plan.follower;
  const actor = plan.actors.find(actor => plan.nodes.some(node => node.npc === actor.constant))!;
  const read = (path: string) => readFile(join(root, path), "utf8");
  const extract = (source: string, first: string, last?: string) => {
    const at = source.indexOf(first), end = last ? source.indexOf(last, at + first.length) : source.length;
    assert.ok(at >= 0 && end > at, first); return source.slice(at, end);
  };
  const physical = new Map([...symbolsText.matchAll(/^([0-9a-f]+):([0-9a-f]+) (\S+)$/gm)].map(match => [match[3], { bank: parseInt(match[1], 16), address: parseInt(match[2], 16) }]));
  const variables = [...physical].filter(([name]) => /^[wh][A-Z]\w*$/.test(name));
  const defs = variables.map(([name, value]) => `DEF ${name} EQU $${value.address.toString(16)}`);
  const files = await Promise.all((await readdir(join(root, "constants"))).filter(path => path.endsWith(".asm")).map(async path => ({ path: `constants/${path}`, contents: await read(`constants/${path}`) })));
  const constants = new Map(projectConstantCatalogFromSources(files).constants.map(entry => [entry.symbol, entry.value]));
  [...(await read("constants/map_constants.asm")).matchAll(/^\s*map_const\s+(\w+),/gm)].forEach((match, index) => constants.set(match[1], index));
  constants.set(plan.mapConstant, 0); constants.set(actor.constant, actor.id);
  constants.set("SAFARI_ZONE_EAST", 200); constants.set("SAFARI_ZONE_CENTER_REST_HOUSE", 205);
  constants.set("PALLET_TOWN", 1); constants.set("OPP_YOUNGSTER", 201); constants.set("SFX_GET_ITEM_1", 1);
  constants.set("SCREEN_HEIGHT_PX", 144);
  constants.set("PARTYMON_STRUCT_LENGTH", physical.get("wPartyMon2HP")!.address - physical.get("wPartyMon1HP")!.address);
  const source = renderScene(model).split(`; yellow-editor-interaction-code-end ${model.label}`)[0]
    .replaceAll("\ttext_asm", "\tdb 8").replaceAll("\ttext_promptbutton", "\tdb 0").replaceAll("\ttext_end", "\tdb 0")
    .replaceAll("\tpredef ", "\tcall ").replaceAll("\tfarcall ", "\tcall ");
  const entry = (await read("engine/overworld/clear_variables.asm")).replaceAll("\tfarcall ", "\tcall ");
  const overworld = await read("home/overworld.asm"), audio = await read("home/audio.asm");
  const native = [
    extract(overworld, "NewBattle::", "; function to make bikes twice as fast as walking").replace("farjp InitBattle", "jp InitBattle"),
    extract(await read("home/npc_movement.asm"), "IsPlayerCharacterBeingControlledByGame::", "RunNPCMovementScript::"),
    extract(await read("engine/battle/core.asm"), "AnyPartyAlive::", "HasMonFainted:"),
    extract(await read(yellow ? "home/copy2.asm" : "home/tilemap.asm"), "FillMemory::", yellow ? "GetFarByte::" : "UncompressSpriteFromDE::"),
    await read("home/fade.asm"), entry,
    extract(audio, "PlayDefaultMusic::", "UpdateMusic6Times::"), extract(audio, "CompareMapMusicBankWithCurrentBank::", "PlayMusic::"),
  ].join("\n");
  const playMusic = extract(audio, "PlayMusic::", yellow ? "Func_2223::" : "; plays music specified");
  // Keep BANK(header) as a real linker expression, in a distinct test ROM bank.
  const musicConstants = await read("constants/music_constants.asm");
  const headerBase = physical.get("SFX_Headers_1")!.address;
  for (const match of musicConstants.matchAll(/^\s*music_const\s+(MUSIC_\w+),\s*(\w+)/gm)) {
    const symbol = physical.get(match[2]);
    if (symbol) constants.set(match[1], Math.trunc((symbol.address - headerBase) / 3));
  }
  const runtime = extract(await read("engine/overworld/toggleable_objects.asm"), "; yellow-editor-scene-runtime: 1");
  const all = source + native + playMusic + runtime;
  const caps = new Set([...all.matchAll(/\b[A-Z][A-Z0-9_]+\b/g)].map(match => match[0]));
  for (const name of caps) if (constants.has(name) && !name.startsWith("EVENT_") && !name.startsWith("TEXT_")) defs.push(`DEF ${name} EQU ${constants.get(name)}`);
  defs.push("DEF rBGP EQU $ff47", "DEF rOBP0 EQU $ff48", "DEF rOBP1 EQU $ff49", "DEF rWY EQU $ff4a");
  plan.textNodes.forEach((_, i) => defs.push(`DEF TEXT_${p.toUpperCase()}_SCENE_${i} EQU ${i + 1}`));
  const events = await read("constants/event_constants.asm");
  const eventNumber = (name: string) => parseInt(events.match(new RegExp(`DEF ${name} EQU \\$([a-f0-9]+)`))![1], 16);
  const eventCheck = (name: string, set: boolean) => {
    const value = eventNumber(name), address = physical.get("wEventFlags")!.address + Math.floor(value / 8);
    return { address, mask: 1 << value % 8, set };
  };
  const set = (name: string, value: number) => [`ld a, ${value}`, `ld [${name}], a`];
  const check = (name: string, value: number) => `${physical.get(name)!.address.toString(16)}=${value.toString(16)}`;
  const field = (id: number, suffix: string) => `wSprite${String(id).padStart(2, "0")}${suffix}`;
  const nativeTable = (await read("home/array2.asm")).split("IsInArray::")[0];
  const text = sequenceDialogue(model.values.actions!).flatMap(block => [`${p}${block.key}Text:`, `db ${block.lines[0] === "Caught!" ? 3 : block.lines[0] === "Escaped!" ? 2 : block.lines[0] === "You won!" ? 4 : 1}`]);
  const scenarios = ["defeated", "caught-party", "caught-box", "escaped", "enemy-fled", "lost", "trainer", "trainer-lost", "retry-after-full-bag", "no-party", "fainted-party", ...(yellow ? ["pikachu-blocker"] : []), "wrong-map", ...(variants ? ["persistent-music", "persist-no-party", "automatic-screen-restore"] : [])];
  for (const scenario of scenarios) {
    const trainer = scenario.startsWith("trainer"), lost = scenario.endsWith("lost"), caught = scenario.startsWith("caught") || scenario === "retry-after-full-bag";
    const starts = !["no-party", "persist-no-party", "fainted-party", "pikachu-blocker"].includes(scenario), complete = starts && !lost && !["escaped", "enemy-fled", "wrong-map"].includes(scenario);
    const setup = ["di", "ld sp, $dfff", "ld hl, $c000", "ld bc, $2000", ".clear", "xor a", "ld [hli], a", "dec bc", "ld a, b", "or c", "jr nz, .clear",
      ...set("wXCoord", model.values.scene!.playerX), ...set("wYCoord", model.values.scene!.playerY), ...set("wCurMap", 0), ...set("wJoyIgnore", 0x12), ...set("wOverrideSimulatedJoypadStatesMask", 0x34), ...set("wStatusFlags4", 0),
      ...set("wPartyCount", scenario.endsWith("no-party") ? 0 : scenario === "caught-box" ? 6 : 1), ...set("wPartyMon1HP", scenario === "fainted-party" ? 0 : 10), ...set("wBoxCount", 2),
      ...set("wMapPalOffset", 6), ...set("wAudioROMBank", 6), ...set("wMapMusicROMBank", 6), ...set("wMapMusicSoundID", 3), ...set("$c003", trainer ? 1 : 0)];
    if (plan.stateVariable) setup.push(...set(plan.stateVariable, model.values.scene!.idleState));
    for (const a of plan.actors) setup.push(...set(field(a.id, "StateData2MapX"), a.x + 4), ...set(field(a.id, "StateData2MapY"), a.y + 4), ...set(field(a.id, "StateData1PictureID"), 1));
    if (scenario === "pikachu-blocker") setup.push(...set("wSpritePikachuStateData1PictureID", 1), ...set("wSpritePikachuStateData2MapX", actor.x + 3), ...set("wSpritePikachuStateData2MapY", actor.y + 4));
    // A failed reward after capture must permit retry without a second battle.
    const retry = scenario === "retry-after-full-bag" ? [
      ...set("$c020", 1), ...set(field(actor.id, "StateData2MapX"), actor.x + 4), ...set(field(actor.id, "StateData2MapY"), actor.y + 4),
      ...set("wXCoord", model.values.scene!.playerX + 1), `call ${p}SceneFrame`, ...set("wXCoord", model.values.scene!.playerX), "call RunFrames",
    ] : [];
    const stubs = [
      "PlaySound:", "ld [$c013], a", "ld a, [wAudioROMBank]", "ld [$c014], a", "ld hl, $c01b", "inc [hl]", "ret",
      "DisplayTextID:", "ldh a, [hTextID]", "dec a", "ld hl, ProbeTextPointers", "call CallFunctionInTable", "ret", "ProbeTextPointers:", ...plan.textNodes.map((_, i) => `dw ${p}SceneText${i} + 1`),
      "PrintText:", "ld a, [hl]", "ld [$c009], a", "ret", "YesNoChoice:", "ld a, [$c003]", "ld [wCurrentMenuItem], a", "ret",
      "MoveSprite:", `ld hl, ${field(actor.id, "StateData2MapX")}`, "dec [hl]", "ld a, 2", "ld [$c004], a", "ld hl, wStatusFlags5", "set BIT_SCRIPTED_NPC_MOVEMENT, [hl]", "ret",
      "GiveItem:", "ld hl, $c00a", "inc [hl]", ...(scenario === "retry-after-full-bag" ? ["ld a, [$c020]", "and a", "ret z"] : []), "ld hl, $c00b", "inc [hl]", "scf", "ret",
      "IsObjectHidden:", "call EditorSceneObjectHidden", "ret c", "xor a", "ldh [hIsToggleableObjectOff], a", "ret",
      "UpdateSprites:", "PlayCry:", "WaitForSoundToFinish:", "UpdateCGBPal_BGP:", "UpdateCGBPal_OBP0:", "UpdateCGBPal_OBP1:", "TextScriptEnd:", "ret",
      "DelayFrames:", "ld a, c", "cp 8", "jr nz, .hold", "ld hl, $c00c", "inc [hl]", "ret", ".hold", "cp 3", "ret nz", "call LoadGBPal", "ldh a, [rBGP]", "cp $ff", "ret z", "ld hl, $c006", "inc [hl]", "ret",
      "RunFrames:", "ld b, 70", ".frames", "push bc", "call LoadGBPal", "ld a, [wCurMap]", "and a", "jr nz, .skipScene", `call ${p}SceneFrame`, ".skipScene", "ld a, [$c004]", "and a", "jr z, .battle", "dec a", "ld [$c004], a", "jr nz, .battle", "ld hl, wStatusFlags5", "res BIT_SCRIPTED_NPC_MOVEMENT, [hl]", ".battle", "ld a, [wEditorSceneBattle]", "cp 1", "call z, NewBattle", "pop bc", "dec b", "jr nz, .frames", "ret",
      "InitBattle:", "ld hl, $c000", "inc [hl]", "ld a, [wJoyIgnore]", "ld [$c00d], a", "ld a, [wCurOpponent]", "ld [$c010], a", "ld a, [wCurEnemyLevel]", "ld [$c011], a", "ld a, [wTrainerNo]", "ld [$c012], a",
      "xor a", "ld [wCurOpponent], a", "ld [wIsInBattle], a", ...set("wBattleResult", lost ? 1 : caught || scenario === "escaped" ? 2 : 0), ...set("wTrainerClass", trainer ? 1 : 0), ...set("wEnemyMonHP", scenario === "enemy-fled" ? 10 : 0),
      ...(caught ? [scenario === "caught-box" ? "ld hl, wBoxCount" : "ld hl, wPartyCount", "inc [hl]"] : []),
      ...(lost ? [...set("wIsInBattle", 255), `call ${p}SceneFrame`, ...set("wIsInBattle", 0), ...set("wXCoord", model.values.scene!.playerX + 2)] : []),
      // Map reload recreates objects. Its entry hook must restore staging before
      // the first post-battle sprite draw, and preserve the coordinate latch.
      ...set(field(actor.id, "StateData2MapX"), actor.x + 4), ...set(field(actor.id, "StateData2MapY"), actor.y + 4),
      ...(scenario === "wrong-map" ? [...set("wCurMap", 99)] : []), "call PlayDefaultMusic", "call ClearVariablesOnEnterMap", "ld a, [wEditorSceneActive]", "ld [$c018], a", `ld a, [${field(actor.id, "StateData2MapX")}]`, "ld [$c019], a", "scf", "ret",
      ...["Original", "AlreadyText", "BagFullText"].map(suffix => `${p}${suffix}:\ndb 0`), ...text,
    ];
    const headers = [...new Set([...plan.effects!.music.map(track => track.header), "Music_BikeRiding"])].flatMap((header, i) => [`SECTION "Track${i}", ROMX, BANK[5]`, `${header}:`, "db 0"]);
    const variant = scenario === "persistent-music" || scenario === "persist-no-party" ? variants?.persistent : scenario === "automatic-screen-restore" ? variants?.automaticFade : undefined;
    const variantCode = variant ? renderScene(variant).split(`; yellow-editor-interaction-code-end ${model.label}`)[0].replaceAll("\ttext_asm", "\tdb 8").replaceAll("\ttext_promptbutton", "\tdb 0").replaceAll("\ttext_end", "\tdb 0").replaceAll("\tpredef ", "\tcall ").replaceAll("\tfarcall ", "\tcall ") : source;
    const asm = ['INCLUDE "macros/const.asm"', 'INCLUDE "macros/code.asm"', 'INCLUDE "macros/data.asm"', ...defs, events, await read("macros/scripts/events.asm"),
      'SECTION "Header", ROM0[$100]', "jp Entry", "ds $150 - @, 0", 'SECTION "Code", ROM0[$150]', "Entry:", ...setup, "call RunFrames", ...retry, "ProbeDone:", "halt", "jr ProbeDone", nativeTable, variantCode, runtime, native, playMusic, ...stubs, ...headers].join("\n");
    const file = join(temporary, "effects-probe.asm"), obj = join(temporary, "effects-probe.o"), rom = join(temporary, "effects-probe.gb"), sym = join(temporary, "effects-probe.sym");
    await writeFile(file, asm); run(join(rgbds, "rgbasm"), ["-I", `${root}/`, "-o", obj, file]); run(join(rgbds, "rgblink"), ["-n", sym, "-o", rom, obj]); run(join(rgbds, "rgbfix"), ["-v", "-p", "0", rom]);
    const stop = (await readFile(sym, "utf8")).match(/^00:([0-9a-f]+) ProbeDone$/mi)![1];
    const checks = [`c000=${starts ? 1 : 0}`, "c006=0", `c00b=${complete ? 1 : 0}`, `c00c=${complete ? 8 : 0}`, "c00d=0",
      check("wEditorSceneActive", 0), check("wEditorSceneBattle", 0), check("wJoyIgnore", scenario === "wrong-map" ? 0 : 0x12), check("wMapPalOffset", 6), check("wEditorScenePalette", 0), check("wEditorSceneMusic", 0)];
    if (starts && !lost && scenario !== "wrong-map") checks.push(`c009=${trainer ? 4 : caught ? 3 : ["escaped", "enemy-fled"].includes(scenario) ? 2 : 1}`, "c018=1", `c019=${(actor.x + 3).toString(16)}`);
    if (starts) checks.push(`c010=${(trainer ? constants.get("OPP_YOUNGSTER")! : constants.get("MEWTWO")!).toString(16)}`, ...(trainer ? ["c012=1"] : ["c011=46"]));
    if (complete) checks.push(`c014=${scenario === "persistent-music" ? 5 : 6}`, "ff47=fe");
    const expectedFlags = new Map<number, number>();
    for (const name of [plan.latchFlag!, plan.giftFlag!, ...plan.visibility.map(entry => entry.flag), ...Object.values(plan.effects!.battles).flatMap(flags => [flags.won, ...(flags.caught ? [flags.caught] : [])])]) {
      const entry = eventCheck(name, false); expectedFlags.set(entry.address, 0);
    }
    for (const name of [plan.latchFlag!, ...(complete ? [plan.visibility.find(entry => entry.npc === actor.constant)!.flag] : [])]) {
      const flag = eventCheck(name, true); expectedFlags.set(flag.address, expectedFlags.get(flag.address)! | flag.mask);
    }
    // Entering an unrelated map rearms latches and cancels the pending scene.
    if (scenario === "wrong-map" || lost) { const flag = eventCheck(plan.latchFlag!, false); expectedFlags.set(flag.address, expectedFlags.get(flag.address)! & ~flag.mask); }
    expectedFlags.forEach((value, address) => checks.push(`${address.toString(16)}=${value.toString(16)}`));
    try { run(cpu, [rom, stop, ...checks]); } catch (error) { throw new Error(`Scene effect CPU scenario ${scenario}: ${String(error)}`); }
  }
  console.log(`Scene effects: ${scenarios.length} CPU probes passed (native music/fades, wild/trainer dispatch, capture/escape/loss, party/PC captures, map-entry staging, retry without duplicate capture, input and palette cleanup)`);
}
