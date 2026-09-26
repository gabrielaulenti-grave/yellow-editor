import {
  parseMonsterPalettes,
  parsePaletteOptionsForConstant,
} from "./palettes";
import type {
  ProjectSource,
  TrainerPresentation,
} from "./types";

const TRAINER_CONSTANTS_PATH = "constants/trainer_constants.asm";
const TRAINER_PIC_TABLE_PATH = "data/trainers/pic_pointers_money.asm";
const PICS_PATH = "gfx/pics.asm";
const PALETTES_PATH = "data/pokemon/palettes.asm";
const TRAINER_ENGINE_PATH = "home/trainers2.asm";

function codeOnly(line: string): string {
  return (line.split(";", 1)[0] ?? "").trim();
}

function parseAsmNumber(value: string): number | null {
  const clean = value.trim();
  if (/^\$[0-9a-f]+$/i.test(clean)) {
    return Number.parseInt(clean.slice(1), 16);
  }
  if (/^\d+$/.test(clean)) {
    return Number.parseInt(clean, 10);
  }
  return null;
}

function parseTrainerConstants(contents: string): string[] {
  return [...contents.matchAll(/^\s*trainer_const\s+([A-Z][A-Z0-9_]*)\b/gm)]
    .map((match) => match[1])
    .filter((constant) => constant !== "NOBODY");
}

function parseTrainerPicTable(contents: string): string[] {
  const lines = contents.split(/\r?\n/);
  const start = lines.findIndex((line) =>
    /^\s*TrainerPicAndMoneyPointers::{0,1}\s*(?:;.*)?$/.test(line),
  );
  if (start < 0) return [];

  const result: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const clean = codeOnly(lines[index]);
    if (/^assert_table_length\b/i.test(clean)) break;
    const pic = clean.match(/^pic_money\s+([A-Za-z_][A-Za-z0-9_]*)\s*,/i)?.[1];
    if (pic) result.push(pic);
  }
  return result;
}

function parsePicSourcePaths(contents: string): Map<string, string> {
  const result = new Map<string, string>();
  let pendingLabels: string[] = [];

  for (const rawLine of contents.split(/\r?\n/)) {
    const clean = codeOnly(rawLine);
    if (!clean) continue;
    if (/^SECTION\b/i.test(clean)) {
      pendingLabels = [];
      continue;
    }

    const labelMatch = clean.match(/^([A-Za-z_][A-Za-z0-9_]*):{1,2}(.*)$/);
    let remainder = clean;
    if (labelMatch) {
      pendingLabels.push(labelMatch[1]);
      remainder = labelMatch[2].trim();
      if (!remainder) continue;
    }

    const incbin = remainder.match(/^INCBIN\s+"([^"]+)"$/i)?.[1];
    if (incbin) {
      for (const label of pendingLabels) result.set(label, incbin);
      pendingLabels = [];
      continue;
    }

    // Only adjacent aliases should inherit the next INCBIN.
    pendingLabels = [];
  }

  return result;
}

function pngSourceForPic(picPath: string): string | null {
  if (/\.pic$/i.test(picPath)) return picPath.replace(/\.pic$/i, ".png");
  if (/\.2bpp$/i.test(picPath)) return picPath.replace(/\.2bpp$/i, ".png");
  if (/\.png$/i.test(picPath)) return picPath;
  return null;
}

function trainerPicOverride(
  contents: string,
  classConstant: string,
  partyNumber: number,
): string | null {
  const lines = contents.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    if (codeOnly(lines[index]) !== `cp ${classConstant}`) continue;

    let sawTrainerNo = false;
    let threshold: number | null = null;
    let acceptsAtOrAbove = false;

    for (let next = index + 1; next < Math.min(lines.length, index + 18); next += 1) {
      const clean = codeOnly(lines[next]);
      if (!clean) continue;
      if (/^[A-Za-z_][A-Za-z0-9_]*:{1,2}$/.test(clean) && next > index + 1) break;

      if (/^ld\s+a\s*,\s*\[wTrainerNo\]\b/i.test(clean)) {
        sawTrainerNo = true;
        continue;
      }

      if (sawTrainerNo && threshold === null) {
        const value = clean.match(/^cp\s+([^\s;]+)/i)?.[1];
        if (value) {
          threshold = parseAsmNumber(value);
          continue;
        }
      }

      if (threshold !== null && /^ret\s+c\b/i.test(clean)) {
        acceptsAtOrAbove = true;
        continue;
      }

      if (threshold !== null && acceptsAtOrAbove) {
        const pic = clean.match(/^ld\s+de\s*,\s*([A-Za-z_][A-Za-z0-9_]*)\b/i)?.[1];
        if (pic && partyNumber >= threshold) return pic;
      }
    }
  }

  return null;
}

export async function parseTrainerPresentation(
  source: ProjectSource,
  classConstant: string,
  partyNumber: number,
): Promise<TrainerPresentation> {
  const [trainerConstantsSource, picTableSource, picsSource, paletteTableSource] =
    await Promise.all([
      source.readText(TRAINER_CONSTANTS_PATH),
      source.readText(TRAINER_PIC_TABLE_PATH),
      source.readText(PICS_PATH),
      source.readText(PALETTES_PATH),
    ]);

  const trainerConstants = parseTrainerConstants(trainerConstantsSource);
  const picTable = parseTrainerPicTable(picTableSource);
  const classIndex = trainerConstants.indexOf(classConstant);

  let picLabel = classIndex >= 0 ? picTable[classIndex] ?? null : null;

  if (await source.exists(TRAINER_ENGINE_PATH)) {
    const override = trainerPicOverride(
      await source.readText(TRAINER_ENGINE_PATH),
      classConstant,
      partyNumber,
    );
    if (override) picLabel = override;
  }

  const picSources = parsePicSourcePaths(picsSource);
  const rawPicPath = picLabel ? picSources.get(picLabel) ?? null : null;
  const spriteSourcePath = rawPicPath ? pngSourceForPic(rawPicPath) : null;
  const spritePath = spriteSourcePath && await source.exists(spriteSourcePath)
    ? await source.assetUrl(spriteSourcePath)
    : null;

  // Yellow clears wEnemyMonSpecies2 while the trainer portrait is on screen.
  // The normal battle palette resolver therefore uses entry 0 of
  // MonsterPalettes for trainer portraits. Read that entry from the project
  // rather than hard-coding PAL_MEWMON.
  const paletteConstant = parseMonsterPalettes(paletteTableSource)[0] ?? null;
  const paletteOptions = paletteConstant
    ? await parsePaletteOptionsForConstant(source, paletteConstant)
    : [];

  return {
    classConstant,
    partyNumber,
    picLabel,
    spritePath,
    spriteSourcePath,
    paletteConstant,
    paletteOptions,
  };
}
