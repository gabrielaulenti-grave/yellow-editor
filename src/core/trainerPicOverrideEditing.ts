import { hashText } from "./history";
import type {
  ProjectSource,
  TextWriteRequest,
} from "./types";

export const TRAINER_PIC_TABLE_PATH = "data/trainers/pic_pointers_money.asm";
export const TRAINER_PIC_ENGINE_PATH = "home/trainers2.asm";
export const TRAINER_PICS_PATH = "gfx/pics.asm";
export const TRAINER_CONSTANTS_PATH = "constants/trainer_constants.asm";

const ENGINE_MARKER = "; Yellow Editor trainer party portrait override hook";
const TABLE_MARKER = "; Yellow Editor trainer party portrait override table";
const OVERRIDE_LABEL = "TrainerPicOverrides";
const OVERRIDE_ROUTINE = "ApplyTrainerPicOverride";

function codeOnly(line: string): string {
  return (line.split(";", 1)[0] ?? "").trim();
}

function newlineFor(contents: string): string {
  return contents.includes("\r\n") ? "\r\n" : "\n";
}

function labelPattern(label: string): RegExp {
  return new RegExp(`^\\s*${label}::{0,1}\\s*(?:;.*)?$`, "m");
}

function parseTrainerConstants(contents: string): Set<string> {
  return new Set(
    [...contents.matchAll(/^\s*trainer_const\s+([A-Z][A-Z0-9_]*)\b/gm)]
      .map((match) => match[1])
      .filter((constant) => constant !== "NOBODY"),
  );
}

function parseTrainerPicLabels(contents: string): Set<string> {
  const result = new Set<string>();
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

    const incbin = remainder.match(/^INCBIN\s+"([^"]+)"$/i);
    if (incbin) {
      if (incbin[1].startsWith("gfx/trainers/")) {
        for (const label of pendingLabels) result.add(label);
      }
      pendingLabels = [];
      continue;
    }

    pendingLabels = [];
  }

  return result;
}

function hasEditorTable(contents: string): boolean {
  return contents.includes(TABLE_MARKER) && labelPattern(OVERRIDE_LABEL).test(contents);
}

function overrideRoutineLines(): string[] {
  return [
    OVERRIDE_ROUTINE + "::",
    "\tld a, [wTrainerClass]",
    "\tld b, a",
    "\tld a, [wTrainerNo]",
    "\tld c, a",
    "\tld hl, " + OVERRIDE_LABEL,
    ".loop",
    "\tld a, [hli]",
    "\tand a",
    "\tret z",
    "\tcp b",
    "\tjr nz, .skipPartyAndPic",
    "\tld a, [hli]",
    "\tcp c",
    "\tjr nz, .skipPic",
    "\tld a, [hli]",
    "\tld e, a",
    "\tld a, [hl]",
    "\tld d, a",
    "\tld hl, wTrainerPicPointer",
    "\tld a, e",
    "\tld [hli], a",
    "\tld [hl], d",
    "\tret",
    ".skipPartyAndPic",
    "\tinc hl",
    ".skipPic",
    "\tinc hl",
    "\tinc hl",
    "\tjr .loop",
  ];
}

function installOverrideTable(contents: string): string {
  const hasLabel = labelPattern(OVERRIDE_LABEL).test(contents);
  const hasRoutine = labelPattern(OVERRIDE_ROUTINE).test(contents);

  const hasMarker = contents.includes(TABLE_MARKER);
  if ((hasLabel || hasRoutine) && !hasMarker) {
    throw new Error(
      `${TRAINER_PIC_TABLE_PATH} already defines Yellow Editor's override labels, but the table is not owned by Yellow Editor. The existing custom code was left untouched.`,
    );
  }
  if (hasMarker && (!hasLabel || !hasRoutine)) {
    throw new Error(
      `${TRAINER_PIC_TABLE_PATH} contains an incomplete Yellow Editor portrait override table.`,
    );
  }
  if (hasLabel) {
    return contents;
  }

  const nl = newlineFor(contents);
  const suffix = contents.endsWith(nl) ? "" : nl;
  const block = [
    TABLE_MARKER,
    "; This table is read while BANK(TrainerPicAndMoneyPointers) is selected.",
    "; Each record is: db trainer class, exact party number / dw replacement portrait",
    OVERRIDE_LABEL + "::",
    "\tdb 0",
    "",
    ...overrideRoutineLines(),
    "",
  ].join(nl);

  return contents + suffix + nl + block;
}

function updateOverrideTable(
  contents: string,
  classConstant: string,
  partyNumber: number,
  picLabel: string | null,
): string {
  if (!hasEditorTable(contents)) {
    if (picLabel === null) return contents;
    contents = installOverrideTable(contents);
  }

  const lines = contents.split(/\r?\n/);
  const start = lines.findIndex((line) => labelPattern(OVERRIDE_LABEL).test(line));
  if (start < 0) {
    throw new Error(`Could not locate ${OVERRIDE_LABEL} after installing it.`);
  }

  let terminator = -1;
  let existing = -1;
  for (let index = start + 1; index < lines.length; index += 1) {
    const clean = codeOnly(lines[index]);
    if (!clean) continue;
    if (/^db\s+0\b/i.test(clean)) {
      terminator = index;
      break;
    }
    const match = clean.match(
      /^db\s+([A-Z][A-Z0-9_]*)\s*,\s*([^,]+)$/i,
    );
    if (!match) {
      throw new Error(
        `${OVERRIDE_LABEL} contains an unsupported row. Yellow Editor will not rewrite an ambiguous table.`,
      );
    }
    const pointerLine = codeOnly(lines[index + 1] ?? "");
    if (!/^dw\s+[A-Za-z_][A-Za-z0-9_]*$/i.test(pointerLine)) {
      throw new Error(
        `${OVERRIDE_LABEL} contains an incomplete portrait pointer row.`,
      );
    }
    const parsedParty = /^\$[0-9a-f]+$/i.test(match[2].trim())
      ? Number.parseInt(match[2].trim().slice(1), 16)
      : Number.parseInt(match[2].trim(), 10);
    if (match[1].toUpperCase() === classConstant && parsedParty === partyNumber) {
      existing = index;
    }
    index += 1;
  }

  if (terminator < 0) {
    throw new Error(
      `${OVERRIDE_LABEL} is missing its db 0 terminator. Yellow Editor will not rewrite an ambiguous table.`,
    );
  }

  if (picLabel === null) {
    if (existing >= 0) lines.splice(existing, 2);
  } else {
    const row = [
      `\tdb ${classConstant}, ${partyNumber}`,
      `\tdw ${picLabel}`,
    ];
    if (existing >= 0) {
      lines.splice(existing, 2, ...row);
    } else {
      lines.splice(terminator, 0, ...row);
    }
  }

  return lines.join(newlineFor(contents));
}

function installOverrideHook(contents: string): string {
  const callPattern = new RegExp(`^\\s*call\\s+${OVERRIDE_ROUTINE}\\b`, "m");
  const hasMarker = contents.includes(ENGINE_MARKER);
  if (callPattern.test(contents)) {
    if (!hasMarker) {
      throw new Error(
        `${TRAINER_PIC_ENGINE_PATH} already calls ${OVERRIDE_ROUTINE}, but the hook is not owned by Yellow Editor. The existing custom code was left untouched.`,
      );
    }
    return contents;
  }
  if (hasMarker) {
    throw new Error(
      `${TRAINER_PIC_ENGINE_PATH} contains an incomplete Yellow Editor portrait override hook.`,
    );
  }

  const nl = newlineFor(contents);
  const start = contents.search(/^GetTrainerInformation::{0,1}\s*$/m);
  const linkOffset = start < 0 ? -1 : contents.slice(start).search(/^\.linkBattle\s*$/m);
  const link = linkOffset < 0 ? -1 : start + linkOffset;
  if (start < 0 || link < 0 || link <= start) {
    throw new Error(
      `Could not safely locate the normal trainer portrait path in ${TRAINER_PIC_ENGINE_PATH}.`,
    );
  }

  const beforeLink = contents.slice(start, link);
  const returnMatches = [...beforeLink.matchAll(/^([ \t]*)jp\s+BankswitchBack\s*(?:;.*)?$/gm)];
  const lastReturn = returnMatches[returnMatches.length - 1];
  if (!lastReturn || lastReturn.index === undefined) {
    throw new Error(
      `Could not safely locate the trainer portrait BankswitchBack call in ${TRAINER_PIC_ENGINE_PATH}.`,
    );
  }

  const absoluteReturn = start + lastReturn.index;
  const returnLine = lastReturn[0];
  const indent = lastReturn[1] || "\t";
  return contents.slice(0, absoluteReturn)
    + ENGINE_MARKER + nl
    + `${indent}call ${OVERRIDE_ROUTINE}${nl}${returnLine}`
    + contents.slice(absoluteReturn + returnLine.length);
}

export function parseEditorTrainerPicOverride(
  contents: string,
  classConstant: string,
  partyNumber: number,
): string | null {
  if (!hasEditorTable(contents)) return null;

  const lines = contents.split(/\r?\n/);
  const start = lines.findIndex((line) => labelPattern(OVERRIDE_LABEL).test(line));
  if (start < 0) return null;

  for (let index = start + 1; index < lines.length; index += 1) {
    const clean = codeOnly(lines[index]);
    if (!clean) continue;
    if (/^db\s+0\b/i.test(clean)) break;
    const match = clean.match(/^db\s+([A-Z][A-Z0-9_]*)\s*,\s*([^,]+)$/i);
    if (!match) continue;
    const pointer = codeOnly(lines[index + 1] ?? "")
      .match(/^dw\s+([A-Za-z_][A-Za-z0-9_]*)$/i)?.[1];
    if (!pointer) continue;
    const parsedParty = /^\$[0-9a-f]+$/i.test(match[2].trim())
      ? Number.parseInt(match[2].trim().slice(1), 16)
      : Number.parseInt(match[2].trim(), 10);
    if (match[1].toUpperCase() === classConstant && parsedParty === partyNumber) {
      return pointer;
    }
    index += 1;
  }

  return null;
}

export async function prepareTrainerPicOverrideWrites(
  source: ProjectSource,
  classConstant: string,
  partyNumber: number,
  picLabel: string | null,
): Promise<TextWriteRequest[]> {
  if (!/^[A-Z][A-Z0-9_]*$/.test(classConstant)) {
    throw new Error("Trainer class constant is invalid.");
  }
  if (!Number.isInteger(partyNumber) || partyNumber < 1 || partyNumber > 255) {
    throw new Error("Trainer party number must be an integer from 1 to 255.");
  }

  const [constants, pics, tableBefore, engineBefore] = await Promise.all([
    source.readText(TRAINER_CONSTANTS_PATH),
    source.readText(TRAINER_PICS_PATH),
    source.readText(TRAINER_PIC_TABLE_PATH),
    source.readText(TRAINER_PIC_ENGINE_PATH),
  ]);

  if (!parseTrainerConstants(constants).has(classConstant)) {
    throw new Error(`Unknown trainer class ${classConstant}.`);
  }
  if (picLabel !== null && !parseTrainerPicLabels(pics).has(picLabel)) {
    throw new Error(
      `${picLabel} is not an existing trainer battle portrait in ${TRAINER_PICS_PATH}.`,
    );
  }

  let tableAfter = tableBefore;
  let engineAfter = engineBefore;

  if (picLabel !== null) {
    tableAfter = updateOverrideTable(tableBefore, classConstant, partyNumber, picLabel);
    engineAfter = installOverrideHook(engineBefore);
  } else {
    tableAfter = updateOverrideTable(tableBefore, classConstant, partyNumber, null);
  }

  const changes: TextWriteRequest[] = [];
  if (tableAfter !== tableBefore) {
    changes.push({
      path: TRAINER_PIC_TABLE_PATH,
      contents: tableAfter,
      expectedHash: await hashText(tableBefore),
    });
  }
  if (engineAfter !== engineBefore) {
    changes.push({
      path: TRAINER_PIC_ENGINE_PATH,
      contents: engineAfter,
      expectedHash: await hashText(engineBefore),
    });
  }

  return changes;
}
