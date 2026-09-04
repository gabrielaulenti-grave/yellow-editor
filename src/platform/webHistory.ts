import type { HistoryState, HistoryStore } from "../core/types";

const DATABASE_NAME = "yellow-editor";
const DATABASE_VERSION = 1;
const PROJECT_STORE = "project-identities";
const HISTORY_STORE = "project-history";

export interface WebDirectoryIdentityHandle {
  name: string;
  isSameEntry(other: WebDirectoryIdentityHandle): Promise<boolean>;
}

interface StoredProjectIdentity {
  id: string;
  name: string;
  handle: WebDirectoryIdentityHandle;
}

interface StoredHistory {
  projectId: string;
  state: HistoryState;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PROJECT_STORE)) {
        database.createObjectStore(PROJECT_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(HISTORY_STORE)) {
        database.createObjectStore(HISTORY_STORE, { keyPath: "projectId" });
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

async function resolveProjectId(
  database: IDBDatabase,
  root: WebDirectoryIdentityHandle,
): Promise<string> {
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

export async function createWebHistoryStore(
  root: WebDirectoryIdentityHandle,
): Promise<HistoryStore> {
  const database = await openDatabase();
  const projectId = await resolveProjectId(database, root);

  return {
    persistent: true,

    async load() {
      const transaction = database.transaction(HISTORY_STORE, "readonly");
      const done = transactionDone(transaction);
      const record = await requestResult(
        transaction.objectStore(HISTORY_STORE).get(projectId) as IDBRequest<StoredHistory | undefined>,
      );
      await done;
      return record?.state ?? null;
    },

    async save(state) {
      const transaction = database.transaction(HISTORY_STORE, "readwrite");
      const done = transactionDone(transaction);
      transaction.objectStore(HISTORY_STORE).put({
        projectId,
        state,
      } satisfies StoredHistory);
      await done;
    },
  };
}
