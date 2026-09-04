import { createProjectSession } from "../core/project";
import type { ProjectSource } from "../core/types";
import type { PlatformAdapter } from "./types";

interface BrowserFileHandle {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
}

interface BrowserDirectoryHandle {
  kind: "directory";
  name: string;
  getDirectoryHandle(name: string): Promise<BrowserDirectoryHandle>;
  getFileHandle(name: string): Promise<BrowserFileHandle>;
}

type PickerWindow = Window & {
  showDirectoryPicker?: (options?: {
    id?: string;
    mode?: "read" | "readwrite";
  }) => Promise<BrowserDirectoryHandle>;
};

function pathParts(relativePath: string): string[] {
  const parts = relativePath
    .replaceAll("\\", "/")
    .split("/")
    .filter(Boolean);

  if (parts.some((part) => part === "." || part === "..")) {
    throw new Error(`Invalid project-relative path: ${relativePath}`);
  }

  return parts;
}

async function getDirectoryHandle(
  root: BrowserDirectoryHandle,
  parts: string[],
): Promise<BrowserDirectoryHandle> {
  let current = root;
  for (const part of parts) {
    current = await current.getDirectoryHandle(part);
  }
  return current;
}

async function getFileHandle(
  root: BrowserDirectoryHandle,
  relativePath: string,
): Promise<BrowserFileHandle> {
  const parts = pathParts(relativePath);
  const fileName = parts.pop();
  if (!fileName) {
    throw new Error(`Expected file path, got '${relativePath}'`);
  }

  const directory = await getDirectoryHandle(root, parts);
  return directory.getFileHandle(fileName);
}

function createWebSource(root: BrowserDirectoryHandle): ProjectSource {
  const objectUrls = new Map<string, string>();

  return {
    displayPath: root.name,

    async readText(relativePath) {
      try {
        const handle = await getFileHandle(root, relativePath);
        const file = await handle.getFile();
        return await file.text();
      } catch (error) {
        throw new Error(`Failed to read ${relativePath}: ${String(error)}`);
      }
    },

    async exists(relativePath) {
      const parts = pathParts(relativePath);
      if (parts.length === 0) {
        return true;
      }

      try {
        await getFileHandle(root, relativePath);
        return true;
      } catch {
        // It may be a directory rather than a file.
      }

      try {
        await getDirectoryHandle(root, parts);
        return true;
      } catch {
        return false;
      }
    },

    async assetUrl(relativePath) {
      const cached = objectUrls.get(relativePath);
      if (cached) {
        return cached;
      }

      try {
        const handle = await getFileHandle(root, relativePath);
        const file = await handle.getFile();
        const url = URL.createObjectURL(file);
        objectUrls.set(relativePath, url);
        return url;
      } catch {
        return null;
      }
    },

    dispose() {
      for (const url of objectUrls.values()) {
        URL.revokeObjectURL(url);
      }
      objectUrls.clear();
    },
  };
}

export const webPlatform: PlatformAdapter = {
  async openProject() {
    const picker = (window as PickerWindow).showDirectoryPicker;
    if (!picker) {
      throw new Error(
        "This browser does not support folder access. Open Yellow Editor in a current Chromium-based browser such as Chrome or Edge.",
      );
    }

    try {
      // Call the picker immediately while the Open Project click still has
      // transient user activation.
      const root = await picker.call(window, {
        id: "yellow-editor-project",
        mode: "read",
      });
      return await createProjectSession(createWebSource(root));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return null;
      }
      throw error;
    }
  },
};
