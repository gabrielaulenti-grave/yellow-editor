import type {
  MapIndexEntry,
  MapVisualization,
  ProjectSource,
} from "./types";
import { convertGen1PngToTiles } from "./gen1Graphics";
import { evaluateRgbdsExpression, readProjectRgbdsSources } from "./projectConstants";
import { existingObjectEncodingReason, objectSourceConstants, resolveObjectExpression } from "./mapObjectAnalysis";

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

export function parseBinaryAssets(contents: string): Map<string, BinaryAssetSpec> {
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

function parseWarpEvents(objectText: string, index: MapIndexEntry[], constants = new Map<string, number>()): MapVisualization["warps"] {
  return objectText.split(/\r?\n/).flatMap(line => {
    const m = codeOnly(line).match(/^warp_event\s+(.+)$/); if (!m) return [];
    const args = splitAsmArguments(m[1]); if (args.length !== 4) return [];
    const destinationId = evaluateRgbdsExpression(args[2], constants);
    const isLastMap = args[2] === "LAST_MAP" || destinationId === -1 || destinationId === 255;
    const destination = index.find(entry => entry.constant === args[2] || entry.id === destinationId);
    return [{ id: 0, x: evaluateRgbdsExpression(args[0], constants) ?? Number.NaN, y: evaluateRgbdsExpression(args[1], constants) ?? Number.NaN, destinationMapConstant: isLastMap ? null : destination?.constant ?? args[2], destinationMapDisplayName: destination?.displayName ?? null, destinationWarpId: evaluateRgbdsExpression(args[3], constants) ?? Number.NaN, isLastMap }];
  }).map((w, i) => ({ ...w, id: i + 1 }));
}

function parseTextPointers(scriptText: string): Map<string, string> {
  const pointers = new Map<string, string>();
  const all = scriptText.split(/\r?\n/), start = all.findIndex(l => /^\w+_TextPointers:{1,2}$/.test(codeOnly(l)));
  let end = start + 1; while (end < all.length && !/^[A-Za-z_]\w*:{1,2}$/.test(codeOnly(all[end]))) end++;
  let slot = 0;
  for (const rawLine of start < 0 ? all : all.slice(start + 1, end)) {
    const match = codeOnly(rawLine).match(
      /^dw_const\s+([A-Za-z_.][A-Za-z0-9_.]*)\s*,\s*([A-Za-z_]\w*)\b/i,
    );
    const plain = start >= 0 && codeOnly(rawLine).match(/^dw\s+([A-Za-z_]\w*)$/);
    if (match) { pointers.set(match[2], match[1]); pointers.set(String(++slot), match[1]); }
    else if (plain) pointers.set(String(++slot), plain[1]);
  }
  return pointers;
}

function parseSignEvents(objectText: string, scriptPath: string, scriptText: string | null, constants = new Map<string, number>()): MapVisualization["signs"] {
  const pointers = scriptText ? parseTextPointers(scriptText) : new Map<string, string>();
  const numbers = new Map(constants); let slot = 0;
  for (const [name] of pointers) if (!/^\d+$/.test(name)) numbers.set(name, ++slot);
  return objectText.split(/\r?\n/).flatMap(line => {
    const m = codeOnly(line).match(/^bg_event\s+(.+)$/); if (!m) return [];
    const args = splitAsmArguments(m[1]); if (args.length !== 3) return [];
    const textId = resolveObjectExpression(args[2], numbers, scriptText ? [{ path: scriptPath, contents: scriptText }] : []);
    return [{ id: 0, x: evaluateRgbdsExpression(args[0], constants) ?? Number.NaN, y: evaluateRgbdsExpression(args[1], constants) ?? Number.NaN, textConstant: args[2], textLabel: pointers.get(args[2]) ?? (textId !== null ? pointers.get(String(textId)) : null) ?? null, scriptPath }];
  }).map((sign, i) => ({ ...sign, id: i + 1 }));
}

function parseObjectConstants(objectText: string): string[] {
  return objectText
    .split(/\r?\n/)
    .map((line) => codeOnly(line).match(/^const(?:_export)?\s+([A-Za-z_]\w*)\b/i)?.[1] ?? null)
    .filter((value): value is string => Boolean(value));
}

function splitAsmArguments(value: string): string[] {
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

function globalLabelSource(contents: string, label: string): string | null {
  const lines = contents.split(/\r?\n/);
  const escaped = label.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");
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

export function parseNpcEvents(
  objectText: string,
  scriptPath: string,
  scriptText: string | null,
  alternateScriptPath: string,
  alternateScriptText: string | null,
  constants = new Map<string, number>(),
): MapVisualization["npcs"] {
  const npcs: MapVisualization["npcs"] = [];
  const objectConstants = parseObjectConstants(objectText);
  const textPointers = scriptText ? parseTextPointers(scriptText) : new Map<string, string>();
  let objectIndex = 0;
  let placedTrainerIds = new Set<number>();
  const placedItems = new Map<string, string>();
  for (const record of scriptText?.matchAll(/^\s*; yellow-editor-interaction: (.+)$/gm) ?? []) {
    try { const model = JSON.parse(record[1]) as { label: string; values?: { pickup?: boolean; reward?: { item: string } } }; if (model.values?.pickup && model.values.reward) placedItems.set(model.label, model.values.reward.item); }
    catch { /* Keep the object visible; its interaction editor reports malformed metadata. */ }
  }
  try {
    const record = scriptText?.match(/^; yellow-editor-map-trainers: (.+)$/m);
    if (record) placedTrainerIds = new Set((JSON.parse(record[1]) as { trainers: Array<{ id: number }> }).trainers.map(t => t.id));
  } catch { /* The dedicated trainer editor reports malformed managed source. */ }

  for (const [sourceLine, rawLine] of objectText.split(/\r?\n/).entries()) {
    const clean = codeOnly(rawLine);
    if (!/^object_event\b/i.test(clean)) continue;

    const args = splitAsmArguments(clean.replace(/^object_event\s+/i, ""));
    const id = objectIndex + 1;
    const objectConstant = objectConstants[objectIndex] ?? null;
    objectIndex += 1;

    // Object slots are stable across ordinary NPCs, native pickups, trainers
    // and special encounters. Displaying one must not depend on edit support.
    const classValue = args[6] && evaluateRgbdsExpression(args[6], constants);
    const className = args.length === 8 ? [...constants].find(([name, value]) => name.startsWith("#opponent:") && value === classValue)?.[0].slice("#opponent:".length) ?? (/^OPP_[A-Z0-9_]+$/.test(args[6]) ? args[6].slice(4) : null) : null;
    const party = args[7] && evaluateRgbdsExpression(args[7], constants);
    const trainerPartyId = className && typeof party === "number" ? `${className}:${party}` : undefined;
    let objectKind: NonNullable<MapVisualization["npcs"][number]["objectKind"]> = trainerPartyId ? "trainer" : args.length === 7 ? "item" : args.length === 6 ? "npc" : "special";
    if (args.length < 6) continue;
    const x = evaluateRgbdsExpression(args[0], constants), y = evaluateRgbdsExpression(args[1], constants);

    const textConstant = args[5];
    const textNumbers = new Map(constants);
    let textSlot = 0; for (const [name] of textPointers) if (!/^\d+$/.test(name)) textNumbers.set(name, ++textSlot);
    const textId = resolveObjectExpression(textConstant, textNumbers, scriptText ? [{ path: scriptPath, contents: scriptText }] : []);
    const textLabel = textPointers.get(textConstant) ?? (textId !== null ? textPointers.get(String(textId)) : null) ?? null;
    const placedItem = textLabel ? placedItems.get(textLabel) : undefined;
    if (placedItem) objectKind = "item";
    const dialogueTarget = resolveNpcDialogueTarget(
      textLabel,
      scriptPath,
      scriptText,
      alternateScriptPath,
      alternateScriptText,
    );

    npcs.push({
      sourceLine: sourceLine + 1,
      objectKind, nativeObject: args.length !== 6 && !placedTrainerIds.has(id),
      ...(trainerPartyId ? { managedTrainer: placedTrainerIds.has(id) } : {}),
      ...(objectKind === "item" ? { itemConstant: placedItem ?? args[6] } : {}),
      ...(trainerPartyId ? { trainerPartyId } : {}),
      id,
      objectConstant,
      x: x ?? Number.NaN,
      y: y ?? Number.NaN,
      ...(x === null || y === null ? { sourceIssue: "The position expression could not be resolved; this object stays listed without an invented map position." } : {}),
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

  const rows = constantsText.split(/\r?\n/).flatMap(line => {
    const m = codeOnly(line).match(/^map_const\s+([A-Z0-9_]+)\s*,\s*([^,]+),\s*([^,]+)$/);
    return m ? [{ constant: m[1], width: m[2], height: m[3] }] : [];
  });
  let symbols = objectSourceConstants([{ path: MAP_CONSTANTS_PATH, contents: constantsText }]);
  if (rows.some(r => evaluateRgbdsExpression(r.width, symbols) === null || evaluateRgbdsExpression(r.height, symbols) === null) && source.listFiles) symbols = objectSourceConstants(await readProjectRgbdsSources(source));
  const definitions = rows.map(row => ({ constant: row.constant, width: evaluateRgbdsExpression(row.width, symbols) ?? Number.NaN, height: evaluateRgbdsExpression(row.height, symbols) ?? Number.NaN }));

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
  if (!Number.isInteger(map.width) || !Number.isInteger(map.height)) throw new Error(`${map.displayName}: its dimension expressions could not be resolved. Other maps remain available.`);
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

    const scriptText = await source.exists(scriptPath)
      ? await source.readText(scriptPath)
      : null;
    const alternateScriptText = await source.exists(alternateScriptPath)
      ? await source.readText(alternateScriptPath)
      : null;
    let sourceNumbers = new Map<string, number>();
    const textPointers = scriptText ? parseTextPointers(scriptText) : new Map<string, string>();
    const needsExpressions = objectText.split(/\r?\n/).some(line => {
      const macro = codeOnly(line).match(/^(object_event|warp_event|bg_event)\s+(.+)/);
      const args = macro?.[2].split(",").map(a => a.trim());
      if (!args) return false;
      if (args.slice(0, 2).some(a => evaluateRgbdsExpression(a, sourceNumbers) === null)) return true;
      if (macro?.[1] === "warp_event") return evaluateRgbdsExpression(args[3], sourceNumbers) === null || args[2] !== "LAST_MAP" && !entries.some(e => e.constant === args[2]);
      const textId = args[macro?.[1] === "object_event" ? 5 : 2];
      if (!textPointers.has(textId) && evaluateRgbdsExpression(textId, sourceNumbers) === null) return true;
      return macro?.[1] === "object_event" && args.length === 8 && (!/^OPP_/.test(args[6]) || evaluateRgbdsExpression(args[7], sourceNumbers) === null);
    });
    if (needsExpressions && source.listFiles) sourceNumbers = objectSourceConstants(await readProjectRgbdsSources(source));
    entries.forEach(entry => { sourceNumbers.set(entry.constant, entry.id); sourceNumbers.set(`${entry.constant}_WIDTH`, entry.width); sourceNumbers.set(`${entry.constant}_HEIGHT`, entry.height); });
    warps = parseWarpEvents(objectText, entries, sourceNumbers);
    signs = parseSignEvents(objectText, scriptPath, scriptText, sourceNumbers);
    npcs = parseNpcEvents(
      objectText,
      scriptPath,
      scriptText,
      alternateScriptPath,
      alternateScriptText,
      sourceNumbers,
    );
    for (const npc of npcs) npc.sourcePath = objectPath;
    if (await source.exists("macros/scripts/maps.asm")) {
      const probe = new Map(sourceNumbers); if (!probe.has("TRAINER")) probe.set("TRAINER", 64); if (!probe.has("ITEM")) probe.set("ITEM", 128);
      const reason = existingObjectEncodingReason(await source.readText("macros/scripts/maps.asm"), probe);
      if (reason) { warnings.push(reason); for (const npc of npcs) { npc.sourceIssue = reason; npc.x = Number.NaN; npc.y = Number.NaN; npc.objectKind = "special"; npc.trainerPartyId = undefined; npc.itemConstant = undefined; npc.nativeObject = true; } }
    }
    if (await source.exists("data/maps/toggleable_objects.asm")) {
      const toggles = await source.readText("data/maps/toggleable_objects.asm");
      const section = toggles.match(new RegExp(`^[ \\t]*toggleable_objects_for[ \\t]+${map.constant}[ \\t]*(?:;[^\\r\\n]*)?\\r?\\n([\\s\\S]*?)(?=^[ \\t]*toggleable_objects_for\\b|$(?![\\s\\S]))`, "m"))?.[1] ?? "";
      for (const npc of npcs) {
        const state = npc.objectConstant && section.match(new RegExp(`\\btoggle_object_state[ \\t]+${npc.objectConstant},[ \\t]*(ON|OFF)\\b`))?.[1];
        if (state) npc.initiallyHidden = state === "OFF";
      }
    }

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
