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

  const [structuralHash, eventSchemaHash] = await Promise.all([
    hashText(structuralParts.join("\n\0\n")),
    hashText(`${EVENT_SCHEMA_PATH}\n${eventContents}`),
  ]);

  return {
    formatVersion: SAVE_FORMAT_VERSION,
    saveEpoch: SAVE_EPOCH,
    target,
    structuralHash,
    eventSchemaHash,
  };
}
