import type {
  BuildProgressListener,
  BuildTarget,
  EncounterVersionData,
  FishingData,
  FishingSourceDocument,
  PokemonBaseStatValues,
  ProjectSession,
  TextWriteRequest,
  TrainerEditSourceDocument,
  TrainerLoadProgressListener,
  TrainerPartyEditValues,
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
  if (!candidate.getTextDocument || !candidate.saveTextDocument) {
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

    case "get_moves":
      return (await session.getMoves()) as T;

    case "get_trainer_base_catalog":
      return (await requireProgressiveTrainerSession(session).getTrainerBaseCatalog()) as T;

    case "get_trainers":
      return (await session.getTrainers(trainerProgressArg(args))) as T;

    case "save_trainer_party":
      return (await session.saveTrainerParty(
        stringArg(args, "partyId"),
        numberArg(args, "sourceLine"),
        trainerSourcesArg(args),
        trainerPartyValuesArg(args),
        stringListArg(args, "knownSpecies"),
        stringListArg(args, "knownMoves"),
      )) as T;

    case "get_text_document":
      return (await requireTextSession(session).getTextDocument(
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

export function convertFileSrc(path: string): string {
  return path;
}
