import { bytesToHex, hashText } from "./history";
import { loadMapVisualization, parseMapIndex } from "./mapVisualization";
import { loadMapWarpDocument, prepareMapWarpWrites } from "./mapEditing";
import { readProjectRgbdsSources } from "./projectConstants";
import type { MapCreateDocument, MapCreateValues, ProjectSource, TextWriteRequest } from "./types";

const clean = (line: string) => line.split(";")[0].trim();
const registryPaths = ["constants/map_constants.asm", "data/maps/map_header_pointers.asm", "data/maps/map_header_banks.asm", "data/maps/songs.asm", "data/wild/grass_water.asm", "data/maps/town_map_entries.asm", "maps.asm", "macros/scripts/maps.asm", "ram/wram.asm"];
function rows(text: string, label: string, macro: string, assertion: string): string[] {
  const lines = text.split(/\r?\n/).map(clean);
  const start = lines.findIndex(line => new RegExp(`^${label}:{1,2}$`).test(line));
  const end = lines.indexOf(`assert_table_length ${assertion}`, start + 1);
  if (start < 0 || end < 0) throw new Error(`Cannot identify the ${label} table.`);
  return lines.slice(start + 1, end).filter(line => line && !/^table_width\s+/.test(line)).map(line => {
    if (!new RegExp(`^${macro}\\s+`).test(line)) throw new Error(`Unsupported ${label} table expression.`);
    return line;
  });
}
function before(text: string, marker: string, added: string): string {
  const all = text.split(/\r?\n/), at = all.findIndex(line => clean(line) === marker);
  if (at < 0 || all.filter(line => clean(line) === marker).length !== 1) throw new Error(`Expected one ${marker}.`);
  all.splice(at, 0, ...added.split("\n")); return all.join(text.includes("\r\n") ? "\r\n" : "\n");
}
function number(value: number, min: number, max: number, name: string) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be a whole number from ${min} to ${max}.`);
}
export function mapSourceName(constant: string) {
  return constant.split("_").map(word => word[0] + word.slice(1).toLowerCase()).join("");
}
async function state(source: ProjectSource, templateConstant: string) {
  const maps = await parseMapIndex(source), template = maps.find(map => map.constant === templateConstant);
  const firstIndoor = (await source.readText("constants/map_constants.asm")).split(/\r?\n/).slice(0).findIndex(line => clean(line) === "DEF FIRST_INDOOR_MAP EQU const_value");
  if (firstIndoor < 0) throw new Error("Could not identify the indoor-map ID boundary.");
  const constants = await source.readText("constants/map_constants.asm");
  const outdoorCount = constants.split(/\r?\n/).slice(0, firstIndoor).filter(line => /^map_const\b/.test(clean(line))).length;
  if (!template || template.id < outdoorCount || template.isUnused || template.isAlias) throw new Error("Choose an independent indoor map as the terrain template.");
  const visualization = await loadMapVisualization(source, templateConstant, maps);
  if (visualization.connections.length) throw new Error("Templates with outdoor connections are not supported for new interiors.");
  const files = new Map(await Promise.all(registryPaths.map(async path => [path, await source.readText(path)] as const)));
  const macroBodies: Record<string, string> = {
    map_header: String.raw`REDEF CURRENT_MAP_ID EQUS "\2"
DEF CURRENT_MAP_WIDTH = \2_WIDTH
DEF CURRENT_MAP_HEIGHT = \2_HEIGHT
DEF CURRENT_MAP_OBJECT EQUS "\1_Object"
\1_h::
db \3
db CURRENT_MAP_HEIGHT, CURRENT_MAP_WIDTH
dw \1_Blocks
dw \1_TextPointers
dw \1_Script
db MAP_CONNECTIONS_\2
DEF MAP_CONNECTIONS_\2 = 0`,
    end_map_header: String.raw`dw {CURRENT_MAP_OBJECT}
PURGE CURRENT_MAP_WIDTH, CURRENT_MAP_HEIGHT, CURRENT_MAP_OBJECT`,
    object_const_def: "const_def 1",
    def_object_events: String.raw`REDEF _NUM_OBJECT_EVENTS EQUS "_NUM_OBJECT_EVENTS_\@"
db {_NUM_OBJECT_EVENTS}
DEF {_NUM_OBJECT_EVENTS} = 0`,
    def_bg_events: String.raw`REDEF _NUM_BG_EVENTS EQUS "_NUM_BG_EVENTS_\@"
db {_NUM_BG_EVENTS}
DEF {_NUM_BG_EVENTS} = 0`,
  };
  for (const [macro, expected] of Object.entries(macroBodies)) {
    const matches = [...files.get("macros/scripts/maps.asm")!.matchAll(new RegExp(`^MACRO ${macro}\\r?\\n([\\s\\S]*?)^ENDM`, "gm"))];
    if (matches.length !== 1 || matches[0][1].split(/\r?\n/).map(clean).filter(Boolean).join("\n") !== expected) throw new Error(`Map creation needs a reviewed ${macro} macro.`);
  }
  if (!/^wOverworldMap::\s+ds 1300\s*$/m.test(files.get("ram/wram.asm")!)) throw new Error("Map creation needs the reviewed 1300-block overworld buffer.");
  if (!/^MACRO map_const\r?\n\s*const \\1\r?\n\s*DEF \\1_WIDTH EQU \\2\r?\n\s*DEF \\1_HEIGHT EQU \\3\r?\nENDM/m.test(constants)) throw new Error("Map creation needs the reviewed map_const macro.");
  await loadMapWarpDocument(source, templateConstant);
  for (const [path, label, macro] of [[registryPaths[1], "MapHeaderPointers", "dw"], [registryPaths[2], "MapHeaderBanks", "db"], [registryPaths[3], "MapSongBanks", "db"], [registryPaths[4], "WildDataPointers", "dw"]]) {
    if (rows(files.get(path)!, label, macro, "NUM_MAPS").length !== maps.length) throw new Error(`${label} does not match the map ID table.`);
  }
  if (!/^\s*ASSERT NUM_MAPS <= LAST_MAP,/m.test(constants) || !/^DEF LAST_MAP EQU \$ff\s*$/m.test(constants)) throw new Error("New maps require the reviewed byte-sized map ID range.");
  const beforeTemplate = constants.split(/\r?\n/).findIndex(line => clean(line).startsWith(`map_const ${templateConstant},`) || new RegExp(`^map_const\\s+${templateConstant}\\s*,`).test(clean(line)));
  const group = constants.split(/\r?\n/).slice(beforeTemplate).map(clean).find(line => /^end_indoor_group\s+/.test(line))?.split(/\s+/)[1];
  const location = rows(files.get(registryPaths[5])!, "InternalMapEntries", "indoor_map", "NUM_INDOOR_MAP_GROUPS").find(line => new RegExp(`^indoor_map\\s+${group}\\s*,`).test(line));
  if (!location) throw new Error("Could not resolve the template's town-map location.");
  const objectText = await source.readText(visualization.objectPath);
  const border = objectText.match(/^\s*db\s+(\$[\da-f]+|\d+)\s*;\s*border block\b/im)?.[1];
  if (!border) throw new Error("Could not identify the template's border block.");
  return { maps, template, visualization, files, outdoorCount, location, border: border.startsWith("$") ? Number.parseInt(border.slice(1), 16) : Number(border) };
}
export async function loadMapCreateDocument(source: ProjectSource, templateConstant = "BLUES_HOUSE"): Promise<MapCreateDocument> {
  const current = await state(source, templateConstant);
  if (current.maps.length >= 255) throw new Error("The map ID table has reached LAST_MAP ($FF). Existing IDs cannot be shifted to add another map.");
  const extra = [current.template.headerPath!, current.visualization.objectPath, current.visualization.mapBlockPath, current.visualization.blocksetPath, current.visualization.tilesetGfxPath];
  const sources = await Promise.all([...new Set([...registryPaths, ...extra])].map(async path => {
    const encoding = extra.slice(2).includes(path) ? "hex" as const : undefined;
    const contents = encoding ? bytesToHex(await source.readBytes(path)) : current.files.get(path) ?? await source.readText(path);
    return { path, hash: await hashText(contents), ...(encoding ? { encoding } : {}) };
  }));
  return { templateConstant, visualization: current.visualization, borderBlock: current.border,
    nextId: current.maps.length, remainingIds: 255 - current.maps.length,
    templates: current.maps.filter(map => map.id >= current.outdoorCount && !map.isUnused && !map.isAlias),
    locations: current.maps.filter(map => map.id < current.outdoorCount && !map.isUnused && !map.isAlias),
    sources,
  };
}
export async function prepareMapCreateWrites(source: ProjectSource, document: MapCreateDocument, values: MapCreateValues): Promise<TextWriteRequest[]> {
  if (!source.createFile || !source.removeFile || !source.writeBytes) throw new Error("This project source does not support undoable map creation.");
  for (const saved of document.sources) {
    const contents = saved.encoding ? bytesToHex(await source.readBytes(saved.path)) : await source.readText(saved.path);
    if (await hashText(contents) !== saved.hash) throw new Error(`${saved.path}: map sources changed. Reopen Create map before saving.`);
  }
  const current = await state(source, document.templateConstant);
  if (current.maps.length !== document.nextId || current.maps.length >= 255) throw new Error("Available map IDs changed. Reopen Create map.");
  const constant = values.constant.trim();
  if (!/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/.test(constant) || constant.length > 48 || constant.startsWith("UNUSED_MAP_")) throw new Error("Use a unique map constant of up to 48 uppercase letters, digits and underscores, starting with a letter.");
  const name = mapSourceName(constant);
  const allFiles = await readProjectRgbdsSources(source);
  if (allFiles.some(file => file.readError)) throw new Error("Could not inspect all assembly sources for map symbol collisions.");
  const symbols = [constant, `${constant}_WIDTH`, `${constant}_HEIGHT`, `INDOORGROUP_${constant}`, `${name}_h`, `${name}_Script`, `${name}_TextPointers`, `${name}_Object`, `${name}_Blocks`];
  if (symbols.some(symbol => allFiles.some(file => new RegExp(`\\b${symbol}\\b`).test(file.contents)))) throw new Error("This map name or one of its generated symbols is already used. Choose a different name.");
  number(values.width, 2, 64, "Width"); number(values.height, 2, 64, "Height");
  if ((values.width + 6) * (values.height + 6) > 1300) throw new Error("The padded map exceeds the game's 1300-block map buffer. Choose smaller dimensions.");
  number(values.borderBlock, 0, Math.min(255, current.visualization.blockCount - 1), "Border block");
  if (values.layout !== "copy" && values.layout !== "blank") throw new Error("Choose copied terrain or a blank map.");
  if (values.layout === "copy" && (values.width !== current.template.width || values.height !== current.template.height)) throw new Error("Copied terrain keeps the template's dimensions; use a blank map for different dimensions.");
  number(values.fillBlock, 0, Math.min(255, current.visualization.blockCount - 1), "Fill block");
  const location = current.maps.find(map => map.constant === values.locationMap && map.id < current.outdoorCount && !map.isUnused && !map.isAlias);
  if (!location) throw new Error("Choose a valid outdoor town-map location.");
  const exteriorLocation = rows(current.files.get(registryPaths[5])!, "ExternalMapEntries", "outdoor_map", "FIRST_INDOOR_MAP")[location.id];
  const locationArgs = exteriorLocation.replace(/^outdoor_map\s+/, "");
  const musicMap = current.maps.find(map => map.constant === values.musicMap);
  if (!musicMap || musicMap.isUnused) throw new Error("Choose an existing map's music.");
  const music = rows(current.files.get(registryPaths[3])!, "MapSongBanks", "db", "NUM_MAPS")[musicMap.id];
  let layout = values.layout === "copy" ? current.visualization.mapBlocks.slice() : Array(values.width * values.height).fill(values.fillBlock);
  if (layout.length !== values.width * values.height || layout.some(id => !Number.isInteger(id) || id < 0 || id >= current.visualization.blockCount)) throw new Error("The template has an incomplete or invalid terrain layout.");
  const paths = [`data/maps/headers/${name}.asm`, `scripts/${name}.asm`, `data/maps/objects/${name}.asm`, `maps/${name}.blk`];
  const known = source.listFiles ? (await source.listFiles()).map(path => path.toLowerCase()) : [];
  for (const path of paths) if (await source.exists(path) || known.includes(path.toLowerCase())) throw new Error(`${path} already exists; choose a different map name.`);
  let exit = "", exteriorDocument = null;
  if (values.connection) {
    const link = values.connection;
    number(link.interiorX, 0, values.width * 2 - 1, "Interior warp X"); number(link.interiorY, 0, values.height * 2 - 1, "Interior warp Y");
    exteriorDocument = await loadMapWarpDocument(source, link.exteriorMap);
    if (exteriorDocument.warps.length >= exteriorDocument.maxWarps) throw new Error("The exterior has no free warp slots.");
    exit = `\twarp_event ${link.interiorX}, ${link.interiorY}, ${link.exteriorMap}, ${exteriorDocument.warps.length + 1}\n`;
  }
  const changes: TextWriteRequest[] = [];
  const replace = async (path: string, contents: string) => changes.push({ path, contents, expectedHash: await hashText(current.files.get(path)!) });
  await replace(registryPaths[0], before(current.files.get(registryPaths[0])!, "DEF NUM_MAPS EQU const_value", `\tmap_const ${constant}, ${values.width}, ${values.height}\n\tend_indoor_group ${constant}`));
  for (const [path, row] of [[registryPaths[1], `\tdw ${name}_h`], [registryPaths[2], `\tdb BANK(${name}_h)`], [registryPaths[3], `\t${music} ; ${constant}`], [registryPaths[4], `\tdw NothingWildMons ; ${constant}`]]) {
    await replace(path, before(current.files.get(path)!, "assert_table_length NUM_MAPS", row));
  }
  await replace(registryPaths[5], before(current.files.get(registryPaths[5])!, "assert_table_length NUM_INDOOR_MAP_GROUPS", `\tindoor_map ${constant}, ${locationArgs}`));
  const newline = current.files.get("maps.asm")!.includes("\r\n") ? "\r\n" : "\n";
  await replace("maps.asm", current.files.get("maps.asm")! + (`\n\nSECTION "Editor Map ${constant}", ROMX\n\nINCLUDE "${paths[0]}"\nINCLUDE "${paths[1]}"\nINCLUDE "${paths[2]}"\n${name}_Blocks: INCBIN "${paths[3]}"\n`).replace(/\n/g, newline));
  const newFiles = [
    `\tmap_header ${name}, ${constant}, ${current.visualization.tilesetConstant}\n\tend_map_header\n`,
    `${name}_Script:\n\tcall EnableAutoTextBoxDrawing\n\tret\n\n${name}_TextPointers:\n\tdef_text_pointers\n`,
    `\tobject_const_def\n\n${name}_Object:\n\tdb $${values.borderBlock.toString(16)} ; border block\n\n\tdef_warp_events\n${exit}\n\tdef_bg_events\n\n\tdef_object_events\n\n\tdef_warps_to ${constant}\n`,
    bytesToHex(layout),
  ];
  for (let i = 0; i < paths.length; i++) changes.push({ path: paths[i], operation: "create", contents: i === 3 ? newFiles[i] : newFiles[i].replace(/\n/g, newline), ...(i === 3 ? { encoding: "hex" as const } : {}) });
  if (values.connection && exteriorDocument) {
    const byPath = new Map(changes.map(change => [change.path, change]));
    const overlay: ProjectSource = { ...source,
      readText: async path => byPath.get(path)?.contents ?? source.readText(path),
      exists: async path => byPath.has(path) || source.exists(path),
    };
    const entrance = await loadMapWarpDocument(overlay, values.connection.exteriorMap), destination = await loadMapWarpDocument(overlay, constant);
    changes.push(...await prepareMapWarpWrites(overlay, entrance, { id: null, x: values.connection.exteriorX, y: values.connection.exteriorY, destinationMap: constant, destinationWarpId: 1, destinationDocument: destination, pair: null }));
  }
  return changes;
}
