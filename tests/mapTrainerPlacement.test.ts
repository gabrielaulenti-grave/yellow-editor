import assert from "node:assert/strict";
import { test } from "node:test";
import { cp, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createProjectSession } from "../src/core/project";
import { loadMapNpcCreateDocument, prepareMapNpcWrites } from "../src/core/npcCreation";
import { loadScriptInteractionDocument, prepareScriptInteractionWrites } from "../src/core/scriptInteractions";
import { mapTrainerCpuProbes } from "./mapTrainerCpuProbes";
import { trainerPlacementError, prepareMapTrainerWrites, trainerDelta } from "../src/core/mapTrainers";
import { trainerResumeHook, trainerFrameHook, type MapTrainerModel } from "../src/core/mapTrainerRuntime";
import { projectConstantCatalogFromSources } from "../src/core/projectConstants";
import type { ProjectSource, HistoryState } from "../src/core/types";
const args = process.argv.slice(2), at = args.indexOf("--rom"), rgbds = at < 0 ? null : resolve(args[at + 1]), binjgb = at < 0 ? null : resolve(args[at + 2]);
if (at >= 0) args.splice(at, 3);
assert.ok(args.length, "Supply Red/Yellow source directories.");
async function fixture(root: string) {
  const files: string[] = [], overlay = new Map<string, Uint8Array>(), removed = new Set<string>(); let journal: HistoryState | null = null, fail: string | null = null;
  async function collect(folder = "") { for (const e of await readdir(join(root, folder), { withFileTypes: true })) { if (e.name.startsWith(".")) continue; const p = join(folder, e.name); if (e.isDirectory()) await collect(p); else files.push(p); } }
  await collect();
  const source: ProjectSource = { displayPath: root, storageKey: root,
    listFiles: async () => [...new Set([...files, ...overlay.keys()])].filter(p => !removed.has(p)),
    exists: async p => !removed.has(p) && (overlay.has(p) || (p.endsWith(".png") ? false : p.endsWith(".2bpp") ? true : await stat(join(root, p)).then(() => true, () => false))),
    readBytes: async p => { if (removed.has(p)) throw new Error("missing " + p); return overlay.get(p)?.slice() ?? (p.endsWith(".2bpp") ? new Uint8Array(4096) : new Uint8Array(await readFile(join(root, p)))); },
    readText: async p => new TextDecoder().decode(await source.readBytes(p)),
    writeBytes: async (p, bytes) => { if (p === fail) { fail = null; throw new Error("Injected write failure"); } overlay.set(p, bytes.slice()); },
    writeText: async (p, text) => source.writeBytes!(p, new TextEncoder().encode(text)),
    createFile: async (p, bytes) => { if (await source.exists(p)) throw new Error("already exists"); await source.writeBytes!(p, bytes); removed.delete(p); },
    removeFile: async p => { overlay.delete(p); removed.add(p); }, assetUrl: async () => null,
    historyStore: { persistent: true, load: async () => structuredClone(journal), save: async j => { journal = structuredClone(j); } },
  };
  return { source, overlay, failNext: (p: string) => { fail = p; } };
}
for (const directory of args) test(`${directory}: place independent native trainers alongside encounters, pickups and scenes`, async () => {
  const root = resolve(directory), { source, overlay, failNext } = await fixture(root), session = await createProjectSession(source, {} as never);
  const native = await session.getTrainerBaseCatalog(), originalParties = await source.readText("data/trainers/parties.asm");
  const creation = await session.getMapCreateDocument("ROCK_TUNNEL_B1F");
  await session.createMap(creation, { constant: "TRAINER_TEST_CAVE", width: creation.visualization.map.width, height: creation.visualization.map.height, layout: "copy", fillBlock: 0, borderBlock: creation.borderBlock, musicMap: "DIGLETTS_CAVE", locationMap: "VERMILION_CITY", connection: null });
  const encounters = await session.getMapEncounterDocument("TRAINER_TEST_CAVE");
  await session.assignMapEncounters(encounters, { mode: "copy", tablePath: "data/wild/maps/DiglettsCave.asm" });
  const item = await session.getMapItemDocument("TRAINER_TEST_CAVE");
  await session.placeMapItem(item, { x: 0, y: 0, item: "POTION", quantity: 1 });
  let doc = await session.getMapTrainerDocument("TRAINER_TEST_CAVE");
  assert.equal(doc.objectId, null); assert.equal(doc.values.copyParty, true);
  let values = { ...doc.values, sight: 3, partyId: root.includes("pokeyellow") ? "YOUNGSTER:14" : "LANCE:1" };
  let found = false;
  for (const point of doc.walkable) { for (const facing of Object.keys(trainerDelta) as Array<keyof typeof trainerDelta>) { const v = { ...values, ...point, facing }; if (!trainerPlacementError(doc, v)) { values = v; found = true; break; } } if (found) break; }
  assert.ok(found, "native Rock Tunnel terrain has a safe three-tile sight corridor");
  assert.match(trainerPlacementError(doc, { ...values, sight: 9 })!, /sight range/);
  await assert.rejects(prepareMapTrainerWrites(source, doc, { ...values, before: ["A".repeat(19)] }), /dialogue/);
  await assert.rejects(prepareMapTrainerWrites(source, doc, { ...values, partyId: "HIKER:255" }), /existing trainer/);
  const firstId = doc.npc.objectId, originalSelected = doc.parties.find(p => p.id === values.partyId)!;
  const beforeEvents = await source.readText("constants/event_constants.asm"), beforeMoves = await source.readText("data/trainers/special_moves.asm");
  failNext("constants/event_constants.asm");
  await assert.rejects(session.saveMapTrainer(doc, values), /Injected/);
  assert.equal(await source.readText("data/trainers/parties.asm"), originalParties);
  assert.equal(await source.readText("constants/event_constants.asm"), beforeEvents);
  assert.equal(await source.readText("data/trainers/special_moves.asm"), beforeMoves);
  assert.ok(!(await source.readText("scripts/TrainerTestCave.asm")).includes("yellow-editor-map-trainers:"));
  await session.saveMapTrainer(doc, values);
  const first = (await session.getMapVisualization("TRAINER_TEST_CAVE")).npcs.find(n => n.id === firstId)!;
  assert.ok(first.trainerPartyId); assert.notEqual(first.trainerPartyId, values.partyId);
  const catalog = await session.getTrainerBaseCatalog(), copied = catalog.trainers.find(p => p.id === first.trainerPartyId)!;
  assert.deepEqual(copied.pokemon.map(p => ({ level: p.level, species: p.speciesConstant, moves: p.specialMoves.map(m => [m.moveConstant, m.moveSlot]) })), originalSelected.pokemon.map(p => ({ level: p.level, species: p.speciesConstant, moves: p.specialMoves.map(m => [m.moveConstant, m.moveSlot]) })));
  if (root.includes("pokeyellow")) assert.ok(copied.specialMoves.every(m => m.sourceKey === copied.id), "copied move overrides belong to the new party");
  assert.equal(catalog.trainers.length, native.trainers.length + 1);
  assert.ok(native.trainers.every(t => catalog.trainers.find(n => n.id === t.id)?.pokemon.map(p => p.speciesConstant).join() === t.pokemon.map(p => p.speciesConstant).join()));
  const scriptPath = "scripts/TrainerTestCave.asm";
  const model = () => JSON.parse((overlay.has(scriptPath) ? new TextDecoder().decode(overlay.get(scriptPath)) : "").match(/; yellow-editor-map-trainers: (.+)/)![1]) as MapTrainerModel;
  const event = model().trainers[0].event, flagSources = () => projectConstantCatalogFromSources([{ path: "constants/event_constants.asm", contents: new TextDecoder().decode(overlay.get("constants/event_constants.asm")) }]).constants;
  assert.equal(flagSources().find(e => e.symbol === event)!.value % 8, firstId % 8);
  doc = await session.getMapTrainerDocument("TRAINER_TEST_CAVE", firstId);
  assert.equal((await prepareMapTrainerWrites(source, doc, doc.values)).length, 0, "unchanged trainer save is a no-op");
  await session.saveMapTrainer(doc, { ...doc.values, after: ["Great match!"] }); assert.equal(model().trainers[0].event, event);
  await session.undoLastSave(); assert.deepEqual(model().trainers[0].values.after, values.after); await session.redoLastUndo();
  // Fill IDs 3–9, then place ID 10: same bit index as ID 2, in a different event byte.
  const reserved = [values, ...Array.from({ length: values.sight }, (_, i) => ({ x: values.x + trainerDelta[values.facing].x * (i + 1), y: values.y + trainerDelta[values.facing].y * (i + 1) }))];
  let fillerLabel = "", fillerObject = "";
  while ((await loadMapNpcCreateDocument(source, "TRAINER_TEST_CAVE")).objectId < firstId + 8) {
    const n = await loadMapNpcCreateDocument(source, "TRAINER_TEST_CAVE");
    const p = doc.walkable.find(p => !n.occupied.some(o => p.x === o.x && p.y === o.y) && !reserved.some(o => p.x === o.x && p.y === o.y) && doc.walkable.some(q => q.x === p.x && q.y === p.y + 1 && !n.occupied.some(o => o.x === q.x && o.y === q.y)))!;
    const writes = await prepareMapNpcWrites(source, n, { ...p, sprite: values.sprite, movement: "STAY", direction: "DOWN", dialogue: { kind: "new", lines: ["Hello!"] } });
    await session.saveTextChanges("Place scene actor", writes);
    fillerLabel = `TrainerTestCaveEditorNpc${n.objectId}Text`; fillerObject = `TRAINER_TEST_CAVE_EDITOR_NPC_${n.objectId}`;
  }
  let second = await session.getMapTrainerDocument("TRAINER_TEST_CAVE");
  const p2 = second.walkable.find(p => !second.occupied.some(o => p.x === o.x && p.y === o.y) && !reserved.some(o => p.x === o.x && p.y === o.y))!;
  await session.saveMapTrainer(second, { ...second.values, ...p2, copyParty: false, sight: 0, partyId: first.trainerPartyId! });
  assert.equal(model().trainers.length, 2);
  const defs = flagSources(), bits = model().trainers.map(t => defs.find(c => c.symbol === t.event)!.value);
  assert.notEqual(bits[0], bits[1]); assert.equal(bits[0] % 8, bits[1] % 8);
  assert.notEqual((bits[0] - firstId) / 8, (bits[1] - second.npc.objectId) / 8, "trainers have different flag bases; completion must select the engaged header");
  const scan = await session.getTrainers();
  const placed = scan.trainers.find(t => t.id === first.trainerPartyId)!.instances.filter(i => i.mapConstant === "TRAINER_TEST_CAVE");
  assert.equal(placed.length, 2); assert.equal(placed.find(i => i.objectConstant === first.objectConstant)!.viewRange, 3);
  assert.equal(placed.find(i => i.objectConstant === first.objectConstant)!.dialogue.after?.text, "Great match!");
  // The next allocation must honor ordinary object IDs and preserve scene hooks.
  const actor = (await session.getMapVisualization("TRAINER_TEST_CAVE")).npcs.find(n => n.objectConstant === fillerObject)!;
  const scene = await loadScriptInteractionDocument(source, scriptPath, fillerLabel);
  assert.equal(scene.scene.reason, null); assert.equal(scene.effects.battleReason, null);
  const occupiedNow = (await loadMapNpcCreateDocument(source, "TRAINER_TEST_CAVE")).occupied;
  const start = Object.values(trainerDelta).map(delta => ({ x: actor.x + delta.x, y: actor.y + delta.y })).find(p => doc.walkable.some(w => w.x === p.x && w.y === p.y) && !occupiedNow.some(o => o.x === p.x && o.y === p.y))!;
  assert.ok(start);
  const sceneValues = { ...scene.values, once: false, actions: [{ kind: "dialogue" as const, lines: ["Keep exploring!"] }], scene: { trigger: "interaction" as const, playerX: start.x, playerY: start.y, idleState: 0, hiddenNpcs: [] } };
  await session.saveScriptInteraction(scene, sceneValues);
  doc = await session.getMapTrainerDocument("TRAINER_TEST_CAVE", firstId);
  assert.equal(doc.values.after[0], "Great match!");
  const script = await source.readText(scriptPath); assert.ok(script.indexOf(trainerResumeHook("TrainerTestCave")) < script.indexOf("; yellow-editor-scene-hook "));
  assert.ok(script.indexOf("; yellow-editor-scene-hook ") < script.indexOf(trainerFrameHook("TrainerTestCave")));
  const sceneAgain = await loadScriptInteractionDocument(source, scriptPath, fillerLabel); await session.saveScriptInteraction(sceneAgain, sceneAgain.values);
  const placedDoc = await session.getMapTrainerDocument("TRAINER_TEST_CAVE", firstId);
  await assert.rejects(prepareMapTrainerWrites(source, placedDoc, { ...placedDoc.values, ...start, sight: 0 }), /player start/);
  const nextPoint = placedDoc.walkable.find(p => (p.x !== placedDoc.values.x || p.y !== placedDoc.values.y) && (p.x !== start.x || p.y !== start.y) && !trainerPlacementError(placedDoc, { ...placedDoc.values, ...p }))!;
  assert.ok(nextPoint);
  await session.saveMapTrainer(placedDoc, { ...placedDoc.values, ...nextPoint });
  const savedScene = [...(await source.readText(scriptPath)).matchAll(/; yellow-editor-interaction: (.+)/g)].map(m => JSON.parse(m[1])).find(m => m.label === fillerLabel);
  assert.ok(savedScene.scene.frozen.includes(firstId), "native trainers stay frozen while scenes run");
  assert.equal((await session.getMapVisualization("TRAINER_TEST_CAVE")).npcs.find(n => n.objectConstant === first.objectConstant)!.x, nextPoint.x);
  assert.equal(model().trainers[0].event, event);
  const noOp = await session.getMapTrainerDocument("TRAINER_TEST_CAVE", firstId);
  assert.equal((await prepareMapTrainerWrites(source, noOp, noOp.values)).length, 0);
  const stale = await session.getMapTrainerDocument("TRAINER_TEST_CAVE", firstId);
  await source.writeText("data/trainers/parties.asm", (await source.readText("data/trainers/parties.asm")) + "\n; external\n");
  await assert.rejects(prepareMapTrainerWrites(source, stale, stale.values), /sources changed/);
  // Restore just the comment without changing the authored party data.
  await source.writeText("data/trainers/parties.asm", (await source.readText("data/trainers/parties.asm")).replace(/\n; external\n$/, ""));
  if (rgbds && binjgb) {
    const temp = await mkdtemp(resolve("node_modules/.map-trainer-rom-"));
    try {
      await cp(root, temp, { recursive: true, filter: p => !p.split("/").includes(".git") });
      for (const [p, bytes] of overlay) await writeFile(join(temp, p), bytes);
      const target = root.includes("pokeyellow") ? "pokeyellow" : "pokered";
      const r = spawnSync("make", ["-j2", `RGBDS=${rgbds}/`, `${target}.gbc`], { cwd: temp, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }); assert.equal(r.status, 0, r.stderr.slice(-7000));
      const run = (cmd: string, args: string[]) => { const r = spawnSync(cmd, args, { cwd: temp, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }); assert.equal(r.status, 0, r.stderr.slice(-7000) + r.stdout.slice(-1000)); return r.stdout; };
      await mapTrainerCpuProbes(temp, rgbds, binjgb, model(), run);
      console.log(`${root}: native trainer dispatcher/defeat/blackout CPU probes passed`);
      console.log(`${root}: complete new-cave ROM with two native trainers, item, encounters and a scene compiled`);
    } finally { await rm(temp, { recursive: true, force: true }); }
  }
});
