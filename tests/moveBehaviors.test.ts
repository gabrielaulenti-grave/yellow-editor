import assert from "node:assert/strict";
import { test } from "node:test";
import { contentFixture } from "./contentCreationFixture";
import { createProjectSession } from "../src/core/project";
import { defaultMoveBehavior, validateMoveBehavior } from "../src/core/moveBehaviors";
import { behaviorDataPath, behaviorEnginePaths } from "../src/core/moveBehaviorRuntime";
import { prepareMoveEditWrites } from "../src/core/moveEditing";
import { moveDraftFromDocument, moveDraftIsDirty, moveDraftError } from "../src/editor/moveForm";

for (const root of process.argv.slice(2)) {
  test(`${root}: vanilla behavior variants are read without changing source`, async () => {
    const { source } = await contentFixture(root), session = await createProjectSession(source, {} as never), moves = await session.getMoves();
    const creation = await session.getMoveCreateDocument(); assert.equal(creation.behaviors.reason, null);
    for (const constant of ["QUICK_ATTACK", "COUNTER", "TOXIC", "REST", "SONICBOOM", "DRAGON_RAGE", "SEISMIC_TOSS", "NIGHT_SHADE", "PSYWAVE", "STRUGGLE", "DIG", "FLY", "SOLARBEAM"]) {
      const doc = await session.getMoveEditDocument(moves.find(move => move.constant === constant)!.id);
      assert.deepEqual(doc.values.behavior, defaultMoveBehavior(constant));
      assert.deepEqual(await prepareMoveEditWrites(source, doc, doc.values), []);
    }
    assert.equal(await source.exists(behaviorDataPath), false);
  });
  test(`${root}: properties install atomically, preserve identities and support history`, async () => {
    const { source, data, fail } = await contentFixture(root), session = await createProjectSession(source, {} as never), moves = await session.getMoves();
    const before = new Map([...data].map(([path, bytes]) => [path, bytes.slice()])), doc = await session.getMoveEditDocument(1);
    const values = { ...doc.values, behavior: { ...doc.values.behavior!, priority: "first" as const, secondaryChance: 100 } };
    fail(behaviorDataPath); await assert.rejects(session.saveMoveEdit(doc, values), /Injected/);
    assert.equal(data.size, before.size); for (const [path, bytes] of before) assert.deepEqual(data.get(path), bytes, `rollback ${path}`);
    await session.saveMoveEdit(doc, values); assert.deepEqual(await session.getMoves(), moves);
    let saved = await session.getMoveEditDocument(1); assert.equal(saved.behaviors.reason, null); assert.deepEqual(saved.values.behavior, values.behavior);
    const installed = new Map([...data].map(([path, bytes]) => [path, bytes.slice()]));
    await session.saveMoveEdit(saved, { ...saved.values, power: 80 });
    for (const path of [...behaviorEnginePaths, behaviorDataPath]) assert.deepEqual(data.get(path), installed.get(path), `ordinary edit preserves ${path}`);
    await session.undoLastSave(); await session.undoLastSave(); assert.equal(data.size, before.size);
    for (const [path, bytes] of before) assert.deepEqual(data.get(path), bytes, `undo ${path}`);
    await session.redoLastUndo(); saved = await session.getMoveEditDocument(1); assert.equal(saved.values.behavior!.priority, "first");
    const draft = moveDraftFromDocument(saved); assert.equal(moveDraftIsDirty(draft, saved), false);
    assert.equal(moveDraftIsDirty({ ...draft, behavior: { ...draft.behavior, secondaryChance: NaN } }, saved), true);
    const changed = { ...draft, behavior: { ...draft.behavior, fixedDamage: 999 } }; assert.equal(moveDraftIsDirty(changed, saved), true); assert.ok(moveDraftError(changed, saved));
  });
  test(`${root}: created moves copy special properties and extend the installed table`, async () => {
    const { source } = await contentFixture(root), session = await createProjectSession(source, {} as never), doc = await session.getMoveCreateDocument();
    const input = { constant: "EDITOR_TOXIC", name: "ED TOXIC", power: 0, accuracy: 100, pp: 20, moveType: "POISON", effect: "POISON_EFFECT", animation: "TOXIC", soundMoveId: 92, behavior: doc.behaviors.moves.TOXIC };
    const first = await session.createMove(doc, input);
    let selected = await session.getMoveEditDocument(first.id); assert.equal(selected.behaviors.reason, null); assert.equal(selected.values.behavior!.badlyPoisoned, true);
    const sourceBefore = await source.readText("data/moves/animations.asm");
    await session.saveMoveEdit(selected, { ...selected.values, effect: "POISON_SIDE_EFFECT1", behavior: { ...selected.values.behavior!, secondaryChance: 0, fixedDamage: 255, charge: "dig", additionalEffect: "FLINCH_SIDE_EFFECT1" } });
    selected = await session.getMoveEditDocument(first.id); assert.equal(selected.values.behavior!.secondaryChance, 0); assert.equal(await source.readText("data/moves/animations.asm"), sourceBefore);
    const second = await session.createMove(await session.getMoveCreateDocument(), { ...input, constant: "EDITOR_REST", name: "ED REST", effect: "HEAL_EFFECT", behavior: defaultMoveBehavior("REST") });
    assert.equal(second.id, first.id + 1); assert.equal((await session.getMoveEditDocument(second.id)).values.behavior!.rest, true);
    await session.undoLastSave(); assert.equal((await session.getMoveEditDocument(first.id)).behaviors.reason, null);
    await session.undoLastSave(); await session.undoLastSave(); assert.equal(await source.exists(behaviorDataPath), false);
  });
  test(`${root}: missing custom-engine files disable properties without blocking ordinary edits`, async () => {
    const { source } = await contentFixture(root), session = await createProjectSession(source, {} as never);
    await source.removeFile!("engine/battle/move_effects/heal.asm");
    const doc = await session.getMoveEditDocument(1); assert.match(doc.behaviors.reason!, /unavailable/);
    await session.saveMoveEdit(doc, { ...doc.values, power: 77 });
    assert.equal((await session.getMoves())[0].power, 77); assert.equal(await source.exists(behaviorDataPath), false);
  });
  test(`${root}: incompatible imported combinations can be repaired in the editor`, async () => {
    const { source } = await contentFixture(root), session = await createProjectSession(source, {} as never), doc = await session.getMoveEditDocument(1);
    await session.saveMoveEdit(doc, { ...doc.values, effect: "DRAIN_HP_EFFECT", behavior: { ...doc.values.behavior!, additionalEffect: "PARALYZE_SIDE_EFFECT1" } });
    const path = "data/moves/moves.asm";
    await source.writeText(path, (await source.readText(path)).replace(/(move POUND,\s*)DRAIN_HP_EFFECT/, "$1HEAL_EFFECT"));
    const imported = await session.getMoveEditDocument(1);
    assert.ok(moveDraftError(moveDraftFromDocument(imported), imported));
    await session.saveMoveEdit(imported, { ...imported.values, behavior: { ...imported.values.behavior!, additionalEffect: null } });
    const repaired = await session.getMoveEditDocument(1); assert.equal(moveDraftError(moveDraftFromDocument(repaired), repaired), null);
  });
  test(`${root}: stale and custom engines refuse property rewrites without losing drafts`, async () => {
    const { source } = await contentFixture(root), session = await createProjectSession(source, {} as never), doc = await session.getMoveEditDocument(1);
    const path = behaviorEnginePaths[1], original = await source.readText(path);
    await source.writeText(path, original + "\n; external edit\n");
    await assert.rejects(session.saveMoveEdit(doc, { ...doc.values, behavior: { ...doc.values.behavior!, rest: true } }), /sources changed/);
    await source.writeText(path, original.replace("cp TOXIC", "cp POUND"));
    const unsupported = await session.getMoveEditDocument(1); assert.ok(unsupported.behaviors.reason);
    await assert.rejects(session.saveMoveEdit(unsupported, { ...unsupported.values, behavior: { ...unsupported.values.behavior!, rest: true } }), /source review/);
    await session.saveMoveEdit(unsupported, { ...unsupported.values, power: 50 }); assert.equal(await source.exists(behaviorDataPath), false);
    await source.writeText(path, original);
    const fresh = await session.getMoveEditDocument(1); await session.saveMoveEdit(fresh, { ...fresh.values, behavior: { ...fresh.values.behavior!, priority: "first" } });
    const existing = await session.getMoveEditDocument(1);
    await source.writeText(behaviorDataPath, (await source.readText(behaviorDataPath)) + "; external\n");
    await assert.rejects(session.saveMoveEdit(existing, { ...existing.values, power: 80 }), /sources changed/);
    assert.ok((await session.getMoveEditDocument(1)).behaviors.reason);
  });
}
test("move behavior validation rejects unsupported and out-of-range values", () => {
  for (const patch of [{ priority: "faster" }, { recoil: "all" }, { charge: "other" }, { counter: 1 }, { fixedDamage: 0 }, { fixedDamage: 256 }, { secondaryChance: -1 }, { secondaryChance: 101 }, { secondaryChance: NaN }]) assert.throws(() => validateMoveBehavior({ ...defaultMoveBehavior(), ...patch } as never));
});
