import assert from "node:assert/strict";
import { cp, readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { sceneChoiceChecks } from "./sceneChoiceChecks";
import type { ProjectSource } from "../src/core/types";

// Real quest playback: new-game setup and observation/save hooks only. Native
// menus, inventory, dialogue, battle, movement, rendering and SRAM are retained.
const [rootArg, rgbdsArg, cpuArg] = process.argv.slice(2);
assert.ok(rootArg && rgbdsArg && cpuArg);
const root = resolve(rootArg), rgbds = resolve(rgbdsArg), cpuRoot = resolve(cpuArg), yellow = root.includes("pokeyellow");
const folder = resolve(`node_modules/.choice-gameplay-${yellow ? "yellow" : "red"}`), game = join(folder, "game");
const run = (cmd: string, args: string[], cwd = folder) => {
  const result = spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  assert.equal(result.status, 0, `${cmd}: ${result.stderr.slice(-8000)}\n${result.stdout.slice(-1500)}`); return result.stdout;
};
await mkdir(folder, { recursive: true });
await cp(root, game, { recursive: true, filter: path => !path.split("/").includes(".git") });
const overlay = new Map<string, string>();
async function listFiles(path = ""): Promise<string[]> {
  return (await Promise.all((await readdir(join(game, path), { withFileTypes: true })).filter(entry => !entry.name.startsWith(".")).map(entry => entry.isDirectory() ? listFiles(join(path, entry.name)) : [join(path, entry.name)]))).flat();
}
const source: ProjectSource = { listFiles, readText: async path => overlay.get(path) ?? readFile(join(game, path), "utf8"), readBytes: async path => new Uint8Array(await readFile(join(game, path))), exists: async path => { try { await readFile(join(game, path)); return true; } catch { return overlay.has(path); } } };
const models = await sceneChoiceChecks(source, overlay);
for (const [path, text] of overlay) await writeFile(join(game, path), text);
const patch = async (path: string, edit: (text: string) => string) => writeFile(join(game, path), edit(await readFile(join(game, path), "utf8")));
await patch("ram/wram.asm", text => text.replace("\tds 1\n; yellow-editor-scene-scratch-end", "wChoiceProbe:: db\n; yellow-editor-scene-scratch-end"));
await patch("engine/menus/display_text_id_init.asm", text => text.replace("DisplayTextIDInit::\n", "DisplayTextIDInit::\n\tld hl, wChoiceProbe\n\tinc [hl]\n"));
await patch("data/maps/special_warps.asm", text => text.replace("special_warp_spec REDS_HOUSE_2F, 3, 6, REDS_HOUSE_2", "special_warp_spec VIRIDIAN_POKECENTER, 8, 6, POKECENTER"));
const setup = ["OakSpeech:", "\tcall PrepareOakSpeech", "\tpredef InitPlayerData2", "\txor a", "\tld [wChoiceProbe], a", "\tld a, [ChoiceMode]", "\tcp 4", "\tld a, MEWTWO", "\tjr nz, .species", "\tld a, MAGIKARP", ".species", "\tld [wCurPartySpecies], a", "\tld a, [ChoiceMode]", "\tcp 4", "\tld a, 100", "\tjr nz, .level", "\tld a, 5", ".level", "\tld [wCurEnemyLevel], a", "\tld a, $10", "\tld [wMonDataLocation], a", "\tcall AddPartyMon", "\tld a, [ChoiceMode]", "\tcp 4", "\tjr z, .bag", "\tld a, SWIFT", "\tld [wPartyMon1Moves], a", "\txor a", "\tld [wPartyMon1Moves + 1], a", "\tld [wPartyMon1Moves + 2], a", "\tld [wPartyMon1Moves + 3], a", "\tld a, 20", "\tld [wPartyMon1PP], a", ".bag", "\tld a, [ChoiceMode]", "\tcp 3", "\tjr nz, .ready", "\tld hl, ChoiceItems", "\tld de, wBagItems", "\tld bc, 41", "\tcall CopyData", "\tld a, 20", "\tld [wNumBagItems], a", ".ready", "\tld a, $c1", "\tld [wOptions], a", "\tld a, VIRIDIAN_CITY", "\tld [wDestinationMap], a", "\tcall PrepareForSpecialWarp", "\tld a, VIRIDIAN_CITY", "\tld [wLastMap], a", "\tcall LoadTextBoxTilePatterns", "\tld a, 1", "\tld [wUpdateSpritesEnabled], a", "\tret", "ChoiceMode::", "\tdb 0", "ChoiceItems:", ...["POTION", "ANTIDOTE", "BURN_HEAL", "ICE_HEAL", "AWAKENING", "PARLYZ_HEAL", "FULL_RESTORE", "MAX_POTION", "HYPER_POTION", "SUPER_POTION", "FULL_HEAL", "REVIVE", "MAX_REVIVE", "FRESH_WATER", "SODA_POP", "LEMONADE", "X_ATTACK", "X_DEFEND", "X_SPEED", "X_SPECIAL"].map(item => `\tdb ${item}, 1`), "\tdb $ff", ""].join("\n");
await patch("engine/movie/oak_speech/oak_speech.asm", text => {
  const at = text.indexOf("\nOakSpeech:\n") + 1, end = text.indexOf("OakSpeechText1:", at); assert.ok(at > 0 && end > at); return text.slice(0, at) + setup + text.slice(end);
});
const group = models.flags[1].event;
await patch("scripts/ViridianPokecenter.asm", text => text.replace("ViridianPokecenter_Script:\n", "ViridianPokecenter_Script:\n\tfarcall ChoiceSave\n") + ["", "PUSHS", 'SECTION "Choice Test Save", ROMX', "ChoiceSave::", `\tCheckEvent ${group}`, "\tret z", "\tld a, [wEditorSceneActive]", "\tand a", "\tret nz", "\tld a, [wChoiceProbe]", "\tcp $e0", "\tret z", "\tbit 7, a", "\tjr nz, .loaded", "\tld a, $80", "\tld [wChoiceProbe], a", "\tfarcall SaveGameData", ".loaded", "\tld a, $e0", "\tld [wChoiceProbe], a", "\tret", "POPS", ""].join("\n"));
const target = yellow ? "pokeyellow" : "pokered";
run("make", ["-j2", `RGBDS=${rgbds}/`, `${target}.gbc`], game);
const cpu = join(folder, "cpu");
run("cc", ["-std=gnu11", "-O2", `-I${join(cpuRoot, "src")}`, resolve("tests/sceneChoiceGameplayProbe.c"), ...["memory.c", "common.c", "emulator-debug.c"].map(file => join(cpuRoot, "src", file)), "-lm", "-o", cpu]);
const flags = overlay.get("constants/event_constants.asm")!;
const bit = (name: string) => parseInt(flags.match(new RegExp(`DEF ${name} EQU \\$([a-f0-9]+)`))![1], 16).toString(16);
for (const mode of (process.env.CHOICE_SMOKE_MODES ?? "0,1,2,3,4").split(",").map(Number)) {
  console.log(`${target}: full fossil quest mode ${mode}`);
  console.log(run(cpu, [join(game, `${target}.gbc`), join(game, `${target}.sym`), String(mode), ...models.flags.map(flag => bit(flag.event)), ...models.dome.scene!.visibility.map(entry => bit(entry.flag)), String(models.guardian.scene!.actors.find(actor => actor.constant.includes("EDITOR_NPC"))!.id), join(folder, `mode-${mode}.rgba`)]));
}
