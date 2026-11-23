import { browserDatabaseName } from "./releaseChannel";

export interface GraphicsDraft {
  version: 1; sourceHash: string; width: number; height: number; depth: 1 | 2; pixels: number[];
}
let database: Promise<IDBDatabase> | undefined;
const queue = new Map<string, Promise<unknown>>();
function open(): Promise<IDBDatabase> {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(browserDatabaseName("yellow-editor-graphics-drafts"), 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); database = undefined; }; resolve(request.result); };
    request.onerror = request.onblocked = () => { database = undefined; reject(new Error("Graphics draft storage is unavailable.")); };
  });
}
export async function graphicsDraftOperation(project: string, path: string, operation: "read" | "write" | "delete", draft?: GraphicsDraft): Promise<GraphicsDraft | null> {
  const key = JSON.stringify([project, path]);
  const result = (queue.get(key) ?? Promise.resolve()).catch(() => undefined).then(async () => {
    const db = await open();
    return new Promise<GraphicsDraft | null>((resolve, reject) => {
      const transaction = db.transaction("drafts", operation === "read" ? "readonly" : "readwrite");
      const store = transaction.objectStore("drafts");
      const request = operation === "read" ? store.get(key) : operation === "write" ? store.put(draft, key) : store.delete(key);
      transaction.oncomplete = () => resolve(operation === "read" ? request.result ?? null : null);
      transaction.onerror = transaction.onabort = () => reject(transaction.error ?? new Error("Could not retain the graphics draft."));
    });
  });
  queue.set(key, result);
  const cleanup = () => { if (queue.get(key) === result) queue.delete(key); };
  void result.then(cleanup, cleanup);
  return result;
}
