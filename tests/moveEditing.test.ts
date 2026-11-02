import assert from "node:assert/strict";
import { test } from "node:test";
import { contentFixture } from "./contentCreationFixture";
import { createProjectSession } from "../src/core/project";
import { loadMoveEditDocument, prepareMoveEditWrites } from "../src/core/moveEditing";
import { moveDraftFromDocument, moveDraftIsDirty, moveDraftError } from "../src/editor/moveForm";

const roots = process.argv.slice(2); assert.ok(roots.length, "Supply Red/Yellow source directories.");
for (const root of roots) {
  test(`${root}: every vanilla move opens and no-op saves preserve exact source`, async () => {
    const { source } = await contentFixture(root), session = await createProjectSession(source, {} as never);
    for (const move of await session.getMoves()) {
      const doc = await session.getMoveEditDocument(move.id);
      assert.equal(doc.highCritical.reason, null);
      assert.equal(doc.values.highCritical, ["KARATE_CHOP", "RAZOR_LEAF", "CRABHAMMER", "SLASH"].includes(move.constant));
      assert.equal(doc.constant, move.constant); assert.equal(doc.values.name, move.name); assert.equal(doc.values.power, move.power);
      assert.deepEqual(await prepareMoveEditWrites(source, doc, doc.values), []);
      const draft = moveDraftFromDocument(doc); assert.equal(moveDraftIsDirty(draft, doc), false); assert.equal(moveDraftError(draft, doc), null);
    }
    assert.equal((await session.getHistoryTimeline()).entries.length, 0);
  });
  test(`${root}: edited names and stats preserve neighboring bytes, roll back failures, and undo/redo together`, async () => {
    const { source, data, fail } = await contentFixture(root), session = await createProjectSession(source, {} as never);
    for (const path of ["data/moves/moves.asm", "data/moves/names.asm"]) {
      const before = await source.readText(path), annotated = path.includes("names") ? before.replace('li "POUND"', 'li "POUND" ; keep name comment') : before.replace(/(move POUND[^\r\n]+)/, "$1 ; keep row comment");
      await source.writeText(path, annotated.replace(/\r?\n/g, "\r\n"));
    }
    const original = new Map([...data].map(([path, bytes]) => [path, bytes.slice()])), moves = await session.getMoves();
    const doc = await session.getMoveEditDocument(1), values = { name: "SOLAR PUNCH", power: 133, accuracy: 85, pp: 7, moveType: "ELECTRIC", effect: "PARALYZE_SIDE_EFFECT1" };
    fail("data/moves/names.asm"); await assert.rejects(session.saveMoveEdit(doc, values), /Injected write failure/);
    for (const [path, bytes] of original) assert.deepEqual(data.get(path), bytes, `rollback ${path}`);
    const saved = await session.saveMoveEdit(doc, values); assert.equal(saved.latestLabel, "Edit move POUND");
    const updated = await session.getMoves(); assert.deepEqual(updated.slice(1), moves.slice(1));
    assert.equal(updated[0].animation, moves[0].animation); assert.equal(updated[0].power, 133); assert.equal(updated[0].name, values.name);
    for (const path of ["data/moves/moves.asm", "data/moves/names.asm"]) {
      const before = new TextDecoder().decode(original.get(path)), after = await source.readText(path);
      const a = before.split("\r\n"), b = after.split("\r\n"); assert.equal(a.length, b.length); assert.equal(a.filter((line, i) => line !== b[i]).length, 1);
      assert.ok(after.includes(path.includes("names") ? "; keep name comment" : "; keep row comment"));
    }
    for (const [path, bytes] of original) if (!["data/moves/moves.asm", "data/moves/names.asm", "layout.link"].includes(path)) assert.deepEqual(data.get(path), bytes, path);
    await session.undoLastSave(); for (const [path, bytes] of original) assert.deepEqual(data.get(path), bytes, `undo ${path}`);
    await session.redoLastUndo(); assert.equal((await session.getMoves())[0].pp, 7);
    await session.selectivelyUndoHistoryEntry((await session.getHistoryTimeline()).entries[0].id); assert.equal((await session.getMoves())[0].power, 40);
  });
  test(`${root}: invalid values, stale sources and unsupported rows refuse writes`, async () => {
    const { source } = await contentFixture(root), doc = await loadMoveEditDocument(source, 1);
    for (const patch of [{ name: "" }, { name: "TOO LONG MOVE NAME" }, { name: 'BAD"NAME' }, { name: "BAD@NAME" }, { power: -1 }, { power: 256 }, { power: 4.5 }, { accuracy: 101 }, { accuracy: NaN }, { pp: 0 }, { pp: 41 }, { effect: "NOT_A_BEHAVIOR" }, { moveType: "NOT_A_TYPE" }]) await assert.rejects(prepareMoveEditWrites(source, doc, { ...doc.values, ...patch }));
    assert.ok(moveDraftError({ ...moveDraftFromDocument(doc), power: "" }, doc));
    await assert.rejects(loadMoveEditDocument(source, 0)); await assert.rejects(loadMoveEditDocument(source, 166));
    const original = await source.readText("data/moves/moves.asm");
    await source.writeText("data/moves/moves.asm", original + "\n; outside change\n");
    await assert.rejects(prepareMoveEditWrites(source, doc, { ...doc.values, power: 80 }), /sources changed/);
    await source.writeText("data/moves/moves.asm", original.replace('db \\3 ; power', 'db \\3 + 1 ; custom power'));
    await assert.rejects(loadMoveEditDocument(source, 1), /macro needs source review/);
    await source.writeText("data/moves/moves.asm", original.replace(/(move POUND[^\n]*?)(\b40\b)/, (_, prefix) => prefix + "$28"));
    await assert.rejects(loadMoveEditDocument(source, 1), /source expression|Expected move power/);
    await source.writeText("data/moves/moves.asm", original);
    const names = await source.readText("data/moves/names.asm"); await source.writeText("data/moves/names.asm", names.replace(/^\s*li "KARATE CHOP"\r?\n/m, ""));
    await assert.rejects(loadMoveEditDocument(source, 1), /synchronized/);
  });
  test(`${root}: created moves remain editable without changing their composed animation`, async () => {
    const { source } = await contentFixture(root), session = await createProjectSession(source, {} as never);
    const created = await session.createMove(await session.getMoveCreateDocument(), { constant: "EDIT_TEST", name: "EDIT TEST", power: 40, accuracy: 100, pp: 20, moveType: "NORMAL", effect: "NO_ADDITIONAL_EFFECT", animation: "THUNDERSHOCK", soundMoveId: 84 });
    const scripts = await source.readText("data/moves/animations.asm"), constants = await source.readText("constants/move_constants.asm");
    const doc = await session.getMoveEditDocument(created.id);
    await session.saveMoveEdit(doc, { ...doc.values, name: "EDITED MOVE", accuracy: 0, power: 0, pp: 40 });
    const move = (await session.getMoves()).find(move => move.id === created.id)!;
    assert.equal(move.name, "EDITED MOVE"); assert.equal(move.animation, "THUNDERSHOCK"); assert.equal(move.accuracy, 0);
    assert.equal(await source.readText("data/moves/animations.asm"), scripts); assert.equal(await source.readText("constants/move_constants.asm"), constants);
  });
  test(`${root}: a type or behavior remains selectable after its last user changes`, async () => {
    const { source } = await contentFixture(root), session = await createProjectSession(source, {} as never);
    const moves = await session.getMoves();
    for (const constant of ["DRAGON_RAGE", "PAY_DAY"]) {
      const doc = await session.getMoveEditDocument(moves.find(move => move.constant === constant)!.id);
      await session.saveMoveEdit(doc, { ...doc.values, moveType: "NORMAL", effect: "NO_ADDITIONAL_EFFECT" });
      const next = await session.getMoveEditDocument(doc.id);
      assert.ok(next.options.types.includes(doc.values.moveType)); assert.ok(next.options.effects.includes(doc.values.effect));
      const creation = await session.getMoveCreateDocument(); assert.ok(creation.types.includes(doc.values.moveType)); assert.ok(creation.effects.includes(doc.values.effect));
      await session.saveMoveEdit(next, doc.values);
    }
  });
}

for (const root of roots) {
  test(`${root}: high-critical membership saves atomically, preserves comments and supports undo/redo`, async () => {
    const { source, data, fail } = await contentFixture(root), session = await createProjectSession(source, {} as never);
    const path = "data/battle/critical_hit_moves.asm", unused = await source.readText("data/battle/unused_critical_hit_moves.asm");
    await source.writeText(path, (await source.readText(path)).replace("db SLASH", "db SLASH ; keep explanation").replace(/\r?\n/g, "\r\n"));
    const before = new Map([...data].map(([path, bytes]) => [path, bytes.slice()]));
    const doc = await session.getMoveEditDocument(1);
    fail(path); await assert.rejects(session.saveMoveEdit(doc, { ...doc.values, power: 80, highCritical: true }), /Injected write failure/);
    for (const [path, bytes] of before) assert.deepEqual(data.get(path), bytes, `rollback ${path}`);
    await session.saveMoveEdit(doc, { ...doc.values, power: 80, highCritical: true });
    assert.equal((await session.getMoveEditDocument(1)).values.highCritical, true);
    assert.ok((await source.readText(path)).includes("\tdb POUND\r\n\tdb -1"));
    assert.equal(await source.readText("data/battle/unused_critical_hit_moves.asm"), unused);
    await session.undoLastSave(); for (const [path, bytes] of before) assert.deepEqual(data.get(path), bytes, `undo ${path}`);
    await session.redoLastUndo(); assert.equal((await session.getMoveEditDocument(1)).values.highCritical, true);
    const slash = (await session.getMoves()).find(move => move.constant === "SLASH")!, slashDoc = await session.getMoveEditDocument(slash.id);
    await session.saveMoveEdit(slashDoc, { ...slashDoc.values, highCritical: false });
    assert.equal((await session.getMoveEditDocument(slash.id)).values.highCritical, false);
    assert.ok((await source.readText(path)).includes("\t; keep explanation\r\n"));
    await session.undoLastSave(); assert.equal((await session.getMoveEditDocument(slash.id)).values.highCritical, true);
    await assert.rejects(session.saveMoveEdit(slashDoc, { ...slashDoc.values, highCritical: "yes" as never }), /on or off/);
  });
  test(`${root}: changed, malformed and unreviewed critical sources are preserved`, async () => {
    const { source } = await contentFixture(root), session = await createProjectSession(source, {} as never);
    const path = "data/battle/critical_hit_moves.asm", original = await source.readText(path), engine = await source.readText("engine/battle/core.asm");
    const doc = await session.getMoveEditDocument(1);
    await source.writeText(path, original + "\n; external change\n");
    await assert.rejects(session.saveMoveEdit(doc, { ...doc.values, highCritical: true }), /sources changed/);
    await source.writeText(path, original);
    await source.writeText("engine/battle/core.asm", engine + "\n; external change\n");
    await assert.rejects(session.saveMoveEdit(doc, { ...doc.values, highCritical: true }), /sources changed/);
    await source.writeText("engine/battle/core.asm", engine);
    for (const malformed of [original.replace("db SLASH", "db UNKNOWN_MOVE"), original.replace("db -1", "db SLASH"), original.replace("db SLASH", "db SLASH, POUND"), original.replace("db -1", "db -1\n\tdb POUND")]) {
      await source.writeText(path, malformed);
      const unsupported = await session.getMoveEditDocument(1); assert.ok(unsupported.highCritical.reason);
      await assert.rejects(session.saveMoveEdit(unsupported, { ...unsupported.values, highCritical: true }));
      await session.saveMoveEdit(unsupported, { ...unsupported.values, power: 80 });
      assert.equal(await source.readText(path), malformed);
    }
    await source.writeText(path, original);
    await source.writeText("engine/battle/core.asm", engine.replace("ld hl, HighCriticalMoves", "ld hl, OtherMoves"));
    assert.match((await session.getMoveEditDocument(1)).highCritical.reason!, /lookup needs source review/);
  });
  test(`${root}: new moves can have independent high-critical membership`, async () => {
    const { source, data, fail } = await contentFixture(root), session = await createProjectSession(source, {} as never);
    const doc = await session.getMoveCreateDocument(); assert.equal(doc.highCritical.reason, null); assert.ok(doc.highCritical.moves.includes("SLASH"));
    const values = { constant: "NIGHT_SLASH", name: "NIGHT SLASH", power: 70, accuracy: 100, pp: 20, moveType: "GHOST", effect: "NO_ADDITIONAL_EFFECT", animation: "SLASH", soundMoveId: 163, highCritical: true };
    const before = new Map([...data].map(([path, bytes]) => [path, bytes.slice()]));
    fail("data/battle/critical_hit_moves.asm"); await assert.rejects(session.createMove(doc, values), /Injected write failure/);
    for (const [path, bytes] of before) assert.deepEqual(data.get(path), bytes, `creation rollback ${path}`);
    const created = await session.createMove(doc, values);
    const edit = await session.getMoveEditDocument(created.id); assert.equal(edit.values.highCritical, true); assert.equal(edit.values.moveType, "GHOST");
    await session.saveMoveEdit(edit, { ...edit.values, highCritical: false });
    assert.equal((await session.getMoveEditDocument(created.id)).values.highCritical, false);
    assert.equal((await session.getMoveCreateDocument()).highCritical.moves.includes("SLASH"), true);
    await session.undoLastSave(); await session.undoLastSave();
    for (const [path, bytes] of before) assert.deepEqual(data.get(path), bytes, `creation undo ${path}`);
    await session.redoLastUndo(); assert.equal((await session.getMoveEditDocument(created.id)).values.highCritical, true);
  });
}
