import assert from "node:assert/strict";
import { loadScriptInteractionDocument, prepareScriptInteractionWrites, type ManagedInteraction } from "../src/core/scriptInteractions";
import { identifySequenceDialogue, type InteractionAction } from "../src/core/interactionSequence";
import type { ProjectSource } from "../src/core/types";

export async function sceneEffectChecks(source: ProjectSource, overlay: Map<string, string>, path: string, label: string, npc: string) {
  const doc = await loadScriptInteractionDocument(source, path, label);
  assert.equal(doc.effects.musicReason, null); assert.equal(doc.effects.fadeReason, null); assert.equal(doc.effects.battleReason, null);
  assert.ok(doc.effects.music.some(track => track.id === "MUSIC_MEET_PROF_OAK"));
  assert.ok(doc.effects.trainers.some(trainer => trainer.id === "YOUNGSTER:1"));
  if (await source.exists("scripts/OaksLab_2.asm")) assert.ok(doc.effects.music.some(track => track.id === "MUSIC_MEET_JESSIE_JAMES"), "Include Yellow's fourth music-header bank");
  const safari = await loadScriptInteractionDocument(source, "scripts/SafariZoneCenter.asm", "SafariZoneCenterRestHouseSignText");
  assert.match(safari.effects.battleReason!, /Safari/);
  const track = await source.exists("scripts/OaksLab_2.asm") ? "MUSIC_MEET_JESSIE_JAMES" : "MUSIC_MEET_PROF_OAK";
  const wild: InteractionAction = { kind: "wild-battle", battleId: "BattleStatic", species: "MEWTWO", level: 70, cry: true,
    won: [{ kind: "dialogue", lines: ["Defeated!"] }], caught: [{ kind: "dialogue", lines: ["Caught!"] }],
    escaped: [{ kind: "dialogue", lines: ["Escaped!"] }, { kind: "end", complete: false }] };
  const trainer: InteractionAction = { kind: "trainer-battle", battleId: "BattleTrainer", trainer: "YOUNGSTER:1", won: [{ kind: "dialogue", lines: ["You won!"] }] };
  const values = { ...doc.values, showOriginal: false, once: false, actions: identifySequenceDialogue([
    { kind: "music", mode: "play", track, persist: false },
    { kind: "walk-npc", npc, steps: ["LEFT"] },
    { kind: "choice", yes: [wild], no: [trainer] },
    { kind: "item", item: "POTION", quantity: 1 },
    { kind: "music", mode: "restore", track, persist: false },
    { kind: "fade", mode: "out" }, { kind: "visibility", npc, visible: false }, { kind: "wait", frames: 3 }, { kind: "fade", mode: "in" },
  ]) };
  const writes = await prepareScriptInteractionWrites(source, doc, values);
  writes.forEach(write => overlay.set(write.path, write.contents));
  const generated = overlay.get(path)!, model = JSON.parse(generated.match(/yellow-editor-interaction: (.*)/)![1]) as ManagedInteraction;
  assert.ok(model.scene!.effects);
  assert.equal(Object.keys(model.scene!.effects!.battles).length, 2);
  assert.equal(model.scene!.nodes.filter(node => node.kind === "battle-return").length, 2);
  const again = await loadScriptInteractionDocument(source, path, label);
  assert.deepEqual(again.values, values);
  assert.ok(!again.events.some(event => /_BATTLE_(?:WON|CAUGHT)$/.test(event)), "Authored actions cannot reset encounter checkpoints");
  const unchanged = await prepareScriptInteractionWrites(source, again, again.values);
  assert.equal(unchanged.find(write => write.path === path)!.contents, generated);
  assert.equal(unchanged.find(write => write.path === "engine/overworld/clear_variables.asm")!.contents, overlay.get("engine/overworld/clear_variables.asm"));
  assert.ok(overlay.get("ram/wram.asm")!.includes("scene-scratch: 2"));
  const crlf = { ...source, readText: async (path: string) => (await source.readText(path)).replace(/\r?\n/g, "\r\n") };
  const crlfDoc = await loadScriptInteractionDocument(crlf, path, label);
  assert.equal((await prepareScriptInteractionWrites(crlf, crlfDoc, crlfDoc.values)).find(write => write.path === path)!.contents.replace(/\r\n/g, "\n"), generated);
  const invalid = async (actions: InteractionAction[], pattern: RegExp) => assert.rejects(() => prepareScriptInteractionWrites(source, again, { ...values, actions: identifySequenceDialogue(actions) }), pattern);
  await invalid([{ kind: "music", mode: "play", track: "MUSIC_UNKNOWN", persist: false }], /supported music/);
  await invalid([{ ...trainer, trainer: "YOUNGSTER:255" }], /existing trainer party/);
  await invalid([{ ...wild, level: 101 }], /level from 1 to 100/);
  await invalid([{ kind: "fade", mode: "out" }, { kind: "dialogue", lines: ["Invisible!"] }], /Restore the screen/);
  await invalid([{ kind: "fade", mode: "out" }, wild], /Restore the screen/);
  await invalid([{ kind: "choice", yes: [{ kind: "fade", mode: "out" }], no: [] }], /Rejoining branches/);
  await invalid([wild, { ...wild, battleId: "BattleStatic" }], /unique valid identities/);
  for (const [dependency, symbol, reason] of [["home/audio.asm", "PlayMusic::", "musicReason"], ["home/fade.asm", "GBFadeOutToBlack::", "fadeReason"], ["engine/battle/end_of_battle.asm", "EndOfBattle:", "battleReason"]] as const) {
    const original = await source.readText(dependency);
    overlay.set(dependency, original.replace(symbol, symbol + "\n\tnop"));
    const drift = await loadScriptInteractionDocument(source, path, label);
    assert.ok(drift.effects[reason]);
    await assert.rejects(() => prepareScriptInteractionWrites(source, drift, values), /reviewed/);
    overlay.delete(dependency);
  }
  // Reordering a battle retains its reserved result bits.
  const reordered = structuredClone(values);
  [reordered.actions[0], reordered.actions[1]] = [reordered.actions[1], reordered.actions[0]];
  const moved = await prepareScriptInteractionWrites(source, again, reordered);
  const movedModel = JSON.parse(moved.find(write => write.path === path)!.contents.match(/yellow-editor-interaction: (.*)/)![1]) as ManagedInteraction;
  assert.deepEqual(movedModel.scene!.effects!.battles, model.scene!.effects!.battles);
  const persistent = structuredClone(values);
  for (const action of persistent.actions) if (action.kind === "music") { action.mode = "play"; action.persist = true; }
  const automaticFade = structuredClone(values);
  automaticFade.actions.pop();
  const previews: ManagedInteraction[] = [];
  for (const preview of [persistent, automaticFade]) {
    const writes = await prepareScriptInteractionWrites(source, again, preview);
    previews.push(JSON.parse(writes.find(write => write.path === path)!.contents.match(/yellow-editor-interaction: (.*)/)![1]) as ManagedInteraction);
  }
  console.log("Scene effects: symbolic music, Giovanni fades, wild/trainer results, stable checkpoint flags, legacy scratch migration, CRLF, reload and source refusals passed");
  return { model, generated, persistent: previews[0], automaticFade: previews[1] };
}
