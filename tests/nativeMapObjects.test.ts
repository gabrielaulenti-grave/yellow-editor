import assert from "node:assert/strict";
import { test } from "node:test";
import { cp, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { loadMapVisualization, parseNpcEvents } from "../src/core/mapVisualization";
import { loadNativeMapObjectDocument, prepareNativeMapObjectWrites } from "../src/core/nativeMapObjects";
import { createProjectHistoryManager } from "../src/core/history";
import type { ProjectSource, HistoryState } from "../src/core/types";
import { projectConstantCatalogFromSources } from "../src/core/projectConstants";
import { nativeMapObjectCpuProbes } from "./nativeMapObjectCpuProbes";
import { loadMapNpcCreateDocument, prepareMapNpcWrites } from "../src/core/npcCreation";
import { loadScriptInteractionDocument, prepareScriptInteractionWrites } from "../src/core/scriptInteractions";
import { identifySequenceDialogue } from "../src/core/interactionSequence";

const roots = process.argv.slice(2), at = roots.indexOf("--rom"), rgbds = at < 0 ? null : resolve(roots[at + 1]), binjgb = at < 0 ? null : resolve(roots[at + 2]);
if (at >= 0) roots.splice(at, 3);
assert.ok(roots.length, "Supply Red/Yellow source directories.");
for (const directory of roots) test(`${directory}: native object visibility, bindings, edits and history`, async () => {
  const root = resolve(directory), overlay = new Map<string, string>(), files: string[] = []; let journal: HistoryState | null = null, failPath: string | null = null;
  async function collect(p = "") { for (const f of await readdir(join(root, p), { withFileTypes: true })) { if (f.name.startsWith(".")) continue; const path = join(p, f.name); if (f.isDirectory()) await collect(path); else files.push(path); } }
  await collect();
  const source: ProjectSource = { storageKey: root, listFiles: async () => files, readText: async p => overlay.get(p) ?? readFile(join(root, p), "utf8"),
    readBytes: async p => p.endsWith(".2bpp") ? new Uint8Array(4096) : new Uint8Array(await readFile(join(root, p))),
    exists: async p => p.endsWith(".png") ? false : p.endsWith(".2bpp") ? true : stat(join(root, p)).then(() => true, () => false), assetUrl: async () => null,
    writeText: async (p, text) => { if (p === failPath) { failPath = null; throw new Error("Injected write failure"); } overlay.set(p, text); }, historyStore: { persistent: true, load: async () => journal, save: async j => { journal = structuredClone(j); } },
  };
  const map = "MT_MOON_1F", view = await loadMapVisualization(source, map), history = createProjectHistoryManager(source);
  assert.equal(view.npcs.length, 13); assert.equal(view.npcs.filter(n => n.objectKind === "trainer").length, 7); assert.equal(view.npcs.filter(n => n.objectKind === "item").length, 6);
  assert.equal(view.signs.length, 1); assert.equal(view.warps.length, 5);
  assert.deepEqual(view.npcs.map(n => n.id), Array.from({ length: 13 }, (_, i) => i + 1));
  assert.equal(view.npcs[0].trainerPartyId, "HIKER:1"); assert.equal(view.npcs[7].itemConstant, "POTION"); assert.equal(view.npcs[7].initiallyHidden, false);
  let count = 0;
  for (const path of files.filter(p => /^data\/maps\/objects\/.*\.asm$/.test(p))) {
    const text = await source.readText(path), expected = text.split(/\r?\n/).filter(l => /^\s*object_event\s/.test(l));
    const name = path.split("/").pop()!, scriptPath = `scripts/${name}`, script = await source.exists(scriptPath) ? await source.readText(scriptPath) : null;
    const objects = parseNpcEvents(text, scriptPath, script, "", null);
    assert.equal(objects.length, expected.length, `${path}: every vanilla object stays visible`);
    assert.deepEqual(objects.map(n => n.id), expected.map((_, i) => i + 1), path);
    count += objects.length;
  }
  console.log(`${directory}: all ${count} vanilla object records are visible with stable slot IDs`);
  const objectPath = "data/maps/objects/MtMoon1F.asm", scriptPath = "scripts/MtMoon1F.asm";
  const originalObjects = await source.readText(objectPath), originalScript = await source.readText(scriptPath), toggles = await source.readText("data/maps/toggleable_objects.asm"), events = await source.readText("constants/event_constants.asm");
  for (const n of view.npcs) {
    const d = await loadNativeMapObjectDocument(source, map, n.id);
    assert.equal(d.reason, null, `${n.objectConstant}: standard native support`);
    assert.deepEqual(await prepareNativeMapObjectWrites(source, d, d.values), [], "an unchanged save must not rewrite source");
  }
  const pickup = await loadNativeMapObjectDocument(source, map, 8);
  const point = pickup.placement.walkable.find(p => !pickup.placement.occupied.some(o => o.x === p.x && o.y === p.y) && (p.x !== pickup.values.x || p.y !== pickup.values.y))!;
  const writes = await prepareNativeMapObjectWrites(source, pickup, { ...pickup.values, ...point, item: "MOON_STONE" });
  assert.equal(writes.length, 1); assert.equal(writes[0].path, objectPath);
  assert.equal(writes[0].contents.split("\n").filter((l, i) => l !== originalObjects.split("\n")[i]).length, 1);
  await history.save("Move native pickup", writes);
  assert.equal((await loadMapVisualization(source, map)).npcs[7].itemConstant, "MOON_STONE");
  await history.undo(); assert.equal(await source.readText(objectPath), originalObjects);
  await history.redo(); assert.equal((await loadNativeMapObjectDocument(source, map, 8)).values.item, "MOON_STONE");
  const trainer = await loadNativeMapObjectDocument(source, map, 1);
  assert.equal(trainer.event, "EVENT_BEAT_MT_MOON_1_TRAINER_0"); assert.equal(trainer.dialogues.length, 3); assert.equal(trainer.placementReason, null);
  const values = structuredClone(trainer.values); values.partyId = "YOUNGSTER:3"; values.sight = 1; values.dialogues[0][0].text = "Howdy!";
  const textBefore = await source.readText(trainer.dialogues[0].document.path);
  const trainerWrites = await prepareNativeMapObjectWrites(source, trainer, values), objectsBeforeTrainer = await source.readText(objectPath);
  failPath = trainer.dialogues[0].document.path;
  await assert.rejects(history.save("Edit native trainer", trainerWrites), /Injected write failure/);
  assert.equal(await source.readText(objectPath), objectsBeforeTrainer); assert.equal(await source.readText(scriptPath), originalScript); assert.equal(await source.readText(trainer.dialogues[0].document.path), textBefore);
  await history.save("Edit native trainer", trainerWrites);
  const reopened = await loadNativeMapObjectDocument(source, map, 1);
  assert.equal(reopened.values.partyId, "YOUNGSTER:3"); assert.equal(reopened.values.sight, 1); assert.equal(reopened.values.dialogues[0][0].text, "Howdy!"); assert.equal(reopened.event, trainer.event);
  assert.equal((await loadMapVisualization(source, map)).npcs[0].trainerPartyId, "YOUNGSTER:3");
  await history.undo(); assert.equal(await source.readText(scriptPath), originalScript); assert.equal(await source.readText(trainer.dialogues[0].document.path), textBefore);
  await history.redo(); assert.equal((await loadNativeMapObjectDocument(source, map, 1)).values.sight, 1);
  assert.equal(await source.readText("data/maps/toggleable_objects.asm"), toggles); assert.equal(await source.readText("constants/event_constants.asm"), events);
  await assert.rejects(prepareNativeMapObjectWrites(source, trainer, values), /sources changed/);
  await assert.rejects(prepareNativeMapObjectWrites(source, reopened, { ...reopened.values, sight: 16 }), /sight range/);
  const currentItem = await loadNativeMapObjectDocument(source, map, 8);
  await assert.rejects(prepareNativeMapObjectWrites(source, currentItem, { ...currentItem.values, x: 5, y: 6 }), /contains an object/);
  await assert.rejects(prepareNativeMapObjectWrites(source, currentItem, { ...currentItem.values, item: "FLOOR_B2F" }), /pickup item/);
  // Preserve Windows line endings and inline notes when patching operands.
  const beforeCrlf = await source.readText(objectPath);
  overlay.set(objectPath, beforeCrlf.replace(/(TEXT_MTMOON1F_POTION1,[^\n]*)/, "$1 ; retain note").replace(/\r?\n/g, "\r\n"));
  const crlf = await loadNativeMapObjectDocument(source, map, 8);
  const crlfWrites = await prepareNativeMapObjectWrites(source, crlf, { ...crlf.values, item: "RARE_CANDY" });
  assert.ok(!/(?<!\r)\n/.test(crlfWrites[0].contents)); assert.ok(crlfWrites[0].contents.includes("; retain note\r\n"));
  overlay.set(objectPath, beforeCrlf);
  const special = await loadMapVisualization(source, "SEAFOAM_ISLANDS_B4F");
  assert.ok(special.npcs.some(n => n.objectKind === "special"), "Articuno stays visible as a special encounter");
  const hidden = await loadMapVisualization(source, "SS_ANNE_2F");
  assert.ok(hidden.npcs.some(n => n.initiallyHidden), "initially hidden story objects stay visible in the editor");
  const creation = await loadMapNpcCreateDocument(source, map);
  const npcPosition = currentItem.placement.walkable.find(p => !creation.occupied.some(o => o.x === p.x && o.y === p.y))!;
  for (const w of await prepareMapNpcWrites(source, creation, { ...npcPosition, sprite: "SPRITE_YOUNGSTER", movement: "STAY", direction: "DOWN", dialogue: { kind: "new", lines: ["Hello!"] } })) overlay.set(w.path, w.contents);
  const interaction = await loadScriptInteractionDocument(source, scriptPath, `MtMoon1FEditorNpc${creation.objectId}Text`);
  for (const w of await prepareScriptInteractionWrites(source, interaction, { ...interaction.values, showOriginal: false, actions: identifySequenceDialogue([{ kind: "dialogue", lines: ["The cave awaits!"] }]) })) overlay.set(w.path, w.contents);
  const itemWithScene = await loadNativeMapObjectDocument(source, map, 8);
  const nextPosition = itemWithScene.placement.walkable.find(p => !itemWithScene.placement.occupied.some(o => o.x === p.x && o.y === p.y) && (p.x !== itemWithScene.values.x || p.y !== itemWithScene.values.y))!;
  for (const w of await prepareNativeMapObjectWrites(source, itemWithScene, { ...itemWithScene.values, ...nextPosition })) overlay.set(w.path, w.contents);
  assert.deepEqual((await loadScriptInteractionDocument(source, scriptPath, interaction.label)).values.actions, identifySequenceDialogue([{ kind: "dialogue", lines: ["The cave awaits!"] }]));
  assert.equal((await loadNativeMapObjectDocument(source, map, 8)).values.x, nextPosition.x, "unrelated authored interactions do not lock native placement");
  if (rgbds && binjgb) {
    const temp = await mkdtemp(resolve("node_modules/.native-map-rom-"));
    const run = (cmd: string, args: string[]) => { const result = spawnSync(cmd, args, { cwd: temp, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }); assert.equal(result.status, 0, result.stderr.slice(-7000) + result.stdout.slice(-3000)); return result.stdout; };
    try {
      await cp(root, temp, { recursive: true, filter: p => !p.split("/").includes(".git") });
      for (const [p, text] of overlay) await writeFile(join(temp, p), text);
      const game = root.includes("pokeyellow") ? "pokeyellow" : "pokered";
      run("make", ["-j2", `RGBDS=${rgbds}/`, `${game}.gbc`]);
      const sym = await readFile(join(temp, `${game}.sym`), "utf8"), rom = await readFile(join(temp, `${game}.gbc`));
      const symbol = (name: string) => { const m = sym.match(new RegExp(`^([a-f0-9]+):([a-f0-9]+) ${name}$`, "m")); assert.ok(m, name); const address = parseInt(m[2], 16); return { address, offset: parseInt(m[1], 16) * 0x4000 + address % 0x4000 }; };
      const constants = new Map(projectConstantCatalogFromSources(await Promise.all(files.filter(p => p.startsWith("constants/") && p.endsWith(".asm")).map(async path => ({ path, contents: await source.readText(path) })))).constants.map(c => [c.symbol, c.value]));
      const object = symbol("MtMoon1F_Object").offset;
      const first = object + 1 + 1 + view.warps.length * 4 + 1 + view.signs.length * 3 + 1;
      const trainerClasses = [...(await source.readText("constants/trainer_constants.asm")).matchAll(/^\s*trainer_const (\w+)/gm)].map(m => m[1]);
      assert.equal(rom[first + 6], constants.get("OPP_ID_OFFSET")! + trainerClasses.indexOf("YOUNGSTER")); assert.equal(rom[first + 7], 3);
      assert.equal(rom[first + 7 * 8 + 6], constants.get("MOON_STONE"));
      const header = symbol("MtMoon1TrainerHeader0").offset, event = constants.get(trainer.event!)!;
      assert.equal(rom[header], 1); assert.equal(rom[header + 1], 16);
      assert.equal(rom.readUInt16LE(header + 2), symbol("wEventFlags").address + (event - 1) / 8);
      const toggle = symbol("ToggleData_MT_MOON_1F").offset;
      for (let i = 0; i < 6; i++) assert.equal(rom[toggle + i * 3 + 1], i + 8, "native pickup visibility keeps its original object slot");
      await nativeMapObjectCpuProbes(temp, rgbds, binjgb, run, await loadNativeMapObjectDocument(source, map, 1), await loadNativeMapObjectDocument(source, map, 8));
      console.log(`${directory}: complete edited ROM and native trainer/header/pickup bytes verified`);
    } finally { if (process.env.KEEP_NATIVE_OBJECTS) console.log("Native object fixture:", temp); else await rm(temp, { recursive: true, force: true }); }
  }
});
