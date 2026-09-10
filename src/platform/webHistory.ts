import type {
  HistoryEntry,
  HistoryPendingOperation,
  HistoryState,
  HistoryStore,
  TrainerCatalog,
} from "../core/types";

const DATABASE_NAME = "yellow-editor";
const DATABASE_VERSION = 2;
const PROJECT_STORE = "project-identities";
const LEGACY_HISTORY_STORE = "project-history";
const HISTORY_META_STORE = "project-history-meta";
const HISTORY_ENTRY_STORE = "project-history-entries";
const HISTORY_ENTRY_PROJECT_INDEX = "projectId";
const TRAINER_CACHE_STORE = "trainer-catalog-cache";
const TRAINER_CACHE_VERSION = 1;

export interface WebDirectoryIdentityHandle {
  name: string;
  isSameEntry(other: WebDirectoryIdentityHandle): Promise<boolean>;
}

export interface WebTrainerCatalogCache {
  load(): Promise<TrainerCatalog | null>;
  save(catalog: TrainerCatalog): Promise<void>;
  clear(): Promise<void>;
}

export interface WebProjectStorageOptions {
  identityHint?: string;
  persistentHistory?: boolean;
}

export interface WebProjectStorageContext {
  projectId: string;
  historyStore: HistoryStore;
  trainerCatalogCache: WebTrainerCatalogCache;
}

interface StoredProjectIdentity {
  id: string;
  name: string;
  handle: WebDirectoryIdentityHandle;
}

interface StoredLegacyHistory {
  projectId: string;
  state: HistoryState;
}

interface StoredHistoryMeta {
  projectId: string;
  version: number;
  cursor: number;
  pending: HistoryPendingOperation | null;
  entryIds: string[];
}

interface StoredHistoryEntry {
  key: string;
  projectId: string;
  entry: HistoryEntry;
}

interface StoredTrainerCatalog {
  projectId: string;
  version: number;
  catalog: TrainerCatalog;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PROJECT_STORE)) {
        database.createObjectStore(PROJECT_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(LEGACY_HISTORY_STORE)) {
        database.createObjectStore(LEGACY_HISTORY_STORE, { keyPath: "projectId" });
      }
      if (!database.objectStoreNames.contains(HISTORY_META_STORE)) {
        database.createObjectStore(HISTORY_META_STORE, { keyPath: "projectId" });
      }
      if (!database.objectStoreNames.contains(HISTORY_ENTRY_STORE)) {
        const store = database.createObjectStore(HISTORY_ENTRY_STORE, { keyPath: "key" });
        store.createIndex(HISTORY_ENTRY_PROJECT_INDEX, "projectId", { unique: false });
      }
      if (!database.objectStoreNames.contains(TRAINER_CACHE_STORE)) {
        database.createObjectStore(TRAINER_CACHE_STORE, { keyPath: "projectId" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open IndexedDB."));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction was aborted."));
  });
}

function createId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function historyEntryKey(projectId: string, entryId: string): string {
  return `${projectId}:${entryId}`;
}

async function resolveProjectId(
  database: IDBDatabase,
  root: WebDirectoryIdentityHandle,
  identityHint?: string,
): Promise<string> {
  // Some mobile Chromium builds do not reliably round-trip directory handles
  // through IndexedDB. When the caller can provide a stable folder signature,
  // use it directly so caches survive a page refresh without depending on
  // FileSystemHandle.isSameEntry().
  if (identityHint) {
    return `hint:${identityHint}`;
  }

  const readTransaction = database.transaction(PROJECT_STORE, "readonly");
  const readDone = transactionDone(readTransaction);
  const stored = await requestResult(
    readTransaction.objectStore(PROJECT_STORE).getAll() as IDBRequest<StoredProjectIdentity[]>,
  );
  await readDone;

  for (const candidate of stored) {
    try {
      if (await root.isSameEntry(candidate.handle)) {
        return candidate.id;
      }
    } catch {
      // A stale or revoked stored handle should not prevent opening the folder.
    }
  }

  const id = createId();
  const writeTransaction = database.transaction(PROJECT_STORE, "readwrite");
  const writeDone = transactionDone(writeTransaction);
  writeTransaction.objectStore(PROJECT_STORE).put({
    id,
    name: root.name,
    handle: root,
  } satisfies StoredProjectIdentity);
  await writeDone;
  return id;
}

function memoryHistoryStore(): HistoryStore {
  let state: HistoryState | null = null;
  return {
    persistent: false,
    async load() {
      return state;
    },
    async save(nextState) {
      state = nextState;
    },
  };
}

function historyStoreForProject(database: IDBDatabase, projectId: string): HistoryStore {
  let lastSavedState: HistoryState | null = null;
  let hasStructuredHistory = false;

  return {
    persistent: true,

    async load() {
      const transaction = database.transaction(
        [HISTORY_META_STORE, HISTORY_ENTRY_STORE],
        "readonly",
      );
      const done = transactionDone(transaction);
      const meta = await requestResult(
        transaction.objectStore(HISTORY_META_STORE).get(projectId) as IDBRequest<StoredHistoryMeta | undefined>,
      );

      if (meta) {
        const records = await requestResult(
          transaction
            .objectStore(HISTORY_ENTRY_STORE)
            .index(HISTORY_ENTRY_PROJECT_INDEX)
            .getAll(projectId) as IDBRequest<StoredHistoryEntry[]>,
        );
        await done;
        const byId = new Map(records.map((record) => [record.entry.id, record.entry]));
        const entries = meta.entryIds
          .map((id) => byId.get(id))
          .filter((entry): entry is HistoryEntry => Boolean(entry));
        const state: HistoryState = {
          version: meta.version,
          entries,
          cursor: meta.cursor,
          pending: meta.pending,
        };
        lastSavedState = state;
        hasStructuredHistory = true;
        return state;
      }

      await done;
      const legacyTransaction = database.transaction(LEGACY_HISTORY_STORE, "readonly");
      const legacyDone = transactionDone(legacyTransaction);
      const legacy = await requestResult(
        legacyTransaction.objectStore(LEGACY_HISTORY_STORE).get(projectId) as IDBRequest<StoredLegacyHistory | undefined>,
      );
      await legacyDone;
      lastSavedState = legacy?.state ?? null;
      hasStructuredHistory = false;
      return legacy?.state ?? null;
    },

    async save(state) {
      const transaction = database.transaction(
        [HISTORY_META_STORE, HISTORY_ENTRY_STORE],
        "readwrite",
      );
      const done = transactionDone(transaction);
      const entryStore = transaction.objectStore(HISTORY_ENTRY_STORE);
      const previousIds = new Set(lastSavedState?.entries.map((entry) => entry.id) ?? []);
      const currentIds = new Set(state.entries.map((entry) => entry.id));

      for (const entry of state.entries) {
        if (!hasStructuredHistory || !previousIds.has(entry.id)) {
          entryStore.put({
            key: historyEntryKey(projectId, entry.id),
            projectId,
            entry,
          } satisfies StoredHistoryEntry);
        }
      }
      if (hasStructuredHistory) {
        for (const entryId of previousIds) {
          if (!currentIds.has(entryId)) {
            entryStore.delete(historyEntryKey(projectId, entryId));
          }
        }
      }

      transaction.objectStore(HISTORY_META_STORE).put({
        projectId,
        version: state.version,
        cursor: state.cursor,
        pending: state.pending ?? null,
        entryIds: state.entries.map((entry) => entry.id),
      } satisfies StoredHistoryMeta);
      await done;

      lastSavedState = state;
      hasStructuredHistory = true;
    },
  };
}

function trainerCatalogCacheForProject(
  database: IDBDatabase,
  projectId: string,
): WebTrainerCatalogCache {
  return {
    async load() {
      const transaction = database.transaction(TRAINER_CACHE_STORE, "readonly");
      const done = transactionDone(transaction);
      const record = await requestResult(
        transaction.objectStore(TRAINER_CACHE_STORE).get(projectId) as IDBRequest<StoredTrainerCatalog | undefined>,
      );
      await done;
      return record?.version === TRAINER_CACHE_VERSION ? record.catalog : null;
    },

    async save(catalog) {
      const transaction = database.transaction(TRAINER_CACHE_STORE, "readwrite");
      const done = transactionDone(transaction);
      transaction.objectStore(TRAINER_CACHE_STORE).put({
        projectId,
        version: TRAINER_CACHE_VERSION,
        catalog,
      } satisfies StoredTrainerCatalog);
      await done;
    },

    async clear() {
      const transaction = database.transaction(TRAINER_CACHE_STORE, "readwrite");
      const done = transactionDone(transaction);
      transaction.objectStore(TRAINER_CACHE_STORE).delete(projectId);
      await done;
    },
  };
}

export async function createWebProjectStorage(
  root: WebDirectoryIdentityHandle,
  options: WebProjectStorageOptions = {},
): Promise<WebProjectStorageContext> {
  const database = await openDatabase();
  const projectId = await resolveProjectId(database, root, options.identityHint);
  return {
    projectId,
    historyStore: options.persistentHistory === false
      ? memoryHistoryStore()
      : historyStoreForProject(database, projectId),
    trainerCatalogCache: trainerCatalogCacheForProject(database, projectId),
  };
}

export async function createWebHistoryStore(
  root: WebDirectoryIdentityHandle,
): Promise<HistoryStore> {
  return (await createWebProjectStorage(root)).historyStore;
}
