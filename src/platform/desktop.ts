import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { createProjectSession } from "../core/project";
import type { ProjectSource } from "../core/types";
import type { PlatformAdapter } from "./types";

function createDesktopSource(projectPath: string): ProjectSource {
  return {
    displayPath: projectPath,

    readText(relativePath) {
      return invoke<string>("read_project_text", {
        projectPath,
        relativePath,
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
