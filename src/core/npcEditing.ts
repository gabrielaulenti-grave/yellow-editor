import { interactionBranches, type InteractionAction } from "./interactionSequence";
import { scenePlayerStarts } from "./interactionScene";
import { validateNpcSpriteMovement } from "./npcSprites";
import { hashText } from "./history";
import { loadMapNpcSourceState } from "./npcCreation";
import { evaluateRgbdsExpression, projectConstantCatalogFromSources } from "./projectConstants";
import { loadScriptInteractionDocument, prepareScriptInteractionWrites, type ManagedInteraction } from "./scriptInteractions";
import type { MapNpcEditDocument, MapNpcEditValues, ProjectSource, TextWriteRequest } from "./types";

function ownedCode(text: string): string {
  return text.replace(/^([A-Za-z_]\w*):\r?\n\s*text_asm\r?\n\s*; yellow-editor-interaction: [^\n]*\n[\s\S]*?; yellow-editor-interaction-code-end \1\r?\n/gm, "");
}
async function inspect(source: ProjectSource, mapConstant: string, objectId: number) {
  if (!Number.isInteger(objectId) || objectId < 1) throw new Error("Choose an existing NPC.");
  const state = await loadMapNpcSourceState(source, mapConstant, objectId), base = state.document;
  const row = state.events[objectId - 1];
  if (!row) throw new Error("This NPC no longer exists. Refresh the map.");
  const objectConstant = [...state.objects.matchAll(/^\s*const_export (\w+)\s*$/gm)][objectId - 1]?.[1];
  if (!objectConstant) throw new Error("This object has no stable map ID.");
  const models = [...state.script.matchAll(/^\s*; yellow-editor-interaction: (.*)$/gm)].map(match => JSON.parse(match[1]) as ManagedInteraction);
  const ownerLabel = state.pointers.find(pointer => pointer.constant === row[5])?.label;
  const linked = models.filter(model => model.version === 3 && model.scene && (model.label === ownerLabel || model.scene.nodes.some(node => node.npc === objectConstant || (node.action?.kind === "visibility" || node.action?.kind === "emote") && node.action.npc === objectConstant) || model.values.scene?.hiddenNpcs.includes(objectConstant)));
  const nativeRefs = state.files.filter(file => /^(scripts|engine|home)\//.test(file.path) && new RegExp(`\\b${objectConstant}\\b`).test(ownedCode(file.contents).split(/\r?\n/).map(line => line.split(";", 1)[0]).join("\n")));
  const legacy = models.some(model => model.version !== 3 && model.values.movement?.npc === objectConstant);
  const validDirection = row[3] === "STAY" ? ["DOWN", "UP", "LEFT", "RIGHT"].includes(row[4]) : row[3] === "WALK" && ["ANY_DIR", "UP_DOWN", "LEFT_RIGHT"].includes(row[4]);
  const reason = row.length !== 6 ? "Trainer and item objects keep their specialized editors; their extra fields cannot be changed here."
    : !validDirection ? "This NPC uses a specialized movement mode. Review its script before repositioning it."
    : legacy ? "This NPC has a legacy approach/return route. Upgrade it to walking scene actions before moving it."
    : nativeRefs.length ? `This NPC is controlled by an existing script (${nativeRefs[0].path}). Its scripted placement must be reviewed before editing.` : null;
  const constants = new Map(projectConstantCatalogFromSources(state.files.filter(file => file.path.startsWith("constants/"))).constants.map(entry => [entry.symbol, entry.value]));
  const tilesetConstant = state.read(`data/maps/headers/${state.name}.asm`).match(/map_header\s+\w+,\s*\w+,\s*(\w+)/)?.[1];
  const tilesets = [...state.read("data/tilesets/tileset_headers.asm").matchAll(/^\s*tileset\s+(\w+),/gm)].map(match => match[1]);
  const tileset = tilesetConstant ? tilesets[constants.get(tilesetConstant)!] : null;
  const collision = state.read("data/tilesets/collision_tile_ids.asm");
  const passable = tileset ? collision.slice(collision.indexOf(`${tileset}_Coll::`)).match(/coll_tiles\s+([^\r\n;]+)/)?.[1].split(",").map(value => evaluateRgbdsExpression(value.trim(), constants)) : null;
  const graphics = state.read("gfx/tilesets.asm");
  const asset = tileset ? graphics.slice(graphics.indexOf(`${tileset}_Block::`)).match(/INCBIN "([^"]+)"/)?.[1] : null;
  if (!asset || !passable || passable.some(value => value === null)) throw new Error("Cannot verify the map's placement surfaces.");
  const blockPath = `maps/${state.name}.blk`;
  const [blocks, blockset] = await Promise.all([source.readBytes(blockPath), source.readBytes(asset)]);
  const walkable: MapNpcEditDocument["walkable"] = [];
  for (let y = 0; y < base.height; y++) for (let x = 0; x < base.width; x++) {
    if (passable.includes(blockset[blocks[Math.floor(y / 2) * (base.width / 2) + Math.floor(x / 2)] * 16 + (y % 2 * 2 + 1) * 4 + x % 2 * 2])) walkable.push({ x, y });
  }
  const occupied = state.events.flatMap((event, index) => index + 1 === objectId ? [] : [{ x: +event[0], y: +event[1] }]);
  for (const match of state.objects.matchAll(/^\s*(?:warp_event|bg_event)\s+(\d+),\s*(\d+)/gm)) occupied.push({ x: +match[1], y: +match[2] });
  // Hash every assembly source: native-script ownership checks, scene engine
  // contracts and collision/sprite budgets must not change while editing.
  const hashes = await Promise.all(state.files.map(async file => ({ path: file.path, hash: await hashText(file.contents) })));
  const binaryHashes = await Promise.all([[blockPath, blocks], [asset, blockset]].map(async ([path, bytes]) => ({ path: path as string, hash: await hashText(Array.from(bytes as Uint8Array).join(",")) })));
  const document: MapNpcEditDocument = {
    mapConstant, mapName: base.mapName, objectId, objectConstant, width: base.width, height: base.height,
    sprites: base.sprites, stationarySprites: base.stationarySprites, spriteNote: base.spriteNote, occupied, walkable, reason,
    linkedScenes: linked.map(model => ({ label: model.label, playerX: model.values.scene!.playerX, playerY: model.values.scene!.playerY })),
    values: { x: +row[0], y: +row[1], sprite: row[2], movement: row[3] as "STAY" | "WALK", direction: row[4], moveSceneStart: linked.length > 0 },
    sources: [...hashes, ...binaryHashes],
  };
  return { state, document, models };
}
export async function loadMapNpcEditDocument(source: ProjectSource, mapConstant: string, objectId: number): Promise<MapNpcEditDocument> {
  return (await inspect(source, mapConstant, objectId)).document;
}
export async function prepareMapNpcEditWrites(source: ProjectSource, document: MapNpcEditDocument, values: MapNpcEditValues): Promise<TextWriteRequest[]> {
  const current = await inspect(source, document.mapConstant, document.objectId), d = current.document, state = current.state;
  if (JSON.stringify(d.sources) !== JSON.stringify(document.sources)) throw new Error("NPC sources changed while the form was open. Reopen Edit NPC before saving.");
  if (d.reason) throw new Error(d.reason);
  if (!Number.isInteger(values.x) || !Number.isInteger(values.y) || values.x < 0 || values.y < 0 || values.x >= Math.min(d.width, 252) || values.y >= Math.min(d.height, 252)) throw new Error("Choose a whole-number position inside this map.");
  const moved = values.x !== d.values.x || values.y !== d.values.y;
  if (moved && !d.walkable.some(point => point.x === values.x && point.y === values.y)) throw new Error("Choose walkable ground for the NPC.");
  if (moved && d.occupied.some(point => point.x === values.x && point.y === values.y)) throw new Error("This position contains an object, warp or sign.");
  if (!d.sprites.includes(values.sprite)) throw new Error("Choose a sprite compatible with this map.");
  validateNpcSpriteMovement(d.stationarySprites, values.sprite, values.movement, values.direction);
  const directions = values.movement === "STAY" ? ["DOWN", "UP", "LEFT", "RIGHT"] : values.movement === "WALK" ? ["ANY_DIR", "UP_DOWN", "LEFT_RIGHT"] : [];
  if (!directions.includes(values.direction) || typeof values.moveSceneStart !== "boolean") throw new Error("Choose a supported movement and facing direction.");
  if (d.linkedScenes.length && values.movement !== "STAY") throw new Error("An NPC used in walking or visibility scenes must stay stationary.");
  const changed = new Map<string, string>();
  let index = 0;
  const objects = state.objects.replace(/^(\s*object_event\s+)([^\r\n;]+)(.*)$/gm, (all, prefix: string, fields: string, suffix: string) => {
    if (++index !== d.objectId) return all;
    const valuesByField = [String(values.x), String(values.y), values.sprite, values.movement, values.direction];
    const args = fields.split(",");
    for (let i = 0; i < 5; i++) if (args[i].trim() !== valuesByField[i]) args[i] = args[i].replace(/\S(?:[\s\S]*\S)?/, valuesByField[i]);
    return prefix + args.join(",") + suffix;
  });
  if (index !== state.events.length) throw new Error("The object table changed unexpectedly.");
  changed.set(state.objectPath, objects);
  const overlay: ProjectSource = { ...source, readText: async path => changed.get(path) ?? source.readText(path) };
  // Regenerate and validate every authored scene on the map: even an NPC that
  // has no actions may become a blocker in another actor's route.
  for (const model of current.models) {
    try {
      const sceneDoc = await loadScriptInteractionDocument(overlay, state.scriptPath, model.label);
      const next = structuredClone(sceneDoc.values);
      if (moved && values.moveSceneStart && d.linkedScenes.some(entry => entry.label === model.label) && next.scene) {
        const dx = values.x - d.values.x, dy = values.y - d.values.y;
        next.scene.playerX += dx; next.scene.playerY += dy;
        next.scene.additionalStarts?.forEach(point => { point.x += dx; point.y += dy; });
        next.scene.automaticStarts?.forEach(point => { point.x += dx; point.y += dy; });
        const shiftPartner = (actions: InteractionAction[]) => actions.forEach(action => {
          if (action.kind === "partner-move") { action.x += dx; action.y += dy; }
          if (action.kind === "if-position" && action.test.mode === "tile") { action.test.x += dx; action.test.y += dy; }
          interactionBranches(action).forEach(([branch]) => shiftPartner(branch));
        });
        shiftPartner(next.actions ?? []);
      }
      if (moved && values.movement === "STAY" && next.scene && scenePlayerStarts(next.scene).some(point => point.x === values.x && point.y === values.y) && !next.scene.hiddenNpcs.includes(d.objectConstant)) {
        throw new Error("The NPC would occupy this scene's player start or coordinate trigger.");
      }
      for (const write of await prepareScriptInteractionWrites(overlay, sceneDoc, next)) changed.set(write.path, write.contents);
    } catch (error) { throw new Error(`Cannot save this NPC placement because interaction ${model.label} would be invalid: ${String(error)} Choose another position or adjust its scene first.`); }
  }
  return (await Promise.all([...changed].map(async ([path, contents]) => {
    const original = state.read(path);
    return contents === original ? null : { path, contents, expectedHash: await hashText(original) };
  }))).filter(write => write !== null);
}
