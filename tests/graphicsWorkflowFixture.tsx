import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { GraphicsTab } from "../src/GraphicsTab";
import App from "../src/App";
import { createProjectSession } from "../src/core/project";
import type { GraphicsFocus } from "../src/core/graphics";
import type { EditorController } from "../src/editor/types";
import type { HistoryState, ProjectSource } from "../src/core/types";
import { decodeGen1PngWithBrowser } from "../src/core/gen1Graphics";
import { graphicsPixelsFromImage } from "../src/core/graphicsPixels";

const fixture = window as unknown as {
  graphicsBytes: Record<string, number[]>; graphicsKey: string; graphicsFocus: GraphicsFocus;
  graphicsApp?: boolean; graphicsDirty: boolean;
  graphicsInvoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
  inspectArtwork(path: string): Promise<number[]>;
};
let state: HistoryState | null = null;
const source: ProjectSource = {
  displayPath: "graphics-fixture", storageKey: fixture.graphicsKey,
  exists: async path => path in fixture.graphicsBytes || Object.keys(fixture.graphicsBytes).some(key => key.startsWith(`${path}/`)),
  listFiles: async () => Object.keys(fixture.graphicsBytes),
  readBytes: async path => { if (!(path in fixture.graphicsBytes)) throw new Error(`Missing fixture ${path}`); return Uint8Array.from(fixture.graphicsBytes[path]); },
  readText: async path => new TextDecoder().decode(await source.readBytes(path)),
  writeBytes: async (path, bytes) => { fixture.graphicsBytes[path] = Array.from(bytes); },
  writeText: async (path, text) => source.writeBytes!(path, new TextEncoder().encode(text)),
  createFile: async (path, bytes) => { if (path in fixture.graphicsBytes) throw new Error("File already exists"); await source.writeBytes!(path, bytes); },
  removeFile: async path => { delete fixture.graphicsBytes[path]; },
  assetUrl: async path => path.endsWith(".png") ? URL.createObjectURL(new Blob([Uint8Array.from(fixture.graphicsBytes[path]).buffer], { type: "image/png" })) : null,
  historyStore: { persistent: true, load: async () => structuredClone(state), save: async next => { state = structuredClone(next); } },
};
const session = await createProjectSession(source, { inspect: async () => ({ targets: ["red"], defaultTarget: "red", tools: [], helperTools: [], buildTool: { name: "fixture", available: false }, message: "Build outside this fixture" }), build: async () => { throw new Error("Build outside this fixture"); } } as never);
fixture.inspectArtwork = async path => graphicsPixelsFromImage(await decodeGen1PngWithBrowser(await source.readBytes(path)), 2).pixels;
fixture.graphicsInvoke = async (command, args = {}) => {
  switch (command) {
    case "open_project": return session.info;
    case "get_graphics_catalog": return session.getGraphicsCatalog(args.refresh === true);
    case "get_graphics_document": return session.getGraphicsDocument(args.path as string);
    case "get_graphics_asset_url": return session.getGraphicsAssetUrl(args.path as string);
    case "save_graphics": return session.saveGraphics(args.document as never, args.values as never);
    case "get_animation_edit_document": return session.getAnimationEditDocument(args.animationId as number | null);
    case "save_animation": return session.saveAnimation(args.document as never, args.values as never);
    case "create_move": return session.createMove(args.document as never, args.values as never);
    case "create_pokemon": return session.createPokemon(args.document as never, args.values as never);
    case "create_trainer_party": return session.createTrainerParty(args.document as never, args.values as never);
    case "get_pokemon_details": return session.getPokemonDetails(args.internalId as number, args.sourceSlug as string);
    case "get_pokemon_edit_document": return session.getPokemonEditDocument(args.internalId as number, args.sourceSlug as string);
    case "get_pokemon_tmhm_moves": return session.getPokemonTmhmMoves(args.sourceSlug as string);
    case "get_pokemon_palette": return session.getPokemonPalette(args.sourceSlug as string);
    case "get_encounter_table": return session.getEncounterTable(args.path as string);
    case "get_map_visualization": return session.getMapVisualization(args.mapConstant as string);
    case "get_trainer_presentation": return session.getTrainerPresentation(args.classConstant as string, args.partyNumber as number);
    case "get_trainers": return (session as unknown as { getTrainerBaseCatalog(): Promise<unknown> }).getTrainerBaseCatalog();
    case "get_fishing": return session.getFishing();
    case "get_history_summary": return session.getHistorySummary();
    case "get_history_timeline": return session.getHistoryTimeline();
    case "undo_last_save": return session.undoLastSave();
    case "redo_last_undo": return session.redoLastUndo();
    default: {
      const name = command.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
      const method = (session as unknown as Record<string, (() => Promise<unknown>)>)[name];
      if (!method) throw new Error(`Unhandled fixture command: ${command}`);
      return method();
    }
  }
};
function Fixture() {
  const [open, setOpen] = useState(true), [controller, setController] = useState<EditorController | null>(null);
  useEffect(() => { fixture.graphicsDirty = controller?.dirty ?? false; }, [controller]);
  return <main className="app-shell"><div className="graphics-controls"><button onClick={() => setOpen(!open)}>{open ? "Close graphics" : "Reopen graphics"}</button><button disabled={Boolean(controller?.dirty || controller?.busy)} onClick={() => { void session.undoLastSave().then(history => window.dispatchEvent(new CustomEvent("yellow-editor:history-changed", { detail: history }))); }}>Undo saved graphic</button><button disabled={Boolean(controller?.dirty || controller?.busy)} onClick={() => { void session.redoLastUndo().then(history => window.dispatchEvent(new CustomEvent("yellow-editor:history-changed", { detail: history }))); }}>Redo saved graphic</button></div>{open && <GraphicsTab project={session.info} focus={fixture.graphicsFocus} onControllerChange={setController} onReturn={() => setOpen(false)} />}</main>;
}
createRoot(document.getElementById("root")!).render(fixture.graphicsApp ? <App /> : <Fixture />);
