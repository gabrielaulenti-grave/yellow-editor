import assert from "node:assert/strict";
import { test } from "node:test";
import { contentFixture } from "./contentCreationFixture";
import { createProjectSession } from "../src/core/project";
import { loadBattleAnimationCatalog } from "../src/core/battleAnimations";
import { loadGraphicsCatalog } from "../src/core/graphics";
import { getSaveCompatibilityDescriptor } from "../src/core/saveCompatibility";
import { loadMoveCreateDocument, prepareMoveCreateWrites, type MoveCreateValues } from "../src/core/moveCreation";
import { trainerPlacementError } from "../src/core/mapTrainers";
import { creationSnapshot } from "../src/core/creationSupport";
import { inspectPlayerConditions, validatePlayerCondition, legacyPokedexMask, expandedPokedexMask } from "../src/core/playerConditions";
import { prepareScriptInteractionWrites } from "../src/core/scriptInteractions";
import { rows, code } from "../src/core/creationSupport";
import { replaceSpeciesRow } from "../src/core/pokemonSlots";
import { preparePokemonCreateWrites } from "../src/core/pokemonCreation";
import { expandPokemonRam } from "../src/core/pokemonStorage";

assert.ok(process.argv.slice(2).length, "Supply Red/Yellow sources.");
for (const root of process.argv.slice(2)) test(`${root}: additional moves, Pokémon and parties preserve old identities and survive undo/redo`, async () => {
  const { source, data, fail } = await contentFixture(root), session = await createProjectSession(source, {} as never);
  const npc = await session.getMapNpcCreateDocument("BLUES_HOUSE");
  await session.createMapNpc(npc, { x: 1, y: 1, sprite: "SPRITE_GENTLEMAN", movement: "STAY", direction: "DOWN", dialogue: { kind: "new", lines: ["Hello!"] } });
  const scriptPath = "scripts/BluesHouse.asm", scriptLabel = `BluesHouseEditorNpc${npc.objectId}Text`;
  const conditionDoc = await session.getScriptInteractionDocument(scriptPath, scriptLabel);
  await session.saveScriptInteraction(conditionDoc, { ...conditionDoc.values, once: false, condition: { kind: "dex-count", minimum: 1, status: "caught" }, visibleWhen: { kind: "dex-count", minimum: 1, status: "seen" } });
  for (const path of [scriptPath, "engine/overworld/toggleable_objects.asm"]) await source.writeText(path, (await source.readText(path)).replaceAll(expandedPokedexMask, legacyPokedexMask));
  const legacy = await session.getScriptInteractionDocument(scriptPath, scriptLabel);
  await prepareScriptInteractionWrites(source, legacy, legacy.values); // Exact earlier generated masks remain editable.
  const original = new Map([...data].map(([path, bytes]) => [path, bytes.slice()]));
  const moves = await session.getMoves(), index = await session.getPokemonIndex();
  const oldAnimations = await loadBattleAnimationCatalog(source, await loadGraphicsCatalog(source));
  const moveDoc = await session.getMoveCreateDocument(); assert.equal(moveDoc.reason, null);
  const values: MoveCreateValues = { constant: "EDITOR_SPARK", name: "EDITOR SPARK", animation: "THUNDERSHOCK", effect: "NO_ADDITIONAL_EFFECT", power: 65, accuracy: 100, pp: 15, moveType: "ELECTRIC", soundMoveId: 84 };
  const move = await session.createMove(moveDoc, values);
  assert.equal(move.id, 166); assert.equal((await session.getMoves())[165].constant, values.constant);
  assert.deepEqual((await session.getMoves()).slice(0, 165), moves);
  const newAnimations = await loadBattleAnimationCatalog(source, await loadGraphicsCatalog(source));
  assert.deepEqual(newAnimations.scripts.map(script => [script.id, script.constant, script.label]), oldAnimations.scripts.map(script => [script.id, script.constant, script.label]));
  assert.ok((await source.readText("engine/battle/core.asm")).includes("cp NUM_ATTACKS + 1"));
  assert.ok((await source.readText("home/names2.asm")).includes("cp ITEM_NAME"));
  await assert.rejects(prepareMoveCreateWrites(source, moveDoc, { ...values, constant: "SECOND_SPARK" }), /sources changed/);
  await assert.rejects(prepareMoveCreateWrites(source, await loadMoveCreateDocument(source), values), /already occurs/);
  const secondMove = await session.createMove(await session.getMoveCreateDocument(), { ...values, constant: "SECOND_SPARK", name: "SECOND SPARK" }); assert.equal(secondMove.id, 167);
  await session.undoLastSave();
  const saveBefore = await getSaveCompatibilityDescriptor(source, root.includes("yellow") ? "yellow" : "red");
  const pokemonDoc = await session.getPokemonCreateDocument(); assert.equal(pokemonDoc.reason, null);
  assert.equal(pokemonDoc.remainingSlots, 45); assert.equal(pokemonDoc.reclaimedSlots, 36); assert.equal(pokemonDoc.appendSlots, 9);
  const template = pokemonDoc.templates.find(entry => entry.constant === "BULBASAUR")!;
  const mon = await session.createPokemon(pokemonDoc, { constant: "EDITOR_MON", name: "EDITORMON", templateId: template.id, startingMove: values.constant, category: "TEST", description: ["A new Pokemon.", "It sparks often."] });
  assert.equal(mon.dexNumber, 152); assert.equal(mon.internalId, 31);
  for (const path of [scriptPath, "engine/overworld/toggleable_objects.asm"]) { assert.ok((await source.readText(path)).includes(expandedPokedexMask)); assert.ok(!(await source.readText(path)).includes(legacyPokedexMask)); }
  assert.deepEqual((await session.getPokemonIndex()).filter(entry => entry.internalId !== mon.internalId), index.filter(entry => entry.internalId !== mon.internalId));
  const details = await session.getPokemonDetails(mon.internalId, mon.sourceSlug);
  assert.equal(details.stats.dexConstant, "DEX_EDITOR_MON"); assert.equal(details.learnset[0].moveConstant, values.constant);
  assert.equal(details.pokedex?.category, "TEST"); assert.deepEqual(details.evolutions, []);
  const edit = await session.getPokemonEditDocument(mon.internalId, mon.sourceSlug);
  assert.equal(edit.values.startingMoves[0], values.constant); assert.ok(edit.options.moves.includes(values.constant));
  assert.ok(await source.exists("gfx/pokemon/front/editor_mon.png"));
  assert.notEqual((await getSaveCompatibilityDescriptor(source, root.includes("yellow") ? "yellow" : "red")).structuralHash, saveBefore.structuralHash);
  const snapshot = await creationSnapshot(source, []), conditions = inspectPlayerConditions(snapshot.text, snapshot.symbols);
  assert.equal(conditions.reason, null); assert.ok(conditions.moves.includes("EDITOR_SPARK")); assert.ok(!conditions.moves.includes("SHOWPIC_ANIM"));
  validatePlayerCondition({ kind: "dex-count", minimum: 152, status: "caught" }, { conditions, events: [], pokemon: ["EDITOR_MON"], items: [] });
  const classCatalog = await (session as unknown as { getTrainerBaseCatalog(): Promise<{ trainers: Array<{ id: string }> }> }).getTrainerBaseCatalog();
  const partyDoc = await session.getTrainerPartyCreateDocument(); assert.equal(partyDoc.reason, null);
  const party = await session.createTrainerParty(partyDoc, { classConstant: "YOUNGSTER", partyFormat: "individual-levels", pokemon: [{ level: 10, speciesConstant: "EDITOR_MON" }] });
  const nextCatalog = await (session as unknown as { getTrainerBaseCatalog(): Promise<{ trainers: Array<{ id: string; pokemon: Array<{ speciesConstant: string }> }> }> }).getTrainerBaseCatalog();
  assert.ok(nextCatalog.trainers.find(entry => entry.id === party.partyId)?.pokemon.some(mon => mon.speciesConstant === "EDITOR_MON"));
  assert.deepEqual(nextCatalog.trainers.filter(entry => entry.id !== party.partyId).map(entry => entry.id), classCatalog.trainers.map(entry => entry.id));
  const timeline = await session.getHistoryTimeline();
  await assert.rejects(session.selectivelyUndoHistoryEntry(timeline.entries.find(entry => entry.label === "Add move EDITOR_SPARK")!.id), /later content references/);
  await assert.rejects(session.selectivelyUndoHistoryEntry(timeline.entries.find(entry => entry.label === "Add Pokémon EDITOR_MON")!.id), /later content references/);
  const map = await session.getMapCreateDocument("ROCK_TUNNEL_B1F");
  await session.createMap(map, { constant: "CREATION_TEST_CAVE", width: map.visualization.map.width, height: map.visualization.map.height, layout: "copy", fillBlock: 0, borderBlock: map.borderBlock, musicMap: "DIGLETTS_CAVE", locationMap: "VERMILION_CITY", connection: null });
  const placement = await session.getMapTrainerDocument("CREATION_TEST_CAVE");
  const spot = placement.walkable.find(point => !trainerPlacementError(placement, { ...placement.values, ...point, sight: 0, copyParty: false, partyId: party.partyId }));
  assert.ok(spot);
  await session.saveMapTrainer(placement, { ...placement.values, ...spot, sight: 0, copyParty: false, partyId: party.partyId });
  await assert.rejects(session.selectivelyUndoHistoryEntry(timeline.entries.find(entry => entry.label === `Add trainer party ${party.partyId}`)!.id), /map placements/);
  await session.undoLastSave();
  await session.undoLastSave();
  await session.undoLastSave(); await session.redoLastUndo(); await session.undoLastSave();
  await session.undoLastSave(); assert.equal(await source.exists("gfx/pokemon/front/editor_mon.png"), false);
  await session.redoLastUndo(); assert.equal((await session.getPokemonIndex()).find(entry => entry.internalId === 31)?.constant, "EDITOR_MON");
  await session.undoLastSave(); await session.undoLastSave();
  assert.equal(data.size, original.size); for (const [path, bytes] of original) assert.deepEqual(data.get(path), bytes, path);
  fail("data/moves/names.asm"); await assert.rejects(session.createMove(await session.getMoveCreateDocument(), values), /Injected write failure/);
  for (const [path, bytes] of original) assert.deepEqual(data.get(path), bytes, `rollback ${path}`);
});

for (const root of process.argv.slice(2)) test(`${root}: slot review protects customized and referenced placeholders`, async () => {
  const { source } = await contentFixture(root), session = await createProjectSession(source, {} as never);
  const doc = await session.getPokemonCreateDocument();
  const set = async (path: string, edit: (text: string) => string) => source.writeText(path, edit(await source.readText(path)));
  const scriptBefore = await source.readText("scripts/BluesHouse.asm");
  await set("scripts/BluesHouse.asm", text => text + "\n\tld a, $1f\n\tld [wCurPartySpecies], a\n");
  await assert.rejects(session.createPokemon(doc, { constant: "STALE_MON", name: "STALEMON", templateId: 153, startingMove: "POUND", category: "TEST", description: ["A new Pokemon."] }), /sources changed/);
  await source.writeText("scripts/BluesHouse.asm", scriptBefore);
  await set("data/pokemon/names.asm", text => replaceSpeciesRow(text, "MonsterNames", "dname", 31, '\tdname "CUSTOM"'));
  await set("data/wild/maps/Route1.asm", text => text.replace(/db\s+\d+,\s*PIDGEY/, "db 3, $20"));
  await set("scripts/BluesHouse.asm", text => text + "\n; Custom encounter and gift\n\tLD A, $32\n\tLD [wCurPartySpecies], A\n\tlb bc, $43, 5\n\tcall GivePokemon\n");
  await set("constants/pokemon_constants.asm", text => text + "\nDEF MY_SPECIES EQU $34\n");
  await set("data/pokemon/evos_moves.asm", text => text.replace(/(MissingNo38EvosMoves:[\s\S]*?db )0/, (_, prefix) => `${prefix}EVOLVE_LEVEL, 10, RHYDON\n\tdb 0`));
  const next = await session.getPokemonCreateDocument();
  assert.ok([31, 32, 50, 52, 56, 67].every(id => next.blockedSlots.includes(id)));
  assert.equal(next.nextInternalId, 61); assert.equal(next.remainingSlots, 39);
  await assert.rejects(session.createPokemon(doc, { constant: "STALE_MON", name: "STALEMON", templateId: 153, startingMove: "POUND", category: "TEST", description: ["A new Pokemon."] }), /sources changed/);
  const ram = await source.readText("ram/wram.asm");
  const legacy = ram.replace("\tds 10\n\nwTownVisitedFlag", "; yellow-editor Pokédex padding\n\tds 10 - 2 * ((NUM_POKEMON + 7) / 8 - 19)\n\nwTownVisitedFlag");
  const expanded = expandPokemonRam(legacy); assert.equal(expandPokemonRam(expanded), expanded);
  assert.ok(expanded.includes("wGameProgressFlagsEnd::\n\n\tds 56\n"));
  assert.ok(expanded.includes("expanded Pokédex padding tail"));
});

for (const root of process.argv.slice(2)) test(`${root}: all 36 reclaimed and nine tail slots allocate without renumbering existing species`, async () => {
  const { source } = await contentFixture(root), session = await createProjectSession(source, {} as never);
  const original = (await session.getPokemonIndex()).filter(entry => entry.kind !== "missingno");
  const originalConstants = await source.readText("constants/pokemon_constants.asm");
  const holes = [...originalConstants.matchAll(/^\s*const_skip\s*; \$([0-9A-F]+)/gm)].map(m => parseInt(m[1], 16));
  const ids: number[] = [];
  for (let i = 0; i < 45; i++) {
    const doc = await session.getPokemonCreateDocument(); assert.equal(doc.remainingSlots, 45 - i); assert.equal(doc.reason, null);
    const result = await session.createPokemon(doc, { constant: `CAPACITY_${i + 1}`, name: `NEW${i + 1}`, templateId: 153, startingMove: "POUND", category: "TEST", description: ["A new Pokemon."] });
    ids.push(result.internalId); assert.equal(result.dexNumber, 152 + i);
  }
  assert.deepEqual(ids, [...holes, ...Array.from({ length: 9 }, (_, i) => 191 + i)]);
  const final = await session.getPokemonCreateDocument(); assert.equal(final.remainingSlots, 0); assert.ok(final.reason);
  const index = await session.getPokemonIndex();
  assert.deepEqual(index.filter(entry => !entry.constant?.startsWith("CAPACITY_")), original);
  const row = rows(await source.readText("data/pokemon/dex_order.asm"), "PokedexOrder", "db");
  assert.ok([182, 183, 184].every(id => code(row[id - 1]) === "db 0"));
  await session.undoLastSave(); await session.redoLastUndo();
  assert.equal((await session.getPokemonCreateDocument()).remainingSlots, 0);
  const graphics = await loadGraphicsCatalog(source); assert.equal(graphics.assets.filter(asset => /\/capacity_/.test(asset.path)).length, 90);
});

for (const root of process.argv.slice(2)) test(`${root}: earlier appended species and source artwork references survive reclaimed allocation`, async () => {
  const { source } = await contentFixture(root), session = await createProjectSession(source, {} as never);
  const originalPics = await source.readText("gfx/pics.asm"), originalLoader = await source.readText("home/pics.asm"), originalRam = await source.readText("ram/wram.asm");
  const slots = (await session.getPokemonIndex()).filter(entry => entry.kind === "missingno").map(entry => entry.internalId);
  const reserve = "scripts/EditorReservedSpecies.asm";
  await source.createFile!(reserve, new TextEncoder().encode(slots.map(id => `\tld a, ${id}\n\tld [wCurPartySpecies], a`).join("\n")));
  const values = { constant: "OLDER_MON", name: "OLDERMON", templateId: 153, startingMove: "POUND", category: "TEST", description: ["An older Pokemon."] };
  const older = await session.createPokemon(await session.getPokemonCreateDocument(), values); assert.equal(older.internalId, 191);
  // Reproduce the first beta's fixed Pics 5 placement and ten-byte RAM padding.
  await source.writeText("gfx/pics.asm", originalPics.replace(/^SECTION "Trainer Pics"/m, 'YellowEditor_OLDER_MON_Front:: INCBIN "gfx/pokemon/front/older_mon.pic"\nYellowEditor_OLDER_MON_Back:: INCBIN "gfx/pokemon/back/older_monb.pic"\n\nSECTION "Trainer Pics"'));
  await source.writeText("home/pics.asm", originalLoader);
  await source.writeText("ram/wram.asm", originalRam.replace("\tds 10\n\nwTownVisitedFlag", "; yellow-editor Pokédex padding\n\tds 10 - 2 * ((NUM_POKEMON + 7) / 8 - 19)\n\nwTownVisitedFlag"));
  await source.removeFile!(reserve);
  const before = (await session.getPokemonIndex()).find(entry => entry.internalId === 191);
  const doc = await session.getPokemonCreateDocument(); assert.equal(doc.nextInternalId, 31); assert.equal(doc.remainingSlots, 44);
  await session.createPokemon(doc, { ...values, constant: "NEWER_MON", name: "NEWERMON" });
  assert.deepEqual((await session.getPokemonIndex()).find(entry => entry.internalId === 191), before);
  assert.ok((await source.readText("gfx/pics.asm")).includes('SECTION "Editor Pokemon NEWER_MON pictures", ROMX'));
  const id = (await session.getHistoryTimeline()).entries.find(entry => entry.label === "Add Pokémon NEWER_MON")!.id;
  const path = "scripts/Route1.asm", previous = await source.readText(path);
  await source.writeText(path, previous + "\n\tdw YellowEditor_NEWER_MON_Front\n");
  await assert.rejects(session.selectivelyUndoHistoryEntry(id), /later content references/);
  await source.writeText(path, previous);
  await session.undoLastSave(); assert.equal((await session.getPokemonCreateDocument()).nextInternalId, 31);
});

for (const root of process.argv.slice(2)) test(`${root}: new Pokédex entries include the game's automatic final period only once`, async () => {
  const { source } = await contentFixture(root), session = await createProjectSession(source, {} as never), doc = await session.getPokemonCreateDocument();
  const base = { constant: "POSSUM", name: "POSSUM", templateId: 97, startingMove: "SLASH", category: "GHOST", description: ["It hides."] };
  for (const [input, expected] of [["It hides.", "It hides"], ["It hides", "It hides"], ["It hides...", "It hides.."], ["It hides.  ", "It hides"], ["12345678901234567.", "12345678901234567"]]) {
    const prepared = await preparePokemonCreateWrites(source, doc, { ...base, description: ["First. Second.", input] });
    const text = prepared.changes.find(change => change.path === "data/pokemon/dex_text.asm")!.contents;
    assert.ok(text.includes(`\ttext "First. Second."\n\tnext "${expected}"\n\tdex`));
  }
  await assert.rejects(preparePokemonCreateWrites(source, doc, { ...base, description: ["123456789012345678"] }), /17 characters/);
  await source.writeText("home/text.asm", (await source.readText("home/text.asm")).replace("ld [hl], '.'", "ld [hl], '!'") );
  await assert.rejects(preparePokemonCreateWrites(source, doc, base), /sources changed/);
  assert.match((await session.getPokemonCreateDocument()).reason!, /ending needs source review/);
});
