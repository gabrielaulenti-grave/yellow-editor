import { createProjectSession } from "../core/project";
import type { HistoryStore, ProjectSource } from "../core/types";
import type { PlatformAdapter } from "./types";
import { createWebHistoryStore, type WebDirectoryIdentityHandle } from "./webHistory";

interface BrowserWritableFileStream {
  write(data: string): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
}

interface BrowserFileHandle {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<BrowserWritableFileStream>;
}

interface BrowserDirectoryHandle extends WebDirectoryIdentityHandle {
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
    .replace(/\\/g, "/")
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

function createWebSource(
  root: BrowserDirectoryHandle,
  historyStore: HistoryStore,
): ProjectSource {
  const objectUrls = new Map<string, string>();

  return {
    displayPath: root.name,
    historyStore,

    async readText(relativePath) {
      try {
        const handle = await getFileHandle(root, relativePath);
        const file = await handle.getFile();
        return await file.text();
      } catch (error) {
        throw new Error(`Failed to read ${relativePath}: ${String(error)}`);
      }
    },

    async writeText(relativePath, contents) {
      let writable: BrowserWritableFileStream | null = null;

      try {
        const handle = await getFileHandle(root, relativePath);
        writable = await handle.createWritable();
        await writable.write(contents);
        await writable.close();
      } catch (error) {
        try {
          await writable?.abort?.();
        } catch {
          // Preserve the original write failure.
        }
        throw new Error(`Failed to write ${relativePath}: ${String(error)}`);
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
      // Request write access up front so a project opened for browsing is also
      // ready for safe, history-backed editing later in the session.
      const root = await picker.call(window, {
        id: "yellow-editor-project",
        mode: "readwrite",
      });
      const historyStore = await createWebHistoryStore(root);
      return await createProjectSession(createWebSource(root, historyStore));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return null;
      }
      throw error;
    }
  },
};
