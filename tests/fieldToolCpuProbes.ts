import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fieldRoutine, renderFieldTools, defaultFieldTool } from "../src/core/fieldTools";

// Native collision, cut-block replacement, inventory removal and bank switching.
// Screen drawing, audio, sprite lookup and Fly-menu input are instrumented here;
// the browser and full-game controller suites cover the menu/render boundaries.
export async function fieldToolCpuProbes(root: string, rgbds: string, binjgb: string, run: (cmd: string, args: string[], cwd?: string) => string) {
  const paths = ["engine/items/item_effects.asm", "engine/overworld/cut.asm", "engine/overworld/field_move_messages.asm", "data/tilesets/escape_rope_tilesets.asm", "data/maps/special_warps.asm", "home/overworld.asm"];
  const files = new Map(await Promise.all(paths.map(async p => [p, await readFile(join(root, p), "utf8")] as const)));
  const effects = files.get(paths[0])!, model = JSON.parse(effects.match(/^; yellow-editor-field-tools: (.+)$/m)![1]);
  const gated = structuredClone(model.tools.find((t: { constant: string }) => t.constant === "TEST_SURF"));
  gated.constant = "TEST_GATED_SURF"; model.tools.push(gated);
  model.tools.find((t: { constant: string }) => t.constant === "TEST_SURF").values = defaultFieldTool();
  model.tools.find((t: { constant: string }) => t.constant === "TEST_FLY").values.consume = true;
  const runtime = renderFieldTools(model, files).replace('SECTION "Editor field tools", ROMX', 'SECTION "Editor field tools", ROMX, BANK[2]');
  const target = model.yellow ? "pokeyellow" : "pokered", nativeSymbols = await readFile(join(root, `${target}.sym`), "utf8");
  const vars = [...nativeSymbols.matchAll(/^00:([c-f][0-9a-f]{3}) ([wh]\w+)$/gm)].map(m => `DEF ${m[2]} EQU $${m[1]}`);
  const set = (p: string, v: string | number) => [`ld a, ${v}`, `ld [${p}], a`];
  const driver: string[] = [], expected: string[] = []; let result = 0xc900;
  function observe(address: string, value: number) { driver.push(`ld a, [${address}]`, `ld [$${result.toString(16)}], a`); expected.push(`${(result++).toString(16)}=${value.toString(16)}`); }
  function reset() {
    driver.push(...set("wCurMap", "PALLET_TOWN"), ...set("wCurMapTileset", "OVERWORLD"), ...set("wObtainedBadges", 0), ...set("wPartyCount", 0), ...set("wNumHoFTeams", 0), ...set("wIsInBattle", 0), ...set("wLinkState", 0), ...set("wWalkBikeSurfState", 0), ...set("wStatusFlags1", 0), ...set("wStatusFlags4", 0), ...set("wStatusFlags5", 0), ...set("wStatusFlags6", 0), ...set("wMapPalOffset", 6), ...set("wTileInFrontOfPlayer", "$14"), ...set("wTilePlayerStandingOn", 0), ...set("wLastBlackoutMap", "PALLET_TOWN"), ...set("wProbeCancel", 0), ...set("wProbeSprite", 0), ...set("wProbeBlockedTile", 0), ...set("wPlayerDirection", "1 << PLAYER_DIR_BIT_RIGHT"), ...set("wWhichPokemon", 0), ...set("wNumBagItems", 2), ...set("wBagItems", "TEST_DIG"), ...set("wBagItems + 1", 3), ...set("wBagItems + 2", "POTION"), ...set("wBagItems + 3", 5), ...set("wBagItems + 4", 255));
  }
  function use(item: string) { driver.push(...set("wCurItem", item), "farcall EditorFieldToolUse"); }
  // No badges and an empty party: the native effect still succeeds.
  reset(); use("TEST_FLASH"); observe("wMapPalOffset", 0); observe("wActionResultOrTookBattleTurn", 1); observe("wPartyCount", 0);
  use("TEST_FLASH"); observe("wActionResultOrTookBattleTurn", 0);
  reset(); use("TEST_STRENGTH"); observe("wStatusFlags1", 1); observe("wActionResultOrTookBattleTurn", 1);
  use("TEST_STRENGTH"); observe("wActionResultOrTookBattleTurn", 0);
  reset(); use("TEST_SURF"); observe("wWalkBikeSurfState", 2); observe("wActionResultOrTookBattleTurn", 1); observe("wSimulatedJoypadStatesIndex", 1);
  // Collision pairs, occupied dismount tiles and successful dismount.
  reset(); driver.push(...set("wCurMapTileset", "CAVERN"), ...set("wTilePlayerStandingOn", "$05")); use("TEST_SURF"); observe("wWalkBikeSurfState", 0); observe("wActionResultOrTookBattleTurn", 0);
  reset(); driver.push(...set("wWalkBikeSurfState", 2), ...set("wProbeSprite", 1)); use("TEST_SURF"); observe("wWalkBikeSurfState", 2); observe("wActionResultOrTookBattleTurn", 0);
  driver.push(...set("wProbeSprite", 0), ...set("wTileInFrontOfPlayer", "$10"), ...set("wTilesetCollisionPtr", "LOW($c840)"), ...set("wTilesetCollisionPtr + 1", "HIGH($c840)"), ...set("$c840", "$10"), ...set("$c841", 255)); use("TEST_SURF"); observe("wWalkBikeSurfState", 0); observe("wActionResultOrTookBattleTurn", 1);
  // Cut changes the actual native block pair, without reading a party nickname.
  reset(); driver.push(...set("wTileInFrontOfPlayer", "$3d"), ...set("wCurMapWidth", 10), ...set("wCurrentTileBlockMapViewPointer", "LOW($c800)"), ...set("wCurrentTileBlockMapViewPointer + 1", "HIGH($c800)"), ...set("wSpritePlayerStateData1FacingDirection", "SPRITE_FACING_DOWN"), ...set("wYBlockCoord", 0), ...set("wXBlockCoord", 0), ...set("$c822", "$32")); use("TEST_CUT"); observe("$c822", 0x6d); observe("wActionResultOrTookBattleTurn", 1);
  reset(); use("TEST_CUT"); observe("wActionResultOrTookBattleTurn", 0);
  // Consumables remove exactly one from the original bag slot, only on success.
  reset(); driver.push(...set("wCurMapTileset", "CAVERN")); use("TEST_DIG"); observe("wBagItems + 1", 2); observe("wBagItems + 3", 5); observe("wActionResultOrTookBattleTurn", 1);
  reset(); use("TEST_DIG"); observe("wBagItems + 1", 3); observe("wActionResultOrTookBattleTurn", 0);
  reset(); use("TEST_TELEPORT"); observe("wActionResultOrTookBattleTurn", 1); observe("wStatusFlags6", 0x48);
  reset(); driver.push(...set("wCurMapTileset", "CAVERN")); use("TEST_TELEPORT"); observe("wActionResultOrTookBattleTurn", 0);
  reset(); driver.push(...set("wLastBlackoutMap", "$ff")); use("TEST_TELEPORT"); observe("wActionResultOrTookBattleTurn", 0);
  // Fly's temporary destination expansion restores the exact visited-town bits.
  reset(); driver.push(...set("wBagItems", "TEST_FLY"), ...set("wTownVisitedFlag", 1), ...set("wTownVisitedFlag + 1", 0), ...set("wProbeCancel", 1)); use("TEST_FLY"); observe("wActionResultOrTookBattleTurn", 0); observe("wTownVisitedFlag", 1); observe("wTownVisitedFlag + 1", 0); observe("wBagItems + 1", 3);
  driver.push(...set("wProbeCancel", 0)); use("TEST_FLY"); observe("wActionResultOrTookBattleTurn", 1); observe("wTownVisitedFlag", 1); observe("wTownVisitedFlag + 1", 0); observe("wBagItems + 1", 2);
  // Per-map permissions include overrides to native outdoor checks.
  reset(); driver.push(...set("wCurMap", "ROCK_TUNNEL_B1F"), ...set("wCurMapTileset", "CAVERN")); use("TEST_FLASH"); observe("wActionResultOrTookBattleTurn", 1);
  use("TEST_STRENGTH"); observe("wActionResultOrTookBattleTurn", 0); use("TEST_SURF"); observe("wWalkBikeSurfState", 0); use("TEST_CUT"); observe("wActionResultOrTookBattleTurn", 0); use("TEST_DIG"); observe("wBagItems + 1", 3);
  use("TEST_TELEPORT"); observe("wActionResultOrTookBattleTurn", 1);
  reset(); driver.push(...set("wCurMap", "ROCK_TUNNEL_B1F"), ...set("wCurMapTileset", "CAVERN")); use("TEST_FLY"); observe("wActionResultOrTookBattleTurn", 1);
  // Badge, actual move knowledge and the reusable player-condition predicate.
  reset(); use("TEST_GATED_SURF"); observe("wActionResultOrTookBattleTurn", 0);
  driver.push(...set("wObtainedBadges", "1 << BIT_SOULBADGE")); use("TEST_GATED_SURF"); observe("wActionResultOrTookBattleTurn", 0);
  driver.push(...set("wPartyCount", 1), ...set("wPartyMon1Moves", "SURF")); use("TEST_GATED_SURF"); observe("wActionResultOrTookBattleTurn", 0);
  driver.push(...set("wNumHoFTeams", 1)); use("TEST_GATED_SURF"); observe("wActionResultOrTookBattleTurn", 1);
  reset(); driver.push(...set("wIsInBattle", 1)); use("TEST_STRENGTH"); observe("wStatusFlags1", 0); observe("wActionResultOrTookBattleTurn", 0);
  reset(); driver.push(...set("wLinkState", 1)); use("TEST_TELEPORT"); observe("wStatusFlags6", 0); observe("wActionResultOrTookBattleTurn", 0);
  const fn = async (p: string, label: string, next?: string) => `${label}:\n` + fieldRoutine(await readFile(join(root, p), "utf8"), label, next);
  const arrays = await readFile(join(root, "home/array2.asm"), "utf8");
  const bank = model.yellow ? await readFile(join(root, "home/bankswitch2.asm"), "utf8") : await fn("home/bankswitch.asm", "Bankswitch");
  const outside = await fn("home/overworld.asm", "CheckIfInOutsideMap", "ExtraWarpCheck");
  const pairs = await fn("home/overworld.asm", "CheckForTilePairCollisions", "LoadCurrentMapView");
  const shore = await fn("engine/items/item_effects.asm", "IsNextTileShoreOrWater");
  const replace = await fn("engine/overworld/cut.asm", "ReplaceTreeTileBlock");
  const removeWrapper = await fn("home/inventory.asm", "RemoveItemFromInventory");
  const remove = await fn("engine/items/item_effects.asm", "RemoveUsedItem", "ItemUseNoEffect");
  const inventory = await readFile(join(root, "engine/items/inventory.asm"), "utf8");
  const asm = ['INCLUDE "includes.asm"', ...vars, "DEF SFX_Cut_1 EQU 0", "DEF SFX_Headers_1 EQU 0", "DEF TEST_GATED_SURF EQU $70", "DEF wProbeCancel EQU $cff0", "DEF wProbeSprite EQU $cff1", "DEF wProbeBlockedTile EQU $cff2", 'SECTION "Header", ROM0[$100]', "jp Entry", "ds $150 - @, 0", 'SECTION "Home", ROM0[$150]', "Entry:", "di", "ld sp, $dfff", "ld hl, $c000", "ld bc, $2000", ".clear", "xor a", "ld [hli], a", "dec bc", "ld a, b", "or c", "jr nz, .clear", "ld a, 2", "ldh [hLoadedROMBank], a", "ld [rROMB], a", "jp ProbeEntry", bank, outside, pairs, arrays.slice(arrays.indexOf("IsInArray::")),
    "IsSpriteInFrontOfPlayer2:", "ld a, [wProbeSprite]", "ldh [hSpriteIndex], a", "ld hl, $cff8", "ret", "IsTilePassable:", "ld a, [wProbeBlockedTile]", "and a", "ret z", "scf", "ret", "ChooseFlyDestination:", "ld a, [wProbeCancel]", "and a", "ret nz", "ld hl, wStatusFlags6", "set BIT_FLY_WARP, [hl]", "ret", removeWrapper, "PrintText:", "ld a, l", "ld [$cffc], a", "ld a, h", "ld [$cffd], a", "ret",
    ...["GetItemName", "CopyToStringBuffer", "RestoreScreenTilesAndReloadTilePatterns", "LoadFontTilePatterns", "LoadGBPal", "LoadWalkingPlayerSpriteGraphics", "Func_1510", "PlayDefaultMusic", "GBPalWhiteOutWithDelay3", "ClearSprites", "Delay3", "LoadCurrentMapView", "SaveScreenTilesToBuffer2", "LoadScreenTilesFromBuffer2", "PlaySound", "UpdateSprites", "ArePlayerCoordsInArray"].map(f => `${f}:\nret`),
    'SECTION "Native bank", ROMX, BANK[1]', shore, replace, remove, inventory, "InitCutAnimOAM:", "RedrawMapView:", "AnimCut:", "ret", runtime,
    'SECTION "Probe", ROMX, BANK[2]', "ProbeEntry:", ...driver, "jp ProbeDone", 'SECTION "Stop", ROMX[$7ff0], BANK[2]', "ProbeDone:", "halt", "jr ProbeDone"].join("\n");
  const file = join(root, "field-probe.asm"), obj = join(root, "field-probe.o"), rom = join(root, "field-probe.gb"), sym = join(root, "field-probe.sym"), cpu = join(root, "field-cpu");
  await writeFile(file, asm);
  run("cc", ["-std=gnu11", "-O2", `-I${join(binjgb, "src")}`, resolve("tests/scriptRuntimeProbe.c"), ...["memory.c", "common.c", "emulator-debug.c"].map(f => join(binjgb, "src", f)), "-lm", "-o", cpu]);
  run(join(rgbds, "rgbasm"), ["-I", `${root}/`, "-o", obj, file]); run(join(rgbds, "rgblink"), ["-n", sym, "-o", rom, obj]); run(join(rgbds, "rgbfix"), ["-v", "-p", "0", "-m", "0x19", rom]);
  run(cpu, [rom, "7ff0", ...expected]);
  console.log(`Field tools: ${expected.length} native banked CPU assertions passed`);
}
