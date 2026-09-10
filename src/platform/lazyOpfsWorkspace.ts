import type {
  HistoryStore,
  ProjectBuildReadPreparation,
  ProjectSource,
} from "../core/types";
import type { WebTrainerCatalogCache } from "./webHistory";
import type {
  WorkspaceExternalDirectoryHandle,
  WorkspaceExternalFileHandle,
} from "./opfsWorkspace";

const WORKSPACE_CONTAINER = "yellow-editor-workspaces";

interface LazyOpfsProjectSource extends ProjectSource {
  trainerCatalogCache: WebTrainerCatalogCache;
  workspaceBacked: true;
}

interface CreateLazyWorkspaceOptions {
  externalRoot: WorkspaceExternalDirectoryHandle;
  identityHint: string;
  historyStore: HistoryStore;
  trainerCatalogCache: WebTrainerCatalogCache;
  storageKey: string;
}

interface PendingPersistence {
  path: string;
  bytes: Uint8Array;
  resolve: () => void;
}

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

function hashIdentity(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

async function workspaceRootForIdentity(
  identityHint: string,
): Promise<FileSystemDirectoryHandle | null> {
  const storage = navigator.storage as StorageManager & {
    getDirectory?: () => Promise<FileSystemDirectoryHandle>;
  };
  if (typeof storage.getDirectory !== "function") {
    return null;
  }
  const root = await storage.getDirectory();
  const container = await root.getDirectoryHandle(WORKSPACE_CONTAINER, { create: true });
  return container.getDirectoryHandle(hashIdentity(identityHint), { create: true });
}

async function opfsDirectoryForPath(
  root: FileSystemDirectoryHandle,
  parts: string[],
  create: boolean,
): Promise<FileSystemDirectoryHandle> {
  let directory = root;
  for (const part of parts) {
    directory = await directory.getDirectoryHandle(part, { create });
  }
  return directory;
}

async function opfsFileForPath(
  root: FileSystemDirectoryHandle,
  relativePath: string,
  create: boolean,
): Promise<FileSystemFileHandle> {
  const parts = pathParts(relativePath);
  const fileName = parts.pop();
  if (!fileName) {
    throw new Error(`Expected file path, got '${relativePath}'.`);
  }
  const directory = await opfsDirectoryForPath(root, parts, create);
  return directory.getFileHandle(fileName, { create });
}

async function externalDirectoryForPath(
  root: WorkspaceExternalDirectoryHandle,
  parts: string[],
): Promise<WorkspaceExternalDirectoryHandle> {
  let directory = root;
  for (const part of parts) {
    directory = await directory.getDirectoryHandle(part);
  }
  return directory;
}

async function externalFileForPath(
  root: WorkspaceExternalDirectoryHandle,
  relativePath: string,
): Promise<WorkspaceExternalFileHandle> {
  const parts = pathParts(relativePath);
  const fileName = parts.pop();
  if (!fileName) {
    throw new Error(`Expected file path, got '${relativePath}'.`);
  }
  const directory = await externalDirectoryForPath(root, parts);
  return directory.getFileHandle(fileName);
}

async function writeOpfsFile(
  handle: FileSystemFileHandle,
  contents: string | Uint8Array,
): Promise<void> {
  const writable = await handle.createWritable();
  try {
    await writable.write(contents);
    await writable.close();
  } catch (error) {
    try {
      await writable.abort();
    } catch {
      // Preserve the original failure.
    }
    throw error;
  }
}

function mimeTypeForPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".gif")) {
    return "image/gif";
  }
  if (lower.endsWith(".svg")) {
    return "image/svg+xml";
  }
  return "application/octet-stream";
}

export async function createLazyOpfsProjectSource(
  options: CreateLazyWorkspaceOptions,
): Promise<LazyOpfsProjectSource | null> {
  const workspaceRoot = await workspaceRootForIdentity(options.identityHint);
  if (!workspaceRoot) {
    return null;
  }

  // Persistence is best-effort and should never delay opening the editor.
  void navigator.storage.persist().catch(() => undefined);

  const memoryBytes = new Map<string, Uint8Array>();
  const objectUrls = new Map<string, string>();
  const pendingReads = new Map<string, Promise<Uint8Array>>();
  const pendingPersistence = new Map<string, Promise<void>>();
  const persistQueue: PendingPersistence[] = [];
  let persistenceRunning = false;
  let disposed = false;
  let opfsHits = 0;
  let externalReads = 0;

  async function drainPersistenceQueue(): Promise<void> {
    if (persistenceRunning) {
      return;
    }
    persistenceRunning = true;
    try {
      while (!disposed && persistQueue.length > 0) {
        const item = persistQueue.shift();
        if (!item) {
          continue;
        }
        try {
          const handle = await opfsFileForPath(workspaceRoot, item.path, true);
          await writeOpfsFile(handle, item.bytes);
        } catch (error) {
          console.warn(`Could not persist ${item.path} in the browser workspace.`, error);
        } finally {
          pendingPersistence.delete(item.path);
          item.resolve();
        }
        // Let foreground input/render work run between small OPFS writes.
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
    } finally {
      persistenceRunning = false;
    }
  }

  function queuePersistence(path: string, bytes: Uint8Array): Promise<void> {
    const existing = pendingPersistence.get(path);
    if (existing) {
      return existing;
    }
    const promise = new Promise<void>((resolve) => {
      persistQueue.push({ path, bytes: bytes.slice(), resolve });
    });
    pendingPersistence.set(path, promise);
    void drainPersistenceQueue();
    return promise;
  }

  async function readCachedBytes(path: string): Promise<Uint8Array | null> {
    try {
      const handle = await opfsFileForPath(workspaceRoot, path, false);
      const file = await handle.getFile();
      const bytes = new Uint8Array(await file.arrayBuffer());
      opfsHits += 1;
      return bytes;
    } catch {
      return null;
    }
  }

  async function loadBytes(relativePath: string): Promise<Uint8Array> {
    const path = normalizePath(relativePath);
    const inMemory = memoryBytes.get(path);
    if (inMemory) {
      return inMemory;
    }

    const active = pendingReads.get(path);
    if (active) {
      return active;
    }

    const pending = (async () => {
      const cached = await readCachedBytes(path);
      if (cached) {
        memoryBytes.set(path, cached);
        return cached;
      }

      const externalHandle = await externalFileForPath(options.externalRoot, path);
      const externalFile = await externalHandle.getFile();
      const bytes = new Uint8Array(await externalFile.arrayBuffer());
      externalReads += 1;
      memoryBytes.set(path, bytes);

      // Do not make the foreground parser wait for thousands of tiny OPFS
      // create/write operations. Cache persistence happens serially behind it.
      void queuePersistence(path, bytes);
      return bytes;
    })().finally(() => {
      pendingReads.delete(path);
    });

    pendingReads.set(path, pending);
    return pending;
  }

  async function opfsHasFile(path: string): Promise<boolean> {
    try {
      await opfsFileForPath(workspaceRoot, path, false);
      return true;
    } catch {
      return false;
    }
  }

  return {
    displayPath: options.externalRoot.name,
    storageKey: `${options.storageKey}:opfs-lazy`,
    historyStore: options.historyStore,
    trainerCatalogCache: options.trainerCatalogCache,
    workspaceBacked: true,

    async readText(relativePath) {
      try {
        const bytes = await loadBytes(relativePath);
        return new TextDecoder().decode(bytes);
      } catch (error) {
        throw new Error(`Failed to read ${relativePath}: ${String(error)}`);
      }
    },

    async readBytes(relativePath) {
      try {
        return (await loadBytes(relativePath)).slice();
      } catch (error) {
        throw new Error(`Failed to read ${relativePath}: ${String(error)}`);
      }
    },

    async writeText(relativePath, contents) {
      const path = normalizePath(relativePath);
      const beforeBytes = await loadBytes(path);
      const beforeText = new TextDecoder().decode(beforeBytes);

      // If a first-read cache write is still queued, let it finish so an old
      // background write cannot race with this user edit.
      await pendingPersistence.get(path);

      const externalHandle = await externalFileForPath(options.externalRoot, path);
      const externalFile = await externalHandle.getFile();
      const currentExternalText = await externalFile.text();
      if (currentExternalText !== beforeText) {
        throw new Error(
          `${path} changed outside Yellow Editor after it was cached. Reopen the project before saving so the external change is preserved.`,
        );
      }

      const nextBytes = new TextEncoder().encode(contents);
      const workspaceHandle = await opfsFileForPath(workspaceRoot, path, true);
      await writeOpfsFile(workspaceHandle, contents);
      memoryBytes.set(path, nextBytes);

      let writable: Awaited<ReturnType<WorkspaceExternalFileHandle["createWritable"]>> | null = null;
      try {
        writable = await externalHandle.createWritable();
        await writable.write(contents);
        await writable.close();
      } catch (error) {
        try {
          await writable?.abort?.();
        } catch {
          // Preserve the original synchronization failure.
        }
        await writeOpfsFile(workspaceHandle, beforeBytes);
        memoryBytes.set(path, beforeBytes);
        throw new Error(
          `Yellow Editor updated its browser cache but could not synchronize ${path} back to the selected project folder. The browser copy was rolled back. ${String(error)}`,
        );
      }

      const oldUrl = objectUrls.get(path);
      if (oldUrl) {
        URL.revokeObjectURL(oldUrl);
        objectUrls.delete(path);
      }
    },

    async exists(relativePath) {
      const path = normalizePath(relativePath);
      if (!path) {
        return true;
      }
      if (memoryBytes.has(path) || await opfsHasFile(path)) {
        return true;
      }
      try {
        await externalFileForPath(options.externalRoot, path);
        return true;
      } catch {
        // It may be a directory rather than a file.
      }
      try {
        await externalDirectoryForPath(options.externalRoot, pathParts(path));
        return true;
      } catch {
        return false;
      }
    },

    async assetUrl(relativePath) {
      const path = normalizePath(relativePath);
      const cachedUrl = objectUrls.get(path);
      if (cachedUrl) {
        return cachedUrl;
      }
      try {
        const bytes = await loadBytes(path);
        const url = URL.createObjectURL(new Blob([bytes], { type: mimeTypeForPath(path) }));
        objectUrls.set(path, url);
        return url;
      } catch {
        return null;
      }
    },

    async prepareBuildReads(): Promise<ProjectBuildReadPreparation> {
      return {
        indexed: false,
        fileCount: memoryBytes.size,
        directoryCount: 0,
        durationMs: 0,
        message: externalReads === 0
          ? `Build will reuse ${opfsHits} browser-workspace file reads and cache additional inputs as needed.`
          : `Browser workspace has cached ${memoryBytes.size} files this session; additional build inputs will be cached only when requested.`,
      };
    },

    dispose() {
      disposed = true;
      for (const item of persistQueue.splice(0)) {
        pendingPersistence.delete(item.path);
        item.resolve();
      }
      for (const url of objectUrls.values()) {
        URL.revokeObjectURL(url);
      }
      objectUrls.clear();
      memoryBytes.clear();
      pendingReads.clear();
    },
  };
}
