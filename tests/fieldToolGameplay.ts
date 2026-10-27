import assert from "node:assert/strict";
import { readFile, readdir, stat, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createProjectSession } from "../src/core/project";
import { parseItemConstantDefinitions } from "../src/core/itemConstants";
import { defaultFieldTool } from "../src/core/fieldTools";
import type { ProjectSource, HistoryState } from "../src/core/types";

// Fixture-only new game setup. Item menus, action routines, text, collisions,
// travel and input cleanup run unmodified through ordinary controller input.
export async function fieldToolGameplayProbes(root: string, rgbds: string, binjgb: string, run: (cmd: string, args: string[], cwd?: string) => string) {
  async function listFiles(folder = ""): Promise<string[]> { return (await Promise.all((await readdir(join(root, folder), { withFileTypes: true })).filter(e => !e.name.startsWith(".") && !e.name.startsWith("field-probe")).map(e => e.isDirectory() ? listFiles(join(folder, e.name)) : [join(folder, e.name)]))).flat(); }
  let history: HistoryState | null = null;
  const source: ProjectSource = { storageKey: root, displayPath: root, listFiles, historyStore: { persistent: false, load: async () => history, save: async h => { history = structuredClone(h); } }, readText: p => readFile(join(root, p), "utf8"), readBytes: async p => p.endsWith(".2bpp") ? new Uint8Array(4096) : new Uint8Array(await readFile(join(root, p))), exists: async p => p.endsWith(".png") ? false : p.endsWith(".2bpp") ? true : stat(join(root, p)).then(() => true, () => false), writeText: async (p, text) => { await writeFile(join(root, p), text); }, writeBytes: async (p, b) => { await writeFile(join(root, p), b); }, createFile: async (p, b) => { if (await source.exists(p)) throw new Error("Already exists"); await writeFile(join(root, p), b); }, removeFile: async p => { await rm(join(root, p)); }, assetUrl: async () => null };
  const session = await createProjectSession(source, {} as never);
  const definitions = parseItemConstantDefinitions(await source.readText("constants/item_constants.asm"));
  const surf = await session.getItemEditDocument(definitions.find(d => d.constant === "TEST_SURF")!.id);
  await session.saveItemEdit(surf, { ...surf, fieldTool: defaultFieldTool() });
  const creation = await session.getMapCreateDocument("ROCK_TUNNEL_B1F");
  await session.createMap(creation, { constant: "FIELD_TOOL_TEST", width: 4, height: 4, layout: "blank", fillBlock: 10, borderBlock: 10, musicMap: "PALLET_TOWN", locationMap: "PALLET_TOWN", connection: null });
  const header = "data/maps/headers/FieldToolTest.asm";
  await source.writeText!(header, (await source.readText(header)).replace(/\bCAVERN\b/, "OVERWORLD"));
  const blocks = new Uint8Array(16).fill(10); blocks[1] = 30; blocks[5] = 0x32;
  await source.writeBytes!("maps/FieldToolTest.blk", blocks);
  const props = await session.getMapPropertiesDocument("FIELD_TOOL_TEST");
  await session.saveMapProperties(props, { ...props.values, flash: true, strength: true, cut: true, surf: true, fly: true, teleport: true, escape: true, lighting: "dark" });
  const patch = async (p: string, f: (s: string) => string) => source.writeText!(p, f(await source.readText(p)));
  await patch("scripts/FieldToolTest.asm", s => s.replace("FieldToolTest_Script:\n", "FieldToolTest_Script:\n\tld a, [wUnusedPlayerDataByte]\n\tbit 7, a\n\tjr nz, .ready\n\tset 7, a\n\tld [wUnusedPlayerDataByte], a\n\tld a, 6\n\tld [wMapPalOffset], a\n.ready\n"));
  await patch("data/maps/special_warps.asm", s => s.replace("special_warp_spec REDS_HOUSE_2F, 3, 6, REDS_HOUSE_2", "special_warp_spec FIELD_TOOL_TEST, 1, 3, OVERWORLD"));
  const setup = ["OakSpeech:", "\tcall PrepareOakSpeech", "\tpredef InitPlayerData2", "\tld a, [FieldToolSmokeMode]", "\tld [wUnusedPlayerDataByte], a", "\tld c, a", "\tld b, 0", "\tld hl, FieldToolSmokeItems", "\tadd hl, bc", "\tld a, [hl]", "\tld [wBagItems], a", "\tld a, 3", "\tld [wBagItems + 1], a", "\tld a, $ff", "\tld [wBagItems + 2], a", "\tld a, 1", "\tld [wNumBagItems], a", "\tld [wTownVisitedFlag], a", "\txor a", "\tld [wTownVisitedFlag + 1], a", "\tld [wObtainedBadges], a", "\tld hl, FieldToolSmokeName", "\tld de, wPlayerName", "\tld bc, 4", "\tcall CopyData", "\tld a, $c1", "\tld [wOptions], a", "\tld a, VIRIDIAN_CITY", "\tld [wDestinationMap], a", "\tcall PrepareForSpecialWarp", "\tld a, VIRIDIAN_CITY", "\tld [wLastMap], a", "\tld [wLastBlackoutMap], a", "\tcall LoadTextBoxTilePatterns", "\tld a, 1", "\tld [wUpdateSpritesEnabled], a", "\tret", "FieldToolSmokeMode::", "\tdb 0", "FieldToolSmokeItems:", "\tdb TEST_FLASH, TEST_STRENGTH, TEST_SURF, TEST_CUT, TEST_FLY, TEST_FLY, TEST_DIG, TEST_TELEPORT", "FieldToolSmokeName:", '\tdb "RED@"', ""].join("\n");
  await patch("engine/movie/oak_speech/oak_speech.asm", s => { const a = s.indexOf("\nOakSpeech:\n") + 1, b = s.indexOf("OakSpeechText1:", a); assert.ok(a && b > a); return s.slice(0, a) + setup + s.slice(b); });
  const target = (await source.exists("scripts/OaksLab_2.asm")) ? "pokeyellow" : "pokered";
  run("make", ["-j2", `RGBDS=${rgbds}/`, `${target}.gbc`]);
  const cpu = join(root, "field-gameplay");
  run("cc", ["-std=gnu11", "-O2", `-I${join(binjgb, "src")}`, resolve("tests/fieldToolGameplayProbe.c"), ...["memory.c", "common.c", "emulator-debug.c"].map(f => join(binjgb, "src", f)), "-lm", "-o", cpu]);
  for (const mode of (process.env.FIELD_TOOL_MODES ? process.env.FIELD_TOOL_MODES.split(",").map(Number) : [0, 1, 2, 3, 4, 5, 6, 7])) {
    const [x, y] = mode === 2 ? [1, 1] : mode === 3 ? [3, 3] : [1, 3];
    console.log(run(cpu, [join(root, `${target}.gbc`), join(root, `${target}.sym`), String(mode), creation.nextId.toString(16), String(x), String(y), "4", join(root, `field${mode}.rgba`)]));
  }
}
