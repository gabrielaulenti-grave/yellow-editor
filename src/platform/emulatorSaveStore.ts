import type {
  BuildTarget,
  SaveCompatibilityDescriptor,
} from "../core/types";

const DATABASE_NAME = "yellow-editor-emulator";
const DATABASE_VERSION = 1;
const SAVE_STORE = "battery-saves";
const PROJECT_TARGET_INDEX = "project-target";

interface StoredBatterySave {
  id: string;
  projectTarget: string;
  projectStorageKey: string;
  target: BuildTarget;
  compatibility: SaveCompatibilityDescriptor;
  ram: ArrayBuffer;
  updatedAt: string;
}

export type BatterySaveCompatibility =
  | "compatible"
  | "event-schema-changed"
  | "structure-changed"
  | "epoch-changed";

export interface BatterySaveLookup {
  ram: Uint8Array | null;
  compatibility: BatterySaveCompatibility | null;
  previousUpdatedAt: string | null;
}

function projectTargetKey(projectStorageKey: string, target: BuildTarget): string {
  return `${projectStorageKey}\u0000${target}`;
}

function descriptorKey(descriptor: SaveCompatibilityDescriptor): string {
  return [
    descriptor.formatVersion,
    descriptor.saveEpoch,
    descriptor.target,
    descriptor.structuralHash,
    descriptor.eventSchemaHash,
  ].join(":");
}

function recordId(
  projectStorageKey: string,
  target: BuildTarget,
  descriptor: SaveCompatibilityDescriptor,
): string {
  return `${projectTargetKey(projectStorageKey, target)}\u0000${descriptorKey(descriptor)}`;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      let store: IDBObjectStore;
      if (!database.objectStoreNames.contains(SAVE_STORE)) {
        store = database.createObjectStore(SAVE_STORE, { keyPath: "id" });
      } else {
        store = request.transaction!.objectStore(SAVE_STORE);
      }
      if (!store.indexNames.contains(PROJECT_TARGET_INDEX)) {
        store.createIndex(PROJECT_TARGET_INDEX, "projectTarget", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open emulator save storage."));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Emulator save storage request failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Emulator save storage transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Emulator save storage transaction was aborted."));
  });
}

function compatibilityStatus(
  previous: SaveCompatibilityDescriptor,
  current: SaveCompatibilityDescriptor,
): BatterySaveCompatibility {
  if (
    previous.formatVersion !== current.formatVersion ||
    previous.saveEpoch !== current.saveEpoch
  ) {
    return "epoch-changed";
  }
  if (previous.structuralHash !== current.structuralHash) {
    return "structure-changed";
  }
  if (previous.eventSchemaHash !== current.eventSchemaHash) {
    return "event-schema-changed";
  }
  return "compatible";
}

async function getExactSave(
  database: IDBDatabase,
  projectStorageKey: string,
  target: BuildTarget,
  descriptor: SaveCompatibilityDescriptor,
): Promise<StoredBatterySave | undefined> {
  const transaction = database.transaction(SAVE_STORE, "readonly");
  const done = transactionDone(transaction);
  const record = await requestResult(
    transaction.objectStore(SAVE_STORE).get(
      recordId(projectStorageKey, target, descriptor),
    ) as IDBRequest<StoredBatterySave | undefined>,
  );
  await done;
  return record;
}

export async function requestPersistentEmulatorStorage(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) {
      return null;
    }
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

export async function loadBatterySave(
  projectStorageKey: string,
  target: BuildTarget,
  descriptor: SaveCompatibilityDescriptor,
): Promise<BatterySaveLookup> {
  const database = await openDatabase();
  const exact = await getExactSave(database, projectStorageKey, target, descriptor);
  if (exact) {
    return {
      ram: new Uint8Array(exact.ram.slice(0)),
      compatibility: "compatible",
      previousUpdatedAt: exact.updatedAt,
    };
  }

  const projectTarget = projectTargetKey(projectStorageKey, target);
  const transaction = database.transaction(SAVE_STORE, "readonly");
  const done = transactionDone(transaction);
  const records = await requestResult(
    transaction.objectStore(SAVE_STORE).index(PROJECT_TARGET_INDEX).getAll(projectTarget) as IDBRequest<StoredBatterySave[]>,
  );
  await done;

  const previous = records.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  if (!previous) {
    return { ram: null, compatibility: null, previousUpdatedAt: null };
  }

  return {
    ram: null,
    compatibility: compatibilityStatus(previous.compatibility, descriptor),
    previousUpdatedAt: previous.updatedAt,
  };
}

export async function saveBatteryRam(
  projectStorageKey: string,
  target: BuildTarget,
  descriptor: SaveCompatibilityDescriptor,
  ram: Uint8Array,
): Promise<string> {
  const database = await openDatabase();
  const updatedAt = new Date().toISOString();
  const transaction = database.transaction(SAVE_STORE, "readwrite");
  const done = transactionDone(transaction);
  transaction.objectStore(SAVE_STORE).put({
    id: recordId(projectStorageKey, target, descriptor),
    projectTarget: projectTargetKey(projectStorageKey, target),
    projectStorageKey,
    target,
    compatibility: descriptor,
    ram: ram.slice().buffer,
    updatedAt,
  } satisfies StoredBatterySave);
  await done;
  return updatedAt;
}

export async function importBatteryRam(
  projectStorageKey: string,
  target: BuildTarget,
  descriptor: SaveCompatibilityDescriptor,
  ram: Uint8Array,
): Promise<string> {
  const database = await openDatabase();
  const existing = await getExactSave(database, projectStorageKey, target, descriptor);
  const updatedAt = new Date().toISOString();
  const transaction = database.transaction(SAVE_STORE, "readwrite");
  const done = transactionDone(transaction);
  const store = transaction.objectStore(SAVE_STORE);

  if (existing) {
    store.put({
      ...existing,
      id: `${existing.id}\u0000backup\u0000${Date.now()}`,
    } satisfies StoredBatterySave);
  }

  store.put({
    id: recordId(projectStorageKey, target, descriptor),
    projectTarget: projectTargetKey(projectStorageKey, target),
    projectStorageKey,
    target,
    compatibility: descriptor,
    ram: ram.slice().buffer,
    updatedAt,
  } satisfies StoredBatterySave);
  await done;
  return updatedAt;
}
