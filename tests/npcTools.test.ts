import assert from "node:assert/strict";
import { test } from "node:test";
import { cp, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { loadScriptInteractionDocument, prepareScriptInteractionWrites } from "../src/core/scriptInteractions";
import { loadMapNpcCreateDocument, prepareMapNpcWrites } from "../src/core/npcCreation";
import { createProjectHistoryManager } from "../src/core/history";
import { identifySequenceDialogue, validateInteractionSequence, type InteractionAction } from "../src/core/interactionSequence";
import { validatePlayerCondition, type PlayerCondition } from "../src/core/playerConditions";
import { npcToolsCpuProbes } from "./npcToolsCpuProbes";
import type { ManagedInteraction } from "../src/core/scriptInteractions";
import type { ProjectSource, HistoryState, TextWriteRequest } from "../src/core/types";

async function fixture(root: string) {
  const files: string[] = [], overlay = new Map<string, string>(); let journal: HistoryState | null = null;
  async function collect(folder = "") { for (const e of await readdir(join(root, folder), { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const p = join(folder, e.name); if (e.isDirectory()) await collect(p); else files.push(p);
  } }
  await collect();
  const source: ProjectSource = { displayPath: root, storageKey: root, listFiles: async () => [...new Set([...files, ...overlay.keys()])], readText: async p => overlay.get(p) ?? readFile(join(root, p), "utf8"), readBytes: async p => new Uint8Array(await readFile(join(root, p))), exists: async p => overlay.has(p) || stat(join(root, p)).then(() => true, () => false), writeText: async (p, text) => { overlay.set(p, text); }, historyStore: { persistent: true, load: async () => journal, save: async j => { journal = structuredClone(j); } } };
  const apply = (writes: TextWriteRequest[]) => writes.forEach(w => { assert.equal(w.encoding, undefined); overlay.set(w.path, w.contents); });
  return { source, overlay, apply };
}
const args = process.argv.slice(2), romAt = args.indexOf("--rom"), rgbds = romAt < 0 ? null : resolve(args[romAt + 1]), binjgb = romAt < 0 ? null : resolve(args[romAt + 2]);
if (romAt >= 0) args.splice(romAt, 3);
assert.ok(args.length, "Supply Red/Yellow source directories.");
for (const directory of args) test(`${directory}: reusable player conditions, persistent NPC visibility and services`, async () => {
  const root = resolve(directory), { source, overlay, apply } = await fixture(root);
  const npc = await loadMapNpcCreateDocument(source, "BLUES_HOUSE");
  apply(await prepareMapNpcWrites(source, npc, { x: 1, y: 1, sprite: "SPRITE_GENTLEMAN", movement: "STAY", direction: "DOWN", dialogue: { kind: "new", lines: ["Come back as", "the Champion!"] } }));
  const path = "scripts/BluesHouse.asm", label = `BluesHouseEditorNpc${npc.objectId}Text`;
  const doc = await loadScriptInteractionDocument(source, path, label);
  assert.equal(doc.conditions?.reason, null); assert.equal(doc.services?.transactionReason, null); assert.equal(doc.services?.shopReason, null);
  assert.ok(doc.conditions.moves.includes("CUT")); assert.ok(doc.items.includes("HM_CUT")); assert.ok(doc.items.includes("TM_DIG"));
  assert.equal(doc.visibilityNpc?.id, npc.objectId);
  const condition: PlayerCondition = { kind: "not", condition: { kind: "hall-of-fame" } };
  const values = { ...doc.values, once: false, actions: [] as InteractionAction[], visibleWhen: condition };
  const history = createProjectHistoryManager(source);
  const writes = await prepareScriptInteractionWrites(source, doc, values);
  await history.save("Hide blocker after Hall of Fame", writes);
  const next = await loadScriptInteractionDocument(source, path, label);
  assert.deepEqual(next.values.visibleWhen, condition);
  assert.match(await source.readText("engine/overworld/toggleable_objects.asm"), /ld a, \[wNumHoFTeams\]/);
  const repeat = await prepareScriptInteractionWrites(source, next, next.values);
  assert.ok(repeat.every(w => w.contents === overlay.get(w.path)), "No-op regeneration preserves generated runtime");
  await history.undo(); assert.equal((await loadScriptInteractionDocument(source, path, label)).values.visibleWhen, undefined);
  await history.redo();
  const reopened = await loadScriptInteractionDocument(source, path, label);
  const checks: PlayerCondition[] = [{ kind: "hall-of-fame" }, { kind: "item", item: "HM_CUT", quantity: 1 }, { kind: "party-species", species: "LAPRAS" }, { kind: "party-move", move: "SURF", species: "LAPRAS" }, { kind: "badge", badge: "SOUL" }, { kind: "badge-count", minimum: 8 }, { kind: "party-count", minimum: 2 }, { kind: "bag-space", minimum: 1 }, { kind: "dex-species", species: "MEW", status: "seen" }, { kind: "dex-count", minimum: 30, status: "caught" }, { kind: "money", amount: 999999 }, { kind: "coins", amount: 9999 }, { kind: "travel", mode: "surfing" }];
  checks.forEach(c => validatePlayerCondition(c, reopened));
  assert.throws(() => validatePlayerCondition({ kind: "party-move", move: "NOT_A_MOVE" }, reopened), /valid player/);
  const transaction: InteractionAction = { kind: "transaction", cost: { kind: "money", amount: 500 }, reward: { kind: "item", item: "POTION", quantity: 2 }, confirm: true, success: [{ kind: "dialogue", lines: ["Thank you!"] }], declined: [{ kind: "end", complete: false }], insufficient: [{ kind: "end", complete: false }], full: [{ kind: "end", complete: false }] };
  validateInteractionSequence([transaction], reopened, true);
  assert.throws(() => validateInteractionSequence([transaction, { kind: "item", item: "POTION", quantity: 1 }], reopened, true), /one reward/);
  const actions = identifySequenceDialogue([{ kind: "if-condition", condition: { kind: "all", conditions: [checks[0], { kind: "any", conditions: [checks[2], checks[3]] }] }, then: [transaction], otherwise: [{ kind: "dialogue", lines: ["Bring a LAPRAS!"] }, { kind: "end", complete: false }] }]);
  apply(await prepareScriptInteractionWrites(source, reopened, { ...reopened.values, condition: { kind: "not", condition: { kind: "travel", mode: "surfing" } }, actions }));
  const roundtrip = await loadScriptInteractionDocument(source, path, label);
  assert.deepEqual(roundtrip.values.actions, actions);
  assert.ok((await prepareScriptInteractionWrites(source, roundtrip, roundtrip.values)).every(w => w.contents === overlay.get(w.path)));
  // A shop in a yielding scene exercises native text handoff and coexistence
  // with the independently evaluated visibility rule above.
  const clerk = await loadMapNpcCreateDocument(source, "VIRIDIAN_POKECENTER");
  apply(await prepareMapNpcWrites(source, clerk, { x: 8, y: 4, sprite: "SPRITE_GENTLEMAN", movement: "STAY", direction: "DOWN", dialogue: { kind: "new", lines: ["Welcome!"] } }));
  const shopPath = "scripts/ViridianPokecenter.asm", shopLabel = `ViridianPokecenterEditorNpc${clerk.objectId}Text`;
  let shop = await loadScriptInteractionDocument(source, shopPath, shopLabel);
  const shopValues = { ...shop.values, once: false, showOriginal: false, actions: identifySequenceDialogue([{ kind: "dialogue", lines: ["Have a look!"] }, { kind: "shop", items: ["POTION", "POKE_BALL", "TM_DIG"] }]), scene: { trigger: "interaction" as const, playerX: 8, playerY: 5, idleState: 0, hiddenNpcs: [] } };
  apply(await prepareScriptInteractionWrites(source, shop, shopValues));
  shop = await loadScriptInteractionDocument(source, shopPath, shopLabel);
  assert.deepEqual(shop.values, shopValues);
  apply(await prepareScriptInteractionWrites(source, shop, shop.values));
  // Update the rule after installing the scene runtime, then the scene after
  // updating the rule; neither updater may detach the other's hook.
  const blocker = await loadScriptInteractionDocument(source, path, label);
  apply(await prepareScriptInteractionWrites(source, blocker, { ...blocker.values, visibleWhen: { kind: "all", conditions: [condition, { kind: "badge-count", minimum: 1 }] } }));
  shop = await loadScriptInteractionDocument(source, shopPath, shopLabel);
  apply(await prepareScriptInteractionWrites(source, shop, shop.values));
  const cashier = await loadMapNpcCreateDocument(source, "VIRIDIAN_POKECENTER");
  apply(await prepareMapNpcWrites(source, cashier, { x: 6, y: 4, sprite: "SPRITE_GENTLEMAN", movement: "STAY", direction: "DOWN", dialogue: { kind: "new", lines: ["A paid service."] } }));
  const cashierLabel = `ViridianPokecenterEditorNpc${cashier.objectId}Text`, cashierDoc = await loadScriptInteractionDocument(source, shopPath, cashierLabel);
  apply(await prepareScriptInteractionWrites(source, cashierDoc, { ...cashierDoc.values, once: false, showOriginal: false, actions: identifySequenceDialogue([{ ...transaction, cost: { kind: "money", amount: 500 }, reward: { kind: "heal" }, confirm: false }]), scene: { trigger: "interaction", playerX: 6, playerY: 5, idleState: 0, hiddenNpcs: [] } }));
  const receipt = [...(await source.readText(shopPath)).matchAll(/yellow-editor-interaction: (.*)/g)].map(m => JSON.parse(m[1]) as ManagedInteraction).find(m => m.label === cashierLabel)!;
  assert.ok(receipt.scene?.giftFlag);
  // The supplied project already has this NPC and expanded cave. Exercise its
  // real text entry without changing terrain or the uploaded archive.
  if ((await source.readText("scripts/DiglettsCave.asm")).includes("DiglettsCaveEditorNpc1Text:")) {
    const cave = await loadScriptInteractionDocument(source, "scripts/DiglettsCave.asm", "DiglettsCaveEditorNpc1Text");
    apply(await prepareScriptInteractionWrites(source, cave, { ...cave.values, once: false, actions: [], visibleWhen: condition }));
    assert.match(await source.readText("scripts/DiglettsCave.asm"), /Come back when/);
  }
  if (rgbds) {
    const temp = await mkdtemp(resolve("node_modules/.npc-tools-rom-"));
    const run = (cmd: string, args: string[], cwd = temp) => { const result = spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }); assert.equal(result.status, 0, `${cmd}: ${result.stderr?.slice(-8000)}\n${result.stdout?.slice(-1000)}`); return result.stdout; };
    try {
      if (binjgb) {
        const cpu = join(temp, "cpu");
        run("cc", ["-std=gnu11", "-O2", `-I${join(binjgb, "src")}`, resolve("tests/scriptRuntimeProbe.c"), ...["memory.c", "common.c", "emulator-debug.c"].map(f => join(binjgb, "src", f)), "-lm", "-o", cpu]);
        await npcToolsCpuProbes(root, temp, rgbds, cpu, run, overlay, receipt);
      }
      await cp(root, temp, { recursive: true, filter: p => !p.split("/").includes(".git") });
      for (const [p, contents] of overlay) await writeFile(join(temp, p), contents);
      const game = root.includes("pokeyellow") ? "pokeyellow" : "pokered";
      const result = spawnSync("make", ["-j2", `RGBDS=${rgbds}/`, `${game}.gbc`], { cwd: temp, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
      assert.equal(result.status, 0, result.stderr.slice(-7000));
      console.log(`${game}: whole ROM with conditional NPC visibility, compound checks, payment and native shop compiled`);
    } finally { await rm(temp, { recursive: true, force: true }); }
  }
  const prior = await loadScriptInteractionDocument(source, path, label);
  apply(await prepareScriptInteractionWrites(source, prior, { ...prior.values, visibleWhen: null }));
  assert.equal((await loadScriptInteractionDocument(source, path, label)).values.visibleWhen, null);
  assert.equal((await source.readText("engine/overworld/toggleable_objects.asm")).includes(`NPC condition ${label}EditorInteraction`), false);
  shop = await loadScriptInteractionDocument(source, shopPath, shopLabel);
  apply(await prepareScriptInteractionWrites(source, shop, shop.values));
  const cleared = await loadScriptInteractionDocument(source, path, label);
  apply(await prepareScriptInteractionWrites(source, cleared, { ...cleared.values, visibleWhen: prior.values.visibleWhen }));
  const current = await loadScriptInteractionDocument(source, path, label), runtime = await source.readText("engine/overworld/toggleable_objects.asm");
  overlay.set("engine/overworld/toggleable_objects.asm", runtime.replace("EditorNpcConditionVisibility::", "EditorNpcConditionVisibility::\n\tnop"));
  await assert.rejects(prepareScriptInteractionWrites(source, current, current.values), /sources changed/);
  const drift = await loadScriptInteractionDocument(source, path, label);
  await assert.rejects(prepareScriptInteractionWrites(source, drift, drift.values), /visibility runtime was changed/);
});
