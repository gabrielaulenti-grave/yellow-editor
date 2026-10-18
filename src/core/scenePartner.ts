import { hashText } from "./history";
import type { SceneNode, ScenePlan } from "./interactionScene";

export interface PartnerDomain { name: string; reason: string | null }
export interface PartnerRouteCell { x: number; y: number; toX: number; toY: number; step: string }
const contracts: Record<string, string> = {
  "home/pikachu.asm": "de4c338a47397156ea07078b3def87b70f22266cd18085513be2282729527cd3",
  "engine/pikachu/pikachu_follow.asm": "72e001483496c68e09b1d065a3e1532982efca08e05dab1afe1dc9d7a5b5515f",
  "engine/pikachu/pikachu_status.asm": "fdc5ab7b19adeb99a88c317eab3c485b05e33ab6176c56ab3e0c1d2fcbad4711",
  "engine/pikachu/pikachu_movement.asm": "971c73bb3a9dbc5fe4605d9993ab327e67a0937c1839c8b936248eb25228ef4a",
};
export async function inspectScenePartner(files: Map<string, string>, symbols: Map<string, number>): Promise<PartnerDomain> {
  if (!files.has("home/pikachu.asm")) return { name: "Following partner", reason: "This game has no supported following partner. Pikachu actions require Yellow's follower engine." };
  for (const [path, expected] of Object.entries(contracts)) {
    const code = (files.get(path) ?? "").replace(/\r\n/g, "\n").split(/\r?\n/).map(line => line.split(";", 1)[0].trim()).filter(Boolean).join("\n");
    if (await hashText(code) !== expected) return { name: "Pikachu", reason: "Partner actions require the reviewed Yellow detection, following and movement routines. This project's source differs." };
  }
  const ram = (files.get("ram/wram.asm") ?? "").split(/\r?\n/).map(line => line.split(";", 1)[0].trim()).filter(Boolean).join("\n");
  if (!/wPikachuFollowCommandBufferSize:: db\nwPikachuFollowCommandBuffer:: ds 16(?:\n|$)/.test(ram)) return { name: "Pikachu", reason: "Partner actions require the reviewed native following buffer layout." };
  const values = { PIKACHU_SPRITE_INDEX: 15, BIT_PIKACHU_SPAWN_STARTER: 7, PIKAMOVEMENT_DELAY: 0, PIKAMOVEMENT_STEP_DOWN: 0x1d, PIKAMOVEMENT_STEP_UP: 0x1e, PIKAMOVEMENT_STEP_LEFT: 0x1f, PIKAMOVEMENT_STEP_RIGHT: 0x20, PIKAMOVEMENT_LOOK_DOWN: 0x35, PIKAMOVEMENT_LOOK_UP: 0x36, PIKAMOVEMENT_LOOK_LEFT: 0x37, PIKAMOVEMENT_LOOK_RIGHT: 0x38, PIKAMOVEMENT_END: 0x3f };
  return { name: "Pikachu", reason: Object.entries(values).some(([key, value]) => symbols.get(key) !== value) ? "Partner sprite and movement constants differ from Yellow's reviewed layout." : null };
}

export function partnerDetection(prefix: string): string[] {
  return [`${prefix}PartnerPresent:`, `\tcall ${prefix}PartnerVisible`, "\tret nc", "\tld a, [wPikachuSpawnStateFlags]", "\tbit BIT_PIKACHU_SPAWN_STARTER, a", "\tjr z, .absent", "\tld a, [wEditorSceneActive]", "\tbit 7, a", "\tjr nz, .owned", "\tcall CheckPikachuFollowingPlayer", "\tjr nz, .absent", ".owned", "\tscf", "\tret", ".absent", "\tand a", "\tret", "",
    `${prefix}PartnerVisible:`, "\tfarcall ShouldPikachuSpawn", "\tret nc",
    "\tld a, [wPikachuOverworldStateFlags]", "\tbit 3, a", "\tjr nz, .absent",
    "\tld a, [wSpritePikachuStateData1PictureID]", "\tand a", "\tjr z, .absent",
    "\tld a, [wSpritePikachuStateData1ImageIndex]", "\tcp $ff", "\tjr z, .absent",
    "\tld a, [wSpritePikachuStateData1MovementStatus]", "\tand $7f", "\tjr z, .absent", "\tscf", "\tret", ".absent", "\tand a", "\tret", ""];
}

// Native movement is synchronous and bounded. The scene owns the follower
// until cleanup, using the existing active byte without allocating more WRAM.
export function renderPartnerMove(node: SceneNode, index: number, p: string, next: string[]): string[] {
  const action = node.action;
  if (action?.kind !== "partner-move") return [];
  return [`\tcall ${p}PartnerPresent`, "\tjr nc, .skip",
    "\tld a, [wSpritePikachuStateData1MovementStatus]", "\tand $7f", "\tcp 3", "\tret nc",
    "\tld a, [wUpdateSpritesEnabled]", "\tpush af", "\tld a, $ff", "\tld [wUpdateSpritesEnabled], a", "\tfarcall LoadPikachuShadowIntoVRAM", "\tpop af", "\tld [wUpdateSpritesEnabled], a",
    "\tcall DisablePikachuFollowingPlayer", "\tld hl, wEditorSceneActive", "\tset 7, [hl]", "\tld d, 16", ".route",
    "\tld a, [wSpritePikachuStateData2MapX]", `\tcp ${action.x + 4}`, "\tjr nz, .step",
    "\tld a, [wSpritePikachuStateData2MapY]", `\tcp ${action.y + 4}`, "\tjr z, .arrived", ".step",
    "\tpush de", `\tld hl, ${p}PartnerRoute${index}`, `\tcall ${p}PartnerStep`, "\tpop de", "\tjr nc, .blocked",
    "\tdec d", "\tjr nz, .route",
    // Check the destination after the sixteenth step as well.
    "\tld a, [wSpritePikachuStateData2MapX]", `\tcp ${action.x + 4}`, "\tjr nz, .blocked",
    "\tld a, [wSpritePikachuStateData2MapY]", `\tcp ${action.y + 4}`, "\tjr z, .arrived", ".blocked",
    `\tjp ${p}Abort`, ".arrived", ...(action.facing && action.facing !== "KEEP" ? [`\tld hl, ${p}PartnerLook${action.facing}`, "\tcall ApplyPikachuMovementData"] : []), ".skip", ...next];
}

export function partnerHelpers(plan: ScenePlan, p: string): string[] {
  if (!plan.partner) return [];
  const sprite = (id: number, field: string) => `wSprite${String(id).padStart(2, "0")}${field}`;
  return [...partnerDetection(p), ...partnerResume(plan, p),
    `${p}PartnerStep:`, "\tld a, [wSpritePikachuStateData2MapX]", "\tld b, a", "\tld a, [wSpritePikachuStateData2MapY]", "\tld c, a", ".find",
    "\tld a, [hli]", "\tcp $ff", "\tjr z, .blocked", "\tcp b", "\tjr nz, .skipX", "\tld a, [hli]", "\tcp c", "\tjr nz, .skipY",
    "\tld b, [hl]", "\tinc hl", "\tld c, [hl]", "\tinc hl", "\tpush bc", "\tpush hl", `\tcall ${p}PartnerTileClear`, "\tpop hl", "\tpop bc", "\tret nc",
    "\tld a, [hli]", "\tld h, [hl]", "\tld l, a", "\tpush bc", "\tcall ApplyPikachuMovementData", "\tpop bc",
    "\tld a, [wSpritePikachuStateData2MapX]", "\tcp b", "\tjr nz, .blocked", "\tld a, [wSpritePikachuStateData2MapY]", "\tcp c", "\tjr nz, .blocked", "\tscf", "\tret",
    ".skipX", "\tld de, 5", "\tadd hl, de", "\tjr .find", ".skipY", "\tld de, 4", "\tadd hl, de", "\tjr .find", ".blocked", "\tand a", "\tret", "",
    `${p}PartnerTileClear:`, "\tld a, [wXCoord]", "\tadd 4", "\tcp b", "\tjr nz, .objects", "\tld a, [wYCoord]", "\tadd 4", "\tcp c", "\tjp z, .blocked", ".objects",
    ...plan.frozen.flatMap(id => [
      `\tld a, [${sprite(id, "StateData1PictureID")}]`, "\tand a", `\tjr z, .next${id}`,
      `\tld a, [${sprite(id, "StateData2MapX")}]`, "\tcp b", `\tjr nz, .next${id}`,
      `\tld a, [${sprite(id, "StateData2MapY")}]`, "\tcp c", `\tjr nz, .next${id}`,
      `\tld a, ${id * 16}`, "\tldh [hCurrentSpriteOffset], a", "\tpush bc", "\tpredef IsObjectHidden", "\tpop bc",
      "\tldh a, [hIsToggleableObjectOff]", "\tand a", "\tjp z, .blocked", `.next${id}`,
    ]), "\tscf", "\tret", ".blocked", "\tand a", "\tret", "",
    ...["UP", "DOWN", "LEFT", "RIGHT"].flatMap(step => [`${p}Partner${step}:`, `\tdb PIKAMOVEMENT_DELAY, PIKAMOVEMENT_STEP_${step}, PIKAMOVEMENT_END`, ""]),
    ...["UP", "DOWN", "LEFT", "RIGHT"].flatMap(step => [`${p}PartnerLook${step}:`, `\tdb PIKAMOVEMENT_DELAY, PIKAMOVEMENT_LOOK_${step}, PIKAMOVEMENT_END`, ""]),
    ...plan.nodes.flatMap((node, i) => node.partnerRoute ? [`${p}PartnerRoute${i}:`, ...node.partnerRoute.flatMap(cell => [
      `\tdb ${cell.x + 4}, ${cell.y + 4}, ${cell.toX + 4}, ${cell.toY + 4}`, `\tdw ${p}Partner${cell.step}`,
    ]), "\tdb $ff", ""] : []),
  ];
}

function partnerResume(plan: ScenePlan, p: string): string[] {
  return [`${p}PartnerResume::`, "\tld hl, wEditorSceneActive", "\tbit 7, [hl]", "\tret z", "\tres 7, [hl]",
    "\tld a, $ff", "\tld [wPikachuFollowCommandBufferSize], a",
    "\tld a, [wSpritePikachuStateData2MapX]", "\tld b, a", "\tld a, [wSpritePikachuStateData2MapY]", "\tld c, a", "\tld d, 0", ".route",
    "\tld a, [wXCoord]", "\tadd 4", "\tcp b", "\tjr nz, .step", "\tld a, [wYCoord]", "\tadd 4", "\tcp c", "\tjp z, .ready", ".step",
    "\tld a, d", "\tcp 15", "\tjp nc, .fallback", "\tpush bc", "\tpush de", `\tcall ${p}PartnerReturnDirection`, "\tpop de", "\tpop bc", "\tand a", "\tjp z, .fallback", "\tpush af",
    "\tcp 1", "\tjr nz, .notDown", "\tinc c", "\tjr .clear", ".notDown", "\tcp 2", "\tjr nz, .notUp", "\tdec c", "\tjr .clear", ".notUp", "\tcp 3", "\tjr nz, .right", "\tdec b", "\tjr .clear", ".right", "\tinc b", ".clear",
    "\tpush bc", "\tpush de", `\tcall ${p}PartnerReturnTileClear`, "\tpop de", "\tpop bc", "\tjr nc, .unsafe", "\tpop af",
    "\tld hl, wPikachuFollowCommandBuffer", "\tpush de", "\tld e, d", "\tld d, 0", "\tadd hl, de", "\tpop de", "\tld [hl], a",
    "\tld a, d", "\tld [wPikachuFollowCommandBufferSize], a", "\tinc d", "\tjp .route", ".unsafe", "\tpop af", ".fallback",
    // If live actors obstruct the rejoin route, native respawning avoids walking
    // through them. Preserve the loaded VRAM slot: the native scheduler normally
    // runs before map graphics loading and clears that field with the sprite.
    // No old movement command is replayed and following is enabled.
    "\tld a, $ff", "\tld [wPikachuFollowCommandBufferSize], a", "\tcall EnablePikachuFollowingPlayer", "\tld a, [wSpritePikachuStateData2ImageBaseOffset]", "\tpush af", "\tfarcall SchedulePikachuSpawnForAfterText", "\tpop af", "\tld [wSpritePikachuStateData2ImageBaseOffset], a", "\tret", ".ready", "\tcall EnablePikachuFollowingPlayer", "\tret", "",
    `${p}PartnerReturnTileClear:`, "\tld a, [wXCoord]", "\tadd 4", "\tcp b", "\tjr nz, .objects", "\tld a, [wYCoord]", "\tadd 4", "\tcp c", "\tjr nz, .objects", "\tscf", "\tret", ".objects", `\tjp ${p}PartnerTileClear`, "",
    `${p}PartnerReturnDirection:`,
    ...(plan.partnerReturns ?? []).flatMap((entry, i) => ["\tld a, [wXCoord]", `\tcp ${entry.x}`, `\tjr nz, .next${i}`, "\tld a, [wYCoord]", `\tcp ${entry.y}`, `\tjr nz, .next${i}`, `\tld hl, ${p}PartnerReturn${i}`, "\tjp .cell", `.next${i}`]),
    "\txor a", "\tret", ".cell", "\tpush hl", "\tld a, b", "\tld hl, wXCoord", "\tsub [hl]", "\tcp 9", "\tjr nc, .outside", "\tld e, a",
    "\tld a, c", "\tld hl, wYCoord", "\tsub [hl]", "\tdec a", "\tcp 7", "\tjr nc, .outside", "\tld d, a", "\tadd a", "\tadd a", "\tadd a", "\tadd d", "\tadd e", "\tld e, a", "\tld d, 0", "\tpop hl", "\tadd hl, de", "\tld a, [hl]", "\tret", ".outside", "\tpop hl", "\txor a", "\tret", "",
    ...(plan.partnerReturns ?? []).flatMap((entry, i) => [`${p}PartnerReturn${i}:`, `\tdb ${entry.steps.join(", ")}`, ""]),
  ];
}
