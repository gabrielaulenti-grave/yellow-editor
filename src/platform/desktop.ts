import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { createProjectSession } from "../core/project";
import type {
  BuildEnvironment,
  BuildProgressListener,
  BuildResult,
  BuildService,
  BuildTarget,
  HistoryState,
  HistoryStore,
  ProjectSource,
} from "../core/types";
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

    async readBytes(relativePath) {
      const bytes = await invoke<number[]>("read_project_bytes", {
        projectPath,
        relativePath,
      });
      return Uint8Array.from(bytes);
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

function createDesktopBuildService(projectPath: string): BuildService {
  return {
    inspect() {
      return invoke<BuildEnvironment>("get_build_environment", {
        projectPath,
      });
    },

    async build(target: BuildTarget, onProgress?: BuildProgressListener) {
      onProgress?.({
        stage: "preparing",
        level: "info",
        message: "Starting native build",
        detail: `Preparing ${target} build in ${projectPath}`,
        percent: 5,
        timestamp: Date.now(),
      });
      onProgress?.({
        stage: "assembling",
        level: "info",
        message: "Running the project build",
        detail: "The desktop backend is running make with the selected RGBDS toolchain.",
        percent: 30,
        timestamp: Date.now(),
      });

      try {
        const result = await invoke<BuildResult>("build_rom", {
          projectPath,
          target,
        });
        onProgress?.({
          stage: result.success ? "complete" : "error",
          level: result.success ? "info" : "error",
          message: result.success ? "Native build complete" : "Native build failed",
          detail: result.success ? result.romPath ?? undefined : result.stderr || undefined,
          percent: 100,
          timestamp: Date.now(),
        });
        return result;
      } catch (error) {
        onProgress?.({
          stage: "error",
          level: "error",
          message: "Native build failed",
          detail: error instanceof Error ? error.message : String(error),
          percent: 100,
          timestamp: Date.now(),
        });
        throw error;
      }
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

    return createProjectSession(
      createDesktopSource(selected),
      createDesktopBuildService(selected),
    );
  },
};
