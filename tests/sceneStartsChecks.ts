import assert from "node:assert/strict";
import { identifySequenceDialogue } from "../src/core/interactionSequence";
import { InteractionValidationError } from "../src/core/interactionValidation";
import { loadMapNpcCreateDocument, prepareMapNpcWrites } from "../src/core/npcCreation";
import { loadMapNpcEditDocument, prepareMapNpcEditWrites } from "../src/core/npcEditing";
import { loadScriptInteractionDocument, prepareScriptInteractionWrites, type ManagedInteraction } from "../src/core/scriptInteractions";
import type { ProjectSource, TextWriteRequest } from "../src/core/types";

export async function sceneStartsChecks(source: ProjectSource, overlay: Map<string, string>) {
  const apply = (writes: TextWriteRequest[]) => writes.forEach(write => overlay.set(write.path, write.contents));
  const npc = await loadMapNpcCreateDocument(source, "VIRIDIAN_POKECENTER");
  apply(await prepareMapNpcWrites(source, npc, { x: 8, y: 4, sprite: "SPRITE_GENTLEMAN", movement: "STAY", direction: "DOWN", dialogue: { kind: "new", lines: ["Hello!"] } }));
  const path = "scripts/ViridianPokecenter.asm", label = `ViridianPokecenterEditorNpc${npc.objectId}Text`, actor = `VIRIDIAN_POKECENTER_EDITOR_NPC_${npc.objectId}`;
  let doc = await loadScriptInteractionDocument(source, path, label);
  const single = { ...doc.values, once: true, showOriginal: false, actions: identifySequenceDialogue([
    { kind: "dialogue", lines: ["This way!"] }, { kind: "follow-npc", npc: actor, steps: ["UP"] },
    { kind: "item", item: "POTION", quantity: 1 }, { kind: "dialogue", lines: ["We arrived!"] },
  ]), scene: { trigger: "interaction" as const, playerX: 8, playerY: 5, idleState: 0, hiddenNpcs: [] } };
  apply(await prepareScriptInteractionWrites(source, doc, single));
  doc = await loadScriptInteractionDocument(source, path, label);
  const multi = { ...single, scene: { ...single.scene, additionalStarts: [{ x: 7, y: 4 }, { x: 9, y: 4 }] } };
  const writes = await prepareScriptInteractionWrites(source, doc, multi);
  const interaction = JSON.parse(writes.find(write => write.path === path)!.contents.match(new RegExp(`yellow-editor-interaction: (.*"label":"${label}".*)`))![1]) as ManagedInteraction;
  assert.deepEqual(interaction.scene!.starts!.map(({ x, y }) => ({ x, y })), [{ x: 8, y: 5 }, ...multi.scene.additionalStarts]);
  assert.deepEqual(interaction.scene!.nodes.filter(node => node.kind === "player-start").map(node => node.step).sort(), ["LEFT", "RIGHT", "UP"]);
  assert.equal(interaction.scene!.nodes.filter(node => node.action?.kind === "item").length, 1, "Identical tails share delivery and text states");
  apply(writes);
  doc = await loadScriptInteractionDocument(source, path, label);
  assert.deepEqual(doc.values, multi);
  assert.equal((await prepareScriptInteractionWrites(source, doc, doc.values)).find(write => write.path === path)!.contents, overlay.get(path));
  await assert.rejects(() => prepareScriptInteractionWrites(source, doc, { ...multi, scene: { ...multi.scene, additionalStarts: [{ x: 8, y: 5 }] } }), /different tile/);
  await assert.rejects(() => prepareScriptInteractionWrites(source, doc, { ...multi, scene: { ...multi.scene, additionalStarts: [{ x: 7.5, y: 4 }] } }), /whole-number/);
  await assert.rejects(() => prepareScriptInteractionWrites(source, doc, { ...multi, scene: { ...multi.scene, additionalStarts: Array.from({ length: 8 }, (_, x) => ({ x, y: 4 })) } }), /at most 8/);
  await assert.rejects(() => prepareScriptInteractionWrites(source, doc, { ...multi, scene: { ...multi.scene, additionalStarts: [{ x: 8, y: 4 }] } }), /occupied by a visible NPC/);
  await assert.rejects(() => prepareScriptInteractionWrites(source, doc, { ...multi, scene: { ...multi.scene, additionalStarts: [{ x: -1, y: 4 }] } }), /Player start 2.*walkable/);
  await assert.rejects(() => prepareScriptInteractionWrites(source, doc, { ...multi, scene: { ...multi.scene, additionalStarts: [{ x: 8, y: 3 }] } }), error => {
    assert.ok(error instanceof InteractionValidationError);
    assert.equal(error.detail.actionPath, "Action2");
    assert.deepEqual(error.detail.tile, { x: 8, y: 3 });
    return /From player start 2.*blocked/.test(error.message);
  });
  const edit = await loadMapNpcEditDocument(source, "VIRIDIAN_POKECENTER", npc.objectId);
  await assert.rejects(() => prepareMapNpcEditWrites(source, edit, { ...edit.values, x: 9, y: 4, moveSceneStart: false }), /player start/);
  const moved = await prepareMapNpcEditWrites(source, edit, { ...edit.values, x: 8, y: 5, moveSceneStart: true });
  const movedModel = JSON.parse(moved.find(write => write.path === path)!.contents.match(new RegExp(`yellow-editor-interaction: (.*"label":"${label}".*)`))![1]) as ManagedInteraction;
  assert.deepEqual(movedModel.values.scene!.additionalStarts, [{ x: 7, y: 5 }, { x: 9, y: 5 }]);
  assert.equal(movedModel.values.scene!.playerY, 6);
  if (doc.scene.partner && !doc.scene.partner.reason) {
    const withPartner = await prepareScriptInteractionWrites(source, doc, { ...multi, actions: identifySequenceDialogue([
      { kind: "if-partner", following: [{ kind: "partner-move", x: 10, y: 4 }], absent: [] }, ...multi.actions,
    ]) });
    const partner = JSON.parse(withPartner.find(write => write.path === path)!.contents.match(new RegExp(`yellow-editor-interaction: (.*"label":"${label}".*)`))![1]) as ManagedInteraction;
    assert.equal(partner.scene!.partnerReturns!.length, 4, "All player starts and the joined following tile have rejoin fields");
  }
  const coordinateWrites = await prepareScriptInteractionWrites(source, doc, { ...multi, once: false, actions: identifySequenceDialogue([{ kind: "dialogue", lines: ["Welcome!"] }, { kind: "item", item: "POTION", quantity: 1 }]), scene: { ...multi.scene, trigger: "coordinate" } });
  const coordinate = JSON.parse(coordinateWrites.find(write => write.path === path)!.contents.match(new RegExp(`yellow-editor-interaction: (.*"label":"${label}".*)`))![1]) as ManagedInteraction;
  assert.equal(coordinate.flag, interaction.flag);
  assert.equal(coordinate.scene!.giftFlag, interaction.scene!.giftFlag);
  apply(coordinateWrites);
  const crlf = { ...source, readText: async (file: string) => (await source.readText(file)).replace(/\r?\n/g, "\r\n") };
  const reopened = await loadScriptInteractionDocument(crlf, path, label);
  assert.equal((await prepareScriptInteractionWrites(crlf, reopened, reopened.values)).find(write => write.path === path)!.contents.replace(/\r\n/g, "\n"), overlay.get(path));
  // The complete ROM build includes the larger, per-start following dispatcher.
  apply(await prepareScriptInteractionWrites(source, await loadScriptInteractionDocument(source, path, label), multi));
  console.log("Multiple player starts: per-start movement, shared flags/tails, reopen, CRLF, linked relocation and alternate-start diagnostics passed");
  return { interaction, coordinate };
}
