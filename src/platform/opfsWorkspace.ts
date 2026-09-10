import type {
  HistoryStore,
  ProjectBuildReadPreparation,
  ProjectSource,
} from "../core/types";
import type { WebTrainerCatalogCache } from "./webHistory";

const WORKSPACE_CONTAINER = "yellow-editor-workspaces";
const MANIFEST_FILE = ".yellow-editor-workspace.json";
const MANIFEST_VERSION = 1;

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
  files: Record<string, WorkspaceFileStamp>;
}

export interface WorkspaceImportProgress {
  stage: "checking" | "enumerating" | "copying" | "ready";
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

    if (directoryCount % 16 === 0) {
      onProgress?.({
        stage: "enumerating",
        message: `Preparing browser workspace: found ${files.length} files`,
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
  return mobile
    ? Math.max(3, Math.min(6, Math.ceil(cores / 2)))
    : Math.max(4, Math.min(10, cores));
}

async function importExternalProject(
  externalRoot: WorkspaceExternalDirectoryHandle,
  workspaceRoot: FileSystemDirectoryHandle,
  identityHint: string,
  onProgress?: WorkspaceImportProgressListener,
): Promise<WorkspaceManifest> {
  onProgress?.({
    stage: "enumerating",
    message: "Preparing browser workspace: scanning the project once",
    completed: 0,
    total: 0,
    percent: 2,
  });

  const enumerated = await enumerateExternalProject(externalRoot, onProgress);
  const manifest: WorkspaceManifest = {
    version: MANIFEST_VERSION,
    identityHint,
    displayName: externalRoot.name,
    importedAt: new Date().toISOString(),
    directoryCount: enumerated.directoryCount,
    files: {},
  };

  let nextIndex = 0;
  let completed = 0;
  const total = enumerated.files.length;
  const updateEvery = Math.max(1, Math.ceil(total / 50));
  const workerCount = Math.min(copyConcurrency(), Math.max(1, total));
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < total) {
      const entry = enumerated.files[nextIndex];
      nextIndex += 1;
      const sourceFile = await entry.handle.getFile();
      const contents = new Uint8Array(await sourceFile.arrayBuffer());
      const target = await opfsFileForPath(workspaceRoot, entry.path, true);
      await writeOpfsFile(target, contents);
      manifest.files[entry.path] = {
        size: sourceFile.size,
        lastModified: sourceFile.lastModified,
      };
      completed += 1;
      if (completed === total || completed % updateEvery === 0) {
        const percent = total === 0 ? 95 : 10 + Math.round((completed / total) * 85);
        onProgress?.({
          stage: "copying",
          message: `Importing project into fast browser storage: ${completed} / ${total} files`,
          completed,
          total,
          percent,
        });
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
    }
  });
  await Promise.all(workers);
  await writeManifest(workspaceRoot, manifest);
  return manifest;
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
    manifest = await importExternalProject(
      options.externalRoot,
      workspaceRoot,
      options.identityHint,
      options.onProgress,
    );
  } else {
    options.onProgress?.({
      stage: "ready",
      message: `Reusing browser workspace with ${Object.keys(manifest.files).length} files`,
      completed: 1,
      total: 1,
      percent: 100,
    });
  }

  try {
    await navigator.storage.persist();
  } catch {
    // Storage persistence is best-effort.
  }

  const currentManifest: WorkspaceManifest = manifest;
  const objectUrls = new Map<string, string>();
  const fileHandles = new Map<string, Promise<FileSystemFileHandle>>();

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

  return {
    displayPath: options.externalRoot.name,
    storageKey: `${options.storageKey}:opfs`,
    historyStore: options.historyStore,
    trainerCatalogCache: options.trainerCatalogCache,
    workspaceBacked: true,

    async readText(relativePath) {
      try {
        const handle = await cachedFileHandle(relativePath);
        return await (await handle.getFile()).text();
      } catch (error) {
        throw new Error(`Failed to read ${relativePath} from browser workspace: ${String(error)}`);
      }
    },

    async readBytes(relativePath) {
      try {
        const handle = await cachedFileHandle(relativePath);
        const file = await handle.getFile();
        return new Uint8Array(await file.arrayBuffer());
      } catch (error) {
        throw new Error(`Failed to read ${relativePath} from browser workspace: ${String(error)}`);
      }
    },

    async writeText(relativePath, contents) {
      const path = normalizePath(relativePath);
      const workspaceHandle = await cachedFileHandle(path);
      const previousWorkspaceContents = await (await workspaceHandle.getFile()).text();
      const expectedExternal = currentManifest.files[path];

      if (expectedExternal) {
        const currentExternal = await externalStamp(options.externalRoot, path);
        if (!stampsMatch(expectedExternal, currentExternal)) {
          throw new Error(
            `${path} changed outside Yellow Editor after the browser workspace was imported. Reopen/re-import the project before saving so the external change is preserved.`,
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
      try {
        await cachedFileHandle(path);
        return true;
      } catch {
        // It may be a directory.
      }
      try {
        await opfsDirectoryForPath(workspaceRoot, pathParts(path), false);
        return true;
      } catch {
        return false;
      }
    },

    async assetUrl(relativePath) {
      const path = normalizePath(relativePath);
      const cached = objectUrls.get(path);
      if (cached) {
        return cached;
      }
      try {
        const handle = await cachedFileHandle(path);
        const file = await handle.getFile();
        const url = URL.createObjectURL(file);
        objectUrls.set(path, url);
        return url;
      } catch {
        return null;
      }
    },

    async prepareBuildReads(): Promise<ProjectBuildReadPreparation> {
      return {
        indexed: true,
        fileCount: Object.keys(currentManifest.files).length,
        directoryCount: currentManifest.directoryCount,
        durationMs: 0,
        message: "Build inputs are already available in the persistent browser workspace.",
      };
    },

    dispose() {
      for (const url of objectUrls.values()) {
        URL.revokeObjectURL(url);
      }
      objectUrls.clear();
      fileHandles.clear();
    },
  };
}
