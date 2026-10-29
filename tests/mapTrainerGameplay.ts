import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createProjectSession } from "../src/core/project";
import { trainerDelta, trainerPlacementError } from "../src/core/mapTrainers";
import type { MapTrainerModel } from "../src/core/mapTrainerRuntime";
import type { HistoryState, ProjectSource } from "../src/core/types";

const [rootArg, rgbdsArg, binjgbArg] = process.argv.slice(2);
assert.ok(rootArg && rgbdsArg && binjgbArg, "Supply source, RGBDS and binjgb.");
const root = resolve(rootArg), rgbds = resolve(rgbdsArg), binjgb = resolve(binjgbArg), temp = await mkdtemp(resolve("node_modules/.trainer-gameplay-"));
const run = (cmd: string, args: string[]) => { const r = spawnSync(cmd, args, { cwd: temp, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }); assert.equal(r.status, 0, r.stderr.slice(-10000) + r.stdout.slice(-2000)); return r.stdout; };
try {
  await cp(root, temp, { recursive: true, filter: p => !p.split("/").includes(".git") });
  async function listFiles(folder = ""): Promise<string[]> { return (await Promise.all((await readdir(join(temp, folder), { withFileTypes: true })).filter(e => !e.name.startsWith(".")).map(e => e.isDirectory() ? listFiles(join(folder, e.name)) : [join(folder, e.name)]))).flat(); }
  let history: HistoryState | null = null;
  const source: ProjectSource = { storageKey: temp, displayPath: temp, listFiles,
    readBytes: async p => p.endsWith(".2bpp") ? new Uint8Array(4096) : new Uint8Array(await readFile(join(temp, p))),
    readText: async p => readFile(join(temp, p), "utf8"),
    exists: async p => p.endsWith(".png") ? false : p.endsWith(".2bpp") ? true : stat(join(temp, p)).then(() => true, () => false),
    writeText: async (p, s) => { await writeFile(join(temp, p), s); }, writeBytes: async (p, bytes) => { await writeFile(join(temp, p), bytes); },
    createFile: async (p, bytes) => { if (await source.exists(p)) throw new Error("Already exists"); await writeFile(join(temp, p), bytes); }, removeFile: async p => { await rm(join(temp, p)); }, assetUrl: async () => null,
    historyStore: { persistent: false, load: async () => history, save: async h => { history = structuredClone(h); } } };
  const session = await createProjectSession(source, {} as never), map = "TRAINER_GAMEPLAY_CAVE";
  const creation = await session.getMapCreateDocument("ROCK_TUNNEL_B1F");
  await session.createMap(creation, { constant: map, width: creation.visualization.map.width, height: creation.visualization.map.height, layout: "copy", fillBlock: 0, borderBlock: creation.borderBlock, musicMap: "DIGLETTS_CAVE", locationMap: "VERMILION_CITY", connection: null });
  await session.assignMapEncounters(await session.getMapEncounterDocument(map), { mode: "copy", tablePath: "data/wild/maps/DiglettsCave.asm" });
  await session.placeMapItem(await session.getMapItemDocument(map), { x: 0, y: 0, item: "POTION", quantity: 1 });
  let d = await session.getMapTrainerDocument(map), auto = { ...d.values, partyId: "YOUNGSTER:1", sight: 3 };
  let found = false;
  for (const point of d.walkable) { for (const facing of Object.keys(trainerDelta) as Array<keyof typeof trainerDelta>) { const v = { ...auto, ...point, facing }; if (!trainerPlacementError(d, v)) { auto = v; found = true; break; } } if (found) break; }
  assert.ok(found); await session.saveMapTrainer(d, auto);
  d = await session.getMapTrainerDocument(map);
  const manual = d.walkable.find(p => Math.abs(p.x - auto.x) + Math.abs(p.y - auto.y) > 10 && !d.occupied.some(o => o.x === p.x && o.y === p.y) && Object.values(trainerDelta).every(step => d.walkable.some(w => w.x === p.x + step.x && w.y === p.y + step.y) && !d.occupied.some(o => o.x === p.x + step.x && o.y === p.y + step.y)))!;
  assert.ok(manual, "a separate talk-only trainer has walkable ground on all sides");
  await session.saveMapTrainer(d, { ...d.values, ...manual, sight: 0, partyId: "YOUNGSTER:1" });
  const path = "scripts/TrainerGameplayCave.asm", script = await source.readText(path), model = JSON.parse(script.match(/^; yellow-editor-map-trainers: (.+)$/m)![1]) as MapTrainerModel;
  const flags: number[] = [];
  // Read actual definitions rather than infer event IDs from metadata.
  const events = await source.readText("constants/event_constants.asm");
  model.trainers.forEach((t, i) => { flags[i] = parseInt(events.match(new RegExp(`DEF ${t.event} EQU \\$([a-f0-9]+)`, "i"))![1], 16); });
  const patch = async (p: string, f: (s: string) => string) => writeFile(join(temp, p), f(await source.readText(p)));
  await patch("ram/wram.asm", text => text.replace("\tds 3\n; yellow-editor-trainer-scratch-end", "wTrainerSmokeSaved:: db\n\tds 2\n; yellow-editor-trainer-scratch-end"));
  const initial = { x: auto.x + trainerDelta[auto.facing].x * 3, y: auto.y + trainerDelta[auto.facing].y * 3 };
  await patch("data/maps/special_warps.asm", text => text.replace("special_warp_spec REDS_HOUSE_2F, 3, 6, REDS_HOUSE_2", `special_warp_spec ${map}, ${initial.x}, ${initial.y}, CAVERN`));
  const setup = ["OakSpeech:", "\tcall PrepareOakSpeech", "\tpredef InitPlayerData2", "\txor a", "\tld [wTrainerSmokeSaved], a", "\tld a, [TrainerSmokeMode]", "\tld [wUnusedPlayerDataByte], a", "\tcp 2", "\tjr z, .weak", "\tld a, MEWTWO", "\tld b, 100", "\tjr .mon", ".weak", "\tld a, MAGIKARP", "\tld b, 5", ".mon", "\tld [wCurPartySpecies], a", "\tld a, b", "\tld [wCurEnemyLevel], a", "\tld a, $10", "\tld [wMonDataLocation], a", "\tcall AddPartyMon", "\tld a, [TrainerSmokeMode]", "\tcp 2", "\tjr z, .ready", "\tld a, SWIFT", "\tld [wPartyMon1Moves], a", "\txor a", "\tld [wPartyMon1Moves + 1], a", "\tld [wPartyMon1Moves + 2], a", "\tld [wPartyMon1Moves + 3], a", "\tld a, 20", "\tld [wPartyMon1PP], a", ".ready", "\tld a, $c1", "\tld [wOptions], a", "\tld a, VIRIDIAN_CITY", "\tld [wDestinationMap], a", "\tcall PrepareForSpecialWarp", "\tld a, VIRIDIAN_CITY", "\tld [wLastMap], a", "\tld [wLastBlackoutMap], a", "\tcall LoadTextBoxTilePatterns", "\tld a, 1", "\tld [wUpdateSpritesEnabled], a", "\tret", "TrainerSmokeMode::", "\tdb 0", ""].join("\n");
  await patch("engine/movie/oak_speech/oak_speech.asm", text => { const from = text.indexOf("\nOakSpeech:\n") + 1, to = text.indexOf("OakSpeechText1:", from); assert.ok(from && to > from); return text.slice(0, from) + setup + text.slice(to); });
  await patch(path, text => text.replace("TrainerGameplayCave_Script:\n", "TrainerGameplayCave_Script:\n\tcall TrainerSmokeSave\n") + ["", "TrainerSmokeSave:", "\tld a, [wUnusedPlayerDataByte]", "\tcp 2", "\tret z", "\tand a", "\tjr nz, .talk", `\tCheckEvent ${model.trainers[0].event}`, "\tjr .flag", ".talk", `\tCheckEvent ${model.trainers[1].event}`, ".flag", "\tret z", "\tld a, [wTrainerSmokeSaved]", "\tcp $5a", "\tret z", "\tand a", "\tjr nz, .saved", "\tld a, 1", "\tld [wTrainerSmokeSaved], a", "\tfarcall SaveGameData", ".saved", "\tld a, $5a", "\tld [wTrainerSmokeSaved], a", "\tret", ""].join("\n"));
  const target = root.includes("pokeyellow") ? "pokeyellow" : "pokered";
  run("make", ["-j2", `RGBDS=${rgbds}/`, `${target}.gbc`]);
  const cpu = join(temp, "trainer-gameplay"); run("cc", ["-std=gnu11", "-O2", `-I${join(binjgb, "src")}`, resolve("tests/mapTrainerGameplayProbe.c"), ...["memory.c", "common.c", "emulator-debug.c"].map(f => join(binjgb, "src", f)), "-lm", "-o", cpu]);
  for (const mode of (process.env.TRAINER_GAMEPLAY_MODES ? process.env.TRAINER_GAMEPLAY_MODES.split(",").map(Number) : [0, 1, 2, 3, 4, 5])) {
    const offsets = { 1: { x: 0, y: 1 }, 3: { x: 0, y: -1 }, 4: { x: -1, y: 0 }, 5: { x: 1, y: 0 } }, off = offsets[mode as keyof typeof offsets];
    const spawn = off ? { x: manual.x + off.x, y: manual.y + off.y } : initial;
    console.log(run(cpu, [join(temp, `${target}.gbc`), join(temp, `${target}.sym`), String(mode), creation.nextId.toString(16), ...flags.map(f => f.toString(16)), String(spawn.x), String(spawn.y), String(creation.visualization.map.width), join(temp, `mode${mode}.sav`), join(temp, `mode${mode}.rgba`)]));
  }
} finally { if (process.env.KEEP_TRAINER_GAMEPLAY) console.error("Trainer fixture:", temp); else await rm(temp, { recursive: true, force: true }); }
