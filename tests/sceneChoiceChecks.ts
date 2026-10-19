import assert from "node:assert/strict";
import { identifySequenceDialogue, type InteractionAction } from "../src/core/interactionSequence";
import { sharedSceneFlag } from "../src/core/sceneFlags";
import { loadMapNpcCreateDocument, prepareMapNpcWrites } from "../src/core/npcCreation";
import { loadScriptInteractionDocument, prepareScriptInteractionWrites, prepareScriptRewardWrite, type ManagedInteraction, type InteractionValues } from "../src/core/scriptInteractions";
import type { ProjectSource, TextWriteRequest } from "../src/core/types";

export async function sceneChoiceChecks(source: ProjectSource, overlay: Map<string, string>) {
  const apply = (writes: TextWriteRequest[]) => writes.forEach(write => overlay.set(write.path, write.contents));
  for (const [label, item] of [["MtMoonB2FDomeFossilText", "DOME_FOSSIL"], ["MtMoonB2FHelixFossilText", "HELIX_FOSSIL"]]) {
    const native = await loadScriptInteractionDocument(source, "scripts/MtMoonB2F.asm", label);
    assert.equal(native.reward?.item, item, "Recognize native fossil gifts through their shared bag-full handler");
    assert.equal(native.canCreate, false, "Do not replace the native state machine with a plain interaction");
    const changed = await prepareScriptRewardWrite(source, native, item, 2);
    assert.ok(changed[0].contents.includes(`lb bc, ${item}, 2`));
    assert.ok(changed[0].contents.includes("SCRIPT_MTMOONB2F_MOVE_SUPER_NERD"));
  }
  const path = "scripts/ViridianPokecenter.asm";
  const entries: Array<{ actor: string; label: string }> = [];
  for (const [x, y, sprite] of [[7, 6, "SPRITE_SUPER_NERD"], [7, 4, "SPRITE_FOSSIL"], [8, 4, "SPRITE_FOSSIL"]] as const) {
    const doc = await loadMapNpcCreateDocument(source, "VIRIDIAN_POKECENTER");
    apply(await prepareMapNpcWrites(source, doc, { x, y, sprite, movement: "STAY", direction: "DOWN", dialogue: { kind: "new", lines: ["A fossil!"] } }));
    entries.push({ actor: `VIRIDIAN_POKECENTER_EDITOR_NPC_${doc.objectId}`, label: `ViridianPokecenterEditorNpc${doc.objectId}Text` });
  }
  const [nerd, dome, helix] = entries;
  const flags = ["Fossil guardian defeated", "Fossil reward claimed", "Dome reward chosen", "Helix reward chosen"].map(sharedSceneFlag);
  const [won, group, domeFlag, helixFlag] = flags.map(flag => flag.event);
  const model = (writes: TextWriteRequest[], label: string) => JSON.parse(writes.find(write => write.path === path)!.contents.match(new RegExp(`yellow-editor-interaction: (.*"label":"${label}".*)`))![1]) as ManagedInteraction;
  let doc = await loadScriptInteractionDocument(source, path, nerd.label);
  const guardianValues: InteractionValues = { ...doc.values, sharedFlags: flags, showOriginal: false, once: false,
    scene: { trigger: "interaction", playerX: 8, playerY: 6, additionalStarts: [{ x: 7, y: 5 }], automaticStarts: [{ x: 8, y: 6 }], automaticCondition: { event: won, set: false }, idleState: 0, hiddenNpcs: [] },
    actions: identifySequenceDialogue([{ kind: "if-event", event: won, set: true,
      then: [{ kind: "if-event", event: group, set: true, then: [{ kind: "dialogue", lines: ["A lab can revive", "fossils."] }], otherwise: [{ kind: "dialogue", lines: ["We each take one!"] }] }],
      otherwise: [{ kind: "dialogue", lines: ["Both are mine!"] }, { kind: "trainer-battle", trainer: "SUPER_NERD:2", won: [{ kind: "event", event: won, set: true }] }, { kind: "dialogue", lines: ["OK! I will share!"] }] }]) };
  let writes = await prepareScriptInteractionWrites(source, doc, guardianValues);
  const guardian = model(writes, nerd.label); apply(writes);
  assert.equal((await loadScriptInteractionDocument(source, path, dome.label)).sharedFlags!.length, 4, "New flags are available to a different NPC after saving");
  const models: ManagedInteraction[] = [];
  for (const [entry, other, item, option, starts, route] of [
    [dome, helix, "DOME_FOSSIL", domeFlag, [{ x: 6, y: 4 }, { x: 7, y: 3 }, { x: 7, y: 5 }], ["RIGHT", "UP"]],
    [helix, dome, "HELIX_FOSSIL", helixFlag, [{ x: 9, y: 4 }, { x: 8, y: 3 }, { x: 8, y: 5 }], ["UP"]],
  ] as const) {
    doc = await loadScriptInteractionDocument(source, path, entry.label);
    const actions: InteractionAction[] = [{ kind: "if-event", event: won, set: true,
      then: [{ kind: "dialogue", lines: ["Take this fossil?"] }, { kind: "choice", no: [{ kind: "end", complete: false }], yes: [
        { kind: "item", item, quantity: 1, claim: { group, option } }, { kind: "dialogue", lines: ["Received a fossil!"] },
        { kind: "visibility", npc: entry.actor, visible: false }, { kind: "walk-npc", npc: nerd.actor, steps: [...route] },
        { kind: "face-npc", npc: nerd.actor, facing: "UP" }, { kind: "dialogue", lines: ["Then this is mine!"] }, { kind: "visibility", npc: other.actor, visible: false },
      ] }], otherwise: [{ kind: "dialogue", lines: ["Beat the guardian", "first."] }, { kind: "end", complete: false }] }];
    const values: InteractionValues = { ...doc.values, showOriginal: false, once: true, already: ["A fossil was", "chosen."], actions: identifySequenceDialogue(actions),
      scene: { trigger: "interaction", playerX: starts[0].x, playerY: starts[0].y, additionalStarts: [...starts.slice(1)], idleState: 0, hiddenNpcs: [] } };
    writes = await prepareScriptInteractionWrites(source, doc, values); models.push(model(writes, entry.label)); apply(writes);
    const reopened = await loadScriptInteractionDocument(source, path, entry.label);
    assert.deepEqual(reopened.values, values);
    assert.equal((await prepareScriptInteractionWrites(source, reopened, reopened.values)).find(write => write.path === path)!.contents, overlay.get(path), "Unchanged linked scenes round trip without rewriting neighbors");
  }
  const reopened = await loadScriptInteractionDocument(source, path, dome.label);
  await assert.rejects(() => prepareScriptInteractionWrites(source, reopened, { ...reopened.values, sharedFlags: [{ event: group, label: "Another name" }] }), /valid shared scene flag/);
  const bad = identifySequenceDialogue([{ kind: "item", item: "POTION", quantity: 1, claim: { group, option: helixFlag } }]);
  await assert.rejects(() => prepareScriptInteractionWrites(source, reopened, { ...reopened.values, actions: bad }), /same item and quantity/);
  const twoEqual = identifySequenceDialogue([{ kind: "item", item: "DOME_FOSSIL", quantity: 1, claim: { group, option: group } }]);
  await assert.rejects(() => prepareScriptInteractionWrites(source, reopened, { ...reopened.values, actions: twoEqual }), /two different shared flags/);
  const beforeFlags = overlay.get("constants/event_constants.asm")!;
  overlay.set("constants/event_constants.asm", beforeFlags.replace(new RegExp(`DEF ${group} EQU \\$[0-9a-f]+`), `DEF ${group} EQU $1`));
  await assert.rejects(() => loadScriptInteractionDocument(source, path, dome.label), /shared scene flag definition/);
  overlay.set("constants/event_constants.asm", beforeFlags);
  const crlf = { ...source, readText: async (path: string) => (await source.readText(path)).replace(/\r?\n/g, "\r\n") };
  assert.equal((await loadScriptInteractionDocument(crlf, path, dome.label)).sharedFlags!.length, 4);
  if (overlay.has("engine/events/pokedex_rating.asm")) {
    const rating = overlay.get("engine/events/pokedex_rating.asm")!;
    overlay.set("engine/events/pokedex_rating.asm", rating.replace("call CountSetBits", "call DelayFrame"));
    const drifted = await loadScriptInteractionDocument(source, path, dome.label);
    await assert.rejects(() => prepareScriptInteractionWrites(source, drifted, drifted.values), /reviewed Yellow Pokedex rating/);
    overlay.set("engine/events/pokedex_rating.asm", rating);
    const town = await source.readText("scripts/PalletTown.asm");
    overlay.set("scripts/PalletTown.asm", town + "\nUnreviewedRatingCall:\n\tcall DisplayDexRating\n\tret\n");
    const unsafe = await loadScriptInteractionDocument(source, path, dome.label);
    await assert.rejects(() => prepareScriptInteractionWrites(source, unsafe, unsafe.values), /unreviewed reference/);
    overlay.delete("scripts/PalletTown.asm");
    const clean = await loadScriptInteractionDocument(crlf, path, dome.label);
    const saved = await prepareScriptInteractionWrites(crlf, clean, clean.values);
    assert.ok(!saved.some(write => write.path === "engine/events/pokedex_rating.asm"), "The relocation is idempotent with CRLF input");
  }
  console.log("Linked fossil scene: native reward recognition, shared flag allocation, guardian battle, two pickups, all six approaches, shared visibility, no-room/No branches, reopening, CRLF and source guards passed");
  return { guardian, dome: models[0], helix: models[1], flags };
}
