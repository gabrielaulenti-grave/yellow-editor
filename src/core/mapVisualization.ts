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
    mapBlocks: Array.from(mapBlocks),
    blockset: Array.from(blockset),
    tilesetGfx: Array.from(tilesetGfx),
    tileCount,
    blockCount,
    warnings,
  };
}
