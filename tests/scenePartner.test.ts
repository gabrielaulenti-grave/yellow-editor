import assert from "node:assert/strict";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { loadMapNpcCreateDocument, prepareMapNpcWrites } from "../src/core/npcCreation";
import { checkScriptInteraction, loadScriptInteractionDocument, prepareScriptInteractionWrites, type ManagedInteraction } from "../src/core/scriptInteractions";
import { identifySequenceDialogue, type InteractionAction } from "../src/core/interactionSequence";
import type { ProjectSource } from "../src/core/types";
import { loadMapNpcEditDocument, prepareMapNpcEditWrites } from "../src/core/npcEditing";
import { parseMapIndex } from "../src/core/mapVisualization";

const args = process.argv.slice(2), at = args.indexOf("--rom"), roots = at < 0 ? args : args.slice(0, at);
const rgbds = at < 0 ? null : resolve(args[at + 1]), cpu = at < 0 ? null : resolve(args[at + 2]);
assert.ok(roots.length);
for (const rootArg of roots) {
  const root = resolve(rootArg), overlay = new Map<string, string>();
  async function listFiles(path = ""): Promise<string[]> {
    return (await Promise.all((await readdir(join(root, path), { withFileTypes: true })).filter(entry => !entry.name.startsWith(".")).map(entry => entry.isDirectory() ? listFiles(join(path, entry.name)) : [join(path, entry.name)]))).flat();
  }
  const source: ProjectSource = { storageKey: root, listFiles, readText: async path => overlay.get(path) ?? readFile(join(root, path), "utf8"), readBytes: async path => new Uint8Array(await readFile(join(root, path))), exists: async path => { try { await readFile(join(root, path)); return true; } catch { return overlay.has(path); } } };
  const events = await source.readText("constants/event_constants.asm");
  overlay.set("constants/event_constants.asm", events + "\nDEF EVENT_PARTNER_FOLLOWING EQU $9d0\nDEF EVENT_PARTNER_ABSENT EQU $9d1\nDEF EVENT_PARTNER_BATTLE EQU $9d2\nDEF EVENT_PARTNER_LOSS EQU $9d3\n");
  const npc = await loadMapNpcCreateDocument(source, "VIRIDIAN_POKECENTER");
  (await prepareMapNpcWrites(source, npc, { x: 4, y: 4, sprite: "SPRITE_OAK", movement: "STAY", direction: "DOWN", dialogue: { kind: "new", lines: ["Hello!"] } })).forEach(write => overlay.set(write.path, write.contents));
  const path = "scripts/ViridianPokecenter.asm", label = `ViridianPokecenterEditorNpc${npc.objectId}Text`, actor = `VIRIDIAN_POKECENTER_EDITOR_NPC_${npc.objectId}`;
  const doc = await loadScriptInteractionDocument(source, path, label), yellow = doc.scene.partner?.reason === null;
  const actions: InteractionAction[] = [{ kind: "if-partner", following: [{ kind: "event", event: "EVENT_PARTNER_FOLLOWING", set: true }, { kind: "partner-move", x: 3, y: 5, facing: "UP" }], absent: [{ kind: "event", event: "EVENT_PARTNER_ABSENT", set: true }] }, { kind: "if-event", event: "EVENT_PARTNER_BATTLE", set: true, then: [{ kind: "if-event", event: "EVENT_PARTNER_LOSS", set: true,
    then: [{ kind: "wild-battle", species: "SNORLAX", level: 30, cry: false, won: [], caught: [], escaped: [{ kind: "end", complete: false }] }],
    otherwise: [{ kind: "wild-battle", species: "MAGIKARP", level: 2, cry: false, won: [], caught: [], escaped: [{ kind: "end", complete: false }] }],
  }, { kind: "partner-move", x: 3, y: 5, facing: "UP" }], otherwise: [] }, { kind: "walk-npc", npc: actor, steps: ["DOWN", "RIGHT"] }, { kind: "visibility", npc: actor, visible: false }];
  const values = { ...doc.values, once: false, showOriginal: false, actions: identifySequenceDialogue(actions), scene: { trigger: "coordinate" as const, playerX: 4, playerY: 6, idleState: 0, hiddenNpcs: [] } };
  if (!yellow) {
    assert.match(doc.scene.partner!.reason!, /no supported following partner/);
    await assert.rejects(() => prepareScriptInteractionWrites(source, doc, values), /following partner/);
    assert.equal((await checkScriptInteraction(source, doc, { ...doc.values, actions: [{ kind: "dialogue", lines: ["Still works!"] }] })).valid, true);
    console.log(`${root}: Red refuses unsupported partner actions while ordinary interactions remain available`); continue;
  }
  assert.equal(doc.scene.partner!.name, "Pikachu");
  for (const target of [{ x: 4, y: 6 }, { x: 4, y: 7 }, { x: 4, y: 3 }, { x: -1, y: 5 }, { x: 100, y: 5 }]) {
    const report = await checkScriptInteraction(source, doc, { ...values, actions: [{ kind: "partner-move", ...target }] });
    assert.equal(report.valid, false); assert.equal(report.issues[0].actionPath, "Action1"); assert.deepEqual(report.issues[0].tile, target);
  }
  await assert.rejects(() => prepareScriptInteractionWrites(source, doc, { ...values, actions: [{ kind: "partner-move", x: 4, y: 5 }, ...actions.slice(2)] }), /partner's destination/);
  const driftPath = "engine/pikachu/pikachu_movement.asm", original = await source.readText(driftPath);
  overlay.set(driftPath, original.replace("ApplyPikachuMovementData_::", "ApplyPikachuMovementData_::\n\tnop"));
  const drift = await loadScriptInteractionDocument(source, path, label);
  assert.match(drift.scene.partner!.reason!, /reviewed Yellow/);
  await assert.rejects(() => prepareScriptInteractionWrites(source, drift, values), /reviewed Yellow/);
  overlay.delete(driftPath);
  const ram = await source.readText("ram/wram.asm");
  overlay.set("ram/wram.asm", ram.replace("wPikachuFollowCommandBuffer:: ds 16", "wPikachuFollowCommandBuffer:: ds 8"));
  assert.match((await loadScriptInteractionDocument(source, path, label)).scene.partner!.reason!, /buffer layout/);
  overlay.delete("ram/wram.asm");
  (await prepareScriptInteractionWrites(source, doc, values)).forEach(write => overlay.set(write.path, write.contents));
  const generated = overlay.get(path)!, model = JSON.parse(generated.match(/yellow-editor-interaction: (.*)/)![1]) as ManagedInteraction;
  const reopened = await loadScriptInteractionDocument(source, path, label);
  assert.deepEqual(reopened.values, values);
  assert.equal((await prepareScriptInteractionWrites(source, reopened, reopened.values)).find(write => write.path === path)!.contents, generated);
  const move = model.scene!.nodes.find(node => node.action?.kind === "partner-move")!;
  assert.ok(move.partnerRoute!.some(cell => cell.x === 4 && cell.y === 5 && cell.toX === 3 && cell.toY === 5));
  assert.ok(!move.partnerRoute!.some(cell => cell.toX === 4 && cell.toY === 6));
  assert.equal(model.scene!.partner, true);
  const crlf = { ...source, readText: async (path: string) => (await source.readText(path)).replace(/\r?\n/g, "\r\n") };
  const crlfDoc = await loadScriptInteractionDocument(crlf, path, label);
  assert.equal((await prepareScriptInteractionWrites(crlf, crlfDoc, crlfDoc.values)).find(write => write.path === path)!.contents.replace(/\r\n/g, "\n"), generated);
  const edit = await loadMapNpcEditDocument(source, "VIRIDIAN_POKECENTER", npc.objectId);
  const moved = await prepareMapNpcEditWrites(source, edit, { ...edit.values, x: 5, y: 4, moveSceneStart: true });
  const movedModel = JSON.parse(moved.find(write => write.path === path)!.contents.match(/yellow-editor-interaction: (.*)/)![1]) as ManagedInteraction;
  const movedBranch = movedModel.values.actions![0]; assert.equal(movedBranch.kind, "if-partner");
  if (movedBranch.kind === "if-partner") assert.deepEqual(movedBranch.following[1], { kind: "partner-move", x: 4, y: 5, facing: "UP" });
  assert.equal(movedModel.values.scene!.playerX, 5);
  console.log(`${root}: native contracts, partner branch joins, parking/route conflicts, action/tile errors, CRLF and source round trip passed`);
  if (!rgbds || !cpu) continue;
  const folder = resolve("node_modules/.partner-native"), game = join(folder, "game");
  await mkdir(folder, { recursive: true });
  await cp(root, game, { recursive: true, filter: path => !path.split("/").includes(".git") });
  for (const [file, contents] of overlay) await writeFile(join(game, file), contents);
  const patch = async (file: string, edit: (text: string) => string) => writeFile(join(game, file), edit(await readFile(join(game, file), "utf8")));
  // Fixture-only new game: native party construction supplies the starter's OT,
  // ID and HP. The production follower, movement, rendering and collision run.
  const setup = ["OakSpeech:", "\tcall PrepareOakSpeech", "\tpredef InitPlayerData2", "\tld a, [PartnerMode]", "\tld [wUnusedPlayerDataByte], a", "\tcp 8", "\tjr c, .noBattle", "\tSetEvent EVENT_PARTNER_BATTLE", ".noBattle", "\tld a, [PartnerMode]", "\tcp 9", "\tjr nz, .noLoss", "\tSetEvent EVENT_PARTNER_LOSS", ".noLoss", "\tld a, [PartnerMode]", "\tcp 1", "\tld a, PIKACHU", "\tjr nz, .species", "\tld a, MEWTWO", ".species", "\tld [wCurPartySpecies], a", "\tld a, [PartnerMode]", "\tcp 9", "\tld a, 20", "\tjr nz, .level", "\tld a, 5", ".level", "\tld [wCurEnemyLevel], a", "\tld a, $10", "\tld [wMonDataLocation], a", "\tcall AddPartyMon", "\tld a, SWIFT", "\tld [wPartyMon1Moves], a", "\txor a", "\tld [wPartyMon1Moves + 1], a", "\tld [wPartyMon1Moves + 2], a", "\tld [wPartyMon1Moves + 3], a", "\tld a, 20", "\tld [wPartyMon1PP], a", "\tld hl, wPikachuSpawnStateFlags", "\tset BIT_PIKACHU_SPAWN_STARTER, [hl]", "\tld a, $c1", "\tld [wOptions], a", "\tld a, VIRIDIAN_CITY", "\tld [wDestinationMap], a", "\tcall PrepareForSpecialWarp", "\tld a, 2", "\tld [wPikachuSpawnState], a", "\tld a, VIRIDIAN_CITY", "\tld [wLastMap], a", "\tcall LoadTextBoxTilePatterns", "\tld a, 1", "\tld [wUpdateSpritesEnabled], a", "\tret", "PartnerMode::", "\tdb 0", ""].join("\n");
  await patch("engine/movie/oak_speech/oak_speech.asm", text => { const start = text.indexOf("\nOakSpeech:\n") + 1, end = text.indexOf("OakSpeechText1:", start); assert.ok(start > 0 && end > start); return text.slice(0, start) + setup + text.slice(end); });
  await patch("engine/movie/oak_speech/oak_speech.asm", text => text.replace("\tld a, $c1\n\tld [wOptions], a", [
    "\tld a, [PartnerMode]", "\tcp 2", "\tjr nz, .notFainted", "\txor a", "\tld [wPartyMon1HP], a", "\tld [wPartyMon1HP + 1], a", ".notFainted",
    "\tld a, [PartnerMode]", "\tcp 3", "\tcall z, DisablePikachuFollowingPlayer",
    "\tld a, [PartnerMode]", "\tcp 4", "\tcall z, DisablePikachuOverworldSpriteDrawing",
    "\tld a, [PartnerMode]", "\tcp 5", "\tjr nz, .identity", "\tld a, [wPartyMon1OTID]", "\txor 1", "\tld [wPartyMon1OTID], a", ".identity",
    "\tld a, $c1", "\tld [wOptions], a",
  ].join("\n")));
  // Native map loading schedules Pikachu afresh; apply the fixture's detached /
  // hidden states after loading, as an ordinary story script would do.
  await patch(path, text => text.replace("ViridianPokecenter_Script:\n", "ViridianPokecenter_Script:\n\tcall PartnerFixtureState\n") + ["", "PartnerFixtureState:",
    "\tld a, [wUnusedPlayerDataByte]", "\tcp 3", "\tcall z, DisablePikachuFollowingPlayer", "\tcp 4", "\tcall z, DisablePikachuOverworldSpriteDrawing",
    "\tld a, [wUnusedPlayerDataByte]", "\tcp 7", "\tjr nz, .notRejoin", "\tld a, [wSpritePikachuStateData2MapX]", "\tcp 7", "\tret nz", "\tld a, [wSpritePikachuStateData2MapY]", "\tcp 9", "\tret nz", "\tld a, 7", "\tld [wSprite02StateData2MapX], a", "\tld a, 10", "\tld [wSprite02StateData2MapY], a", "\tret", ".notRejoin", "\tld a, [wUnusedPlayerDataByte]", "\tcp 6", "\tret nz", "\tld a, 7", "\tld [wSprite02StateData2MapX], a", "\tld a, 9", "\tld [wSprite02StateData2MapY], a", "\tret", ""].join("\n"));
  await patch("data/maps/special_warps.asm", text => text.replace("special_warp_spec REDS_HOUSE_2F, 3, 6, REDS_HOUSE_2", "special_warp_spec VIRIDIAN_POKECENTER, 4, 6, POKECENTER"));
  const run = (command: string, args: string[], cwd = folder) => { const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }); assert.equal(result.status, 0, `${command}: ${result.stderr.slice(-8000)}\n${result.stdout.slice(-2000)}`); return result.stdout; };
  run("make", ["-j2", `RGBDS=${rgbds}/`, "pokeyellow.gbc"], game);
  const probe = join(folder, "probe");
  run("cc", ["-std=gnu11", "-O2", `-I${join(cpu, "src")}`, resolve("tests/scenePartnerProbe.c"), ...["memory.c", "common.c", "emulator-debug.c"].map(file => join(cpu, "src", file)), "-lm", "-o", probe]);
  const map = (await parseMapIndex(source)).find(map => map.constant === "VIRIDIAN_POKECENTER")!;
  for (const mode of (process.env.PARTNER_MODES ?? "0,1,2,3,4,5,6,7,8,9").split(",").map(Number)) console.log(run(probe, [join(game, "pokeyellow.gbc"), join(game, "pokeyellow.sym"), String(mode), String(map.id), String(npc.objectId), join(folder, `mode-${mode}.rgba`)]));
}
