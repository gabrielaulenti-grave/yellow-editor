import { loadMapNpcCreateDocument } from "../src/core/npcCreation";
import "./projectFileLifecycle.test";
import assert from "node:assert/strict";
import { test } from "node:test";
import { cp, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { loadMapCreateDocument, prepareMapCreateWrites, mapSourceName } from "../src/core/mapCreation";
import { loadMapVisualization, parseMapIndex } from "../src/core/mapVisualization";
import { loadMapWarpDocument } from "../src/core/mapEditing";
import { createProjectHistoryManager, hexToBytes } from "../src/core/history";
import { createProjectSnapshot } from "../src/core/projectSnapshot";
import { createPackedProjectSource } from "../src/platform/packedProject";
import { createProjectSession } from "../src/core/project";
import type { HistoryState, MapCreateValues, ProjectSource } from "../src/core/types";

const args = process.argv.slice(2), romAt = args.indexOf("--rom"), rgbds = romAt < 0 ? null : resolve(args[romAt + 1]);
if (romAt >= 0) args.splice(romAt, 2);
assert.ok(args.length, "Supply Red/Yellow source directories.");
async function fixture(root: string) {
  const overlay = new Map<string, Uint8Array>(), removed = new Set<string>(), diskFiles: string[] = [];
  let history: HistoryState | null = null, failure: string | null = null;
  async function collect(folder = "") {
    for (const entry of await readdir(join(root, folder), { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const path = join(folder, entry.name); if (entry.isDirectory()) await collect(path); else diskFiles.push(path);
    }
  }
  await collect();
  const source: ProjectSource = { displayPath: root, storageKey: root,
    exists: async path => removed.has(path) ? false : overlay.has(path) ? true : path.endsWith(".png") ? false : path.endsWith(".2bpp") ? true : stat(join(root, path)).then(() => true, () => false),
    readBytes: async path => { if (removed.has(path)) throw new Error("missing " + path); return overlay.get(path)?.slice() ?? (path.endsWith(".2bpp") ? new Uint8Array(4096) : new Uint8Array(await readFile(join(root, path)))); },
    readText: async path => new TextDecoder().decode(await source.readBytes(path)),
    writeText: async (path, text) => source.writeBytes!(path, new TextEncoder().encode(text)),
    writeBytes: async (path, bytes) => { if (failure === path) { failure = null; throw new Error("Injected write failure"); } overlay.set(path, bytes.slice()); },
    createFile: async (path, bytes) => { if (await source.exists(path)) throw new Error("already exists " + path); await source.writeBytes!(path, bytes); removed.delete(path); },
    removeFile: async path => { if (!await source.exists(path)) throw new Error("missing " + path); overlay.delete(path); removed.add(path); },
    listFiles: async () => [...new Set([...diskFiles, ...overlay.keys()])].filter(path => !removed.has(path)),
    assetUrl: async () => null,
    historyStore: { persistent: true, load: async () => structuredClone(history), save: async next => { history = structuredClone(next); } },
  };
  return { source, overlay, fail: (path: string) => { failure = path; } };
}
for (const directory of args) test(`${directory}: independent maps, registries, linked warps and file lifecycle`, async () => {
  const { source, overlay, fail } = await fixture(resolve(directory));
  const before = await parseMapIndex(source), doc = await loadMapCreateDocument(source);
  const values: MapCreateValues = { constant: "PALLET_NEW_HOUSE", width: doc.visualization.map.width, height: doc.visualization.map.height, layout: "copy", fillBlock: 1, borderBlock: doc.borderBlock, locationMap: "PALLET_TOWN", musicMap: "PALLET_TOWN", connection: { exteriorMap: "PALLET_TOWN", exteriorX: 3, exteriorY: 13, interiorX: 2, interiorY: 7 } };
  const writes = await prepareMapCreateWrites(source, doc, values), creates = writes.filter(write => write.operation === "create");
  assert.equal(creates.length, 4); assert.equal(new Set(writes.map(write => write.path)).size, writes.length);
  assert.ok(!writes.some(write => write.path.includes("wram")), "new empty maps must not shift WRAM/save layout");
  const original = new Map(await Promise.all(writes.filter(write => !write.operation).map(async write => [write.path, await source.readText(write.path)] as const)));
  const history = createProjectHistoryManager(source);
  fail(creates[2].path); await assert.rejects(history.save("Create map", writes), /Injected/);
  for (const write of creates) assert.equal(await source.exists(write.path), false);
  for (const [path, text] of original) assert.equal(await source.readText(path), text);
  await history.save("Create map", writes);
  let index = await parseMapIndex(source);
  assert.deepEqual(index.slice(0, before.length), before); assert.equal(index.at(-1)!.constant, values.constant); assert.equal(index.at(-1)!.id, before.length);
  const view = await loadMapVisualization(source, values.constant);
  assert.deepEqual(view.mapBlocks, doc.visualization.mapBlocks); assert.deepEqual(view.npcs, []); assert.deepEqual(view.signs, []); assert.equal(view.warps.length, 1);
  assert.equal((await loadMapNpcCreateDocument(source, values.constant)).objectId, 1, "new maps support the existing NPC creation tools");
  assert.equal(view.warps[0].destinationMapConstant, "PALLET_TOWN"); assert.equal(view.warps[0].destinationWarpId, 4);
  assert.equal((await loadMapWarpDocument(source, "PALLET_TOWN")).warps.at(-1)!.destinationMap, values.constant);
  const snapshot = await createProjectSnapshot(source, "pokemon", await history.getState(), 0);
  const packed = await createPackedProjectSource({ archiveName: "project.zip", archiveBytes: snapshot.bytes, storageKey: "copy" });
  for (const write of creates) assert.equal(await packed.exists(write.path), false, "historical Save As omits maps created later");
  await history.undo(); assert.deepEqual(await parseMapIndex(source), before);
  for (const write of creates) assert.equal(await source.exists(write.path), false);
  const future = await createProjectSnapshot(source, "pokemon", await history.getState(), 1);
  const futurePacked = await createPackedProjectSource({ archiveName: "future.zip", archiveBytes: future.bytes, storageKey: "future" });
  for (const write of creates) assert.equal(await futurePacked.exists(write.path), true, "Save As can reconstruct files from the redo branch");
  await history.redo();
  await history.selectivelyUndo((await history.getTimeline()).entries.at(-1)!.id);
  assert.deepEqual(await parseMapIndex(source), before);
  for (const write of creates) assert.equal(await source.exists(write.path), false);
  await assert.rejects(prepareMapCreateWrites(source, doc, { ...values, constant: "BLUES_HOUSE" }), /already used/);
  await assert.rejects(prepareMapCreateWrites(source, doc, { ...values, constant: "../BAD" }), /unique map constant/);
  await assert.rejects(prepareMapCreateWrites(source, doc, { ...values, layout: "blank", width: 64, height: 64 }), /1300/);
  await assert.rejects(prepareMapCreateWrites(source, doc, { ...values, width: 6 }), /dimensions/);
  await assert.rejects(prepareMapCreateWrites(source, doc, { ...values, connection: { ...values.connection!, exteriorX: 5, exteriorY: 5 } }), /already contains/);
  overlay.set("data/maps/songs.asm", new TextEncoder().encode((await source.readText("data/maps/songs.asm")) + "\n; outside edit\n"));
  await assert.rejects(prepareMapCreateWrites(source, doc, values), /sources changed/); overlay.delete("data/maps/songs.asm");
  // Session cache invalidation and blank custom dimensions.
  const session = await createProjectSession(source, {} as never);
  await session.getMapIndex(); const blank = await session.getMapCreateDocument();
  const created = await session.createMap(blank, { ...values, constant: "TEST_EMPTY_ROOM", layout: "blank", width: 5, height: 6, connection: null });
  assert.equal((await session.getMapIndex()).at(-1)!.constant, created.mapConstant);
  const empty = await session.getMapVisualization(created.mapConstant); assert.equal(empty.mapBlocks.length, 30); assert.ok(empty.mapBlocks.every(id => id === 1)); assert.equal(empty.warps.length, 0);
  await session.undoLastSave(); assert.equal((await session.getMapIndex()).length, before.length); await session.redoLastUndo();
});

test("packed project additions, deletions, persistence and rollback", async () => {
  const files = new Map([ ["main.asm", new TextEncoder().encode("; main")], ["Makefile", new Uint8Array()] ]);
  const source = { displayPath: "source", listFiles: async () => [...files.keys()], readBytes: async (path: string) => files.get(path)! } as ProjectSource;
  const archive = await createProjectSnapshot(source, "pokemon", { version: 1, cursor: 0, entries: [], pending: null });
  let saved: Uint8Array | null = null, fail = false;
  const packed = await createPackedProjectSource({ archiveName: "project.zip", archiveBytes: archive.bytes, storageKey: "packed", persistArchive: async next => { if (fail) throw new Error("disk full"); saved = next; } });
  const history = createProjectHistoryManager(packed);
  await history.save("Create files", [{ path: "maps/Test.blk", contents: "0080ff", encoding: "hex", operation: "create" }, { path: "scripts/Test.asm", contents: "ret\n", operation: "create" }]);
  const reopened = await createPackedProjectSource({ archiveName: "project.zip", archiveBytes: saved!, storageKey: "reopened" });
  assert.deepEqual(await reopened.readBytes("maps/Test.blk"), Uint8Array.of(0, 128, 255));
  assert.ok((await reopened.listFiles!()).includes("scripts/Test.asm"));
  await assert.rejects(history.save("Collision", [{ path: "main.asm", contents: "oops", operation: "create" }]), /already exists/);
  await history.undo(); assert.equal(await packed.exists("maps/Test.blk"), false); await history.redo();
  fail = true; await assert.rejects(packed.removeFile!("maps/Test.blk"), /disk full/); assert.equal(await packed.exists("maps/Test.blk"), true);
  await assert.rejects(packed.createFile!("new.asm", Uint8Array.of(255)), /disk full/); assert.equal(await packed.exists("new.asm"), false);
});

if (rgbds) for (const directory of args) test(`${directory}: compile independently created map and links`, async () => {
  const root = resolve(directory), { source } = await fixture(root), doc = await loadMapCreateDocument(source);
  const values: MapCreateValues = { constant: "PALLET_NEW_HOUSE", width: doc.visualization.map.width, height: doc.visualization.map.height, layout: "copy", fillBlock: 1, borderBlock: doc.borderBlock, locationMap: "PALLET_TOWN", musicMap: "PALLET_TOWN", connection: { exteriorMap: "PALLET_TOWN", exteriorX: 3, exteriorY: 13, interiorX: 2, interiorY: 7 } };
  const writes = await prepareMapCreateWrites(source, doc, values);
  const temporary = await mkdtemp(resolve("node_modules/.map-create-rom-"));
  try {
    await cp(root, temporary, { recursive: true, filter: path => !path.split("/").includes(".git") });
    for (const write of writes) await writeFile(join(temporary, write.path), write.encoding === "hex" ? hexToBytes(write.contents) : write.contents);
    const target = root.includes("pokeyellow") ? "pokeyellow" : "pokered";
    const result = spawnSync("make", ["-j2", `RGBDS=${rgbds}/`, `${target}.gbc`], { cwd: temporary, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr.slice(-10000));
    const rom = await readFile(join(temporary, `${target}.gbc`)), symbols = await readFile(join(temporary, `${target}.sym`), "utf8");
    const symbol = (name: string) => { const match = symbols.match(new RegExp(`^([0-9a-f]+):([0-9a-f]+) ${name}$`, "m")); assert.ok(match, name); const bank = Number.parseInt(match[1], 16), address = Number.parseInt(match[2], 16); return { bank, address, offset: bank * 0x4000 + address % 0x4000 }; };
    const name = mapSourceName(values.constant), header = symbol(`${name}_h`), blocks = symbol(`${name}_Blocks`), objects = symbol(`${name}_Object`), script = symbol(`${name}_Script`);
    assert.equal(header.bank, blocks.bank); assert.equal(header.bank, objects.bank); assert.equal(header.bank, script.bank);
    const id = doc.nextId, pointers = symbol("MapHeaderPointers").offset + id * 2, banks = symbol("MapHeaderBanks").offset + id;
    assert.equal(rom.readUInt16LE(pointers), header.address); assert.equal(rom[banks], header.bank);
    assert.deepEqual([...rom.subarray(blocks.offset, blocks.offset + 16)], doc.visualization.mapBlocks);
    assert.deepEqual([...rom.subarray(objects.offset + 1, objects.offset + 6)], [1, 7, 2, 3, 0]);
    const entrance = symbol("PalletTown_Object").offset + 2 + 3 * 4;
    assert.deepEqual([...rom.subarray(entrance, entrance + 4)], [13, 3, 0, id]);
    assert.equal(rom[symbol("MapSongBanks").offset + id * 2], rom[symbol("MapSongBanks").offset]);
    assert.equal(rom.readUInt16LE(symbol("WildDataPointers").offset + id * 2), symbol("NothingWildMons").address);
    console.log(`${directory}: independently banked map, pointers, music, encounters and bidirectional warp records verified in ROM`);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("creation journals distinguish an absent file from an empty file", async () => {
  const files = new Map<string, Uint8Array>(); let state: HistoryState | null = null;
  const source = { exists: async (path: string) => files.has(path), readBytes: async (path: string) => files.get(path)!,
    writeBytes: async (path: string, bytes: Uint8Array) => { files.set(path, bytes); },
    createFile: async (path: string, bytes: Uint8Array) => { if (files.has(path)) throw new Error("already exists"); files.set(path, bytes); },
    removeFile: async (path: string) => { files.delete(path); },
    historyStore: { persistent: true, load: async () => structuredClone(state), save: async (next: HistoryState) => { state = structuredClone(next); } } } as ProjectSource;
  await createProjectHistoryManager(source).save("Create empty file", [{ path: "empty.blk", contents: "", encoding: "hex", operation: "create" }]);
  assert.equal(files.has("empty.blk"), true);
  state!.pending = { entryId: state!.entries[0].id, direction: "after", fromCursor: 0, toCursor: 1 };
  assert.equal((await createProjectHistoryManager(source).getSummary()).appliedCount, 1);
  state!.pending = { entryId: state!.entries[0].id, direction: "before", fromCursor: 1, toCursor: 0 };
  files.delete("empty.blk");
  assert.equal((await createProjectHistoryManager(source).getSummary()).appliedCount, 0);
  files.set("empty.blk", new Uint8Array());
  await assert.rejects(createProjectHistoryManager(source).redo(), /outside Yellow Editor/);
});
