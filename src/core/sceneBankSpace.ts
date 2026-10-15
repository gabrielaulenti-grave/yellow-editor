import { hashText } from "./history";
import type { InteractionInspection } from "./scriptInteractions";

const path = "engine/overworld/hidden_events.asm";
const begin = '; yellow-editor-scene-bank-space: 1\nPUSHS\nSECTION "Editor Scene Hidden Event Lookup", ROMX\n';
const end = '\nPOPS\n; yellow-editor-scene-bank-space-end\n';
const normalize = (text: string) => text.replace(/\r\n/g, "\n");
const code = (text: string) => normalize(text).split("\n").map(line => line.split(";", 1)[0].trim()).filter(Boolean).join("\n");

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
    const source = code(file.contents).replace(/"(?:[^"\\]|\\.)*"/g, '""');
    if (references.test(source)) throw new Error(`Cannot move hidden-event lookup: ${file.path} contains an unreviewed reference.`);
  }
  if (upgraded) return;
  const at = text.indexOf("CheckForHiddenEvent::\n");
  const relocated = text.slice(0, at) + begin + text.slice(at) + end;
  changed.set(path, original.includes("\r\n") ? relocated.replace(/\n/g, "\r\n") : relocated);
}
