import type { ProjectSource } from "./types";

function mobileLikeDevice(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

function recommendedConcurrency(): number {
  if (typeof navigator === "undefined") {
    return 12;
  }
  const cores = Math.max(1, navigator.hardwareConcurrency || 4);
  if (mobileLikeDevice()) {
    // Four workers proved too conservative on current phones: the filesystem
    // was spending most of its time waiting between many tiny source reads.
    // Keep a ceiling so lower-memory devices are not flooded, but let modern
    // 8-core phones overlap enough I/O to make the first scan useful.
    return Math.max(4, Math.min(8, Math.ceil(cores * 0.75)));
  }
  return Math.max(4, Math.min(12, cores));
}

export interface TrainerScanSource extends ProjectSource {
  invalidate(paths?: string[]): void;
}

export function createTrainerScanSource(source: ProjectSource): TrainerScanSource {
  const textCache = new Map<string, Promise<string>>();
  const existsCache = new Map<string, Promise<boolean>>();
  const waiting: Array<() => void> = [];
  const concurrency = recommendedConcurrency();
  let activeReads = 0;

  async function withReadSlot<T>(operation: () => Promise<T>): Promise<T> {
    if (activeReads >= concurrency) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    activeReads += 1;
    try {
      return await operation();
    } finally {
      activeReads -= 1;
      waiting.shift()?.();
    }
  }

  function cachedText(path: string): Promise<string> {
    const cached = textCache.get(path);
    if (cached) {
      return cached;
    }
    const pending = withReadSlot(() => source.readText(path)).catch((error) => {
      textCache.delete(path);
      throw error;
    });
    textCache.set(path, pending);
    return pending;
  }

  function cachedExists(path: string): Promise<boolean> {
    const cached = existsCache.get(path);
    if (cached) {
      return cached;
    }
    const pending = source.exists(path).catch((error) => {
      existsCache.delete(path);
      throw error;
    });
    existsCache.set(path, pending);
    return pending;
  }

  function invalidate(paths?: string[]): void {
    if (!paths) {
      textCache.clear();
      existsCache.clear();
      return;
    }
    for (const path of paths) {
      textCache.delete(path);
      existsCache.delete(path);
    }
  }

  return {
    displayPath: source.displayPath,
    storageKey: source.storageKey,
    historyStore: source.historyStore,
    readText: cachedText,
    readBytes: (path) => source.readBytes(path),
    writeText: async (path, contents) => {
      await source.writeText(path, contents);
      invalidate([path]);
    },
    exists: cachedExists,
    assetUrl: (path) => source.assetUrl(path),
    invalidate,
  };
}
