import type {
  BuildProgressListener,
  BuildTarget,
  EncounterVersionData,
  FishingData,
  FishingSourceDocument,
  ItemCreateDocument,
  ItemCreateValues,
  ItemEditDocument,
  ItemEditValues,
  PokemonBaseStatValues,
  PokemonEditSourceDocument,
  PokemonEditValues,
  ProjectSession,
  TextWriteRequest,
  TrainerClassCreateValues,
  TrainerClassEditValues,
  TrainerEditSourceDocument,
  TrainerLoadProgressListener,
  TrainerPartyEditValues,
  TmEditDocument,
  TmEditValues,
} from "../core/types";
import type { ProgressiveTrainerSession } from "../core/project";
import type {
  TextDocumentSaveRequest,
  TextEditingSession,
  TextSegment,
} from "../core/textEditing";
import type {
  ProjectSourceKind,
  ProjectWorkspaceProgressListener,
} from "./types";
import { webPlatform } from "./web";

let activeSession: ProjectSession | null = null;

type OpenOptions = {
  directory?: boolean;
  multiple?: boolean;
  title?: string;
  onWorkspaceProgress?: ProjectWorkspaceProgressListener;
  sourceKind?: ProjectSourceKind;
};

type InvokeArgs = Record<string, unknown>;

type TauriWindow = Window & {
  __TAURI_INTERNALS__?: unknown;
};

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in (window as TauriWindow);
}

async function chooseProjectSourceKind(): Promise<ProjectSourceKind | null> {
  if (typeof HTMLDialogElement === "undefined") {
    return window.confirm("Open a packed ZIP project? Select Cancel to open a project folder instead.")
      ? "zip"
      : "folder";
  }

  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.setAttribute("aria-labelledby", "yellow-editor-open-project-title");
    Object.assign(dialog.style, {
      border: "1px solid #b8b8ae",
      borderRadius: "12px",
      padding: "20px",
      width: "min(440px, calc(100vw - 32px))",
      color: "#171717",
      background: "#fff",
    });

    const title = document.createElement("h2");
    title.id = "yellow-editor-open-project-title";
    title.textContent = "Open project";
    title.style.marginTop = "0";

    const description = document.createElement("p");
    description.textContent = "Packed ZIP is recommended on mobile. Folder mode keeps direct access to an unpacked disassembly.";

    const actions = document.createElement("div");
    Object.assign(actions.style, {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: "10px",
      marginTop: "18px",
    });

    const folder = document.createElement("button");
    folder.type = "button";
    folder.textContent = "Open folder";
    const zip = document.createElement("button");
    zip.type = "button";
    zip.textContent = "Open ZIP";
    zip.style.fontWeight = "700";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.style.gridColumn = "1 / -1";

    let settled = false;
    const finish = (kind: ProjectSourceKind | null) => {
      if (settled) {
        return;
      }
      settled = true;
      dialog.close();
      dialog.remove();
      resolve(kind);
    };
    folder.addEventListener("click", () => finish("folder"));
    zip.addEventListener("click", () => finish("zip"));
    cancel.addEventListener("click", () => finish(null));
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(null);
    });

    actions.append(folder, zip, cancel);
    dialog.append(title, description, actions);
    document.body.append(dialog);
    dialog.showModal();
  });
}

async function openDesktopProject(sourceKind: ProjectSourceKind): Promise<ProjectSession | null> {
  const { desktopPlatform } = await import("./desktop");
  return desktopPlatform.openProject({ sourceKind });
}

export async function open(options?: OpenOptions): Promise<string | null> {
  const sourceKind = options?.sourceKind ?? await chooseProjectSourceKind();
  if (!sourceKind) {
    return null;
  }

  const nextSession = isTauri()
    ? await openDesktopProject(sourceKind)
    : await webPlatform.openProject({
        onWorkspaceProgress: options?.onWorkspaceProgress,
        sourceKind,
      });

  if (!nextSession) {
    return null;
  }

  activeSession?.dispose();
  activeSession = nextSession;
  return activeSession.info.path;
}

function requireSession(): ProjectSession {
  if (!activeSession) {
    throw new Error("No project is open.");
  }
  return activeSession;
}

function requireTextSession(session: ProjectSession): ProjectSession & TextEditingSession {
  const candidate = session as ProjectSession & Partial<TextEditingSession>;
  if (
    !candidate.getTextDocument
    || !candidate.getTextLeafDocuments
    || !candidate.saveTextDocument
  ) {
    throw new Error("This project session does not support text editing.");
  }
  return candidate as ProjectSession & TextEditingSession;
}

function requireProgressiveTrainerSession(
  session: ProjectSession,
): ProjectSession & ProgressiveTrainerSession {
  const candidate = session as ProjectSession & Partial<ProgressiveTrainerSession>;
  if (!candidate.getTrainerBaseCatalog) {
    throw new Error("This project session does not support progressive trainer loading.");
  }
  return candidate as ProjectSession & ProgressiveTrainerSession;
}

function numberArg(args: InvokeArgs | undefined, name: string): number {
  const value = args?.[name];
  if (typeof value !== "number") {
    throw new Error(`Missing numeric argument '${name}'.`);
  }
  return value;
}

function stringArg(args: InvokeArgs | undefined, name: string): string {
  const value = args?.[name];
  if (typeof value !== "string") {
    throw new Error(`Missing string argument '${name}'.`);
  }
  return value;
}

function optionalStringArg(args: InvokeArgs | undefined, name: string): string | undefined {
  const value = args?.[name];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`Argument '${name}' must be a string when provided.`);
  }
  return value;
}

function nullableStringArg(args: InvokeArgs | undefined, name: string): string | null {
  const value = args?.[name];
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`Argument '${name}' must be a string or null.`);
  }
  return value;
}

function buildTargetArg(args: InvokeArgs | undefined): BuildTarget {
  const value = stringArg(args, "target");
  if (value !== "yellow" && value !== "red" && value !== "blue") {
    throw new Error(`Unsupported build target '${value}'.`);
  }
  return value;
}

function buildProgressArg(
  args: InvokeArgs | undefined,
): BuildProgressListener | undefined {
  const value = args?.onProgress;
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "function") {
    throw new Error("Build progress callback must be a function.");
  }
  return value as BuildProgressListener;
}

function trainerProgressArg(
  args: InvokeArgs | undefined,
): TrainerLoadProgressListener | undefined {
  const value = args?.onProgress;
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "function") {
    throw new Error("Trainer progress callback must be a function.");
  }
  return value as TrainerLoadProgressListener;
}

function baseStatValuesArg(args: InvokeArgs | undefined): PokemonBaseStatValues {
  const value = args?.values;
  if (!value || typeof value !== "object") {
    throw new Error("Missing Pokémon base stat values.");
  }

  const record = value as Record<string, unknown>;
  const keys = ["hp", "attack", "defense", "speed", "special"] as const;
  const result = {} as PokemonBaseStatValues;

  for (const key of keys) {
    const stat = record[key];
    if (typeof stat !== "number") {
      throw new Error(`Pokémon base stat '${key}' must be numeric.`);
    }
    result[key] = stat;
  }

  return result;
}

function pokemonEditSourcesArg(args: InvokeArgs | undefined): PokemonEditSourceDocument[] {
  const value = args?.sources;
  if (!Array.isArray(value)) {
    throw new Error("Missing Pokémon edit source documents.");
  }
  return value as PokemonEditSourceDocument[];
}

function pokemonEditValuesArg(args: InvokeArgs | undefined): PokemonEditValues {
  const value = args?.values;
  if (!value || typeof value !== "object") {
    throw new Error("Missing Pokémon edit values.");
  }
  return value as PokemonEditValues;
}

function tmEditDocumentArg(args: InvokeArgs | undefined): TmEditDocument {
  const value = args?.document;
  if (!value || typeof value !== "object") {
    throw new Error("Missing TM edit document.");
  }
  return value as TmEditDocument;
}

function tmEditValuesArg(args: InvokeArgs | undefined): TmEditValues {
  const value = args?.values;
  if (!value || typeof value !== "object") {
    throw new Error("Missing TM edit values.");
  }
  return value as TmEditValues;
}

function itemEditDocumentArg(args: InvokeArgs | undefined): ItemEditDocument {
  const value = args?.document;
  if (!value || typeof value !== "object") {
    throw new Error("Missing item edit document.");
  }
  return value as ItemEditDocument;
}

function itemEditValuesArg(args: InvokeArgs | undefined): ItemEditValues {
  const value = args?.values;
  if (!value || typeof value !== "object") {
    throw new Error("Missing item edit values.");
  }
  return value as ItemEditValues;
}

function itemCreateDocumentArg(args: InvokeArgs | undefined): ItemCreateDocument {
  const value = args?.document;
  if (!value || typeof value !== "object") {
    throw new Error("Missing item creation document.");
  }
  return value as ItemCreateDocument;
}

function itemCreateValuesArg(args: InvokeArgs | undefined): ItemCreateValues {
  const value = args?.values;
  if (!value || typeof value !== "object") {
    throw new Error("Missing item creation values.");
  }
  return value as ItemCreateValues;
}

function textChangesArg(args: InvokeArgs | undefined): TextWriteRequest[] {
  const value = args?.changes;
  if (!Array.isArray(value)) {
    throw new Error("Missing text change list 'changes'.");
  }

  return value.map((item) => {
    if (!item || typeof item !== "object") {
      throw new Error("Invalid text change request.");
    }

    const record = item as Record<string, unknown>;
    if (typeof record.path !== "string" || typeof record.contents !== "string") {
      throw new Error("Each text change requires string 'path' and 'contents' values.");
    }

    if (record.expectedHash !== undefined && typeof record.expectedHash !== "string") {
      throw new Error("Text change 'expectedHash' must be a string when provided.");
    }

    return {
      path: record.path,
      contents: record.contents,
      expectedHash: record.expectedHash as string | undefined,
    };
  });
}

function textSegmentsArg(args: InvokeArgs | undefined): TextSegment[] {
  const value = args?.segments;
  if (!Array.isArray(value)) {
    throw new Error("Missing text segment list 'segments'.");
  }

  const controls = new Set(["text", "next", "line", "cont", "para", "page"]);
  return value.map((item) => {
    if (!item || typeof item !== "object") {
      throw new Error("Invalid text segment.");
    }
    const record = item as Record<string, unknown>;
    if (
      typeof record.control !== "string" ||
      !controls.has(record.control) ||
      typeof record.text !== "string"
    ) {
      throw new Error("Each text segment requires a supported control and string text value.");
    }
    return { control: record.control as TextSegment["control"], text: record.text };
  });
}

function textDocumentSaveRequestArg(args: InvokeArgs | undefined): TextDocumentSaveRequest {
  return {
    path: stringArg(args, "path"),
    label: stringArg(args, "label"),
    sourceHash: stringArg(args, "sourceHash"),
    segments: textSegmentsArg(args),
  };
}

function encounterVersionsArg(args: InvokeArgs | undefined): EncounterVersionData[] {
  const value = args?.versions;
  if (!Array.isArray(value)) {
    throw new Error("Missing encounter version data.");
  }
  return value as EncounterVersionData[];
}

function stringListArg(args: InvokeArgs | undefined, name: string): string[] {
  const value = args?.[name];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Missing string list '${name}'.`);
  }
  return value as string[];
}

function fishingDataArg(args: InvokeArgs | undefined): FishingData {
  const value = args?.data;
  if (!value || typeof value !== "object") {
    throw new Error("Missing fishing encounter data.");
  }
  return value as FishingData;
}

function fishingSourcesArg(args: InvokeArgs | undefined): FishingSourceDocument[] {
  const value = args?.sources;
  if (!Array.isArray(value)) {
    throw new Error("Missing fishing source documents.");
  }
  return value as FishingSourceDocument[];
}

function trainerSourcesArg(args: InvokeArgs | undefined): TrainerEditSourceDocument[] {
  const value = args?.sources;
  if (!Array.isArray(value)) {
    throw new Error("Missing trainer source documents.");
  }
  return value as TrainerEditSourceDocument[];
}

function trainerPartyValuesArg(args: InvokeArgs | undefined): TrainerPartyEditValues {
  const value = args?.values;
  if (!value || typeof value !== "object") {
    throw new Error("Missing trainer party values.");
  }
  return value as TrainerPartyEditValues;
}

function trainerClassCreateValuesArg(args: InvokeArgs | undefined): TrainerClassCreateValues {
  const value = args?.values;
  if (!value || typeof value !== "object") {
    throw new Error("Missing trainer class creation values.");
  }
  return value as TrainerClassCreateValues;
}

function trainerClassEditValuesArg(args: InvokeArgs | undefined): TrainerClassEditValues {
  const value = args?.values;
  if (!value || typeof value !== "object") {
    throw new Error("Missing trainer class edit values.");
  }
  return value as TrainerClassEditValues;
}

export async function invoke<T>(
  command: string,
  args?: InvokeArgs,
): Promise<T> {
  const session = requireSession();

  switch (command) {
    case "open_project":
      return session.info as T;

    case "get_pokemon_index":
      return (await session.getPokemonIndex()) as T;

    case "get_pokemon_details":
      return (await session.getPokemonDetails(
        numberArg(args, "internalId"),
        stringArg(args, "sourceSlug"),
      )) as T;

    case "get_pokemon_tmhm_moves":
      return (await session.getPokemonTmhmMoves(
        stringArg(args, "sourceSlug"),
      )) as T;

    case "get_pokemon_palette":
      return (await session.getPokemonPalette(
        stringArg(args, "sourceSlug"),
      )) as T;

    case "get_pokemon_base_stats_edit_document":
      return (await session.getPokemonBaseStatsEditDocument(
        stringArg(args, "sourceSlug"),
      )) as T;

    case "save_pokemon_base_stats":
      return (await session.savePokemonBaseStats(
        stringArg(args, "sourceSlug"),
        stringArg(args, "expectedHash"),
        baseStatValuesArg(args),
      )) as T;

    case "get_pokemon_edit_document":
      return (await session.getPokemonEditDocument(
        numberArg(args, "internalId"),
        stringArg(args, "sourceSlug"),
      )) as T;

    case "save_pokemon":
      return (await session.savePokemon(
        numberArg(args, "internalId"),
        stringArg(args, "sourceSlug"),
        pokemonEditSourcesArg(args),
        pokemonEditValuesArg(args),
      )) as T;

    case "get_moves":
      return (await session.getMoves()) as T;

    case "get_items":
      return (await session.getItems()) as T;

    case "get_pokemon_catch_profiles":
      return (await session.getPokemonCatchProfiles()) as T;

    case "get_item_edit_document":
      return (await session.getItemEditDocument(
        numberArg(args, "itemId"),
      )) as T;

    case "save_item_edit":
      return (await session.saveItemEdit(
        itemEditDocumentArg(args),
        itemEditValuesArg(args),
      )) as T;

    case "get_item_create_document":
      return (await session.getItemCreateDocument()) as T;

    case "create_item":
      return (await session.createItem(
        itemCreateDocumentArg(args),
        itemCreateValuesArg(args),
      )) as T;

    case "get_map_index":
      return (await session.getMapIndex()) as T;

    case "get_map_visualization":
      return (await session.getMapVisualization(
        stringArg(args, "mapConstant"),
      )) as T;

    case "get_script_catalog":
      return (await session.getScriptCatalog()) as T;

    case "get_script_document":
      return (await session.getScriptDocument(
        stringArg(args, "path"),
      )) as T;

    case "get_tmhm_compatibility":
      return (await session.getTmhmCompatibility(
        stringArg(args, "moveConstant"),
      )) as T;

    case "get_tm_edit_document":
      return (await session.getTmEditDocument(
        numberArg(args, "itemId"),
      )) as T;

    case "save_tm_edit":
      return (await session.saveTmEdit(
        tmEditDocumentArg(args),
        tmEditValuesArg(args),
      )) as T;

    case "get_trainer_base_catalog":
      return (await requireProgressiveTrainerSession(session).getTrainerBaseCatalog()) as T;

    case "get_trainers":
      return (await session.getTrainers(trainerProgressArg(args))) as T;

    case "get_trainer_presentation":
      return (await session.getTrainerPresentation(
        stringArg(args, "classConstant"),
        numberArg(args, "partyNumber"),
      )) as T;

    case "save_trainer_pic_override":
      return (await session.saveTrainerPicOverride(
        stringArg(args, "classConstant"),
        numberArg(args, "partyNumber"),
        nullableStringArg(args, "picLabel"),
      )) as T;

    case "get_trainer_reward_edit_document":
      return (await session.getTrainerRewardEditDocument(
        stringArg(args, "path"),
        numberArg(args, "sourceLine"),
      )) as T;

    case "save_trainer_reward":
      return (await session.saveTrainerReward(
        stringArg(args, "path"),
        numberArg(args, "sourceLine"),
        stringArg(args, "expectedHash"),
        stringArg(args, "itemConstant"),
        numberArg(args, "quantity"),
      )) as T;

    case "save_trainer_party":
      return (await session.saveTrainerParty(
        stringArg(args, "partyId"),
        numberArg(args, "sourceLine"),
        trainerSourcesArg(args),
        trainerPartyValuesArg(args),
        stringListArg(args, "knownSpecies"),
        stringListArg(args, "knownMoves"),
      )) as T;

    case "create_trainer_class":
      return (await session.createTrainerClass(
        trainerSourcesArg(args),
        trainerClassCreateValuesArg(args),
        stringListArg(args, "knownSpecies"),
      )) as T;

    case "save_trainer_class":
      return (await session.saveTrainerClass(
        stringArg(args, "classConstant"),
        trainerSourcesArg(args),
        trainerClassEditValuesArg(args),
      )) as T;

    case "get_text_document":
      return (await requireTextSession(session).getTextDocument(
        stringArg(args, "path"),
        stringArg(args, "label"),
        optionalStringArg(args, "previewText"),
      )) as T;

    case "get_text_leaf_documents":
      return (await requireTextSession(session).getTextLeafDocuments(
        stringArg(args, "path"),
        stringArg(args, "label"),
      )) as T;

    case "save_text_document":
      return (await requireTextSession(session).saveTextDocument(
        textDocumentSaveRequestArg(args),
      )) as T;

    case "get_encounter_index":
      return (await session.getEncounterIndex()) as T;

    case "get_encounter_table":
      return (await session.getEncounterTable(stringArg(args, "path"))) as T;

    case "save_encounter_table":
      return (await session.saveEncounterTable(
        stringArg(args, "path"),
        stringArg(args, "expectedHash"),
        encounterVersionsArg(args),
        stringListArg(args, "knownSpecies"),
      )) as T;

    case "get_fishing":
      return (await session.getFishing()) as T;

    case "save_fishing":
      return (await session.saveFishing(
        fishingSourcesArg(args),
        fishingDataArg(args),
        stringListArg(args, "knownSpecies"),
      )) as T;

    case "get_history_summary":
      return (await session.getHistorySummary()) as T;

    case "get_history_timeline":
      return (await session.getHistoryTimeline()) as T;

    case "selectively_undo_history_entry":
      return (await session.selectivelyUndoHistoryEntry(
        stringArg(args, "entryId"),
      )) as T;

    case "export_project_snapshot":
      return (await session.exportProjectSnapshot(
        typeof args?.historyCursor === "number" ? args.historyCursor : undefined,
      )) as T;

    case "save_text_changes":
      return (await session.saveTextChanges(
        stringArg(args, "label"),
        textChangesArg(args),
      )) as T;

    case "undo_last_save":
      return (await session.undoLastSave()) as T;

    case "redo_last_undo":
      return (await session.redoLastUndo()) as T;

    case "get_build_environment":
      return (await session.getBuildEnvironment()) as T;

    case "get_save_compatibility":
      return (await session.getSaveCompatibility(buildTargetArg(args))) as T;

    case "build_rom":
      return (await session.buildRom(
        buildTargetArg(args),
        buildProgressArg(args),
      )) as T;

    default:
      throw new Error(`Unsupported project command: ${command}`);
  }
}

interface BrowserSaveFileStream {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
}

interface BrowserSaveFileHandle {
  createWritable(): Promise<BrowserSaveFileStream>;
}

type SavePickerWindow = Window & {
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: Array<{
      description?: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<BrowserSaveFileHandle>;
};

export async function saveProjectCopy(
  historyCursor?: number,
): Promise<string | null> {
  const snapshot = await requireSession().exportProjectSnapshot(historyCursor);
  const bytes = snapshot.bytes;

  if (isTauri()) {
    const [{ save }, { invoke: tauriInvoke }] = await Promise.all([
      import("@tauri-apps/plugin-dialog"),
      import("@tauri-apps/api/core"),
    ]);
    const destination = await save({
      title: "Save Yellow Editor project copy",
      defaultPath: snapshot.fileName,
      filters: [{ name: "ZIP archive", extensions: ["zip"] }],
    });
    if (!destination) {
      return null;
    }
    await tauriInvoke<void>("write_archive_bytes", {
      path: destination,
      bytes: Array.from(bytes),
    });
    return destination;
  }

  const picker = (window as SavePickerWindow).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker.call(window, {
        suggestedName: snapshot.fileName,
        types: [{
          description: "Yellow Editor packed project",
          accept: { "application/zip": [".zip"] },
        }],
      });
      const writable = await handle.createWritable();
      try {
        await writable.write(new Blob([bytes], { type: "application/zip" }));
        await writable.close();
      } catch (error) {
        try {
          await writable.abort?.();
        } catch {
          // Preserve the original save failure.
        }
        throw error;
      }
      return snapshot.fileName;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return null;
      }
      throw error;
    }
  }

  const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = snapshot.fileName;
    anchor.style.display = "none";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return snapshot.fileName;
}

export function convertFileSrc(path: string): string {
  return path;
}
