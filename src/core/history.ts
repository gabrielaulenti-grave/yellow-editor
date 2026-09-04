import type {
  HistoryEntry,
  HistoryFileChange,
  HistoryState,
  HistorySummary,
  ProjectSource,
  TextWriteRequest,
} from "./types";

const HISTORY_VERSION = 1;
const MAX_HISTORY_ENTRIES = 100;

function emptyHistory(): HistoryState {
  return {
    version: HISTORY_VERSION,
    entries: [],
    cursor: 0,
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
  };
}

function summarize(state: HistoryState, persistent: boolean): HistorySummary {
  const latest = state.cursor > 0 ? state.entries[state.cursor - 1] : null;

  return {
    entryCount: state.entries.length,
    appliedCount: state.cursor,
    canUndo: state.cursor > 0,
    canRedo: state.cursor < state.entries.length,
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

async function verifyCurrentContents(
  source: ProjectSource,
  changes: HistoryFileChange[],
  expectedSide: "before" | "after",
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
  direction: "before" | "after",
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
        // Preserve the original write error. The persisted history still has
        // both versions so a future recovery UI can help if rollback failed.
      }
    }
    throw error;
  }
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
      cachedState = normalizeHistory(await source.historyStore.load());
    }
    return cachedState;
  }

  async function persist(nextState: HistoryState): Promise<void> {
    await source.historyStore.save(nextState);
    cachedState = nextState;
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

    await writeChanges(source, changes, "after");

    const appliedEntries = state.entries.slice(0, state.cursor);
    appliedEntries.push(entry);
    const entries = appliedEntries.slice(-MAX_HISTORY_ENTRIES);
    const nextState: HistoryState = {
      version: HISTORY_VERSION,
      entries,
      cursor: entries.length,
    };

    try {
      await persist(nextState);
    } catch (error) {
      // A save is only considered successful if its undo record is durable.
      await writeChanges(source, changes, "before");
      throw new Error(`Could not store Yellow Editor history; changes were rolled back. ${String(error)}`);
    }

    return summarize(nextState, source.historyStore.persistent);
  }

  async function undo(): Promise<HistorySummary> {
    const state = await getState();
    if (state.cursor === 0) {
      return summarize(state, source.historyStore.persistent);
    }

    const entry = state.entries[state.cursor - 1];
    await verifyCurrentContents(source, entry.files, "after");
    await writeChanges(source, entry.files, "before");

    const nextState: HistoryState = {
      ...state,
      cursor: state.cursor - 1,
    };

    try {
      await persist(nextState);
    } catch (error) {
      await writeChanges(source, entry.files, "after");
      throw new Error(`Could not update Yellow Editor history; undo was rolled back. ${String(error)}`);
    }

    return summarize(nextState, source.historyStore.persistent);
  }

  async function redo(): Promise<HistorySummary> {
    const state = await getState();
    if (state.cursor >= state.entries.length) {
      return summarize(state, source.historyStore.persistent);
    }

    const entry = state.entries[state.cursor];
    await verifyCurrentContents(source, entry.files, "before");
    await writeChanges(source, entry.files, "after");

    const nextState: HistoryState = {
      ...state,
      cursor: state.cursor + 1,
    };

    try {
      await persist(nextState);
    } catch (error) {
      await writeChanges(source, entry.files, "before");
      throw new Error(`Could not update Yellow Editor history; redo was rolled back. ${String(error)}`);
    }

    return summarize(nextState, source.historyStore.persistent);
  }

  return {
    getState,
    getSummary: async () => summarize(await getState(), source.historyStore.persistent),
    save,
    undo,
    redo,
  };
}
