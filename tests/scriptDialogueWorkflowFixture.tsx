import { loadMapCreateDocument, prepareMapCreateWrites } from "../src/core/mapCreation";
import { loadMapEncounterDocument, prepareMapEncounterWrites } from "../src/core/mapEncounters";
import { loadMapItemDocument, prepareMapItemWrites } from "../src/core/mapItems";
import { loadNativeMapObjectDocument, prepareNativeMapObjectWrites, type NativeMapObjectDocument } from "../src/core/nativeMapObjects";
import { loadMapTrainerDocument, prepareMapTrainerWrites, type MapTrainerDocument } from "../src/core/mapTrainers";
import { parseEncounterIndex, loadEncounterTableEditDocument } from "../src/core/encounterEditing";
import { loadMapStrengthDocument, prepareMapStrengthWrites, prepareAddBoulderWrites } from "../src/core/mapStrength";
import { loadMapPropertiesDocument, prepareMapPropertiesWrites } from "../src/core/mapProperties";
import { checkMap } from "../src/core/mapValidation";
import { loadMapTerrainDocument, prepareMapTerrainWrites, loadMapWarpDocument, prepareMapWarpWrites } from "../src/core/mapEditing";
import { createProjectHistoryManager } from "../src/core/history";
import { loadMapNpcEditDocument, prepareMapNpcEditWrites } from "../src/core/npcEditing";
import { loadMapNpcCreateDocument, prepareMapNpcWrites } from "../src/core/npcCreation";
import { checkScriptInteraction, loadScriptInteractionDocument, prepareScriptInteractionWrites, prepareScriptRewardWrite, prepareScriptPokemonGiftWrite } from "../src/core/scriptInteractions";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ScriptsTab } from "../src/ScriptsTab";
import { MapsTab } from "../src/MapsTab";
import { parseMapIndex, loadMapVisualization } from "../src/core/mapVisualization";
import { attachTextEditing } from "../src/core/textEditing";
import { loadScriptCatalog, loadScriptDocument } from "../src/core/scriptCatalog";
import type { ProjectSession, ProjectSource, TextWriteRequest } from "../src/core/types";

const fixture = window as unknown as {
  nativeObjectDocument?: NativeMapObjectDocument;
  dialogueFiles: Record<string, string>;
  trainerDocument?: MapTrainerDocument;
  openedTrainerParty?: string;
  dialogueInvoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
  dialogueSaves: TextWriteRequest[][];
  dialogueDirty: boolean;
  dialogueBytes: Record<string, number[]>;
  mapSurface?: boolean;
  sceneFixture?: boolean;
  sceneActor?: string;
  mapFocus?: string;
  projectKey?: string;
  openedScript?: { path: string; label?: string | null };
  interactionTargets: unknown[];
};
fixture.dialogueSaves = [];
fixture.interactionTargets = [];
const source = {
  storageKey: fixture.projectKey ?? "dialogue-fixture",
  readText: async (path: string) => {
    if (!(path in fixture.dialogueFiles)) throw new Error(`Missing fixture: ${path}`);
    return fixture.dialogueFiles[path];
  },
  readBytes: async (path: string) => new Uint8Array(fixture.dialogueBytes[path]),
  exists: async (path: string) => path in fixture.dialogueFiles || path in fixture.dialogueBytes,
  listFiles: async () => [...Object.keys(fixture.dialogueFiles), ...Object.keys(fixture.dialogueBytes)],
} as ProjectSource;
source.createFile = async (path, bytes) => {
  if (await source.exists(path)) throw new Error(`${path} already exists.`);
  if (path.endsWith(".blk")) fixture.dialogueBytes[path] = Array.from(bytes);
  else fixture.dialogueFiles[path] = new TextDecoder().decode(bytes);
};
source.removeFile = async path => { delete fixture.dialogueFiles[path]; delete fixture.dialogueBytes[path]; };
source.writeText = async (path, text) => { fixture.dialogueFiles[path] = text; };
source.writeBytes = async (path, bytes) => { fixture.dialogueBytes[path] = Array.from(bytes); };
let historyState: import("../src/core/types").HistoryState | null = null;
source.historyStore = { persistent: false, load: async () => historyState, save: async state => { historyState = structuredClone(state); } };
const mapHistory = createProjectHistoryManager(source);
const session = attachTextEditing({ saveTextChanges: async (_title: string, changes: TextWriteRequest[]) => {
  fixture.dialogueSaves.push(changes);
  for (const change of changes) fixture.dialogueFiles[change.path] = change.contents;
  return { canUndo: true, canRedo: false };
} } as ProjectSession, source);
fixture.dialogueInvoke = async (command, args) => {
  switch (command) {
    case "get_map_encounter_document": return loadMapEncounterDocument(source, fixture.dialogueFiles["scripts/OaksLab_2.asm"] ? "pokeyellow" : "pokered", args!.mapConstant as string);
    case "get_encounter_index": return parseEncounterIndex(source, fixture.dialogueFiles["scripts/OaksLab_2.asm"] ? "pokeyellow" : "pokered");
    case "get_encounter_table": return loadEncounterTableEditDocument(source, fixture.dialogueFiles["scripts/OaksLab_2.asm"] ? "pokeyellow" : "pokered", args!.path as string);
    case "assign_map_encounters": {
      const changes = await prepareMapEncounterWrites(source, fixture.dialogueFiles["scripts/OaksLab_2.asm"] ? "pokeyellow" : "pokered", args!.document as never, args!.values as never);
      fixture.dialogueSaves.push(changes); return mapHistory.save("Assign encounters", changes);
    }
    case "get_map_item_document": return loadMapItemDocument(source, args!.mapConstant as string);
    case "get_native_map_object_document": {
      const doc = await loadNativeMapObjectDocument(source, args!.mapConstant as string, args!.objectId as number); fixture.nativeObjectDocument = doc; return doc;
    }
    case "save_native_map_object": {
      const changes = await prepareNativeMapObjectWrites(source, args!.document as never, args!.values as never);
      fixture.dialogueSaves.push(changes); return mapHistory.save("Edit native object", changes);
    }
    case "get_map_trainer_document": {
      const doc = await loadMapTrainerDocument(source, args!.mapConstant as string, args!.objectId as number | undefined); fixture.trainerDocument = doc; return doc;
    }
    case "save_map_trainer": {
      const changes = await prepareMapTrainerWrites(source, args!.document as never, args!.values as never);
      fixture.dialogueSaves.push(changes); return mapHistory.save("Place trainer", changes);
    }
    case "place_map_item": {
      const changes = await prepareMapItemWrites(source, args!.document as never, args!.values as never);
      fixture.dialogueSaves.push(changes); return mapHistory.save("Place item", changes);
    }
    case "check_map": return checkMap(source, args!.mapConstant as string);
    case "get_map_properties_document": return loadMapPropertiesDocument(source, args!.mapConstant as string);
    case "save_map_properties": {
      const changes = await prepareMapPropertiesWrites(source, args!.document as never, args!.values as never);
      fixture.dialogueSaves.push(changes); return mapHistory.save("Edit map properties", changes);
    }
    case "get_map_strength_document": return loadMapStrengthDocument(source, args!.mapConstant as string);
    case "save_map_strength": {
      const changes = await prepareMapStrengthWrites(source, args!.document as never, args!.values as never);
      fixture.dialogueSaves.push(changes); return mapHistory.save("Edit Strength puzzle", changes);
    }
    case "add_map_boulder": {
      const changes = await prepareAddBoulderWrites(source, args!.mapConstant as string, args!.x as number, args!.y as number);
      fixture.dialogueSaves.push(changes); return mapHistory.save("Add boulder", changes);
    }
    case "get_map_create_document": return loadMapCreateDocument(source, args?.templateConstant as string | undefined);
    case "create_map": {
      const changes = await prepareMapCreateWrites(source, args!.document as never, args!.values as never);
      fixture.dialogueSaves.push(changes);
      return { mapConstant: (args!.values as { constant: string }).constant, history: await mapHistory.save("Create map", changes) };
    }
    case "get_map_terrain_document": return loadMapTerrainDocument(source, args!.mapConstant as string);
    case "save_map_terrain": {
      const changes = await prepareMapTerrainWrites(source, args!.document as never, args!.values as never);
      fixture.dialogueSaves.push(changes); return mapHistory.save("Edit terrain", changes);
    }
    case "get_map_warp_document": return loadMapWarpDocument(source, args!.mapConstant as string);
    case "save_map_warp": {
      const changes = await prepareMapWarpWrites(source, args!.document as never, args!.values as never);
      fixture.dialogueSaves.push(changes); return mapHistory.save("Edit warp", changes);
    }
    case "undo_map_fixture": return mapHistory.undo();
    case "redo_map_fixture": return mapHistory.redo();
    case "get_map_index": return parseMapIndex(source);
    case "get_map_visualization": return loadMapVisualization(source, args!.mapConstant as string);
    case "get_map_npc_edit_document": return loadMapNpcEditDocument(source, args!.mapConstant as string, args!.objectId as number);
    case "save_map_npc": return session.saveTextChanges("Edit NPC", await prepareMapNpcEditWrites(source, args!.document as never, args!.values as never));
    case "check_script_interaction": return checkScriptInteraction(source, args!.document as never, args!.values as never);
    case "get_script_interaction_document":
      fixture.interactionTargets.push(args);
      return loadScriptInteractionDocument(source, args!.path as string, args!.label as string);
    case "save_script_interaction": return session.saveTextChanges("Edit interaction", await prepareScriptInteractionWrites(source, args!.document as never, args!.values as never));
    case "save_script_reward": return session.saveTextChanges("Edit reward", await prepareScriptRewardWrite(source, args!.document as never, args!.item as string, args!.quantity as number, args!.fixBagFull as boolean));
    case "save_script_pokemon_gift": return session.saveTextChanges("Edit Pokémon gift", await prepareScriptPokemonGiftWrite(source, args!.document as never, args!.species as string, args!.level as number));
    case "get_script_catalog": return loadScriptCatalog(source);
    case "get_script_document": return loadScriptDocument(source, args!.path as string);
    case "get_script_audit": return null;
    case "get_macro_catalog": return null;
    case "get_script_macro_calls": return { path: args!.path, calls: [] };
    case "get_text_leaf_documents": return session.getTextLeafDocuments(args!.path as string, args!.label as string);
    case "get_text_document": return session.getTextDocument(args!.path as string, args!.label as string);
    case "save_text_document": return session.saveTextDocument(args as never);
    default: throw new Error(`Unexpected dialogue UI command: ${command}`);
  }
};
const project = { path: "fixture", storageKey: source.storageKey, valid: true, projectName: "pokemon" };
const focus = { path: "scripts/ViridianCity.asm", routineLabel: "ViridianCitySignText" };
function Fixture() {
  const [version, setVersion] = useState(0);
  return <>
    <button onClick={() => setVersion(value => value + 1)}>Reload scripts</button>
    {fixture.mapSurface
      ? <MapsTab key={version} project={project} encounters={[]} fishingDocument={null} pokemonIndex={[]} focusMapConstant={fixture.mapFocus ?? "VIRIDIAN_CITY"}
          onOpenWalkingEncounter={() => {}} onOpenFishing={() => {}}
          onOpenTrainerParty={id => { fixture.openedTrainerParty = id; }}
          onOpenScript={(path, label) => { fixture.openedScript = { path, label }; }}
          onDirtyChange={dirty => { fixture.dialogueDirty = dirty; }} />
      : <ScriptsTab key={version} project={project} focus={focus} onDirtyChange={dirty => { fixture.dialogueDirty = dirty; }} />}
  </>;
}
async function start() {
  if (fixture.sceneFixture) {
    const center = fixture.mapFocus === "VIRIDIAN_POKECENTER", map = center ? "VIRIDIAN_POKECENTER" : "PALLET_TOWN";
    const doc = await loadMapNpcCreateDocument(source, map);
    const writes = await prepareMapNpcWrites(source, doc, { x: center ? 4 : 8, y: center ? 5 : 8, sprite: "SPRITE_OAK", movement: "STAY", direction: "DOWN", dialogue: { kind: "new", lines: ["Hello there!"] } });
    writes.forEach(write => { fixture.dialogueFiles[write.path] = write.contents; });
    fixture.sceneActor = `${map}_EDITOR_NPC_${doc.objectId}`;
  }
  createRoot(window.document.getElementById("root")!).render(<Fixture />);
}
void start();
