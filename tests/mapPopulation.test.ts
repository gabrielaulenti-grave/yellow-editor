import assert from "node:assert/strict";
import { test } from "node:test";
import { cp, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createProjectSession } from "../src/core/project";
import { loadScriptInteractionDocument, prepareScriptInteractionWrites } from "../src/core/scriptInteractions";
import { loadMapEncounterDocument, prepareMapEncounterWrites } from "../src/core/mapEncounters";
import { prepareMapItemWrites } from "../src/core/mapItems";
import { populationCpuProbes } from "./populationCpuProbes";
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
for (const directory of args) test(`${directory}: populate a new cave with independent encounters and persistent pickups`, async () => {
  const root = resolve(directory), { source, overlay, failNext } = await fixture(root), session = await createProjectSession(source, {} as never);
  const creation = await session.getMapCreateDocument("ROCK_TUNNEL_B1F");
  await session.createMap(creation, { constant: "DIGLETT_BASEMENT", width: creation.visualization.map.width, height: creation.visualization.map.height, layout: "copy", fillBlock: 0, borderBlock: creation.borderBlock, musicMap: "DIGLETTS_CAVE", locationMap: "VERMILION_CITY", connection: null });
  assert.equal((await session.getMapVisualization("DIGLETT_BASEMENT")).npcs.length, 0);
  const before = await source.readText("data/wild/grass_water.asm");
  assert.equal((await session.getEncounterIndex()).some(t => t.affectedMaps.some(m => m.constant === "DIGLETT_BASEMENT")), false);
  let d = await session.getMapEncounterDocument("DIGLETT_BASEMENT");
  assert.equal(d.currentLabel, "NothingWildMons");
  await session.assignMapEncounters(d, { mode: "blank", tablePath: "" });
  let entry = (await session.getEncounterIndex()).find(t => t.affectedMaps.some(m => m.constant === "DIGLETT_BASEMENT"))!;
  assert.ok(entry); assert.equal(entry.hasGrass, false); assert.equal(entry.hasWater, false);
  const blankPath = entry.path;
  await session.undoLastSave(); assert.equal(await source.exists(blankPath), false); assert.equal(await source.readText("data/wild/grass_water.asm"), before);
  await session.redoLastUndo(); assert.equal(await source.exists(blankPath), true);
  const empty = await session.getEncounterTable(blankPath), species = ["DIGLETT", "DUGTRIO"];
  await session.saveEncounterTable(blankPath, empty.sourceHash, empty.versions.map(v => ({ ...v, grass: { rate: 15, slots: Array.from({ length: 10 }, (_, i) => ({ speciesConstant: species[i % 2], level: 10 + i, sourceLine: null })) } })), species);
  assert.equal((await session.getEncounterIndex()).find(t => t.path === blankPath)!.hasGrass, true);
  d = await session.getMapEncounterDocument("DIGLETT_BASEMENT");
  const template = d.tables.find(t => t.path.endsWith("/Route4.asm"))!;
  const original = await source.readText(template.path), templateData = await session.getEncounterTable(template.path);
  if (templateData.versions.length === 2) assert.notDeepEqual(templateData.versions[0].grass.slots.map(s => s.speciesConstant), templateData.versions[1].grass.slots.map(s => s.speciesConstant));
  await session.assignMapEncounters(d, { mode: "copy", tablePath: template.path });
  entry = (await session.getEncounterIndex()).find(t => t.affectedMaps.some(m => m.constant === "DIGLETT_BASEMENT"))!;
  assert.notEqual(entry.path, template.path);
  const copy = await session.getEncounterTable(entry.path);
  assert.deepEqual(copy.versions, templateData.versions, "Red/Blue source lines and differences survive independent copy");
  assert.equal(await source.readText(template.path), original);
  d = await session.getMapEncounterDocument("DIGLETT_BASEMENT");
  await session.assignMapEncounters(d, { mode: "share", tablePath: template.path });
  assert.ok((await session.getEncounterIndex()).find(t => t.path === template.path)!.affectedMaps.some(m => m.constant === "DIGLETT_BASEMENT"));
  await session.undoLastSave();
  const stale = await session.getMapEncounterDocument("DIGLETT_BASEMENT");
  await source.writeText(template.path, original + "\n; changed elsewhere\n");
  await assert.rejects(prepareMapEncounterWrites(source, session.info.projectName, stale, { mode: "copy", tablePath: template.path }), /sources changed/);
  await source.writeText(template.path, original);
  // A failed table creation must restore its pointer and remove its include.
  d = await session.getMapEncounterDocument("DIGLETT_BASEMENT");
  const failedWrites = await prepareMapEncounterWrites(source, session.info.projectName, d, { mode: "blank", tablePath: "" });
  const failedPath = failedWrites.find(w => w.operation === "create")!.path, pointerBefore = await source.readText("data/wild/grass_water.asm");
  failNext(failedPath); await assert.rejects(session.assignMapEncounters(d, { mode: "blank", tablePath: "" }), /Injected/);
  assert.equal(await source.readText("data/wild/grass_water.asm"), pointerBefore); assert.equal(await source.exists(failedPath), false);
  const item = await session.getMapItemDocument("DIGLETT_BASEMENT");
  assert.ok(item.items.includes("TM_DIG") && item.items.includes("HM_CUT")); assert.ok(!item.items.includes("FLOOR_B2F"));
  const itemValues = { x: 1, y: 1, item: "RARE_CANDY", quantity: 2 };
  await assert.rejects(prepareMapItemWrites(source, item, { ...itemValues, quantity: 100 }), /quantity/);
  await session.placeMapItem(item, itemValues);
  const populated = await session.getMapVisualization("DIGLETT_BASEMENT"), npc = populated.npcs[0];
  assert.equal(npc.spriteConstant, "SPRITE_POKE_BALL"); assert.equal(npc.x, 1); assert.equal(npc.y, 1);
  const interaction = await loadScriptInteractionDocument(source, npc.scriptPath, npc.textLabel!);
  assert.equal(interaction.values.pickup, true); assert.deepEqual(interaction.values.reward, { item: "RARE_CANDY", quantity: 2 }); assert.ok(interaction.values.visibleWhen);
  assert.match(await source.readText(npc.scriptPath), /SetEvent[^\n]+\n\tSetEvent[^\n]+\n\tcall UpdateSprites/);
  assert.ok((await prepareScriptInteractionWrites(source, interaction, interaction.values)).every(w => overlay.has(w.path) && new TextDecoder().decode(overlay.get(w.path)) === w.contents));
  await assert.rejects(prepareMapItemWrites(source, item, itemValues), /sources changed/);
  await session.undoLastSave(); assert.equal((await session.getMapVisualization("DIGLETT_BASEMENT")).npcs.length, 0);
  await session.redoLastUndo(); assert.equal((await session.getMapVisualization("DIGLETT_BASEMENT")).npcs.length, 1);
  const occupied = await session.getMapItemDocument("DIGLETT_BASEMENT");
  await assert.rejects(prepareMapItemWrites(source, occupied, itemValues), /already contains/);
  // Removing an assignment leaves the original table and other maps untouched.
  d = await session.getMapEncounterDocument("DIGLETT_BASEMENT");
  await session.assignMapEncounters(d, { mode: "none", tablePath: "" }); assert.equal((await session.getMapEncounterDocument("DIGLETT_BASEMENT")).currentLabel, "NothingWildMons");
  await session.undoLastSave();
  if (rgbds && binjgb) {
    const temp = await mkdtemp(resolve("node_modules/.population-rom-"));
    const run = (cmd: string, argv: string[], cwd = temp) => { const r = spawnSync(cmd, argv, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }); assert.equal(r.status, 0, r.stderr.slice(-8000) + r.stdout.slice(-2000)); return r.stdout; };
    try {
      await cp(root, temp, { recursive: true, filter: p => !p.split("/").includes(".git") });
      for (const [p, bytes] of overlay) await writeFile(join(temp, p), bytes);
      const target = root.includes("pokeyellow") ? "pokeyellow" : "pokered";
      run("make", ["clean"]); run("make", ["-j2", `RGBDS=${rgbds}/`, `${target}.gbc`]);
      const symbols = await readFile(join(temp, `${target}.sym`), "utf8"), rom = await readFile(join(temp, `${target}.gbc`));
      const symbol = (name: string) => { const m = symbols.match(new RegExp(`^([0-9a-f]+):([0-9a-f]+) ${name}$`, "m")); assert.ok(m, name); const bank = parseInt(m[1], 16), address = parseInt(m[2], 16); return { address, offset: bank * 0x4000 + address % 0x4000 }; };
      const assigned = await session.getMapEncounterDocument("DIGLETT_BASEMENT");
      assert.equal(rom.readUInt16LE(symbol("WildDataPointers").offset + creation.nextId * 2), symbol(assigned.currentLabel).address);
      await populationCpuProbes(temp, rgbds, binjgb, run, interaction);
      console.log(`${root}: new cave, encounter pointer and complete item-pickup ROM compiled; native pickup CPU checks passed`);
    } finally { await rm(temp, { recursive: true, force: true }); }
  }
});
