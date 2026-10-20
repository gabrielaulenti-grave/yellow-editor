import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parseMapScriptProgram } from "../src/core/mapScriptProgram";
import { scriptSemanticNodeShape } from "../src/core/scriptRoundTripValidation";
import { projectTextCommandMacros } from "../src/core/scriptAudit";
import { contractSourcePart, reviewScriptEngineContracts, SCRIPT_CONTRACT_SOURCE_PARTS } from "../src/core/scriptEngineContracts";

const nodes = (body: string) => parseMapScriptProgram(`Root:\n${body}\n\tret\n`, "Root").states.find(s => s.label === "Root")!.nodes;
test("Yes/No binds RAM outcomes and both adjacent jump polarities", () => {
  for (const [flag, outcome, fallthrough] of [["z", "yes", "no"], ["nz", "no", "yes"]]) {
    const choice = nodes(`\tcall YesNoChoice\n; comment\n\tld a, [wCurrentMenuItem]\n\tand a\n\tjp ${flag}, .answer`)[0];
    assert.equal(choice.type, "service");
    if (choice.type !== "service") return;
    assert.deepEqual(choice.result, { variable: "wCurrentMenuItem", yes: 0, no: 1, cancel: "no" });
    assert.deepEqual(choice.branch, { outcome, target: ".answer", fallthrough });
  }
});
test("choice targets remain unknown through calls, labels, flag changes or carry tests", () => {
  for (const body of ["call Other\nld a, [wCurrentMenuItem]\nand a\njr nz, .no", "ld a, [wCurrentMenuItem]\nand a\ninc b\njr nz, .no", ".boundary\nld a, [wCurrentMenuItem]\nand a\njr nz, .no", "jr c, .yes"]) {
    const choice = nodes(`\tcall YesNoChoice\n${body}`).find(n => n.type === "service");
    assert.ok(choice?.type === "service"); assert.equal(choice.branch, undefined);
  }
});
test("sound cues distinguish previous-cue wait, separate completion wait, and uncertain IDs", () => {
  const cue = nodes("\tld a, SFX_GET_ITEM_1\n\tcall PlaySoundWaitForCurrent").find(n => n.type === "music");
  assert.ok(cue?.type === "music"); assert.equal(cue.action, "wait-then-play-sound"); assert.equal(cue.sound, "SFX_GET_ITEM_1");
  const unknown = nodes("\tld a, SFX_GET_ITEM_1\n\tcall ClobberA\n\tcall PlaySound").find(n => n.type === "music");
  assert.ok(unknown?.type === "music"); assert.equal(unknown.sound, undefined);
  assert.equal(nodes("\tcall WaitForSoundToFinish")[0].contractId, "sound-wait");
  assert.equal(nodes("\tcall StopAllMusic")[0].title, "Stop all audio");
  assert.notEqual(scriptSemanticNodeShape(nodes("call PlaySound")[0]), scriptSemanticNodeShape(cue));
  assert.notEqual(scriptSemanticNodeShape(nodes("call WaitForSoundToFinish")[0]), scriptSemanticNodeShape(nodes("ld c, 1\ncall DelayFrames")[0]));
});
test("movement waits yield the map dispatcher; they do not busy-wait", () => {
  for (const [body, contract] of [["ld a, [wStatusFlags5]\nbit BIT_SCRIPTED_NPC_MOVEMENT, a\nret nz", "npc-movement"], ["ld a, [wSimulatedJoypadStatesIndex]\nand a\nret nz", "player-movement"]]) {
    const wait = nodes(body).find(n => n.type === "wait");
    assert.ok(wait?.type === "wait"); assert.equal(wait.mode, "yield-map-state"); assert.equal(wait.contractId, contract);
  }
});
test("literal text aliases resolve; cycles, expressions and conflicting definitions do not", () => {
  const contents = 'MACRO sound_get_item_1\n db TX_SOUND_GET_ITEM_1\nENDM\nDEF sound_level_up EQUS "sound_get_item_1"\nDEF chain EQUS "sound_level_up"\nDEF a EQUS "b"\nDEF b EQUS "a"\nDEF expr EQUS "sound_get_item_1 + 1"\nDEF conflict EQUS "sound_get_item_1"\nREDEF conflict EQUS "unknown"\nIF VARIANT\nDEF conditional EQUS "sound_get_item_1"\nENDC\nDEF unsupported EQUS "sound_get_item_1"\nREDEF unsupported EQUS "sound_get_item_1 + 1"';
  const names = projectTextCommandMacros([{ path: "macros/text.asm", contents }]);
  assert.ok(names.has("sound_level_up")); assert.ok(names.has("chain"));
  for (const name of ["a", "b", "expr", "conflict", "conditional", "unsupported"]) assert.ok(!names.has(name));
});
test("missing or duplicate source markers cannot pass a reviewed contract", async () => {
  const part = SCRIPT_CONTRACT_SOURCE_PARTS[0];
  assert.equal(contractSourcePart("ret", part), null);
  assert.equal(contractSourcePart(`${part.start}\nret\n${part.start}\nret`, part), null);
  assert.ok((await reviewScriptEngineContracts([], "pokered")).every(c => c.sourceStatus === "source-drift"));
});

const [rgbdsInput, binjgbInput, ...projects] = process.argv.slice(2);
if (rgbdsInput || binjgbInput || projects.length) {
  test("reviewed Red and Yellow engine boundaries execute on the pinned CPU", async () => {
    assert.ok(rgbdsInput && binjgbInput && projects.length === 2, "Supply RGBDS, binjgb, Red and Yellow checkouts");
    const temporary = await mkdtemp(resolve("node_modules/.script-contract-probes-"));
    const run = (cmd: string, args: string[], cwd?: string) => {
      const result = spawnSync(cmd, args, { cwd, encoding: "utf8" });
      assert.equal(result.status, 0, `${cmd}: ${result.stderr}\n${result.stdout}`); return result.stdout;
    };
    const rgbds = resolve(rgbdsInput), binjgb = resolve(binjgbInput), cpu = join(temporary, "cpu");
    try {
      assert.equal(run("git", ["rev-parse", "HEAD"], binjgb).trim(), "8abd0d38d5bf109d7c280b27d815a8b53168adde");
      run("cc", ["-std=gnu11", "-O2", `-I${join(binjgb, "src")}`, resolve("tests/scriptRuntimeProbe.c"), ...["memory.c", "common.c", "emulator-debug.c"].map(f => join(binjgb, "src", f)), "-lm", "-o", cpu]);
      let passed = 0;
      async function probe(body: string, engine: string, expected: string[]) {
        const asm = join(temporary, "probe.asm"), object = join(temporary, "probe.o"), rom = join(temporary, "probe.gb"), sym = join(temporary, "probe.sym");
        await writeFile(asm, ['SECTION "Header", ROM0[$100]', '\tjp Entry', '\tds $150 - @, 0', 'SECTION "Code", ROM0[$150]', 'Entry:', '\tdi', '\tld sp, $dfff', '\txor a', '\tld hl, $c000', '\tld bc, $1000', '.clear:', '\tld [hli], a', '\tdec bc', '\tpush af', '\tld a, b', '\tor c', '\tjr z, .cleared', '\tpop af', '\tjr .clear', '.cleared:', '\tpop af', body, 'ProbeDone:', '\thalt', '\tjr ProbeDone', engine].join("\n"));
        run(join(rgbds, "rgbasm"), ["-o", object, asm]); run(join(rgbds, "rgblink"), ["-n", sym, "-o", rom, object]); run(join(rgbds, "rgbfix"), ["-v", "-p", "0", "-m", "1", rom]);
        const stop = (await readFile(sym, "utf8")).match(/^00:([0-9a-f]+) ProbeDone$/mi)![1]; run(cpu, [rom, stop, ...expected]); passed++;
      }
      for (const [i, project] of projects.entries()) {
        const root = resolve(project), game = i === 0 ? "pokered" : "pokeyellow";
        const files = await Promise.all([...new Set(SCRIPT_CONTRACT_SOURCE_PARTS.map(p => p.path))].map(async path => ({ path, contents: await readFile(join(root, path), "utf8") })));
        const reviewed = await reviewScriptEngineContracts(files, game);
        assert.ok(reviewed.every(c => c.sourceStatus === "reviewed-source"));
        // Changing a reviewed body must fail the source gate rather than silently
        // inheriting a vanilla engine contract for a custom project.
        const changed = files.map(f => f.path === "home/yes_no.asm" ? { ...f, contents: f.contents.replace("call SaveScreenTilesToBuffer1", "nop") } : f);
        assert.equal((await reviewScriptEngineContracts(changed, game))[0].sourceStatus, "source-drift");
        const part = (id: string) => {
          const p = SCRIPT_CONTRACT_SOURCE_PARTS.find(p => p.id === id)!;
          return contractSourcePart(files.find(f => f.path === p.path)!.contents, p)!.contents;
        };
        const menu = part("choice-result");
        const tail = menu.slice(menu.lastIndexOf("call HandleMenuInput"));
        const choiceEngine = [
          'DEF TWO_OPTION_MENU EQU 1', 'DEF HEAL_CANCEL_MENU EQU 2', 'DEF WIDE_YES_NO_MENU EQU 3', 'DEF B_PAD_B EQU 1', 'DEF CHOSE_FIRST_ITEM EQU 1', 'DEF CHOSE_SECOND_ITEM EQU 2', 'DEF SCREEN_AREA EQU 4',
          ...["wCurrentMenuItem", "wChosenMenuItem", "wMenuExitMethod", "wTwoOptionMenuID", "wTextBoxID"].map((name,j) => `DEF ${name} EQU $${(0xc000+j).toString(16)}`),
          'DEF hAutoBGTransferEnabled EQU $ff80', 'DEF wTileMapBackup EQU $c400',
          'MACRO hlcoord', 'ld hl, $c600', 'ENDM', 'MACRO decoord', 'ld de, $c600', 'ENDM', 'MACRO lb', 'ld \\1, (\\2 << 8) | \\3', 'ENDM',
          part("choice-entry"), part("choice-restore"), part("choice-copy").split(/\n(?=[A-Za-z_][A-Za-z0-9_]*:{1,2}\n)/)[0],
          'SaveScreenTilesToBuffer1:', 'ret', 'DisplayTextBoxID:', 'push hl', 'jp ChoiceTail', 'ChoiceTail:', tail,
          'HandleMenuInput:', 'ld a, [$c010]', 'ret', 'DelayFrames:', 'ret', 'TwoOptionMenu_RestoreScreenTiles:', 'ret',
        ].join("\n");
        for (const [selected, buttons, expected] of [[0,1,0], [1,1,1], [0,2,1], [1,2,1]]) {
          await probe(`ld a, ${selected}\nld [wCurrentMenuItem], a\nld a, ${buttons}\nld [$c010], a\nld a, $42\nld [$c400], a\ncall YesNoChoice\nld a, 0\nadc a, 0\nld [$c011], a`, choiceEngine, [`c000=${expected}`, `c001=${expected}`, "c011=0", "c600=42"]);
        }
        const soundEngine = [
          'DEF wLowHealthAlarm EQU $c000', 'DEF wChannelSoundIDs EQU $c020', 'DEF CHAN5 EQU 4',
          part("audio-delay"), 'PlaySound:', 'ld [$c010], a', 'ld a, $99', 'ld [$c024], a', 'ret',
        ].join("\n");
        for (const alarm of [0,128]) await probe(`ld a, ${alarm}\nld [wLowHealthAlarm], a\nld [$c024], a\nld a, $77\nld [$c026], a\nld a, $45\ncall PlaySoundWaitForCurrent`, soundEngine, ["c010=45", "c024=99", "c026=77"]);
        for (const alarm of [0,128]) await probe(`ld a, ${alarm}\nld [wLowHealthAlarm], a\nld [$c024], a\nld a, $77\nld [$c026], a\nld hl, $1234\ncall WaitForSoundToFinish\nld a, h\nld [$c010], a\nld a, l\nld [$c011], a`, soundEngine, ["c010=12", "c011=34", `c024=${alarm.toString(16)}`, "c026=77"]);
        // The real wait loop must observe completion driven by interrupts;
        // a timer ISR models the audio driver's clearing of effect channel IDs.
        const interruptWait = soundEngine + '\nSECTION "Timer IRQ", ROM0[$50]\npush af\nxor a\nld [$c024], a\nld [$c025], a\nld [$c027], a\nld [$ff07], a\npop af\nreti';
        await probe('ld a, $55\nld [$c024], a\nld [$c025], a\nld [$c027], a\nld a, 4\nld [$ffff], a\nld a, $ff\nld [$ff05], a\nld a, 5\nld [$ff07], a\nei\nnop\ncall WaitForSoundToFinish\ndi', interruptWait, ["c024=0", "c025=0", "c027=0"]);
        const audio = part("audio-play");
        const playSound = audio.slice(audio.indexOf("PlaySound::")).split(/\n(?=[A-Za-z_][A-Za-z0-9_]*:{1,2}\n)/)[0];
        const audioEngine = [
          ...["wNewSoundID", "wAudioFadeOutControl", "wLastMusicSoundID", "wAudioFadeOutCounterReloadValue", "wAudioFadeOutCounter", "wAudioROMBank"].map((name,j)=>`DEF ${name} EQU $${(0xc000+j).toString(16)}`),
          'DEF wChannelSoundIDs EQU $c020', 'DEF CHAN5 EQU 4', 'DEF CHAN6 EQU 5', 'DEF CHAN7 EQU 6', 'DEF CHAN8 EQU 7',
          'DEF hLoadedROMBank EQU $ff82', 'DEF hSavedROMBank EQU $ff83', 'DEF rROMB EQU $2000',
          playSound,
          ...(game === "pokeyellow" ? ['DetermineAudioFunction:', 'ld a, b', 'ld [$c010], a', 'ret'] : [1,2,3].flatMap(bank => [`SECTION "Audio${bank}", ROMX[$4000], BANK[${bank}]`, `Audio${bank}_PlaySound:`, 'ld [$c010], a', 'ret'])),
        ].join("\n");
        for (const bank of game === "pokered" ? [1,2,3] : [1]) await probe(`ld a, ${bank}\nld [wAudioROMBank], a\nld a, 1\nldh [hLoadedROMBank], a\nld bc, $2233\nld de, $4455\nld hl, $6677\nld a, $45\ncall PlaySound\nld a, b\nld [$c011], a\nld a, c\nld [$c012], a\nld a, d\nld [$c013], a\nld a, e\nld [$c014], a\nld a, h\nld [$c015], a\nld a, l\nld [$c016], a`, audioEngine, ["c010=45", "c011=22", "c012=33", "c013=44", "c014=55", "c015=66", "c016=77", "ff82=1"]);
        await probe('ld a, 1\nld [wNewSoundID], a\nld [$c024], a\nld a, 10\nld [wAudioFadeOutControl], a\nld a, 2\nld [wLastMusicSoundID], a\nld a, $45\ncall PlaySound', audioEngine, ["c010=0", "c001=45", "c002=45", "c003=a", "c004=a", "c024=0"]);
        await probe('ld a, 10\nld [wAudioFadeOutControl], a\nld a, $45\ncall PlaySound', audioEngine, ["c010=0", "c001=a", "c002=0"]);
        // Actual NPC startup and terminator cleanup, with the sprite-rendering
        // routines replaced by explicit boundary stubs. No full path/collision claim.
        const npcStart = part("npc-start");
        const npcFinish = part("npc-completion").slice(part("npc-completion").lastIndexOf("cp STAY"));
        const npcEngine = ['DEF STAY EQU $ff', 'DEF BIT_SCRIPTED_NPC_MOVEMENT EQU 0',
          ...["wNPCMovementDirections", "wNPCNumScriptedSteps", "wStatusFlags5", "wOverrideSimulatedJoypadStatesMask", "wSimulatedJoypadStatesEnd", "wJoyIgnore", "wUnusedOverrideSimulatedJoypadStatesIndex", "wSimulatedJoypadStatesIndex"].map((name,j)=>`DEF ${name} EQU $${(0xc040+j*16).toString(16)}`),
          npcStart, 'SetSpriteMovementBytesToFF:', 'ret', 'GetSpriteMovementByte1Pointer:', 'ld hl, $c030', 'ret', 'NpcFinish:', npcFinish, '.next:', 'ret', 'Path:', 'db $80, $40, $ff'].join("\n");
        await probe('ld de, Path\ncall MoveSprite', npcEngine, ["c040=80", "c041=40", "c042=ff", "c050=3", "c060=1", "c090=ff", "c030=0"]);
        await probe('ld de, Path\ncall MoveSprite\nld hl, $c030\nld a, $ff\ncall NpcFinish', npcEngine, ["c030=ff", "c060=0", "c090=ff", "c0b0=0"]);
        // Parse and execute the wait idioms. Active work yields immediately;
        // completed work reaches the continuation instead of deadlocking updates.
        for (const [variable, check] of [["wStatusFlags5", "bit BIT_SCRIPTED_NPC_MOVEMENT, a"], ["wSimulatedJoypadStatesIndex", "and a"]]) for (const active of [0,1]) {
          const engine = `DEF ${variable} EQU $c000\nDEF BIT_SCRIPTED_NPC_MOVEMENT EQU 0\nTarget:\nld a, [${variable}]\n${check}\nret nz\nld a, 1\nld [$c001], a\nret`;
          await probe(`ld a, ${active}\nld [$c000], a\ncall Target`, engine, [`c001=${active ? 0 : 1}`]);
        }
        const playerEngine = ['DEF BIT_SCRIPTED_MOVEMENT_STATE EQU 1', 'DEF BIT_SPINNING EQU 0', 'DEF BIT_LEDGE_OR_FISHING EQU 1', 'DEF hJoyHeld EQU $ff81',
          ...["wOverrideSimulatedJoypadStatesMask", "wSpritePlayerStateData2MovementByte1", "wStatusFlags5", "wUnusedOverrideSimulatedJoypadStatesIndex", "wSimulatedJoypadStatesIndex", "wSimulatedJoypadStatesEnd", "wJoyIgnore", "wMovementFlags"].map((name,j)=>`DEF ${name} EQU $${(0xc040+j).toString(16)}`),
          part("player-start"), 'PlayerFinish:', part("player-completion").replace(/^\.doneSimulating\n/, "")].join("\n");
        await probe('call StartSimulatingJoypadStates', playerEngine, ["c042=2", "c040=0", "c041=0"]);
        await probe('call StartSimulatingJoypadStates\nld a, $ff\nld [wJoyIgnore], a\nld [wSimulatedJoypadStatesIndex], a\ncall PlayerFinish', playerEngine, ["c042=0", "c044=0", "c045=0", "c046=0", "ff81=0"]);
        console.log(`${game}: reviewed source fingerprints and boundary probes passed`);
      }
      console.log(`${passed} assembled contract CPU probes passed; menu rendering/input, playback driver and sprite rendering are stubbed boundaries.`);
    } finally { await rm(temporary, { recursive: true, force: true }); }
  });
}
