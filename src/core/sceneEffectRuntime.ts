import { isBattle } from "./interactionSequence";
import type { SceneNode } from "./interactionScene";
import type { ManagedInteraction } from "./scriptInteractions";

const sprite = (id: number, field: string) => `wSprite${String(id).padStart(2, "0")}${field}`;
export function renderSceneEffect(node: SceneNode, model: ManagedInteraction, next: (id: number) => string[]): string[] | null {
  const action = node.action, plan = model.scene!, p = model.prefix;
  if (!action || !plan.effects) return null;
  if (action.kind === "music") {
    if (action.mode === "restore") return [`\tcall ${p}RestoreMusic`, ...next(node.next!)];
    const track = plan.effects.music.find(track => track.id === action.track);
    return [`\tcall ${p}StopMusic`, ...(action.mode === "play" ? [`\tld c, BANK(${track!.header})`, `\tld a, ${track!.id}`, "\tcall PlayMusic"] : []),
      `\tld a, ${action.persist ? 2 : 1}`, "\tld [wEditorSceneMusic], a", ...next(node.next!)];
  }
  if (action.kind === "fade") return [`\tcall ${p}${action.mode === "out" ? "FadeOut" : "FadeIn"}`, ...next(node.next!)];
  if (!isBattle(action)) return null;
  const flags = plan.effects.battles[action.battleId!];
  if (node.kind === "battle-start") {
    const [trainerClass, party] = action.kind === "trainer-battle" ? action.trainer.split(":") : [];
    return [`\tCheckEvent ${flags.won}`, `\tjp nz, ${p}State${node.other}`,
      ...(flags.caught ? [`\tCheckEvent ${flags.caught}`, `\tjp nz, ${p}State${node.caught}`] : []),
      "\tld a, [wIsInBattle]", "\tand a", `\tjp nz, ${p}Abort`, "\tld a, [wCurOpponent]", "\tand a", `\tjp nz, ${p}Abort`,
      "\tld a, [wStatusFlags3]", "\tbit BIT_ON_DUNGEON_WARP, a", `\tjp nz, ${p}Abort`,
      "\tld a, [wMovementFlags]", "\tbit BIT_EXITING_DOOR, a", `\tjp nz, ${p}Abort`,
      "\tld a, [wCurMap]", "\tcp SAFARI_ZONE_EAST", "\tjr c, .ordinary", "\tcp SAFARI_ZONE_CENTER_REST_HOUSE", `\tjp c, ${p}Abort`, ".ordinary",
      "\tld a, [wPartyCount]", "\tand a", `\tjp z, ${p}Abort`, "\tcp PARTY_LENGTH + 1", `\tjp nc, ${p}Abort`,
      "\tfarcall AnyPartyAlive", "\tld a, d", "\tand a", `\tjp z, ${p}Abort`,
      ...(action.kind === "wild-battle" && action.cry ? [`\tld a, ${action.species}`, "\tcall PlayCry", "\tcall WaitForSoundToFinish"] : []),
      "\tld a, [wPartyCount]", "\tld [wEditorSceneBattlePartyCount], a", "\tld a, [wBoxCount]", "\tld [wEditorSceneBattleBoxCount], a",
      "\txor a", "\tld [wEditorSceneBattleResult], a", "\tld [wBattleType], a", "\tld [wBattleResult], a", "\tld [wJoyIgnore], a", "\tldh [hJoyHeld], a",
      "\tld hl, wStatusFlags4", "\tres BIT_NO_BATTLES, [hl]", "\tld hl, wStatusFlags3", "\tres BIT_PRINT_END_BATTLE_TEXT, [hl]", "\tres BIT_TALKED_TO_TRAINER, [hl]",
      "\tld hl, wStatusFlags7", `\t${action.kind === "trainer-battle" ? "set" : "res"} BIT_TRAINER_BATTLE, [hl]`,
      ...(action.kind === "wild-battle" ? [`\tld a, ${action.level}`, "\tld [wCurEnemyLevel], a", `\tld a, ${action.species}`] : [`\tld a, ${party}`, "\tld [wTrainerNo], a", `\tld a, OPP_${trainerClass}`]),
      "\tld [wCurOpponent], a", "\tld [wEnemyMonOrTrainerClass], a", "\tld a, 1", "\tld [wEditorSceneBattle], a", ...next(node.next!)];
  }
  // EnterMap has restored graphics, native map music and sprites. Restore the
  // scene's authored staging, then commit the outcome before any further action.
  return ["\tld a, [wEditorSceneBattle]", "\tcp 2", `\tjp nz, ${p}Abort`,
    "\txor a", "\tld [wEditorSceneBattle], a", ...plan.frozen.flatMap(id => ["\tld a, STAY", `\tld [${sprite(id, "StateData2MovementByte1")}], a`]),
    ...node.staging!.flatMap(actor => [`\tld a, ${actor.x + 4}`, `\tld [${sprite(actor.id, "StateData2MapX")}], a`, `\tld a, ${actor.y + 4}`, `\tld [${sprite(actor.id, "StateData2MapY")}], a`]),
    "\tcall UpdateSprites", "\tld hl, wStatusFlags4", "\tset BIT_NO_BATTLES, [hl]", "\tld a, $ff", "\tld [wJoyIgnore], a",
    "\tld a, [wEditorSceneBattleResult]", "\tand a", "\tjr z, .won", "\tcp 3", ...(flags.caught ? ["\tjr z, .caught"] : [`\tjp z, ${p}Abort`]),
    "\tcp 2", `\tjp nz, ${p}Abort`, ...next(node.other!), ".won", `\tSetEvent ${flags.won}`, ...next(node.next!),
    ...(flags.caught ? [".caught", `\tSetEvent ${flags.caught}`, ...next(node.caught!)] : [])];
}

export function renderSceneEffectHelpers(model: ManagedInteraction): string[] {
  const p = model.prefix, staging = model.scene!.nodes.flatMap((node, index) => node.kind === "battle-return" ? [
    `\tld a, [wEditorSceneState]`, `\tcp ${index}`, `\tjp nz, .next${index}`,
    ...node.staging!.flatMap(actor => [`\tld a, ${actor.x + 4}`, `\tld [${sprite(actor.id, "StateData2MapX")}], a`, `\tld a, ${actor.y + 4}`, `\tld [${sprite(actor.id, "StateData2MapY")}], a`]), "\tret", `.next${index}`,
  ] : []);
  return [`${p}StopMusic:`, "\txor a", "\tld [wAudioFadeOutControl], a", "\tld a, SFX_STOP_ALL_MUSIC", "\tld [wNewSoundID], a", "\tcall PlaySound", "\tld a, $ff", "\tld [wLastMusicSoundID], a", "\tret", "",
    `${p}RestoreMusic:`, `\tcall ${p}StopMusic`, "\tcall PlayDefaultMusic", "\txor a", "\tld [wEditorSceneMusic], a", "\tret", "",
    `${p}FadeOut:`, "\tld a, [wEditorScenePalette]", "\tand a", "\tjr nz, .saved", "\tld a, [wMapPalOffset]", "\tinc a", "\tld [wEditorScenePalette], a", ".saved", "\tcall GBFadeOutToBlack", "\tld a, 9", "\tld [wMapPalOffset], a", "\tret", "",
    `${p}FadeIn:`, "\tld a, [wEditorScenePalette]", "\tand a", "\tret z", "\tdec a", "\tpush af", "\tcall GBFadeInFromBlack", "\tpop af", "\tld [wMapPalOffset], a", "\txor a", "\tld [wEditorScenePalette], a", "\tjp LoadGBPal", "",
    `${p}RestoreBattleStaging::`, ...staging, "\tret", "",
  ];
}

export const effectScratchFields = "wEditorSceneBattle:: db\nwEditorSceneBattleResult:: db\nwEditorScenePalette:: db\nwEditorSceneMusic:: db\nwEditorSceneBattlePartyCount:: db\nwEditorSceneBattleBoxCount:: db\n\tds 1\n";
// Snapshot before ClearVariablesOnEnterMap clears the battle menu union. Native
// capture and running both return result 2; party/box growth distinguishes them
// without patching the battle engine or mistaking a failed ball for a capture.
export const effectEntryHook = [
  "\tld a, [wEditorSceneBattle]", "\tcp 1", "\tjr nz, .editorSceneReset", "\tld a, [wEditorSceneMap]", "\tld b, a", "\tld a, [wCurMap]", "\tcp b", "\tjr nz, .editorSceneReset",
  "\tld a, [wBattleResult]", "\tand a", "\tjr nz, .editorSceneResult", "\tld a, [wTrainerClass]", "\tand a", "\tld a, 0", "\tjr nz, .editorSceneResult",
  "\tld a, [wEnemyMonHP]", "\tld b, a", "\tld a, [wEnemyMonHP + 1]", "\tor b", "\tld a, 0", "\tjr z, .editorSceneResult", "\tld a, 2", ".editorSceneResult",
  "\tld [wEditorSceneBattleResult], a", "\tld a, [wPartyCount]", "\tld b, a", "\tld a, [wEditorSceneBattlePartyCount]", "\tcp b", "\tjr nz, .editorSceneCaught",
  "\tld a, [wBoxCount]", "\tld b, a", "\tld a, [wEditorSceneBattleBoxCount]", "\tcp b", "\tjr z, .editorSceneReturned", ".editorSceneCaught", "\tld a, 3", "\tld [wEditorSceneBattleResult], a",
  ".editorSceneReturned", "\tld a, 2", "\tld [wEditorSceneBattle], a", "\tld a, 1", "\tld [wEditorSceneActive], a", "\t; restore editor battle staging", "\tjr .editorSceneEntryDone", ".editorSceneReset",
  "\txor a", "\tld [wEditorSceneBattle], a", "\tld [wEditorScenePalette], a", "\tld [wEditorSceneMusic], a",
].join("\n") + "\n";
