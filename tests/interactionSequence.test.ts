import assert from "node:assert/strict";
import { test } from "node:test";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { identifySequenceDialogue, sequenceDialogue, sequenceDialoguePrompts, validateInteractionSequence, type InteractionAction } from "../src/core/interactionSequence";
import { nativeDialoguePromptProbes } from "./nativeDialoguePromptProbes";
import { loadScriptInteractionDocument, prepareScriptInteractionWrites } from "../src/core/scriptInteractions";
import { loadMapNpcCreateDocument, prepareMapNpcWrites } from "../src/core/npcCreation";
import { parseTextDocument, applyTextDocumentEdits } from "../src/core/textEditing";
import type { ProjectSource } from "../src/core/types";

const domains = { items: ["POTION"], pokemon: ["DRATINI"], events: ["EVENT_GOT_POKEDEX"], sounds: ["SFX_GET_ITEM_1"], pokemonReason: null, choiceReason: null, soundReason: null };
const item: InteractionAction = { kind: "item", item: "POTION", quantity: 1 };
test("dialogue prompts follow branch continuations and leave questions to the menu", () => {
  const actions = identifySequenceDialogue([
    { kind: "dialogue", lines: ["First."] }, { kind: "dialogue", lines: ["Question?"] },
    { kind: "choice", yes: [{ kind: "dialogue", lines: ["Yes."] }], no: [{ kind: "dialogue", lines: ["No."] }, { kind: "end", complete: false }] },
    { kind: "dialogue", lines: ["Final."] },
  ]);
  assert.deepEqual([...sequenceDialoguePrompts(actions).values()], [true, false, true, true, true]);
  const rejoin = identifySequenceDialogue([{ kind: "if-event", event: "EVENT_GOT_POKEDEX", set: true, then: [{ kind: "dialogue", lines: ["Then?"] }], otherwise: [{ kind: "dialogue", lines: ["Otherwise?"] }] }, { kind: "choice", yes: [], no: [] }]);
  assert.deepEqual([...sequenceDialoguePrompts(rejoin).values()], [false, false]);
});
test("sequences track reward retries across branches, joins and early ends", () => {
  const sceneDomains = { ...domains, scene: { reason: null, actors: [{ constant: "NPC" }] } };
  for (const once of [true, false]) {
    assert.doesNotThrow(() => validateInteractionSequence([
      { kind: "choice", yes: [item], no: [] }, { kind: "walk-npc", npc: "NPC", steps: ["UP"] },
    ], sceneDomains, once));
    assert.doesNotThrow(() => validateInteractionSequence([
      { kind: "pokemon", species: "DRATINI", level: 5 }, { kind: "follow-npc", npc: "NPC", steps: ["UP"] },
    ], sceneDomains, once));
  }
  assert.doesNotThrow(() => validateInteractionSequence([{ kind: "choice", yes: [item], no: [{ kind: "end", complete: false }] }], domains, true));
  assert.throws(() => validateInteractionSequence([item, item], domains, true), /one reward per execution path/);
  assert.throws(() => validateInteractionSequence([{ kind: "choice", yes: [item], no: [] }, item], domains, true), /one reward/);
  assert.doesNotThrow(() => validateInteractionSequence([{ kind: "choice", yes: [item], no: [item] }], domains, true));
  assert.throws(() => validateInteractionSequence([item, { kind: "end", complete: false }], domains, true), /must complete/);
  assert.throws(() => validateInteractionSequence([{ kind: "end", complete: true }, item], domains, true), /cannot run/);
  assert.throws(() => validateInteractionSequence([{ kind: "choice", yes: [], no: [] }], { ...domains, choiceReason: "menu drift" }, true), /menu drift/);
  assert.throws(() => validateInteractionSequence([{ kind: "sound", sound: "SFX_STOP_ALL_MUSIC", wait: false }], domains, false), /supported project sound/);
  assert.throws(() => validateInteractionSequence([{ kind: "wait", frames: 0 }], domains, false), /1–255/);
  assert.throws(() => validateInteractionSequence(Array.from({ length: 65 }, () => ({ kind: "heal" })), domains, false), /64 actions/);
  assert.throws(() => validateInteractionSequence([{ kind: "if-event", event: "EVENT_BAD", set: true, then: [], otherwise: [] }], domains, false), /existing event/);
  let deep: InteractionAction[] = [];
  for (let i = 0; i < 5; i++) deep = [{ kind: "choice", yes: deep, no: [] }];
  assert.throws(() => validateInteractionSequence(deep, domains, false), /four nested/);
});

const args = process.argv.slice(2), romAt = args.indexOf("--rom");
const rgbds = romAt >= 0 ? resolve(args[romAt + 1]) : null, binjgb = romAt >= 0 ? resolve(args[romAt + 2]) : null;
if (romAt >= 0) args.splice(romAt, 3);
for (const directory of args) test(`${directory}: reusable interaction generation and editing`, async () => {
  const root = resolve(directory), overlay = new Map<string, string>(), path = "scripts/ViridianCity.asm", label = "ViridianCitySignText";
  async function listFiles(folder = ""): Promise<string[]> {
    return (await Promise.all((await readdir(join(root, folder), { withFileTypes: true })).filter(e => !e.name.startsWith(".")).map(e => e.isDirectory() ? listFiles(join(folder, e.name)) : [join(folder, e.name)]))).flat();
  }
  const source: ProjectSource = { listFiles, readText: async p => overlay.get(p) ?? readFile(join(root, p), "utf8"), readBytes: async p => new Uint8Array(await readFile(join(root, p))), exists: async p => { try { await readFile(join(root, p)); return true; } catch { return false; } } };
  const document = await loadScriptInteractionDocument(source, path, label);
  assert.equal(document.canCreate, true); assert.equal(document.choiceReason, null); assert.equal(document.soundReason, null); assert.equal(document.pokemonReason, null);
  assert.ok(document.sounds.includes("SFX_GET_ITEM_1"));
  const actions = identifySequenceDialogue([
    { kind: "dialogue", lines: ["Want some help?"] },
    { kind: "choice", yes: [
      { kind: "if-event", event: "EVENT_GOT_POKEDEX", set: true,
        then: [{ kind: "pokemon", species: "DRATINI", level: 5 }], otherwise: [item] },
      { kind: "heal" }, { kind: "wait", frames: 7 }, { kind: "sound", sound: "SFX_GET_ITEM_1", wait: true },
      { kind: "dialogue", lines: ["Good luck!"] },
    ], no: [{ kind: "dialogue", lines: ["Another time!"] }, { kind: "end", complete: false }] },
    { kind: "event", event: "EVENT_GOT_TOWN_MAP", set: true },
  ]);
  const values = { ...document.values, showOriginal: false, bagFull: ["Make room first!"], actions, events: [{ event: "EVENT_GOT_POKEBALLS_FROM_OAK", set: true }] };
  const writes = await prepareScriptInteractionWrites(source, document, values);
  assert.equal(writes.length, 2); writes.forEach(w => overlay.set(w.path, w.contents));
  const original = await readFile(join(root, path), "utf8"), generated = overlay.get(path)!;
  assert.ok(generated.includes("\tcall YesNoChoice\n\tld a, [wCurrentMenuItem]\n\tand a"));
  assert.ok(generated.includes("\tjp nc,")); assert.ok(generated.includes("\tpredef HealParty"));
  const originalRangeStart = original.indexOf(`${label}:`), neighbor = original.slice(originalRangeStart).match(/\n([A-Za-z_]\w*):/);
  assert.ok(generated.startsWith(original.slice(0, originalRangeStart)));
  if (neighbor) assert.ok(generated.includes(original.slice(originalRangeStart + neighbor.index!)));
  const reopened = await loadScriptInteractionDocument(source, path, label);
  assert.deepEqual(reopened.values, values);
  const promptPlan = sequenceDialoguePrompts(actions);
  for (const block of sequenceDialogue(actions)) assert.equal((await parseTextDocument(path, `${label}EditorInteraction${block.key}Text`, generated)).terminator, promptPlan.get(block.key) ? "prompt" : "done");
  assert.equal((await parseTextDocument(path, `${label}EditorInteractionBagFullText`, generated)).terminator, "prompt");
  // Regenerate a beta v1 sequence through its exact old-code guard. Existing
  // leaf controls survive; only the native acknowledgement protocol upgrades.
  const codeEnd = generated.indexOf(`; yellow-editor-interaction-code-end ${label}`) + `; yellow-editor-interaction-code-end ${label}`.length;
  const metadata = JSON.parse(generated.match(/yellow-editor-interaction: (.*)/)![1]);
  metadata.version = 1; delete metadata.originalHasPrompt;
  let legacy = generated.slice(0, originalRangeStart) + generated.slice(originalRangeStart, codeEnd)
    .replace(/yellow-editor-interaction: .*/, `yellow-editor-interaction: ${JSON.stringify(metadata)}`)
    .replaceAll("\tld a, 1\n\tld [wDoNotWaitForButtonPressAfterDisplayingText], a\n", "") + generated.slice(codeEnd);
  for (const suffix of [...sequenceDialogue(actions).map(block => `${block.key}Text`), "BagFullText"]) {
    legacy = legacy.replace(new RegExp(`(${label}EditorInteraction${suffix}:\\n[\\s\\S]*?\\n\\t)prompt(?=\\n)`), "$1done");
  }
  overlay.set(path, legacy);
  const legacyDocument = await loadScriptInteractionDocument(source, path, label);
  const migrated = await prepareScriptInteractionWrites(source, legacyDocument, legacyDocument.values);
  assert.equal(migrated.length, 1);
  assert.equal(JSON.parse(migrated[0].contents.match(/yellow-editor-interaction: (.*)/)![1]).version, 2);
  for (const block of sequenceDialogue(actions)) assert.equal((await parseTextDocument(path, `${label}EditorInteraction${block.key}Text`, migrated[0].contents)).terminator, promptPlan.get(block.key) ? "prompt" : "done");
  overlay.set(path, generated);
  // Independent Edit text changes survive reopening and regeneration, including
  // text flow controls. The stored action metadata is not the text authority.
  const dialogueLabel = `${label}EditorInteraction${sequenceDialogue(actions)[0].key}Text`;
  const leaf = await parseTextDocument(path, dialogueLabel, generated);
  overlay.set(path, applyTextDocumentEdits(generated, dialogueLabel, [{ ...leaf.segments[0], text: "Need a partner?" }, { control: "para", text: "Let's begin!" }]));
  const textEdited = await loadScriptInteractionDocument(source, path, label);
  assert.equal(sequenceDialogue(textEdited.values.actions!)[0].lines[0], "Need a partner?");
  const editedValues = structuredClone(textEdited.values);
  editedValues.actions!.unshift({ kind: "wait", frames: 2 });
  const edited = await prepareScriptInteractionWrites(source, textEdited, editedValues);
  assert.equal(edited.length, 1); overlay.set(path, edited[0].contents);
  assert.deepEqual((await loadScriptInteractionDocument(source, path, label)).values, editedValues);
  assert.equal((await parseTextDocument(path, dialogueLabel, edited[0].contents)).segments[1].control, "para", "Reordering actions preserves the dialogue's edited flow controls");
  await assert.rejects(() => prepareScriptInteractionWrites(source, reopened, values), /sources changed/);
  const managedStart = generated.indexOf(`${label}:`);
  overlay.set(path, generated.slice(0, managedStart) + generated.slice(managedStart).replace("\tcall YesNoChoice", "\tcall DelayFrame"));
  const changed = await loadScriptInteractionDocument(source, path, label);
  await assert.rejects(() => prepareScriptInteractionWrites(source, changed, values), /generated logic was changed/);
  overlay.set(path, generated);
  const menu = await source.readText("home/yes_no.asm"); overlay.set("home/yes_no.asm", menu.replace("YesNoChoice::", "YesNoChoice::\n\tnop"));
  const drift = await loadScriptInteractionDocument(source, path, label);
  assert.ok(drift.choiceReason); await assert.rejects(() => prepareScriptInteractionWrites(source, drift, values), /reviewed menu/);
  overlay.delete("home/yes_no.asm");
  const textEngine = await source.readText("home/text.asm");
  overlay.set("home/text.asm", textEngine.replace("PromptText::", "PromptText::\n\tnop"));
  const promptDrift = await loadScriptInteractionDocument(source, path, label);
  await assert.rejects(() => prepareScriptInteractionWrites(source, promptDrift, values), /reviewed button-prompt/);
  overlay.delete("home/text.asm");
  const joypad = await source.readText("home/joypad2.asm");
  overlay.set("home/joypad2.asm", joypad.replace("WaitForTextScrollButtonPress::", "WaitForTextScrollButtonPress::\n\tnop"));
  const inputDrift = await loadScriptInteractionDocument(source, path, label);
  await assert.rejects(() => prepareScriptInteractionWrites(source, inputDrift, values), /reviewed button-prompt/);
  overlay.delete("home/joypad2.asm");
  // Prove this uses ordinary new NPCs on another map, not the Viridian recipe.
  const npc = await loadMapNpcCreateDocument(source, "ROUTE_1");
  const npcWrites = await prepareMapNpcWrites(source, npc, { x: 6, y: 24, sprite: npc.sprites.includes("SPRITE_YOUNGSTER") ? "SPRITE_YOUNGSTER" : npc.sprites[0], movement: "STAY", direction: "DOWN", dialogue: { kind: "new", lines: ["Hello there!"] } });
  npcWrites.forEach(w => overlay.set(w.path, w.contents));
  const newNpcLabel = npcWrites.find(w => w.path === "scripts/Route1.asm")!.contents.match(/^(Route1EditorNpc\d+Text):/m)![1];
  const npcInteraction = await loadScriptInteractionDocument(source, "scripts/Route1.asm", newNpcLabel);
  assert.equal(npcInteraction.canCreate, true);
  const npcActions = identifySequenceDialogue([{ kind: "dialogue", lines: ["Need a rest?"] }, { kind: "choice", yes: [{ kind: "heal" }], no: [{ kind: "end", complete: false }] }]);
  const npcInteractionWrites = await prepareScriptInteractionWrites(source, npcInteraction, { ...npcInteraction.values, showOriginal: false, actions: npcActions });
  npcInteractionWrites.forEach(w => overlay.set(w.path, w.contents));
  assert.deepEqual((await loadScriptInteractionDocument(source, "scripts/Route1.asm", newNpcLabel)).values.actions, npcActions);
  if (rgbds && binjgb) await romChecks(root, overlay, actions, rgbds, binjgb);
  console.log(`${directory}: branching interactions, text/source guards, reward retries and one-file edits passed`);
});

async function romChecks(root: string, overlay: Map<string, string>, actions: InteractionAction[], rgbds: string, binjgb: string) {
  const temporary = await mkdtemp(resolve("node_modules/.interaction-sequence-"));
  const run = (cmd: string, args: string[], cwd = temporary) => {
    const result = spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    assert.equal(result.status, 0, `${cmd}: ${result.stderr.slice(-9000)}\n${result.stdout.slice(-500)}`); return result.stdout;
  };
  try {
    const game = join(temporary, "game"); await cp(root, game, { recursive: true, filter: p => !p.split("/").includes(".git") });
    for (const [p, text] of overlay) await writeFile(join(game, p), text);
    run("make", ["clean"], game); run("make", ["-j2", `RGBDS=${rgbds}/`, root.includes("pokeyellow") ? "pokeyellow.gbc" : "pokered.gbc"], game);
    assert.equal(run("git", ["rev-parse", "HEAD"], binjgb).trim(), "8abd0d38d5bf109d7c280b27d815a8b53168adde");
    const cpu = join(temporary, "cpu");
    run("cc", ["-std=gnu11", "-O2", `-I${join(binjgb, "src")}`, resolve("tests/scriptRuntimeProbe.c"), ...["memory.c", "common.c", "emulator-debug.c"].map(f => join(binjgb, "src", f)), "-lm", "-o", cpu]);
    await nativeDialoguePromptProbes(root, temporary, rgbds, cpu, run);
    const label = "ViridianCitySignText", prefix = `${label}EditorInteraction`, script = overlay.get("scripts/ViridianCity.asm")!;
    const code = script.slice(script.indexOf(`${label}:`), script.indexOf(`; yellow-editor-interaction-code-end ${label}`)).replace("\ttext_asm", "\tdb 8").replace("\tpredef HealParty", "\tcall HealParty");
    const model = JSON.parse(code.match(/yellow-editor-interaction: (.*)/)![1]);
    const events = overlay.get("constants/event_constants.asm")!;
    const flagValue = Number.parseInt(events.match(new RegExp(`DEF ${model.flag} EQU \\$([a-f0-9]+)`))![1], 16);
    const flagAddress = 0xc100 + Math.floor(flagValue / 8), flagMask = 1 << flagValue % 8;
    const stubs = [
      "YesNoChoice:", "ld a, [$c002]", "ld [wCurrentMenuItem], a", "and a", "ret",
      "GiveItem:", "ld hl, $c003", "inc [hl]", "jr Delivery",
      "GivePokemon:", "ld hl, $c004", "inc [hl]", "Delivery:", "ld a, [$c001]", "and a", "ret z", "scf", "ret",
      "HealParty:", "ld hl, $c005", "inc [hl]", "ret",
      "DelayFrames:", "ld a, c", "ld [$c006], a", "ret",
      "PrintText:", "ld hl, $c007", "inc [hl]", "ret",
      "EnableAutoTextBoxDrawing:", "WaitForTextScrollButtonPress:", "PlaySound:", "WaitForSoundToFinish:", "TextScriptEnd:", "ret",
      ...["Original", "Dialogue", "BagFullText", "AlreadyText", ...sequenceDialogue(actions).map(b => `${b.key}Text`)].flatMap(key => [`${prefix}${key}:`, "db 0"]),
    ];
    let probes = 0;
    for (const choice of [0, 1, 1]) for (const dex of [false, true]) for (const capacity of [0, 1]) for (const repeat of [false, true]) {
      const success = choice === 0 && capacity === 1;
      const asm = [
        'INCLUDE "macros/const.asm"', 'INCLUDE "macros/code.asm"',
        "DEF wEventFlags EQU $c100", "DEF wCurrentMenuItem EQU $c000", "DEF wAddedToParty EQU $c008", "DEF wDoNotWaitForButtonPressAfterDisplayingText EQU $c00b", "DEF POTION EQU 20", "DEF DRATINI EQU 88", "DEF SFX_GET_ITEM_1 EQU 1", events,
        await readFile(join(root, "macros/scripts/events.asm"), "utf8"),
        'SECTION "Header", ROM0[$100]', "jp Entry", "ds $150 - @, 0", 'SECTION "Code", ROM0[$150]', "Entry:",
        "di", "ld sp, $dfff", "ld hl, $c000", "ld bc, $400", ".clear:", "xor a", "ld [hli], a", "dec bc", "ld a, b", "or c", "jr nz, .clear",
        `ld a, ${capacity}`, "ld [$c001], a", `ld a, ${choice}`, "ld [$c002], a", ...(dex ? ["SetEvent EVENT_GOT_POKEDEX"] : []),
        `call ${label} + 1`, ...(repeat ? [`call ${label} + 1`] : []),
        "CheckEvent EVENT_GOT_TOWN_MAP", "ld a, 0", "jr z, .noMap", "inc a", ".noMap:", "ld [$c009], a",
        "CheckEvent EVENT_GOT_POKEBALLS_FROM_OAK", "ld a, 0", "jr z, .noBalls", "inc a", ".noBalls:", "ld [$c00a], a",
        "ProbeDone:", "halt", "jr ProbeDone", code, ...stubs,
      ].join("\n");
      const file = join(temporary, "probe.asm"), obj = join(temporary, "probe.o"), rom = join(temporary, "probe.gb"), sym = join(temporary, "probe.sym");
      await writeFile(file, asm); run(join(rgbds, "rgbasm"), ["-I", `${root}/`, "-o", obj, file]); run(join(rgbds, "rgblink"), ["-n", sym, "-o", rom, obj]); run(join(rgbds, "rgbfix"), ["-v", "-p", "0", rom]);
      const stop = (await readFile(sym, "utf8")).match(/^00:([0-9a-f]+) ProbeDone$/mi)![1];
      const attempts = choice === 0 ? success ? 1 : repeat ? 2 : 1 : 0;
      run(cpu, [rom, stop, `c003=${dex ? 0 : attempts}`, `c004=${dex ? attempts : 0}`, `c005=${success ? 1 : 0}`, `c006=${success ? 7 : 0}`, `c009=${success ? 1 : 0}`, `c00a=${success ? 1 : 0}`, `${flagAddress.toString(16)}=${success ? flagMask.toString(16) : "0"}`]); probes++;
    }
    console.log(`${root}: full ROM assembled and ${probes} assembled CPU probes passed (menus, text, inventory and healing are instrumented boundaries)`);
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
