import { syncFieldToolMapRules } from "./fieldTools";
import { hashText } from "./history";
import { parseMapIndex } from "./mapVisualization";
import { readProjectRgbdsSources } from "./projectConstants";
import type { ProjectSource, TextWriteRequest } from "./types";

export type Permission = boolean | null;
export type FieldPermissionKey = "bicycle" | "escape" | "teleport" | "fly" | "flash" | "cut" | "surf" | "strength";
export interface MapPropertiesValues { cut?: Permission; surf?: Permission; strength?: Permission; bicycle: Permission; escape: Permission; teleport: Permission; fly: Permission; flash: Permission; lighting: "normal" | "dark" | null }
export interface MapPropertiesDocument { mapConstant: string; mapName: string; values: MapPropertiesValues; defaults: Record<FieldPermissionKey, boolean>; sources: Array<{ path: string; hash: string }> }
type Rules = Record<string, MapPropertiesValues>;
const paths = ["home/overworld.asm", "engine/items/item_effects.asm", "engine/menus/start_sub_menus.asm", "engine/overworld/special_warps.asm"];
const prefix = "; yellow-editor-map-properties: ";
const empty = (): MapPropertiesValues => ({ cut: null, surf: null, strength: null, bicycle: null, escape: null, teleport: null, fly: null, flash: null, lighting: null });
const clean = (s: string) => s.split(";")[0].trim();
const normalize = (s: string) => s.replace(/\r\n/g, "\n");
const segment = (s: string, label: string, next?: string) => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), start = s.match(new RegExp(`^${escaped}:{0,2}\\n`, "m"));
  if (!start || start.index === undefined) throw new Error(`Missing reviewed map rule routine ${label}.`);
  const from = start.index + start[0].length, rest = s.slice(from), until = rest.search(new RegExp(next ? `^${next.replace(/\./g, "\\.")}:{0,2}\\n` : "^[A-Za-z_]\\w*:{1,2}", "m"));
  return { from, to: until < 0 ? s.length : from + until, body: until < 0 ? rest : rest.slice(0, until) };
};
function rulesFrom(text: string): Rules {
  const matches = [...text.matchAll(/^; yellow-editor-map-properties: (.+)$/gm)];
  if (!matches.length) return {};
  if (matches.length !== 1) throw new Error("Duplicate map property records need source review.");
  const r = JSON.parse(matches[0][1]) as { version: number; maps: Rules };
  if (r.version !== 1 || !r.maps || Array.isArray(r.maps)) throw new Error("Unsupported map property record.");
  for (const [name, values] of Object.entries(r.maps)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error("Invalid map property map name.");
    validate(values);
  }
  return r.maps;
}
function validate(v: MapPropertiesValues) {
  if (!v || Object.keys(v).some(k => !Object.keys(empty()).includes(k)) || [v.bicycle, v.escape, v.teleport, v.fly, v.flash].some(p => p !== null && typeof p !== "boolean") || [v.cut, v.surf, v.strength].some(p => p != null && typeof p !== "boolean") || ![null, "dark", "normal"].includes(v.lighting)) throw new Error("Choose Default, Allowed or Blocked and a supported lighting mode.");
}
interface Patch { path: string; key: string; content: string }
function permissions(rules: Rules, field: FieldPermissionKey, name: string) {
  const entries = Object.entries(rules).filter(([, r]) => r[field] != null);
  if (!entries.length) return "";
  return [`${name}::`, ...entries.flatMap(([map, r], i) => ["\tld a, [wCurMap]", `\tcp ${map}`, `\tjr nz, .next${i}`, ...(r[field] ? ["\tld a, 1", "\tand a", "\tscf"] : ["\txor a"]), "\tret", `.next${i}`]), "\tld a, 2", "\tand a", "\tret", ""].join("\n");
}
function lighting(rules: Rules, before: boolean) {
  const entries = Object.entries(rules).filter(([, r]) => r.lighting !== null);
  return [`EditorMapLighting${before ? "Before" : "After"}::`, "\tpush af", ...entries.flatMap(([map, r], i) => ["\tld a, [wCurMap]", `\tcp ${map}`, `\tjr nz, .next${i}`, `\tld a, ${before || r.lighting === "normal" ? 0 : 6}`, "\tld [wMapPalOffset], a", "\tpop af", "\tret", `.next${i}`]), "\tpop af", "\tret", ""].join("\n");
}
const far = (name: string, preserveHL = true) => `\tpush bc\n${preserveHL ? "\tpush hl\n" : ""}\tfarcall ${name}\n${preserveHL ? "\tpop hl\n" : ""}\tpop bc\n`;
function patches(rules: Rules, bikeBody = ""): Patch[] {
  const result: Patch[] = [], add = (path: string, key: string, content: string) => result.push({ path, key, content });
  const bike = permissions(rules, "bicycle", "EditorMapBicyclePermission");
  if (bike || Object.values(rules).some(r => r.lighting !== null)) {
    add(paths[0], "bike-hook", far("EditorMapBikeCheck", false) + "\tret\n; saved bicycle fallback begin\nIF 0\n" + bikeBody + "ENDC\n; saved bicycle fallback end\n");
    add(paths[3], "bike-code", bike + "EditorMapBikeCheck::\n" + (bike ? "\tcall EditorMapBicyclePermission\n\tret z\n\tret c\n" : "") + bikeBody);
  }
  const escape = permissions(rules, "escape", "EditorMapEscapePermission");
  if (escape) { add(paths[1], "escape-hook", far("EditorMapEscapePermission") + "\tjp z, .notUsable\n\tjp c, .EditorEscapeAllowed\n"); add(paths[1], "escape-allowed", ".EditorEscapeAllowed\n"); add(paths[1], "escape-code", escape); }
  const fly = permissions(rules, "fly", "EditorMapFlyPermission"), teleport = permissions(rules, "teleport", "EditorMapTeleportPermission"), flash = permissions(rules, "flash", "EditorMapFlashPermission");
  if (fly) add(paths[2], "fly-hook", far("EditorMapFlyPermission") + "\tjp z, .EditorFieldMoveBlocked\n\tjp c, .canFly\n");
  if (teleport) add(paths[2], "teleport-hook", far("EditorMapTeleportPermission") + "\tjp z, .EditorFieldMoveBlocked\n\tjp c, .canTeleport\n");
  if (flash) add(paths[2], "flash-hook", far("EditorMapFlashPermission") + "\tjp z, .EditorFieldMoveBlocked\n");
  const toolPermissions = (["cut", "surf", "strength"] as const).map(key => ({ key, code: permissions(rules, key, `EditorMap${key[0].toUpperCase() + key.slice(1)}Permission`) }));
  for (const { key, code } of toolPermissions) if (code) add(paths[2], `${key}-hook`, far(`EditorMap${key[0].toUpperCase() + key.slice(1)}Permission`) + "\tjp z, .EditorFieldMoveBlocked\n");
  if (fly || teleport || flash || toolPermissions.some(p => p.code)) {
    add(paths[2], "field-message", '.EditorFieldMoveBlocked\n\tld hl, .EditorFieldMoveBlockedText\n\tcall PrintText\n\tjp .loop\n.EditorFieldMoveBlockedText\n\ttext "You can\'t use that"\n\tline "here."\n\tprompt\n');
    add(paths[2], "field-code", fly + teleport + flash + toolPermissions.map(p => p.code).join(""));
  }
  if (Object.values(rules).some(r => r.lighting !== null)) {
    add(paths[0], "light-before-hook", far("EditorMapLightingBefore", false));
    add(paths[0], "light-after-hook", far("EditorMapLightingAfter", false));
    add(paths[0], "light-connection-hook", far("EditorMapLightingConnected", false));
    add(paths[3], "light-special-before-hook", far("EditorMapLightingBefore"));
    add(paths[3], "light-special-hook", far("EditorMapLightingAfter"));
    add(paths[3], "light-code", lighting(rules, true) + lighting(rules, false) + "EditorMapLightingConnected::\n\txor a\n\tld [wMapPalOffset], a\n\tjp EditorMapLightingAfter\n");
  }
  return result;
}
function block(p: Patch) { const content = p.key.endsWith("-code") ? `PUSHS\nSECTION "Editor Map Rules ${p.key}", ROMX\n${p.content}POPS\n` : p.content; return `; yellow-editor-map-rule ${p.key} begin\n${content}; yellow-editor-map-rule ${p.key} end\n`; }
function strip(files: Map<string, string>, rules: Rules) {
  const stripped = new Map(files);
  const bikeBody = files.get(paths[0])!.match(/; saved bicycle fallback begin\nIF 0\n([\s\S]*?)ENDC\n; saved bicycle fallback end/)?.[1] ?? "";
  for (const p of patches(rules, bikeBody)) {
    const text = stripped.get(p.path)!, owned = block(p);
    if (text.split(owned).length !== 2) throw new Error(`The managed ${p.key} map rule was changed in source.`);
    stripped.set(p.path, text.replace(owned, p.key === "bike-hook" ? bikeBody : ""));
  }
  for (const [path, text] of stripped) {
    if (text.includes("; yellow-editor-map-rule ")) throw new Error("Unknown managed map rule code needs source review.");
    stripped.set(path, text.replace(/^; yellow-editor-map-properties: .+\n?/gm, ""));
  }
  return stripped;
}
const contracts: Array<[number, string, string | undefined, string[]]> = [
  [2, ".cut", ".surf", ["89f85e639993fb9be20b9794561781746985de33a6bc2bbbb46ac6764c0bc5fa"]],
  [2, ".surf", ".strength", ["232bcadda652ea8185bd08792713998a6f03e3fb8313ba60b9f9a6503de89d11", "005452061e283c0d393128d906b98511cebfc3f1b21a068bb9518919815e745b"]],
  [2, ".strength", ".flash", ["e87962895637bb394200d768562f1a59484d8cd5c988b4e67dc34190eeea5a5b"]],
  [0, "IsBikeRidingAllowed", undefined, ["051a564a36c1722ce4e55b70c3af4964cb57932448f9af37c1d381369642465e"]],
  [0, "WarpFound2", undefined, ["342ef5a103f4fcc3e51aeb9c46901a96eaf84bf9e832a92915eafbe50db40217", "f738162dad6c80a01bb67783ff10ff6fa6d4b1cd1a097ea458735d8a1e6f3a24"]],
  [0, "CheckMapConnections", undefined, ["468ef2451ad4e63f57625910409370eed6144d52d38b57c9bce7206e73fcd581", "633b361d2656663537a9939be78d468d2f92aa8190920c512c17599c9c634ec4"]],
  [1, "ItemUseEscapeRope", undefined, ["cb04c534927504375b98c4b973eac6b2f67a31dcf0b24e7534f689ece0d17efa", "a696110e22f841943ad766fdca49567e83a08e057cf6a118076a1d276bf3f93a"]],
  [2, ".fly", ".cut", ["162a9064ac190934041c9a6c57fe09740d06b4ef0907f1dd6f836cd3834198e4", "a36991212acb2a65c503709967dfd587d0233da29d9ea67027d4e8072aa9c4da"]],
  [2, ".flash", ".flashLightsAreaText", ["b479454e65f388a3d1e704fa2ab308217e61ba7c28acfd9ce6ed176c82c98f5d"]],
  [2, ".teleport", ".warpToLastPokemonCenterText", ["43e1e5c233c764a2c802148f7b202edc0768abad114b9503c6f311651558ae8a", "949bfaf8f84994160e0e3b63aabff24e3be018ebfb41a5009920370bfede6cbb"]],
  [3, "PrepareForSpecialWarp", undefined, ["86506883982fa5a3313d1c923cd84ff560461b8f1db628c7df4c33d6b87f736f"]],
];
async function inspect(source: ProjectSource, mapConstant: string) {
  const files = new Map(await Promise.all(paths.map(async p => [p, normalize(await source.readText(p))] as const)));
  const rules = rulesFrom(files.get(paths[0])!), original = strip(files, rules), index = await parseMapIndex(source), map = index.find(m => m.constant === mapConstant);
  if (!map?.headerPath || map.isAlias || map.isUnused) throw new Error("Choose a map with its own header.");
  if (Object.keys(rules).some(name => !index.some(m => m.constant === name && !m.isAlias && !m.isUnused))) throw new Error("A map property override refers to a map that is no longer available.");
  for (const [path, label, next, hashes] of contracts) {
    const body = segment(original.get(paths[path])!, label, next).body.split("\n").map(clean).filter(Boolean).join("\n");
    if (!hashes.includes(await hashText(body))) throw new Error(`${label}: map properties require the reviewed Red/Yellow field-use routines.`);
  }
  return { files, original, rules, map };
}
export async function loadMapPropertiesDocument(source: ProjectSource, mapConstant: string): Promise<MapPropertiesDocument> {
  const s = await inspect(source, mapConstant), header = await source.readText(s.map.headerPath!);
  const tileset = header.match(/map_header\s+\w+,\s*\w+,\s*(\w+)/)?.[1];
  const bike = await source.readText("data/tilesets/bike_riding_tilesets.asm"), escape = await source.readText("data/tilesets/escape_rope_tilesets.asm");
  const contains = (text: string) => rows(text).map(clean).filter(line => /^db\s/.test(line)).flatMap(line => line.replace(/^db\s+/, "").split(",").map(s => s.trim())).includes(tileset ?? "");
  const constants = await source.readText("constants/map_constants.asm"), outside = (constants.split("DEF FIRST_INDOOR_MAP EQU const_value")[0].match(/^\s*map_const\s+/gm) ?? []).length;
  const excluded = [...segment(s.original.get(paths[1])!, "ItemUseEscapeRope").body.matchAll(/cp ([A-Z][A-Z0-9_]+)/g)].map(m => m[1]);
  const dependencies = [...paths, s.map.headerPath!, "data/maps/map_header_pointers.asm", "constants/map_constants.asm", "data/tilesets/bike_riding_tilesets.asm", "data/tilesets/escape_rope_tilesets.asm"];
  return { mapConstant, mapName: s.map.displayName, values: { ...empty(), ...structuredClone(s.rules[mapConstant] ?? {}) }, defaults: { cut: true, surf: true, strength: true, bicycle: ["ROUTE_23", "INDIGO_PLATEAU"].includes(mapConstant) || contains(bike), escape: contains(escape) && !excluded.includes(mapConstant), teleport: s.map.id < outside, fly: s.map.id < outside, flash: true }, sources: await Promise.all(dependencies.map(async path => ({ path, hash: await hashText(await source.readText(path)) }))) };
}
function rows(s: string) { return s.split(/\r?\n/); }
function insertAt(text: string, at: number, p: Patch) { return text.slice(0, at) + block(p) + text.slice(at); }
export async function prepareMapPropertiesWrites(source: ProjectSource, document: MapPropertiesDocument, values: MapPropertiesValues): Promise<TextWriteRequest[]> {
  validate(values);
  for (const f of document.sources) if (await hashText(await source.readText(f.path)) !== f.hash) throw new Error(`${f.path}: map properties changed. Reopen Map properties before saving.`);
  const s = await inspect(source, document.mapConstant), rules = { ...s.rules };
  if (Object.values(values).every(v => v === null)) delete rules[document.mapConstant]; else rules[document.mapConstant] = structuredClone(values);
  if (Object.keys(rules).length > 64) throw new Error("This property runtime supports up to 64 maps with explicit overrides.");
  if (JSON.stringify(rules) === JSON.stringify(s.rules)) return [];
  const files = new Map(s.original);
  if (Object.values(rules).some(r => r.bicycle !== null || r.lighting !== null)) {
    // The moved native bicycle lookup has only these reviewed carry-result callers.
    const sources = await readProjectRgbdsSources(source);
    if (sources.some(f => f.readError)) throw new Error("Could not review bicycle lookup callers before moving its banked fallback.");
    for (const file of sources) {
      const text = rows(s.original.get(file.path) ?? file.contents).map(clean).join("\n").replace(/"[^"\n]*"/g, "");
      const bike = text.match(/\bIsBikeRidingAllowed\b/g)?.length ?? 0, table = text.match(/\bBikeRidingTilesets\b/g)?.length ?? 0;
      const expected = file.path === paths[0] ? [2, 1] : file.path === paths[1] ? [1, 0] : file.path === "data/tilesets/bike_riding_tilesets.asm" ? [0, 1] : [0, 0];
      if (bike !== expected[0] || table !== expected[1]) throw new Error(`${file.path}: an unreviewed bicycle lookup reference prevents a safe bank move.`);
    }
  }
  const bikeBody = segment(s.original.get(paths[0])!, "IsBikeRidingAllowed").body;
  for (const p of patches(rules, bikeBody)) {
    let text = files.get(p.path)!, at = text.length;
    if (p.key.endsWith("-code")) text += "\n";
    else if (p.key === "bike-hook") { const part = segment(text, "IsBikeRidingAllowed"); text = text.slice(0, part.from) + text.slice(part.to); at = part.from; }
    else if (p.key === "light-before-hook") at = segment(text, "WarpFound2").from;
    else if (p.key === "light-after-hook") { const part = segment(text, "WarpFound2"); at = part.from + part.body.lastIndexOf("\tjp EnterMap"); }
    else if (p.key === "light-connection-hook") { const part = segment(text, "CheckMapConnections"); const match = part.body.match(/^\.loadNewMap[^\n]*\n/m); if (!match) throw new Error("Missing connected-map lighting boundary."); at = part.from + match.index! + match[0].length; }
    else if (p.key === "light-special-before-hook") at = segment(text, "PrepareForSpecialWarp").from;
    else if (p.key === "light-special-hook") { const part = segment(text, "PrepareForSpecialWarp"); at = part.from + part.body.indexOf("\tcall LoadSpecialWarpData\n") + "\tcall LoadSpecialWarpData\n".length; }
    else if (p.key === "escape-hook" || p.key === "escape-allowed") { const part = segment(text, "ItemUseEscapeRope"), needle = p.key === "escape-hook" ? "\tld a, [wCurMap]" : "\tld hl, wStatusFlags6"; at = part.from + part.body.indexOf(needle); }
    else if (p.key === "teleport-hook") at = segment(text, ".teleport", ".warpToLastPokemonCenterText").from;
    else if (["fly-hook", "flash-hook", "cut-hook", "surf-hook", "strength-hook"].includes(p.key)) { const key = p.key.replace("-hook", ""); const next = { fly: ".cut", flash: ".flashLightsAreaText", cut: ".surf", surf: ".strength", strength: ".flash" }[key]; const part = segment(text, `.${key}`, next); const needle = "\tjp z, .newBadgeRequired\n"; at = part.from + part.body.indexOf(needle) + needle.length; }
    else if (p.key === "field-message") at = segment(text, "StartMenu_Pokemon").to;
    else throw new Error("Unknown map rule patch.");
    if (at < 0 || at > text.length) throw new Error("Could not locate the reviewed map rule hook.");
    if (p.key.endsWith("-code")) at = text.length;
    files.set(p.path, insertAt(text, at, p));
  }
  if (Object.keys(rules).length) files.set(paths[0], files.get(paths[0])! + `\n${prefix}${JSON.stringify({ version: 1, maps: rules })}\n`);
  const writes = (await Promise.all([...files].map(async ([path, text]) => {
    const before = await source.readText(path), contents = text.replace(/\n/g, before.includes("\r\n") ? "\r\n" : "\n");
    return { path, contents, expectedHash: await hashText(before) };
  }))).filter(w => normalize(w.contents).trimEnd() !== normalize(s.files.get(w.path)!).trimEnd());
  return syncFieldToolMapRules(source, writes);
}
