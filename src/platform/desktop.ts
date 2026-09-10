import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { createSharedWasmBuildService } from "../core/build";
import {
  configureGen1PngDecoder,
  type Gen1DecodedImage,
} from "../core/gen1Graphics";
import { createProjectSession } from "../core/project";
import { attachTextEditing } from "../core/textEditing";
import type {
  HistoryState,
  HistoryStore,
  ProjectSource,
} from "../core/types";
import { createPackedProjectSource } from "./packedProject";
import type { PlatformAdapter, PlatformOpenProjectOptions } from "./types";

interface DesktopDecodedPngImage {
  width: number;
  height: number;
  rgba: number[];
}

async function decodeDesktopPng(
  pngBytes: Uint8Array,
): Promise<Gen1DecodedImage> {
  const decoded = await invoke<DesktopDecodedPngImage>("decode_png_rgba", {
    bytes: Array.from(pngBytes),
  });

  const rgba = Uint8ClampedArray.from(decoded.rgba);
  if (
    !Number.isInteger(decoded.width) ||
    !Number.isInteger(decoded.height) ||
    decoded.width <= 0 ||
    decoded.height <= 0 ||
    rgba.length !== decoded.width * decoded.height * 4
  ) {
    throw new Error("The desktop PNG decoder returned an invalid RGBA image.");
  }

  return {
    width: decoded.width,
    height: decoded.height,
    rgba,
  };
}

function decodedPngDataUrl(image: Gen1DecodedImage): string {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("The desktop WebView could not create a canvas for sprite preview.");
  }

  context.putImageData(
    new ImageData(image.rgba, image.width, image.height),
    0,
    0,
  );
  return canvas.toDataURL("image/png");
}

configureGen1PngDecoder("Tauri native PNG decoder", decodeDesktopPng);

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
  const assetUrls = new Map<string, string>();

  return {
    displayPath: projectPath,
    storageKey: `desktop:${projectPath}`,
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
      const cached = assetUrls.get(relativePath);
      if (cached) {
        return cached;
      }

      try {
        const bytes = Uint8Array.from(await invoke<number[]>("read_project_bytes", {
          projectPath,
          relativePath,
        }));
        const url = relativePath.toLowerCase().endsWith(".png")
          ? decodedPngDataUrl(await decodeDesktopPng(bytes))
          : URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
        assetUrls.set(relativePath, url);
        return url;
      } catch {
        return null;
      }
    },

    dispose() {
      for (const url of assetUrls.values()) {
        if (url.startsWith("blob:")) {
          URL.revokeObjectURL(url);
        }
      }
      assetUrls.clear();
    },
  };
}

async function openPackedDesktopProject(): Promise<ReturnType<typeof attachTextEditing> | null> {
  const selected = await open({
    directory: false,
    multiple: false,
    title: "Select packed Pokémon project",
    filters: [{ name: "ZIP archive", extensions: ["zip"] }],
  });
  if (!selected) {
    return null;
  }
  if (Array.isArray(selected)) {
    throw new Error("Expected a single ZIP archive.");
  }

  const archiveBytes = Uint8Array.from(await invoke<number[]>("read_archive_bytes", {
    path: selected,
  }));
  const archiveName = selected.replace(/\\/g, "/").split("/").pop() ?? "project.zip";
  const source = await createPackedProjectSource({
    archiveName,
    archiveBytes,
    storageKey: `desktop-packed:${selected}`,
    historyStore: createDesktopHistoryStore(`packed:${selected}`),
    persistArchive: async (bytes) => {
      await invoke<void>("write_archive_bytes", {
        path: selected,
        bytes: Array.from(bytes),
      });
    },
    assetUrlFactory: async (path, bytes) => path.toLowerCase().endsWith(".png")
      ? decodedPngDataUrl(await decodeDesktopPng(bytes))
      : URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" })),
  });
  const session = await createProjectSession(
    source,
    createSharedWasmBuildService(source, "desktop-wasm"),
  );
  return attachTextEditing(session, source);
}

export const desktopPlatform: PlatformAdapter = {
  async openProject(options?: PlatformOpenProjectOptions) {
    if (options?.sourceKind === "zip") {
      return openPackedDesktopProject();
    }

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

    const source = createDesktopSource(selected);
    const session = await createProjectSession(
      source,
      createSharedWasmBuildService(source, "desktop-wasm"),
    );
    return attachTextEditing(session, source);
  },
};
