import { bytesToHex, hashText } from "./history";
import { loadMapVisualization, parseMapIndex, parseBinaryAssets } from "./mapVisualization";
import type { MapTerrainDocument, MapTerrainValues, MapWarpDocument, MapWarpValues, ProjectSource, TextWriteRequest } from "./types";

const clean = (line: string) => line.split(";")[0].trim();
const lines = (text: string) => text.split(/\r?\n/);
const commonPaths = ["constants/map_constants.asm", "data/maps/map_header_pointers.asm", "maps.asm", "constants/tileset_constants.asm", "data/tilesets/tileset_headers.asm", "gfx/tilesets.asm"];

async function snapshots(source: ProjectSource, paths: string[], binary: string[] = []) {
  return Promise.all([...new Set(paths)].map(async path => {
    const encoding = binary.includes(path) ? "hex" as const : undefined;
    const text = encoding ? bytesToHex(await source.readBytes(path)) : await source.readText(path);
    return { path, hash: await hashText(text), ...(encoding ? { encoding } : {}) };
  }));
}
async function checkSources(source: ProjectSource, sources: MapTerrainDocument["sources"]) {
  for (const saved of sources) {
    const text = saved.encoding ? bytesToHex(await source.readBytes(saved.path)) : await source.readText(saved.path);
    if (await hashText(text) !== saved.hash) throw new Error(`${saved.path}: map sources changed. Reopen this editor before saving.`);
  }
}
function integer(value: number, min: number, max: number, name: string) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be a whole number from ${min} to ${max}.`);
}
function wholeAsset(assembly: string, path: string) {
  const references = lines(assembly).map(clean).filter(line => line.includes(`"${path}"`));
  if (!references.length || references.some(line => !/\bINCBIN\s+"[^"]+"\s*$/i.test(line))) {
    throw new Error(`Editing ${path} requires a whole-file INCBIN without slicing.`);
  }
}
export async function loadMapTerrainDocument(source: ProjectSource, mapConstant: string): Promise<MapTerrainDocument> {
  const visualization = await loadMapVisualization(source, mapConstant);
  if (visualization.map.isAlias) throw new Error("Choose a map with its own header before editing terrain.");
  const { mapBlockPath, blocksetPath } = visualization;
  const [layout, blockset, maps, tilesets] = await Promise.all([source.readBytes(mapBlockPath), source.readBytes(blocksetPath), source.readText("maps.asm"), source.readText("gfx/tilesets.asm")]);
  wholeAsset(maps, mapBlockPath); wholeAsset(tilesets, blocksetPath);
  if (layout.length !== visualization.map.width * visualization.map.height || layout.length !== visualization.mapBlocks.length || blockset.length !== visualization.blockset.length || blockset.length % 16) {
    throw new Error("Terrain editing requires complete, unpadded map and blockset files matching the map dimensions.");
  }
  const sharedLayout = [...parseBinaryAssets(maps).values()].filter(asset => asset.path === mapBlockPath).length > 1;
  return { visualization, sharedLayout,
    sources: await snapshots(source, [...commonPaths, visualization.map.headerPath!, mapBlockPath, blocksetPath, visualization.tilesetGfxPath], [mapBlockPath, blocksetPath, visualization.tilesetGfxPath]),
  };
}
export async function prepareMapTerrainWrites(source: ProjectSource, document: MapTerrainDocument, values: MapTerrainValues): Promise<TextWriteRequest[]> {
  await checkSources(source, document.sources);
  const fresh = await loadMapTerrainDocument(source, document.visualization.map.constant);
  const v = fresh.visualization;
  if (values.mapBlocks.length !== v.map.width * v.map.height) throw new Error("Map dimensions cannot change in this editor.");
  if (values.blockset.length < v.blockset.length || values.blockset.length % 16 || values.blockset.length > 256 * 16) throw new Error("The blockset must contain complete blocks, keeping existing IDs, with at most 256 blocks.");
  values.blockset.forEach(tile => integer(tile, 0, Math.min(v.tileCount, 256) - 1, "Tile ID"));
  values.mapBlocks.forEach(block => integer(block, 0, values.blockset.length / 16 - 1, "Block ID"));
  const writes: TextWriteRequest[] = [];
  for (const [path, before, after] of [[v.mapBlockPath, v.mapBlocks, values.mapBlocks], [v.blocksetPath, v.blockset, values.blockset]] as const) {
    const contents = bytesToHex(after), old = bytesToHex(before);
    if (contents === old) continue;
    if (path === v.blocksetPath && !values.confirmSharedBlocks) throw new Error("Confirm that block edits affect every map using this blockset.");
    if (path === v.mapBlockPath && fresh.sharedLayout && !values.confirmSharedLayout) throw new Error("Confirm that this layout is shared by multiple maps.");
    writes.push({ path, contents, encoding: "hex", expectedHash: await hashText(old) });
  }
  return writes;
}

function warpSection(text: string) {
  const all = lines(text), starts = all.flatMap((line, i) => clean(line) === "def_warp_events" ? [i] : []);
  const ends = all.flatMap((line, i) => clean(line) === "def_bg_events" ? [i] : []);
  if (starts.length !== 1 || ends.length !== 1 || starts[0] >= ends[0]) throw new Error("Unsupported warp table: expected one def_warp_events followed by def_bg_events.");
  const events: { line: number; x: number; y: number; map: string; warp: number }[] = [];
  for (let i = starts[0] + 1; i < ends[0]; i++) {
    const code = clean(all[i]); if (!code) continue;
    const match = code.match(/^warp_event\s+(-?\d+)\s*,\s*(-?\d+)\s*,\s*([A-Z0-9_]+)\s*,\s*(\d+)$/);
    if (!match) throw new Error("Unsupported warp expression or conditional; no changes were made.");
    events.push({ line: i, x: Number(match[1]), y: Number(match[2]), map: match[3], warp: Number(match[4]) });
  }
  return { all, start: starts[0], end: ends[0], events };
}
async function warpState(source: ProjectSource, mapConstant: string) {
  const index = await parseMapIndex(source), map = index.find(entry => entry.constant === mapConstant);
  if (!map || map.isUnused || map.isAlias || !map.headerPath) throw new Error("Choose a drawable map with its own header.");
  const header = await source.readText(map.headerPath);
  const match = header.match(/^\s*map_header\s+(\w+)\s*,\s*(\w+)\s*,/m);
  if (!match || match[2] !== mapConstant) throw new Error("Map header does not uniquely match this map.");
  const path = `data/maps/objects/${match[1]}.asm`, text = await source.readText(path), section = warpSection(text);
  if (lines(text).filter(line => clean(line) === `def_warps_to ${mapConstant}`).length !== 1) throw new Error("Warp editing requires a matching generated def_warps_to table.");
  const macros = await source.readText("macros/scripts/maps.asm");
  const expected: Record<string, string> = {
    def_warp_events: 'REDEF _NUM_WARP_EVENTS EQUS "_NUM_WARP_EVENTS_\\@"\ndb {_NUM_WARP_EVENTS}\nDEF {_NUM_WARP_EVENTS} = 0',
    warp_event: 'db \\2, \\1, \\4 - 1, \\3\nDEF _WARP_{d:{_NUM_WARP_EVENTS}}_X = \\1\nDEF _WARP_{d:{_NUM_WARP_EVENTS}}_Y = \\2\nDEF {_NUM_WARP_EVENTS} += 1',
  };
  for (const [name, body] of Object.entries(expected)) {
    const matches = [...macros.matchAll(new RegExp(`^MACRO ${name}\\r?\\n([\\s\\S]*?)^ENDM`, "gm"))];
    if (matches.length !== 1 || lines(matches[0][1]).map(clean).filter(Boolean).join("\n") !== body) throw new Error(`Warp editing needs a reviewed ${name} macro implementation.`);
  }
  const arrivalMacro = macros.match(/^MACRO def_warps_to\r?\n([\s\S]*?)^ENDM/m)?.[1];
  const warpToMacro = macros.match(/^MACRO warp_to\r?\n([\s\S]*?)^ENDM/m)?.[1];
  if (!arrivalMacro || !lines(arrivalMacro).map(clean).join("\n").includes('FOR n, {_NUM_WARP_EVENTS}\nwarp_to _WARP_{d:n}_X, _WARP_{d:n}_Y, \\1_WIDTH\nENDR')
    || !warpToMacro || lines(warpToMacro).map(clean).filter(Boolean).join("\n") !== 'event_displacement \\3, \\1, \\2') {
    throw new Error("Warp editing needs reviewed generated arrival-coordinate macros.");
  }
  const constants = await source.readText("constants/map_data_constants.asm");
  const max = constants.match(/^\s*DEF MAX_WARP_EVENTS EQU (\d+)\s*(?:;.*)?$/m);
  if (!max) throw new Error("Could not resolve the map warp limit.");
  return { index, map, path, text, section, maxWarps: Math.min(255, Number(max[1])), headerPath: map.headerPath };
}
export async function loadMapWarpDocument(source: ProjectSource, mapConstant: string): Promise<MapWarpDocument> {
  const state = await warpState(source, mapConstant);
  return { mapConstant, mapName: state.map.displayName, width: state.map.width * 2, height: state.map.height * 2, maxWarps: state.maxWarps,
    warps: state.section.events.map((event, i) => ({ id: i + 1, x: event.x, y: event.y, destinationMap: event.map, destinationWarpId: event.warp })),
    maps: state.index.filter(entry => !entry.isUnused && !entry.isAlias),
    sources: await snapshots(source, ["constants/map_constants.asm", "data/maps/map_header_pointers.asm", state.headerPath, state.path, "macros/scripts/maps.asm", "constants/map_data_constants.asm", ...await source.exists(state.path.replace("data/maps/objects/", "scripts/")).then(exists => exists ? [state.path.replace("data/maps/objects/", "scripts/")] : [])]),
  };
}
function position(x: number, y: number, state: Awaited<ReturnType<typeof warpState>>, excludeId?: number) {
  integer(x, 0, Math.min(255, state.map.width * 2 - 1), "Warp X"); integer(y, 0, Math.min(255, state.map.height * 2 - 1), "Warp Y");
  if (state.section.events.some((event, i) => i + 1 !== excludeId && event.x === x && event.y === y)) throw new Error("This position already contains a warp.");
  for (const line of lines(state.text)) {
    const match = clean(line).match(/^(?:object_event|bg_event)\s+(\d+)\s*,\s*(\d+)\s*,/);
    if (match && Number(match[1]) === x && Number(match[2]) === y) throw new Error("This position contains an object or sign.");
  }
}
function replaceWarp(text: string, id: number | null, x: number, y: number, map: string, warp: number): string {
  const section = warpSection(text), newline = text.includes("\r\n") ? "\r\n" : "\n";
  if (id !== null) {
    const line = section.events[id - 1].line;
    section.all[line] = section.all[line].replace(/^(\s*warp_event\s+)-?\d+(\s*,\s*)-?\d+(\s*,\s*)[A-Z0-9_]+(\s*,\s*)\d+/, (_match, prefix: string, first: string, second: string, third: string) => `${prefix}${x}${first}${y}${second}${map}${third}${warp}`);
  } else {
    const at = section.events.length ? section.events[section.events.length - 1].line + 1 : section.start + 1;
    section.all.splice(at, 0, `\twarp_event ${x}, ${y}, ${map}, ${warp}`);
  }
  return section.all.join(newline);
}
export async function prepareMapWarpWrites(source: ProjectSource, document: MapWarpDocument, values: MapWarpValues, options: { strengthOwner?: boolean } = {}): Promise<TextWriteRequest[]> {
  await checkSources(source, document.sources);
  const state = await warpState(source, document.mapConstant);
  const id = values.id;
  const scriptPath = state.path.replace("data/maps/objects/", "scripts/");
  if (id !== null && !options.strengthOwner && await source.exists(scriptPath)) {
    const record = (await source.readText(scriptPath)).match(/^; yellow-editor-strength: (.+)$/m);
    if (record && (JSON.parse(record[1]) as { goals: Array<{ warpId?: number }> }).goals.some(goal => goal.warpId === id)) throw new Error("This warp belongs to a Strength hole. Move its target in Strength puzzles so the boulder and player routes stay linked.");
  }
  if (id !== null) integer(id, 1, state.section.events.length, "Warp ID");
  else if (state.section.events.length >= state.maxWarps) throw new Error("This map has no available warp slots.");
  const old = id === null ? null : state.section.events[id - 1];
  if (!old || old.x !== values.x || old.y !== values.y) position(values.x, values.y, state, id ?? undefined);
  const newId = id ?? state.section.events.length + 1;
  let destinationId = values.destinationWarpId, destination: Awaited<ReturnType<typeof warpState>> | null = null;
  if (values.destinationMap === "LAST_MAP") {
    if (values.pair) throw new Error("A paired warp requires an explicit destination map.");
    integer(destinationId, 1, state.maxWarps, "Destination warp ID");
  } else {
    destination = await warpState(source, values.destinationMap);
    if (!values.destinationDocument || values.destinationDocument.mapConstant !== values.destinationMap) throw new Error("Reload the destination map before saving.");
    await checkSources(source, values.destinationDocument.sources);
    if (values.pair) {
      if (destination.path === state.path) throw new Error("Paired entrances require two different maps.");
      if (destination.section.events.length >= destination.maxWarps) throw new Error("Destination map has no available warp slots.");
      position(values.pair.x, values.pair.y, destination);
      destinationId = destination.section.events.length + 1;
    } else integer(destinationId, 1, destination.section.events.length + (destination.path === state.path && id === null ? 1 : 0), "Destination warp ID");
  }
  const writes: TextWriteRequest[] = [{ path: state.path, contents: replaceWarp(state.text, id, values.x, values.y, values.destinationMap, destinationId), expectedHash: await hashText(state.text) }];
  if (values.pair && destination) writes.push({ path: destination.path, contents: replaceWarp(destination.text, null, values.pair.x, values.pair.y, document.mapConstant, newId), expectedHash: await hashText(destination.text) });
  return writes.filter(write => write.contents !== (write.path === state.path ? state.text : destination!.text));
}
