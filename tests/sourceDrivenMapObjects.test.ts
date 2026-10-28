import assert from "node:assert/strict";
import { test } from "node:test";
import { cp, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { loadNativeMapObjectDocument, prepareNativeMapObjectWrites } from "../src/core/nativeMapObjects";
import { loadMapVisualization, parseMapIndex } from "../src/core/mapVisualization";
import { loadMapNpcEditDocument, prepareMapNpcEditWrites } from "../src/core/npcEditing";
import { createProjectHistoryManager } from "../src/core/history";
import { importedMapObjectFixture } from "./importedMapObjectFixture";
import type { ProjectSource, HistoryState } from "../src/core/types";

const roots = process.argv.slice(2), at = roots.indexOf("--rom"), rgbds = at < 0 ? null : resolve(roots[at + 1]);
if (at >= 0) roots.splice(at, 2);
for (const directory of roots) test(`${directory}: imported hacks are resolved from source with independent field support`, async () => {
  const root = resolve(directory), overlay = new Map<string, string>(), files: string[] = []; let journal: HistoryState | null = null;
  async function collect(p = "") { for (const e of await readdir(join(root, p), { withFileTypes: true })) { if (e.name.startsWith(".")) continue; const path = join(p, e.name); if (e.isDirectory()) await collect(path); else if (path.endsWith(".asm")) files.push(path); } }
  await collect();
  const source: ProjectSource = { listFiles: async () => [...new Set([...files, ...overlay.keys()])], readText: async p => overlay.get(p) ?? readFile(join(root, p), "utf8"), readBytes: async p => p.endsWith(".2bpp") ? new Uint8Array(4096) : new Uint8Array(await readFile(join(root, p))), exists: async p => overlay.has(p) || (p.endsWith(".png") ? false : p.endsWith(".2bpp") ? true : await stat(join(root, p)).then(() => true, () => false)), assetUrl: async () => null, writeText: async (p, text) => { overlay.set(p, text); }, historyStore: { persistent: true, load: async () => journal, save: async j => { journal = structuredClone(j); } } };
  const patch = async (p: string, fn: (s: string) => string) => overlay.set(p, fn(await source.readText(p)));
  const imported = importedMapObjectFixture(Object.fromEntries(await Promise.all(files.map(async p => [p, await source.readText(p)]))));
  for (const [path, contents] of Object.entries(imported)) overlay.set(path, contents);
  const scriptPath = "scripts/MtMoon1F.asm", objectPath = "data/maps/objects/MtMoon1F.asm", originalHeader = imported["scripts/imported/first_header.asm"];
  const map = "IMPORTED_CAVE", view = await loadMapVisualization(source, map);
  assert.equal(view.map.width, 20); assert.equal(view.npcs.length, 13); assert.equal(view.signs.length, 1); assert.ok(view.signs[0].textLabel);
  assert.equal(view.npcs.filter(n => n.objectKind === "trainer").length, 7);
  assert.equal(view.npcs[0].x, 5); assert.equal(view.npcs[0].y, 6); assert.equal(view.npcs[0].trainerPartyId, "HIKER:1");
  assert.equal((await parseMapIndex(source)).find(m => m.constant === map)!.id, 0x3b, "renamed maps retain their registry slot");
  const d = await loadNativeMapObjectDocument(source, map, 1);
  assert.equal(d.partyReason, null); assert.equal(d.sightReason, null); assert.equal(d.values.sight, 2); assert.equal(d.dialogues.length, 3); assert.ok(d.evidence.some(e => e.path === "scripts/imported/first_header.asm"));
  assert.ok(d.placement.spriteNote.includes("Custom graphics loader"));
  assert.deepEqual(await prepareNativeMapObjectWrites(source, d, d.values), []);
  const missingPartyTable: ProjectSource = { ...source, exists: async p => p === "data/trainers/parties.asm" ? false : source.exists(p) };
  const limitedParty = await loadNativeMapObjectDocument(missingPartyTable, map, 1);
  assert.ok(limitedParty.partyReason); assert.equal(limitedParty.sightReason, null); assert.equal(limitedParty.dialogues.length, 3);
  assert.deepEqual((await prepareNativeMapObjectWrites(missingPartyTable, limitedParty, { ...limitedParty.values, sight: 3 })).map(w => w.path), ["scripts/imported/first_header.asm"]);
  const history = createProjectHistoryManager(source), originalObjects = await source.readText(objectPath), originalWrapper = await source.readText(scriptPath);
  const values = structuredClone(d.values); values.partyId = "YOUNGSTER:3"; values.sight = 3; values.dialogues[0][0].text = "Hello, explorer!";
  await history.save("Edit imported trainer", await prepareNativeMapObjectWrites(source, d, values));
  assert.ok((await source.readText(objectPath)).includes("object_event IMPORTED_X + 1, $06,"), "unrelated expressions are preserved");
  assert.equal(await source.readText(scriptPath), originalWrapper, "conditional wrappers are preserved byte for byte");
  assert.ok((await source.readText("scripts/imported/first_header.asm")).includes(", 3,"));
  await history.undo(); assert.equal(await source.readText(objectPath), originalObjects); assert.equal(await source.readText("scripts/imported/first_header.asm"), originalHeader);
  await history.redo(); assert.equal((await loadNativeMapObjectDocument(source, map, 1)).values.partyId, "YOUNGSTER:3");
  const pickup = await loadNativeMapObjectDocument(source, map, 8); assert.equal(pickup.itemReason, null);
  const itemWrites = await prepareNativeMapObjectWrites(source, pickup, { ...pickup.values, item: "RARE_CANDY" });
  assert.equal(itemWrites.length, 1); assert.equal(itemWrites[0].path, objectPath);
  for (const w of itemWrites) overlay.set(w.path, w.contents);
  // Multiple reachable headers disable only the uncertain fields.
  const beforeAmbiguous = await source.readText(scriptPath);
  await patch(scriptPath, s => s.replace(".other\n\tfarcall ImportedTrainerHelper", ".other\n\tld hl, MtMoon1TrainerHeader1\n\tcall TalkToTrainer"));
  const ambiguous = await loadNativeMapObjectDocument(source, map, 1);
  assert.equal(ambiguous.reason, null); assert.equal(ambiguous.partyReason, null); assert.ok(ambiguous.sightReason); assert.equal(ambiguous.values.sight, null);
  const partyOnly = await prepareNativeMapObjectWrites(source, ambiguous, { ...ambiguous.values, partyId: "LASS:5" });
  assert.deepEqual(partyOnly.map(w => w.path), [objectPath]);
  await assert.rejects(prepareNativeMapObjectWrites(source, ambiguous, { ...ambiguous.values, sight: 1 }), /unique trainer header/);
  overlay.set(scriptPath, beforeAmbiguous);
  await patch(scriptPath, s => s.replace(".other\n\tfarcall ImportedTrainerHelper", ".other\n\tjp hl"));
  const indirect = await loadNativeMapObjectDocument(source, map, 1);
  assert.equal(indirect.partyReason, null); assert.ok(indirect.sightReason); assert.ok(indirect.notes.some(n => n.includes("unresolved control")));
  overlay.set(scriptPath, beforeAmbiguous);
  const oldMacro = await source.readText("macros/scripts/maps.asm");
  await patch("macros/scripts/maps.asm", s => s.replace("db \\3\n", "db \\2\n"));
  const opaque = await loadMapVisualization(source, map); assert.equal(opaque.npcs.length, 13); assert.ok(opaque.npcs.every(n => n.sourceIssue && Number.isNaN(n.x)));
  await assert.rejects(loadNativeMapObjectDocument(source, map, 1), /different byte layout/);
  overlay.set("macros/scripts/maps.asm", oldMacro);
  const namedObjects = await source.readText(objectPath), namedScript = await source.readText(scriptPath);
  const pointerStart = namedScript.indexOf("MtMoon1F_TextPointers:"), pointerEnd = namedScript.indexOf("MtMoon1TrainerHeaders:");
  const table = namedScript.slice(pointerStart, pointerEnd), textIds = [...table.matchAll(/dw_const\s+\w+,\s*(\w+)/g)].map(m => m[1]);
  const rawTable = table.replace(/\tdef_text_pointers\n/, "").replace(/dw_const\s+(\w+),\s*\w+/g, "dw $1");
  overlay.set(scriptPath, namedScript.slice(0, pointerStart) + rawTable + namedScript.slice(pointerEnd));
  let numericObjects = namedObjects;
  textIds.forEach((constant, i) => { numericObjects = numericObjects.replace(new RegExp(`\\b${constant}\\b`, "g"), String(i + 1)); });
  overlay.set(objectPath, numericObjects.replace(/^\s*(?:object_const_def|const_export\s+\w+)\s*$/gm, ""));
  const numeric = await loadNativeMapObjectDocument(source, map, 1);
  assert.equal(numeric.partyReason, null); assert.equal(numeric.sightReason, null); assert.ok(numeric.notes.some(n => n.includes("no declared source constant")));
  assert.equal((await loadMapVisualization(source, map)).npcs[0].textLabel, "MtMoon1FHikerText");
  const numericWrites = await prepareNativeMapObjectWrites(source, numeric, { ...numeric.values, partyId: "LASS:5" }); assert.deepEqual(numericWrites.map(w => w.path), [objectPath]);
  overlay.set(objectPath, namedObjects); overlay.set(scriptPath, namedScript);
  const dimensions = await source.readText("constants/imported_dimensions.asm");
  overlay.set("constants/imported_dimensions.asm", "DEF IMPORTED_WIDTH EQU UNKNOWN_WIDTH\n");
  const unresolvedIndex = await parseMapIndex(source); assert.equal(unresolvedIndex.find(m => m.constant === map)!.id, 0x3b); assert.ok(Number.isNaN(unresolvedIndex.find(m => m.constant === map)!.width));
  assert.ok((await loadMapVisualization(source, "VIRIDIAN_POKECENTER")).npcs.length > 0, "one unresolved map does not lock other maps");
  overlay.set("constants/imported_dimensions.asm", dimensions);
  // An ordinary NPC in another map remains editable with the modified loader,
  // comment-free graphics table and equivalent object encoding as well.
  const npc = await loadMapNpcEditDocument(source, "VIRIDIAN_POKECENTER", 2);
  assert.equal(npc.reason, null);
  const p = npc.walkable.find(p => !npc.occupied.some(o => o.x === p.x && o.y === p.y) && (p.x !== npc.values.x || p.y !== npc.values.y))!;
  const npcWrites = await prepareMapNpcEditWrites(source, npc, { ...npc.values, ...p }); assert.equal(npcWrites.length, 1);
  for (const w of npcWrites) overlay.set(w.path, w.contents);
  if (rgbds) {
    const temp = await mkdtemp(resolve("node_modules/.imported-map-rom-"));
    try { await cp(root, temp, { recursive: true, filter: p => !p.split("/").includes(".git") }); for (const [p, text] of overlay) { await (await import("node:fs/promises")).mkdir(join(temp, p, ".."), { recursive: true }); await writeFile(join(temp, p), text); }
      const game = root.includes("pokeyellow") ? "pokeyellow" : "pokered", run = spawnSync("make", ["-j2", `RGBDS=${rgbds}/`, `${game}.gbc`], { cwd: temp, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }); assert.equal(run.status, 0, run.stderr.slice(-6000));
      console.log(`${directory}: renamed imported hack, relocated header/helper, custom engine and edited records compile as a complete ROM`);
    } finally { await rm(temp, { recursive: true, force: true }); }
  }
});
