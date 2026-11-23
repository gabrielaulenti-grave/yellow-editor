import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, readdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { PNG } from "pngjs";
import { configureGen1PngDecoder, encodeGen1RgbaToTiles } from "../src/core/gen1Graphics";
import { loadGraphicsCatalog, loadGraphicsDocument, prepareGraphicsWrites } from "../src/core/graphics";
import { decodeGraphicsTiles, drawPixelLine, encodeGraphicsPng, fillGraphics, flipGraphics, graphicsPixelsFromImage, graphicsPixelsToImage, validateGraphicsPngHeader } from "../src/core/graphicsPixels";
import { bytesToHex, createProjectHistoryManager } from "../src/core/history";
import { createProjectSession } from "../src/core/project";
import type { HistoryState, ProjectSource } from "../src/core/types";

configureGen1PngDecoder("independent pngjs decoder", async bytes => {
  const image = PNG.sync.read(Buffer.from(bytes));
  return { width: image.width, height: image.height, rgba: new Uint8ClampedArray(image.data) };
});

function fixture(files: Record<string, Uint8Array | string>) {
  let state: HistoryState | null = null, fail = false;
  const data = new Map(Object.entries(files).map(([path, value]) => [path, typeof value === "string" ? new TextEncoder().encode(value) : value.slice()]));
  const source: ProjectSource = {
    displayPath: "graphics-fixture", storageKey: "graphics-fixture",
    exists: async path => data.has(path) || [...data.keys()].some(key => key.startsWith(path + "/")),
    listFiles: async () => [...data.keys()],
    readText: async path => new TextDecoder().decode(await source.readBytes(path)),
    readBytes: async path => { const bytes = data.get(path); if (!bytes) throw new Error(`Missing ${path}`); return bytes.slice(); },
    writeText: async (path, value) => source.writeBytes!(path, new TextEncoder().encode(value)),
    writeBytes: async (path, value) => { if (fail) { fail = false; throw new Error("Injected write failure"); } data.set(path, value.slice()); },
    assetUrl: async () => null,
    historyStore: { persistent: true, load: async () => structuredClone(state), save: async next => { state = structuredClone(next); } },
  };
  return { source, data, failNext: () => { fail = true; } };
}
const image = { width: 16, height: 16, depth: 2 as const, pixels: Array.from({ length: 256 }, (_, i) => i % 4) };

test("PNG writes decode independently, preserve indices at both depths and handle multiple DEFLATE blocks", () => {
  for (const depth of [1, 2] as const) for (const side of [8, 256]) {
    const original = { width: side, height: side, depth, pixels: Array.from({ length: side * side }, (_, i) => i % (1 << depth)) };
    const bytes = encodeGraphicsPng(original); validateGraphicsPngHeader(bytes);
    const decoded = PNG.sync.read(Buffer.from(bytes));
    assert.deepEqual(graphicsPixelsFromImage({ ...decoded, rgba: new Uint8ClampedArray(decoded.data) }, depth), original);
  }
  assert.throws(() => encodeGraphicsPng({ ...image, pixels: [-1] }), /valid shade/);
  const invalid = encodeGraphicsPng(image).slice(); new DataView(invalid.buffer).setUint32(16, 100000);
  assert.throws(() => validateGraphicsPngHeader(invalid), /4096/);
});

test("raw tile codecs retain every bit, byte length and tile order", () => {
  for (const depth of [1, 2] as const) {
    const bytes = Uint8Array.from({ length: 256 * depth * 8 }, (_, i) => i % 256);
    const decoded = decodeGraphicsTiles(bytes, depth);
    assert.deepEqual(encodeGen1RgbaToTiles(graphicsPixelsToImage(decoded), { depth }), bytes);
  }
  assert.throws(() => decodeGraphicsTiles(Uint8Array.of(1), 2), /complete/);
});

test("drawing interpolates strokes; tile fills stay inside their region; flips preserve surrounding pixels", () => {
  const empty = new Array<number>(256).fill(0);
  const line = drawPixelLine(empty, 16, 16, 0, 0, 7, 7, 3);
  for (let i = 0; i < 8; i++) assert.equal(line[i * 17], 3);
  assert.deepEqual(empty, new Array(256).fill(0));
  const filled = fillGraphics(empty, 16, 0, 0, 2, { x: 0, y: 0, width: 8, height: 8 });
  assert.equal(filled.filter(pixel => pixel === 2).length, 64);
  assert.deepEqual(fillGraphics(empty, 16, 9, 0, 2, { x: 0, y: 0, width: 8, height: 8 }), empty);
  const flipped = flipGraphics(line, 16, { x: 0, y: 0, width: 8, height: 8 }, "horizontal");
  assert.equal(flipped[7], 3); assert.equal(flipped[0], 0); assert.deepEqual(flipped.slice(128), line.slice(128));
});

test("source discovery follows PNG precedence, aliases, 1bpp and supported dimension headers", async () => {
  const { source } = fixture({
    "gfx/pokemon/front/custom.png": encodeGraphicsPng(image), "gfx/pokemon/front/custom.2bpp": new Uint8Array(64), "gfx/pokemon/front/custom.pic": Uint8Array.of(1),
    "gfx/font/custom.png": encodeGraphicsPng({ ...image, depth: 1, pixels: image.pixels.map(p => p % 2) }),
    "gfx/pics.asm": 'First::\nSecond:: INCBIN "gfx/pokemon/front/custom.pic" ; retained\nFont:: INCBIN "gfx/font/custom.1bpp"\n',
    "data/pokemon/base_stats/custom.asm": 'INCBIN "gfx/pokemon/front/custom.pic", 0, 1\n',
  });
  const catalog = await loadGraphicsCatalog(source);
  assert.equal(catalog.assets.length, 2);
  const asset = catalog.assets.find(asset => asset.category === "pokemon")!;
  assert.equal(asset.path, "gfx/pokemon/front/custom.png"); assert.equal(asset.reason, null);
  assert.deepEqual(asset.references.find(ref => ref.path === "gfx/pics.asm")!.labels, ["First", "Second"]);
  assert.equal((await loadGraphicsDocument(source, "gfx/font/custom.png")).depth, 1);
  const doc = await loadGraphicsDocument(source, asset.path);
  assert.deepEqual(await prepareGraphicsWrites(source, doc, { pixels: doc.pixels, confirmShared: false }), []);
  const changed = doc.pixels.slice(); changed[0] = 3;
  const writes = await prepareGraphicsWrites(source, doc, { pixels: changed, confirmShared: true });
  assert.deepEqual(writes.map(write => write.path), [asset.path]);
});

test("graphics saves guard shared changes, dimensions, external edits and newly introduced references", async () => {
  const { source, data } = fixture({ "gfx/trainers/custom.png": encodeGraphicsPng(image), "gfx/pics.asm": 'Portrait:: INCBIN "gfx/trainers/custom.pic"\n', Makefile: "# native build" });
  const doc = await loadGraphicsDocument(source, "gfx/trainers/custom.png"), changed = doc.pixels.slice(); changed[0] = 1;
  await assert.rejects(prepareGraphicsWrites(source, doc, { pixels: changed, confirmShared: false }), /Acknowledge/);
  await assert.rejects(prepareGraphicsWrites(source, { ...doc, width: 8 }, { pixels: changed, confirmShared: true }), /dimensions/);
  await assert.rejects(prepareGraphicsWrites(source, doc, { pixels: [...changed, 0], confirmShared: true }), /complete/);
  const before = data.get(doc.asset.path)!.slice();
  data.set(doc.asset.path, encodeGraphicsPng({ ...image, pixels: changed }));
  await assert.rejects(prepareGraphicsWrites(source, doc, { pixels: changed, confirmShared: true }), /changed/);
  data.set(doc.asset.path, before);
  data.set("extra.asm", new TextEncoder().encode('Alias:: INCBIN "gfx/trainers/custom.pic"\n'));
  await assert.rejects(prepareGraphicsWrites(source, doc, { pixels: changed, confirmShared: true }), /changed/);
  data.set("extra.asm", new TextEncoder().encode('Slice:: INCBIN "gfx/trainers/custom.pic", 1, 4\n'));
  await assert.rejects(prepareGraphicsWrites(source, doc, { pixels: changed, confirmShared: true }), /sliced/);
  data.delete("extra.asm"); data.set("Makefile", new TextEncoder().encode("# external changes"));
  await assert.rejects(prepareGraphicsWrites(source, doc, { pixels: changed, confirmShared: true }), /changed/);
  assert.deepEqual(data.get(doc.asset.path), before);
});

test("raw saves refuse newly preferred PNGs and undo/redo restores exact PNG bytes", async () => {
  const { source, data, failNext } = fixture({ "gfx/trainers/custom.png": encodeGraphicsPng(image), "gfx/pics.asm": 'Portrait:: INCBIN "gfx/trainers/custom.pic"', "gfx/sprites/raw.2bpp": new Uint8Array(64) });
  const raw = await loadGraphicsDocument(source, "gfx/sprites/raw.2bpp");
  data.set("gfx/sprites/raw.png", encodeGraphicsPng(image));
  await assert.rejects(prepareGraphicsWrites(source, raw, { pixels: raw.pixels, confirmShared: true }), /catalogue/);
  const doc = await loadGraphicsDocument(source, "gfx/trainers/custom.png"), changed = doc.pixels.slice(); changed[0] = 1;
  const writes = await prepareGraphicsWrites(source, doc, { pixels: changed, confirmShared: true }), history = createProjectHistoryManager(source), before = data.get(doc.asset.path)!.slice();
  failNext(); await assert.rejects(history.save("Edit portrait", writes), /Injected/); assert.deepEqual(data.get(doc.asset.path), before);
  await history.save("Edit portrait", writes); const after = data.get(doc.asset.path)!.slice();
  assert.notEqual(bytesToHex(after), bytesToHex(before));
  await history.undo(); assert.deepEqual(data.get(doc.asset.path), before);
  await history.redo(); assert.deepEqual(data.get(doc.asset.path), after);
  await history.selectivelyUndo((await history.getTimeline()).entries.at(-1)!.id);
  assert.deepEqual(data.get(doc.asset.path), before);
});

test("tileset edits preserve the number of tiles produced by whitespace trimming", async () => {
  const pixels = image.pixels.slice(); for (let y = 8; y < 16; y++) for (let x = 8; x < 16; x++) pixels[y * 16 + x] = 0;
  const { source } = fixture({ "gfx/tilesets/custom.png": encodeGraphicsPng({ ...image, pixels }), "gfx/tilesets.asm": 'Custom_GFX:: INCBIN "gfx/tilesets/custom.2bpp"' });
  const doc = await loadGraphicsDocument(source, "gfx/tilesets/custom.png"), changed = doc.pixels.slice(); changed[255] = 1;
  await assert.rejects(prepareGraphicsWrites(source, doc, { pixels: changed, confirmShared: true }), /built tiles/);
  changed[255] = 0; changed[0] = 1;
  assert.equal((await prepareGraphicsWrites(source, doc, { pixels: changed, confirmShared: true })).length, 1);
});

for (const directory of process.argv.slice(2).filter(arg => arg !== "--native")) test(`${directory}: source graphics inventory and pixel round trips`, async () => {
  const root = resolve(directory), files: Record<string, Uint8Array> = {};
  async function collect(folder = "") {
    for (const entry of await readdir(join(root, folder), { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const path = folder ? `${folder}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await collect(path);
      else files[path] = new Uint8Array(await readFile(join(root, path)));
    }
  }
  await collect(); const { source } = fixture(files), catalog = await loadGraphicsCatalog(source);
  assert.ok(catalog.assets.length > 400);
  const session = await createProjectSession(source, {} as never);
  const initialMap = await session.getMapVisualization("PALLET_TOWN");
  let opened = 0;
  for (const asset of catalog.assets) {
    if (asset.reason) continue;
    const doc = await loadGraphicsDocument(source, asset.path, catalog);
    const png = encodeGraphicsPng(doc), decoded = PNG.sync.read(Buffer.from(png));
    assert.deepEqual(graphicsPixelsFromImage({ ...decoded, rgba: new Uint8ClampedArray(decoded.data) }, doc.depth).pixels, doc.pixels);
    opened++;
  }
  const tileset = await session.getGraphicsDocument(initialMap.tilesetGfxPath), changed = tileset.pixels.slice();
  changed[0] = (changed[0] + 1) % 4;
  const before = await source.readBytes(tileset.asset.path);
  await session.saveGraphics(tileset, { pixels: changed, confirmShared: true });
  assert.notDeepEqual((await session.getMapVisualization("PALLET_TOWN")).tilesetGfx, initialMap.tilesetGfx);
  await session.undoLastSave(); assert.deepEqual(await source.readBytes(tileset.asset.path), before);
  assert.deepEqual((await session.getMapVisualization("PALLET_TOWN")).tilesetGfx, initialMap.tilesetGfx);
  if (process.argv.includes("--native")) {
    const directory = await mkdtemp(join("node_modules", ".graphics-native-"));
    try {
      const executable = resolve(directory, "pkmncompress");
      const compiled = spawnSync("gcc", ["-O2", "-o", executable, join(root, "tools/pkmncompress.c")], { encoding: "utf8" });
      assert.equal(compiled.status, 0, compiled.stderr);
      for (const path of ["gfx/pokemon/front/bulbasaur.png", "gfx/trainers/youngster.png"]) {
        const doc = await loadGraphicsDocument(source, path, catalog), pixels = doc.pixels.slice(); pixels[0] = (pixels[0] + 1) % 4;
        const png = PNG.sync.read(Buffer.from(encodeGraphicsPng({ ...doc, pixels })));
        const tileBytes = encodeGen1RgbaToTiles({ ...png, rgba: new Uint8ClampedArray(png.data) }, { depth: 2 });
        const input = resolve(directory, "sprite.2bpp"), compressed = resolve(directory, "sprite.pic"), output = resolve(directory, "restored.2bpp");
        await writeFile(input, tileBytes);
        const compress = spawnSync(executable, [input, compressed], { encoding: "utf8" }); assert.equal(compress.status, 0, compress.stderr);
        const decompress = spawnSync(executable, ["--uncompress", compressed, output], { encoding: "utf8" }); assert.equal(decompress.status, 0, decompress.stderr);
        assert.deepEqual(new Uint8Array(await readFile(output)), tileBytes, `${path}: native compression changed pixels`);
      }
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  console.log(`${directory}: ${catalog.assets.length} assets; ${opened} editable graphics decoded and exported losslessly.`);
});
