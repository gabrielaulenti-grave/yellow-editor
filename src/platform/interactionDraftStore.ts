import type { InteractionDocument, InteractionValues } from "../core/scriptInteractions";
import { browserDatabaseName } from "./releaseChannel";

export interface InteractionDraftData {
  values: InteractionValues; item: string; quantity: number; species: string;
  level: number; fixBagFull: boolean; routeText: string;
}
export interface InteractionDraft {
  version: 1; projectKey: string; path: string; label: string; updatedAt: string;
  sources: InteractionDocument["sources"]; data: InteractionDraftData;
}
export function interactionDraftBaseline(document: InteractionDocument): InteractionDraftData {
  return { values: structuredClone(document.values), item: document.reward?.item ?? "", quantity: document.reward?.quantity ?? 1,
    species: document.gift?.species ?? "", level: document.gift?.level ?? 5, fixBagFull: false, routeText: document.values.movement?.steps.join(", ") ?? "DOWN" };
}
const key = (document: Pick<InteractionDocument, "projectKey" | "path" | "label">) => JSON.stringify([document.projectKey, document.path, document.label]);
let database: Promise<IDBDatabase> | undefined;
function open() {
  const result = database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(browserDatabaseName("yellow-editor-interaction-drafts"), 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); database = undefined; }; resolve(request.result); };
    request.onerror = () => { database = undefined; reject(request.error ?? new Error("Draft storage is unavailable.")); };
    request.onblocked = () => { database = undefined; reject(new Error("Draft storage is blocked by another open window.")); };
  });
  void result.catch(() => { if (database === result) database = undefined; });
  return result;
}
const pending = new Map<string, Promise<unknown>>();
function queued<T>(id: string, task: () => Promise<T>): Promise<T> {
  const result = (pending.get(id) ?? Promise.resolve()).catch(() => undefined).then(task);
  pending.set(id, result);
  const cleanup = () => { if (pending.get(id) === result) pending.delete(id); };
  void result.then(cleanup, cleanup);
  return result;
}
async function transact<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction("drafts", mode), request = run(transaction.objectStore("drafts"));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = transaction.onabort = () => reject(transaction.error ?? request.error ?? new Error("Could not keep the interaction draft."));
  });
}
export async function readInteractionDraft(document: InteractionDocument): Promise<InteractionDraft | null> {
  return queued(key(document), async () => {
    const draft = await transact("readonly", store => store.get(key(document))) as InteractionDraft | undefined;
    if (!draft) return null;
    if (draft.version !== 1 || key(draft) !== key(document) || !draft.data?.values || !Array.isArray(draft.sources)) throw new Error("This interaction draft has an unsupported format. The saved project is unchanged.");
    return draft;
  });
}
export function writeInteractionDraft(document: InteractionDocument, data: InteractionDraftData): Promise<InteractionDraft> {
  const draft: InteractionDraft = { version: 1, projectKey: document.projectKey, path: document.path, label: document.label,
    updatedAt: new Date().toISOString(), sources: structuredClone(document.sources), data: structuredClone(data) };
  return queued(key(document), async () => { await transact("readwrite", store => store.put(draft, key(document))); return draft; });
}
export function deleteInteractionDraft(document: InteractionDocument) {
  return queued(key(document), () => transact("readwrite", store => store.delete(key(document))));
}
