import { hashText } from "./history";
import { readProjectRgbdsSources, projectConstantCatalogFromSources } from "./projectConstants";
import { inspectPlayerConditions, validatePlayerCondition, renderConditionFailure, conditionBadges, legacyPokedexMask, expandedPokedexMask, type ConditionDomains, type PlayerCondition } from "./playerConditions";
import { parseItemConstantDefinitions } from "./itemConstants";
import { textLineLengthError } from "./textEditing";
import { fieldToolContracts } from "./fieldToolContracts";
import type { ProjectSource, TextWriteRequest, ItemCreateSourceDocument } from "./types";

export const fieldActions = ["surf", "flash", "strength", "cut", "fly", "dig", "teleport"] as const;
export type FieldAction = typeof fieldActions[number];
export interface FieldToolValues {
  action: FieldAction;
  badge: string | null;
  requireMove: boolean;
  condition: PlayerCondition | null;
  consume: boolean;
  allFlyDestinations: boolean;
  messages: { success: string[]; invalid: string[]; requirement: string[]; cancel: string[] };
}
export interface FieldToolSupport { reason: string | null; domains: ConditionDomains; sources: ItemCreateSourceDocument[] }
interface Tool { constant: string; values: FieldToolValues }
interface Model { version: 1; yellow: boolean; tools: Tool[] }
const path = "engine/items/item_effects.asm", marker = "; yellow-editor-field-tools: ", end = "; yellow-editor-field-tools-end";
export const defaultFieldTool = (): FieldToolValues => ({ action: "surf", badge: null, requireMove: false, condition: null, consume: false, allFlyDestinations: false,
  messages: { success: ["<PLAYER> used", "<ITEM>!"], invalid: ["You can't use that", "here."], requirement: ["Requirements are", "not met."], cancel: ["Cancelled."] } });
export const normalFieldBadge: Record<FieldAction, string | null> = { cut: "CASCADE", fly: "THUNDER", surf: "SOUL", strength: "RAINBOW", flash: "BOULDER", dig: null, teleport: null };
export const normalizeFieldSource = (s: string) => s.replace(/\r\n/g, "\n").split("\n").map(l => l.split(";")[0].trim()).filter(Boolean).join("\n");
function withoutMapRules(s: string) { return s.replace(/; yellow-editor-map-rule [\w-]+ begin\r?\n[\s\S]*?; yellow-editor-map-rule [\w-]+ end\r?\n/g, ""); }
export function fieldRoutine(s: string, name: string, next?: string) {
  s = withoutMapRules(s).split(marker)[0].replace(/\r\n/g, "\n");
  const found = s.match(new RegExp(`^${name.replace(/\./g, "\\.")}:{0,2}[ \t]*(?:;[^\\n]*)?\\n`, "m"));
  if (!found) throw new Error(`Missing field action routine ${name}.`);
  const start = found.index! + found[0].length, rest = s.slice(start);
  const stop = rest.search(new RegExp(next ? `^${next.replace(/\./g, "\\.")}:{0,2}[ \t]*(?:;[^\\n]*)?\\n` : "^[A-Za-z_]\\w*:{1,2}", "m"));
  return rest.slice(0, stop < 0 ? undefined : stop);
}
function readModel(text: string): Model | null {
  const matches = [...text.matchAll(/^; yellow-editor-field-tools: (.+)$/gm)];
  if (!matches.length) return null;
  if (matches.length !== 1) throw new Error("Duplicate field tool records need source review.");
  const m = JSON.parse(matches[0][1]) as Model;
  if (m.version !== 1 || typeof m.yellow !== "boolean" || !Array.isArray(m.tools) || !m.tools.length || m.tools.length > 64 || new Set(m.tools.map(t => t.constant)).size !== m.tools.length || m.tools.some(t => !/^[A-Z][A-Z0-9_]*$/.test(t.constant))) throw new Error("Unsupported field tool record.");
  return m;
}
// The first checked beta generated v1 blocks without the map-redraw call.
// Accept that exact earlier form and upgrade it on the next explicit save.
function ownedFieldTools(model: Model, files: Map<string, string>, effects: string) {
  const current = renderFieldTools(model, files);
  const legacy = current.split("\tfarcall ItemUseReloadOverworldData\n").join("");
  for (const block of new Set([current, legacy, current.split(expandedPokedexMask).join(legacyPokedexMask), legacy.split(expandedPokedexMask).join(legacyPokedexMask)])) {
    const text = block.replace(/\n/g, effects.includes("\r\n") ? "\r\n" : "\n");
    if (effects.split(text).length === 2) return text;
  }
  throw new Error("Managed field tool code changed in source. Restore it before editing field tools.");
}
export function fieldToolForItem(effects: string, constant: string) { return readModel(effects)?.tools.find(t => t.constant === constant)?.values ?? null; }
function rules(files: Map<string, string>): Record<string, Record<string, boolean | null>> {
  const matches = [...(files.get("home/overworld.asm") ?? "").matchAll(/^; yellow-editor-map-properties: (.+)$/gm)];
  if (!matches.length) return {};
  if (matches.length !== 1) throw new Error("Duplicate map properties need source review.");
  const m = JSON.parse(matches[0][1]);
  if (m.version !== 1 || !m.maps || typeof m.maps !== "object" || Array.isArray(m.maps)) throw new Error("Unsupported map properties.");
  for (const [map, values] of Object.entries(m.maps) as Array<[string, Record<string, unknown>]>) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(map) || !values || typeof values !== "object") throw new Error("Invalid field permission map.");
    for (const key of [...fieldActions, "escape"]) if (values[key] !== undefined && values[key] !== null && typeof values[key] !== "boolean") throw new Error("Invalid field permission.");
  }
  return m.maps;
}
async function inspect(source: ProjectSource) {
  const entries = await readProjectRgbdsSources(source);
  if (entries.some(f => f.readError)) throw new Error("Could not review field tool sources.");
  const files = new Map(entries.map(f => [f.path, f.contents]));
  const effects = files.get(path) ?? "", model = readModel(effects);
  for (const [file, label, next, hashes] of fieldToolContracts) {
    const body = label === "*" ? files.get(file) ?? "" : fieldRoutine(files.get(file) ?? "", label, next);
    if (!hashes.includes(await hashText(normalizeFieldSource(body)))) throw new Error(`${label}: field tools need the reviewed Red/Yellow field routines.`);
  }
  const symbols = new Map(projectConstantCatalogFromSources(entries.filter(f => f.path.startsWith("constants/"))).constants.map(c => [c.symbol, c.value]));
  const domains: ConditionDomains = { items: parseItemConstantDefinitions(files.get("constants/item_constants.asm") ?? "").filter(i => i.id > 0 && i.id < 255).map(i => i.constant), pokemon: [...symbols].filter(([k, v]) => /^[A-Z][A-Z0-9_]*$/.test(k) && v > 0 && v < 256 && (files.get("constants/pokemon_constants.asm") ?? "").includes(`const ${k} `)).map(([k]) => k), events: [...symbols.keys()].filter(k => k.startsWith("EVENT_")), conditions: inspectPlayerConditions(files, symbols) };
  // Pokémon constants may be separated by arbitrary whitespace.
  domains.pokemon = [...(files.get("constants/pokemon_constants.asm") ?? "").matchAll(/^\s*const (\w+)\b/gm)].map(m => m[1]).filter(k => (symbols.get(k) ?? 0) > 0 && !k.startsWith("FOSSIL_") && !k.startsWith("MON_GHOST"));
  if (domains.conditions?.reason) throw new Error(domains.conditions.reason);
  const yellow = files.has("scripts/OaksLab_2.asm");
  if (model) {
    if (model.yellow !== yellow) throw new Error("Field tool records belong to a different game.");
    const bindings = [...fieldRoutine(effects, "ItemUsePtrTable", "ItemUseBall").matchAll(/^\s*dw\s+(\w+)/gm)].map(m => m[1]);
    for (const t of model.tools) {
      validateFieldTool(t.values, domains, files);
      const definition = parseItemConstantDefinitions(files.get("constants/item_constants.asm")!).find(d => d.constant === t.constant && d.machineKind === null);
      const usedIn = (file: string) => new RegExp(`^\\s*db\\s+${t.constant}\\b`, "m").test(files.get(file) ?? "");
      if (!definition || bindings[definition.id - 1] !== "EditorFieldToolUse" || !usedIn("data/items/use_overworld.asm") || usedIn("data/items/use_party.asm")) throw new Error(`The ${t.constant} field tool's item-menu binding changed in source.`);
    }
    ownedFieldTools(model, files, effects);
  } else if (effects.includes("EditorFieldTool")) throw new Error("Unrecognized field tool code needs source review.");
  return { files, entries, effects, model, domains, yellow };
}
export async function loadFieldToolSupport(source: ProjectSource): Promise<FieldToolSupport> {
  try { const s = await inspect(source); return { reason: null, domains: s.domains, sources: await Promise.all(s.entries.map(async f => ({ path: f.path, sourceHash: await hashText(f.contents) }))) }; }
  catch (e) { return { reason: String(e), domains: { items: [], pokemon: [], events: [] }, sources: [] }; }
}
export function validateFieldTool(v: FieldToolValues, domains: ConditionDomains, files?: Map<string, string>) {
  if (!v || Object.keys(v).sort().join() !== Object.keys(defaultFieldTool()).sort().join() || !v.messages || Object.keys(v.messages).sort().join() !== "cancel,invalid,requirement,success" || v.condition !== null && typeof v.condition !== "object" || !fieldActions.includes(v.action) || v.badge !== null && !conditionBadges.includes(v.badge) || [v.requireMove, v.consume, v.allFlyDestinations].some(b => typeof b !== "boolean") || v.allFlyDestinations && v.action !== "fly") throw new Error("Choose a supported field action and requirements.");
  if (v.condition) validatePlayerCondition(v.condition, domains);
  if (v.requireMove && !domains.conditions?.moves.includes(v.action.toUpperCase())) throw new Error("This party move is unavailable.");
  for (const key of ["success", "invalid", "requirement", "cancel"] as const) {
    const lines = v.messages?.[key];
    if (!Array.isArray(lines) || !lines.length || lines.length > 8 || !lines.some(l => l.trim()) || lines.some((l, i) => typeof l !== "string" || /["@\\\r\n]/.test(l) || textLineLengthError(l.split("<ITEM>").join("I".repeat(12)), i === 0 ? 18 : 17) || [...l.matchAll(/<[^>]*>/g)].some(m => !["<PLAYER>", "<ITEM>"].includes(m[0])))) throw new Error("Use 1–8 readable message rows, with <PLAYER> or <ITEM>. Keep the first row within 18 spaces and later rows within 17.");
    if (files) { const chars = new Set([...(files.get("constants/charmap.asm") ?? "").matchAll(/^\s*charmap "([^"\\])",\s*\$([\da-f]{2})\b/gmi)].filter(m => parseInt(m[2], 16) >= 0x60 || m[1] === "#" && m[2] === "54").map(m => m[1]));
      if (lines.some(l => [...l.replace(/<(PLAYER|ITEM)>/g, "")].some(c => !chars.has(c)))) throw new Error("A field tool message contains characters unavailable in this game's font."); }
  }
}
export async function prepareFieldToolWrites(source: ProjectSource, constant: string, values: FieldToolValues, support: FieldToolSupport, baseWrites: TextWriteRequest[] = []): Promise<TextWriteRequest[]> {
  if (support.reason) throw new Error(support.reason);
  const s = await inspect(source);
  for (const guard of support.sources) if (await hashText(await source.readText(guard.path)) !== guard.sourceHash) throw new Error(`${guard.path}: field tool sources changed. Reopen the item.`);
  validateFieldTool(values, s.domains, s.files);
  const files = new Map(s.files); for (const w of baseWrites) files.set(w.path, w.contents);
  if (!parseItemConstantDefinitions(files.get("constants/item_constants.asm")!).some(i => i.constant === constant && i.machineKind === null)) throw new Error("Choose an ordinary item slot for this field tool.");
  const model: Model = { version: 1, yellow: s.yellow, tools: [...(s.model?.tools.filter(t => t.constant !== constant) ?? []), { constant, values: structuredClone(values) }].sort((a, b) => a.constant.localeCompare(b.constant)) };
  if (model.tools.length > 64) throw new Error("At most 64 field tools are supported.");
  let text = files.get(path)!;
  const old = s.model && ownedFieldTools(s.model, s.files, s.effects);
  if (old) text = text.replace(old, "");
  text = text.trimEnd() + "\n\n" + renderFieldTools(model, files);
  if (s.effects.includes("\r\n")) text = text.replace(/\r?\n/g, "\r\n");
  const writes = baseWrites.filter(w => w.path !== path), before = await source.readText(path);
  if (text !== before) writes.push({ path, contents: text, expectedHash: await hashText(before) });
  return writes;
}
// A map edit and its dependent item dispatch tables must be saved atomically.
export async function syncFieldToolMapRules(source: ProjectSource, writes: TextWriteRequest[]) {
  const effects = await source.readText(path); if (!readModel(effects)) return writes;
  const s = await inspect(source), staged = new Map(s.files); for (const w of writes) staged.set(w.path, w.contents);
  const old = ownedFieldTools(s.model!, s.files, effects), next = renderFieldTools(s.model!, staged).replace(/\n/g, effects.includes("\r\n") ? "\r\n" : "\n");
  const current = staged.get(path)!;
  if (old === next) return writes;
  if (current.split(old).length !== 2) throw new Error("The field tool runtime changed while updating map rules.");
  return [...writes.filter(w => w.path !== path), { path, contents: current.replace(old, next), expectedHash: await hashText(effects) }];
}
const set = (target: string, value: string | number) => [`\tld a, ${value}`, `\tld [${target}], a`];
const print = (label: string) => [`\tld hl, ${label}`, "\tcall EditorFieldToolPrint"];
function message(label: string, lines: string[]) {
  const code = [`${label}:`];
  for (const [i, line] of lines.entries()) {
    const parts = line.split("<ITEM>");
    code.push(`\t${i === 0 ? "text" : i === 1 ? "line" : "cont"} "${parts[0]}${parts.length > 1 ? "@" : ""}"`);
    for (const [n, rest] of parts.slice(1).entries()) code.push("\ttext_ram wStringBuffer", `\ttext "${rest}${n < parts.length - 2 ? "@" : ""}"`);
  }
  code.push("\tprompt", ""); return code;
}
function permission(v: FieldToolValues, files: Map<string, string>, no: string) {
  const key = v.action === "dig" ? "escape" : v.action, entries = Object.entries(rules(files)).filter(([, r]) => r[key] != null);
  return entries.flatMap(([map, r], i) => [`\tld a, [wCurMap]`, `\tcp ${map}`, `\tjr nz, .map${i}`, `\tjp ${r[key] ? ".mapAllowed" : no}`, `.map${i}`]);
}
export function renderFieldTools(m: Model, files: Map<string, string>): string {
  const code: string[] = [marker + JSON.stringify(m), "EditorFieldToolUse:", "\tfarcall EditorFieldToolDispatch", "\tret", "PUSHS", 'SECTION "Editor field tools", ROMX', "EditorFieldToolDispatch:"];
  for (const t of m.tools) code.push("\tld a, [wCurItem]", `\tcp ${t.constant}`, `\tjp z, EditorFieldTool${t.constant}`);
  code.push(...set("wActionResultOrTookBattleTurn", 0), "\tret", "");
  for (const t of m.tools) {
    const v = t.values, p = `EditorFieldTool${t.constant}`;
    code.push(`${p}:`, "\tld a, [wWhichPokemon]", "\tpush af", `\tcall ${p}Run`, "\tpop bc", "\tld a, b", "\tld [wWhichPokemon], a", ...set("wCurItem", t.constant));
    if (v.consume) code.push("\tld a, [wActionResultOrTookBattleTurn]", "\tand a", "\tret z", "\tfarcall RemoveUsedItem");
    code.push("\tret", `${p}Run:`, ...set("wActionResultOrTookBattleTurn", 0), "\tld a, [wIsInBattle]", "\tand a", `\tjp nz, ${p}Failed`, "\tld a, [wLinkState]", "\tand a", `\tjp nz, ${p}Failed`);
    if (v.badge) code.push("\tld a, [wObtainedBadges]", `\tbit ${conditionBadges.indexOf(v.badge)}, a`, `\tjp z, ${p}Missing`);
    if (v.requireMove) code.push(...renderConditionFailure({ kind: "party-move", move: v.action.toUpperCase() }, `${p}Missing`, `${p}Move`));
    if (v.condition) code.push(...renderConditionFailure(v.condition, `${p}Missing`, `${p}Condition`));
    // Condition generators use global labels, so re-enter the local scope explicitly.
    code.push(`${p}Location:`);
    if (v.action === "surf") code.push("\tld a, [wWalkBikeSurfState]", "\tcp 2", "\tjr z, .mapAllowed");
    code.push(...permission(v, files, `${p}Failed`));
    if (["fly", "teleport"].includes(v.action)) code.push("\tcall CheckIfInOutsideMap", `\tjp nz, ${p}Failed`);
    if (v.action === "dig") {
      const native = fieldRoutine(files.get(path)!, "ItemUseEscapeRope");
      const excluded = [...native.matchAll(/\tcp ([A-Z][A-Z0-9_]+)\n\tjr z, \.notUsable/g)].map(m => m[1]);
      code.push("\tld a, [wCurMap]", ...excluded.flatMap(map => [`\tcp ${map}`, `\tjp z, ${p}Failed`]), "\tld a, [wCurMapTileset]", "\tld b, a", "\tld hl, EditorFieldToolEscapeTilesets", ".escapeLoop", "\tld a, [hli]", "\tcp $ff", `\tjp z, ${p}Failed`, "\tcp b", "\tjr nz, .escapeLoop");
    }
    code.push(".mapAllowed");
    if (["teleport", "dig"].includes(v.action)) code.push("\tld a, [wLastBlackoutMap]", "\tld hl, EditorFieldToolHealingMaps", "\tld de, 1", "\tcall IsInArray", `\tjp nc, ${p}Failed`);
    if (v.action === "flash") code.push("\tld a, [wMapPalOffset]", "\tand a", `\tjp z, ${p}Failed`);
    if (v.action === "strength") code.push("\tld hl, wStatusFlags1", "\tbit BIT_STRENGTH_ACTIVE, [hl]", `\tjp nz, ${p}Failed`);
    if (!["cut", "fly"].includes(v.action)) code.push("\tfarcall ItemUseReloadOverworldData");
    code.push(...set("wCurItem", t.constant), `\tld a, ${v.allFlyDestinations ? 1 : 0}`, "\tcall EditorFieldToolAction" + v.action.toUpperCase(), "\tld a, [wActionResultOrTookBattleTurn]", "\tand a", `\tjp z, ${v.action === "fly" ? p + "Cancelled" : p + "Failed"}`, ...set("wNamedObjectIndex", t.constant), "\tcall GetItemName", "\tcall CopyToStringBuffer", ...print(p + "Success"), ...set("wActionResultOrTookBattleTurn", 1), "\tret");
    // Re-establish the Run scope after generated predicate/global labels.
    code.push(`${p}Failed:`, ...print(p + "Invalid"), ...set("wActionResultOrTookBattleTurn", 0), "\tret", `${p}Missing:`, ...print(p + "Requirement"), ...set("wActionResultOrTookBattleTurn", 0), "\tret", `${p}Cancelled:`, ...print(p + "Cancel"), ...set("wActionResultOrTookBattleTurn", 0), "\tret");
    for (const [role, lines] of Object.entries(v.messages)) code.push(...message(p + role[0].toUpperCase() + role.slice(1), lines));
  }
  code.push("EditorFieldToolPrint:", "\tpush hl", "\tld a, [wCurItem]", "\tld [wNamedObjectIndex], a", "\tcall GetItemName", "\tcall CopyToStringBuffer", "\tpop hl", "\tjp PrintText", ...actions(m, files), "POPS", end, "");
  return code.join("\n");
}
function actions(m: Model, files: Map<string, string>): string[] {
  const code: string[] = [];
  const used = (a: FieldAction) => m.tools.some(t => t.values.action === a);
  const done = [...set("wActionResultOrTookBattleTurn", 1), "\tret"];
  if (used("flash")) code.push("EditorFieldToolActionFLASH:", ...set("wMapPalOffset", 0), ...done);
  if (used("strength")) code.push("EditorFieldToolActionSTRENGTH:", "\tld hl, wStatusFlags1", "\tset BIT_STRENGTH_ACTIVE, [hl]", ...done);
  if (used("teleport")) code.push("EditorFieldToolActionTELEPORT:", "\tld hl, wStatusFlags6", "\tset BIT_FLY_WARP, [hl]", "\tset BIT_ESCAPE_WARP, [hl]", ...(m.yellow ? ["\tcall Func_1510"] : []), "\tld hl, wStatusFlags4", "\tset BIT_UNKNOWN_4_1, [hl]", "\tres BIT_NO_BATTLES, [hl]", ...done);
  if (used("dig")) {
    const escape = fieldRoutine(files.get(path)!, "ItemUseEscapeRope"), start = escape.indexOf("\tld hl, wStatusFlags6"), finish = escape.indexOf("\tld a, [wPseudoItemID]");
    if (start < 0 || finish < start) throw new Error("Could not locate the reviewed escape action.");
    code.push("EditorFieldToolActionDIG:", escape.slice(start, finish), "\tret");
  }
  if (used("fly")) {
    code.push("EditorFieldToolActionFLY:", "\tand a", "\tjr nz, .all", "\tld a, [wTownVisitedFlag + 1]", "\tand HIGH((1 << NUM_CITY_MAPS) - 1)", "\tld b, a", "\tld a, [wTownVisitedFlag]", "\tor b", "\tjr z, .cancel", "\tcall ChooseFlyDestination", "\tjr .chosen", ".all", "\tld a, [wTownVisitedFlag]", "\tpush af", "\tld a, [wTownVisitedFlag + 1]", "\tpush af", ...set("wTownVisitedFlag", "LOW((1 << NUM_CITY_MAPS) - 1)"), ...set("wTownVisitedFlag + 1", "HIGH((1 << NUM_CITY_MAPS) - 1)"), "\tcall ChooseFlyDestination", "\tpop af", "\tld [wTownVisitedFlag + 1], a", "\tpop af", "\tld [wTownVisitedFlag], a", ".chosen", "\tcall RestoreScreenTilesAndReloadTilePatterns", "\tcall LoadFontTilePatterns", "\tcall LoadGBPal", "\tld a, [wStatusFlags6]", "\tbit BIT_FLY_WARP, a", "\tjr z, .cancel", ...done, ".cancel", ...set("wActionResultOrTookBattleTurn", 0), "\tret");
  }
  if (used("surf")) {
    // Preserve the reviewed game's collision convention and Yellow follower cleanup.
    let surf = fieldRoutine(files.get(path)!, "ItemUseSurfboard", "SurfingGotOnText");
    surf = surf.replace(/\tld hl, SurfingGotOnText\n\tjp PrintText/, done.join("\n"))
      .replace(/\tld hl, SurfingNoPlaceToGetOffText\n\tjp PrintText/, "\tand a\n\tret")
      .replace(/SurfingAttemptFailed/g, "EditorFieldToolSurfFailed")
      .replace(/\tcall IsNextTileShoreOrWater/g, "\tfarcall IsNextTileShoreOrWater")
      .replace(/\tjp LoadWalkingPlayerSpriteGraphics/, "\tcall LoadWalkingPlayerSpriteGraphics\n" + done.join("\n"));
    code.push("EditorFieldToolActionSURF:", "\tld a, [wWalkBikeSurfState]", "\tcp 2", "\tjr z, .allowed", "\tcall EditorFieldToolSurfAllowed", "\tld hl, wStatusFlags1", "\tbit BIT_SURF_ALLOWED, [hl]", "\tres BIT_SURF_ALLOWED, [hl]", "\tjp z, EditorFieldToolSurfFailed", ".allowed", surf,
      "EditorFieldToolSurfFailed:", ...set("wActionResultOrTookBattleTurn", 0), "\tret");
    let allowed = fieldRoutine(files.get("engine/overworld/field_move_messages.asm")!, "IsSurfingAllowed", "SeafoamIslandsB4FStairsCoords");
    allowed = allowed.replace(/\tld hl, (?:CurrentTooFastText|CyclingIsFunText)\n\tjp PrintText/g, "\tret").replace(/SeafoamIslandsB4FStairsCoords/g, "EditorFieldToolSeafoamCoords");
    code.push("EditorFieldToolSurfAllowed:", allowed, "EditorFieldToolSeafoamCoords:", "\tdbmapcoord 7, 11", "\tdb -1");
  }
  if (used("cut")) {
    let cut = fieldRoutine(files.get("engine/overworld/cut.asm")!, "UsedCut", "UsedCutText");
    cut = cut.replace(/\tld hl, \.NothingToCutText\n\tjp PrintText\n\n\.NothingToCutText\n\ttext_far _NothingToCutText\n\ttext_end/, "\tret")
      .replace(/\tld a, \[wWhichPokemon\]\n\tld hl, wPartyMonNicks\n\tcall GetPartyMonName\n/, "")
      .replace(/\tld hl, UsedCutText\n\tcall PrintText\n/, "")
      .replace(/\tcall (InitCutAnimOAM|ReplaceTreeTileBlock|RedrawMapView)/g, "\tfarcall $1")
      .replace(/\tjp RedrawMapView/, "\tfarcall RedrawMapView\n" + done.join("\n"));
    code.push("EditorFieldToolActionCUT:", cut);
  }
  if (used("dig")) {
    const tiles = files.get("data/tilesets/escape_rope_tilesets.asm")!;
    code.push("EditorFieldToolEscapeTilesets:", fieldRoutine(tiles, "EscapeRopeTilesets"));
  }
  if (used("dig") || used("teleport")) {
    const healing = [...files.get("data/maps/special_warps.asm")!.matchAll(/^\s*fly_warp_spec\s+(\w+),/gm)].map(m => m[1]);
    if (!healing.length) throw new Error("No native healing destinations were found.");
    code.push("EditorFieldToolHealingMaps:", ...healing.map(map => `\tdb ${map}`), "\tdb -1");
  }
  return code;
}
