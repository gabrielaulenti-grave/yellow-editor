import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, readdir, stat, cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
import { loadItemCreateDocument, prepareItemCreateWrites } from "../src/core/itemCreation";
import { loadItemEditDocument, prepareItemEditWrites } from "../src/core/itemEditing";
import { loadMapPropertiesDocument, prepareMapPropertiesWrites } from "../src/core/mapProperties";
import { defaultFieldTool, fieldActions, fieldToolForItem, type FieldToolValues } from "../src/core/fieldTools";
import { parseItemConstantDefinitions } from "../src/core/itemConstants";
import { parseItems } from "../src/core/itemParsing";
import { ordinaryItemRoutines } from "../src/core/itemEvolutionHooks";
import { loadScriptInteractionDocument } from "../src/core/scriptInteractions";
import { createProjectHistoryManager } from "../src/core/history";
import type { ProjectSource, HistoryState, TextWriteRequest } from "../src/core/types";
import { fieldToolGameplayProbes } from "./fieldToolGameplay";
import { fieldToolCpuProbes } from "./fieldToolCpuProbes";
const args = process.argv.slice(2), at = args.indexOf("--rom"), rgbds = at < 0 ? null : resolve(args[at + 1]), binjgb = at < 0 ? null : resolve(args[at + 2]);
if (at >= 0) args.splice(at, 3);
assert.ok(args.length, "Supply pinned Red/Yellow directories.");
for (const directory of args) test(`${directory}: field tool creation, editing, map permissions and history`, async () => {
  const root = resolve(directory), files: string[] = [], overlay = new Map<string, string>(); let journal: HistoryState | null = null, fail: string | null = null;
  async function collect(folder = "") { for (const e of await readdir(join(root, folder), { withFileTypes: true })) { if (e.name.startsWith(".")) continue; const p = join(folder, e.name); if (e.isDirectory()) await collect(p); else if (p.endsWith(".asm")) files.push(p); } }
  await collect();
  const source: ProjectSource = { listFiles: async () => files, readText: async p => overlay.get(p) ?? readFile(join(root, p), "utf8"), readBytes: async p => new Uint8Array(await readFile(join(root, p))), exists: async p => overlay.has(p) || stat(join(root, p)).then(() => true, () => false),
    writeText: async (p, s) => { if (p === fail) { fail = null; throw new Error("Injected write failure"); } overlay.set(p, s); },
    historyStore: { persistent: true, load: async () => journal, save: async j => { journal = structuredClone(j); } } };
  const history = await createProjectHistoryManager(source), originalEffects = await source.readText("engine/items/item_effects.asm");
  async function save(writes: TextWriteRequest[]) { return history.save("Field tool", writes); }
  let firstId = 0;
  for (const action of fieldActions) {
    const doc = await loadItemCreateDocument(source); assert.equal(doc.fieldToolSupport?.reason, null);
    const value: FieldToolValues = { ...defaultFieldTool(), action, allFlyDestinations: action === "fly", consume: action === "dig" };
    const item = { slotId: doc.slots[0].id, constant: `TEST_${action.toUpperCase()}`, name: action.toUpperCase(), price: 0, keyItem: true, template: "field-tool" as const, fieldTool: value };
    if (!firstId) firstId = item.slotId;
    const before = await source.readText("constants/item_constants.asm"), writes = await prepareItemCreateWrites(source, doc, item);
    if (action === "surf") { fail = "engine/items/item_effects.asm"; await assert.rejects(save(writes), /Injected/); assert.equal(await source.readText("constants/item_constants.asm"), before); assert.equal(await source.readText("engine/items/item_effects.asm"), originalEffects); }
    await save(writes);
    const edit = await loadItemEditDocument(source, item.slotId); assert.deepEqual(edit.fieldTool, value); assert.equal(edit.fieldToolSupport?.reason, null);
    assert.equal((await prepareItemEditWrites(source, edit, { ...edit })).length, 0);
    assert.ok((await source.readText("data/items/use_overworld.asm")).includes(`db ${item.constant}`));
    assert.ok(!(await source.readText("data/items/use_party.asm")).includes(`db ${item.constant}`));
  }
  const nativeDefinitions = parseItemConstantDefinitions(await readFile(join(root, "constants/item_constants.asm"), "utf8"));
  const authoredDefinitions = parseItemConstantDefinitions(await source.readText("constants/item_constants.asm"));
  for (const old of nativeDefinitions.filter(d => !/^ITEM_/.test(d.constant))) assert.equal(authoredDefinitions.find(d => d.constant === old.constant)!.id, old.id);
  const floorRows = (s: string) => [...s.matchAll(/\bli "([^"\r\n]+)"/g)].slice(0x53, 0x61).map(m => m[1]);
  assert.deepEqual(floorRows(await source.readText("data/items/names.asm")), floorRows(await readFile(join(root, "data/items/names.asm"), "utf8")), "elevator names stay at their original item IDs");
  const items = await parseItems(source);
  for (const action of fieldActions) { const item = items.find(i => i.constant === `TEST_${action.toUpperCase()}`)!; assert.equal(item.name, action.toUpperCase()); assert.equal(item.useRoutine, "EditorFieldToolUse"); }
  assert.ok(!items.some(i => i.constant.startsWith("ITEM_RESERVED_")));
  const npcInteraction = await loadScriptInteractionDocument(source, "scripts/PalletTown.asm", "PalletTownGirlText");
  assert.ok(!npcInteraction.items.some(item => item.startsWith("ITEM_RESERVED_")));
  assert.ok(npcInteraction.items.includes("TEST_CUT") && npcInteraction.items.includes("TM_DIG"));
  const routines = ordinaryItemRoutines(await source.readText("constants/item_constants.asm"), await source.readText("engine/items/item_effects.asm"));
  assert.equal(routines.get("FIRE_STONE"), "ItemUseEvoStone"); assert.equal(routines.get("TEST_CUT"), "EditorFieldToolUse");
  // Requirements are per item and survive ordinary property edits.
  let edit = await loadItemEditDocument(source, firstId);
  const gated = { ...edit.fieldTool!, badge: "SOUL", requireMove: true, condition: { kind: "hall-of-fame" as const } };
  await save(await prepareItemEditWrites(source, edit, { ...edit, fieldTool: gated, name: "RAFT" }));
  assert.equal((await loadItemEditDocument(source, firstId)).fieldTool?.badge, "SOUL");
  await history.undo(); assert.equal((await loadItemEditDocument(source, firstId)).fieldTool?.badge, null);
  await history.redo(); assert.equal((await loadItemEditDocument(source, firstId)).fieldTool?.badge, "SOUL");
  // A detached native dispatch pointer cannot silently retain editable tool controls.
  const boundEffects = await source.readText("engine/items/item_effects.asm");
  overlay.set("engine/items/item_effects.asm", boundEffects.replace(/dw EditorFieldToolUse(\s*; TEST_SURF)/, "dw UnusableItem$1"));
  assert.match((await loadItemEditDocument(source, firstId)).fieldToolSupport!.reason!, /binding changed/);
  overlay.set("engine/items/item_effects.asm", boundEffects);
  // The metadata/code contract refuses external changes and stale forms.
  edit = await loadItemEditDocument(source, firstId);
  const itemNames = await source.readText("data/items/names.asm"); overlay.set("data/items/names.asm", itemNames + "\n; external\n");
  await assert.rejects(prepareItemEditWrites(source, edit, { ...edit }), /changed/); overlay.set("data/items/names.asm", itemNames);
  await assert.rejects(prepareItemEditWrites(source, edit, { ...edit, fieldTool: { ...gated, messages: { ...gated.messages, invalid: ['bad"text'] } } }), /message/);
  // First install and then change map rules with field tools already present.
  const map = await loadMapPropertiesDocument(source, "ROCK_TUNNEL_B1F");
  await save(await prepareMapPropertiesWrites(source, map, { ...map.values, flash: false, surf: false, cut: false, strength: false, fly: true, teleport: true, escape: false }));
  const again = await loadItemEditDocument(source, firstId); assert.equal(again.fieldToolSupport?.reason, null);
  assert.ok((await source.readText("engine/items/item_effects.asm")).includes("cp ROCK_TUNNEL_B1F"));
  const map2 = await loadMapPropertiesDocument(source, "ROCK_TUNNEL_B1F");
  await save(await prepareMapPropertiesWrites(source, map2, { ...map2.values, flash: true }));
  assert.equal((await loadMapPropertiesDocument(source, "ROCK_TUNNEL_B1F")).values.flash, true);
  assert.deepEqual(fieldToolForItem(await source.readText("engine/items/item_effects.asm"), "TEST_SURF"), gated);
  if (rgbds && binjgb) {
    const temp = await mkdtemp(resolve("node_modules/.field-tools-rom-"));
    const run = (cmd: string, argv: string[], cwd = temp) => { const r = spawnSync(cmd, argv, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }); assert.equal(r.status, 0, r.stderr.slice(-10000) + r.stdout.slice(-2000)); return r.stdout; };
    try {
      await cp(root, temp, { recursive: true, filter: p => !p.split("/").includes(".git") });
      for (const [p, text] of overlay) await writeFile(join(temp, p), text);
      const target = root.includes("pokeyellow") ? "pokeyellow" : "pokered";
      run("make", ["-j2", `RGBDS=${rgbds}/`, `${target}.gbc`]);
      await fieldToolCpuProbes(temp, rgbds, binjgb, run);
      await fieldToolGameplayProbes(temp, rgbds, binjgb, run);
      console.log(`${root}: all seven tools and map rules compiled; field action CPU checks passed`);
    } finally { if (process.env.KEEP_FIELD_TOOLS) console.log("Field tools fixture: " + temp); else await rm(temp, { recursive: true, force: true }); }
  }
});
