import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { NativeMapObjectDocument } from "../src/core/nativeMapObjects";

// Real native pickup/inventory/visibility and trainer flag/battle setup routines.
// Rendering, audio and sprite drawing are instrumented; this is a CPU probe,
// not a controller-driven battle or a battery-file save/Continue test.
export async function nativeMapObjectCpuProbes(root: string, rgbds: string, binjgb: string, run: (cmd: string, args: string[]) => string, trainer: NativeMapObjectDocument, pickup: NativeMapObjectDocument) {
  const extract = (text: string, name: string) => `${name}:\n` + text.match(new RegExp(`^${name}:{1,2}\\r?\\n([\\s\\S]*?)(?=^[A-Za-z_]\\w*:{1,2}|$(?![\\s\\S]))`, "m"))![1];
  const native = await readFile(join(root, "home/trainers.asm"), "utf8"), toggle = await readFile(join(root, "engine/overworld/toggleable_objects.asm"), "utf8");
  const trainerCode = ["StoreTrainerHeaderPointer", "ReadTrainerHeaderInfo", "TalkToTrainer", "StartTrainerBattle", "EndTrainerBattle", "ResetButtonPressedAndMapScript", "InitBattleEnemyParameters", "EngageMapTrainer", "SaveEndBattleTextPointers"].map(name => extract(native, name)).join("\n").replace("predef HideObject", "call HideObject");
  const pickupSource = await readFile(join(root, "engine/events/pick_up_item.asm"), "utf8");
  const pickupCode = pickupSource.slice(pickupSource.indexOf("PickUpItem:"), pickupSource.indexOf("FoundItemText:")).replace("predef HideObject", "call HideObject");
  const defs = { wNumBagItems: 0xc200, wBagItems: 0xc201, wNumBoxItems: 0xc280, wWhichPokemon: 0xc400, wItemQuantity: 0xc401, wMaxItemQuantity: 0xc402, wListScrollOffset: 0xc403, wCurrentMenuItem: 0xc404, wBagSavedMenuItem: 0xc405, wSavedListScrollOffset: 0xc406, wListCount: 0xc407, wMaxMenuItem: 0xc408, wCurItem: 0xc409, wNamedObjectIndex: 0xc40a, wDoNotWaitForButtonPressAfterDisplayingText: 0xc40b, wTrainerHeaderPtr: 0xc500, wTrainerHeaderFlagBit: 0xc502, wStatusFlags7: 0xc503, wCurMapScript: 0xc504, wCurrentMapScriptFlags: 0xc505, wStatusFlags3: 0xc506, wMiscFlags: 0xc507, wIsInBattle: 0xc508, wEnemyMonOrTrainerClass: 0xc509, wStatusFlags5: 0xc50a, wJoyIgnore: 0xc50b, wSpriteIndex: 0xc510, wCurOpponent: 0xc511, wTrainerNo: 0xc512, wEngagedTrainerClass: 0xc513, wEngagedTrainerSet: 0xc514, wCurEnemyLevel: 0xc515, wStatusFlags4: 0xc518, wEndBattleTextRomBank: 0xc520, wEndBattleWinTextPointer: 0xc521, wEndBattleLoseTextPointer: 0xc523, wToggleableObjectIndex: 0xc530, wMapSpriteExtraData: 0xc600, wToggleableObjectList: 0xc700, wEventFlags: 0xc800, wToggleableObjectFlags: 0xca00, hJoyHeld: 0xff80, hJoyPressed: 0xff81, hJoyReleased: 0xff82, hSpriteIndex: 0xff83, hLoadedROMBank: 0xff84, hCurrentSpriteOffset: 0xff85, hIsToggleableObjectOff: 0xff86, hToggleableObjectIndex: 0xff87 };
  const driver: string[] = [], expected: string[] = [];
  const set = (name: string, value: number | string) => driver.push(`ld a, ${value}`, `ld [${name}], a`);
  const observe = (name: string, out: number, value: number | string) => { driver.push(`ld a, [${name}]`, `ld [$${out.toString(16)}], a`); expected.push(`${out.toString(16)}=${typeof value === "number" ? value.toString(16) : value}`); };
  const flag = (out: number, value: number) => { driver.push(`CheckEvent ${trainer.event}`, "ld a, 0", `jr z, .flag${out}`, "inc a", `.flag${out}`, `ld [$${out.toString(16)}], a`); expected.push(`${out.toString(16)}=${value}`); };
  const [cls, party] = trainer.values.partyId!.split(":");
  set("wSpriteIndex", trainer.objectId); set(`wMapSpriteExtraData + ${(trainer.objectId - 1) * 2}`, `OPP_${cls}`); set(`wMapSpriteExtraData + ${(trainer.objectId - 1) * 2 + 1}`, party);
  driver.push("ld hl, ProbeHeader", "call TalkToTrainer"); observe("$c010", 0xc000, 1); observe("wTrainerNo", 0xc001, +party); observe("wCurMapScript", 0xc002, 2); flag(0xc003, 0);
  set("wIsInBattle", "LOST_BATTLE"); driver.push("call EndTrainerBattle"); flag(0xc004, 0);
  driver.push("ld hl, ProbeHeader", "call TalkToTrainer"); observe("$c010", 0xc005, 1);
  set("wIsInBattle", 0); driver.push("call EndTrainerBattle"); flag(0xc006, 1);
  set("wTrainerHeaderPtr", 0); set("wTrainerHeaderPtr + 1", 0); driver.push("ld hl, ProbeHeader", "call TalkToTrainer"); observe("$c010", 0xc007, 3); observe("wCurMapScript", 0xc008, 0);
  set("wToggleableObjectList", pickup.objectId); set("wToggleableObjectList + 1", 5); set("wToggleableObjectList + 2", 255); set(`wMapSpriteExtraData + ${(pickup.objectId - 1) * 2}`, pickup.values.item!); set("hSpriteIndex", pickup.objectId); set("hCurrentSpriteOffset", pickup.objectId * 16);
  set("wNumBagItems", 20);
  for (let i = 0; i < 20; i++) { set(`wBagItems + ${i * 2}`, "ULTRA_BALL"); set(`wBagItems + ${i * 2 + 1}`, 1); }
  set("wBagItems + 40", 255); driver.push("call PickUpItem"); observe("wNumBagItems", 0xc009, 20); observe("wToggleableObjectFlags", 0xc00a, 0);
  set("wNumBagItems", 0); set("wBagItems", 255); driver.push("call PickUpItem"); observe("wNumBagItems", 0xc00b, 1); observe("wBagItems + 1", 0xc00c, 1); observe("wToggleableObjectFlags", 0xc00d, 32);
  set("hIsToggleableObjectOff", 0); set("wToggleableObjectIndex", 0); driver.push("call IsObjectHidden"); observe("hIsToggleableObjectOff", 0xc00e, 32);
  const inventory = await readFile(join(root, "engine/items/inventory.asm"), "utf8");
  const asm = ['INCLUDE "includes.asm"', ...Object.entries(defs).map(([k, v]) => `DEF ${k} EQU $${v.toString(16)}`), 'SECTION "Header", ROM0[$100]', 'jp Entry', 'ds $150 - @, 0', 'SECTION "Code", ROM0[$150]', 'Entry:', 'di', 'ld sp, $dfff', 'ld hl, $c000', 'ld bc, $1000', '.clear', 'xor a', 'ld [hli], a', 'dec bc', 'ld a, b', 'or c', 'jr nz, .clear', ...driver, 'ProbeDone:', 'halt', 'jr ProbeDone', 'ProbeHeader:', `def_trainers ${trainer.objectId}`, `trainer ${trainer.event}, ${trainer.values.sight}, ProbeBefore, ProbeDefeat, ProbeAfter`, 'ProbeBefore: db 1', 'ProbeDefeat: db 2', 'ProbeAfter: db 3', trainerCode, pickupCode, extract(toggle, "HideObject"), extract(toggle, "ToggleableObjectFlagAction"), extract(toggle, "IsObjectHidden"), extract(await readFile(join(root, "home/give.asm"), "utf8"), "GiveItem"), inventory, 'TrainerFlagAction: jp ToggleableObjectFlagAction', 'AddItemToInventory: jp AddItemToInventory_', 'RemoveItemFromInventory: jp RemoveItemFromInventory_', 'PrintText:', 'ld a, [hl]', 'ld [$c010], a', 'ret', 'EnableAutoTextBoxDrawing:', 'UpdateSprites:', 'GetItemName:', 'CopyToStringBuffer:', 'PlayTrainerMusic:', 'IsInArray:', 'ret', 'FoundItemText: db 4', 'NoMoreRoomForItemText: db 5'].join("\n");
  const file = join(root, "native-object-probe.asm"), obj = join(root, "native-object-probe.o"), rom = join(root, "native-object-probe.gb"), sym = join(root, "native-object-probe.sym"), cpu = join(root, "native-object-cpu");
  await writeFile(file, asm); run("cc", ["-std=gnu11", "-O2", `-I${join(binjgb, "src")}`, resolve("tests/scriptRuntimeProbe.c"), ...["memory.c", "common.c", "emulator-debug.c"].map(f => join(binjgb, "src", f)), "-lm", "-o", cpu]);
  run(join(rgbds, "rgbasm"), ["-I", `${root}/`, "-o", obj, file]); run(join(rgbds, "rgblink"), ["-n", sym, "-o", rom, obj]); run(join(rgbds, "rgbfix"), ["-v", "-p", "0", rom]);
  const stop = (await readFile(sym, "utf8")).match(/^00:([0-9a-f]+) ProbeDone$/mi)![1]; run(cpu, [rom, stop, ...expected]);
  console.log("Native object CPU probes passed: party selection, loss/victory flags, post-battle dialogue, bag-full pickup, quantity and persistent visibility.");
}
