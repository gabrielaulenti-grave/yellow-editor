import assert from "node:assert/strict";
import { test } from "node:test";
import { cp, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { loadMapSignDocument, prepareMapSignWrites } from "../src/core/mapSigns";
import { loadMapRemovalDocument, prepareMapRemovalWrites } from "../src/core/mapRemoval";
import { checkMap, checkProjectMaps } from "../src/core/mapValidation";
import { loadMapVisualization, parseMapIndex } from "../src/core/mapVisualization";
import { createProjectHistoryManager } from "../src/core/history";
import type { ProjectSource, HistoryState } from "../src/core/types";

const roots = process.argv.slice(2), at = roots.indexOf("--rom"), rgbds = at < 0 ? null : resolve(roots[at + 1]);
if (at >= 0) roots.splice(at, 2);
for (const directory of roots) test(`${directory}: signs, dependency-aware removal and project map review`, async () => {
  const root = resolve(directory), overlay = new Map<string, string>(), files: string[] = []; let journal: HistoryState | null = null;
  async function collect(p = "") { for (const e of await readdir(join(root, p), { withFileTypes: true })) { if (e.name.startsWith(".")) continue; const path = join(p, e.name); if (e.isDirectory()) await collect(path); else if (path.endsWith(".asm")) files.push(path); } }
  await collect();
  const source: ProjectSource = { listFiles: async () => [...new Set([...files, ...overlay.keys()])], readText: async p => overlay.get(p) ?? readFile(join(root, p), "utf8"), readBytes: async p => p.endsWith(".2bpp") ? new Uint8Array(4096) : new Uint8Array(await readFile(join(root, p))), exists: async p => overlay.has(p) || (p.endsWith(".png") ? false : p.endsWith(".2bpp") ? true : await stat(join(root, p)).then(() => true, () => false)), assetUrl: async () => null, writeText: async (p, text) => { overlay.set(p, text); }, historyStore: { persistent: true, load: async () => journal, save: async j => { journal = structuredClone(j); } } };
  const history = createProjectHistoryManager(source), objects = "data/maps/objects/PalletTown.asm", script = "scripts/PalletTown.asm";
  const original = await source.readText(objects), originalScript = await source.readText(script);
  const sign = await loadMapSignDocument(source, "PALLET_TOWN", 1); assert.ok(sign.dialogue); assert.equal(sign.dialogueReason, null);
  assert.deepEqual(await prepareMapSignWrites(source, sign, sign.values), []);
  const values = structuredClone(sign.values); values.x = 18; values.y = 16; values.segments[0].text = "Welcome!";
  const writes = await prepareMapSignWrites(source, sign, values); assert.equal(writes.length, 2);
  let failed = false;
  const failingSource = { ...source, writeText: async (path: string, contents: string) => { if (path === writes[1].path && !failed) { failed = true; throw new Error("Simulated sign write failure"); } await source.writeText!(path, contents); } };
  await assert.rejects(createProjectHistoryManager(failingSource).save("Failed sign edit", writes), /Simulated sign write failure/);
  assert.equal(await source.readText(objects), original); assert.equal(await source.readText(script), originalScript); assert.equal(await source.readText(sign.dialogue!.path), await readFile(join(root, sign.dialogue!.path), "utf8"));
  await history.save("Move and edit sign", writes);
  assert.equal((await loadMapSignDocument(source, "PALLET_TOWN", 1)).values.x, 18);
  assert.equal((await loadMapSignDocument(source, "PALLET_TOWN", 1)).values.segments[0].text, "Welcome!");
  await history.undo(); assert.equal(await source.readText(objects), original); assert.equal(await source.readText(script), originalScript);
  await history.redo();
  const create = await loadMapSignDocument(source, "PALLET_TOWN", null); assert.equal(create.createReason, null);
  await history.save("Place sign", await prepareMapSignWrites(source, create, { ...create.values, x: 17, y: 16, lines: ["New path ahead!", "Take care!"] }));
  const created = await loadMapSignDocument(source, "PALLET_TOWN", 5); assert.equal(created.values.segments[0].text, "New path ahead!");
  const pointersBeforeDelete = await source.readText(script), beforeSignDelete = await source.readText(objects);
  const removeSign = await loadMapRemovalDocument(source, "PALLET_TOWN", "sign", 1); assert.deepEqual(removeSign.blockers, []);
  const removalWrites = await prepareMapRemovalWrites(source, removeSign); assert.deepEqual(removalWrites.map(w => w.path), [objects]);
  await history.save("Remove sign", removalWrites); assert.equal(await source.readText(script), pointersBeforeDelete, "all text IDs and shared text remain intact");
  assert.equal((await loadMapVisualization(source, "PALLET_TOWN")).signs.length, 4);
  await history.undo(); assert.equal(await source.readText(objects), beforeSignDelete); await history.redo();
  const housePath = "data/maps/objects/PewterSpeechHouse.asm", houseScript = "scripts/PewterSpeechHouse.asm", houseOriginal = await source.readText(housePath), housePointers = await source.readText(houseScript);
  const first = await loadMapRemovalDocument(source, "PEWTER_SPEECH_HOUSE", "object", 1); assert.ok(first.blockers.some(b => b.includes("renumber")));
  await assert.rejects(prepareMapRemovalWrites(source, first), /renumber/);
  const last = await loadMapRemovalDocument(source, "PEWTER_SPEECH_HOUSE", "object", 2); assert.deepEqual(last.blockers, []);
  overlay.set("scripts/RemovalDependency.asm", `RemovalDependency:\n\tld a, ${last.name}\n\tret\n`);
  const linked = await loadMapRemovalDocument(source, "PEWTER_SPEECH_HOUSE", "object", 2); assert.equal(linked.references.length, 1); await assert.rejects(prepareMapRemovalWrites(source, linked), /dependencies/);
  await assert.rejects(prepareMapRemovalWrites(source, last), /sources changed/); overlay.delete("scripts/RemovalDependency.asm");
  await history.save("Remove last NPC", await prepareMapRemovalWrites(source, await loadMapRemovalDocument(source, "PEWTER_SPEECH_HOUSE", "object", 2)));
  assert.equal((await loadMapVisualization(source, "PEWTER_SPEECH_HOUSE")).npcs.length, 1); assert.equal(await source.readText(houseScript), housePointers);
  await history.undo(); assert.equal(await source.readText(housePath), houseOriginal); await history.redo();
  const trainer = await loadMapRemovalDocument(source, "MT_MOON_1F", "object", 1); assert.ok(trainer.blockers.some(b => b.includes("trainer")));
  const pickup = await loadMapRemovalDocument(source, "MT_MOON_1F", "object", 13); assert.ok(pickup.references.length > 0); assert.ok(pickup.blockers.length);
  // Unknown behavior protects only dialogue: moving a sign does not regenerate its script.
  const savedScript = await source.readText(script), label = (await loadMapVisualization(source, "PALLET_TOWN")).signs[0].textLabel!;
  overlay.set(script, savedScript.replace(`${label}:`, `${label}:\n\ttext_asm\n\tjp TextScriptEnd\n`));
  const custom = await loadMapSignDocument(source, "PALLET_TOWN", 1); assert.ok(custom.dialogueReason);
  assert.deepEqual((await prepareMapSignWrites(source, custom, { ...custom.values, x: 16, y: 16 })).map(w => w.path), [objects]); overlay.set(script, savedScript);
  // Position expressions and comments survive unrelated text edits.
  const named = await source.readText(objects); overlay.set(objects, named.replace(/bg_event\s+3,\s*5,/, "bg_event (1 + 2), $05,"));
  const expr = await loadMapSignDocument(source, "PALLET_TOWN", 2); const edit = structuredClone(expr.values); edit.segments[0].text = "Hello!";
  assert.ok((await prepareMapSignWrites(source, expr, edit)).every(w => w.path !== objects)); overlay.set(objects, named);
  // An unreadable map is reported without preventing review of other maps.
  overlay.set("data/maps/headers/Route1.asm", "custom_header\n");
  const report = await checkProjectMaps(source); assert.ok(report.checkedMaps > 200); assert.ok(report.reports.find(r => r.mapConstant === "ROUTE_1")!.issues.some(i => i.code === "map-unreadable")); assert.ok(report.reports.some(r => r.mapConstant === "PALLET_TOWN")); overlay.delete("data/maps/headers/Route1.asm");
  const drawable = (await parseMapIndex(source)).filter(m => !m.isUnused); assert.equal(report.checkedMaps, new Set(drawable.map(m => m.headerPath ?? m.constant)).size, "shared headers are checked once, rather than skipping every alias");
  const beforeInvalid = await source.readText(objects); overlay.set(objects, beforeInvalid.replace(/bg_event\s+7,\s*9,/, "bg_event UNKNOWN_X, UNKNOWN_Y,"));
  const unknown = await checkMap(source, "PALLET_TOWN"); assert.ok(unknown.issues.some(i => i.code === "unresolved-position" && i.kind === "sign")); assert.ok(!unknown.issues.some(i => i.code === "overlap" && i.message.includes("NaN"))); overlay.set(objects, beforeInvalid);
  const stale = await loadMapSignDocument(source, "PALLET_TOWN", 1); overlay.set(objects, beforeInvalid + "; external edit\n"); await assert.rejects(prepareMapSignWrites(source, stale, stale.values), /sources changed/); overlay.set(objects, beforeInvalid);
  const crlf = beforeInvalid.replace(/\r?\n/g, "\r\n").replace(/(bg_event[^\r\n]+)/, "$1 ; keep this comment"); overlay.set(objects, crlf);
  const crlfSign = await loadMapSignDocument(source, "PALLET_TOWN", 1), crlfWrite = await prepareMapSignWrites(source, crlfSign, { ...crlfSign.values, x: 15, y: 16 });
  assert.ok(crlfWrite[0].contents.includes("; keep this comment\r\n")); assert.ok(!/(?<!\r)\n/.test(crlfWrite[0].contents)); overlay.set(objects, beforeInvalid);
  const limits = await source.readText("constants/map_data_constants.asm"); overlay.set("constants/map_data_constants.asm", limits.replace(/(MAX_BG_EVENTS EQU )\d+/, (_, prefix) => prefix + "1"));
  const full = await loadMapSignDocument(source, "PALLET_TOWN", null); assert.ok(full.createReason); await assert.rejects(prepareMapSignWrites(source, full, { ...full.values, x: 16, y: 16, lines: ["Hello!"] }), /free sign/); overlay.delete("constants/map_data_constants.asm");
  const namedHouse = await source.readText(housePath), namedHouseScript = await source.readText(houseScript);
  const ids = [...namedHouseScript.matchAll(/dw_const\s+\w+,\s*(\w+)/g)].map(m => m[1]); let numericHouse = namedHouse;
  ids.forEach((id, i) => { numericHouse = numericHouse.replace(new RegExp(`\\b${id}\\b`, "g"), String(i + 1)); }); overlay.set(housePath, numericHouse);
  overlay.set(houseScript, namedHouseScript.replace(/dw_const\s+(\w+),\s*\w+/g, "dw $1"));
  const numericSign = await loadMapSignDocument(source, "PEWTER_SPEECH_HOUSE", null); assert.equal(numericSign.createReason, null);
  const numericWrites = await prepareMapSignWrites(source, numericSign, { ...numericSign.values, x: 5, y: 5, lines: ["Hello!"] }); assert.ok(numericWrites.some(w => w.path === housePath && w.contents.includes("bg_event 5, 5, 3")));
  overlay.set(housePath, namedHouse); overlay.set(houseScript, namedHouseScript);
  if (rgbds) {
    const temp = await mkdtemp(resolve("node_modules/.map-sign-rom-"));
    try { await cp(root, temp, { recursive: true, filter: p => !p.split("/").includes(".git") }); for (const [p, text] of overlay) await writeFile(join(temp, p), text);
      const game = root.includes("pokeyellow") ? "pokeyellow" : "pokered", run = spawnSync("make", ["-j2", `RGBDS=${rgbds}/`, `${game}.gbc`], { cwd: temp, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }); assert.equal(run.status, 0, run.stderr.slice(-6000));
      const symbols = await readFile(join(temp, `${game}.sym`), "utf8"), rom = await readFile(join(temp, `${game}.gbc`));
      const objectBytes = (label: string) => { const m = symbols.match(new RegExp(`^([0-9a-f]+):([0-9a-f]+) ${label}$`, "mi"))!; assert.ok(m, label); const bank = parseInt(m[1], 16), addr = parseInt(m[2], 16); let pos = bank * 0x4000 + (addr & 0x3fff) + 1; const warps = rom[pos++]; pos += warps * 4; const signs = rom[pos++], textIds: number[] = []; for (let i = 0; i < signs; i++, pos += 3) textIds.push(rom[pos + 2]); return { textIds, objects: rom[pos] }; };
      const pointerCount = (originalScript.split("PalletTown_TextPointers:")[1].split(/\n[A-Za-z_]\w*:{1,2}/)[0].match(/\bdw_const\b/g) ?? []).length;
      assert.deepEqual(objectBytes("PalletTown_Object"), { textIds: [5, 6, 7, pointerCount + 1], objects: 3 }, "compiled text IDs stay stable after sign removal");
      assert.equal(objectBytes("PewterSpeechHouse_Object").objects, 1, "compiled NPC count frees the removed final slot");
      console.log(`${directory}: sign creation/editing/removal and last-NPC removal compile as a whole ROM`);
    } finally { await rm(temp, { recursive: true, force: true }); }
  }
});
