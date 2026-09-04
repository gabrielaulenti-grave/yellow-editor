import type {
  HistoryEntry,
  HistoryFileChange,
  HistoryPendingOperation,
  HistoryState,
  HistorySummary,
  ProjectSource,
  TextWriteRequest,
} from "./types";

const HISTORY_VERSION = 1;
const MAX_HISTORY_ENTRIES = 100;

type HistorySide = "before" | "after";

function emptyHistory(): HistoryState {
  return {
    version: HISTORY_VERSION,
    entries: [],
    cursor: 0,
    pending: null,
  };
}

function normalizePending(
  pending: HistoryState["pending"],
  entries: HistoryEntry[],
): HistoryPendingOperation | null {
  if (
    !pending ||
    typeof pending.entryId !== "string" ||
    !Number.isInteger(pending.fromCursor) ||
    !Number.isInteger(pending.toCursor) ||
    (pending.direction !== "before" && pending.direction !== "after") ||
    !entries.some((entry) => entry.id === pending.entryId)
  ) {
    return null;
  }

  return {
    entryId: pending.entryId,
    fromCursor: Math.max(0, Math.min(pending.fromCursor, entries.length)),
    toCursor: Math.max(0, Math.min(pending.toCursor, entries.length)),
    direction: pending.direction,
  };
}

function normalizeHistory(state: HistoryState | null): HistoryState {
  if (!state || state.version !== HISTORY_VERSION || !Array.isArray(state.entries)) {
    return emptyHistory();
  }

  const entries = state.entries.filter((entry) =>
    entry &&
    typeof entry.id === "string" &&
    typeof entry.timestamp === "string" &&
    typeof entry.label === "string" &&
    Array.isArray(entry.files),
  );

  const cursor = Number.isInteger(state.cursor)
    ? Math.max(0, Math.min(state.cursor, entries.length))
    : entries.length;

  return {
    version: HISTORY_VERSION,
    entries,
    cursor,
    pending: normalizePending(state.pending, entries),
  };
}

function summarize(state: HistoryState, persistent: boolean): HistorySummary {
  const latest = state.cursor > 0 ? state.entries[state.cursor - 1] : null;

  return {
    entryCount: state.entries.length,
    appliedCount: state.cursor,
    canUndo: !state.pending && state.cursor > 0,
    canRedo: !state.pending && state.cursor < state.entries.length,
    latestLabel: latest?.label ?? null,
    latestTimestamp: latest?.timestamp ?? null,
    persistent,
  };
}

function fallbackHash(contents: string): string {
  // FNV-1a is only a fallback for environments without Web Crypto. It is not
  // used for security; the hash is an external-change guard before writes.
  let hash = 0x811c9dc5;
  for (let index = 0; index < contents.length; index += 1) {
    hash ^= contents.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export async function hashText(contents: string): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const bytes = new TextEncoder().encode(contents);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
  }

  return fallbackHash(contents);
}

function newEntryId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function inspectEntrySide(
  source: ProjectSource,
  changes: HistoryFileChange[],
): Promise<HistorySide | "mixed"> {
  let allBefore = true;
  let allAfter = true;

  for (const change of changes) {
    const current = await source.readText(change.path);
    const currentHash = await hashText(current);
    allBefore &&= currentHash === change.beforeHash;
    allAfter &&= currentHash === change.afterHash;
  }

  if (allBefore) {
    return "before";
  }
  if (allAfter) {
    return "after";
  }
  return "mixed";
}

async function verifyCurrentContents(
  source: ProjectSource,
  changes: HistoryFileChange[],
  expectedSide: HistorySide,
): Promise<void> {
  for (const change of changes) {
    const current = await source.readText(change.path);
    const currentHash = await hashText(current);
    const expectedHash = expectedSide === "before" ? change.beforeHash : change.afterHash;

    if (currentHash !== expectedHash) {
      throw new Error(
        `${change.path} changed outside Yellow Editor. Reload the project before continuing so no external edits are overwritten.`,
      );
    }
  }
}

async function writeChanges(
  source: ProjectSource,
  changes: HistoryFileChange[],
  direction: HistorySide,
): Promise<void> {
  const written: HistoryFileChange[] = [];

  try {
    for (const change of changes) {
      const contents = direction === "before" ? change.before : change.after;
      await source.writeText(change.path, contents);
      written.push(change);
    }
  } catch (error) {
    // Best-effort rollback keeps a multi-file edit together if one write fails.
    for (const change of written.reverse()) {
      try {
        const rollbackContents = direction === "before" ? change.after : change.before;
        await source.writeText(change.path, rollbackContents);
      } catch {
        // The journal was persisted before writing, so both versions remain
        // available even if an interrupted multi-file write needs recovery.
      }
    }
    throw error;
  }
}

async function recoverPendingOperation(
  source: ProjectSource,
  state: HistoryState,
): Promise<HistoryState> {
  const pending = state.pending;
  if (!pending) {
    return state;
  }

  const entry = state.entries.find((candidate) => candidate.id === pending.entryId);
  if (!entry) {
    throw new Error("Yellow Editor history contains an invalid pending operation.");
  }

  const currentSide = await inspectEntrySide(source, entry.files);
  const originalSide: HistorySide = pending.direction === "after" ? "before" : "after";

  if (currentSide === "mixed") {
    throw new Error(
      `Yellow Editor found an interrupted save (${entry.label}) where only some files were written. The before/after snapshots are preserved in history, but automatic recovery was stopped to avoid overwriting possible external edits.`,
    );
  }

  const recovered: HistoryState = {
    ...state,
    cursor: currentSide === pending.direction ? pending.toCursor : pending.fromCursor,
    pending: null,
  };

  if (currentSide !== pending.direction && currentSide !== originalSide) {
    throw new Error(`Could not determine the state of interrupted history entry '${entry.label}'.`);
  }

  await source.historyStore.save(recovered);
  return recovered;
}

export interface ProjectHistoryManager {
  getState(): Promise<HistoryState>;
  getSummary(): Promise<HistorySummary>;
  save(label: string, requests: TextWriteRequest[]): Promise<HistorySummary>;
  undo(): Promise<HistorySummary>;
  redo(): Promise<HistorySummary>;
}

export function createProjectHistoryManager(source: ProjectSource): ProjectHistoryManager {
  let cachedState: HistoryState | null = null;

  async function getState(): Promise<HistoryState> {
    if (!cachedState) {
      const loaded = normalizeHistory(await source.historyStore.load());
      cachedState = await recoverPendingOperation(source, loaded);
    }
    return cachedState;
  }

  async function persist(nextState: HistoryState): Promise<void> {
    await source.historyStore.save(nextState);
    cachedState = nextState;
  }

  async function prepareOperation(
    state: HistoryState,
    entry: HistoryEntry,
    fromCursor: number,
    toCursor: number,
    direction: HistorySide,
    entries = state.entries,
  ): Promise<HistoryState> {
    const prepared: HistoryState = {
      version: HISTORY_VERSION,
      entries,
      cursor: fromCursor,
      pending: {
        entryId: entry.id,
        fromCursor,
        toCursor,
        direction,
      },
    };
    await persist(prepared);
    return prepared;
  }

  async function clearFailedOperation(
    originalState: HistoryState,
    preparedState: HistoryState,
    entry: HistoryEntry,
  ): Promise<void> {
    const side = await inspectEntrySide(source, entry.files);
    const pending = preparedState.pending;
    if (!pending) {
      return;
    }

    const originalSide: HistorySide = pending.direction === "after" ? "before" : "after";
    if (side === originalSide) {
      await persist({ ...originalState, pending: null });
      return;
    }

    // Keep the durable pending journal when the filesystem is mixed or already
    // reached the target side. Reopening the project will reconcile it safely.
    cachedState = null;
  }

  async function finalizeOperation(
    preparedState: HistoryState,
    toCursor: number,
  ): Promise<HistoryState> {
    const finalState: HistoryState = {
      ...preparedState,
      cursor: toCursor,
      pending: null,
    };

    try {
      await persist(finalState);
    } catch (error) {
      cachedState = null;
      throw new Error(
        `Files were written, but Yellow Editor could not finalize the history journal. Reopen the project to reconcile the saved snapshot. ${String(error)}`,
      );
    }

    return finalState;
  }

  async function save(label: string, requests: TextWriteRequest[]): Promise<HistorySummary> {
    const cleanLabel = label.trim();
    if (!cleanLabel) {
      throw new Error("A history label is required for saved changes.");
    }

    const seenPaths = new Set<string>();
    const changes: HistoryFileChange[] = [];

    for (const request of requests) {
      if (!request.path || seenPaths.has(request.path)) {
        throw new Error(`Each saved file must have a unique project-relative path: ${request.path}`);
      }
      seenPaths.add(request.path);

      const before = await source.readText(request.path);
      const beforeHash = await hashText(before);

      if (request.expectedHash && request.expectedHash !== beforeHash) {
        throw new Error(
          `${request.path} changed outside Yellow Editor. Reload it before saving so the external changes are preserved.`,
        );
      }

      if (before === request.contents) {
        continue;
      }

      changes.push({
        path: request.path,
        before,
        after: request.contents,
        beforeHash,
        afterHash: await hashText(request.contents),
      });
    }

    const state = await getState();
    if (changes.length === 0) {
      return summarize(state, source.historyStore.persistent);
    }

    const entry: HistoryEntry = {
      id: newEntryId(),
      timestamp: new Date().toISOString(),
      label: cleanLabel,
      files: changes,
    };

    const appliedEntries = state.entries.slice(0, state.cursor);
    appliedEntries.push(entry);
    const entries = appliedEntries.slice(-MAX_HISTORY_ENTRIES);
    const fromCursor = Math.max(0, entries.length - 1);
    const toCursor = entries.length;
    const prepared = await prepareOperation(
      state,
      entry,
      fromCursor,
      toCursor,
      "after",
      entries,
    );

    try {
      await writeChanges(source, changes, "after");
    } catch (error) {
      await clearFailedOperation(state, prepared, entry);
      throw error;
    }

    const finalState = await finalizeOperation(prepared, toCursor);
    return summarize(finalState, source.historyStore.persistent);
  }

  async function undo(): Promise<HistorySummary> {
    const state = await getState();
    if (state.cursor === 0) {
      return summarize(state, source.historyStore.persistent);
    }

    const entry = state.entries[state.cursor - 1];
    await verifyCurrentContents(source, entry.files, "after");
    const prepared = await prepareOperation(
      state,
      entry,
      state.cursor,
      state.cursor - 1,
      "before",
    );

    try {
      await writeChanges(source, entry.files, "before");
    } catch (error) {
      await clearFailedOperation(state, prepared, entry);
      throw error;
    }

    const finalState = await finalizeOperation(prepared, state.cursor - 1);
    return summarize(finalState, source.historyStore.persistent);
  }

  async function redo(): Promise<HistorySummary> {
    const state = await getState();
    if (state.cursor >= state.entries.length) {
      return summarize(state, source.historyStore.persistent);
    }

    const entry = state.entries[state.cursor];
    await verifyCurrentContents(source, entry.files, "before");
    const prepared = await prepareOperation(
      state,
      entry,
      state.cursor,
      state.cursor + 1,
      "after",
    );

    try {
      await writeChanges(source, entry.files, "after");
    } catch (error) {
      await clearFailedOperation(state, prepared, entry);
      throw error;
    }

    const finalState = await finalizeOperation(prepared, state.cursor + 1);
    return summarize(finalState, source.historyStore.persistent);
  }

  return {
    getState,
    getSummary: async () => summarize(await getState(), source.historyStore.persistent),
    save,
    undo,
    redo,
  };
}
