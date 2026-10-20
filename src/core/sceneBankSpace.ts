import { hashText } from "./history";
import type { InteractionInspection } from "./scriptInteractions";

const path = "engine/overworld/hidden_events.asm";
const begin = '; yellow-editor-scene-bank-space: 1\nPUSHS\nSECTION "Editor Scene Hidden Event Lookup", ROMX\n';
const end = '\nPOPS\n; yellow-editor-scene-bank-space-end\n';
const normalize = (text: string) => text.replace(/\r\n/g, "\n");
const code = (text: string) => normalize(text).split("\n").map(line => line.split(";", 1)[0].trim()).filter(Boolean).join("\n");

// Yellow's bank $11 is also almost full of map objects. Pokedex rating is
// reached through the native bank-aware predef table; keep its private data
// together in a floating section while leaving dungeon-warp callers in place.
export async function prepareSharedSceneBankSpace(state: InteractionInspection, changed: Map<string, string>) {
  if (!state.byPath.has("scripts/OaksLab_2.asm")) return;
  const path = "engine/events/pokedex_rating.asm", original = state.byPath.get(path);
  const begin = '; yellow-editor-shared-scene-bank-space: 1\nPUSHS\nSECTION "Editor Shared Scene Pokedex Rating", ROMX\n';
  const end = '\nPOPS\n; Keep the native layout section present.\n\tdb 0\n; yellow-editor-shared-scene-bank-space-end\n';
  const text = normalize(original ?? ""), upgraded = text.startsWith(begin) && text.endsWith(end);
  const restored = upgraded ? text.slice(begin.length, -end.length) : text;
  const dataMacros = code(state.byPath.get("macros/data.asm") ?? "");
  if (await hashText(code(restored)) !== "91083824871364eb4e00f1d4adb5238ec3ecd19a8c147fed4025b4c305e51551"
    || await hashText(code(state.byPath.get("home/predef.asm") ?? "")) !== "83da5be79497075cb0272f673c5402969057e74569ef3dae5c0f0121c6feb150"
    || !dataMacros.includes("MACRO? dba\nREPT _NARG\ndbw BANK(\\1), \\1\nSHIFT\nENDR\nENDM") || !dataMacros.includes("MACRO? dbw\ndb \\1\ndw \\2\nENDM")
    || !/MACRO add_predef\n\\1Predef::\n\s*IF _NARG == 1\n\s*dba \\1\n\s*ELSE\n\s*dbw \\2, \\1\n\s*ENDC\nENDM/.test(normalize(state.byPath.get("data/predef_pointers.asm") ?? ""))) throw new Error("Linked scenes need the reviewed Yellow Pokedex rating and bank-aware predef dispatcher to free map-data space.");
  const labels = [...restored.matchAll(/^([A-Za-z_]\w*):/gm)].map(match => match[1]);
  const references = new RegExp(`\\b(?:${labels.join("|")})\\b`);
  for (const file of state.files) {
    if (file.path === path) continue;
    let contents = code(file.contents);
    if (/SECTION\s+"Editor Shared Scene Pokedex Rating"/.test(contents)) throw new Error("The shared-scene bank section name is already used by another file.");
    if (["scripts/OaksLab.asm", "engine/menus/oaks_pc.asm", "engine/movie/hall_of_fame.asm"].includes(file.path)) contents = contents.replace(/^predef DisplayDexRating$/gm, "");
    if (file.path === "data/predef_pointers.asm") contents = contents.replace(/^add_predef DisplayDexRating$/gm, "");
    if (references.test(contents)) throw new Error(`Cannot move Pokedex rating: ${file.path} contains an unreviewed reference.`);
  }
  if (!upgraded) changed.set(path, (begin + restored + end).replace(/\n/g, original?.includes("\r\n") ? "\r\n" : "\n"));
}

// Red's map bank $11 shares its remaining space with hidden-event lookup data.
// Only the dungeon-warp entry has same-bank callers. The lookup and its tables
// can move together: the ROM0 dispatcher explicitly selects BANK(CheckForHiddenEvent).
// Yellow already separates dungeon warps, so its layout is left untouched.
export async function prepareSceneBankSpace(state: InteractionInspection, changed: Map<string, string>) {
  const original = state.byPath.get(path);
  if (!original || !/^IsPlayerOnDungeonWarp::/m.test(original)) return;
  const text = normalize(original), upgraded = text.includes(begin);
  if (text.includes("yellow-editor-scene-bank-space") && (!upgraded || text.split(begin).length !== 2 || text.split(end).length !== 2)) {
    throw new Error("The scene bank-space section was changed in source. Review it before saving.");
  }
  const restored = upgraded ? text.replace(begin, "").replace(end, "") : text;
  if (await hashText(code(restored)) !== "afc8453b98455fa6624f9d8048dcd0c65739217532964e841ae605bad61eea69"
    || await hashText(code(state.byPath.get("home/hidden_events.asm") ?? "")) !== "392907e22b3484d0dfb0190608ef66d320bb6d4e91f5c1a376ed2fbf18006703") {
    throw new Error("Scene bank allocation needs the reviewed hidden-event lookup and bank-switching dispatcher. Their source differs.");
  }
  const main = normalize(state.byPath.get("main.asm") ?? "");
  if (!/^SECTION "Hidden Events Core", ROMX\n\s*INCLUDE "engine\/overworld\/hidden_events\.asm"\s*(?=SECTION|$)/m.test(main)) {
    throw new Error("Scene bank allocation needs the reviewed Hidden Events Core include section.");
  }
  if (state.files.some(file => /SECTION\s+"Editor Scene Hidden Event Lookup"/.test(file.contents) && file.path !== path)) {
    throw new Error("The scene lookup section name is already used by another source file.");
  }
  const dataPath = "data/events/hidden_events.asm", data = state.byPath.get(dataPath) ?? "";
  if (await hashText(code(data)) !== "b2a6c7b97cdf58e3c86facca11e66da945f118988d718eb0c3820b36ea123162") {
    throw new Error("Scene bank allocation needs the reviewed hidden-event tables. Their source differs.");
  }
  const labels = new Set([
    "CheckForHiddenEvent", "CheckIfCoordsInFrontOfPlayerMatch", "HiddenEventMaps", "HiddenEventPointers",
    ...[...data.matchAll(/^\s*hidden_events_for\s+(\w+)/gm)].map(match => `HiddenEventsFor_${match[1]}`),
  ]);
  const references = new RegExp(`\\b(?:${[...labels].join("|")})\\b`);
  for (const file of state.files) {
    if ([path, dataPath, "home/hidden_events.asm"].includes(file.path)) continue;
    // Refuse new direct or indirect incoming references, rather than moving a
    // modified same-bank dependency and producing a ROM that merely links.
    const source = code(file.contents);
    if (references.test(source)) throw new Error(`Cannot move hidden-event lookup: ${file.path} contains an unreviewed reference.`);
  }
  if (upgraded) return;
  const at = text.indexOf("CheckForHiddenEvent::\n");
  const relocated = text.slice(0, at) + begin + text.slice(at) + end;
  changed.set(path, original.includes("\r\n") ? relocated.replace(/\n/g, "\r\n") : relocated);
}
