import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { renderMapTrainers, trainerEntryHook, trainerBattleRuntime, type MapTrainerModel } from "../src/core/mapTrainerRuntime";

// Run the generated dispatcher with the real native trainer/flag routines.
// Text, engagement detection, walking and audio are instrumented here; the
// full-game regression separately exercises native sight, movement and battles.
export async function mapTrainerCpuProbes(root: string, rgbds: string, binjgb: string, model: MapTrainerModel, run: (cmd: string, args: string[]) => string) {
  const [first, second] = model.trainers, p = `${model.name}EditorTrainer`;
  const native = await readFile(join(root, "home/trainers.asm"), "utf8");
  const extract = (text: string, name: string) => `${name}:\n` + text.match(new RegExp(`^${name}:{1,2}\\r?\\n([\\s\\S]*?)(?=^[A-Za-z_]\\w*:{1,2}|$(?![\\s\\S]))`, "m"))![1];
  const originalWalk = extract(native, "TrainerWalkUpToPlayer_Bank0").replace("TrainerWalkUpToPlayer_Bank0:", "TrainerWalkUpToPlayer_Bank0::");
  let trainer = native.slice(0, native.indexOf("GetSpritePosition1::"));
  trainer = trainer.replace(originalWalk, "TrainerWalkUpToPlayer_Bank0::\n\tld hl, $c340\n\tinc [hl]\n\tret\n\n").replace("predef_jump FlagActionPredef", "jp FlagAction").replace("predef EmotionBubble", "call EmotionBubble").replace("predef HideObject", "call HideObject");
  const extra = extract(native, "EngageMapTrainer") + extract(native, "SaveEndBattleTextPointers");
  const array = extract(await readFile(join(root, "home/array2.asm"), "utf8"), "CallFunctionInTable");
  const flag = extract(await readFile(join(root, "engine/flag_action.asm"), "utf8"), "FlagAction");
  const defs = { wPartyCount: 0xc352, wStatusFlags4: 0xc328, wGymCityName: 0xc360, wGymLeaderName: 0xc370, wTrainerHeaderPtr: 0xc300, wTrainerHeaderFlagBit: 0xc302, wStatusFlags7: 0xc303, wCurMapScript: 0xc304, wCurrentMapScriptFlags: 0xc305, wStatusFlags3: 0xc306, wMiscFlags: 0xc307, wIsInBattle: 0xc308, wEnemyMonOrTrainerClass: 0xc309, wStatusFlags5: 0xc30a, wJoyIgnore: 0xc30b, wEditorMapTrainerMap: 0xc30c, wEditorMapTrainerState: 0xc30d, wEditorMapTrainerReturn: 0xc30e, wCurMap: 0xc30f, wSpriteIndex: 0xc310, wCurOpponent: 0xc311, wTrainerNo: 0xc312, wEngagedTrainerClass: 0xc313, wEngagedTrainerSet: 0xc314, wCurEnemyLevel: 0xc315, wEndBattleTextRomBank: 0xc320, wEndBattleWinTextPointer: 0xc321, wEndBattleLoseTextPointer: 0xc323, wEmotionBubbleSpriteIndex: 0xc326, wWhichEmotionBubble: 0xc327, wMapSpriteExtraData: 0xc400, wToggleableObjectList: 0xc500, wToggleableObjectIndex: 0xc501, wEventFlags: 0xc800, hJoyHeld: 0xff80, hJoyPressed: 0xff81, hJoyReleased: 0xff82, hSpriteIndex: 0xff83, hLoadedROMBank: 0xff84 };
  const driver: string[] = [], expected: string[] = [];
  const set = (name: string, value: string | number) => [`ld a, ${value}`, `ld [${name}], a`];
  const observe = (name: string, out: number, value: number) => { driver.push(`ld a, [${name}]`, `ld [$${out.toString(16)}], a`); expected.push(`${out.toString(16)}=${value.toString(16)}`); };
  const event = (name: string, out: number, value: number) => { driver.push(`CheckEvent ${name}`, "ld a, 0", `jr z, .event${out}`, "inc a", `.event${out}`, `ld [$${out.toString(16)}], a`); expected.push(`${out.toString(16)}=${value}`); };
  function reset() { driver.push("call ResetState", ...set("wPartyCount", 1), ...set("$c351", 1), ...set("wCurMap", model.map), "call ProbeEnter");
    for (const t of model.trainers) { const [cls, party] = t.values.partyId.split(":"); driver.push(...set(`wMapSpriteExtraData + ${(t.id - 1) * 2}`, `OPP_${cls}`), ...set(`wMapSpriteExtraData + ${(t.id - 1) * 2 + 1}`, party)); } }
  // First trainer: native automatic approach -> challenge -> battle pending.
  reset(); driver.push(...set("$c341", first.id), `call ${p}Frame`); observe("wEditorMapTrainerState", 0xc000, 1); observe("$c340", 0xc001, 1);
  driver.push(`call ${p}Resume`); observe("wEditorMapTrainerState", 0xc002, 2); event(first.event, 0xc003, 0);
  driver.push(`call ${p}Resume`); event(first.event, 0xc004, 0); // Never mark victory before a real return.
  driver.push("call ProbeBattleReturn", "call ProbeEnter"); observe("wEditorMapTrainerState", 0xc005, 2); observe("wEditorMapTrainerReturn", 0xc006, 0x5a);
  driver.push(...set("wCurOpponent", 0), `call ${p}Resume`); event(first.event, 0xc007, 1); event(second.event, 0xc008, 0); observe("wEditorMapTrainerState", 0xc009, 0); observe("wJoyIgnore", 0xc00a, 0);
  // Second trainer: same modulo-eight bit, a different event pointer base.
  reset(); driver.push(`call ${p}Text${second.id}`); observe("wCurMapScript", 0xc00b, 2); event(second.event, 0xc00c, 0);
  driver.push("call ProbeBattleReturn", "call ProbeEnter", ...set("wCurOpponent", 0), `call ${p}Resume`); event(second.event, 0xc00d, 1); event(first.event, 0xc00e, 0);
  const flagsAfter = "ld hl, $c342\ninc [hl]\nld a, l\nld [$c343], a\nld a, h\nld [$c344], a\nret";
  driver.push(`call ${p}Text${second.id}`); observe("wCurOpponent", 0xc00f, 0); // Defeated trainer talks, never restarts.
  // Losing follows native cleanup without setting a flag, and allows retry.
  reset(); driver.push(`call ${p}Text${second.id}`, "call ProbeBattleReturn", ...set("wIsInBattle", "LOST_BATTLE"), `call ${p}Resume`); event(second.event, 0xc010, 0); observe("wEditorMapTrainerState", 0xc011, 0); observe("wJoyIgnore", 0xc012, 0);
  driver.push("call ProbeEnter", ...set("wIsInBattle", 0), `call ${p}Text${second.id}`); observe("wCurMapScript", 0xc013, 2);
  // An ordinary map load/reload clears pending runtime state, not saved flags.
  reset(); driver.push(`SetEvent ${first.event}`, ...set("wEditorMapTrainerState", 2), "call ProbeEnter"); observe("wEditorMapTrainerState", 0xc014, 0); event(first.event, 0xc015, 1);
  reset(); driver.push(...set("wPartyCount", 0), ...set("$c341", first.id), `call ${p}Frame`, `call ${p}Text${first.id}`); observe("wEditorMapTrainerState", 0xc016, 0); observe("wCurOpponent", 0xc017, 0);
  reset(); driver.push(...set("$c351", 0), ...set("$c341", first.id), `call ${p}Frame`, `call ${p}Text${first.id}`); observe("wEditorMapTrainerState", 0xc018, 0); observe("wCurOpponent", 0xc019, 0);
  const runtimeBody = trainerBattleRuntime.slice(trainerBattleRuntime.indexOf("EditorMapTrainerBattleReturn::") + "EditorMapTrainerBattleReturn::\n".length, trainerBattleRuntime.indexOf("POPS"));
  const asm = ['INCLUDE "includes.asm"', ...Object.entries(defs).map(([name, value]) => `DEF ${name} EQU $${value.toString(16)}`), ...model.trainers.map(t => `DEF ${t.object} EQU ${t.id}`), 'SECTION "Header", ROM0[$100]', "jp Entry", "ds $150 - @, 0", 'SECTION "Code", ROM0[$150]', "Entry:", "di", "ld sp, $dfff", "ld hl, $c000", "ld bc, $1000", ".clear", "xor a", "ld [hli], a", "dec bc", "ld a, b", "or c", "jr nz, .clear", ...driver, "ProbeDone:", "halt", "jr ProbeDone", renderMapTrainers(model).replaceAll("\ttext_asm", "").replaceAll("farcall AnyPartyAlive", "call AnyPartyAlive"), trainer, extra, array, flag, "ProbeEnter:", trainerEntryHook, "ret", "ProbeBattleReturn:", runtimeBody, "ResetState:", "ld hl, $c200", "ld bc, $a00", ".clear", "xor a", "ld [hli], a", "dec bc", "ld a, b", "or c", "jr nz, .clear", "ret",
    "CheckForEngagingTrainers:", "ld a, [$c341]", "and a", "jr z, .none", "ld [wSpriteIndex], a", "ld [wTrainerHeaderFlagBit], a", "ld hl, wMiscFlags", "set BIT_SEEN_BY_TRAINER, [hl]", "jp EngageMapTrainer", ".none", "ld a, $ff", "ld [wSpriteIndex], a", "ret", "DisplayTextID:", ...model.trainers.flatMap(t => ["ld a, [wSpriteIndex]", `cp ${t.id}`, `jp z, ${p}Text${t.id}`]), "ret", "PrintText:", flagsAfter, "AnyPartyAlive:", "ld a, [$c351]", "ld d, a", "ret", "CopyData:", "PlayTrainerMusic:", "EnableAutoTextBoxDrawing:", "EmotionBubble:", "TextScriptEnd:", "IsInArray:", "HideObject:", "ret"].join("\n");
  const file = join(root, "trainer-probe.asm"), obj = join(root, "trainer-probe.o"), rom = join(root, "trainer-probe.gb"), sym = join(root, "trainer-probe.sym"), cpu = join(root, "trainer-cpu");
  await writeFile(file, asm); run("cc", ["-std=gnu11", "-O2", `-I${join(binjgb, "src")}`, resolve("tests/scriptRuntimeProbe.c"), ...["memory.c", "common.c", "emulator-debug.c"].map(f => join(binjgb, "src", f)), "-lm", "-o", cpu]);
  run(join(rgbds, "rgbasm"), ["-I", `${root}/`, "-o", obj, file]); run(join(rgbds, "rgblink"), ["-n", sym, "-o", rom, obj]); run(join(rgbds, "rgbfix"), ["-v", "-p", "0", rom]);
  const stop = (await readFile(sym, "utf8")).match(/^00:([0-9a-f]+) ProbeDone$/mi)![1]; run(cpu, [rom, stop, ...expected]);
  assert.ok(expected.length > 20);
}
