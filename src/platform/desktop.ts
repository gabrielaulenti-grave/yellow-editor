import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { createProjectSession } from "../core/project";
import type { HistoryState, HistoryStore, ProjectSource } from "../core/types";
import type { PlatformAdapter } from "./types";

function createDesktopHistoryStore(projectPath: string): HistoryStore {
  return {
    persistent: true,

    async load() {
      const contents = await invoke<string | null>("load_project_history", {
        projectPath,
      });

      if (!contents) {
        return null;
      }

      try {
        return JSON.parse(contents) as HistoryState;
      } catch (error) {
        throw new Error(`Yellow Editor history is unreadable for this project: ${String(error)}`);
      }
    },

    async save(state) {
      await invoke("save_project_history", {
        projectPath,
        contents: JSON.stringify(state),
      });
    },
  };
}

function createDesktopSource(projectPath: string): ProjectSource {
  return {
    displayPath: projectPath,
    historyStore: createDesktopHistoryStore(projectPath),

    readText(relativePath) {
      return invoke<string>("read_project_text", {
        projectPath,
        relativePath,
      });
    },

    writeText(relativePath, contents) {
      return invoke<void>("write_project_text", {
        projectPath,
        relativePath,
        contents,
      });
    },

    exists(relativePath) {
      return invoke<boolean>("project_path_exists", {
        projectPath,
        relativePath,
      });
    },

    async assetUrl(relativePath) {
      const absolutePath = await invoke<string | null>("resolve_project_asset", {
        projectPath,
        relativePath,
      });
      return absolutePath ? convertFileSrc(absolutePath) : null;
    },
  };
}

export const desktopPlatform: PlatformAdapter = {
  async openProject() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select Pokémon disassembly project",
    });

    if (!selected) {
      return null;
    }

    if (Array.isArray(selected)) {
      throw new Error("Expected a single project folder.");
    }

    return createProjectSession(createDesktopSource(selected));
  },
};
