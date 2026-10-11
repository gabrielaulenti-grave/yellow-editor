import assert from "node:assert/strict";
import { loadScriptInteractionDocument, prepareScriptInteractionWrites, prepareScriptRewardWrite } from "../src/core/scriptInteractions";
import type { ProjectSource } from "../src/core/types";
import { attachTextEditing, applyTextDocumentEdits, parseTextDocument } from "../src/core/textEditing";

export async function interactionRoundTrips(source: ProjectSource): Promise<Map<string, string>> {
  const changed = new Map<string, string>();
  const current = { ...source, readText: async (path: string) => changed.get(path) ?? source.readText(path) };
  const reward = await loadScriptInteractionDocument(current, "scripts/Route1.asm", "Route1Youngster1Text");
  assert.equal(reward.reward?.item, "POTION");
  assert.equal(reward.reward?.earlyFlag, "EVENT_GOT_POTION_SAMPLE");
  await assert.rejects(prepareScriptRewardWrite(current, reward, "POTION", 0, true), /quantity/);
  for (const write of await prepareScriptRewardWrite(current, reward, "SUPER_POTION", 2, true)) changed.set(write.path, write.contents);
  const saved = await loadScriptInteractionDocument(current, reward.path, reward.label);
  assert.equal(saved.reward?.item, "SUPER_POTION"); assert.equal(saved.reward.quantity, 2); assert.equal(saved.reward.earlyFlag, null);
  const beforeLeaves = await attachTextEditing({} as never, source).getTextLeafDocuments(reward.path, reward.label);
  const leaves = await attachTextEditing({} as never, current).getTextLeafDocuments(reward.path, reward.label);
  assert.deepEqual(leaves.map(leaf => leaf.segments), beforeLeaves.map(leaf => leaf.segments));
  assert.equal(leaves.length, 4);
  for (const leaf of leaves) {
    const original = await current.readText(leaf.path);
    const edited = applyTextDocumentEdits(original, leaf.label, leaf.segments.map((segment, i) => ({ ...segment, text: i ? segment.text : "Hello!" })));
    assert.equal(applyTextDocumentEdits(edited, leaf.label, leaf.segments), original);
  }
  let sign = await loadScriptInteractionDocument(current, "scripts/ViridianCity.asm", "ViridianCitySignText");
  assert.ok(sign.canCreate, sign.reason ?? "");
  const originalPointers = (await source.readText(sign.path)).match(/ViridianCity_TextPointers:[\s\S]*?(?=^\w+:)/m)?.[0];
  const values = { ...sign.values, reward: { item: "POTION", quantity: 1 }, condition: { event: "EVENT_GOT_POKEDEX", set: true }, events: [{ event: "EVENT_GOT_POTION_SAMPLE", set: false }] };
  for (const write of await prepareScriptInteractionWrites(current, sign, values)) changed.set(write.path, write.contents);
  sign = await loadScriptInteractionDocument(current, sign.path, sign.label);
  assert.deepEqual(sign.values, values);
  assert.equal((await current.readText(sign.path)).match(/ViridianCity_TextPointers:[\s\S]*?(?=^\w+:)/m)?.[0], originalPointers);
  for (const write of await prepareScriptInteractionWrites(current, sign, { ...values, reward: { item: "SUPER_POTION", quantity: 2 } })) changed.set(write.path, write.contents);
  sign = await loadScriptInteractionDocument(current, sign.path, sign.label);
  assert.equal(sign.values.reward?.quantity, 2);
  // Add an ordinary stationary NPC beside the sign, using a free existing object slot.
  const objectPath = "data/maps/objects/ViridianCity.asm";
  const objects = await current.readText(objectPath);
  changed.set(objectPath, objects.replace("ViridianCity_Object:", "\tconst_export VIRIDIANCITY_INTERACTION_TEST_NPC\n\nViridianCity_Object:").replace("def_warps_to VIRIDIAN_CITY", "\tobject_event 18, 19, SPRITE_YOUNGSTER, STAY, DOWN, TEXT_VIRIDIANCITY_INTERACTION_TEST_NPC\n\n\tdef_warps_to VIRIDIAN_CITY"));
  changed.set(sign.path, (await current.readText(sign.path)).replace(/^(\s*dw_const ViridianCitySignText,)/m, "\tdw_const ViridianCityInteractionTestNpcText, TEXT_VIRIDIANCITY_INTERACTION_TEST_NPC\n$1") + `\nViridianCityInteractionTestNpcText:\n\ttext "Hello there!"\n\tdone\n`);
  const inline = await loadScriptInteractionDocument(current, sign.path, "ViridianCityInteractionTestNpcText");
  assert.ok(inline.canCreate);
  for (const write of await prepareScriptInteractionWrites(current, inline, { ...inline.values, once: false, reward: { item: "POTION", quantity: 1 } })) changed.set(write.path, write.contents);
  assert.ok((await current.readText(sign.path)).includes('ViridianCityInteractionTestNpcTextEditorInteractionOriginal:\n\ttext "Hello there!"'));
  sign = await loadScriptInteractionDocument(current, sign.path, sign.label);
  const moveValues = { ...sign.values, movement: { npc: "VIRIDIANCITY_INTERACTION_TEST_NPC", steps: ["UP"], playerX: 17, playerY: 18 } };
  await assert.rejects(prepareScriptInteractionWrites(current, sign, { ...moveValues, movement: { ...moveValues.movement, steps: ["LEFT", "UP"] } }), /blocked|beside/);
  for (const write of await prepareScriptInteractionWrites(current, sign, moveValues)) changed.set(write.path, write.contents);
  sign = await loadScriptInteractionDocument(current, sign.path, sign.label);
  assert.deepEqual(sign.values, moveValues);
  const receipt = ["<PLAYER> received", "a MOON STONE!"];
  for (const write of await prepareScriptInteractionWrites(current, sign, { ...moveValues, dialogue: receipt })) changed.set(write.path, write.contents);
  assert.deepEqual((await loadScriptInteractionDocument(current, sign.path, sign.label)).values.dialogue, receipt);
  const receiptDocument = await loadScriptInteractionDocument(current, sign.path, sign.label);
  await assert.rejects(prepareScriptInteractionWrites(current, receiptDocument, { ...receiptDocument.values, dialogue: ["<DONE>"] }), /unsupported token/);
  await assert.rejects(prepareScriptInteractionWrites(current, receiptDocument, { ...receiptDocument.values, dialogue: ["<PLAYER> received!!!"] }), /18 spaces/);
  const receiptLabel = `${sign.label}EditorInteractionDialogue`;
  const leaf = await parseTextDocument(sign.path, receiptLabel, await current.readText(sign.path));
  changed.set(sign.path, applyTextDocumentEdits(await current.readText(sign.path), receiptLabel, leaf.segments.map((segment, i) => i === 1 ? { ...segment, control: "para" as const } : segment)));
  const paragraphDocument = await loadScriptInteractionDocument(current, sign.path, sign.label);
  for (const write of await prepareScriptInteractionWrites(current, paragraphDocument, paragraphDocument.values)) changed.set(write.path, write.contents);
  assert.equal((await parseTextDocument(sign.path, receiptLabel, await current.readText(sign.path))).segments[1].control, "para");
  const walkingLeaves = await attachTextEditing({} as never, current).getTextLeafDocuments(sign.path, sign.label);
  assert.equal(walkingLeaves.length, 4);
  assert.equal(walkingLeaves.find(leaf => leaf.label === receiptLabel)?.segments[1].control, "para");
  await assert.rejects(prepareScriptInteractionWrites(current, sign, moveValues), /changed/);
  console.log("  item rewards: Red/Yellow wrapper resolution, all four editable leaves, bag-full timing, sign conditions, regenerated actions, movement states and blocked routes passed");
  return changed;
}
