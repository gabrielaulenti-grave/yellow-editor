import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { PNG } from "pngjs";
import { loadAnimationEditDocument, prepareAnimationWrites, type AnimationEditValues } from "../src/core/battleAnimationEditing";
import { createProjectHistoryManager } from "../src/core/history";
import { configureGen1PngDecoder } from "../src/core/gen1Graphics";
import { prepareTrainerPortraitCopy } from "../src/core/trainerPortraitCreation";
import { loadGraphicsCatalog } from "../src/core/graphics";
import type { HistoryState, ProjectSource } from "../src/core/types";

configureGen1PngDecoder("pngjs", async bytes => { const decoded = PNG.sync.read(Buffer.from(bytes)); return { width: decoded.width, height: decoded.height, rgba: new Uint8ClampedArray(decoded.data) }; });
async function fixture(root: string) {
  const data = new Map<string, Uint8Array>(); let history: HistoryState | null = null, failPath: string | null = null;
  async function visit(folder = "") { for (const entry of await readdir(join(root, folder), { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = folder ? `${folder}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await visit(path); else if (/\.(asm|inc|png)$/.test(path) || path === "Makefile" || path === "layout.link") data.set(path, new Uint8Array(await readFile(join(root, path))));
  } }
  await visit();
  const source: ProjectSource = {
    displayPath: root, storageKey: root, listFiles: async () => [...data.keys()], exists: async path => data.has(path),
    readBytes: async path => { const bytes = data.get(path); if (!bytes) throw new Error(`Missing ${path}`); return bytes.slice(); },
    readText: async path => new TextDecoder().decode(await source.readBytes(path)),
    writeBytes: async (path, bytes) => { if (failPath === path) { failPath = null; throw new Error("Injected write failure"); } data.set(path, bytes.slice()); },
    writeText: async (path, text) => source.writeBytes!(path, new TextEncoder().encode(text)),
    createFile: async (path, bytes) => { if (data.has(path)) throw new Error("File already exists"); await source.writeBytes!(path, bytes); },
    removeFile: async path => { data.delete(path); }, assetUrl: async () => null,
    historyStore: { persistent: true, load: async () => structuredClone(history), save: async next => { history = structuredClone(next); } },
  };
  return { source, data, fail: (path: string) => { failPath = path; } };
}
for (const root of process.argv.slice(2)) test(`${root}: animation creation, assignment, copy-on-write, guards and atomic history`, async () => {
  const { source, data, fail } = await fixture(root), manager = createProjectHistoryManager(source);
  const doc = await loadAnimationEditDocument(source, null);
  assert.equal(doc.reason, null);
  const oldConstants = await source.readText("constants/move_constants.asm"), oldAnimations = await source.readText("data/moves/animations.asm"), oldMoves = await source.readText("data/moves/moves.asm");
  const values: AnimationEditValues = { constant: "TEST_SPIRAL_ANIM", steps: [
    { kind: "subanimation", targetId: 0, sheetId: 0, delay: 8, sound: "POUND" },
    { kind: "effect", targetId: doc.catalog.effects.find(effect => effect.constant === "SE_DARK_SCREEN_FLASH")!.id, sheetId: 0, delay: 0, sound: "NO_MOVE" },
  ], hook: null, assignMoveId: 1, confirmShared: false };
  const plan = await prepareAnimationWrites(source, doc, values);
  assert.equal(plan.animationId, doc.catalog.scripts.length + 1);
  assert.deepEqual(plan.changes.map(change => change.path).sort(), ["constants/move_constants.asm", "data/moves/animations.asm", "data/moves/moves.asm"]);
  await manager.save("Create test animation", plan.changes);
  const created = await loadAnimationEditDocument(source, plan.animationId);
  assert.equal(created.reason, null);
  assert.equal(created.catalog.moves[0].animation, values.constant);
  assert.equal(created.catalog.moves[0].animationLabel, "YellowEditor_TEST_SPIRAL_ANIM");
  assert.deepEqual(created.catalog.scripts.slice(0, doc.catalog.scripts.length).map(script => [script.id, script.constant, script.label]), doc.catalog.scripts.map(script => [script.id, script.constant, script.label]));
  const editValues = { ...values, assignMoveId: null, confirmShared: true };
  assert.deepEqual((await prepareAnimationWrites(source, created, editValues)).changes, [], "unchanged saves preserve exact source");
  const changed = { ...editValues, steps: [{ ...values.steps[0], delay: 12 }, values.steps[1]] };
  await manager.save("Edit test animation", (await prepareAnimationWrites(source, created, changed)).changes);
  assert.equal((await source.readText("data/moves/animations.asm")).match(/YellowEditor_TEST_SPIRAL_ANIM:/g)?.length, 1, "private edits do not append orphan blocks");
  await manager.undo();
  assert.equal((await loadAnimationEditDocument(source, plan.animationId)).catalog.scripts.at(-1)?.steps[0].delay, 8);
  await manager.undo();
  assert.equal(await source.readText("constants/move_constants.asm"), oldConstants); assert.equal(await source.readText("data/moves/animations.asm"), oldAnimations); assert.equal(await source.readText("data/moves/moves.asm"), oldMoves);
  await manager.redo(); await manager.undo();
  const pound = await loadAnimationEditDocument(source, 1), poundValues = { ...values, constant: "POUND", assignMoveId: null, confirmShared: true };
  await manager.save("Detach Pound from Struggle", (await prepareAnimationWrites(source, pound, poundValues)).changes);
  const detached = await loadAnimationEditDocument(source, 1);
  assert.notEqual(detached.catalog.scripts[0].label, "PoundAnim"); assert.equal(detached.catalog.scripts[164].label, "StruggleAnim");
  assert.deepEqual(detached.catalog.scripts[164].steps, doc.catalog.scripts[164].steps, "shared alias data stays unchanged");
  await manager.undo();
  await assert.rejects(prepareAnimationWrites(source, pound, { ...poundValues, confirmShared: false }), /Acknowledge/);
  await assert.rejects(prepareAnimationWrites(source, doc, { ...values, constant: "POUND" }), /already occurs/);
  await assert.rejects(prepareAnimationWrites(source, doc, { ...values, steps: [{ ...values.steps[0], delay: 64 }] }), /0 to 63/);
  await assert.rejects(prepareAnimationWrites(source, doc, { ...values, steps: [{ ...values.steps[0], sheetId: 3 }] }), /supported tile sheet/);
  await assert.rejects(prepareAnimationWrites(source, doc, { ...values, steps: [{ ...values.steps[0], sound: "TEST_SPIRAL_ANIM" }] }), /sound cue/);
  await source.writeText("data/moves/moves.asm", oldMoves + "\n; external edit\n");
  await assert.rejects(prepareAnimationWrites(source, doc, values), /sources changed/);
  await source.writeText("data/moves/moves.asm", oldMoves);
  fail("data/moves/moves.asm");
  await assert.rejects(manager.save("Failed creation", (await prepareAnimationWrites(source, doc, values)).changes), /Injected write failure/);
  assert.equal(await source.readText("constants/move_constants.asm"), oldConstants); assert.equal(await source.readText("data/moves/animations.asm"), oldAnimations);
  assert.ok(data.size > 100);
});

for (const root of process.argv.slice(2)) test(`${root}: independent trainer portraits allocate new source and undo without changing template`, async () => {
  const { source } = await fixture(root), manager = createProjectHistoryManager(source);
  const catalog = await loadGraphicsCatalog(source), template = catalog.assets.find(asset => asset.path === "gfx/trainers/youngster.png")!;
  const label = template.references.find(ref => ref.target.endsWith(".pic"))!.labels[0];
  const original = await source.readBytes(template.path);
  const layout = await source.readText("layout.link");
  const plan = await prepareTrainerPortraitCopy(source, "TEST_CLASS", label);
  await manager.save("Create private trainer portrait", plan.changes);
  assert.ok(await source.exists("gfx/trainers/test_class.png"));
  assert.ok(!(await source.readText("layout.link")).includes('"Trainer Pics"'), "the expanded picture section can be placed in a bank with room");
  assert.deepEqual(await source.readBytes(template.path), original);
  assert.ok((await loadGraphicsCatalog(source)).assets.some(asset => asset.path === "gfx/trainers/test_class.png" && asset.references.some(ref => ref.labels.includes(plan.label))));
  await assert.rejects(prepareTrainerPortraitCopy(source, "TEST_CLASS", label), /already exists/);
  await manager.undo(); assert.equal(await source.exists("gfx/trainers/test_class.png"), false); assert.equal(await source.readText("layout.link"), layout);
  await manager.redo(); assert.equal(await source.exists("gfx/trainers/test_class.png"), true);
});
