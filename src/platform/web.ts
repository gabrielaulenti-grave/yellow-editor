import { createWebBuildService } from "../core/build";
import { createProjectSession } from "../core/project";
import type {
  HistoryStore,
  ProjectBuildReadPreparation,
  ProjectSource,
} from "../core/types";
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

type BrowserEntryHandle = BrowserFileHandle | BrowserDirectoryHandle;

interface BrowserDirectoryHandle extends WebDirectoryIdentityHandle {
  kind: "directory";
  name: string;
  getDirectoryHandle(name: string): Promise<BrowserDirectoryHandle>;
  getFileHandle(name: string): Promise<BrowserFileHandle>;
  entries?(): AsyncIterableIterator<[string, BrowserEntryHandle]>;
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

function normalizePath(relativePath: string): string {
  return pathParts(relativePath).join("/");
}

function createWebSource(
  root: BrowserDirectoryHandle,
  historyStore: HistoryStore,
): ProjectSource {
  const objectUrls = new Map<string, string>();
  const directoryHandles = new Map<string, Promise<BrowserDirectoryHandle>>();
  const fileHandles = new Map<string, Promise<BrowserFileHandle>>();
  directoryHandles.set("", Promise.resolve(root));

  function cachedDirectoryHandle(parts: string[]): Promise<BrowserDirectoryHandle> {
    const key = parts.join("/");
    const cached = directoryHandles.get(key);
    if (cached) {
      return cached;
    }

    const parentParts = parts.slice(0, -1);
    const directoryName = parts[parts.length - 1];
    if (!directoryName) {
      return Promise.resolve(root);
    }

    const promise = cachedDirectoryHandle(parentParts)
      .then((parent) => parent.getDirectoryHandle(directoryName))
      .catch((error) => {
        directoryHandles.delete(key);
        throw error;
      });
    directoryHandles.set(key, promise);
    return promise;
  }

  function cachedFileHandle(relativePath: string): Promise<BrowserFileHandle> {
    const normalized = normalizePath(relativePath);
    const cached = fileHandles.get(normalized);
    if (cached) {
      return cached;
    }

    const parts = pathParts(normalized);
    const fileName = parts.pop();
    if (!fileName) {
      return Promise.reject(new Error(`Expected file path, got '${relativePath}'`));
    }

    const promise = cachedDirectoryHandle(parts)
      .then((directory) => directory.getFileHandle(fileName))
      .catch((error) => {
        fileHandles.delete(normalized);
        throw error;
      });
    fileHandles.set(normalized, promise);
    return promise;
  }

  async function prepareBuildReads(): Promise<ProjectBuildReadPreparation> {
    const startedAt = performance.now();
    if (typeof root.entries !== "function") {
      return {
        indexed: false,
        fileCount: 0,
        directoryCount: 0,
        durationMs: Math.round(performance.now() - startedAt),
        message: "This browser does not expose directory iteration; direct file-handle lookup will be used.",
      };
    }

    // Rebuild the positive handle cache at the start of every build. This keeps
    // the index aligned with the current checkout without changing the behavior
    // of missing-path checks, which still fall back to direct filesystem access.
    fileHandles.clear();
    directoryHandles.clear();
    directoryHandles.set("", Promise.resolve(root));

    const queue: Array<{ path: string; handle: BrowserDirectoryHandle }> = [
      { path: "", handle: root },
    ];
    let fileCount = 0;
    let directoryCount = 1;

    try {
      while (queue.length > 0) {
        const current = queue.shift();
        if (!current) {
          break;
        }
        const iterator = current.handle.entries?.();
        if (!iterator) {
          throw new Error("Directory iteration became unavailable while indexing the project.");
        }

        for await (const [name, handle] of iterator) {
          if (current.path === "" && name === ".git") {
            continue;
          }
          const relativePath = current.path ? `${current.path}/${name}` : name;
          if (handle.kind === "file") {
            fileHandles.set(relativePath, Promise.resolve(handle));
            fileCount += 1;
          } else {
            directoryHandles.set(relativePath, Promise.resolve(handle));
            queue.push({ path: relativePath, handle });
            directoryCount += 1;
          }
        }

        // Directory enumeration is much cheaper than thousands of individual
        // getFileHandle calls, but still yield periodically so the status UI can
        // repaint on very large checkouts.
        if (directoryCount % 24 === 0) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        }
      }

      return {
        indexed: true,
        fileCount,
        directoryCount,
        durationMs: Math.round(performance.now() - startedAt),
      };
    } catch (error) {
      return {
        indexed: false,
        fileCount,
        directoryCount,
        durationMs: Math.round(performance.now() - startedAt),
        message: `Project handle indexing was incomplete; direct lookup will be used as needed: ${String(error)}`,
      };
    }
  }

  return {
    displayPath: root.name,
    historyStore,
    prepareBuildReads,

    async readText(relativePath) {
      try {
        const handle = await cachedFileHandle(relativePath);
        const file = await handle.getFile();
        return await file.text();
      } catch (error) {
        throw new Error(`Failed to read ${relativePath}: ${String(error)}`);
      }
    },

    async readBytes(relativePath) {
      try {
        const handle = await cachedFileHandle(relativePath);
        const file = await handle.getFile();
        return new Uint8Array(await file.arrayBuffer());
      } catch (error) {
        throw new Error(`Failed to read ${relativePath}: ${String(error)}`);
      }
    },

    async writeText(relativePath, contents) {
      let writable: BrowserWritableFileStream | null = null;

      try {
        const handle = await cachedFileHandle(relativePath);
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
        await cachedFileHandle(relativePath);
        return true;
      } catch {
        // It may be a directory rather than a file.
      }

      try {
        await cachedDirectoryHandle(parts);
        return true;
      } catch {
        return false;
      }
    },

    async assetUrl(relativePath) {
      const normalized = normalizePath(relativePath);
      const cached = objectUrls.get(normalized);
      if (cached) {
        return cached;
      }

      try {
        const handle = await cachedFileHandle(normalized);
        const file = await handle.getFile();
        const url = URL.createObjectURL(file);
        objectUrls.set(normalized, url);
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
      fileHandles.clear();
      directoryHandles.clear();
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
      const source = createWebSource(root, historyStore);
      return await createProjectSession(source, createWebBuildService(source));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return null;
      }
      throw error;
    }
  },
};