import assert from "node:assert/strict";
import { test } from "node:test";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadScriptInteractionDocument, prepareScriptInteractionWrites, type ManagedInteraction } from "../src/core/scriptInteractions";
import { loadMapNpcCreateDocument, prepareMapNpcWrites } from "../src/core/npcCreation";
import { identifySequenceDialogue } from "../src/core/interactionSequence";
import type { ProjectSource } from "../src/core/types";
import { sceneCpuProbes } from "./sceneCpuProbes";
import { sceneGiftCpuProbes } from "./sceneGiftCpuProbes";
import { renderScene } from "../src/core/interactionScene";
const args = process.argv.slice(2), at = args.indexOf("--rom");
const rgbds = at < 0 ? null : resolve(args[at + 1]), binjgb = at < 0 ? null : resolve(args[at + 2]);
if (at >= 0) args.splice(at, 3);
for (const directory of args) test(`${directory}: walking scenes`, async () => {
  const root = resolve(directory), overlay = new Map<string, string>();
  async function listFiles(folder = ""): Promise<string[]> {
    return (await Promise.all((await readdir(join(root, folder), { withFileTypes: true })).filter(entry => !entry.name.startsWith(".")).map(entry => entry.isDirectory() ? listFiles(join(folder, entry.name)) : [join(folder, entry.name)]))).flat();
  }
  const source: ProjectSource = { listFiles, readText: async path => overlay.get(path) ?? readFile(join(root, path), "utf8"), readBytes: async path => new Uint8Array(await readFile(join(root, path))), exists: async path => { try { await readFile(join(root, path)); return true; } catch { return false; } } };
  const npc = await loadMapNpcCreateDocument(source, "PALLET_TOWN");
  (await prepareMapNpcWrites(source, npc, { x: 8, y: 8, sprite: "SPRITE_OAK", movement: "STAY", direction: "DOWN", dialogue: { kind: "new", lines: ["Hello there!"] } })).forEach(write => overlay.set(write.path, write.contents));
  const actor = `PALLET_TOWN_EDITOR_NPC_${npc.objectId}`, path = "scripts/PalletTown.asm", label = `PalletTownEditorNpc${npc.objectId}Text`;
  const document = await loadScriptInteractionDocument(source, path, label);
  assert.equal(document.scene.reason, null);
  const before = await source.readText(path), nativeOak = before.slice(before.indexOf("PalletTownDefaultScript:"), before.indexOf("PalletTown_TextPointers:"));
  const values = { ...document.values, showOriginal: false, actions: identifySequenceDialogue([
    { kind: "visibility", npc: actor, visible: true }, { kind: "dialogue", lines: ["Follow me?"] },
    { kind: "choice", yes: [{ kind: "follow-npc", npc: actor, steps: ["LEFT", "UP"] }, { kind: "visibility", npc: actor, visible: false }, { kind: "dialogue", lines: ["We arrived!"] }], no: [{ kind: "visibility", npc: actor, visible: false }, { kind: "end", complete: false }] },
  ]), scene: { trigger: "coordinate" as const, playerX: 8, playerY: 9, idleState: 0, hiddenNpcs: [actor] } };
  (await prepareScriptInteractionWrites(source, document, values)).forEach(write => overlay.set(write.path, write.contents));
  const generated = overlay.get(path)!, model = JSON.parse(generated.match(/yellow-editor-interaction: (.*)/)![1]) as ManagedInteraction;
  assert.equal(model.version, 3); assert.ok(generated.includes(nativeOak), "Preserve Oak's native event");
  const again = await loadScriptInteractionDocument(source, path, label);
  assert.deepEqual(again.values, values);
  const unchanged = await prepareScriptInteractionWrites(source, again, again.values);
  assert.equal(unchanged.find(write => write.path === path)!.contents, generated);
  assert.equal(unchanged.find(write => write.path.includes("toggleable_objects"))!.contents, overlay.get("engine/overworld/toggleable_objects.asm"));
  await assert.rejects(() => prepareScriptInteractionWrites(source, again, { ...values, actions: identifySequenceDialogue([{ kind: "follow-npc", npc: actor, steps: ["DOWN"] }]) }), /Show the hidden NPC/);
  await assert.rejects(() => prepareScriptInteractionWrites(source, again, { ...values, actions: identifySequenceDialogue([{ kind: "visibility", npc: actor, visible: true }, { kind: "follow-npc", npc: actor, steps: ["DOWN"] }]) }), /blocked/);
  await assert.rejects(() => prepareScriptInteractionWrites(source, again, { ...values, scene: { ...values.scene, playerX: 7, playerY: 9 } }), /warps and signs/);
  overlay.set(path, generated + "\n; external change\n");
  await assert.rejects(() => prepareScriptInteractionWrites(source, again, values), /sources changed/); overlay.set(path, generated);
  overlay.set(path, generated.replace("\tcall StartSimulatingJoypadStates", "\tcall DelayFrame"));
  const edited = await loadScriptInteractionDocument(source, path, label);
  await assert.rejects(() => prepareScriptInteractionWrites(source, edited, values), /generated logic was changed/); overlay.set(path, generated);
  await assert.rejects(() => prepareScriptInteractionWrites(source, again, { ...values, scene: { ...values.scene, hiddenNpcs: [] } }), /initial visibility/);
  await assert.rejects(() => prepareScriptInteractionWrites(source, again, { ...values, actions: identifySequenceDialogue([
    { kind: "visibility", npc: actor, visible: true }, { kind: "choice", yes: [{ kind: "follow-npc", npc: actor, steps: ["LEFT"] }], no: [] },
  ]) }), /Rejoining branches/);
  const routeNpc = await loadMapNpcCreateDocument(source, "ROUTE_1");
  (await prepareMapNpcWrites(source, routeNpc, { x: 6, y: 24, sprite: "SPRITE_YOUNGSTER", movement: "STAY", direction: "DOWN", dialogue: { kind: "new", lines: ["This way!"] } })).forEach(write => overlay.set(write.path, write.contents));
  const routePath = "scripts/Route1.asm", routeLabel = `Route1EditorNpc${routeNpc.objectId}Text`;
  const routeDoc = await loadScriptInteractionDocument(source, routePath, routeLabel);
  assert.equal(routeDoc.scene.stateVariable, null);
  const plainValues = { ...routeDoc.values, showOriginal: false, actions: identifySequenceDialogue([{ kind: "dialogue", lines: ["Ready?"] }]) };
  (await prepareScriptInteractionWrites(source, routeDoc, plainValues)).forEach(write => overlay.set(write.path, write.contents));
  const v2 = await loadScriptInteractionDocument(source, routePath, routeLabel);
  const routeValues = { ...v2.values, actions: identifySequenceDialogue([{ kind: "follow-npc", npc: `ROUTE_1_EDITOR_NPC_${routeNpc.objectId}`, steps: ["RIGHT"] }]), scene: { trigger: "interaction" as const, playerX: 6, playerY: 25, idleState: 0, hiddenNpcs: [] } };
  (await prepareScriptInteractionWrites(source, v2, routeValues)).forEach(write => overlay.set(write.path, write.contents));
  assert.deepEqual((await loadScriptInteractionDocument(source, routePath, routeLabel)).values, routeValues);
  const crlfSource = { ...source, readText: async (path: string) => (await source.readText(path)).replace(/\r?\n/g, "\r\n") };
  const crlfDoc = await loadScriptInteractionDocument(crlfSource, path, label);
  const crlfWrites = await prepareScriptInteractionWrites(crlfSource, crlfDoc, crlfDoc.values);
  assert.equal(crlfWrites.find(write => write.path === path)!.contents.replace(/\r\n/g, "\n"), generated);
  const giftValues = { ...again.values, actions: identifySequenceDialogue([
    { kind: "visibility", npc: actor, visible: true },
    { kind: "walk-npc", npc: actor, steps: ["LEFT"] },
    { kind: "dialogue", lines: ["Want a DRATINI?"] },
    { kind: "choice", yes: [{ kind: "pokemon", species: "DRATINI", level: 5 }], no: [] },
    { kind: "walk-npc", npc: actor, steps: ["RIGHT"] },
    { kind: "visibility", npc: actor, visible: false },
  ]) };
  (await prepareScriptInteractionWrites(source, await loadScriptInteractionDocument(source, path, label), giftValues)).forEach(write => overlay.set(write.path, write.contents));
  const giftScript = overlay.get(path)!, giftModel = JSON.parse(giftScript.match(/yellow-editor-interaction: (.*)/)![1]) as ManagedInteraction;
  const giftFlag = giftModel.scene!.giftFlag!;
  assert.ok(giftFlag.endsWith("_GIFT_DELIVERED"));
  const giftDoc = await loadScriptInteractionDocument(source, path, label);
  assert.deepEqual(giftDoc.values, giftValues);
  assert.ok(!giftDoc.events.includes(giftFlag), "Authored actions cannot reset the internal delivery checkpoint");
  await assert.rejects(() => prepareScriptInteractionWrites(source, giftDoc, {
    ...giftDoc.values, events: [{ event: giftFlag, set: false }],
  }), /existing project events/);
  const alternateValues = structuredClone(giftValues);
  const choice = alternateValues.actions.find(action => action.kind === "choice")!;
  if (choice.kind === "choice") choice.no = [{ kind: "item", item: "POTION", quantity: 1 }];
  const alternateWrites = await prepareScriptInteractionWrites(source, giftDoc, alternateValues);
  const alternateGiftModel = JSON.parse(alternateWrites.find(write => write.path === path)!.contents.match(/yellow-editor-interaction: (.*)/)![1]) as ManagedInteraction;
  assert.equal(alternateGiftModel.scene!.giftFlag, giftFlag);
  const giftAgain = await prepareScriptInteractionWrites(source, giftDoc, giftDoc.values);
  assert.equal(giftAgain.find(write => write.path === path)!.contents, giftScript);
  assert.ok(!giftAgain.some(write => write.path === "constants/event_constants.asm"), "Reopening/saving retains the same reserved bit");
  // Old v3 scenes verify against their original code, then acquire a checkpoint
  // on save. No manual edits or source-guard bypass is needed to upgrade.
  const legacy = structuredClone(giftModel);
  delete legacy.scene!.giftFlag;
  const oldCode = renderScene(legacy);
  const start = giftScript.indexOf(`${label}:`), marker = `; yellow-editor-interaction-code-end ${label}`;
  const end = giftScript.indexOf("\n", giftScript.indexOf(marker, start)) + 1;
  const constantsPath = "constants/event_constants.asm", currentEvents = overlay.get(constantsPath)!;
  overlay.set(path, giftScript.slice(0, start) + oldCode + giftScript.slice(end).replace(/^\n/, ""));
  overlay.set(constantsPath, currentEvents.replace(new RegExp(`\\nDEF ${giftFlag} EQU \\$[a-f0-9]+\\n`), "\n"));
  const legacyDoc = await loadScriptInteractionDocument(source, path, label);
  const upgraded = await prepareScriptInteractionWrites(source, legacyDoc, legacyDoc.values);
  assert.ok(upgraded.some(write => write.path === constantsPath && write.contents.includes(`DEF ${giftFlag} EQU`)));
  assert.equal(upgraded.find(write => write.path === path)!.contents, giftScript);
  overlay.set(path, giftScript); overlay.set(constantsPath, currentEvents);
  const giftCrlfSource = { ...source, readText: async (path: string) => (await source.readText(path)).replace(/\r?\n/g, "\r\n") };
  const giftCrlfDoc = await loadScriptInteractionDocument(giftCrlfSource, path, label);
  assert.equal((await prepareScriptInteractionWrites(giftCrlfSource, giftCrlfDoc, giftCrlfDoc.values)).find(write => write.path === path)!.contents.replace(/\r\n/g, "\n"), giftScript);
  if (rgbds && binjgb) {
    const temporary = await mkdtemp(resolve("node_modules/.scene-runtime-"));
    const run = (cmd: string, argv: string[], cwd = temporary) => {
      const result = spawnSync(cmd, argv, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
      assert.equal(result.status, 0, `${cmd}: ${result.stderr.slice(-7000)}\n${result.stdout.slice(-500)}`); return result.stdout;
    };
    try {
      const game = join(temporary, "game"); await cp(root, game, { recursive: true, filter: path => !path.split("/").includes(".git") });
      const target = root.includes("pokeyellow") ? "pokeyellow" : "pokered";
      run("make", ["clean"], game); run("make", ["-j2", `RGBDS=${rgbds}/`, `${target}.gbc`], game);
      const baseSymbols = await readFile(join(game, `${target}.sym`), "utf8");
      for (const [path, text] of overlay) await writeFile(join(game, path), text);
      run("make", ["clean"], game); run("make", ["-j2", `RGBDS=${rgbds}/`, `${target}.gbc`], game);
      const modifiedSymbols = await readFile(join(game, `${target}.sym`), "utf8");
      const savedRam = (symbols: string) => [...symbols.matchAll(/^00:([cd][0-9a-f]{3}) (w\w+)$/gm)].map(match => [match[2], match[1]]);
      const modified = new Map(savedRam(modifiedSymbols));
      for (const [name, address] of savedRam(baseSymbols)) assert.equal(modified.get(name), address, `Existing WRAM address changed: ${name}`);
      const cpu = join(temporary, "cpu");
      run("cc", ["-std=gnu11", "-O2", `-I${join(binjgb, "src")}`, resolve("tests/scriptRuntimeProbe.c"), ...["memory.c", "common.c", "emulator-debug.c"].map(file => join(binjgb, "src", file)), "-lm", "-o", cpu]);
      await sceneCpuProbes(root, temporary, rgbds, cpu, run, model, generated, overlay.get("constants/event_constants.asm")!, overlay.get("engine/overworld/toggleable_objects.asm")!);
      await sceneGiftCpuProbes(root, temporary, rgbds, cpu, run, giftModel, alternateGiftModel, overlay.get("constants/event_constants.asm")!, overlay.get("engine/overworld/toggleable_objects.asm")!);
      console.log(`${root}: complete scene ROM builds and unchanged existing WRAM/save addresses verified`);
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }
  console.log(`${root}: hidden coordinate scene, following, stable pointers, path refusals and source guards passed`);
});
