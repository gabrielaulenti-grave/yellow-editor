import assert from "node:assert/strict";
import { cp, readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { loadMapNpcCreateDocument, prepareMapNpcWrites } from "../src/core/npcCreation";
import { loadScriptInteractionDocument, prepareScriptInteractionWrites, type ManagedInteraction } from "../src/core/scriptInteractions";
import { identifySequenceDialogue } from "../src/core/interactionSequence";
import { parseMapIndex } from "../src/core/mapVisualization";
import type { ProjectSource } from "../src/core/types";

// Test-only new-game setup gives a reproducible party and map. Native engine,
// graphics, menus, turns, balls, blackout, SRAM checksums and Continue are used.
const [rootArg, rgbdsArg, cpuArg] = process.argv.slice(2);
assert.ok(rootArg && rgbdsArg && cpuArg, "Supply source, native RGBDS and binjgb directories.");
const root = resolve(rootArg), rgbds = resolve(rgbdsArg), cpuRoot = resolve(cpuArg), yellow = root.includes("pokeyellow");
const folder = resolve(`node_modules/.scene-gameplay-${yellow ? "yellow" : "red"}`), game = join(folder, "game");
const run = (command: string, args: string[], cwd = folder) => {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  assert.equal(result.status, 0, `${command}: ${result.stderr.slice(-9000)}\n${result.stdout.slice(-2000)}`); return result.stdout;
};
await mkdir(folder, { recursive: true });
await cp(root, game, { recursive: true, filter: path => !path.split("/").includes(".git") });
const overlay = new Map<string, string>();
async function listFiles(path = ""): Promise<string[]> {
  return (await Promise.all((await readdir(join(game, path), { withFileTypes: true })).filter(entry => !entry.name.startsWith(".")).map(entry => entry.isDirectory() ? listFiles(join(path, entry.name)) : [join(path, entry.name)]))).flat();
}
const source: ProjectSource = { storageKey: "gameplay-test", listFiles, readText: async path => overlay.get(path) ?? readFile(join(game, path), "utf8"), readBytes: async path => new Uint8Array(await readFile(join(game, path))), exists: async path => { try { await readFile(join(game, path)); return true; } catch { return overlay.has(path); } } } as ProjectSource;
const events = await source.readText("constants/event_constants.asm");
overlay.set("constants/event_constants.asm", events + "\n; Full-game regression flags in the native unused tail.\nDEF EVENT_SMOKE_TRAINER EQU $9f0\nDEF EVENT_SMOKE_WON EQU $9f1\nDEF EVENT_SMOKE_CAUGHT EQU $9f2\nDEF EVENT_SMOKE_ESCAPED EQU $9f3\n");
const doc = await loadMapNpcCreateDocument(source, "VIRIDIAN_POKECENTER");
(await prepareMapNpcWrites(source, doc, { x: 6, y: 5, sprite: "SPRITE_SNORLAX", movement: "STAY", direction: "DOWN", dialogue: { kind: "new", lines: ["Snorlax is asleep."] } })).forEach(write => overlay.set(write.path, write.contents));
const path = "scripts/ViridianPokecenter.asm", label = `ViridianPokecenterEditorNpc${doc.objectId}Text`, actor = `VIRIDIAN_POKECENTER_EDITOR_NPC_${doc.objectId}`;
const interaction = await loadScriptInteractionDocument(source, path, label);
const values = { ...interaction.values, showOriginal: false, once: true, scene: { trigger: "coordinate" as const, playerX: 4, playerY: 6, idleState: 0, hiddenNpcs: [] }, actions: identifySequenceDialogue([
  { kind: "wait", frames: 30 }, { kind: "music", mode: "play", track: "MUSIC_MEET_PROF_OAK", persist: false },
  { kind: "if-event", event: "EVENT_SMOKE_TRAINER", set: true,
    then: [{ kind: "trainer-battle", trainer: "YOUNGSTER:1", won: [{ kind: "event", event: "EVENT_SMOKE_WON", set: true }] }],
    otherwise: [{ kind: "wild-battle", species: "SNORLAX", level: 30, cry: true, won: [{ kind: "event", event: "EVENT_SMOKE_WON", set: true }], caught: [{ kind: "event", event: "EVENT_SMOKE_CAUGHT", set: true }], escaped: [{ kind: "event", event: "EVENT_SMOKE_ESCAPED", set: true }, { kind: "end", complete: false }] }] },
  { kind: "fade", mode: "out" }, { kind: "visibility", npc: actor, visible: false }, { kind: "wait", frames: 3 }, { kind: "fade", mode: "in" },
]) };
(await prepareScriptInteractionWrites(source, interaction, values)).forEach(write => overlay.set(write.path, write.contents));
const model = JSON.parse(overlay.get(path)!.match(/yellow-editor-interaction: (.*)/)![1]) as ManagedInteraction;
const flagText = overlay.get("constants/event_constants.asm")!;
const flagValue = (name: string) => parseInt(flagText.match(new RegExp(`DEF ${name} EQU \\$([a-f0-9]+)`))![1], 16);
for (const [path, text] of overlay) await writeFile(join(game, path), text);
// Fixture hooks are installed only after source preparation; they are not part
// of application-generated source and do not replace any battle implementation.
const patch = async (path: string, edit: (text: string) => string) => writeFile(join(game, path), edit(await readFile(join(game, path), "utf8")));
await patch("ram/wram.asm", text => text.replace("\tds 1\n; yellow-editor-scene-scratch-end", "wEditorSmokeSaved:: db\n; yellow-editor-scene-scratch-end"));
await patch("data/maps/special_warps.asm", text => text.replace("special_warp_spec REDS_HOUSE_2F, 3, 6, REDS_HOUSE_2", "special_warp_spec VIRIDIAN_POKECENTER, 4, 6, POKECENTER"));
const setup = ["OakSpeech:", "\tcall PrepareOakSpeech", "\tpredef InitPlayerData2", "\txor a", "\tld [wEditorSmokeSaved], a", "\tld a, [SmokeMode]", "\tld [wUnusedPlayerDataByte], a", "\tcp 5", "\tjr c, .party", "\tSetEvent EVENT_SMOKE_TRAINER", ".party", "\tld b, 1", "\tld a, [SmokeMode]", "\tcp 2", "\tjr nz, .add", "\tld b, 6", ".add", "\tpush bc", "\tld a, [SmokeMode]", "\tcp 4", "\tjr z, .weak", "\tcp 6", "\tjr z, .weak", "\tld a, MEWTWO", "\tld [wCurPartySpecies], a", "\tld a, 100", "\tjr .level", ".weak", "\tld a, MAGIKARP", "\tld [wCurPartySpecies], a", "\tld a, 5", ".level", "\tld [wCurEnemyLevel], a", "\tld a, $10", "\tld [wMonDataLocation], a", "\tcall AddPartyMon", "\tpop bc", "\tdec b", "\tjr nz, .add", "\tld a, [SmokeMode]", "\tcp 4", "\tjr z, .items", "\tcp 6", "\tjr z, .items", "\tld a, SWIFT", "\tld [wPartyMon1Moves], a", "\txor a", "\tld [wPartyMon1Moves + 1], a", "\tld [wPartyMon1Moves + 2], a", "\tld [wPartyMon1Moves + 3], a", "\tld a, 20", "\tld [wPartyMon1PP], a", ".items", "\tld b, MASTER_BALL", "\tld c, 99", "\tcall GiveItem", "\tld a, $c1", "\tld [wOptions], a", "\tld a, VIRIDIAN_CITY", "\tld [wDestinationMap], a", "\tcall PrepareForSpecialWarp", "\tld a, VIRIDIAN_CITY", "\tld [wLastMap], a", "\tcall LoadTextBoxTilePatterns", "\tld a, 1", "\tld [wUpdateSpritesEnabled], a", "\tret", "SmokeMode::", "\tdb 0", "SmokeSpecies::", "\tdb SNORLAX", ""].join("\n");
await patch("engine/movie/oak_speech/oak_speech.asm", text => {
  const start = text.indexOf("\nOakSpeech:\n") + 1, end = text.indexOf("OakSpeechText1:", start); assert.ok(start > 0 && end > start); return text.slice(0, start) + setup + text.slice(end);
});
await patch(path, text => text.replace("ViridianPokecenter_Script:\n", "ViridianPokecenter_Script:\n\tcall SmokeSaveIfReady\n") + ["", "SmokeSaveIfReady:", `\tCheckEvent ${model.flag}`, "\tret z", "\tld a, [wEditorSmokeSaved]", "\tcp $5a", "\tret z", "\tand a", "\tjr nz, .loaded", "\tld a, 1", "\tld [wEditorSmokeSaved], a", "\tfarcall SaveGameData", ".loaded", "\tld a, $5a", "\tld [wEditorSmokeSaved], a", "\tret", ""].join("\n"));
const target = yellow ? "pokeyellow" : "pokered";
run("make", ["-j2", `RGBDS=${rgbds}/`, `${target}.gbc`], game);
const cpu = join(folder, "cpu");
run("cc", ["-std=gnu11", "-O2", `-I${join(cpuRoot, "src")}`, resolve("tests/sceneGameplayProbe.c"), ...["memory.c", "common.c", "emulator-debug.c"].map(file => join(cpuRoot, "src", file)), "-lm", "-o", cpu]);
const map = (await parseMapIndex(source)).find(map => map.constant === "VIRIDIAN_POKECENTER")!;
for (const mode of (process.env.SCENE_SMOKE_MODES ?? "0,1,2,3,4,5,6").split(",").map(Number)) {
  console.log(`${target}: full native gameplay mode ${mode}`);
  console.log(run(cpu, [join(game, `${target}.gbc`), join(game, `${target}.sym`), String(mode), map.id.toString(16), flagValue(model.flag!).toString(16), flagValue(model.scene!.visibility.find(entry => entry.npc === actor)!.flag).toString(16), join(folder, `mode-${mode}.sav`), join(folder, `mode-${mode}.rgba`)]));
}
