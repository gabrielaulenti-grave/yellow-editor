import type {
  PokemonBaseStatValues,
  ProjectSession,
  TextWriteRequest,
} from "../core/types";
import { webPlatform } from "./web";

let activeSession: ProjectSession | null = null;

type OpenOptions = {
  directory?: boolean;
  multiple?: boolean;
  title?: string;
};

type InvokeArgs = Record<string, unknown>;

type TauriWindow = Window & {
  __TAURI_INTERNALS__?: unknown;
};

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in (window as TauriWindow);
}

async function openDesktopProject(): Promise<ProjectSession | null> {
  const { desktopPlatform } = await import("./desktop");
  return desktopPlatform.openProject();
}

export async function open(_options?: OpenOptions): Promise<string | null> {
  const nextSession = isTauri()
    ? await openDesktopProject()
    : await webPlatform.openProject();

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

    default:
      throw new Error(`Unsupported project command: ${command}`);
  }
}

// The shared project layer already resolves sprites to a browser-safe URL on
// both platforms, so callers can treat this like Tauri's convertFileSrc.
export function convertFileSrc(path: string): string {
  return path;
}
