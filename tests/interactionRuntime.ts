import assert from "node:assert/strict";
import type { ProjectSource } from "../src/core/types";

// Execute generated control flow on the real GB CPU. UI, inventory, and sprite
// routines are instrumented boundaries; movement completion is stepped explicitly.
export async function interactionRuntimeProbes(source: ProjectSource, runProbe: (asm: string, expected: string[]) => Promise<void>) {
  const script = await source.readText("scripts/ViridianCity.asm");
  const label = "ViridianCitySignText";
  const prefix = `${label}EditorInteraction`;
  const marker = `; yellow-editor-interaction-code-end ${label}`;
  const code = script.slice(script.indexOf(`${label}:`), script.indexOf(marker));
  assert.ok(code.includes(`${prefix}CleanupState:`));
  const slot = code.match(/wSprite([0-9A-F]{2})StateData1MovementStatus/)![1];
  const npcId = Number.parseInt(slot, 16);
  const metadata = JSON.parse(code.match(/yellow-editor-interaction: (.*)/)![1]);
  const macros = await source.readText("macros/scripts/events.asm");
  const eventDefs = await source.readText("constants/event_constants.asm");
  const flag = metadata.flag;
  const idleStates: number[] = metadata.idleStates ?? [0];
  let count = 0;
  for (const scenario of [{ name: "delivered", bag: 1, enabled: true, claimed: false }, { name: "bag full", bag: 0, enabled: true, claimed: false }, { name: "already claimed", bag: 1, enabled: true, claimed: true }, { name: "condition false", bag: 1, enabled: false, claimed: false }, { name: "other side", bag: 1, enabled: true, claimed: false, otherSide: true },
    ...idleStates.slice(1).map(state => ({ name: `resume idle ${state}`, bag: 1, enabled: true, claimed: false, state })),
    { name: "scene active", bag: 1, enabled: true, claimed: false, state: idleStates.length, blockedState: true }]) {
    const resumeState = "state" in scenario ? scenario.state! : 0;
    const statePrefix = resumeState && idleStates.includes(resumeState) ? `${prefix}Resume${resumeState}` : prefix;
    const walks = scenario.enabled && !scenario.claimed && !scenario.otherSide && !("blockedState" in scenario);
    const setup = ["\tdi", "\tld sp, $dfff", "\tld hl, $c000", "\tld bc, $400", ".clear:", "\txor a", "\tld [hli], a", "\tdec bc", "\tld a, b", "\tor c", "\tjr nz, .clear", `\tld a, ${scenario.bag}`, "\tld [$c004], a", `\tld a, ${scenario.otherSide ? 16 : 17}`, "\tld [wXCoord], a", "\tld a, 18", "\tld [wYCoord], a", "\tld a, 1", "\tld [wSprite08StateData1MovementStatus], a", "\tld a, 22", "\tld [wSprite08StateData2MapX], a", "\tld a, 23", "\tld [wSprite08StateData2MapY], a"];
    setup.push(`\tld a, ${resumeState}`, "\tld [wViridianCityCurScript], a");
    if (scenario.enabled) setup.push("\tSetEvent EVENT_GOT_POKEDEX");
    if (scenario.claimed) setup.push(`\tSetEvent ${flag}`);
    setup.push(`\tcall ${label} + 1`);
    if (walks) setup.push(`\tcall ${statePrefix}StartState`, `\tcall ${statePrefix}ArriveState`, "\tld a, [$c003]", "\tld [$c00e], a", "\txor a", "\tld [wStatusFlags5], a", `\tcall ${statePrefix}ArriveState`, `\tcall ${statePrefix}CleanupState`, "\tld a, [wJoyIgnore]", "\tld [$c00f], a", "\txor a", "\tld [wStatusFlags5], a", `\tcall ${statePrefix}CleanupState`);
    const bindings = { wMapSpriteData: "$c020", NONE: "$ff", DOWN: "0", wEventFlags: "$c100", wStatusFlags5: "$c005", wJoyIgnore: "$c006", wAddedToParty: "$c010", wViridianCityCurScript: "$c007", wXCoord: "$c008", wYCoord: "$c009", wSprite08StateData1MovementStatus: "$c00a", wSprite08StateData2MapX: "$c00b", wSprite08StateData2MapY: "$c00c", hSpriteIndex: "$ff91", hSpriteFacingDirection: "$ff92", BIT_SCRIPTED_NPC_MOVEMENT: "7", VIRIDIANCITY_INTERACTION_TEST_NPC: String(npcId), SPRITE_FACING_LEFT: "8", NPC_MOVEMENT_UP: "$40", NPC_MOVEMENT_DOWN: "0", NPC_MOVEMENT_LEFT: "$80", NPC_MOVEMENT_RIGHT: "$c0", SUPER_POTION: "19", DRATINI: "88", SFX_GET_ITEM_1: "1" };
    const stubs = ["PrintText:", "\tld hl, $c002", "\tinc [hl]", "\tret", "GivePokemon:", "GiveItem:", "\tld hl, $c003", "\tinc [hl]", "\tld a, [$c004]", "\tand a", "\tret z", "\tscf", "\tret", "EnableAutoTextBoxDrawing:", "WaitForTextScrollButtonPress:", "PlaySound:", "WaitForSoundToFinish:", "SetSpriteFacingDirectionAndDelay:", "TextScriptEnd:", "\tret", "MoveSprite:", "\tld hl, $c00d", "\tinc [hl]", "\tld a, $80", "\tld [wStatusFlags5], a", "\tld a, $ff", "\tld [wJoyIgnore], a", "\tret", ...["Original", "Dialogue", "BagFullText", "AlreadyText"].flatMap(suffix => [`${prefix}${suffix}:`, "\tdb 0"])];
    const stateDefs = idleStates.slice(1).flatMap((idle, i) => ["START", "ARRIVE", "CLEANUP"].map((kind, offset) => `DEF SCRIPT_${prefix.toUpperCase()}_RESUME${idle}_${kind} EQU ${metadata.arrivalId + (i + 1) * 3 + offset}`)).join("\n");
    const asm = ['INCLUDE "macros/const.asm"', 'INCLUDE "macros/code.asm"', ...Object.entries(bindings).map(([key, value]) => `DEF ${key} EQU ${value}`), eventDefs, stateDefs, `DEF ${metadata.arrival} EQU ${metadata.arrivalId}\nDEF ${metadata.cleanup} EQU ${metadata.cleanupId}`, macros, 'SECTION "Header", ROM0[$100]', '\tjp Entry', '\tds $150 - @, 0', 'SECTION "Code", ROM0[$150]', 'Entry:', ...setup, 'ProbeDone:', '\thalt', '\tjr ProbeDone', code.replaceAll("\ttext_asm", "\tdb 8"), ...stubs].join("\n").replaceAll("wSprite08", `wSprite${slot}`);
    const expected = [`c007=${resumeState.toString(16)}`, "c006=0", `c003=${walks ? 1 : 0}`, `c00d=${walks ? 2 : 0}`, "c00e=0", `c00f=${walks ? "ff" : "0"}`];
    // Flag test uses the generated symbol's actual explicit numeric allocation.
    const flagValue = Number.parseInt(eventDefs.match(new RegExp(`DEF ${flag} EQU \\$([a-f0-9]+)`))![1], 16);
    const byte = 0xc100 + Math.floor(flagValue / 8);
    if (walks) expected.push("ff92=8", `${(0xc020 + (npcId - 1) * 2 + 1).toString(16)}=0`);
    expected.push(`${byte.toString(16)}=${scenario.claimed || walks && scenario.bag ? (1 << flagValue % 8).toString(16) : "0"}`);
    await runProbe(asm, expected); count++;
  }
  console.log(`  ${count} ${metadata.values.pokemon ? "Pokémon" : "item"} interaction CPU probes: delivery, full storage, repeat, condition, alternate approach, movement wait, return and input restoration passed`);
}
