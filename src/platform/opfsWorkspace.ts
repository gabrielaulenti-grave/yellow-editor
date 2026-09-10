import type {
  HistoryStore,
  ProjectBuildReadPreparation,
  ProjectSource,
} from "../core/types";
import type { WebTrainerCatalogCache } from "./webHistory";

const WORKSPACE_CONTAINER = "yellow-editor-workspaces";
const MANIFEST_FILE = ".yellow-editor-workspace.json";
const MANIFEST_VERSION = 2;

interface ExternalWritableFileStream {
  write(data: string): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
}

export interface WorkspaceExternalFileHandle {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<ExternalWritableFileStream>;
}

export type WorkspaceExternalEntryHandle =
  | WorkspaceExternalFileHandle
  | WorkspaceExternalDirectoryHandle;

export interface WorkspaceExternalDirectoryHandle {
  kind: "directory";
  name: string;
  getDirectoryHandle(name: string): Promise<WorkspaceExternalDirectoryHandle>;
  getFileHandle(name: string): Promise<WorkspaceExternalFileHandle>;
  entries?(): AsyncIterableIterator<[string, WorkspaceExternalEntryHandle]>;
}

interface WorkspaceFileStamp {
  size: number;
  lastModified: number;
}

interface WorkspaceManifest {
  version: number;
  identityHint: string;
  displayName: string;
  importedAt: string;
  directoryCount: number;
  complete: boolean;
  files: Record<string, WorkspaceFileStamp>;
}

export interface WorkspaceImportProgress {
  stage: "checking" | "enumerating" | "copying" | "ready" | "error";
  message: string;
  completed: number;
  total: number;
  percent: number;
}

export type WorkspaceImportProgressListener = (
  progress: WorkspaceImportProgress,
) => void;

export interface OpfsWorkspaceProjectSource extends ProjectSource {
  trainerCatalogCache: WebTrainerCatalogCache;
  workspaceBacked: true;
}

interface CreateWorkspaceOptions {
  externalRoot: WorkspaceExternalDirectoryHandle;
  identityHint: string;
  historyStore: HistoryStore;
  trainerCatalogCache: WebTrainerCatalogCache;
  storageKey: string;
  onProgress?: WorkspaceImportProgressListener;
}

interface ExternalFileEntry {
  path: string;
  handle: WorkspaceExternalFileHandle;
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

async function readManifest(
  root: FileSystemDirectoryHandle,
): Promise<WorkspaceManifest | null> {
  try {
    const handle = await opfsFileForPath(root, MANIFEST_FILE, false);
    const parsed = JSON.parse(await (await handle.getFile()).text()) as Partial<WorkspaceManifest>;
    if (
      parsed.version !== MANIFEST_VERSION ||
      typeof parsed.identityHint !== "string" ||
      typeof parsed.displayName !== "string" ||
      typeof parsed.importedAt !== "string" ||
      typeof parsed.directoryCount !== "number" ||
      typeof parsed.complete !== "boolean" ||
      !parsed.files ||
      typeof parsed.files !== "object"
    ) {
      return null;
    }
    return parsed as WorkspaceManifest;
  } catch {
    return null;
  }
}

async function writeManifest(
  root: FileSystemDirectoryHandle,
  manifest: WorkspaceManifest,
): Promise<void> {
  const handle = await opfsFileForPath(root, MANIFEST_FILE, true);
  await writeOpfsFile(handle, JSON.stringify(manifest));
}

async function enumerateExternalProject(
  root: WorkspaceExternalDirectoryHandle,
  onProgress?: WorkspaceImportProgressListener,
): Promise<{ files: ExternalFileEntry[]; directoryCount: number }> {
  if (typeof root.entries !== "function") {
    throw new Error(
      "This browser can open the project folder but cannot enumerate it for a local browser workspace.",
    );
  }

  const files: ExternalFileEntry[] = [];
  const queue: Array<{ path: string; handle: WorkspaceExternalDirectoryHandle }> = [
    { path: "", handle: root },
  ];
  let directoryCount = 1;
  let visitedDirectories = 0;

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    const iterator = current.handle.entries?.();
    if (!iterator) {
      throw new Error("Directory iteration became unavailable while importing the project.");
    }

    for await (const [name, handle] of iterator) {
      if (current.path === "" && name === ".git") {
        continue;
      }
      const path = current.path ? `${current.path}/${name}` : name;
      if (handle.kind === "file") {
        files.push({ path, handle });
      } else {
        queue.push({ path, handle });
        directoryCount += 1;
      }
    }

    visitedDirectories += 1;
    if (visitedDirectories % 8 === 0 || queue.length === 0) {
      onProgress?.({
        stage: "enumerating",
        message: `Finding project files for the browser workspace: ${files.length} found`,
        completed: files.length,
        total: 0,
        percent: 5,
      });
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
  }

  return { files, directoryCount };
}

function copyConcurrency(): number {
  const cores = Math.max(1, navigator.hardwareConcurrency || 4);
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  // Keep background mirroring deliberately modest on phones so foreground
  // parser/editor reads remain responsive while the import continues.
  return mobile
    ? Math.max(1, Math.min(2, Math.ceil(cores / 4)))
    : Math.max(3, Math.min(8, Math.ceil(cores / 2)));
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

async function externalStamp(
  externalRoot: WorkspaceExternalDirectoryHandle,
  path: string,
): Promise<WorkspaceFileStamp> {
  const handle = await externalFileForPath(externalRoot, path);
  const file = await handle.getFile();
  return { size: file.size, lastModified: file.lastModified };
}

function stampsMatch(a: WorkspaceFileStamp, b: WorkspaceFileStamp): boolean {
  return a.size === b.size && a.lastModified === b.lastModified;
}

export async function createOpfsWorkspaceProjectSource(
  options: CreateWorkspaceOptions,
): Promise<OpfsWorkspaceProjectSource | null> {
  const resolvedRoot = await workspaceRootForIdentity(options.identityHint);
  if (!resolvedRoot) {
    return null;
  }
  const workspaceRoot: FileSystemDirectoryHandle = resolvedRoot;

  options.onProgress?.({
    stage: "checking",
    message: "Checking persistent browser workspace",
    completed: 0,
    total: 1,
    percent: 1,
  });

  let manifest = await readManifest(workspaceRoot);
  if (
    !manifest ||
    manifest.identityHint !== options.identityHint ||
    manifest.displayName !== options.externalRoot.name
  ) {
    manifest = {
      version: MANIFEST_VERSION,
      identityHint: options.identityHint,
      displayName: options.externalRoot.name,
      importedAt: new Date().toISOString(),
      directoryCount: 0,
      complete: false,
      files: {},
    };
    await writeManifest(workspaceRoot, manifest);
  }

  const currentManifest: WorkspaceManifest = manifest;
  const objectUrls = new Map<string, string>();
  const fileHandles = new Map<string, Promise<FileSystemFileHandle>>();
  const hydrationTasks = new Map<string, Promise<FileSystemFileHandle>>();
  let disposed = false;
  let backgroundImport: Promise<void> | null = null;

  try {
    void navigator.storage.persist().catch(() => undefined);
  } catch {
    // Storage persistence is best-effort.
  }

  function cachedFileHandle(path: string, create = false): Promise<FileSystemFileHandle> {
    const normalized = normalizePath(path);
    if (!create) {
      const cached = fileHandles.get(normalized);
      if (cached) {
        return cached;
      }
    }
    const pending = opfsFileForPath(workspaceRoot, normalized, create).catch((error) => {
      fileHandles.delete(normalized);
      throw error;
    });
    fileHandles.set(normalized, pending);
    return pending;
  }

  async function persistManifest(): Promise<void> {
    await writeManifest(workspaceRoot, currentManifest);
  }

  function hydrateFile(
    relativePath: string,
    knownExternalHandle?: WorkspaceExternalFileHandle,
  ): Promise<FileSystemFileHandle> {
    const path = normalizePath(relativePath);
    const existingTask = hydrationTasks.get(path);
    if (existingTask) {
      return existingTask;
    }

    const task = (async () => {
      if (currentManifest.files[path]) {
        try {
          return await cachedFileHandle(path);
        } catch {
          delete currentManifest.files[path];
          fileHandles.delete(path);
        }
      }

      const externalHandle = knownExternalHandle ?? await externalFileForPath(options.externalRoot, path);
      const externalFile = await externalHandle.getFile();
      const bytes = new Uint8Array(await externalFile.arrayBuffer());
      const target = await cachedFileHandle(path, true);
      await writeOpfsFile(target, bytes);
      currentManifest.files[path] = {
        size: externalFile.size,
        lastModified: externalFile.lastModified,
      };
      return target;
    })().finally(() => {
      hydrationTasks.delete(path);
    });

    hydrationTasks.set(path, task);
    return task;
  }

  async function runBackgroundImport(): Promise<void> {
    try {
      options.onProgress?.({
        stage: "enumerating",
        message: "Browser workspace is active; finding the remaining project files in the background",
        completed: Object.keys(currentManifest.files).length,
        total: 0,
        percent: 5,
      });

      const enumerated = await enumerateExternalProject(options.externalRoot, options.onProgress);
      if (disposed) {
        return;
      }

      currentManifest.directoryCount = enumerated.directoryCount;
      let nextIndex = 0;
      let completed = 0;
      const total = enumerated.files.length;
      const updateEvery = Math.max(1, Math.ceil(total / 100));
      const workerCount = Math.min(copyConcurrency(), Math.max(1, total));

      const workers = Array.from({ length: workerCount }, async () => {
        while (!disposed && nextIndex < total) {
          const entry = enumerated.files[nextIndex];
          nextIndex += 1;
          await hydrateFile(entry.path, entry.handle);
          completed += 1;

          if (completed === total || completed % updateEvery === 0) {
            const percent = total === 0 ? 99 : 10 + Math.round((completed / total) * 89);
            options.onProgress?.({
              stage: "copying",
              message: `Preparing fast browser workspace: ${completed} / ${total} files`,
              completed,
              total,
              percent,
            });
            await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
          }
        }
      });

      await Promise.all(workers);
      if (disposed) {
        return;
      }

      currentManifest.complete = true;
      currentManifest.importedAt = new Date().toISOString();
      await persistManifest();
      options.onProgress?.({
        stage: "ready",
        message: `Fast browser workspace ready with ${total} project files`,
        completed: total,
        total,
        percent: 100,
      });
    } catch (error) {
      currentManifest.complete = false;
      try {
        await persistManifest();
      } catch {
        // Keep the workspace usable through lazy reads even if metadata fails.
      }
      if (!disposed) {
        options.onProgress?.({
          stage: "error",
          message: `Background workspace import could not finish. Yellow Editor will keep loading files on demand. ${String(error)}`,
          completed: Object.keys(currentManifest.files).length,
          total: 0,
          percent: 0,
        });
      }
    }
  }

  if (currentManifest.complete) {
    const fileCount = Object.keys(currentManifest.files).length;
    options.onProgress?.({
      stage: "ready",
      message: `Reusing fast browser workspace with ${fileCount} project files`,
      completed: fileCount,
      total: fileCount,
      percent: 100,
    });
  } else {
    // Do not block project opening on the full mirror. Foreground reads hydrate
    // the files they need immediately, while the rest of the checkout is copied
    // with low concurrency in the background.
    backgroundImport = new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0);
    }).then(runBackgroundImport);
  }

  return {
    displayPath: options.externalRoot.name,
    storageKey: `${options.storageKey}:opfs`,
    historyStore: options.historyStore,
    trainerCatalogCache: options.trainerCatalogCache,
    workspaceBacked: true,

    async readText(relativePath) {
      try {
        const handle = await hydrateFile(relativePath);
        return await (await handle.getFile()).text();
      } catch (error) {
        throw new Error(`Failed to read ${relativePath} from browser workspace: ${String(error)}`);
      }
    },

    async readBytes(relativePath) {
      try {
        const handle = await hydrateFile(relativePath);
        const file = await handle.getFile();
        return new Uint8Array(await file.arrayBuffer());
      } catch (error) {
        throw new Error(`Failed to read ${relativePath} from browser workspace: ${String(error)}`);
      }
    },

    async writeText(relativePath, contents) {
      const path = normalizePath(relativePath);
      const workspaceHandle = await hydrateFile(path);
      const previousWorkspaceContents = await (await workspaceHandle.getFile()).text();
      const expectedExternal = currentManifest.files[path];

      if (expectedExternal) {
        const currentExternal = await externalStamp(options.externalRoot, path);
        if (!stampsMatch(expectedExternal, currentExternal)) {
          throw new Error(
            `${path} changed outside Yellow Editor after the browser workspace loaded it. Reopen the project before saving so the external change is preserved.`,
          );
        }
      }

      await writeOpfsFile(workspaceHandle, contents);

      let writable: ExternalWritableFileStream | null = null;
      try {
        const externalHandle = await externalFileForPath(options.externalRoot, path);
        writable = await externalHandle.createWritable();
        await writable.write(contents);
        await writable.close();
        currentManifest.files[path] = await externalStamp(options.externalRoot, path);
        await persistManifest();
      } catch (error) {
        try {
          await writable?.abort?.();
        } catch {
          // Preserve the original synchronization failure.
        }
        try {
          await writeOpfsFile(workspaceHandle, previousWorkspaceContents);
        } catch {
          // The caller will be told to reopen the project if rollback also fails.
        }
        throw new Error(
          `The browser workspace changed ${path}, but Yellow Editor could not synchronize it back to the selected project folder. The workspace copy was rolled back when possible. ${String(error)}`,
        );
      }
    },

    async exists(relativePath) {
      const path = normalizePath(relativePath);
      if (!path) {
        return true;
      }

      if (currentManifest.files[path]) {
        try {
          await cachedFileHandle(path);
          return true;
        } catch {
          delete currentManifest.files[path];
          fileHandles.delete(path);
        }
      }

      try {
        await opfsDirectoryForPath(workspaceRoot, pathParts(path), false);
        return true;
      } catch {
        // The first import may not have reached this path yet.
      }

      if (!currentManifest.complete) {
        try {
          await externalFileForPath(options.externalRoot, path);
          return true;
        } catch {
          // It may be an external directory.
        }
        try {
          await externalDirectoryForPath(options.externalRoot, pathParts(path));
          return true;
        } catch {
          return false;
        }
      }

      return false;
    },

    async assetUrl(relativePath) {
      const path = normalizePath(relativePath);
      const cached = objectUrls.get(path);
      if (cached) {
        return cached;
      }
      try {
        const handle = await hydrateFile(path);
        const file = await handle.getFile();
        const url = URL.createObjectURL(file);
        objectUrls.set(path, url);
        return url;
      } catch {
        return null;
      }
    },

    async prepareBuildReads(): Promise<ProjectBuildReadPreparation> {
      const startedAt = performance.now();
      if (backgroundImport) {
        await backgroundImport;
      }
      return {
        indexed: currentManifest.complete,
        fileCount: Object.keys(currentManifest.files).length,
        directoryCount: currentManifest.directoryCount,
        durationMs: Math.round(performance.now() - startedAt),
        message: currentManifest.complete
          ? "Build inputs are available in the persistent browser workspace."
          : "The background workspace import was incomplete; missing build inputs will be loaded into OPFS on demand.",
      };
    },

    dispose() {
      disposed = true;
      for (const url of objectUrls.values()) {
        URL.revokeObjectURL(url);
      }
      objectUrls.clear();
      fileHandles.clear();
      hydrationTasks.clear();
    },
  };
}
