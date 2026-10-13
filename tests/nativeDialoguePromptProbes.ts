import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { identifySequenceDialogue, renderInteractionSequence, sequenceDialogue, sequenceDialoguePrompts, type InteractionAction } from "../src/core/interactionSequence";

// Text drawing and menus are instrumented. The prompt, arrow placement,
// ManualTextScroll and A/B polling loop are taken from each game's real source.
export async function nativeDialoguePromptProbes(root: string, temporary: string, rgbds: string, cpu: string,
  run: (cmd: string, args: string[], cwd?: string) => string) {
  const text = await readFile(join(root, "home/text.asm"), "utf8");
  const joy = await readFile(join(root, "home/joypad2.asm"), "utf8");
  const extract = (source: string, first: string, last?: string) => {
    const start = source.indexOf(first), end = last ? source.indexOf(last, start + first.length) : source.length;
    assert.ok(start >= 0 && end > start); return source.slice(start, end);
  };
  const native = [extract(text, "PromptText::", "Paragraph::"), extract(text, "TextCommand_PROMPT_BUTTON::", "TextCommand_SCROLL::"),
    extract(joy, "WaitForTextScrollButtonPress::", "; (unless in link battle)"), extract(joy, "ManualTextScroll::")]
    .join("\n").replace("predef CableClub_Run", "call CableClub_Run").replace("callfar TownMapSpriteBlinkingAnimation", "call TownMapSpriteBlinkingAnimation");
  const dialogue = (message: string): InteractionAction => ({ kind: "dialogue", lines: [message] });
  const branch: InteractionAction = { kind: "if-event", event: "EVENT_GOT_POKEDEX", set: true, then: [dialogue("Then.")], otherwise: [dialogue("Otherwise.")] };
  const scenarios = [
    { name: "consecutive", actions: [dialogue("First."), dialogue("Second.")], prompts: 2, menus: 0 },
    { name: "declined", choice: 1, actions: [dialogue("Question?"), { kind: "choice", yes: [], no: [dialogue("No."), { kind: "end", complete: false }] }] as InteractionAction[], prompts: 1, menus: 1 },
    { name: "empty-menu", actions: [dialogue("Question?"), { kind: "choice", yes: [], no: [] }] as InteractionAction[], prompts: 0, menus: 1 },
    { name: "rejoin", actions: [branch, dialogue("Joined.")], prompts: 2, menus: 0 },
    { name: "rejoin-menu", actions: [branch, { kind: "choice", yes: [], no: [] }] as InteractionAction[], prompts: 0, menus: 1 },
    { name: "old-overwrite-reproduced", legacy: true, actions: [dialogue("First."), dialogue("Second.")], prompts: 0, menus: 0 },
    { name: "original-before-actions", original: true, actions: [dialogue("First."), dialogue("Second.")], prompts: 3, menus: 0 },
  ];
  let probes = 0;
  for (const scenario of scenarios) for (const button of [1, 2]) for (const event of [0, 1]) {
    const actions = identifySequenceDialogue(scenario.actions), prefix = "Scene", plan = sequenceDialoguePrompts(actions);
    const blocks = sequenceDialogue(actions).flatMap((block, i) => [`${prefix}${block.key}Text:`, `db ${i + 1}, ${!scenario.legacy && plan.get(block.key) ? "$58" : "$57"}`]);
    const code = renderInteractionSequence(actions, prefix, prefix, [], "Action", !scenario.legacy);
    const asm = [
      'INCLUDE "macros/const.asm"', 'INCLUDE "macros/code.asm"', 'INCLUDE "macros/coords.asm"', 'INCLUDE "macros/scripts/text.asm"', 'INCLUDE "constants/charmap.asm"',
      "DEF SCREEN_WIDTH EQU 20", "DEF SCREEN_HEIGHT EQU 18", "DEF wTileMap EQU $c800", "DEF wLinkState EQU $c010", "DEF LINK_STATE_BATTLING EQU 4", "DEF wTownMapSpriteBlinkingEnabled EQU $c011",
      "DEF hDownArrowBlinkCount1 EQU $ff90", "DEF hDownArrowBlinkCount2 EQU $ff91", "DEF hJoy5 EQU $ff92", "DEF PAD_A EQU 1", "DEF PAD_B EQU 2", "DEF SFX_PRESS_AB EQU 1",
      "DEF wDoNotWaitForButtonPressAfterDisplayingText EQU $c007", "DEF wCurrentMenuItem EQU $c008", "DEF EVENT_GOT_POKEDEX EQU 1",
      "MACRO CheckEvent", "ld a, [$c009]", "and a", "ENDM",
      'SECTION "Header", ROM0[$100]', "jp Entry", "ds $150 - @, 0", 'SECTION "Code", ROM0[$150]', "Entry:",
      "di", "ld sp, $dfff", "ld hl, $c000", "ld bc, $1000", ".clear:", "xor a", "ld [hli], a", "dec bc", "ld a, b", "or c", "jr nz, .clear",
      `ld a, ${button}`, "ld [$c00b], a", `ld a, ${event}`, "ld [$c009], a", `ld a, ${scenario.choice ?? 0}`, "ld [$c008], a",
      "call SceneEntry", "ld a, [wDoNotWaitForButtonPressAfterDisplayingText]", "and a", "jr nz, .finished",
      "xor a", "ld [$c006], a", "ld [$c00a], a", "call WaitForTextScrollButtonPress", "ld hl, $c014", "inc [hl]", ".finished:", "ProbeDone:", "halt", "jr ProbeDone",
      "SceneEntry:", ...(scenario.original ? ["ld hl, OriginalText", "call PrintText", "ld hl, AdvanceText", "call PrintText_NoCreatingTextBox", "ld a, 1", "ld [wDoNotWaitForButtonPressAfterDisplayingText], a"] : []),
      ...code, "SceneFinish:", "ret", "SceneBagFull:", "ret", ...blocks, "OriginalText:", "db 9, $57", "AdvanceText:", "text_promptbutton", "text_end",
      // Preserve the text-engine stack convention used by DoneText/PromptText.
      "PrintText:", "ld a, [$c001]", "and a", "jr z, .fresh", "push hl", "ld hl, $c002", "inc [hl]", "pop hl", ".fresh:",
      "ld a, [hli]", "ld [$c000], a", "ld [$c00e], a", "ld a, 1", "ld [$c001], a", "ld a, [hl]", "ld [$c012], a",
      "xor a", "ld [$c006], a", "ld [$c00a], a", "ld a, [hl]", "cp $58", "jr nz, .doneSetup", "ld a, 1", "ld [$c00a], a", ".doneSetup:",
      "push hl", "call PlaceStringProbe", "pop hl", "ld a, [$c012]", "cp $58", "ret nz", "jr Acknowledged",
      "PlaceStringProbe:", "ld a, [hl]", "push hl", "cp $58", "jp z, PromptText", "jp DoneText",
      "PrintText_NoCreatingTextBox:", "xor a", "ld [$c006], a", "ld a, 1", "ld [$c00a], a", "push hl", "call PromptCommandProbe", "pop hl", "jr Acknowledged",
      "PromptCommandProbe:", "push hl", "jp TextCommand_PROMPT_BUTTON", "NextTextCommand:", "ret",
      "Acknowledged:", "xor a", "ld [$c001], a", "ld hl, $c003", "inc [hl]", "ret",
      "YesNoChoice:", "xor a", "ld [$c001], a", "ld hl, $c004", "inc [hl]", "ret",
      "JoypadLowSensitivity:", "ld hl, $c005", "inc [hl]", "ld a, [$c000]", "ld hl, $c00e", "cp [hl]", "jr z, .sameText", "ld hl, $c00d", "inc [hl]", ".sameText:",
      "ld a, [$c00a]", "and a", "jr z, .noArrow", "ld a, [wTileMap + 16 * 20 + 18]", "cp '▼'", "jr z, .noArrow", "ld hl, $c00d", "inc [hl]", ".noArrow:",
      "ld hl, $c006", "inc [hl]", "ld a, [hl]", "cp 3", "ld a, 0", "jr c, .noButton", "ld a, [$c00b]", ".noButton:", "ldh [hJoy5], a", "ret",
      "ProtectedDelay3:", "HandleDownArrowBlinkTiming:", "CableClub_Run:", "TownMapSpriteBlinkingAnimation:", "WaitForSoundToFinish:", "PlaySound:", "DelayFrames:", "TextCommand_WAIT_BUTTON:", "ret", native,
    ].join("\n");
    const file = join(temporary, "prompt.asm"), obj = join(temporary, "prompt.o"), rom = join(temporary, "prompt.gb"), sym = join(temporary, "prompt.sym");
    await writeFile(file, asm);
    run(join(rgbds, "rgbasm"), ["-I", `${root}/`, "-o", obj, file]); run(join(rgbds, "rgblink"), ["-n", sym, "-o", rom, obj]); run(join(rgbds, "rgbfix"), ["-v", "-p", "0", rom]);
    const stop = (await readFile(sym, "utf8")).match(/^00:([0-9a-f]+) ProbeDone$/mi)![1];
    run(cpu, [rom, stop, `c002=${scenario.legacy ? 1 : 0}`, `c003=${scenario.prompts.toString(16)}`, `c004=${scenario.menus}`, "c00d=0", `c014=${scenario.legacy ? 1 : 0}`, `c005=${((scenario.prompts + (scenario.legacy ? 1 : 0)) * 3).toString(16)}`]);
    probes++;
  }
  console.log(`${root}: ${probes} native text-prompt CPU probes passed (A/B waits, visible arrow, message retention, menu handoff, branch joins, final-wait suppression and old-bug reproduction)`);
}
