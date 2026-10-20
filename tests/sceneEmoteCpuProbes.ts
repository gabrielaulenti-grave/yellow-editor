import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { renderScene } from "../src/core/interactionScene";
import { projectConstantCatalogFromSources } from "../src/core/projectConstants";
import type { ManagedInteraction } from "../src/core/scriptInteractions";

// Execute the generated warp-start scene with the actual native EmotionBubble
// instructions. Hardware services are observed at their boundary: copied glyph,
// OAM placement, 60-frame hold, sprite-update restoration and redraw.
export async function sceneEmoteCpuProbes(root: string, temporary: string, rgbds: string, cpu: string,
  run: (cmd: string, args: string[], cwd?: string) => string, model: ManagedInteraction, events: string, entry: string) {
  const p = model.prefix, plan = model.scene!, actor = plan.actors.find(actor => plan.nodes.some(node => node.action?.kind === "emote" && node.action.npc === actor.constant))!;
  const actions = model.values.actions!.filter(action => action.kind === "emote");
  const native = (await readFile(join(root, "engine/overworld/emotion_bubbles.asm"), "utf8")).replace("vChars1 tile $78", "$8780");
  const code = renderScene(model).split(`; yellow-editor-interaction-code-end ${model.label}`)[0]
    .replaceAll("\ttext_asm", "\tdb 8").replaceAll("\ttext_promptbutton", "\tdb 0").replaceAll("\ttext_end", "\tdb 0").replaceAll("\tpredef ", "\tcall ");
  const hook = entry.match(/\t; yellow-editor-scene-map-entry-hook\n([\s\S]*?)\t; yellow-editor-scene-map-entry-hook-end/)![1];
  const files = await Promise.all((await readdir(join(root, "constants"))).filter(path => path.endsWith(".asm")).map(async path => ({ path: `constants/${path}`, contents: await readFile(join(root, "constants", path), "utf8") })));
  const constants = new Map(projectConstantCatalogFromSources(files).constants.map(entry => [entry.symbol, entry.value]));
  constants.set(plan.mapConstant, 0);
  const vars = new Map<string, number>([["wEventFlags", 0xc800], ["wCurMap", 0xc020], ["wSpritePlayerStateData1YPixels", 0xc500],
    ["wShadowOAMSprite35Attributes", 0xc38f], ["wShadowOAMSprite39Attributes", 0xc39f], ["wShadowOAMSprite31Attributes", 0xc37f]]);
  let address = 0xc100, high = 0xff90;
  for (const match of (code + native + hook).matchAll(/\b([wh][A-Z]\w*)\b/g)) if (!vars.has(match[1])) {
    const name = match[1];
    vars.set(name, name.startsWith("h") ? high++ : address);
    if (!name.startsWith("h")) address += name === "wMapSpriteData" ? 32 : /wEditorScene(?:Directions|Movements|Visibility)$/.test(name) ? 14 : 1;
  }
  const defs = [...vars].map(([name, value]) => `DEF ${name} EQU $${value.toString(16)}`);
  for (const name of new Set([...(code + native + hook).matchAll(/\b[A-Z][A-Z0-9_]+\b/g)].map(match => match[0]))) {
    if (constants.has(name) && !name.startsWith("EVENT_")) defs.push(`DEF ${name} EQU ${constants.get(name)}`);
  }
  const set = (name: string, value: number) => [`ld a, ${value}`, `ld [${name}], a`];
  const check = (name: string, value: number) => `${vars.get(name)!.toString(16)}=${value.toString(16)}`;
  const nativeTable = (await readFile(join(root, "home/array2.asm"), "utf8")).split("IsInArray::")[0];
  const stubs = [
    "CopyVideoData:", "ld a, c", "ld [$c010], a", "ld a, [de]", "ld [$c011], a", "ret",
    "WriteOAMBlock:", "ld a, b", "ld [$c012], a", "ld a, c", "ld [$c013], a", "ret",
    "DelayFrames:", "ld a, c", "ld [$c014], a", "ld hl, $c015", "inc [hl]", "ld a, [wUpdateSpritesEnabled]", "ld [$c016], a", "ret",
    "UpdateSprites:", "ld hl, $c017", "inc [hl]", "ret", "DelayFrame:", "ret",
    "IsObjectHidden:", "ld a, [$c019]", "ldh [hIsToggleableObjectOff], a", "ret",
    "PrintText:", "TextScriptEnd:", "ret",
    `${p}Original:\ndb 0`, `${p}AlreadyText:\ndb 0`, `${p}BagFullText:\ndb 0`,
  ];
  for (const scenario of ["arrival", "reentry", "hidden", "unloaded", "walking"]) {
    const setup = ["di", "ld sp, $dfff", "ld hl, $c000", "ld bc, $1000", ".clear", "xor a", "ld [hli], a", "dec bc", "ld a, b", "or c", "jr nz, .clear",
      ...set("wXCoord", model.values.scene!.playerX), ...set("wYCoord", model.values.scene!.playerY), ...set("wCurMap", constants.get(plan.mapConstant)!),
      ...set("wJoyIgnore", 0x12), ...set("wOverrideSimulatedJoypadStatesMask", 0x34), ...set("wStatusFlags4", 5), ...set("wUpdateSpritesEnabled", 1),
      ...set("$c500 + " + actor.id * 16, 48), ...set("$c502 + " + actor.id * 16, 64),
      ...set("$c019", scenario === "hidden" ? 1 : 0), ...set("wWalkCounter", scenario === "walking" ? 1 : 0)];
    for (const a of plan.actors) {
      for (const [field, value] of [["StateData2MapX", a.x + 4], ["StateData2MapY", a.y + 4], ["StateData1PictureID", scenario === "unloaded" && a.id === actor.id ? 0 : 1]] as const) {
        const name = `wSprite${String(a.id).padStart(2, "0")}${field}`;
        if (vars.has(name)) setup.push(...set(name, value));
      }
    }
    const tick = [`call ${p}SceneFrame`];
    const runScene = ["ld b, 25", ".frames", "push bc", ...tick, "pop bc", "dec b", "jr nz, .frames"];
    const reentry = scenario === "reentry" ? ["call MapEntry", "ld b, 25", ".again", "push bc", ...tick, "pop bc", "dec b", "jr nz, .again"] : [];
    const asm = ['INCLUDE "macros/const.asm"', 'INCLUDE "macros/code.asm"', ...defs, events, await readFile(join(root, "macros/scripts/events.asm"), "utf8"),
      'SECTION "Header", ROM0[$100]', "jp Entry", "ds $150 - @, 0", 'SECTION "Code", ROM0[$150]', "Entry:", ...setup,
      ...runScene, ...reentry, "ProbeDone:", "halt", "jr ProbeDone", "MapEntry:", hook, "ret", nativeTable, code, native, ...stubs].join("\n");
    const file = join(temporary, "emote-probe.asm"), obj = join(temporary, "emote-probe.o"), rom = join(temporary, "emote-probe.gb"), sym = join(temporary, "emote-probe.sym");
    await writeFile(file, asm); run(join(rgbds, "rgbasm"), ["-I", `${root}/`, "-o", obj, file]);
    run(join(rgbds, "rgblink"), ["-n", sym, "-o", rom, obj]); run(join(rgbds, "rgbfix"), ["-v", "-p", "0", rom]);
    const stop = (await readFile(sym, "utf8")).match(/^00:([0-9a-f]+) ProbeDone$/mi)![1];
    const successful = scenario === "arrival" || scenario === "reentry";
    const checks = [check("wEditorSceneActive", 0), check("wJoyIgnore", 0x12), check("wOverrideSimulatedJoypadStatesMask", 0x34), check("wStatusFlags4", 5), check("wUpdateSpritesEnabled", 1),
      check("wXCoord", model.values.scene!.playerX), check("wYCoord", model.values.scene!.playerY), `c015=${(successful ? actions.length * (scenario === "reentry" ? 2 : 1) : 0).toString(16)}`];
    if (successful) {
      checks.push("c010=4", "c012=30", "c013=48", "c014=3c", "c016=ff", check("wEmotionBubbleSpriteIndex", actor.id), check("wWhichEmotionBubble", actions.length - 1));
      const lastGraphic = actions.length === 8 ? "fish" : "happy";
      const glyph = await readFile(join(root, `gfx/emotes/${lastGraphic}.2bpp`));
      checks.push(`c011=${glyph[0].toString(16)}`);
    }
    run(cpu, [rom, stop, ...checks]);
  }
  assert.equal(actions.length, native.includes("SkullEmote:") ? 8 : 3);
  console.log(`Native emotion bubbles: ${actions.length} glyphs, arrival-warp start, reentry rearming, hidden/unloaded actors and walking guard passed`);
}
