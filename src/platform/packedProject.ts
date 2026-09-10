import type {
  HistoryStore,
  ProjectBuildReadPreparation,
  ProjectSource,
} from "../core/types";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;
const MAX_ENTRIES = 10000;

interface ZipEntry {
  path: string;
  rawName: string;
  flags: number;
  method: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

interface ParsedZip {
  entries: Map<string, ZipEntry>;
  orderedEntries: ZipEntry[];
  centralOffset: number;
  rootPrefix: string;
}

export interface PackedProjectSource extends ProjectSource {
  sourceKind: "zip";
  archiveName: string;
  archiveIdentity: string;
  exportZip(): Promise<Uint8Array>;
}

export interface CreatePackedProjectOptions {
  archiveName: string;
  archiveBytes: Uint8Array;
  storageKey: string;
  historyStore: HistoryStore;
  persistArchive?: (bytes: Uint8Array) => Promise<void>;
  assetUrlFactory?: (path: string, bytes: Uint8Array) => Promise<string>;
}

function readU16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function readU32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function writeU16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value & 0xffff, true);
}

function writeU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

function normalizeArchivePath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) {
    throw new Error(`ZIP contains an unsafe path: ${value}`);
  }
  return parts.join("/");
}

function findEocd(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minimum = Math.max(0, bytes.length - 0xffff - 22);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (readU32(view, offset) === EOCD_SIGNATURE) {
      return offset;
    }
  }
  throw new Error("The selected file is not a supported ZIP archive (end record not found)." );
}

function detectRootPrefix(rawNames: string[]): string {
  const files = rawNames.filter((name) => name && !name.endsWith("/"));
  if (files.includes("main.asm") && files.includes("Makefile")) {
    return "";
  }
  const firstParts = files.map((name) => normalizeArchivePath(name).split("/")[0]).filter(Boolean);
  const candidate = firstParts[0];
  if (!candidate || firstParts.some((part) => part !== candidate)) {
    return "";
  }
  const prefix = `${candidate}/`;
  if (files.includes(`${prefix}main.asm`) && files.includes(`${prefix}Makefile`)) {
    return prefix;
  }
  return "";
}

function parseZip(bytes: Uint8Array): ParsedZip {
  if (bytes.length === 0 || bytes.length > MAX_ARCHIVE_BYTES) {
    throw new Error(`ZIP archives must be between 1 byte and ${MAX_ARCHIVE_BYTES / 1024 / 1024} MB.`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(bytes);
  const disk = readU16(view, eocd + 4);
  const centralDisk = readU16(view, eocd + 6);
  const entriesOnDisk = readU16(view, eocd + 8);
  const entryCount = readU16(view, eocd + 10);
  const centralSize = readU32(view, eocd + 12);
  const centralOffset = readU32(view, eocd + 16);

  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new Error("Multi-disk ZIP archives are not supported.");
  }
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error("ZIP64 archives are not supported for packed projects.");
  }
  if (entryCount > MAX_ENTRIES || centralOffset + centralSize > bytes.length) {
    throw new Error("The ZIP directory is outside Yellow Editor's supported limits.");
  }

  const decoder = new TextDecoder("utf-8", { fatal: false });
  const centralEntries: Array<Omit<ZipEntry, "path">> = [];
  let offset = centralOffset;
  let totalUncompressed = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.length || readU32(view, offset) !== CENTRAL_SIGNATURE) {
      throw new Error(`ZIP central directory is invalid at entry ${index + 1}.`);
    }
    const flags = readU16(view, offset + 8);
    const method = readU16(view, offset + 10);
    const crc32 = readU32(view, offset + 16);
    const compressedSize = readU32(view, offset + 20);
    const uncompressedSize = readU32(view, offset + 24);
    const nameLength = readU16(view, offset + 28);
    const extraLength = readU16(view, offset + 30);
    const commentLength = readU16(view, offset + 32);
    const localOffset = readU32(view, offset + 42);
    const recordLength = 46 + nameLength + extraLength + commentLength;
    if (offset + recordLength > bytes.length) {
      throw new Error("ZIP central directory entry extends beyond the archive.");
    }
    if ((flags & 0x0001) !== 0) {
      throw new Error("Encrypted ZIP entries are not supported.");
    }
    if (method !== 0 && method !== 8) {
      throw new Error(`ZIP compression method ${method} is not supported. Use Store or Deflate.`);
    }
    if (uncompressedSize > MAX_ENTRY_BYTES) {
      throw new Error("A ZIP entry is too large for a Yellow Editor packed project.");
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new Error("The unpacked ZIP is too large for a Yellow Editor packed project.");
    }
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength);
    const rawName = decoder.decode(nameBytes).replace(/\\/g, "/");
    centralEntries.push({
      rawName,
      flags,
      method,
      crc32,
      compressedSize,
      uncompressedSize,
      localOffset,
    });
    offset += recordLength;
  }

  const rootPrefix = detectRootPrefix(centralEntries.map((entry) => entry.rawName));
  const entries = new Map<string, ZipEntry>();
  const orderedEntries: ZipEntry[] = [];

  for (const entry of centralEntries) {
    if (entry.rawName.endsWith("/")) {
      continue;
    }
    let logical = entry.rawName;
    if (rootPrefix && logical.startsWith(rootPrefix)) {
      logical = logical.slice(rootPrefix.length);
    }
    const path = normalizeArchivePath(logical);
    if (!path || path === ".DS_Store" || path.startsWith("__MACOSX/") || path.startsWith(".git/")) {
      continue;
    }
    if (entries.has(path)) {
      throw new Error(`ZIP contains duplicate project path: ${path}`);
    }
    const normalizedEntry: ZipEntry = { ...entry, path };
    entries.set(path, normalizedEntry);
    orderedEntries.push(normalizedEntry);
  }

  return { entries, orderedEntries, centralOffset, rootPrefix };
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser/WebView cannot decompress Deflate ZIP entries.");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(
    new DecompressionStream("deflate-raw" as CompressionFormat),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function localDataRange(archive: Uint8Array, entry: ZipEntry): Uint8Array {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const offset = entry.localOffset;
  if (offset + 30 > archive.length || readU32(view, offset) !== LOCAL_SIGNATURE) {
    throw new Error(`ZIP local record for ${entry.path} is invalid.`);
  }
  const nameLength = readU16(view, offset + 26);
  const extraLength = readU16(view, offset + 28);
  const dataOffset = offset + 30 + nameLength + extraLength;
  const dataEnd = dataOffset + entry.compressedSize;
  if (dataEnd > archive.length) {
    throw new Error(`ZIP data for ${entry.path} extends beyond the archive.`);
  }
  return archive.subarray(dataOffset, dataEnd);
}

async function decodeEntry(archive: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const compressed = localDataRange(archive, entry);
  const result = entry.method === 0 ? compressed.slice() : await inflateRaw(compressed);
  if (result.length !== entry.uncompressedSize) {
    throw new Error(`ZIP entry ${entry.path} decoded to ${result.length} bytes; expected ${entry.uncompressedSize}.`);
  }
  return result;
}

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let value = i;
      for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) !== 0 ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
      }
      crcTable[i] = value >>> 0;
    }
  }
  let value = 0xffffffff;
  for (const byte of bytes) {
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function dosTimeDate(date = new Date()): { time: number; day: number } {
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  return {
    time: ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((Math.floor(date.getSeconds() / 2)) & 0x1f),
    day: (((year - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f),
  };
}

function storedLocalRecord(rawName: string, bytes: Uint8Array): { record: Uint8Array; crc: number } {
  const name = new TextEncoder().encode(rawName);
  const header = new Uint8Array(30 + name.length);
  const view = new DataView(header.buffer);
  const stamp = dosTimeDate();
  const crc = crc32(bytes);
  writeU32(view, 0, LOCAL_SIGNATURE);
  writeU16(view, 4, 20);
  writeU16(view, 6, 0x0800);
  writeU16(view, 8, 0);
  writeU16(view, 10, stamp.time);
  writeU16(view, 12, stamp.day);
  writeU32(view, 14, crc);
  writeU32(view, 18, bytes.length);
  writeU32(view, 22, bytes.length);
  writeU16(view, 26, name.length);
  writeU16(view, 28, 0);
  header.set(name, 30);
  return { record: concat([header, bytes]), crc };
}

function centralRecord(
  entry: ZipEntry,
  localOffset: number,
  override?: { bytes: Uint8Array; crc: number },
): Uint8Array {
  const name = new TextEncoder().encode(entry.rawName);
  const result = new Uint8Array(46 + name.length);
  const view = new DataView(result.buffer);
  const stamp = dosTimeDate();
  const method = override ? 0 : entry.method;
  const crc = override ? override.crc : entry.crc32;
  const compressedSize = override ? override.bytes.length : entry.compressedSize;
  const uncompressedSize = override ? override.bytes.length : entry.uncompressedSize;
  writeU32(view, 0, CENTRAL_SIGNATURE);
  writeU16(view, 4, 20);
  writeU16(view, 6, 20);
  writeU16(view, 8, override ? 0x0800 : entry.flags);
  writeU16(view, 10, method);
  writeU16(view, 12, stamp.time);
  writeU16(view, 14, stamp.day);
  writeU32(view, 16, crc);
  writeU32(view, 20, compressedSize);
  writeU32(view, 24, uncompressedSize);
  writeU16(view, 28, name.length);
  writeU16(view, 30, 0);
  writeU16(view, 32, 0);
  writeU16(view, 34, 0);
  writeU16(view, 36, 0);
  writeU32(view, 38, 0);
  writeU32(view, 42, localOffset);
  result.set(name, 46);
  return result;
}

function eocdRecord(entryCount: number, centralSize: number, centralOffset: number): Uint8Array {
  const result = new Uint8Array(22);
  const view = new DataView(result.buffer);
  writeU32(view, 0, EOCD_SIGNATURE);
  writeU16(view, 4, 0);
  writeU16(view, 6, 0);
  writeU16(view, 8, entryCount);
  writeU16(view, 10, entryCount);
  writeU32(view, 12, centralSize);
  writeU32(view, 16, centralOffset);
  writeU16(view, 20, 0);
  return result;
}

function archiveIdentity(parsed: ParsedZip): string {
  const main = parsed.entries.get("main.asm");
  const makefile = parsed.entries.get("Makefile");
  return [
    parsed.orderedEntries.length,
    parsed.rootPrefix,
    main?.crc32.toString(16) ?? "no-main",
    makefile?.crc32.toString(16) ?? "no-make",
  ].join(":");
}

export function inspectPackedProjectIdentity(archiveBytes: Uint8Array): string {
  return archiveIdentity(parseZip(archiveBytes));
}

function defaultMemoryHistoryStore(): HistoryStore {
  let state = null;
  return {
    persistent: false,
    async load() {
      return state;
    },
    async save(next) {
      state = next;
    },
  };
}

export async function createPackedProjectSource(
  options: Omit<CreatePackedProjectOptions, "historyStore"> & { historyStore?: HistoryStore },
): Promise<PackedProjectSource> {
  const originalArchive = options.archiveBytes.slice();
  const parsed = parseZip(originalArchive);
  const overrides = new Map<string, Uint8Array>();
  const decoded = new Map<string, Uint8Array>();
  const pendingReads = new Map<string, Promise<Uint8Array>>();
  const objectUrls = new Map<string, string>();
  let disposed = false;

  async function readBytesInternal(relativePath: string): Promise<Uint8Array> {
    const path = normalizeArchivePath(relativePath);
    const override = overrides.get(path);
    if (override) {
      return override;
    }
    const cached = decoded.get(path);
    if (cached) {
      return cached;
    }
    const entry = parsed.entries.get(path);
    if (!entry) {
      throw new Error(`Packed project does not contain ${relativePath}.`);
    }
    const existing = pendingReads.get(path);
    if (existing) {
      return existing;
    }
    const pending = decodeEntry(originalArchive, entry)
      .then((bytes) => {
        if (!disposed) {
          decoded.set(path, bytes);
        }
        return bytes;
      })
      .finally(() => pendingReads.delete(path));
    pendingReads.set(path, pending);
    return pending;
  }

  async function buildCurrentArchive(): Promise<Uint8Array> {
    const parts: Uint8Array[] = [originalArchive.slice(0, parsed.centralOffset)];
    const overrideLocations = new Map<string, { offset: number; bytes: Uint8Array; crc: number }>();
    let offset = parsed.centralOffset;

    for (const entry of parsed.orderedEntries) {
      const bytes = overrides.get(entry.path);
      if (!bytes) {
        continue;
      }
      const stored = storedLocalRecord(entry.rawName, bytes);
      overrideLocations.set(entry.path, { offset, bytes, crc: stored.crc });
      parts.push(stored.record);
      offset += stored.record.length;
    }

    const centralOffset = offset;
    const centralParts: Uint8Array[] = [];
    for (const entry of parsed.orderedEntries) {
      const override = overrideLocations.get(entry.path);
      centralParts.push(centralRecord(
        entry,
        override?.offset ?? entry.localOffset,
        override ? { bytes: override.bytes, crc: override.crc } : undefined,
      ));
    }
    const central = concat(centralParts);
    parts.push(central);
    parts.push(eocdRecord(parsed.orderedEntries.length, central.length, centralOffset));
    return concat(parts);
  }

  const source: PackedProjectSource = {
    displayPath: `${options.archiveName} (packed)`,
    storageKey: options.storageKey,
    historyStore: options.historyStore ?? defaultMemoryHistoryStore(),
    sourceKind: "zip",
    archiveName: options.archiveName,
    archiveIdentity: archiveIdentity(parsed),

    async readText(relativePath) {
      return new TextDecoder().decode(await readBytesInternal(relativePath));
    },

    async readBytes(relativePath) {
      return (await readBytesInternal(relativePath)).slice();
    },

    async writeText(relativePath, contents) {
      const path = normalizeArchivePath(relativePath);
      if (!parsed.entries.has(path)) {
        throw new Error(`Yellow Editor only writes existing packed project files: ${relativePath}`);
      }
      const previous = overrides.get(path)?.slice();
      const next = new TextEncoder().encode(contents);
      overrides.set(path, next);
      decoded.set(path, next);

      const oldUrl = objectUrls.get(path);
      if (oldUrl) {
        URL.revokeObjectURL(oldUrl);
        objectUrls.delete(path);
      }

      if (options.persistArchive) {
        try {
          await options.persistArchive(await buildCurrentArchive());
        } catch (error) {
          if (previous) {
            overrides.set(path, previous);
            decoded.set(path, previous);
          } else {
            overrides.delete(path);
            decoded.delete(path);
          }
          throw new Error(`Could not save the packed project archive: ${String(error)}`);
        }
      }
    },

    async exists(relativePath) {
      const path = normalizeArchivePath(relativePath);
      if (!path) {
        return true;
      }
      if (parsed.entries.has(path)) {
        return true;
      }
      const prefix = `${path}/`;
      for (const key of parsed.entries.keys()) {
        if (key.startsWith(prefix)) {
          return true;
        }
      }
      return false;
    },

    async assetUrl(relativePath) {
      const path = normalizeArchivePath(relativePath);
      const cached = objectUrls.get(path);
      if (cached) {
        return cached;
      }
      try {
        const bytes = await readBytesInternal(path);
        const url = options.assetUrlFactory
          ? await options.assetUrlFactory(path, bytes)
          : URL.createObjectURL(new Blob([bytes]));
        objectUrls.set(path, url);
        return url;
      } catch {
        return null;
      }
    },

    async prepareBuildReads(): Promise<ProjectBuildReadPreparation> {
      return {
        indexed: true,
        fileCount: parsed.entries.size,
        directoryCount: 0,
        durationMs: 0,
        message: `Packed project ZIP already indexes ${parsed.entries.size} files in memory.`,
      };
    },

    exportZip: buildCurrentArchive,

    dispose() {
      disposed = true;
      for (const url of objectUrls.values()) {
        if (url.startsWith("blob:")) {
          URL.revokeObjectURL(url);
        }
      }
      objectUrls.clear();
      decoded.clear();
      overrides.clear();
      pendingReads.clear();
    },
  };

  return source;
}
