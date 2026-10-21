import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { test } from "node:test";
import { cp, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadMapTerrainDocument, prepareMapTerrainWrites, loadMapWarpDocument, prepareMapWarpWrites } from "../src/core/mapEditing";
import { createProjectSnapshot } from "../src/core/projectSnapshot";
import { createPackedProjectSource } from "../src/platform/packedProject";
import { bytesToHex, createProjectHistoryManager, hashText } from "../src/core/history";
import { createProjectSession } from "../src/core/project";
import type { HistoryState, ProjectSource, MapWarpValues } from "../src/core/types";

function fixture(root: string) {
  const overlay = new Map<string, Uint8Array>(); let state: HistoryState | null = null, fail: string | null = null;
  const source: ProjectSource = {
    displayPath: root, storageKey: root,
    exists: async path => path.endsWith(".png") ? false : path.endsWith(".2bpp") ? true : stat(join(root, path)).then(() => true, () => false),
    readBytes: async path => overlay.get(path)?.slice() ?? (path.endsWith(".2bpp") ? new Uint8Array(4096) : new Uint8Array(await readFile(join(root, path)))),
    readText: async path => new TextDecoder().decode(await source.readBytes(path)),
    writeBytes: async (path, bytes) => { if (fail === path) { fail = null; throw new Error("Injected write failure"); } overlay.set(path, bytes.slice()); },
    writeText: async (path, text) => source.writeBytes!(path, new TextEncoder().encode(text)),
    assetUrl: async () => null,
    historyStore: { persistent: true, load: async () => structuredClone(state), save: async next => { state = structuredClone(next); } },
  };
  return { source, overlay, fail: (path: string) => { fail = path; } };
}
const roots = process.argv.slice(2), romAt = roots.indexOf("--rom"), rgbds = romAt < 0 ? null : resolve(roots[romAt + 1]);
if (romAt >= 0) roots.splice(romAt, 2);
assert.ok(roots.length, "Supply Red/Yellow source directories.");
for (const directory of roots) {
  test(`${directory}: terrain, paired warps, stable IDs, source guards and history`, async () => {
    const { source, overlay, fail } = fixture(resolve(directory));
    const session = await createProjectSession(source, { inspect: async () => ({}), build: async () => ({}) } as never);
    const initial = await session.getMapVisualization("PALLET_TOWN");
    const doc = await session.getMapTerrainDocument("PALLET_TOWN");
    const values = { mapBlocks: doc.visualization.mapBlocks.slice(), blockset: doc.visualization.blockset.slice(), confirmSharedBlocks: false, confirmSharedLayout: false };
    assert.deepEqual(await prepareMapTerrainWrites(source, doc, values), []);
    values.mapBlocks[0] = (values.mapBlocks[0] + 1) % doc.visualization.blockCount;
    const originalBytes = await source.readBytes(doc.visualization.mapBlockPath);
    const saved = await session.saveMapTerrain(doc, values);
    assert.equal(saved.canUndo, true);
    assert.equal((await session.getMapVisualization("PALLET_TOWN")).mapBlocks[0], values.mapBlocks[0], "session must invalidate binary map cache");
    await session.undoLastSave(); assert.deepEqual(await source.readBytes(doc.visualization.mapBlockPath), originalBytes);
    assert.equal((await session.getMapVisualization("PALLET_TOWN")).mapBlocks[0], initial.mapBlocks[0]);
    await session.redoLastUndo(); assert.equal((await source.readBytes(doc.visualization.mapBlockPath))[0], values.mapBlocks[0]);
    await session.undoLastSave();
    values.blockset.push(...values.blockset.slice(0, 16)); values.mapBlocks[0] = values.blockset.length / 16 - 1;
    await assert.rejects(prepareMapTerrainWrites(source, doc, values), /Confirm.*block/);
    values.confirmSharedBlocks = true;
    const writes = await prepareMapTerrainWrites(source, doc, values);
    const history = createProjectHistoryManager(source);
    const beforeBlockset = await source.readBytes(doc.visualization.blocksetPath);
    fail(doc.visualization.blocksetPath);
    await assert.rejects(history.save("Paint custom house block", writes), /Injected/);
    assert.deepEqual(await source.readBytes(doc.visualization.mapBlockPath), originalBytes);
    assert.deepEqual(await source.readBytes(doc.visualization.blocksetPath), beforeBlockset);
    await history.save("Paint custom house block", writes);
    await history.undo(); await history.redo();
    assert.equal((await source.readBytes(doc.visualization.blocksetPath)).length, beforeBlockset.length + 16);
    const entry = (await history.getTimeline()).entries.at(-1)!;
    await history.selectivelyUndo(entry.id);
    assert.deepEqual(await source.readBytes(doc.visualization.blocksetPath), beforeBlockset);
    await assert.rejects(prepareMapTerrainWrites(source, doc, { ...values, mapBlocks: [-1] }), /dimensions/);
    await assert.rejects(prepareMapTerrainWrites(source, doc, { ...values, blockset: [...beforeBlockset, 1] }), /complete/);
    const invalid = { ...values, blockset: [...beforeBlockset] }; invalid.blockset[0] = 256;
    await assert.rejects(prepareMapTerrainWrites(source, doc, invalid), /Tile ID/);
    const old = await source.readText("maps.asm"); overlay.set("maps.asm", new TextEncoder().encode(old + "\n; external\n"));
    await assert.rejects(prepareMapTerrainWrites(source, doc, values), /sources changed/); overlay.delete("maps.asm");

    const entrance = await loadMapWarpDocument(source, "PALLET_TOWN"), target = await loadMapWarpDocument(source, "BLUES_HOUSE");
    const warp: MapWarpValues = { id: null, x: 1, y: 1, destinationMap: "BLUES_HOUSE", destinationWarpId: 1, destinationDocument: target, pair: { x: 1, y: 1 } };
    const pair = await prepareMapWarpWrites(source, entrance, warp);
    assert.equal(pair.length, 2);
    const oldSources = await Promise.all(pair.map(write => source.readText(write.path)));
    fail(pair[1].path); await assert.rejects(history.save("Create entrance and return", pair), /Injected/);
    for (let i = 0; i < pair.length; i++) assert.equal(await source.readText(pair[i].path), oldSources[i]);
    await history.save("Create entrance and return", pair);
    const next = await loadMapWarpDocument(source, "PALLET_TOWN"), nextTarget = await loadMapWarpDocument(source, "BLUES_HOUSE");
    assert.deepEqual(next.warps.slice(0, -1), entrance.warps);
    assert.deepEqual(nextTarget.warps.slice(0, -1), target.warps);
    assert.equal(next.warps.at(-1)!.destinationWarpId, nextTarget.warps.length);
    assert.equal(nextTarget.warps.at(-1)!.destinationWarpId, next.warps.length);
    assert.equal(nextTarget.warps.at(-1)!.destinationMap, "PALLET_TOWN");
    await history.undo(); await history.redo();
    await assert.rejects(prepareMapWarpWrites(source, entrance, warp), /sources changed/);
    await history.undo();
    await assert.rejects(prepareMapWarpWrites(source, entrance, { ...warp, x: -1 }), /Warp X/);
    await assert.rejects(prepareMapWarpWrites(source, entrance, { ...warp, x: 0.5 }), /whole/);
    await assert.rejects(prepareMapWarpWrites(source, entrance, { ...warp, x: entrance.warps[0].x, y: entrance.warps[0].y }), /already contains/);
    await assert.rejects(prepareMapWarpWrites(source, entrance, { ...warp, pair: null, destinationWarpId: 255 }), /Destination warp/);
    await assert.rejects(prepareMapWarpWrites(source, entrance, { ...warp, destinationMap: "LAST_MAP" }), /explicit/);
    const exit = await loadMapWarpDocument(source, "BLUES_HOUSE");
    const last = exit.warps.find(warp => warp.destinationMap === "LAST_MAP")!; assert.ok(last);
    assert.deepEqual(await prepareMapWarpWrites(source, exit, { ...last, id: last.id, destinationDocument: null, pair: null }), []);
    const text = oldSources[0].replace(/\n/g, "\r\n").replace(/(warp_event[^\r]+)\r/, "$1 ; keep this comment\r");
    overlay.set(pair[0].path, new TextEncoder().encode(text));
    const crlf = await loadMapWarpDocument(source, "PALLET_TOWN");
    const move = await prepareMapWarpWrites(source, crlf, { ...warp, id: 1, pair: null });
    assert.ok(move[0].contents.includes("; keep this comment\r\n")); assert.ok(!/(?<!\r)\n/.test(move[0].contents));
    assert.equal(move[0].contents.match(/warp_event/g)!.length, text.match(/warp_event/g)!.length);
    overlay.set(pair[0].path, new TextEncoder().encode(oldSources[0].replace("def_warp_events", "def_warp_events\n\tIF DEF(CUSTOM)")));
    await assert.rejects(loadMapWarpDocument(source, "PALLET_TOWN"), /Unsupported/);
  });
}

test("binary snapshots preserve all bytes and survive journal recovery", async () => {
  let bytes = Uint8Array.from({ length: 256 }, (_, i) => i), state: HistoryState | null = null;
  const source = { readBytes: async () => bytes, writeBytes: async (_path: string, next: Uint8Array) => { bytes = next; },
    historyStore: { persistent: true, load: async () => state, save: async (next: HistoryState) => { state = structuredClone(next); } } } as ProjectSource;
  const history = createProjectHistoryManager(source), before = bytes.slice(), after = before.slice().reverse();
  await history.save("Reverse bytes", [{ path: "test.blk", contents: bytesToHex(after), encoding: "hex", expectedHash: await hashText(bytesToHex(before)) }]);
  assert.deepEqual(bytes, after); await history.undo(); assert.deepEqual(bytes, before); await history.redo();
  state!.pending = { entryId: state!.entries[0].id, fromCursor: 0, toCursor: 1, direction: "after" };
  assert.equal((await createProjectHistoryManager(source).getSummary()).appliedCount, 1);
  bytes = new Uint8Array([255]); await assert.rejects(createProjectHistoryManager(source).undo(), /outside/);
});


test("Save As at a history point and packed projects preserve binary snapshots", async () => {
  let bytes = Uint8Array.of(0, 128, 255), state: HistoryState | null = null;
  const source = { displayPath: "Binary project", storageKey: "binary", listFiles: async () => ["map.blk"],
    readBytes: async () => bytes, writeBytes: async (_path: string, next: Uint8Array) => { bytes = next; },
    historyStore: { persistent: true, load: async () => state, save: async (next: HistoryState) => { state = structuredClone(next); } } } as ProjectSource;
  const history = createProjectHistoryManager(source);
  await history.save("Edit map", [{ path: "map.blk", encoding: "hex", contents: "ff8000" }]);
  const snapshot = await createProjectSnapshot(source, "pokemon", state!, 0);
  let persistedZip: Uint8Array | null = null, fail = false;
  const packed = await createPackedProjectSource({ archiveName: "map.zip", archiveBytes: snapshot.bytes, storageKey: "packed", historyStore: source.historyStore,
    persistArchive: async next => { if (fail) throw new Error("disk full"); persistedZip = next; } });
  assert.deepEqual(await packed.readBytes("map.blk"), Uint8Array.of(0, 128, 255));
  await packed.writeBytes!("map.blk", Uint8Array.of(255, 0, 128));
  const reopened = await createPackedProjectSource({ archiveName: "map.zip", archiveBytes: persistedZip!, storageKey: "packed2", historyStore: source.historyStore });
  assert.deepEqual(await reopened.readBytes("map.blk"), Uint8Array.of(255, 0, 128));
  fail = true; await assert.rejects(packed.writeBytes!("map.blk", Uint8Array.of(1)), /disk full/);
  assert.deepEqual(await packed.readBytes("map.blk"), Uint8Array.of(255, 0, 128));
});


if (rgbds) for (const directory of roots) test(`${directory}: compile a new house with entrance and return warps`, async () => {
  const root = resolve(directory), { source } = fixture(root);
  const outside = await loadMapTerrainDocument(source, "PALLET_TOWN");
  const layout = outside.visualization.mapBlocks.slice(), original = layout.slice();
  // Copy the player's house, including its working door, into a new 2x2 footprint.
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) layout[(5 + y) * 10 + 1 + x] = original[(1 + y) * 10 + 2 + x];
  const terrain = await prepareMapTerrainWrites(source, outside, { mapBlocks: layout, blockset: outside.visualization.blockset, confirmSharedBlocks: false, confirmSharedLayout: false });
  for (const write of terrain) await source.writeBytes!(write.path, Uint8Array.from(write.contents.match(/../g)!, hex => Number.parseInt(hex, 16)));
  const inside = await loadMapTerrainDocument(source, "BLUES_HOUSE"), insideLayout = inside.visualization.mapBlocks.slice();
  insideLayout[2 * 4 + 2] = insideLayout[3 * 4 + 1];
  const interior = await prepareMapTerrainWrites(source, inside, { mapBlocks: insideLayout, blockset: inside.visualization.blockset, confirmSharedBlocks: false, confirmSharedLayout: false });
  const entrance = await loadMapWarpDocument(source, "PALLET_TOWN"), destination = await loadMapWarpDocument(source, "BLUES_HOUSE");
  const warps = await prepareMapWarpWrites(source, entrance, { id: null, x: 3, y: 13, destinationMap: "BLUES_HOUSE", destinationWarpId: 1, destinationDocument: destination, pair: { x: 5, y: 5 } });
  const temporary = await mkdtemp(resolve("node_modules/.map-edit-rom-"));
  try {
    await cp(root, temporary, { recursive: true, filter: path => !path.split("/").includes(".git") });
    for (const write of [...terrain, ...interior, ...warps]) await writeFile(join(temporary, write.path), write.encoding === "hex" ? Uint8Array.from(write.contents.match(/../g)!, hex => Number.parseInt(hex, 16)) : write.contents);
    const target = root.includes("pokeyellow") ? "pokeyellow" : "pokered";
    const result = spawnSync("make", ["-j2", `RGBDS=${rgbds}/`, `${target}.gbc`], { cwd: temporary, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr.slice(-7000));
    const rom = await readFile(join(temporary, `${target}.gbc`)), symbols = await readFile(join(temporary, `${target}.sym`), "utf8");
    const offset = (name: string) => { const match = symbols.match(new RegExp(`^([0-9a-f]+):([0-9a-f]+) ${name}$`, "m"))!; assert.ok(match, name); const bank = Number.parseInt(match[1], 16), address = Number.parseInt(match[2], 16); return bank * 0x4000 + (address % 0x4000); };
    const outsideAt = offset("PalletTown_Object"), insideAt = offset("BluesHouse_Object");
    assert.equal(rom[outsideAt + 1], entrance.warps.length + 1);
    const newWarp = outsideAt + 2 + entrance.warps.length * 4;
    assert.deepEqual([...rom.subarray(newWarp, newWarp + 4)], [13, 3, destination.warps.length, destination.maps.find(map => map.constant === "BLUES_HOUSE")!.id]);
    const returnWarp = insideAt + 2 + destination.warps.length * 4;
    assert.deepEqual([...rom.subarray(returnWarp, returnWarp + 4)], [5, 5, entrance.warps.length, 0]);
    const blocksAt = offset("PalletTown_Blocks");
    assert.deepEqual([...rom.subarray(blocksAt, blocksAt + layout.length)], layout);
    console.log(`${directory}: compiled house blocks and reciprocal warp bytes verified in ROM`);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
