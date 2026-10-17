import assert from "node:assert/strict";
import { loadMapNpcCreateDocument, prepareMapNpcWrites } from "../src/core/npcCreation";
import { createProjectHistoryManager } from "../src/core/history";
import { readProjectRgbdsSources } from "../src/core/projectConstants";
import { applyTextDocumentEdits, parseTextDocument } from "../src/core/textEditing";
import type { HistoryState, MapNpcCreateValues, ProjectSource } from "../src/core/types";

type Source = Pick<ProjectSource, "readText" | "listFiles">;

export async function npcCreationChecks(original: Source) {
  const files = await readProjectRgbdsSources(original as ProjectSource);
  const contents = new Map(files.map(file => [file.path, file.contents]));
  let persisted: HistoryState | null = null;
  let failPath: string | null = null;
  const source: ProjectSource = {
    displayPath: "NPC fixture", storageKey: "npc-test",
    readText: async path => { assert.ok(contents.has(path), path); return contents.get(path)!; },
    readBytes: async () => new Uint8Array(), exists: async path => contents.has(path), assetUrl: async () => null,
    listFiles: async () => [...contents.keys()],
    writeText: async (path, value) => { if (path === failPath) { failPath = null; throw new Error("Injected write failure"); } contents.set(path, value); },
    historyStore: { persistent: false, load: async () => persisted, save: async state => { persisted = state; } },
  };
  const objectPath = "data/maps/objects/Route1.asm";
  const scriptPath = "scripts/Route1.asm";
  const beforeObject = contents.get(objectPath)!;
  const beforeScript = contents.get(scriptPath)!;
  const values: MapNpcCreateValues = { x: 6, y: 24, sprite: "SPRITE_YOUNGSTER", movement: "STAY", direction: "DOWN", dialogue: { kind: "new", lines: ["Hello there!", "Enjoy Route 1."] } };
  const document = await loadMapNpcCreateDocument(source, "ROUTE_1");
  assert.equal(document.objectId, 3);
  assert.ok(document.sprites.includes("SPRITE_YOUNGSTER"));
  assert.ok(!document.sprites.includes("SPRITE_NURSE"));
  assert.equal(document.maxObjects, contents.has("scripts/Route1_2.asm") ? 14 : 15);
  const writes = await prepareMapNpcWrites(source, document, values);
  assert.equal(writes.length, 2);
  const afterObject = writes.find(write => write.path === objectPath)!.contents;
  const afterScript = writes.find(write => write.path === scriptPath)!.contents;
  assert.equal(afterObject.replace(/^\tconst_export ROUTE_1_EDITOR_NPC_3\n/m, "").replace(/^\tobject_event 6, 24, SPRITE_YOUNGSTER, STAY, DOWN, TEXT_ROUTE_1_EDITOR_NPC_3\n/m, ""), beforeObject);
  const appended = afterScript.indexOf("\nRoute1EditorNpc3Text:");
  assert.ok(appended >= 0);
  assert.equal(afterScript.slice(0, appended).replace(/^\tdw_const Route1EditorNpc3Text, TEXT_ROUTE_1_EDITOR_NPC_3\n/m, ""), beforeScript);
  const pointers = [...afterScript.matchAll(/^\s*dw_const (\w+),\s*(TEXT_\w+)/gm)];
  assert.deepEqual(pointers.slice(0, 2).map(match => match[2]), ["TEXT_ROUTE1_YOUNGSTER1", "TEXT_ROUTE1_YOUNGSTER2"]);
  assert.equal(pointers[2][2], "TEXT_ROUTE_1_EDITOR_NPC_3");
  assert.equal(pointers[3][2], "TEXT_ROUTE1_SIGN");
  const text = await parseTextDocument(scriptPath, "Route1EditorNpc3Text", afterScript);
  assert.equal(text.editable, true);
  assert.deepEqual(text.segments.map(segment => segment.text), ["Hello there!", "Enjoy Route 1."]);
  const edited = applyTextDocumentEdits(afterScript, text.label, text.segments.map((segment, i) => ({ ...segment, text: i === 0 ? "Welcome!" : segment.text })));
  assert.equal((await parseTextDocument(scriptPath, text.label, edited)).segments[0].text, "Welcome!");

  await assert.rejects(prepareMapNpcWrites(source, document, { ...values, x: 5 }), /already contains/);
  await assert.rejects(prepareMapNpcWrites(source, document, { ...values, x: document.width }), /inside/);
  await assert.rejects(prepareMapNpcWrites(source, { ...document, sprites: ["SPRITE_NURSE"] }, { ...values, sprite: "SPRITE_NURSE" }), /compatible/);
  await assert.rejects(prepareMapNpcWrites(source, document, { ...values, movement: "WALK", direction: "DOWN" }), /supported/);
  await assert.rejects(prepareMapNpcWrites(source, document, { ...values, dialogue: { kind: "new", lines: ["This line is far too long for the dialogue box"] } }), /Shorten/);
  await assert.rejects(prepareMapNpcWrites(source, document, { ...values, dialogue: { kind: "new", lines: ["Unmapped 🐁"] } }), /font/);
  await assert.rejects(prepareMapNpcWrites(source, document, { ...values, dialogue: { kind: "existing", id: "scripts/Route22.asm:Route22Rival1Script" } }), /plain dialogue/);
  contents.set(scriptPath, beforeScript + "; concurrent change\n");
  await assert.rejects(prepareMapNpcWrites(source, document, values), /changed/);
  contents.set(scriptPath, beforeScript);

  const history = createProjectHistoryManager(source);
  failPath = scriptPath;
  await assert.rejects(history.save("Add NPC", writes), /Injected write failure/);
  assert.equal(contents.get(objectPath), beforeObject);
  assert.equal(contents.get(scriptPath), beforeScript);
  await history.save("Add NPC", writes);
  assert.equal((await history.getState()).entries[0].files.length, 2);
  await history.undo();
  assert.equal(contents.get(objectPath), beforeObject);
  assert.equal(contents.get(scriptPath), beforeScript);
  await history.redo();
  assert.equal(contents.get(objectPath), afterObject);
  const next = await loadMapNpcCreateDocument(source, "ROUTE_1");
  assert.equal(next.objectId, 4);
  const reusable = next.dialogueOptions.find(option => option.label === "Route1EditorNpc3Text")!;
  assert.ok(reusable);
  const reused = await prepareMapNpcWrites(source, next, { ...values, x: 7, movement: "WALK", direction: "UP_DOWN", dialogue: { kind: "existing", id: reusable.id } });
  assert.match(reused.find(write => write.path === scriptPath)!.contents, /text_far Route1EditorNpc3Text\n\ttext_end/);

  // Empty indoor maps have no object_const_def and an unused text_end sentinel.
  const empty = await loadMapNpcCreateDocument(source, "REDS_HOUSE_2F");
  assert.equal(empty.objectId, 1);
  assert.ok(empty.sprites.includes("SPRITE_NURSE"));
  const indoor = await prepareMapNpcWrites(source, empty, { ...values, x: 2, y: 2, sprite: "SPRITE_NURSE" });
  assert.match(indoor[0].contents, /object_const_def\n\tconst_export REDS_HOUSE_2F_EDITOR_NPC_1/);
  for (const write of indoor) contents.set(write.path, write.contents);
  assert.equal((await loadMapNpcCreateDocument(source, "REDS_HOUSE_2F")).objectId, 2);
  const split = await loadMapNpcCreateDocument(source, "ROUTE_2");
  assert.equal(split.objectId, 3); // Both existing slots are item balls.
  assert.ok(split.sprites.length > 0);
  assert.match(split.spriteNote, /both areas/);

  // Exhaust the real object budget without renumbering old objects or signs.
  contents.set(objectPath, beforeObject);
  contents.set(scriptPath, beforeScript);
  const added = Array.from({ length: document.maxObjects - 2 }, (_, i) => i + 3);
  contents.set(objectPath, beforeObject.replace("Route1_Object:", added.map(id => `\tconst_export ROUTE1_FILLER_${id}\n`).join("") + "Route1_Object:")
    .replace("\tdef_warps_to", added.map(id => `\tobject_event 0, ${id}, SPRITE_YOUNGSTER, STAY, DOWN, TEXT_ROUTE1_FILLER_${id}\n`).join("") + "\tdef_warps_to"));
  contents.set(scriptPath, beforeScript.replace(/^([ \t]*dw_const[ \t]+Route1SignText,[ \t]*TEXT_ROUTE1_SIGN)/m,
    added.map(id => `\tdw_const Route1Youngster2Text, TEXT_ROUTE1_FILLER_${id}\n`).join("") + "$1"));
  await assert.rejects(loadMapNpcCreateDocument(source, "ROUTE_1"), /available object slots/);
  contents.set(objectPath, beforeObject);
  contents.set(scriptPath, beforeScript);
  contents.set("macros/scripts/maps.asm", contents.get("macros/scripts/maps.asm")!.replace("db \\1 + 4", "db \\1 + 5"));
  await assert.rejects(loadMapNpcCreateDocument(source, "ROUTE_1"), /reviewed object_event/);
  contents.set("macros/scripts/maps.asm", files.find(file => file.path === "macros/scripts/maps.asm")!.contents);

  // Symbol collision in a different assembly file must allocate a fresh name.
  contents.set("scripts/Collision.asm", "Route1EditorNpc3Text:\n\tret\n");
  const collision = await prepareMapNpcWrites(source, await loadMapNpcCreateDocument(source, "ROUTE_1"), values);
  assert.match(collision[1].contents, /Route1EditorNpc4Text:/);
  contents.delete("scripts/Collision.asm");

  // All emitted edits preserve CRLF neighbors byte for byte.
  contents.set(objectPath, beforeObject.replace(/\n/g, "\r\n"));
  contents.set(scriptPath, beforeScript.replace(/\n/g, "\r\n"));
  const crlf = await loadMapNpcCreateDocument(source, "ROUTE_1");
  const crlfWrites = await prepareMapNpcWrites(source, crlf, values);
  for (const write of crlfWrites) assert.ok(!/(?<!\r)\n/.test(write.contents));
  console.log("  NPC creation: source neighbors, sign IDs, item slots, sprite compatibility, plain-dialogue reuse, empty maps, rollback, undo/redo, and CRLF verified");
  return writes;
}
