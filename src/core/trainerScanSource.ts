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
    return Math.max(2, Math.min(4, Math.ceil(cores / 2)));
  }
  return Math.max(4, Math.min(12, cores));
}

export function createTrainerScanSource(source: ProjectSource): ProjectSource {
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

  return {
    displayPath: source.displayPath,
    storageKey: source.storageKey,
    historyStore: source.historyStore,
    readText: cachedText,
    readBytes: (path) => source.readBytes(path),
    writeText: (path, contents) => source.writeText(path, contents),
    exists: cachedExists,
    assetUrl: (path) => source.assetUrl(path),
  };
}
