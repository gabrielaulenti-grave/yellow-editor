import assert from "node:assert/strict";
import { test } from "node:test";
import { contentFixture } from "./contentCreationFixture";
import { createProjectSession } from "../src/core/project";
import { defaultMoveBehavior, validateMoveBehavior, validateBehaviorFamily } from "../src/core/moveBehaviors";
import { installBehaviorHooks as installLegacy } from "../src/core/moveBehaviorRuntimeV1";
import { isStatMoveEffect, moveStats, type MoveStatChanges } from "../src/core/moveStatChanges";
import { behaviorDataPath, behaviorEnginePaths } from "../src/core/moveBehaviorRuntime";
import { prepareMoveEditWrites } from "../src/core/moveEditing";
import { moveDraftFromDocument, moveDraftIsDirty, moveDraftError } from "../src/editor/moveForm";

for (const root of process.argv.slice(2)) {
  test(`${root}: CRLF engines and environments without Web Crypto retain stat editor support`, async () => {
    const { source } = await contentFixture(root), session = await createProjectSession(source, {} as never);
    for (const path of behaviorEnginePaths) await source.writeText(path, (await source.readText(path)).replace(/\r?\n/g, "\r\n"));
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto")!;
    try {
      Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
      assert.equal((await session.getMoveCreateDocument()).behaviors.reason, null);
    } finally { Object.defineProperty(globalThis, "crypto", descriptor); }
    const doc = await session.getMoveEditDocument(14);
    await session.saveMoveEdit(doc, { ...doc.values, behavior: { ...doc.values.behavior!, statChanges: { target: "user", changes: [{ stat: "attack", stages: 1 }, { stat: "speed", stages: 1 }] } } });
    assert.equal((await session.getMoveEditDocument(14)).behaviors.reason, null);
    for (const path of behaviorEnginePaths) assert.ok(!/(^|[^\r])\n/.test(await source.readText(path)), path);
  });
  test(`${root}: combined stat moves support editing, templates, nested drafts and atomic history`, async () => {
    const { source, data, fail } = await contentFixture(root), session = await createProjectSession(source, {} as never);
    const doc = await session.getMoveEditDocument(14), before = new Map([...data].map(([path, bytes]) => [path, bytes.slice()]));
    const statChanges: MoveStatChanges = { target: "user", changes: [{ stat: "attack", stages: 1 }, { stat: "defense", stages: 1 }, { stat: "accuracy", stages: 1 }] };
    const values = { ...doc.values, power: 0, effect: "ATTACK_UP1_EFFECT", behavior: { ...doc.values.behavior!, statChanges } };
    fail(behaviorDataPath); await assert.rejects(session.saveMoveEdit(doc, values), /Injected/);
    assert.equal(data.size, before.size); for (const [path, bytes] of before) assert.deepEqual(data.get(path), bytes, path);
    await session.saveMoveEdit(doc, values);
    let saved = await session.getMoveEditDocument(doc.id); assert.equal(saved.behaviors.reason, null); assert.deepEqual(saved.values.behavior!.statChanges, statChanges);
    const clone = structuredClone(moveDraftFromDocument(saved)); assert.equal(moveDraftIsDirty(clone, saved), false);
    clone.behavior.statChanges!.changes[1].stages = 2; assert.equal(moveDraftIsDirty(clone, saved), true);
    assert.ok(moveDraftError({ ...clone, power: "40" }, saved));
    assert.ok(moveDraftError({ ...clone, effect: "HEAL_EFFECT" }, saved));
    const created = await session.createMove(await session.getMoveCreateDocument(), { constant: "EDITOR_COIL", name: "COIL", power: 0, accuracy: 100, pp: 20, moveType: "POISON", effect: "ATTACK_UP1_EFFECT", animation: "GROWTH", soundMoveId: 74, behavior: saved.values.behavior });
    let copy = await session.getMoveEditDocument(created.id); assert.deepEqual(copy.values.behavior!.statChanges, statChanges);
    const tickle: MoveStatChanges = { target: "opponent", changes: [{ stat: "attack", stages: -1 }, { stat: "defense", stages: -1 }] };
    await session.saveMoveEdit(copy, { ...copy.values, effect: "ATTACK_DOWN1_EFFECT", behavior: { ...copy.values.behavior!, statChanges: tickle } });
    copy = await session.getMoveEditDocument(created.id); assert.deepEqual(copy.values.behavior!.statChanges, tickle);
    await session.undoLastSave(); assert.deepEqual((await session.getMoveEditDocument(created.id)).values.behavior!.statChanges, statChanges);
    await session.undoLastSave(); await session.undoLastSave();
    assert.equal(data.size, before.size); for (const [path, bytes] of before) assert.deepEqual(data.get(path), bytes, `undo ${path}`);
    await session.redoLastUndo(); saved = await session.getMoveEditDocument(doc.id); assert.deepEqual(saved.values.behavior!.statChanges, statChanges);
    assert.equal(await source.exists(behaviorDataPath), true);
  });
  test(`${root}: version 1 behavior projects upgrade atomically and undo restores exact legacy bytes`, async () => {
    const { source, data, fail } = await contentFixture(root), session = await createProjectSession(source, {} as never), moves = await session.getMoves();
    const originals = new Map(await Promise.all(behaviorEnginePaths.map(async path => [path, await source.readText(path)] as const)));
    const legacy = installLegacy(originals);
    for (const [path, text] of legacy.changes) await source.writeText(path, text);
    const values = Object.fromEntries(moves.map(move => { const { statChanges: _, ...old } = defaultMoveBehavior(move.constant); return [move.constant, old]; }));
    values.POUND.priority = "first";
    const priorities = ["normal", "first", "last"], damage = ["level", "fixed", "random"], charges = ["generic", "whirlwind", "sunlight", "head", "glowing", "fly", "dig"];
    const rows = moves.map(move => { const v = values[move.constant]; return `\tdb ${[priorities.indexOf(v.priority), +v.counter, +v.badlyPoisoned, +v.rest, damage.indexOf(v.damageMode) + 1, v.fixedDamage, +(v.recoil === "half"), charges.indexOf(v.charge), 0, 0, 0, 0, 0, 0, 0, 0].join(", ")} ; ${move.constant}`; });
    await source.writeText(behaviorDataPath, ['; yellow-editor-move-behaviors: ' + JSON.stringify({ version: 1, patches: legacy.patches, values }), "PUSHS", 'SECTION "Editor move behavior data", ROMX', "EditorMoveBehaviorData::", ...rows, "\tassert @ - EditorMoveBehaviorData == NUM_ATTACKS * 16", "POPS", ""].join("\n"));
    const doc = await session.getMoveEditDocument(1); assert.equal(doc.behaviors.reason, null); assert.equal(doc.values.behavior!.priority, "first"); assert.equal(doc.values.behavior!.statChanges, null);
    assert.deepEqual(await prepareMoveEditWrites(source, doc, doc.values), []);
    const before = new Map([...data].map(([path, bytes]) => [path, bytes.slice()]));
    const next = { ...doc.values, power: 0, effect: "ATTACK_UP1_EFFECT", behavior: { ...doc.values.behavior!, statChanges: { target: "user" as const, changes: [{ stat: "attack" as const, stages: 1 }, { stat: "speed" as const, stages: 1 }] } } };
    fail(behaviorDataPath); await assert.rejects(session.saveMoveEdit(doc, next), /Injected/);
    for (const [path, bytes] of before) assert.deepEqual(data.get(path), bytes, `migration rollback ${path}`);
    await session.saveMoveEdit(doc, next);
    const upgraded = await session.getMoveEditDocument(1); assert.equal(upgraded.behaviors.reason, null); assert.equal(upgraded.values.behavior!.priority, "first");
    assert.match(await source.readText(behaviorDataPath), /"version":2/);
    assert.equal((await session.getMoveEditDocument(92)).values.behavior!.badlyPoisoned, true);
    await session.undoLastSave(); for (const [path, bytes] of before) assert.deepEqual(data.get(path), bytes, `migration undo ${path}`);
    assert.equal((await session.getMoveEditDocument(1)).behaviors.reason, null);
    await session.redoLastUndo(); assert.deepEqual((await session.getMoveEditDocument(1)).values.behavior!.statChanges, next.behavior.statChanges);
    const engine = behaviorEnginePaths[1]; await source.writeText(engine, (await source.readText(engine)).replace("EditorMBStatsChange:", "EditorMBStatsChange:\n\tnop"));
    const changed = await session.getMoveEditDocument(1); assert.match(changed.behaviors.reason!, /helpers changed/);
  });
  test(`${root}: altered native stat calculation refuses hook installation but ordinary move edits work`, async () => {
    const { source } = await contentFixture(root), session = await createProjectSession(source, {} as never), path = behaviorEnginePaths[0];
    await source.writeText(path, (await source.readText(path)).replace("CalculateModifiedStat:", "CalculateModifiedStat:\n\tnop"));
    const doc = await session.getMoveEditDocument(1); assert.match(doc.behaviors.reason!, /stat-change engine needs source review/);
    await session.saveMoveEdit(doc, { ...doc.values, power: 72 }); assert.equal((await session.getMoves())[0].power, 72);
    assert.equal(await source.exists(behaviorDataPath), false);
  });
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
test("stat groups reject ambiguous, empty, duplicate and unsupported changes", () => {
  const base = defaultMoveBehavior();
  for (const statChanges of [{ target: "both", changes: [{ stat: "attack", stages: 1 }] }, { target: "user", changes: [] }, { target: "user", changes: [{ stat: "spAttack", stages: 1 }] }, { target: "user", changes: [{ stat: "attack", stages: 0 }] }, { target: "user", changes: [{ stat: "speed", stages: 3 }] }, { target: "user", changes: [{ stat: "attack", stages: 1 }, { stat: "attack", stages: -1 }] }]) assert.throws(() => validateMoveBehavior({ ...base, statChanges } as never));
  const value = { ...base, statChanges: { target: "user" as const, changes: moveStats.map(stat => ({ stat, stages: stat === "defense" ? -1 : 2 })) } };
  assert.doesNotThrow(() => validateBehaviorFamily(value, "ATTACK_UP1_EFFECT", 0));
  assert.throws(() => validateBehaviorFamily(value, "ATTACK_UP1_EFFECT", 40), /Power 0/);
  assert.throws(() => validateBehaviorFamily(value, "NO_ADDITIONAL_EFFECT", 0), /stat-raising/);
  assert.equal(isStatMoveEffect("ATTACK_DOWN_SIDE_EFFECT"), false);
});
