import { createRoot } from "react-dom/client";
import { MapsTab } from "../src/MapsTab";

const map = { id: 12, constant: "ROUTE_1", displayName: "Route 1", width: 3, height: 3,
  headerLabel: "Route1", headerPath: "data/maps/headers/Route1.asm", isAlias: false, isUnused: false };
const visualization = { map, headerMapConstant: "ROUTE_1", mapSourceLabel: "Route1", tilesetConstant: "OVERWORLD", tilesetName: "Overworld",
  mapBlockPath: "maps/Route1.blk", blocksetPath: "gfx/blocksets/overworld.bst", tilesetGfxPath: "gfx/tilesets/overworld.png",
  mapBlocks: Array(9).fill(0), blockset: Array(16).fill(0), tilesetGfx: Array(16).fill(0), tileCount: 1, blockCount: 1,
  warps: [], signs: [], npcs: [] as object[], connections: [], warnings: [] };
const document = { mapConstant: "ROUTE_1", mapName: "Route 1", width: 6, height: 6, objectId: 1, maxObjects: 14,
  sprites: ["SPRITE_YOUNGSTER", ...Array.from({ length: 30 }, (_, i) => `SPRITE_CHARACTER_${i}`)],
  spriteNote: "Compatible sprites", dialogueOptions: [], occupied: [], sources: [] };
const fixture = window as unknown as { npcInvoke(command: string, args?: Record<string, unknown>): Promise<unknown>; npcSaves: unknown[]; npcRefreshes: number };
fixture.npcSaves = [];
fixture.npcRefreshes = 0;
fixture.npcInvoke = async (command, args) => {
  switch (command) {
    case "get_map_index": return [map];
    case "get_map_visualization": fixture.npcRefreshes++; return structuredClone(visualization);
    case "get_map_npc_create_document": return structuredClone(document);
    case "create_map_npc": {
      fixture.npcSaves.push(args);
      const values = args!.values as { x: number; y: number; sprite: string; movement: string; direction: string };
      visualization.npcs = [{ id: 1, objectConstant: "ROUTE_1_EDITOR_NPC_1", x: values.x, y: values.y,
        spriteConstant: values.sprite, movementConstant: values.movement, directionOrRangeConstant: values.direction,
        textConstant: "TEXT_ROUTE_1_EDITOR_NPC_1", textLabel: "Route1EditorNpc1Text", scriptPath: "scripts/Route1.asm",
        dialoguePath: "scripts/Route1.asm", dialogueLabel: "Route1EditorNpc1Text" }];
      return { canUndo: true, canRedo: false };
    }
    case "get_text_leaf_documents": return [];
    default: throw new Error(`Unexpected UI command: ${command}`);
  }
};
createRoot(window.document.getElementById("root")!).render(<MapsTab project={{ path: "fixture", storageKey: "fixture", valid: true, projectName: "pokeyellow" }}
  encounters={[]} fishingDocument={null} pokemonIndex={[]} focusMapConstant="ROUTE_1"
  onOpenWalkingEncounter={() => {}} onOpenFishing={() => {}} onOpenScript={() => {}} />);
