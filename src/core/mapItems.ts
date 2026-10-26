import { hashText } from "./history";
import { loadMapNpcSourceState, prepareMapNpcWrites } from "./npcCreation";
import { parseItemConstantDefinitions } from "./itemConstants";
import { loadScriptInteractionDocument, prepareScriptInteractionWrites } from "./scriptInteractions";
import { sharedSceneFlag } from "./sceneFlags";
import type { MapNpcCreateDocument, ProjectSource, TextWriteRequest } from "./types";

export interface MapItemDocument { npc: MapNpcCreateDocument; items: string[] }
export interface MapItemValues { x: number; y: number; item: string; quantity: number }
export async function loadMapItemDocument(source: ProjectSource, mapConstant: string): Promise<MapItemDocument> {
  const s = await loadMapNpcSourceState(source, mapConstant);
  if (!s.document.sprites.includes("SPRITE_POKE_BALL")) throw new Error("This map has no room for Poké Ball graphics. Free a stationary sprite slot or use an NPC gift.");
  return { npc: s.document, items: parseItemConstantDefinitions(s.read("constants/item_constants.asm")).filter(i => i.id > 0 && i.id < 255).map(i => i.constant) };
}
export async function prepareMapItemWrites(source: ProjectSource, document: MapItemDocument, values: MapItemValues): Promise<TextWriteRequest[]> {
  const fresh = await loadMapItemDocument(source, document.npc.mapConstant);
  if (JSON.stringify(fresh) !== JSON.stringify(document)) throw new Error("Item placement sources changed. Reopen Place item before saving.");
  if (!fresh.items.includes(values.item) || !Number.isInteger(values.quantity) || values.quantity < 1 || values.quantity > 99) throw new Error("Choose a valid item and a quantity from 1 to 99.");
  const writes = await prepareMapNpcWrites(source, fresh.npc, { x: values.x, y: values.y, sprite: "SPRITE_POKE_BALL", movement: "STAY", direction: "DOWN", dialogue: { kind: "new", lines: ["An item!"] } });
  const changed = new Map(writes.map(w => [w.path, w.contents]));
  const staged: ProjectSource = { ...source, listFiles: source.listFiles?.bind(source), readBytes: source.readBytes.bind(source), readText: async p => changed.get(p) ?? source.readText(p), exists: async p => changed.has(p) || source.exists(p) };
  const objectPath = writes[0].path, scriptPath = writes[1].path;
  const objectRows = changed.get(objectPath)!.split(/\r?\n/).filter(l => /^\s*object_event\s+/.test(l));
  const textConstant = objectRows[fresh.npc.objectId - 1].split(",")[5].trim();
  const label = changed.get(scriptPath)!.match(new RegExp(`dw_const\\s+(\\w+)\\s*,\\s*${textConstant}\\b`))?.[1];
  if (!label) throw new Error("Could not identify the new item's interaction.");
  const interaction = await loadScriptInteractionDocument(staged, scriptPath, label);
  if (!interaction.items.includes(values.item)) throw new Error("This item is unavailable to the native delivery routine.");
  let suffix = 1, flag: ReturnType<typeof sharedSceneFlag>;
  do { flag = sharedSceneFlag(`Pickup ${fresh.npc.mapConstant.slice(0, 24)} ${fresh.npc.objectId} ${suffix++}`); }
  while (interaction.events.includes(flag.event) || interaction.sharedFlags?.some(f => f.event === flag.event));
  const condition = { event: flag.event, set: false };
  const rewardWrites = await prepareScriptInteractionWrites(staged, interaction, { ...interaction.values,
    pickup: true, once: true, showOriginal: false, reward: { item: values.item, quantity: values.quantity },
    dialogue: [`Found ${values.quantity} item${values.quantity === 1 ? "" : "s"}!`, ...(values.item.replace(/_/g, " ").match(/.{1,17}/g) ?? [])], bagFull: ["Your BAG is full."], already: ["Nothing here."],
    sharedFlags: [...(interaction.sharedFlags ?? []), flag], condition, visibleWhen: condition, events: [{ event: flag.event, set: true }],
  });
  for (const w of rewardWrites) changed.set(w.path, w.contents);
  return Promise.all([...changed].map(async ([path, contents]) => ({ path, contents, expectedHash: await hashText(await source.readText(path)) })));
}
