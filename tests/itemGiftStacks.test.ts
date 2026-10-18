import assert from "node:assert/strict";
import { test } from "node:test";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { itemInventoryPath, prepareItemDeliveryWrites } from "../src/core/itemDelivery";
import { loadScriptInteractionDocument, prepareScriptInteractionWrites, prepareScriptRewardWrite } from "../src/core/scriptInteractions";
import type { ProjectSource } from "../src/core/types";

const args = process.argv.slice(2), at = args.indexOf("--rom");
const rgbds = at < 0 ? null : resolve(args[at + 1]), binjgb = at < 0 ? null : resolve(args[at + 2]);
if (at >= 0) args.splice(at, 3);
for (const directory of args) test(`${directory}: repeated item gifts`, async () => {
  const root = resolve(directory), overlay = new Map<string, string>();
  async function listFiles(folder = ""): Promise<string[]> {
    return (await Promise.all((await readdir(join(root, folder), { withFileTypes: true })).filter(entry => !entry.name.startsWith(".")).map(entry => entry.isDirectory() ? listFiles(join(folder, entry.name)) : [join(folder, entry.name)]))).flat();
  }
  const source: ProjectSource = { listFiles, readText: async path => overlay.get(path) ?? readFile(join(root, path), "utf8"), readBytes: async path => new Uint8Array(await readFile(join(root, path))), exists: async path => { try { await readFile(join(root, path)); return true; } catch { return false; } } };
  const original = await source.readText(itemInventoryPath), files = new Map([[itemInventoryPath, original]]), yellow = root.includes("pokeyellow");
  const patch = await prepareItemDeliveryWrites(files);
  assert.equal(patch.length, yellow ? 0 : 1);
  const fixed = patch[0]?.contents ?? original;
  assert.deepEqual(await prepareItemDeliveryWrites(new Map([[itemInventoryPath, fixed]])), []);
  const crlf = original.replace(/\r?\n/g, "\r\n");
  const crlfPatch = await prepareItemDeliveryWrites(new Map([[itemInventoryPath, crlf]]));
  if (crlfPatch.length) assert.equal(crlfPatch[0].contents, fixed.replace(/\r?\n/g, "\r\n"));
  await assert.rejects(() => prepareItemDeliveryWrites(new Map([[itemInventoryPath, original.replace("\tpush af", "\tnop\n\tpush af")]])), /routine differs/);
  const path = "scripts/ViridianCity.asm", label = "ViridianCitySignText";
  let doc = await loadScriptInteractionDocument(source, path, label);
  const values = { ...doc.values, once: false, showOriginal: false, actions: [{ kind: "item" as const, item: "REPEL", quantity: 99 }] };
  const writes = await prepareScriptInteractionWrites(source, doc, values);
  assert.equal(writes.some(write => write.path === itemInventoryPath), !yellow, "Saving a new item action includes Red's stack fix atomically");
  writes.forEach(write => overlay.set(write.path, write.contents));
  const saved = await loadScriptInteractionDocument(source, path, label);
  const resaved = await prepareScriptInteractionWrites(source, saved, saved.values);
  assert.ok(!resaved.some(write => write.path === itemInventoryPath), "Resaving does not patch an already safe engine");
  assert.deepEqual(saved.values.actions, values.actions);
  // A stale form must not overwrite inventory edits made after opening it.
  overlay.set(itemInventoryPath, fixed + "\n; external inventory edit\n");
  await assert.rejects(() => prepareScriptInteractionWrites(source, saved, saved.values), /sources changed/);
  overlay.delete(itemInventoryPath);
  doc = await loadScriptInteractionDocument(source, path, label);
  assert.equal((await prepareScriptInteractionWrites(source, doc, doc.values)).some(write => write.path === itemInventoryPath), !yellow, "Existing beta gifts acquire the repair without changing their actions");
  const nested = await prepareScriptInteractionWrites(source, doc, { ...doc.values, actions: [{ kind: "choice", yes: values.actions, no: [] }] });
  assert.equal(nested.some(write => write.path === itemInventoryPath), !yellow, "Nested rewards acquire the same fix");
  const legacy = await loadScriptInteractionDocument(source, "scripts/Route1.asm", "Route1Youngster1Text");
  assert.equal((await prepareScriptRewardWrite(source, legacy, "REPEL", 99, false)).some(write => write.path === itemInventoryPath), !yellow);
  console.log(`${root}: automatic item-gift repair, unchanged Yellow, CRLF, idempotence, nested/legacy gifts and stale/custom-source guards passed`);
  if (!rgbds || !binjgb) return;
  const temporary = await mkdtemp(resolve("node_modules/.item-gift-runtime-"));
  const run = (cmd: string, argv: string[], cwd = temporary) => {
    const result = spawnSync(cmd, argv, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    assert.equal(result.status, 0, `${cmd}: ${result.stderr.slice(-6000)}\n${result.stdout.slice(-500)}`); return result.stdout;
  };
  try {
    const cpu = join(temporary, "cpu");
    run("cc", ["-std=gnu11", "-O2", `-I${join(binjgb, "src")}`, resolve("tests/scriptRuntimeProbe.c"), ...["memory.c", "common.c", "emulator-debug.c"].map(file => join(binjgb, "src", file)), "-lm", "-o", cpu]);
    const wrapper = (await source.readText("home/give.asm")).split("GivePokemon::")[0];
    // Keep the native bag -> money/name/options -> map coordinate offsets.
    // A real X=30 (REPEL's item ID) is deliberately present beyond the bag.
    const bindings = { wNumBagItems: 0xc100, wBagItems: 0xc101, wYCoord: 0xc144, wXCoord: 0xc145, wYBlockCoord: 0xc146, wXBlockCoord: 0xc147,
      wNumBoxItems: 0xc200, wItemQuantity: 0xc400, wCurItem: 0xc401, wNamedObjectIndex: 0xc402, BAG_ITEM_CAPACITY: 20, PC_ITEM_CAPACITY: 50, REPEL: 30, POTION: 20 };
    const set = (name: string, value: number) => [`ld a, ${value}`, `ld [${name}], a`];
    async function probe(engine: string, name: string, inventory: Array<[number, number]>, quantity: number, times: number, checks: string[]) {
      const code = engine.slice(engine.indexOf("AddItemToInventory_::"), engine.indexOf("RemoveItemFromInventory_::"));
      const asm = ['INCLUDE "macros/code.asm"', ...Object.entries(bindings).map(([key, value]) => `DEF ${key} EQU $${value.toString(16)}`),
        'SECTION "Header", ROM0[$100]', "jp Entry", "ds $150 - @, 0", 'SECTION "Code", ROM0[$150]', "Entry:", "di", "ld sp, $dfff", "ld hl, $c000", "ld bc, $800", ".clear", "xor a", "ld [hli], a", "dec bc", "ld a, b", "or c", "jr nz, .clear",
        ...set("wYCoord", 14), ...set("wXCoord", 30), ...set("wYBlockCoord", 7), ...set("wXBlockCoord", 15), ...set("$c149", 255),
        ...set("wNumBagItems", inventory.length), ...inventory.flatMap(([item, quantity], i) => [...set(`wBagItems + ${i * 2}`, item), ...set(`wBagItems + ${i * 2 + 1}`, quantity)]), ...set(`wBagItems + ${inventory.length * 2}`, 255),
      ];
      // Count successes without changing the native call's carry contract.
      for (let i = 0; i < times; i++) asm.push(`lb bc, REPEL, ${quantity}`, "call GiveItem", `jr nc, .failed${i}`, "ld hl, $c000", "inc [hl]", `.failed${i}`);
      asm.push("ProbeDone:", "halt", "jr ProbeDone", wrapper, "AddItemToInventory:", "push bc", "call AddItemToInventory_", "pop bc", "ret", code, "GetItemName:", "CopyToStringBuffer:", "ret");
      const file = join(temporary, "gift.asm"), obj = join(temporary, "gift.o"), rom = join(temporary, "gift.gb"), sym = join(temporary, "gift.sym");
      await writeFile(file, asm.join("\n")); run(join(rgbds!, "rgbasm"), ["-I", `${root}/`, "-o", obj, file]); run(join(rgbds!, "rgblink"), ["-n", sym, "-o", rom, obj]); run(join(rgbds!, "rgbfix"), ["-v", "-p", "0", rom]);
      const stop = (await readFile(sym, "utf8")).match(/^00:([0-9a-f]+) ProbeDone$/mi)![1];
      run(cpu, [rom, stop, ...checks]);
      console.log(`  ${name} passed`);
    }
    if (!yellow) await probe(original, "reproduced native Red corruption: second 99-Repel gift writes map block Y=99", [], 99, 2, ["c146=63"]);
    const position = ["c144=e", "c145=1e", "c146=7", "c147=f"];
    await probe(fixed, "two consecutive 99-Repel gifts, no item reordering", [], 99, 2, ["c000=2", "c100=2", "c101=1e", "c102=63", "c103=1e", "c104=63", "c105=ff", ...position]);
    await probe(fixed, "Repel as last item", [[20, 1], [30, 99]], 99, 1, ["c000=1", "c100=3", "c103=1e", "c104=63", "c105=1e", "c106=63", "c107=ff", ...position]);
    await probe(fixed, "Repel reordered before another item", [[30, 99], [20, 1]], 99, 1, ["c000=1", "c100=3", "c103=14", "c104=1", "c105=1e", "c106=63", "c107=ff", ...position]);
    await probe(fixed, "partial stacks retain the exact total", [[30, 60]], 99, 2, ["c000=2", "c100=3", "c102=63", "c104=63", "c106=3c", "c107=ff", ...position]);
    await probe(fixed, "twenty gifts fill the bag and the next fails safely", [], 99, 21, ["c000=14", "c100=14", "c128=63", "c129=ff", ...position]);
    await probe(fixed, "full bag rejects stack overflow without changing its partial stack", [[30, 1], ...Array.from({ length: 19 }, () => [20, 1] as [number, number])], 99, 1, ["c000=0", "c100=14", "c102=1", ...position]);
    await probe(fixed, "full bag accepts a gift that fits an existing stack", [[30, 1], ...Array.from({ length: 19 }, () => [20, 1] as [number, number])], 98, 1, ["c000=1", "c100=14", "c102=63", ...position]);
    const game = join(temporary, "game"); await cp(root, game, { recursive: true, filter: path => !path.split("/").includes(".git") });
    const target = yellow ? "pokeyellow" : "pokered";
    run("make", ["clean"], game); run("make", ["-j2", `RGBDS=${rgbds}/`, `${target}.gbc`], game);
    const symbols = (text: string) => new Map([...text.matchAll(/^([0-9a-f]+):([0-9a-f]+) (\S+)$/gm)].map(match => [match[3], { bank: match[1], address: parseInt(match[2], 16) }]));
    const before = symbols(await readFile(join(game, `${target}.sym`), "utf8"));
    for (const [path, contents] of overlay) await writeFile(join(game, path), contents);
    await writeFile(join(game, itemInventoryPath), fixed);
    run("make", ["clean"], game); run("make", ["-j2", `RGBDS=${rgbds}/`, `${target}.gbc`], game);
    const after = symbols(await readFile(join(game, `${target}.sym`), "utf8"));
    for (const name of ["AddItemToInventory_", "RemoveItemFromInventory_", "wNumBagItems", "wYCoord", "wXCoord", "wYBlockCoord", "wXBlockCoord"]) assert.deepEqual(after.get(name), before.get(name), `${name} retains its native address`);
    for (const name of ["wYCoord", "wXCoord", "wYBlockCoord", "wXBlockCoord"]) assert.equal(after.get(name)!.address - after.get("wNumBagItems")!.address, bindings[name as "wYCoord"] - bindings.wNumBagItems, "Probe offsets match the linked native WRAM layout");
    console.log(`${root}: complete repeatable Repel-gift ROM assembled; native routine/WRAM addresses preserved`);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
