import { loadMapNpcEditDocument, prepareMapNpcEditWrites } from "../src/core/npcEditing";
import { loadMapNpcCreateDocument, prepareMapNpcWrites } from "../src/core/npcCreation";
import { loadScriptInteractionDocument, prepareScriptInteractionWrites, prepareScriptRewardWrite, prepareScriptPokemonGiftWrite } from "../src/core/scriptInteractions";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ScriptsTab } from "../src/ScriptsTab";
import { MapsTab } from "../src/MapsTab";
import { parseMapIndex, loadMapVisualization } from "../src/core/mapVisualization";
import { attachTextEditing } from "../src/core/textEditing";
import { loadScriptCatalog, loadScriptDocument } from "../src/core/scriptCatalog";
import type { ProjectSession, ProjectSource, TextWriteRequest } from "../src/core/types";

const fixture = window as unknown as {
  dialogueFiles: Record<string, string>;
  dialogueInvoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
  dialogueSaves: TextWriteRequest[][];
  dialogueDirty: boolean;
  dialogueBytes: Record<string, number[]>;
  mapSurface?: boolean;
  sceneFixture?: boolean;
  sceneActor?: string;
  mapFocus?: string;
  openedScript?: { path: string; label?: string | null };
  interactionTargets: unknown[];
};
fixture.dialogueSaves = [];
fixture.interactionTargets = [];
const source = {
  readText: async (path: string) => {
    if (!(path in fixture.dialogueFiles)) throw new Error(`Missing fixture: ${path}`);
    return fixture.dialogueFiles[path];
  },
  readBytes: async (path: string) => new Uint8Array(fixture.dialogueBytes[path]),
  exists: async (path: string) => path in fixture.dialogueFiles || path in fixture.dialogueBytes,
  listFiles: async () => [...Object.keys(fixture.dialogueFiles), ...Object.keys(fixture.dialogueBytes)],
} as ProjectSource;
const session = attachTextEditing({ saveTextChanges: async (_title: string, changes: TextWriteRequest[]) => {
  fixture.dialogueSaves.push(changes);
  for (const change of changes) fixture.dialogueFiles[change.path] = change.contents;
  return { canUndo: true, canRedo: false };
} } as ProjectSession, source);
fixture.dialogueInvoke = async (command, args) => {
  switch (command) {
    case "get_map_index": return parseMapIndex(source);
    case "get_map_visualization": return loadMapVisualization(source, args!.mapConstant as string);
    case "get_map_npc_edit_document": return loadMapNpcEditDocument(source, args!.mapConstant as string, args!.objectId as number);
    case "save_map_npc": return session.saveTextChanges("Edit NPC", await prepareMapNpcEditWrites(source, args!.document as never, args!.values as never));
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
const project = { path: "fixture", storageKey: "fixture", valid: true, projectName: "pokemon" };
const focus = { path: "scripts/ViridianCity.asm", routineLabel: "ViridianCitySignText" };
function Fixture() {
  const [version, setVersion] = useState(0);
  return <>
    <button onClick={() => setVersion(value => value + 1)}>Reload scripts</button>
    {fixture.mapSurface
      ? <MapsTab key={version} project={project} encounters={[]} fishingDocument={null} pokemonIndex={[]} focusMapConstant={fixture.mapFocus ?? "VIRIDIAN_CITY"}
          onOpenWalkingEncounter={() => {}} onOpenFishing={() => {}}
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
