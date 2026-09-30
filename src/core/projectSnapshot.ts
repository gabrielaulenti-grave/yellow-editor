import type {
  HistoryState,
  ProjectSnapshot,
  ProjectSource,
} from "./types";

const ZIP_LOCAL_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const MAX_ZIP_ENTRIES = 0xffff;
const MAX_ZIP_BYTES = 128 * 1024 * 1024;

let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) !== 0
          ? (0xedb88320 ^ (value >>> 1))
          : (value >>> 1);
      }
      crcTable[index] = value >>> 0;
    }
  }

  let value = 0xffffffff;
  for (const byte of bytes) {
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function writeU16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value & 0xffff, true);
}

function writeU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((total, part) => total + part.length, 0);
  if (size > MAX_ZIP_BYTES) {
    throw new Error(
      `Project copy would be ${Math.ceil(size / 1024 / 1024)} MB, above Yellow Editor's ${MAX_ZIP_BYTES / 1024 / 1024} MB snapshot limit.`,
    );
  }

  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function dosTimestamp(date = new Date()): { time: number; day: number } {
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  return {
    time:
      ((date.getHours() & 0x1f) << 11)
      | ((date.getMinutes() & 0x3f) << 5)
      | (Math.floor(date.getSeconds() / 2) & 0x1f),
    day:
      (((year - 1980) & 0x7f) << 9)
      | (((date.getMonth() + 1) & 0x0f) << 5)
      | (date.getDate() & 0x1f),
  };
}

function normalizePath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = normalized.split("/").filter(Boolean);
  if (
    parts.length === 0
    || parts.some((part) => part === "." || part === "..")
  ) {
    throw new Error(`Invalid project path while creating a copy: ${value}`);
  }
  return parts.join("/");
}

interface SnapshotFile {
  path: string;
  bytes: Uint8Array;
}

function createStoredZip(files: SnapshotFile[]): Uint8Array {
  if (files.length === 0) {
    throw new Error("The project copy contains no files.");
  }
  if (files.length > MAX_ZIP_ENTRIES) {
    throw new Error(
      `Project copy contains ${files.length} files; ZIP snapshots support at most ${MAX_ZIP_ENTRIES}.`,
    );
  }

  const encoder = new TextEncoder();
  const stamp = dosTimestamp();
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let localOffset = 0;

  for (const file of files) {
    const name = encoder.encode(file.path);
    const crc = crc32(file.bytes);

    const localHeader = new Uint8Array(30 + name.length);
    const localView = new DataView(localHeader.buffer);
    writeU32(localView, 0, ZIP_LOCAL_SIGNATURE);
    writeU16(localView, 4, 20);
    writeU16(localView, 6, 0x0800);
    writeU16(localView, 8, 0);
    writeU16(localView, 10, stamp.time);
    writeU16(localView, 12, stamp.day);
    writeU32(localView, 14, crc);
    writeU32(localView, 18, file.bytes.length);
    writeU32(localView, 22, file.bytes.length);
    writeU16(localView, 26, name.length);
    writeU16(localView, 28, 0);
    localHeader.set(name, 30);

    const centralHeader = new Uint8Array(46 + name.length);
    const centralView = new DataView(centralHeader.buffer);
    writeU32(centralView, 0, ZIP_CENTRAL_SIGNATURE);
    writeU16(centralView, 4, 20);
    writeU16(centralView, 6, 20);
    writeU16(centralView, 8, 0x0800);
    writeU16(centralView, 10, 0);
    writeU16(centralView, 12, stamp.time);
    writeU16(centralView, 14, stamp.day);
    writeU32(centralView, 16, crc);
    writeU32(centralView, 20, file.bytes.length);
    writeU32(centralView, 24, file.bytes.length);
    writeU16(centralView, 28, name.length);
    writeU16(centralView, 30, 0);
    writeU16(centralView, 32, 0);
    writeU16(centralView, 34, 0);
    writeU16(centralView, 36, 0);
    writeU32(centralView, 38, 0);
    writeU32(centralView, 42, localOffset);
    centralHeader.set(name, 46);

    locals.push(localHeader, file.bytes);
    central.push(centralHeader);
    localOffset += localHeader.length + file.bytes.length;
  }

  const centralBytes = concat(central);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  writeU32(eocdView, 0, ZIP_EOCD_SIGNATURE);
  writeU16(eocdView, 4, 0);
  writeU16(eocdView, 6, 0);
  writeU16(eocdView, 8, files.length);
  writeU16(eocdView, 10, files.length);
  writeU32(eocdView, 12, centralBytes.length);
  writeU32(eocdView, 16, localOffset);
  writeU16(eocdView, 20, 0);

  return concat([...locals, centralBytes, eocd]);
}

function historyOverrides(
  state: HistoryState,
  targetCursor: number,
): Map<string, Uint8Array> {
  if (
    !Number.isInteger(targetCursor)
    || targetCursor < 0
    || targetCursor > state.entries.length
  ) {
    throw new Error(
      `History point ${targetCursor} is outside the available 0–${state.entries.length} range.`,
    );
  }

  const encoder = new TextEncoder();
  const overrides = new Map<string, Uint8Array>();

  if (targetCursor < state.cursor) {
    for (let index = state.cursor - 1; index >= targetCursor; index -= 1) {
      for (const file of state.entries[index].files) {
        overrides.set(normalizePath(file.path), encoder.encode(file.before));
      }
    }
  } else if (targetCursor > state.cursor) {
    for (let index = state.cursor; index < targetCursor; index += 1) {
      for (const file of state.entries[index].files) {
        overrides.set(normalizePath(file.path), encoder.encode(file.after));
      }
    }
  }

  return overrides;
}

function safeFileStem(source: ProjectSource, projectName: string): string {
  const displayName = source.displayPath
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .pop()
    ?.replace(/\.zip$/i, "")
    ?? projectName;

  const cleaned = displayName
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return cleaned || projectName || "yellow-editor-project";
}

function snapshotFileName(
  source: ProjectSource,
  projectName: string,
  state: HistoryState,
  targetCursor: number,
): string {
  const stamp = new Date()
    .toISOString()
    .slice(0, 19)
    .replace(/[:T]/g, "-");
  const position = targetCursor === state.cursor
    ? "copy"
    : `history-${String(targetCursor).padStart(3, "0")}`;
  return `${safeFileStem(source, projectName)}-${position}-${stamp}.zip`;
}

export async function createProjectSnapshot(
  source: ProjectSource,
  projectName: string,
  state: HistoryState,
  targetCursor = state.cursor,
): Promise<ProjectSnapshot> {
  if (!source.listFiles) {
    throw new Error(
      "This project source cannot enumerate its files, so Yellow Editor cannot create a complete independent copy.",
    );
  }

  const paths = [...new Set((await source.listFiles()).map(normalizePath))]
    .filter((path) => path !== ".git" && !path.startsWith(".git/"))
    .sort((left, right) => left.localeCompare(right));

  const overrides = historyOverrides(state, targetCursor);
  const files: SnapshotFile[] = [];

  for (const path of paths) {
    files.push({
      path,
      bytes: overrides.get(path) ?? await source.readBytes(path),
    });
  }

  return {
    fileName: snapshotFileName(source, projectName, state, targetCursor),
    bytes: createStoredZip(files),
    historyCursor: targetCursor,
    historyEntryCount: state.entries.length,
  };
}
