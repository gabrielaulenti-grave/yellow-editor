import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, readdir, stat, cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { loadMapPropertiesDocument, prepareMapPropertiesWrites } from "../src/core/mapProperties";
import { mapPropertyCpuProbes } from "./mapPropertyCpuProbes";
import { checkMap } from "../src/core/mapValidation";
import { loadMapTerrainDocument, prepareMapTerrainWrites, loadMapWarpDocument, prepareMapWarpWrites } from "../src/core/mapEditing";
import { strengthCpuProbes } from "./strengthCpuProbes";
import { resolve, join } from "node:path";
import { loadMapStrengthDocument, prepareMapStrengthWrites, prepareAddBoulderWrites } from "../src/core/mapStrength";
import { loadMapCreateDocument, prepareMapCreateWrites } from "../src/core/mapCreation";
import { createProjectHistoryManager, hexToBytes } from "../src/core/history";
import { loadMapNpcCreateDocument, prepareMapNpcWrites } from "../src/core/npcCreation";
import { loadScriptInteractionDocument, prepareScriptInteractionWrites } from "../src/core/scriptInteractions";
import { loadMapNpcEditDocument, prepareMapNpcEditWrites } from "../src/core/npcEditing";
import { loadMapItemDocument, prepareMapItemWrites } from "../src/core/mapItems";
import { identifySequenceDialogue } from "../src/core/interactionSequence";
import type { ProjectSource, HistoryState, TextWriteRequest } from "../src/core/types";

async function fixture(root: string) {
  const overlay = new Map<string, string>(), binary = new Map<string, Uint8Array>(), files: string[] = []; let journal: HistoryState | null = null;
  async function collect(folder = "") { for (const f of await readdir(join(root, folder), { withFileTypes: true })) {
    if (f.name.startsWith(".")) continue;
    const path = join(folder, f.name);
    if (f.isDirectory()) await collect(path); else if (path.endsWith(".asm")) files.push(path);
  } }
  await collect();
  const source: ProjectSource = {
    displayPath: root, storageKey: root,
    listFiles: async () => [...new Set([...files, ...overlay.keys(), ...binary.keys()])],
    readText: async p => overlay.get(p) ?? readFile(join(root, p), "utf8"),
    readBytes: async p => binary.get(p) ?? (p.endsWith(".2bpp") ? new Uint8Array(4096) : new Uint8Array(await readFile(join(root, p)))),
    writeText: async (p, text) => { overlay.set(p, text); },
    writeBytes: async (p, bytes) => { binary.set(p, bytes.slice()); },
    createFile: async (p, bytes) => { if (await source.exists(p)) throw new Error("File exists"); if (p.endsWith(".blk")) binary.set(p, bytes.slice()); else overlay.set(p, new TextDecoder().decode(bytes)); },
    removeFile: async p => { overlay.delete(p); binary.delete(p); },
    exists: async p => overlay.has(p) || binary.has(p) || (p.endsWith(".png") ? false : p.endsWith(".2bpp") ? true : stat(join(root, p)).then(() => true, () => false)),
    assetUrl: async () => null,
    historyStore: { persistent: true, load: async () => journal, save: async j => { journal = structuredClone(j); } },
  };
  async function apply(writes: TextWriteRequest[]) { for (const w of writes) { if (w.encoding === "hex") binary.set(w.path, hexToBytes(w.contents)); else overlay.set(w.path, w.contents); } }
  return { source, overlay, apply };
}
const roots = process.argv.slice(2), at = roots.indexOf("--rom"), rgbds = at < 0 ? null : resolve(roots[at + 1]), binjgb = at < 0 ? null : resolve(roots[at + 2]);
if (at >= 0) roots.splice(at, 3);
assert.ok(roots.length, "Supply Red/Yellow sources.");
for (const directory of roots) {
  for (const newline of ["\n", "\r\n"]) test(`${directory}: moving unrelated NPCs and pickups preserves Strength ownership (${newline.length === 1 ? "LF" : "CRLF"})`, async () => {
    const { source, apply, overlay } = await fixture(resolve(directory));
    const creation = await loadMapCreateDocument(source, "SEAFOAM_ISLANDS_1F");
    await apply(await prepareMapCreateWrites(source, creation, { constant: "EDITOR_STRENGTH_CAVE", width: creation.visualization.map.width, height: creation.visualization.map.height, layout: "copy", fillBlock: 0, borderBlock: creation.borderBlock, locationMap: "PALLET_TOWN", musicMap: "PALLET_TOWN", connection: null }));
    await apply(await prepareAddBoulderWrites(source, "EDITOR_STRENGTH_CAVE", 17, 5));
    const npc = await loadMapNpcCreateDocument(source, "EDITOR_STRENGTH_CAVE");
    await apply(await prepareMapNpcWrites(source, npc, { x: 8, y: 4, sprite: "SPRITE_GENTLEMAN", movement: "STAY", direction: "DOWN", dialogue: { kind: "new", lines: ["Hello!"] } }));
    const item = await loadMapItemDocument(source, "EDITOR_STRENGTH_CAVE");
    await apply(await prepareMapItemWrites(source, item, { x: 19, y: 4, item: "POTION", quantity: 1 }));
    let puzzle = await loadMapStrengthDocument(source, "EDITOR_STRENGTH_CAVE");
    const values = structuredClone(puzzle.values);
    values.goals.push({ id: 1, event: "", x: 18, y: 5, boulderId: 1, kind: "switch", destination: null });
    values.changes.push({ x: 0, y: 0, block: 1, goals: [1] });
    await apply(await prepareMapStrengthWrites(source, puzzle, values));
    const path = "scripts/EditorStrengthCave.asm";
    overlay.set(path, (await source.readText(path)).replace(/\r?\n/g, newline));
    puzzle = await loadMapStrengthDocument(source, "EDITOR_STRENGTH_CAVE");
    const original = await source.readText(path), expected = structuredClone(puzzle.values);
    const strength = (text: string) => text.slice(text.indexOf("; yellow-editor-strength: "), text.indexOf("; yellow-editor-strength-code-end") + "; yellow-editor-strength-code-end".length);
    const history = createProjectHistoryManager(source);
    // Moving any NPC regenerates authored interactions, including this pickup's
    // final dialogue leaf immediately before the Strength metadata and code.
    for (const id of [npc.objectId, item.npc.objectId]) {
      const doc = await loadMapNpcEditDocument(source, "EDITOR_STRENGTH_CAVE", id);
      assert.equal(doc.reason, null);
      const point = doc.walkable.find(p => (p.x !== doc.values.x || p.y !== doc.values.y) && !doc.occupied.some(o => o.x === p.x && o.y === p.y))!;
      await history.save("Move unrelated object", await prepareMapNpcEditWrites(source, doc, { ...doc.values, ...point }));
      assert.deepEqual((await loadMapStrengthDocument(source, "EDITOR_STRENGTH_CAVE")).values, expected);
      assert.equal(strength(await source.readText(path)), strength(original), "NPC edits preserve the complete adjacent puzzle byte for byte");
      assert.deepEqual(await prepareMapStrengthWrites(source, await loadMapStrengthDocument(source, "EDITOR_STRENGTH_CAVE"), expected), []);
      await history.undo();
      assert.deepEqual((await loadMapStrengthDocument(source, "EDITOR_STRENGTH_CAVE")).values, expected);
      await history.redo();
      assert.equal((await loadMapNpcEditDocument(source, "EDITOR_STRENGTH_CAVE", id)).values.x, point.x);
    }
    // Sequence dialogue leaves are removed and re-appended during regeneration.
    // A later puzzle save can place its metadata directly after such a leaf.
    const interaction = await loadScriptInteractionDocument(source, path, `EditorStrengthCaveEditorNpc${npc.objectId}Text`);
    await apply(await prepareScriptInteractionWrites(source, interaction, { ...interaction.values, showOriginal: false, actions: identifySequenceDialogue([{ kind: "dialogue", lines: ["Puzzle ahead!"] }]) }));
    puzzle = await loadMapStrengthDocument(source, "EDITOR_STRENGTH_CAVE");
    expected.goals[0].x++;
    await apply(await prepareMapStrengthWrites(source, puzzle, expected));
    const beforeSequenceMove = await source.readText(path);
    const itemDoc = await loadMapNpcEditDocument(source, "EDITOR_STRENGTH_CAVE", item.npc.objectId);
    const nextItemPosition = itemDoc.walkable.find(p => (p.x !== itemDoc.values.x || p.y !== itemDoc.values.y) && !itemDoc.occupied.some(o => o.x === p.x && o.y === p.y))!;
    await apply(await prepareMapNpcEditWrites(source, itemDoc, { ...itemDoc.values, ...nextItemPosition }));
    assert.equal(strength(await source.readText(path)), strength(beforeSequenceMove), "removing an old action leaf preserves the next tool's metadata");
    assert.deepEqual((await loadMapStrengthDocument(source, "EDITOR_STRENGTH_CAVE")).values, expected);
    // Earlier editor versions could insert trivia between another tool's
    // markers. Opening these projects must remain read-only and editable.
    const canonical = await source.readText(path);
    const harmless = canonical.replace(`; yellow-editor-strength-code-begin${newline}`, `; yellow-editor-strength-code-begin${newline}${newline}; retained comment${newline}`);
    overlay.set(path, harmless);
    const recovered = await loadMapStrengthDocument(source, "EDITOR_STRENGTH_CAVE");
    assert.deepEqual(recovered.values, expected);
    assert.equal(await source.readText(path), harmless);
    const updated = structuredClone(recovered.values); updated.goals[0].x++;
    await apply(await prepareMapStrengthWrites(source, recovered, updated));
    assert.deepEqual((await loadMapStrengthDocument(source, "EDITOR_STRENGTH_CAVE")).values, updated);
    assert.ok(newline.length === 1 || !/(?<!\r)\n/.test(await source.readText(path)));
    for (const broken of [
      canonical.replace("call CheckBoulderCoords", "call IgnoreInputForHalfSecond"),
      canonical.replace("\tcall EditorStrengthCaveEditorStrength", "\tcall IgnoreInputForHalfSecond"),
      canonical + `${newline}; yellow-editor-strength-code-begin${newline}`,
      canonical.replace(/^; yellow-editor-strength: .*\r?\n/m, ""),
    ]) {
      overlay.set(path, broken);
      await assert.rejects(loadMapStrengthDocument(source, "EDITOR_STRENGTH_CAVE"), /managed Strength/);
    }
  });
  test(`${directory}: native switches, holes, gates and cross-floor landing edits preserve scripts`, async () => {
    const { source, apply } = await fixture(resolve(directory));
    for (const [map, targets, gates, landings] of [["VICTORY_ROAD_1F", 1, 1, 0], ["VICTORY_ROAD_2F", 2, 2, 0], ["VICTORY_ROAD_3F", 2, 1, 1], ["SEAFOAM_ISLANDS_1F", 2, 0, 2], ["SEAFOAM_ISLANDS_B1F", 2, 0, 2], ["SEAFOAM_ISLANDS_B2F", 2, 0, 2], ["SEAFOAM_ISLANDS_B3F", 2, 0, 2]] as const) {
      const doc = await loadMapStrengthDocument(source, map);
      assert.equal(doc.native, true); assert.equal(doc.values.targets.length, targets, `${map} targets`); assert.equal(doc.values.gates.length, gates, `${map} gates`); assert.equal(doc.values.landings.length, landings, `${map} landings`);
      assert.deepEqual(await prepareMapStrengthWrites(source, doc, doc.values), []);
      const values = structuredClone(doc.values); values.targets[0].x--;
      const before = await source.readText(doc.visualization.map.headerLabel!.replace(/_h$/, "").replace(/^/, "scripts/") + ".asm");
      const writes = await prepareMapStrengthWrites(source, doc, values);
      const script = writes.find(w => w.path.startsWith("scripts/"))!;
      assert.equal(script.contents.split("\n").length, before.split("\n").length);
      assert.equal(script.contents.split("\n").filter((line, i) => line !== before.split("\n")[i]).length, 1);
      await apply(writes); assert.equal((await loadMapStrengthDocument(source, map)).values.targets[0].x, values.targets[0].x);
    }
    const current = await loadMapStrengthDocument(source, "SEAFOAM_ISLANDS_B4F");
    assert.equal(current.native, true); assert.equal(current.values.nativeMoves.length, 6);
    assert.deepEqual(await prepareMapStrengthWrites(source, current, current.values), []);
    const rerouted = structuredClone(current.values); rerouted.nativeMoves[0].direction = "DOWN";
    const currentWrites = await prepareMapStrengthWrites(source, current, rerouted);
    assert.equal(currentWrites.length, 1);
    const original = await source.readText(currentWrites[0].path);
    assert.equal(currentWrites[0].contents.split("\n").filter((line, i) => line !== original.split("\n")[i]).length, 1);
    await apply(currentWrites);
    assert.equal((await loadMapStrengthDocument(source, "SEAFOAM_ISLANDS_B4F")).values.nativeMoves[0].direction, "DOWN");
  });
  test(`${directory}: new Strength targets, joint gates, drops, history and source guards`, async () => {
    const { source, apply, overlay } = await fixture(resolve(directory));
    const template = await loadMapCreateDocument(source, "SEAFOAM_ISLANDS_1F");
    await apply(await prepareMapCreateWrites(source, template, { constant: "EDITOR_STRENGTH_CAVE", width: template.visualization.map.width, height: template.visualization.map.height, layout: "copy", fillBlock: 0, borderBlock: template.borderBlock, locationMap: "PALLET_TOWN", musicMap: "PALLET_TOWN", connection: null }));
    const terrain = await loadMapTerrainDocument(source, "EDITOR_STRENGTH_CAVE");
    const waterBlock = Array.from({ length: terrain.visualization.blockCount }, (_, id) => id).find(id => [4, 6, 12, 14].every(at => terrain.visualization.blockset[id * 16 + at] === 0x14));
    assert.notEqual(waterBlock, undefined);
    const layout = terrain.visualization.mapBlocks.slice();
    for (const at of [0, 1, terrain.visualization.map.width, terrain.visualization.map.width + 1]) layout[at] = waterBlock!;
    await apply(await prepareMapTerrainWrites(source, terrain, { mapBlocks: layout, blockset: terrain.visualization.blockset, confirmSharedBlocks: false, confirmSharedLayout: false }));
    await apply(await prepareAddBoulderWrites(source, "EDITOR_STRENGTH_CAVE", 17, 5));
    await apply(await prepareAddBoulderWrites(source, "EDITOR_STRENGTH_CAVE", 24, 5));
    await apply(await prepareAddBoulderWrites(source, "REDS_HOUSE_1F", 1, 1));
    const doc = await loadMapStrengthDocument(source, "EDITOR_STRENGTH_CAVE"), destination = (await loadMapStrengthDocument(source, "REDS_HOUSE_1F")).boulders[0];
    const values = structuredClone(doc.values);
    values.goals.push({ id: 1, event: "", x: 24, y: 4, boulderId: doc.boulders[0].id, kind: "switch", destination: null });
    values.goals.push({ id: 2, event: "", x: 17, y: 6, boulderId: doc.boulders[1].id, kind: "hole", destination: { map: "REDS_HOUSE_1F", objectId: destination.id, warpId: 1 } });
    values.changes.push({ x: 0, y: 0, block: 1, goals: [1, 2] });
    const writes = await prepareMapStrengthWrites(source, doc, values);
    assert.ok(writes.some(w => w.path === "engine/overworld/toggleable_objects.asm"));
    const history = createProjectHistoryManager(source);
    await history.save("Create Strength puzzle", writes);
    let next = await loadMapStrengthDocument(source, "EDITOR_STRENGTH_CAVE");
    assert.equal(next.native, false); assert.equal(next.values.goals.length, 2);
    assert.ok(next.values.goals.every(g => /^EVENT_/.test(g.event)));
    assert.notEqual(next.values.goals[0].event, next.values.goals[1].event);
    assert.deepEqual(await prepareMapStrengthWrites(source, next, next.values), []);
    await history.undo(); assert.equal((await loadMapStrengthDocument(source, "EDITOR_STRENGTH_CAVE")).values.goals.length, 0);
    await history.redo(); assert.equal((await loadMapStrengthDocument(source, "EDITOR_STRENGTH_CAVE")).values.goals.length, 2);
    next = await loadMapStrengthDocument(source, "EDITOR_STRENGTH_CAVE");
    const currents = structuredClone(next.values);
    currents.currents.push({ x: 0, y: 2, events: next.values.goals.map(g => g.event), path: [{ direction: "RIGHT", steps: 2 }, { direction: "DOWN", steps: 1 }] });
    await history.save("Add puzzle current", await prepareMapStrengthWrites(source, next, currents));
    next = await loadMapStrengthDocument(source, "EDITOR_STRENGTH_CAVE");
    assert.equal(next.values.currents.length, 1);
    assert.deepEqual(await prepareMapStrengthWrites(source, next, next.values), []);
    // Both editors share IsObjectHidden. Exercise installation and regeneration
    // in both directions, then compile the combined project below.
    const npc = await loadMapNpcCreateDocument(source, "VIRIDIAN_POKECENTER");
    await apply(await prepareMapNpcWrites(source, npc, { x: 8, y: 4, sprite: "SPRITE_GENTLEMAN", movement: "STAY", direction: "DOWN", dialogue: { kind: "new", lines: ["Hello!"] } }));
    const scenePath = "scripts/ViridianPokecenter.asm", sceneLabel = `ViridianPokecenterEditorNpc${npc.objectId}Text`;
    const scene = await loadScriptInteractionDocument(source, scenePath, sceneLabel);
    const sceneValues = { ...scene.values, showOriginal: false, actions: identifySequenceDialogue([
      { kind: "visibility", npc: `VIRIDIAN_POKECENTER_EDITOR_NPC_${npc.objectId}`, visible: true },
      { kind: "dialogue", lines: ["The puzzle awaits!"] },
    ]), scene: { trigger: "interaction" as const, playerX: 8, playerY: 5, idleState: 0, hiddenNpcs: [] } };
    await apply(await prepareScriptInteractionWrites(source, scene, sceneValues));
    next = await loadMapStrengthDocument(source, "EDITOR_STRENGTH_CAVE");
    const relinked = structuredClone(next.values), originalBoulder = relinked.goals[1].boulderId;
    relinked.goals[1].boulderId = relinked.goals[0].boulderId;
    await apply(await prepareMapStrengthWrites(source, next, relinked));
    const sceneAgain = await loadScriptInteractionDocument(source, scenePath, sceneLabel);
    const sceneWrites = await prepareScriptInteractionWrites(source, sceneAgain, sceneAgain.values);
    assert.equal(sceneWrites.find(w => w.path.includes("toggleable_objects"))!.contents, await source.readText("engine/overworld/toggleable_objects.asm"));
    await apply(sceneWrites);
    next = await loadMapStrengthDocument(source, "EDITOR_STRENGTH_CAVE");
    const restored = structuredClone(next.values); restored.goals[1].boulderId = originalBoulder;
    await apply(await prepareMapStrengthWrites(source, next, restored));
    next = await loadMapStrengthDocument(source, "EDITOR_STRENGTH_CAVE");
    assert.deepEqual(await prepareMapStrengthWrites(source, next, next.values), []);
    if (rgbds && binjgb) {
      const temporary = await mkdtemp(resolve("node_modules/.strength-rom-"));
      const run = (cmd: string, argv: string[], cwd = temporary) => {
        const result = spawnSync(cmd, argv, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
        assert.equal(result.status, 0, `${cmd}: ${result.stderr?.slice(-7000)}\n${result.stdout?.slice(-500)}`); return result.stdout;
      };
      try {
        const cpu = join(temporary, "cpu");
        run("cc", ["-std=gnu11", "-O2", `-I${join(binjgb, "src")}`, resolve("tests/scriptRuntimeProbe.c"), ...["memory.c", "common.c", "emulator-debug.c"].map(f => join(binjgb, "src", f)), "-lm", "-o", cpu]);
        await strengthCpuProbes(resolve(directory), temporary, rgbds, cpu, run, next, overlay);
        const properties = await loadMapPropertiesDocument(source, "EDITOR_STRENGTH_CAVE");
        const propertyWrites = await prepareMapPropertiesWrites(source, properties, { bicycle: false, escape: false, teleport: true, fly: true, flash: false, lighting: "dark" });
        await mapPropertyCpuProbes(temporary, rgbds, cpu, run, propertyWrites, "EDITOR_STRENGTH_CAVE", next.visualization.map.id);
        const game = join(temporary, "game"); await cp(resolve(directory), game, { recursive: true, filter: p => !p.split("/").includes(".git") });
        for (const [path, contents] of overlay) await writeFile(join(game, path), contents);
        for (const write of propertyWrites) await writeFile(join(game, write.path), write.contents);
        const mapPath = next.visualization.mapBlockPath;
        await writeFile(join(game, mapPath), Buffer.from(next.visualization.mapBlocks));
        const target = directory.includes("pokeyellow") ? "pokeyellow" : "pokered";
        run("make", ["-j2", `RGBDS=${rgbds}/`, `${target}.gbc`], game);
        console.log(`${directory}: complete ROM with a new Strength cave, boulders and cross-map hole assembled`);
      } finally { await rm(temporary, { recursive: true, force: true }); }
    }
    const report = await checkMap(source, "EDITOR_STRENGTH_CAVE");
    assert.ok(!report.issues.some(issue => issue.code === "warp-terrain"));
    const warpDoc = await loadMapWarpDocument(source, "EDITOR_STRENGTH_CAVE"), hole = warpDoc.warps.at(-1)!;
    await assert.rejects(prepareMapWarpWrites(source, warpDoc, { ...hole, id: hole.id, destinationDocument: await loadMapWarpDocument(source, "REDS_HOUSE_1F"), pair: null }), /Strength hole/);
    await assert.rejects(prepareMapStrengthWrites(source, doc, values), /sources changed/);
    const bad = structuredClone(next.values); bad.goals[0].x = -1;
    await assert.rejects(prepareMapStrengthWrites(source, next, bad), /Target X/);
    const text = await source.readText("scripts/EditorStrengthCave.asm");
    overlay.set("scripts/EditorStrengthCave.asm", text.replace("call CheckBoulderCoords", "call IgnoreInputForHalfSecond"));
    await assert.rejects(loadMapStrengthDocument(source, "EDITOR_STRENGTH_CAVE"), /edited in source/);
  });
}

for (const directory of roots) test(`${directory}: map permission defaults, isolated overrides, lighting and history`, async () => {
  const { source, apply } = await fixture(resolve(directory));
  const house = await loadMapPropertiesDocument(source, "BLUES_HOUSE");
  assert.equal(house.defaults.bicycle, false); assert.equal(house.defaults.teleport, false); assert.equal(house.defaults.flash, true);
  const town = await loadMapPropertiesDocument(source, "PALLET_TOWN");
  assert.equal(town.defaults.bicycle, true); assert.equal(town.defaults.teleport, true);
  assert.deepEqual(await prepareMapPropertiesWrites(source, house, house.values), []);
  const values = { ...house.values, bicycle: true, escape: true, teleport: true, fly: true, flash: false, lighting: "dark" as const };
  const writes = await prepareMapPropertiesWrites(source, house, values), history = createProjectHistoryManager(source);
  assert.equal(writes.length, 4);
  await history.save("Edit map properties", writes);
  const next = await loadMapPropertiesDocument(source, "BLUES_HOUSE"); assert.deepEqual(next.values, values);
  assert.equal((await loadMapPropertiesDocument(source, "PALLET_TOWN")).values.bicycle, null);
  assert.deepEqual(await prepareMapPropertiesWrites(source, next, values), []);
  await history.undo(); assert.deepEqual((await loadMapPropertiesDocument(source, "BLUES_HOUSE")).values, house.values);
  await history.redo();
  const reset = await loadMapPropertiesDocument(source, "BLUES_HOUSE");
  await apply(await prepareMapPropertiesWrites(source, reset, house.values));
  assert.deepEqual((await loadMapPropertiesDocument(source, "BLUES_HOUSE")).values, house.values);
});
