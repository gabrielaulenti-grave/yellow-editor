import assert from "node:assert/strict";
import { test } from "node:test";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadMapNpcCreateDocument, prepareMapNpcWrites } from "../src/core/npcCreation";
import { loadMapNpcEditDocument, prepareMapNpcEditWrites } from "../src/core/npcEditing";
import { loadScriptInteractionDocument, prepareScriptInteractionWrites } from "../src/core/scriptInteractions";
import { identifySequenceDialogue } from "../src/core/interactionSequence";
import { createProjectHistoryManager } from "../src/core/history";
import type { HistoryState, ProjectSource } from "../src/core/types";
const args = process.argv.slice(2), at = args.indexOf("--rom"), rgbds = at >= 0 ? resolve(args[at + 1]) : null;
if (at >= 0) args.splice(at, 2);
for (const directory of args) test(`${directory}: existing NPC editing`, async () => {
  const root = resolve(directory), overlay = new Map<string, string>(); let persisted: HistoryState | null = null, failPath: string | null = null;
  async function listFiles(folder = ""): Promise<string[]> {
    return (await Promise.all((await readdir(join(root, folder), { withFileTypes: true })).filter(entry => !entry.name.startsWith(".")).map(entry => entry.isDirectory() ? listFiles(join(folder, entry.name)) : [join(folder, entry.name)]))).flat();
  }
  const source: ProjectSource = { storageKey: "npc-edit-test", listFiles,
    readText: async path => overlay.get(path) ?? readFile(join(root, path), "utf8"), readBytes: async path => new Uint8Array(await readFile(join(root, path))),
    writeText: async (path, text) => { if (path === failPath) { failPath = null; throw new Error("Injected save failure"); } overlay.set(path, text); },
    historyStore: { persistent: false, load: async () => persisted, save: async state => { persisted = state; } },
    exists: async path => { try { await readFile(join(root, path)); return true; } catch { return false; } },
  };
  const add = await loadMapNpcCreateDocument(source, "ROUTE_1");
  (await prepareMapNpcWrites(source, add, { x: 6, y: 24, sprite: "SPRITE_YOUNGSTER", movement: "STAY", direction: "DOWN", dialogue: { kind: "new", lines: ["Hello there!"] } })).forEach(write => overlay.set(write.path, write.contents));
  const path = "data/maps/objects/Route1.asm", scriptPath = "scripts/Route1.asm", label = `Route1EditorNpc${add.objectId}Text`;
  const scriptBefore = await source.readText(scriptPath), objectBefore = await source.readText(path);
  const doc = await loadMapNpcEditDocument(source, "ROUTE_1", add.objectId);
  assert.equal(doc.reason, null); assert.equal(doc.values.x, 6); assert.equal(doc.objectConstant, `ROUTE_1_EDITOR_NPC_${add.objectId}`);
  const values = { ...doc.values, x: 7, y: 25, movement: "WALK" as const, direction: "LEFT_RIGHT", sprite: doc.sprites.find(sprite => sprite !== doc.values.sprite) ?? doc.values.sprite };
  const writes = await prepareMapNpcEditWrites(source, doc, values);
  assert.equal(writes.length, 1); assert.equal(writes[0].path, path);
  assert.equal(await source.readText(scriptPath), scriptBefore);
  assert.ok(writes[0].contents.includes(`object_event 7, 25, ${values.sprite}, WALK, LEFT_RIGHT, TEXT_ROUTE_1_EDITOR_NPC_${add.objectId}`));
  assert.equal(writes[0].contents.replace(`7, 25, ${values.sprite}, WALK, LEFT_RIGHT`, "6, 24, SPRITE_YOUNGSTER, STAY, DOWN"), objectBefore);
  assert.deepEqual(await prepareMapNpcEditWrites(source, doc, doc.values), []);
  await assert.rejects(() => prepareMapNpcEditWrites(source, doc, { ...values, x: 5, y: 24 }), /object, warp or sign/);
  await assert.rejects(() => prepareMapNpcEditWrites(source, doc, { ...values, x: 6, y: 23 }), /walkable/);
  await assert.rejects(() => prepareMapNpcEditWrites(source, doc, { ...values, x: -1 }), /inside/);
  await assert.rejects(() => prepareMapNpcEditWrites(source, doc, { ...values, x: 6.5 }), /whole-number/);
  await assert.rejects(() => prepareMapNpcEditWrites(source, doc, { ...values, sprite: "SPRITE_NURSE" }), /compatible/);
  overlay.set(scriptPath, scriptBefore + "\n; stale edit\n");
  await assert.rejects(() => prepareMapNpcEditWrites(source, doc, values), /sources changed/); overlay.set(scriptPath, scriptBefore);
  overlay.set(path, objectBefore.replace("object_event 6, 24,", "object_event  6 , 24," ).replace(`TEXT_ROUTE_1_EDITOR_NPC_${add.objectId}\n`, `TEXT_ROUTE_1_EDITOR_NPC_${add.objectId} ; retain comment\n`).replace(/\n/g, "\r\n"));
  const crlfDoc = await loadMapNpcEditDocument(source, "ROUTE_1", add.objectId);
  const crlfWrites = await prepareMapNpcEditWrites(source, crlfDoc, { ...crlfDoc.values, x: 7 });
  assert.match(crlfWrites[0].contents, /object_event  7 , 24,/); assert.ok(crlfWrites[0].contents.includes("; retain comment\r\n")); assert.ok(!/(?<!\r)\n/.test(crlfWrites[0].contents)); overlay.set(path, objectBefore);
  const ordinary = await loadMapNpcEditDocument(source, "ROUTE_1", 2); assert.equal(ordinary.reason, null);
  const ball = await loadMapNpcEditDocument(source, "ROUTE_2", 1); assert.match(ball.reason!, /Trainer and item/);
  const oak = await loadMapNpcEditDocument(source, "PALLET_TOWN", 1); assert.ok(oak.reason?.includes("script"));
  const filledIds = Array.from({ length: add.maxObjects - add.objectId }, (_, index) => index + add.objectId + 1);
  const fullObjects = objectBefore.replace("Route1_Object:", filledIds.map(id => `\tconst_export ROUTE1_FILLER_${id}\n`).join("") + "Route1_Object:")
    .replace("\tdef_warps_to", filledIds.map(id => `\tobject_event 0, ${id}, SPRITE_YOUNGSTER, STAY, DOWN, TEXT_ROUTE1_FILLER_${id}\n`).join("") + "\tdef_warps_to");
  const fullScript = scriptBefore.replace(/^([ \t]*dw_const[ \t]+Route1SignText,[ \t]*TEXT_ROUTE1_SIGN)/m, filledIds.map(id => `\tdw_const Route1Youngster2Text, TEXT_ROUTE1_FILLER_${id}\n`).join("") + "$1");
  overlay.set(path, fullObjects); overlay.set(scriptPath, fullScript);
  await assert.rejects(() => loadMapNpcCreateDocument(source, "ROUTE_1"), /available object slots/);
  const fullDoc = await loadMapNpcEditDocument(source, "ROUTE_1", add.objectId);
  assert.equal(fullDoc.reason, null);
  assert.equal((await prepareMapNpcEditWrites(source, fullDoc, { ...fullDoc.values, direction: "UP" })).length, 1);
  overlay.set(path, objectBefore); overlay.set(scriptPath, scriptBefore);
  const sceneDoc = await loadScriptInteractionDocument(source, scriptPath, label);
  (await prepareScriptInteractionWrites(source, sceneDoc, { ...sceneDoc.values, showOriginal: false, actions: identifySequenceDialogue([{ kind: "follow-npc", npc: doc.objectConstant, steps: ["RIGHT"] }, { kind: "dialogue", lines: ["We arrived!"] }]), scene: { trigger: "coordinate", playerX: 6, playerY: 25, idleState: 0, hiddenNpcs: [] } })).forEach(write => overlay.set(write.path, write.contents));
  const linked = await loadMapNpcEditDocument(source, "ROUTE_1", add.objectId);
  assert.equal(linked.reason, null); assert.equal(linked.linkedScenes.length, 1); assert.equal(linked.values.moveSceneStart, true);
  await assert.rejects(() => prepareMapNpcEditWrites(source, linked, { ...linked.values, movement: "WALK", direction: "ANY_DIR" }), /must stay stationary/);
  await assert.rejects(() => prepareMapNpcEditWrites(source, linked, { ...linked.values, y: 25, moveSceneStart: false }), /interaction.*invalid/);
  const sceneBefore = await source.readText(scriptPath);
  const movedScene = await prepareMapNpcEditWrites(source, linked, { ...linked.values, y: 25 });
  assert.equal(movedScene.length, 2);
  const history = createProjectHistoryManager(source);
  failPath = scriptPath;
  await assert.rejects(() => history.save("Move NPC", movedScene), /Injected save failure/);
  assert.equal(await source.readText(path), objectBefore); assert.equal(await source.readText(scriptPath), sceneBefore);
  await history.save("Move NPC", movedScene);
  const movedDoc = await loadScriptInteractionDocument(source, scriptPath, label);
  assert.equal(movedDoc.values.scene?.playerY, 26); assert.equal(movedDoc.values.scene?.playerX, 6);
  assert.deepEqual(movedDoc.values.actions, (await loadScriptInteractionDocument({ ...source, readText: async p => p === scriptPath ? sceneBefore : source.readText(p) }, scriptPath, label)).values.actions);
  const metadata = JSON.parse((await source.readText(scriptPath)).match(/yellow-editor-interaction: (.*)/)![1]);
  assert.equal(metadata.scene.actors.find((actor: { constant: string }) => actor.constant === doc.objectConstant).y, 25);
  assert.equal(metadata.scene.nodes.find((node: { kind: string }) => node.kind === "npc-start").from.y, 25);
  await history.undo(); assert.equal(await source.readText(path), objectBefore); assert.equal(await source.readText(scriptPath), sceneBefore);
  await history.redo(); assert.equal((await loadMapNpcEditDocument(source, "ROUTE_1", add.objectId)).values.y, 25);
  // Moving an unrelated actor into a walking route must be refused too.
  const blocker = await loadMapNpcEditDocument(source, "ROUTE_1", 2);
  await assert.rejects(() => prepareMapNpcEditWrites(source, blocker, { ...blocker.values, x: 7, y: 25 }), /interaction.*invalid/);
  await assert.rejects(() => prepareMapNpcEditWrites(source, blocker, { ...blocker.values, x: 6, y: 26, movement: "STAY", direction: "DOWN" }), /player start or coordinate trigger/);
  if (rgbds) {
    const temporary = await mkdtemp(resolve("node_modules/.npc-edit-rom-"));
    try {
      const game = join(temporary, "game"); await cp(root, game, { recursive: true, filter: path => !path.split("/").includes(".git") });
      const target = root.includes("pokeyellow") ? "pokeyellow" : "pokered";
      const run = (args: string[]) => { const result = spawnSync("make", args, { cwd: game, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }); assert.equal(result.status, 0, result.stderr.slice(-7000)); };
      run(["clean"]); run(["-j2", `RGBDS=${rgbds}/`, `${target}.gbc`]);
      const baseline = await readFile(join(game, `${target}.sym`), "utf8");
      for (const [path, text] of overlay) await writeFile(join(game, path), text);
      run(["clean"]); run(["-j2", `RGBDS=${rgbds}/`, `${target}.gbc`]);
      const edited = await readFile(join(game, `${target}.sym`), "utf8");
      const symbols = (text: string) => new Map([...text.matchAll(/^00:([cd][a-f0-9]{3}) (w\w+)$/gm)].map(match => [match[2], match[1]]));
      const modified = symbols(edited); for (const [name, address] of symbols(baseline)) assert.equal(modified.get(name), address, name);
      console.log(`${directory}: moved NPC and recompiled following scene build as a complete ROM with unchanged WRAM`);
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }
  console.log(`${directory}: stable IDs/dialogue, placement, sprite/facing, linked scenes, blockers, stale forms, CRLF, rollback and atomic undo/redo passed`);
});
