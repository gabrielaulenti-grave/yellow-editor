import assert from "node:assert/strict";
import { loadScriptInteractionDocument, prepareScriptInteractionWrites, prepareScriptPokemonGiftWrite } from "../src/core/scriptInteractions";
import { attachTextEditing } from "../src/core/textEditing";
import type { ProjectSource } from "../src/core/types";

export async function pokemonGiftRoundTrips(source: ProjectSource): Promise<Map<string, string>> {
  const changed = new Map<string, string>();
  const current = { ...source, readText: async (path: string) => changed.get(path) ?? source.readText(path) };
  for (const [path, label, species, level, hides] of [
    ["scripts/CeladonMansionRoofHouse.asm", "CeladonMansionRoofHouseEeveePokeballText", "EEVEE", 25, true],
    ["scripts/SilphCo7F.asm", "SilphCo7FSilphWorkerM1Text", "LAPRAS", 15, false],
  ] as const) {
    const document = await loadScriptInteractionDocument(current, path, label);
    assert.equal(document.pokemonReason, null);
    assert.equal(document.pokemon.length, 151);
    assert.equal(document.gift?.species, species);
    assert.equal(document.gift.level, level);
    assert.equal(document.gift.hidesObject, hides);
    assert.ok(!document.pokemon.includes("NO_MON") && !document.pokemon.includes("MON_GHOST") && !document.pokemon.includes("FOSSIL_AERODACTYL"));
    for (const badLevel of [0, 101, 1.5]) await assert.rejects(prepareScriptPokemonGiftWrite(current, document, "DRATINI", badLevel), /level/);
    await assert.rejects(prepareScriptPokemonGiftWrite(current, document, "MON_GHOST", 15), /valid Pokémon/);
    const original = await current.readText(path);
    const writes = await prepareScriptPokemonGiftWrite(current, document, "DRATINI", 20);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].contents, original.replace(`lb bc, ${species}, ${level}`, "lb bc, DRATINI, 20"));
    for (const write of writes) changed.set(write.path, write.contents);
    const saved = await loadScriptInteractionDocument(current, path, label);
    assert.equal(saved.gift?.species, "DRATINI"); assert.equal(saved.gift.level, 20);
    await assert.rejects(prepareScriptPokemonGiftWrite(current, document, "EEVEE", 25), /changed/);
    const leaves = await attachTextEditing({} as never, current).getTextLeafDocuments(path, label);
    if (!hides) assert.equal(leaves.filter(leaf => leaf.editable).length, 4, "Lapras's four dialogue branches must remain editable");
  }

  const npc = await loadScriptInteractionDocument(current, "scripts/ViridianCity.asm", "ViridianCityYoungster1Text");
  assert.ok(npc.canCreate);
  const values = { ...npc.values, pokemon: { species: "LAPRAS", level: 15 }, dialogue: ["Take good care", "of LAPRAS!"], bagFull: ["Make room in your", "party or PC BOX."] };
  for (const write of await prepareScriptInteractionWrites(current, npc, values)) changed.set(write.path, write.contents);
  const savedNpc = await loadScriptInteractionDocument(current, npc.path, npc.label);
  assert.deepEqual(savedNpc.values, values);
  await assert.rejects(prepareScriptInteractionWrites(current, savedNpc, { ...values, reward: { item: "POTION", quantity: 1 } }), /one reward/);
  await assert.rejects(prepareScriptInteractionWrites(current, savedNpc, { ...values, pokemon: { species: "LAPRAS", level: 101 } }), /level/);
  const altered = { ...current, readText: async (path: string) => path === "engine/events/give_pokemon.asm" ? (await current.readText(path)).replace("jr nc, .boxFull", "jr c, .boxFull") : current.readText(path) };
  const unsafe = await loadScriptInteractionDocument(altered, npc.path, npc.label);
  assert.ok(unsafe.pokemonReason);
  await assert.rejects(prepareScriptInteractionWrites(altered, unsafe, unsafe.values), /routine differs/);
  await assert.rejects(prepareScriptInteractionWrites(altered, savedNpc, values), /changed/);

  // An existing persistent Poké Ball slot can be converted without changing the
  // object table, toggle indexes, or save layout. Failed delivery must not hide it.
  const ballPath = "scripts/CeladonMansionRoofHouse.asm", ballLabel = "CeladonMansionRoofHouseEeveePokeballText";
  const oldBall = await current.readText(ballPath);
  changed.set(ballPath, oldBall.replace(/CeladonMansionRoofHouseEeveePokeballText:[\s\S]*$/, `${ballLabel}:\n\ttext_far _CeladonMansionRoofHouseHikerText\n\ttext_end\n`));
  const ball = await loadScriptInteractionDocument(current, ballPath, ballLabel);
  assert.ok(ball.canCreate);
  assert.equal(ball.hideObject, "TOGGLE_CELADON_MANSION_EEVEE_GIFT");
  const ballValues = { ...ball.values, showOriginal: false, pokemon: { species: "EEVEE", level: 25 }, hideObject: ball.hideObject, dialogue: ["Enjoy your EEVEE!"], bagFull: ["Make room in your", "party or PC BOX."] };
  await assert.rejects(prepareScriptInteractionWrites(current, ball, { ...ballValues, once: false }), /one-time/);
  await assert.rejects(prepareScriptInteractionWrites(current, ball, { ...ballValues, hideObject: "TOGGLE_OLD_AMBER" }), /own existing/);
  for (const write of await prepareScriptInteractionWrites(current, ball, ballValues)) changed.set(write.path, write.contents);
  assert.deepEqual((await loadScriptInteractionDocument(current, ballPath, ballLabel)).values, ballValues);

  // This is present in the ROM sweep after the item approach/return checks.
  const sign = await loadScriptInteractionDocument(current, "scripts/ViridianCity.asm", "ViridianCitySignText");
  if (sign.values.movement) {
    const giftValues = { ...sign.values, reward: null, pokemon: { species: "DRATINI", level: 20 }, bagFull: ["Make room in your", "party or PC BOX."] };
    for (const write of await prepareScriptInteractionWrites(current, sign, giftValues)) changed.set(write.path, write.contents);
    const reopened = await loadScriptInteractionDocument(current, sign.path, sign.label);
    assert.deepEqual(reopened.values, giftValues);
    assert.ok((await current.readText(sign.path)).includes("call z, WaitForTextScrollButtonPress"));
  }
  console.log("  Pokémon gifts: existing Eevee/Lapras parameter edits and dialogue branches, species/level validation, party/PC contract, one-time NPC gifts, persistent Poké Ball removal, and approach delivery round trips passed");
  return changed;
}
