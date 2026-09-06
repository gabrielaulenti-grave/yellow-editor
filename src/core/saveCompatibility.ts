import type {
  BuildTarget,
  ProjectSource,
  SaveCompatibilityDescriptor,
} from "./types";

const SAVE_FORMAT_VERSION = 1;
const SAVE_EPOCH = 1;

const STRUCTURAL_INPUTS = [
  "ram/sram.asm",
  "ram/wram.asm",
  "constants/pokemon_data_constants.asm",
  "constants/text_constants.asm",
] as const;

const EVENT_SCHEMA_PATH = "constants/event_constants.asm";

function normalizeText(contents: string): string {
  return contents.replace(/\r\n/g, "\n");
}

function parseAsmInteger(token: string): number | null {
  const value = token.trim();
  if (/^\$[0-9a-f]+$/i.test(value)) {
    return Number.parseInt(value.slice(1), 16);
  }
  if (/^\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }
  return null;
}

function parseEventSchema(contents: string): {
  eventBits: number;
  signature: string;
} {
  let value = 0;
  const mapping: string[] = [];

  for (const rawLine of contents.split("\n")) {
    const line = rawLine.split(";", 1)[0].trim();
    if (!line) {
      continue;
    }
    if (/^DEF\s+NUM_EVENTS\s+EQU\s+const_value\b/i.test(line)) {
      return {
        eventBits: value,
        signature: mapping.join("\n"),
      };
    }

    let match = line.match(/^const_def(?:\s+([^,\s]+))?/i);
    if (match) {
      value = match[1] ? (parseAsmInteger(match[1]) ?? 0) : 0;
      continue;
    }

    match = line.match(/^const_next\s+([^,\s]+)/i);
    if (match) {
      const next = parseAsmInteger(match[1]);
      if (next === null) {
        throw new Error(`Could not parse event const_next value '${match[1]}'.`);
      }
      value = next;
      continue;
    }

    match = line.match(/^const_skip(?:\s+([^,\s]+))?/i);
    if (match) {
      const count = match[1] ? parseAsmInteger(match[1]) : 1;
      if (count === null) {
        throw new Error(`Could not parse event const_skip value '${match[1]}'.`);
      }
      value += count;
      continue;
    }

    match = line.match(/^const\s+(EVENT_[A-Z0-9_]+)\b/i);
    if (match) {
      mapping.push(`${match[1].toUpperCase()}=${value}`);
      value += 1;
    }
  }

  throw new Error("Could not determine NUM_EVENTS from constants/event_constants.asm.");
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a-${hash.toString(16).padStart(8, "0")}`;
}

async function hashText(input: string): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(input),
    );
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }
  return fnv1a(input);
}

export async function getSaveCompatibilityDescriptor(
  source: ProjectSource,
  target: BuildTarget,
): Promise<SaveCompatibilityDescriptor> {
  const structuralParts = await Promise.all(
    STRUCTURAL_INPUTS.map(async (path) => {
      const contents = normalizeText(await source.readText(path));
      return `${path}\n${contents}`;
    }),
  );
  const eventContents = normalizeText(await source.readText(EVENT_SCHEMA_PATH));
  const eventSchema = parseEventSchema(eventContents);
  structuralParts.push(`event-storage-bits\n${eventSchema.eventBits}`);

  const [structuralHash, eventSchemaHash] = await Promise.all([
    hashText(structuralParts.join("\n\0\n")),
    hashText(eventSchema.signature),
  ]);

  return {
    formatVersion: SAVE_FORMAT_VERSION,
    saveEpoch: SAVE_EPOCH,
    target,
    structuralHash,
    eventSchemaHash,
  };
}
