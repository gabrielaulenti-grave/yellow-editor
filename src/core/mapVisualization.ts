import type {
  MapIndexEntry,
  MapVisualization,
  ProjectSource,
} from "./types";
import { convertGen1PngToTiles } from "./gen1Graphics";

const MAP_CONSTANTS_PATH = "constants/map_constants.asm";
const MAP_POINTERS_PATH = "data/maps/map_header_pointers.asm";
const MAPS_ASM_PATH = "maps.asm";
const TILESET_CONSTANTS_PATH = "constants/tileset_constants.asm";
const TILESET_HEADERS_PATH = "data/tilesets/tileset_headers.asm";
const TILESET_GFX_PATH = "gfx/tilesets.asm";

interface BinaryAssetSpec {
  path: string;
  paddingAfter: number;
}

function codeOnly(line: string): string {
  return (line.split(";", 1)[0] ?? "").trim();
}

function titleCaseMapConstant(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => {
      if (part === "SS") return "S.S.";
      if (/^(?:B\dF|\dF|\dFROOMS)$/i.test(part)) return part.toUpperCase();
      if (/^\d+$/.test(part)) return part;
      return part[0] + part.slice(1).toLowerCase();
    })
    .join(" ");
}

function parseAsmInteger(value: string): number | null {
  const token = value.trim();
  if (/^\$[0-9a-f]+$/i.test(token)) {
    return Number.parseInt(token.slice(1), 16);
  }
  if (/^\d+$/.test(token)) {
    return Number.parseInt(token, 10);
  }
  return null;
}

function parseAsmSize(expression: string): number | null {
  const factors = expression
    .split("*")
    .map((part) => parseAsmInteger(part))
    .filter((value): value is number => value !== null);
  if (factors.length !== expression.split("*").length) return null;
  return factors.reduce((product, value) => product * value, 1);
}

function parseBinaryAssets(contents: string): Map<string, BinaryAssetSpec> {
  const assets = new Map<string, BinaryAssetSpec>();
  let pendingLabels: string[] = [];
  let activeLabels: string[] = [];

  for (const rawLine of contents.split(/\r?\n/)) {
    let directive = codeOnly(rawLine);
    if (!directive) continue;

    const labelMatch = directive.match(/^([A-Za-z0-9_]+):{1,2}\s*(.*)$/);
    if (labelMatch) {
      activeLabels = [];
      pendingLabels.push(labelMatch[1]);
      directive = labelMatch[2].trim();
      if (!directive) continue;
    }

    const incbinMatch = directive.match(/^INCBIN\s+"([^"]+)"/i);
    if (incbinMatch) {
      const labels = [...pendingLabels];
      for (const label of labels) {
        assets.set(label, { path: incbinMatch[1], paddingAfter: 0 });
      }
      activeLabels = labels;
      pendingLabels = [];
      continue;
    }

    const dsMatch = directive.match(/^ds\s+(.+)$/i);
    if (dsMatch && activeLabels.length > 0) {
      const size = parseAsmSize(dsMatch[1]);
      if (size !== null) {
        for (const label of activeLabels) {
          const asset = assets.get(label);
          if (asset) asset.paddingAfter += size;
        }
        continue;
      }
    }

    pendingLabels = [];
    activeLabels = [];
  }

  return assets;
}

function parseTilesetLabels(constantsText: string, headersText: string): Map<string, string> {
  const constants = constantsText
    .split(/\r?\n/)
    .map((line) => codeOnly(line).match(/^const\s+([A-Z0-9_]+)\b/)?.[1] ?? null)
    .filter((value): value is string => Boolean(value));

  const labels = headersText
    .split(/\r?\n/)
    .map((line) => codeOnly(line).match(/^tileset\s+([A-Za-z0-9_]+)\s*,/)?.[1] ?? null)
    .filter((value): value is string => Boolean(value));

  const result = new Map<string, string>();
  for (let index = 0; index < Math.min(constants.length, labels.length); index += 1) {
    result.set(constants[index], labels[index]);
  }
  return result;
}

function parseMapConnections(
  headerText: string,
  index: MapIndexEntry[],
): MapVisualization["connections"] {
  const connections: MapVisualization["connections"] = [];

  for (const rawLine of headerText.split(/\r?\n/)) {
    const match = codeOnly(rawLine).match(
      /^connection\s+(north|south|east|west)\s*,\s*[A-Za-z0-9_]+\s*,\s*([A-Z0-9_]+)\s*,\s*(-?\d+)\b/i,
    );
    if (!match) continue;

    const destination = index.find((entry) => entry.constant === match[2]);
    connections.push({
      direction: match[1].toLowerCase() as "north" | "south" | "east" | "west",
      destinationMapConstant: match[2],
      destinationMapDisplayName: destination?.displayName ?? null,
      offset: Number.parseInt(match[3], 10),
    });
  }

  return connections;
}

function parseWarpEvents(
  objectText: string,
  index: MapIndexEntry[],
): MapVisualization["warps"] {
  const warps: MapVisualization["warps"] = [];

  for (const rawLine of objectText.split(/\r?\n/)) {
    const match = codeOnly(rawLine).match(
      /^warp_event\s+(-?\d+)\s*,\s*(-?\d+)\s*,\s*([A-Z0-9_]+)\s*,\s*(\d+)\b/i,
    );
    if (!match) continue;

    const isLastMap = match[3].toUpperCase() === "LAST_MAP";
    const destinationMapConstant = isLastMap ? null : match[3];
    const destination = destinationMapConstant
      ? index.find((entry) => entry.constant === destinationMapConstant)
      : null;

    warps.push({
      id: warps.length + 1,
      x: Number.parseInt(match[1], 10),
      y: Number.parseInt(match[2], 10),
      destinationMapConstant,
      destinationMapDisplayName: destination?.displayName ?? null,
      destinationWarpId: Number.parseInt(match[4], 10),
      isLastMap,
    });
  }

  return warps;
}

function parseTextPointers(scriptText: string): Map<string, string> {
  const pointers = new Map<string, string>();
  for (const rawLine of scriptText.split(/\r?\n/)) {
    const match = codeOnly(rawLine).match(
      /^dw_const\s+([A-Za-z_.][A-Za-z0-9_.]*)\s*,\s*(TEXT_[A-Z0-9_]+)\b/i,
    );
    if (match) pointers.set(match[2], match[1]);
  }
  return pointers;
}

function parseSignEvents(
  objectText: string,
  scriptPath: string,
  scriptText: string | null,
): MapVisualization["signs"] {
  const signs: MapVisualization["signs"] = [];
  const textPointers = scriptText ? parseTextPointers(scriptText) : new Map<string, string>();

  for (const rawLine of objectText.split(/\r?\n/)) {
    const match = codeOnly(rawLine).match(
      /^bg_event\s+(-?\d+)\s*,\s*(-?\d+)\s*,\s*(TEXT_[A-Z0-9_]+)\b/i,
    );
    if (!match) continue;
    signs.push({
      id: signs.length + 1,
      x: Number.parseInt(match[1], 10),
      y: Number.parseInt(match[2], 10),
      textConstant: match[3],
      textLabel: textPointers.get(match[3]) ?? null,
      scriptPath,
    });
  }

  return signs;
}

function parseObjectConstants(objectText: string): string[] {
  return objectText
    .split(/\r?\n/)
    .map((line) => codeOnly(line).match(/^const_export\s+([A-Z0-9_]+)\b/i)?.[1] ?? null)
    .filter((value): value is string => Boolean(value));
}

function splitAsmArguments(value: string): string[] {
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

function globalLabelSource(contents: string, label: string): string | null {
  const lines = contents.split(/\r?\n/);
  const escaped = label.replace(/[.*+?^$()|[\]\\{}]/g, "\\function withTrailingPadding(
  bytes: Uint8Array,
  paddingAfter: number,
): Uint8Array {");
  const pattern = new RegExp("^\\s*" + escaped + ":{1,2}\\s*(?:;.*)?$");
  const start = lines.findIndex((line) => pattern.test(line));
  if (start < 0) return null;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\s*[A-Za-z_][A-Za-z0-9_]*:{1,2}\s*(?:;.*)?$/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function resolveNpcDialogueTarget(
  textLabel: string | null,
  scriptPath: string,
  scriptText: string | null,
  alternateScriptPath: string,
  alternateScriptText: string | null,
): { path: string; label: string | null } {
  if (!textLabel) return { path: scriptPath, label: null };
  if (!scriptText || !alternateScriptText) {
    return { path: scriptPath, label: textLabel };
  }

  const wrapper = globalLabelSource(scriptText, textLabel);
  if (!wrapper) return { path: scriptPath, label: textLabel };

  const farcalls = [...new Set(
    [...wrapper.matchAll(/^\s*farcall\s+([A-Za-z_][A-Za-z0-9_]*)\b/gm)]
      .map((match) => match[1]),
  )];
  if (
    farcalls.length === 1
    && globalLabelSource(alternateScriptText, farcalls[0])
  ) {
    return { path: alternateScriptPath, label: farcalls[0] };
  }

  return { path: scriptPath, label: textLabel };
}

function parseNpcEvents(
  objectText: string,
  scriptPath: string,
  scriptText: string | null,
  alternateScriptPath: string,
  alternateScriptText: string | null,
): MapVisualization["npcs"] {
  const npcs: MapVisualization["npcs"] = [];
  const objectConstants = parseObjectConstants(objectText);
  const textPointers = scriptText ? parseTextPointers(scriptText) : new Map<string, string>();
  let objectIndex = 0;

  for (const rawLine of objectText.split(/\r?\n/)) {
    const clean = codeOnly(rawLine);
    if (!/^object_event\b/i.test(clean)) continue;

    const args = splitAsmArguments(clean.replace(/^object_event\s+/i, ""));
    const id = objectIndex + 1;
    const objectConstant = objectConstants[objectIndex] ?? null;
    objectIndex += 1;

    // Six arguments is the ordinary NPC form. Items add one more field and
    // trainers add two, so keep those for their dedicated map layers.
    if (args.length !== 6) continue;
    if (!/^-?\d+$/.test(args[0]) || !/^-?\d+$/.test(args[1])) continue;

    const textConstant = args[5];
    const textLabel = textPointers.get(textConstant) ?? null;
    const dialogueTarget = resolveNpcDialogueTarget(
      textLabel,
      scriptPath,
      scriptText,
      alternateScriptPath,
      alternateScriptText,
    );

    npcs.push({
      id,
      objectConstant,
      x: Number.parseInt(args[0], 10),
      y: Number.parseInt(args[1], 10),
      spriteConstant: args[2],
      movementConstant: args[3],
      directionOrRangeConstant: args[4],
      textConstant,
      textLabel,
      scriptPath,
      dialoguePath: dialogueTarget.path,
      dialogueLabel: dialogueTarget.label,
    });
  }

  return npcs;
}

function withTrailingPadding(
  bytes: Uint8Array,
  paddingAfter: number,
): Uint8Array {
  if (paddingAfter <= 0) return bytes;
  const padded = new Uint8Array(bytes.length + paddingAfter);
  padded.set(bytes);
  return padded;
}

async function readBinaryAsset(
  source: ProjectSource,
  spec: BinaryAssetSpec,
): Promise<Uint8Array> {
  return withTrailingPadding(
    await source.readBytes(spec.path),
    spec.paddingAfter,
  );
}

async function readTilesetGraphics(
  source: ProjectSource,
  spec: BinaryAssetSpec,
): Promise<{ bytes: Uint8Array; sourcePath: string }> {
  if (spec.path.toLowerCase().endsWith(".2bpp")) {
    const pngPath = spec.path.replace(/\.2bpp$/i, ".png");
    if (await source.exists(pngPath)) {
      const pngBytes = await source.readBytes(pngPath);
      const generated = await convertGen1PngToTiles(pngBytes, { depth: 2 });
      return {
        bytes: withTrailingPadding(generated, spec.paddingAfter),
        sourcePath: pngPath,
      };
    }
  }

  if (await source.exists(spec.path)) {
    return {
      bytes: await readBinaryAsset(source, spec),
      sourcePath: spec.path,
    };
  }

  throw new Error(
    spec.path.toLowerCase().endsWith(".2bpp")
      ? `Neither source PNG ${spec.path.replace(/\.2bpp$/i, ".png")} nor generated tileset graphics ${spec.path} exists.`
      : `Tileset graphics file ${spec.path} does not exist.`,
  );
}

export async function parseMapIndex(source: ProjectSource): Promise<MapIndexEntry[]> {
  const [constantsText, pointersText] = await Promise.all([
    source.readText(MAP_CONSTANTS_PATH),
    source.readText(MAP_POINTERS_PATH),
  ]);

  const definitions = constantsText
    .split(/\r?\n/)
    .flatMap((line) => {
      const match = codeOnly(line).match(
        /^map_const\s+([A-Z0-9_]+)\s*,\s*(\d+)\s*,\s*(\d+)\b/,
      );
      return match
        ? [{
            constant: match[1],
            width: Number.parseInt(match[2], 10),
            height: Number.parseInt(match[3], 10),
          }]
        : [];
    });

  const pointers = pointersText
    .split(/\r?\n/)
    .flatMap((line) => {
      const match = codeOnly(line).match(/^dw\s+([A-Za-z0-9_]+)_h\b/);
      return match ? [match[1]] : [];
    });

  const pointerUseCounts = new Map<string, number>();
  for (const pointer of pointers) {
    pointerUseCounts.set(pointer, (pointerUseCounts.get(pointer) ?? 0) + 1);
  }

  return definitions.map((definition, id) => {
    const headerLabel = pointers[id] ?? null;
    return {
      id,
      constant: definition.constant,
      displayName: titleCaseMapConstant(definition.constant),
      width: definition.width,
      height: definition.height,
      headerLabel,
      headerPath: headerLabel ? `data/maps/headers/${headerLabel}.asm` : null,
      isAlias: Boolean(
        headerLabel && (pointerUseCounts.get(headerLabel) ?? 0) > 1,
      ),
      isUnused:
        definition.width === 0
        || definition.height === 0
        || definition.constant.startsWith("UNUSED_MAP_"),
    };
  });
}

export async function loadMapVisualization(
  source: ProjectSource,
  mapConstant: string,
  index?: MapIndexEntry[],
): Promise<MapVisualization> {
  const entries = index ?? await parseMapIndex(source);
  const map = entries.find((entry) => entry.constant === mapConstant);
  if (!map) {
    throw new Error(`Unknown map constant '${mapConstant}'.`);
  }
  if (!map.headerLabel || !map.headerPath) {
    throw new Error(`${map.displayName} does not have a map header pointer.`);
  }
  if (map.width <= 0 || map.height <= 0) {
    throw new Error(
      `${map.displayName} is an unused map ID with no drawable dimensions.`,
    );
  }

  const [
    headerText,
    mapsAsm,
    tilesetConstants,
    tilesetHeaders,
    tilesetGfxAsm,
  ] = await Promise.all([
    source.readText(map.headerPath),
    source.readText(MAPS_ASM_PATH),
    source.readText(TILESET_CONSTANTS_PATH),
    source.readText(TILESET_HEADERS_PATH),
    source.readText(TILESET_GFX_PATH),
  ]);

  const headerMatch = headerText.match(
    /^\s*map_header\s+([A-Za-z0-9_]+)\s*,\s*([A-Z0-9_]+)\s*,\s*([A-Z0-9_]+)\b/m,
  );
  if (!headerMatch) {
    throw new Error(`Could not parse map_header in ${map.headerPath}.`);
  }

  const mapSourceLabel = headerMatch[1];
  const headerMapConstant = headerMatch[2];
  const tilesetConstant = headerMatch[3];
  const warnings: string[] = [];
  const objectPath = `data/maps/objects/${mapSourceLabel}.asm`;
  const scriptPath = `scripts/${mapSourceLabel}.asm`;
  const alternateScriptPath = `scripts/${mapSourceLabel}_2.asm`;
  const connections = parseMapConnections(headerText, entries);
  let warps: MapVisualization["warps"] = [];
  let signs: MapVisualization["signs"] = [];
  let npcs: MapVisualization["npcs"] = [];

  if (await source.exists(objectPath)) {
    const objectText = await source.readText(objectPath);
    warps = parseWarpEvents(objectText, entries);
    const scriptText = await source.exists(scriptPath)
      ? await source.readText(scriptPath)
      : null;
    const alternateScriptText = await source.exists(alternateScriptPath)
      ? await source.readText(alternateScriptPath)
      : null;
    signs = parseSignEvents(objectText, scriptPath, scriptText);
    npcs = parseNpcEvents(
      objectText,
      scriptPath,
      scriptText,
      alternateScriptPath,
      alternateScriptText,
    );

    const movementWidth = map.width * 2;
    const movementHeight = map.height * 2;
    for (const warp of warps) {
      if (
        warp.x < 0
        || warp.y < 0
        || warp.x >= movementWidth
        || warp.y >= movementHeight
      ) {
        warnings.push(
          `Warp #${warp.id} is at (${warp.x}, ${warp.y}), outside the ${movementWidth}×${movementHeight} movement grid.`,
        );
      }
      if (
        !warp.isLastMap
        && warp.destinationMapConstant
        && !warp.destinationMapDisplayName
      ) {
        warnings.push(
          `Warp #${warp.id} points to unknown map constant ${warp.destinationMapConstant}.`,
        );
      }
    }

    for (const sign of signs) {
      if (
        sign.x < 0
        || sign.y < 0
        || sign.x >= movementWidth
        || sign.y >= movementHeight
      ) {
        warnings.push(
          `Sign #${sign.id} is at (${sign.x}, ${sign.y}), outside the ${movementWidth}×${movementHeight} movement grid.`,
        );
      }
      if (!sign.textLabel) {
        warnings.push(
          `Sign #${sign.id} uses ${sign.textConstant}, but no matching text pointer was resolved in ${scriptPath}.`,
        );
      }
    }

    for (const npc of npcs) {
      if (
        npc.x < 0
        || npc.y < 0
        || npc.x >= movementWidth
        || npc.y >= movementHeight
      ) {
        warnings.push(
          `NPC #${npc.id} is at (${npc.x}, ${npc.y}), outside the ${movementWidth}×${movementHeight} movement grid.`,
        );
      }
      if (!npc.textLabel) {
        warnings.push(
          `NPC #${npc.id} uses ${npc.textConstant}, but no matching text pointer was resolved in ${scriptPath}.`,
        );
      }
    }
  } else {
    warnings.push(
      `Map object source ${objectPath} does not exist, so warp, sign, and NPC markers are unavailable.`,
    );
  }

  for (const connection of connections) {
    if (!connection.destinationMapDisplayName) {
      warnings.push(
        `${connection.direction} connection points to unknown map constant ${connection.destinationMapConstant}.`,
      );
    }
  }

  const mapAssets = parseBinaryAssets(mapsAsm);
  const mapBlockSpec = mapAssets.get(`${mapSourceLabel}_Blocks`);
  if (!mapBlockSpec) {
    throw new Error(
      `Could not resolve ${mapSourceLabel}_Blocks to a .blk file in maps.asm.`,
    );
  }

  const tilesetLabels = parseTilesetLabels(tilesetConstants, tilesetHeaders);
  const tilesetName = tilesetLabels.get(tilesetConstant);
  if (!tilesetName) {
    throw new Error(
      `Could not match tileset constant ${tilesetConstant} to data/tilesets/tileset_headers.asm.`,
    );
  }

  const tilesetAssets = parseBinaryAssets(tilesetGfxAsm);
  const gfxSpec = tilesetAssets.get(`${tilesetName}_GFX`);
  const blocksetSpec = tilesetAssets.get(`${tilesetName}_Block`);
  if (!gfxSpec || !blocksetSpec) {
    throw new Error(
      `Could not resolve the ${tilesetName} graphics and blockset in gfx/tilesets.asm.`,
    );
  }

  const [mapBlocks, tilesetGraphics, blockset] = await Promise.all([
    readBinaryAsset(source, mapBlockSpec),
    readTilesetGraphics(source, gfxSpec),
    readBinaryAsset(source, blocksetSpec),
  ]);
  const tilesetGfx = tilesetGraphics.bytes;

  const expectedBlocks = map.width * map.height;
  if (mapBlocks.length !== expectedBlocks) {
    warnings.push(
      `The map header expects ${expectedBlocks} blocks (${map.width}×${map.height}), but ${mapBlockSpec.path} contains ${mapBlocks.length}. The preview preserves the header dimensions and leaves missing cells blank.`,
    );
  }
  if (blockset.length % 16 !== 0) {
    warnings.push(
      `${blocksetSpec.path} is ${blockset.length} bytes long, so its final 4×4 block is incomplete.`,
    );
  }
  if (tilesetGfx.length % 16 !== 0) {
    warnings.push(
      `${tilesetGraphics.sourcePath} converts to ${tilesetGfx.length} bytes, so its final 8×8 tile is incomplete.`,
    );
  }

  const tileCount = Math.floor(tilesetGfx.length / 16);
  const blockCount = Math.floor(blockset.length / 16);
  const highestTileId = blockset.length > 0 ? Math.max(...blockset) : -1;
  const highestBlockId = mapBlocks.length > 0 ? Math.max(...mapBlocks) : -1;

  if (highestTileId >= tileCount) {
    warnings.push(
      `The blockset references tile #${highestTileId}, but only ${tileCount} tiles are present after assembly padding is applied.`,
    );
  }
  if (highestBlockId >= blockCount) {
    warnings.push(
      `The map references block #${highestBlockId}, but the selected tileset only defines ${blockCount} complete blocks.`,
    );
  }

  return {
    map,
    headerMapConstant,
    mapSourceLabel,
    tilesetConstant,
    tilesetName,
    mapBlockPath: mapBlockSpec.path,
    blocksetPath: blocksetSpec.path,
    tilesetGfxPath: tilesetGraphics.sourcePath,
    objectPath,
    mapBlocks: Array.from(mapBlocks),
    blockset: Array.from(blockset),
    tilesetGfx: Array.from(tilesetGfx),
    tileCount,
    blockCount,
    warps,
    signs,
    npcs,
    connections,
    warnings,
  };
}
