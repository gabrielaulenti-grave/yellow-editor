import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { InteractionDocument, ManagedInteraction } from "../src/core/scriptInteractions";

export async function populationCpuProbes(root: string, rgbds: string, binjgb: string, run: (cmd: string, args: string[], cwd?: string) => string, doc: InteractionDocument) {
  const script = await readFile(join(root, doc.path), "utf8"), model = JSON.parse(script.match(/; yellow-editor-interaction: (.+)/)![1]) as ManagedInteraction;
  assert.ok(model.flag && model.visibilityRule);
  const code = script.slice(script.indexOf(`${doc.label}:`)).replace("\ttext_asm", "");
  const engine = await readFile(join(root, "engine/overworld/toggleable_objects.asm"), "utf8");
  const predicate = `${model.prefix}VisibilityCondition`;
  const condition = engine.match(new RegExp(`^${predicate}::\\n([\\s\\S]*?)^POPS`, "m"))![1];
  const inventory = await readFile(join(root, "engine/items/inventory.asm"), "utf8");
  const extract = (text: string, name: string) => `${name}:\n` + text.match(new RegExp(`^${name}:{1,2}\\r?\\n([\\s\\S]*?)(?=^[A-Za-z_]\\w*:{1,2}|$(?![\\s\\S]))`, "m"))![1];
  const give = extract(await readFile(join(root, "home/give.asm"), "utf8"), "GiveItem");
  const defs = { SFX_Get_Item1_1: 0, SFX_Headers_1: 0, wNumBagItems: 0xc200, wBagItems: 0xc201, wNumBoxItems: 0xc280, wWhichPokemon: 0xc400, wItemQuantity: 0xc401, wMaxItemQuantity: 0xc402, wListScrollOffset: 0xc403, wCurrentMenuItem: 0xc404, wBagSavedMenuItem: 0xc405, wSavedListScrollOffset: 0xc406, wListCount: 0xc407, wMaxMenuItem: 0xc408, wCurItem: 0xc409, wNamedObjectIndex: 0xc40a, wDoNotWaitForButtonPressAfterDisplayingText: 0xc40b, wEventFlags: 0xc900, hIsToggleableObjectOff: 0xff82 };
  const set = (address: string, value: string | number) => [`ld a, ${value}`, `ld [${address}], a`];
  const output: string[] = [], expected: string[] = [];
  function observe(address: string, slot: number, value: number) { output.push(`ld a, [${address}]`, `ld [$${slot.toString(16)}], a`); expected.push(`${slot.toString(16)}=${value.toString(16)}`); }
  const claim = (doc.values.visibleWhen as { event: string }).event;
  const driver = [...set("wNumBagItems", 20), ...Array.from({ length: 20 }, (_, i) => [...set(`wBagItems + ${i * 2}`, "ULTRA_BALL"), ...set(`wBagItems + ${i * 2 + 1}`, 1)]).flat(), ...set("wBagItems + 40", 255), `call ${doc.label}`];
  observe("wNumBagItems", 0xc000, 20); observe("$c40c", 0xc001, 0);
  output.push(`CheckEvent ${claim}`, "ld a, 0", "jr z, .notClaimed", "inc a", ".notClaimed", "ld [$c002], a"); expected.push("c002=0");
  // Free the bag, collect the item, and then try the same text ID again.
  output.push(...set("wNumBagItems", 0), ...set("wBagItems", 255), `call ${doc.label}`);
  observe("wNumBagItems", 0xc003, 1); observe("wBagItems", 0xc004, 0x28); observe("wBagItems + 1", 0xc005, 2); observe("hIsToggleableObjectOff", 0xc006, 1); observe("$c40c", 0xc007, 1);
  output.push(`call ${doc.label}`); observe("wBagItems + 1", 0xc008, 2); observe("$c40c", 0xc009, 1);
  // Simulate reloading map scratch state while keeping the save's event array.
  output.push(...set("hIsToggleableObjectOff", 0), `call ${predicate}`); observe("hIsToggleableObjectOff", 0xc00a, 1);
  const asm = ['INCLUDE "includes.asm"', ...Object.entries(defs).map(([key, value]) => `DEF ${key} EQU $${value.toString(16)}`), 'SECTION "Header", ROM0[$100]', "jp Entry", "ds $150 - @, 0", 'SECTION "Code", ROM0[$150]', "Entry:", "di", "ld sp, $dfff", "ld hl, $c000", "ld bc, $1000", ".clear", "xor a", "ld [hli], a", "dec bc", "ld a, b", "or c", "jr nz, .clear", ...driver, ...output, "ProbeDone:", "halt", "jr ProbeDone", code, `${predicate}:`, condition, give, inventory,
    "UpdateSprites:", "ld hl, $c40c", "inc [hl]", `jp ${predicate}`, "AddItemToInventory:", "jp AddItemToInventory_", "RemoveItemFromInventory:", "jp RemoveItemFromInventory_", "TextScriptEnd:", "GetItemName:", "CopyToStringBuffer:", "PrintText:", "PlaySound:", "WaitForSoundToFinish:", "ret"].join("\n");
  const file = join(root, "population-probe.asm"), obj = join(root, "population-probe.o"), rom = join(root, "population-probe.gb"), sym = join(root, "population-probe.sym"), cpu = join(root, "population-cpu");
  await writeFile(file, asm);
  run("cc", ["-std=gnu11", "-O2", `-I${join(binjgb, "src")}`, resolve("tests/scriptRuntimeProbe.c"), ...["memory.c", "common.c", "emulator-debug.c"].map(f => join(binjgb, "src", f)), "-lm", "-o", cpu]);
  run(join(rgbds, "rgbasm"), ["-I", `${root}/`, "-o", obj, file]); run(join(rgbds, "rgblink"), ["-n", sym, "-o", rom, obj]); run(join(rgbds, "rgbfix"), ["-v", "-p", "0", rom]);
  const stop = (await readFile(sym, "utf8")).match(/^00:([0-9a-f]+) ProbeDone$/mi)![1]; run(cpu, [rom, stop, ...expected]);
}
