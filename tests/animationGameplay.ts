import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { PNG } from "pngjs";
import { configureGen1PngDecoder } from "../src/core/gen1Graphics";
import { createProjectSession } from "../src/core/project";
import { parseTrainerBaseCatalog } from "../src/core/trainerBaseIndex";
import { loadScriptInteractionDocument, prepareScriptInteractionWrites } from "../src/core/scriptInteractions";
import { identifySequenceDialogue } from "../src/core/interactionSequence";
import { parseMapIndex } from "../src/core/mapVisualization";
import type { HistoryState, ProjectSource } from "../src/core/types";

const [rootArg, rgbdsArg, binjgbArg] = process.argv.slice(2);
assert.ok(rootArg && rgbdsArg && binjgbArg, "Supply source, RGBDS and binjgb.");
const root = resolve(rootArg), rgbds = resolve(rgbdsArg), binjgb = resolve(binjgbArg), temp = await mkdtemp(resolve("node_modules/.animation-gameplay-"));
const run = (command: string, args: string[]) => {
  const result = spawnSync(command, args, { cwd: temp, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  assert.equal(result.status, 0, `${command}: ${result.error ?? ""}\n${result.stderr?.slice(-10000)}\n${result.stdout?.slice(-2000)}`);
  assert.ok(!/warning:.*(?:truncat|out of range)/i.test(result.stderr), result.stderr); return result.stdout;
};
configureGen1PngDecoder("pngjs native fixture", async bytes => { const image = PNG.sync.read(Buffer.from(bytes)); return { width: image.width, height: image.height, rgba: new Uint8ClampedArray(image.data) }; });
try {
  await cp(root, temp, { recursive: true, filter: path => !path.split("/").includes(".git") });
  async function listFiles(folder = ""): Promise<string[]> { return (await Promise.all((await readdir(join(temp, folder), { withFileTypes: true })).filter(entry => !entry.name.startsWith(".")).map(entry => entry.isDirectory() ? listFiles(join(folder, entry.name)) : [join(folder, entry.name)]))).flat(); }
  let history: HistoryState | null = null;
  const source: ProjectSource = {
    displayPath: temp, storageKey: temp, listFiles,
    readText: path => readFile(join(temp, path), "utf8"), readBytes: async path => new Uint8Array(await readFile(join(temp, path))),
    exists: async path => { try { await stat(join(temp, path)); return true; } catch { return false; } },
    writeText: async (path, text) => { await writeFile(join(temp, path), text); }, writeBytes: async (path, bytes) => { await writeFile(join(temp, path), bytes); },
    createFile: async (path, bytes) => { await mkdir(join(temp, path, ".."), { recursive: true }); await writeFile(join(temp, path), bytes, { flag: "wx" }); }, removeFile: async path => { await rm(join(temp, path)); }, assetUrl: async () => null,
    historyStore: { persistent: false, load: async () => history, save: async next => { history = structuredClone(next); } },
  };
  const session = await createProjectSession(source, {} as never), document = await session.getAnimationEditDocument(null);
  const animation = await session.saveAnimation(document, { constant: "EDITOR_TEST_ANIM", steps: [
    { kind: "subanimation", targetId: 1, sound: "POUND", sheetId: 0, delay: 8 },
    { kind: "effect", targetId: document.catalog.effects.find(effect => effect.constant === "SE_DARK_SCREEN_FLASH")!.id, sound: "NO_MOVE", sheetId: 0, delay: 0 },
  ], hook: "AnimationFlashScreen", assignMoveId: 1, confirmShared: false });
  const trainers = await parseTrainerBaseCatalog(source, root.includes("pokeyellow") ? "pokeyellow" : "pokered"), template = trainers.classes.find(entry => entry.constant === "YOUNGSTER")!;
  await session.createTrainerClass(trainers.editSources, { constant: "ANIMATION_TESTER", name: "ANIM TESTER", portraitClassConstant: "YOUNGSTER", independentPortrait: true, aiRoutine: template.aiRoutine!, aiUsesPerPokemon: template.aiUsesPerPokemon ?? 3, moveChoiceModifiers: template.moveChoiceModifiers, baseRewardPerLevel: 1, initialParty: { partyFormat: "shared-level", pokemon: [{ level: 1, speciesConstant: "PIDGEY" }] } }, ["PIDGEY"]);
  const npc = await session.getMapNpcCreateDocument("VIRIDIAN_POKECENTER");
  await session.createMapNpc(npc, { x: 6, y: 5, sprite: "SPRITE_YOUNGSTER", movement: "STAY", direction: "DOWN", dialogue: { kind: "new", lines: ["Animation test."] } });
  const path = "scripts/ViridianPokecenter.asm", label = `ViridianPokecenterEditorNpc${npc.objectId}Text`;
  const interaction = await loadScriptInteractionDocument(source, path, label);
  const writes = await prepareScriptInteractionWrites(source, interaction, { ...interaction.values, showOriginal: false, once: true, scene: { trigger: "coordinate", playerX: 4, playerY: 6, idleState: 0, hiddenNpcs: [] }, actions: identifySequenceDialogue([{ kind: "trainer-battle", trainer: "ANIMATION_TESTER:1", won: [{ kind: "wait", frames: 1 }] }]) });
  for (const write of writes) await source.writeText(write.path, write.contents);
  const patch = async (path: string, edit: (text: string) => string) => source.writeText(path, edit(await source.readText(path)));
  await patch("data/maps/special_warps.asm", text => text.replace("special_warp_spec REDS_HOUSE_2F, 3, 6, REDS_HOUSE_2", "special_warp_spec VIRIDIAN_POKECENTER, 4, 6, POKECENTER"));
  const setup = ["OakSpeech:", "\tcall PrepareOakSpeech", "\tpredef InitPlayerData2", "\tld a, MEWTWO", "\tld [wCurPartySpecies], a", "\tld a, 100", "\tld [wCurEnemyLevel], a", "\tld a, $10", "\tld [wMonDataLocation], a", "\tcall AddPartyMon", "\tld a, POUND", "\tld [wPartyMon1Moves], a", "\txor a", "\tld [wPartyMon1Moves + 1], a", "\tld [wPartyMon1Moves + 2], a", "\tld [wPartyMon1Moves + 3], a", "\tld a, 35", "\tld [wPartyMon1PP], a", "\tld a, $41", "\tld [wOptions], a", "\tld a, VIRIDIAN_CITY", "\tld [wDestinationMap], a", "\tcall PrepareForSpecialWarp", "\tld a, VIRIDIAN_CITY", "\tld [wLastMap], a", "\tcall LoadTextBoxTilePatterns", "\tld a, 1", "\tld [wUpdateSpritesEnabled], a", "\tret", ""].join("\n");
  await patch("engine/movie/oak_speech/oak_speech.asm", text => { const start = text.indexOf("\nOakSpeech:\n") + 1, end = text.indexOf("OakSpeechText1:", start); assert.ok(start > 0 && end > start); return text.slice(0, start) + setup + text.slice(end); });
  const target = root.includes("pokeyellow") ? "pokeyellow" : "pokered";
  if (process.env.ANIMATION_PREPARE_ONLY) { console.log(`${target}: native battle fixture prepared through production animation, portrait, trainer class and interaction writers; assembly not run.`); } else {
  run("make", ["-j2", `RGBDS=${rgbds}/`, `${target}.gbc`]);
  const cpu = join(temp, "animation-gameplay");
  run("cc", ["-std=gnu11", "-O2", `-I${join(binjgb, "src")}`, resolve("tests/animationGameplayProbe.c"), ...["memory.c", "common.c", "emulator-debug.c"].map(file => join(binjgb, "src", file)), "-lm", "-o", cpu]);
  const map = (await parseMapIndex(source)).find(map => map.constant === "VIRIDIAN_POKECENTER")!;
  console.log(run(cpu, [join(temp, `${target}.gbc`), join(temp, `${target}.sym`), String(animation.animationId), String(map.id)]));
  }
} finally { if (process.env.KEEP_ANIMATION_GAMEPLAY) console.error("Animation fixture:", temp); else await rm(temp, { recursive: true, force: true }); }
