import assert from "node:assert/strict";
import "./battleAnimationEditing.test";
import { test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { loadBattleAnimationCatalog, composeAnimationFrame } from "../src/core/battleAnimations";
import { loadGraphicsCatalog } from "../src/core/graphics";
import { parseMoves } from "../src/core/parsers";
import type { ProjectSource } from "../src/core/types";

function fixture(root: string) {
  const overrides = new Map<string, string>();
  const source: ProjectSource = {
    displayPath: root, storageKey: root,
    readText: async path => overrides.get(path) ?? await readFile(join(root, path), "utf8"),
    readBytes: async path => new Uint8Array(await readFile(join(root, path))),
    exists: async path => { try { await readFile(join(root, path)); return true; } catch { return false; } },
    listFiles: async () => {
      const files: string[] = [];
      async function visit(folder: string) { for (const entry of await readdir(join(root, folder), { withFileTypes: true })) {
        if (entry.name.startsWith(".")) continue;
        const path = folder ? `${folder}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await visit(path); else files.push(path);
      } }
      await visit(""); return files;
    },
    writeText: async () => { throw new Error("Animation inspection must never write source."); },
    assetUrl: async () => null,
    historyStore: { persistent: false, load: async () => null, save: async () => { throw new Error("Read-only inspection must not write history."); } },
  };
  return { source, overrides };
}

test("frame compositions respect tile order, both flips, transparency and OAM overlap priority", () => {
  const sheet = { width: 16, height: 8, pixels: new Array<number>(128).fill(0) };
  sheet.pixels[0] = 1; sheet.pixels[7 * 16 + 7] = 2; sheet.pixels[8] = 3;
  const block = { id: 0, label: "Test", warnings: [], source: { path: "test", line: 1, text: "" }, sprites: [
    { x: 0, y: 0, tile: 0, flipX: true, flipY: true }, { x: 0, y: 0, tile: 1, flipX: false, flipY: false },
  ] };
  const image = composeAnimationFrame(block, sheet, 2)!;
  assert.equal(image.pixels[0], 2, "earlier sprite has priority over later sprites");
  assert.equal(image.pixels[63], 1, "both flips preserve asymmetric pixels");
  assert.equal(image.pixels[1], null, "shade zero stays transparent");
  assert.equal(composeAnimationFrame(block, sheet, 1), null, "tiles outside loaded bank cannot be previewed");
});

const roots = process.argv.slice(2);
assert.ok(roots.length, "Supply Red/Yellow fixture directories.");
for (const root of roots) test(`${root}: source animation graph, engine hooks, aliases, assignments and unsupported data`, async () => {
  const { source, overrides } = fixture(root), graphics = await loadGraphicsCatalog(source);
  const catalog = await loadBattleAnimationCatalog(source, graphics);
  assert.equal(catalog.moves.length, 165);
  assert.ok(catalog.scripts.length > 190, "non-move status and ball animations are included");
  assert.equal(catalog.subanimations.length, 86); assert.equal(catalog.blocks.length, 122);
  assert.equal(catalog.effects.length, 39); assert.equal(catalog.sheets.length, 3);
  assert.deepEqual(catalog.warnings, []);
  for (const script of catalog.scripts) assert.deepEqual(script.warnings, [], script.label);
  for (const sub of catalog.subanimations) assert.deepEqual(sub.warnings, [], sub.label);
  for (const block of catalog.blocks) assert.deepEqual(block.warnings, [], block.label);
  for (const move of catalog.moves) assert.equal(move.animationLabel, catalog.scripts.find(script => script.id === move.animationId)?.label, move.name);
  const thunderPunch = catalog.scripts.find(script => script.label === "ThunderPunchAnim")!;
  assert.deepEqual(thunderPunch.steps.map(step => step.kind), ["subanimation", "effect", "subanimation", "effect"]);
  assert.deepEqual(thunderPunch.steps.map(step => step.sheetId), [0, null, 1, null]);
  assert.equal(thunderPunch.steps[0].delay, 6);
  assert.equal(catalog.effects.find(effect => effect.constant === "SE_SHAKE_SCREEN")!.routine, "AnimationShakeScreen");
  const rockSlide = catalog.moves.find(move => move.constant === "ROCK_SLIDE")!;
  assert.equal(catalog.hooks.find(hook => hook.animationId === rockSlide.animationId)?.routine, "DoRockSlideSpecialEffects");
  assert.ok(catalog.hooks.find(hook => hook.constant === "ROCK_SLIDE")?.routineSource?.text.includes(".shakeScreen"));
  assert.equal(catalog.impacts.length, 6);
  assert.ok(catalog.engineNotes.some(source => source.text.includes("cp AMNESIA") && source.text.includes("cp REST")));
  const pound = catalog.scripts.find(script => script.label === "PoundAnim")!, struggle = catalog.scripts.find(script => script.label === "StruggleAnim")!;
  assert.deepEqual(pound.steps, struggle.steps, "consecutive aliases resolve to the same commands");
  assert.equal(catalog.sheets[0].path, "gfx/battle/move_anim_0.png");
  assert.equal(catalog.sheets[2].path, catalog.sheets[0].path, "trade sheet aliases are preserved");

  // A changed assignment must resolve through its constant, not the move's row index.
  const moves = await source.readText("data/moves/moves.asm");
  overrides.set("data/moves/moves.asm", moves.replace(/(\bmove\s+)POUND\b/, "$1PSYCHIC_M"));
  const reassigned = await parseMoves(source);
  assert.equal(reassigned[0].animation, "PSYCHIC_M"); assert.equal(reassigned[0].animationLabel, "PsychicAnim");
  // Unsupported commands are visible and stop parsing instead of inventing a partial animation.
  const animations = await source.readText("data/moves/animations.asm");
  overrides.set("data/moves/animations.asm", animations.replace("battle_anim POUND, SUBANIM_0_STAR_TWICE, 0, 8", "custom_animation_command 7"));
  const changed = await loadBattleAnimationCatalog(source, graphics);
  assert.equal(changed.scripts[0].steps[0].kind, "unknown"); assert.ok(changed.scripts[0].warnings.length);
  overrides.set("data/moves/animations.asm", animations.replace("dw PoundAnim", "IF DEF(CUSTOM_ANIMATION)\n\tdw PoundAnim\n\tENDC"));
  const conditional = await loadBattleAnimationCatalog(source, graphics);
  assert.deepEqual(conditional.scripts, [], "conditional pointer offsets must not be guessed");
  assert.ok(conditional.warnings.some(warning => warning.includes("unsupported pointer-table structure")));
});
