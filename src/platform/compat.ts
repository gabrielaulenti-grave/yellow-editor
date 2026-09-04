import type { ProjectSession } from "../core/types";
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

    case "get_moves":
      return (await session.getMoves()) as T;

    default:
      throw new Error(`Unsupported project command: ${command}`);
  }
}

// The shared project layer already resolves sprites to a browser-safe URL on
// both platforms, so callers can treat this like Tauri's convertFileSrc.
export function convertFileSrc(path: string): string {
  return path;
}
