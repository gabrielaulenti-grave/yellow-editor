import assert from "node:assert/strict";
import { identifySequenceDialogue, type InteractionAction } from "../src/core/interactionSequence";
import { loadScriptInteractionDocument, prepareScriptInteractionWrites, type ManagedInteraction } from "../src/core/scriptInteractions";
import { loadMapNpcEditDocument, prepareMapNpcEditWrites } from "../src/core/npcEditing";
import type { ProjectSource, TextWriteRequest } from "../src/core/types";

export async function scenePositionChecks(source: ProjectSource, overlay: Map<string, string>, previous: ManagedInteraction) {
  const path = "scripts/ViridianPokecenter.asm", actor = previous.scene!.actors.find(actor => actor.constant.includes("EDITOR_NPC"))!;
  const apply = (writes: TextWriteRequest[]) => writes.forEach(write => overlay.set(write.path, write.contents));
  const model = (writes: TextWriteRequest[]) => JSON.parse(writes.find(write => write.path === path)!.contents.match(new RegExp(`yellow-editor-interaction: (.*"label":"${previous.label}".*)`))![1]) as ManagedInteraction;
  const doc = await loadScriptInteractionDocument(source, path, previous.label);
  const actions: InteractionAction[] = [
    { kind: "if-position", test: { mode: "relative", npc: actor.constant, side: "LEFT" },
      then: [{ kind: "walk-npc", npc: actor.constant, steps: ["UP", "LEFT", "LEFT", "DOWN"] }],
      otherwise: [{ kind: "walk-npc", npc: actor.constant, steps: ["UP", "RIGHT", "RIGHT", "DOWN"] }] },
    { kind: "face-npc", npc: actor.constant, facing: "PLAYER" },
    { kind: "face-player", npc: actor.constant, facing: "NPC" },
    { kind: "if-position", test: { mode: "tile", x: 7, y: 4 }, then: [{ kind: "dialogue", lines: ["Left approach!"] }], otherwise: [{ kind: "dialogue", lines: ["Right approach!"] }] },
    { kind: "dialogue", lines: ["Now we can talk!"] },
  ];
  const values = { ...doc.values, showOriginal: false, actions: identifySequenceDialogue(actions), scene: { ...doc.values.scene!, playerX: 7, playerY: 4, additionalStarts: [{ x: 9, y: 4 }] } };
  const writes = await prepareScriptInteractionWrites(source, doc, values), position = model(writes);
  assert.deepEqual(position.scene!.nodes.filter(node => node.action?.kind === "face-npc").map(node => node.step).sort(), ["LEFT", "RIGHT"]);
  assert.deepEqual(position.scene!.nodes.filter(node => node.action?.kind === "face-player").map(node => node.step).sort(), ["LEFT", "RIGHT"]);
  assert.equal(position.scene!.nodes.filter(node => node.action?.kind === "dialogue").length, 3, "Shared dialogue is deduplicated after the different routes");
  apply(writes);
  const reopened = await loadScriptInteractionDocument(source, path, doc.label);
  assert.deepEqual(reopened.values, values);
  assert.equal(model(await prepareScriptInteractionWrites(source, reopened, reopened.values)).scene!.nodes.length, position.scene!.nodes.length);
  const reject = (actions: InteractionAction[], pattern: RegExp) => assert.rejects(() => prepareScriptInteractionWrites(source, reopened, { ...values, actions: identifySequenceDialogue(actions) }), pattern);
  await reject([{ kind: "if-position", test: { mode: "tile", x: 999, y: 4 }, then: [], otherwise: [] }], /map tile/);
  await reject([{ kind: "if-position", test: { mode: "tile", x: 30, y: 4 }, then: [], otherwise: [] }], /inside this map/);
  await reject([{ kind: "face-npc", npc: "MISSING", facing: "UP" }], /NPC from this map/);
  await reject([{ kind: "face-player", facing: "NPC" }], /NPC from this map/);
  await reject([{ kind: "visibility", npc: actor.constant, visible: false }, { kind: "face-npc", npc: actor.constant, facing: "UP" }], /hidden NPC/);
  const fixed = await prepareScriptInteractionWrites(source, reopened, { ...values, actions: [{ kind: "face-npc", npc: actor.constant, facing: "DOWN" }, { kind: "face-player", facing: "UP" }] });
  assert.deepEqual(model(fixed).scene!.nodes.filter(node => node.action?.kind.startsWith("face-")).map(node => node.step).sort(), ["DOWN", "UP"]);
  const followed = model(await prepareScriptInteractionWrites(source, reopened, { ...values, actions: identifySequenceDialogue([
    { kind: "follow-npc", npc: actor.constant, steps: ["UP"] },
    { kind: "if-position", test: { mode: "tile", x: 8, y: 4 }, then: [{ kind: "dialogue", lines: ["New player tile."] }], otherwise: [{ kind: "walk-npc", npc: actor.constant, steps: ["DOWN"] }] },
    { kind: "if-position", test: { mode: "relative", npc: actor.constant, side: "DOWN" }, then: [{ kind: "face-npc", npc: actor.constant, facing: "PLAYER" }], otherwise: [] },
  ]) }));
  assert.deepEqual(followed.scene!.nodes.filter(node => node.action?.kind === "face-npc").map(node => node.step), ["DOWN"], "Position tests use both characters' coordinates after following, not scene entry coordinates");
  // A deterministic arm can end before a movement that is reachable only on the
  // other side. Its unvisited tail must not acquire a bogus route.
  await prepareScriptInteractionWrites(source, reopened, { ...values, actions: identifySequenceDialogue([
    { kind: "if-position", test: { mode: "tile", x: 7, y: 4 }, then: [{ kind: "end", complete: false }], otherwise: [] },
    { kind: "walk-npc", npc: actor.constant, steps: ["UP"] },
  ]) });
  const edit = await loadMapNpcEditDocument(source, "VIRIDIAN_POKECENTER", actor.id);
  const moved = model(await prepareMapNpcEditWrites(source, edit, { ...edit.values, x: 9, y: 4, moveSceneStart: true }));
  const test = moved.values.actions!.find(action => action.kind === "if-position" && action.test.mode === "tile");
  assert.ok(test?.kind === "if-position" && test.test.mode === "tile");
  assert.equal(test.test.x, 8, "Linked relocation shifts exact position conditions with player starts");
  console.log("Position branches and facing: different approach routes, common dialogue, relative/exact conditions, reopen, relocation and invalid targets passed");
  return position;
}
