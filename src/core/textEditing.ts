import { hashText } from "./history";
import {
  decodeAsmTextString,
  runtimeTextCommandPreview,
  visibleAsmText,
} from "./textPreview";
import type {
  HistorySummary,
  ProjectSession,
  ProjectSource,
  TextWriteRequest,
} from "./types";

export type TextSegmentControl =
  | "text"
  | "next"
  | "line"
  | "cont"
  | "para"
  | "page";

export type TextTerminator = "done" | "prompt" | "dex" | "text_end" | null;

export interface TextSegment {
  control: TextSegmentControl;
  text: string;
}

export type TextDisplayPart =
  | { type: "segment"; segmentIndex: number }
  | { type: "dynamic"; text: string; maxWidth?: number }
  | { type: "break"; kind: "line" | "paragraph" };

export interface TextSegmentMetric {
  width: number;
  maxWidth: number;
  error: string | null;
}

export interface TextDocument {
  path: string;
  label: string;
  sourceHash: string;
  segments: TextSegment[];
  displayParts: TextDisplayPart[];
  terminator: TextTerminator;
  editable: boolean;
  warnings: string[];
}

export interface TextDocumentSaveRequest {
  path: string;
  label: string;
  sourceHash: string;
  segments: TextSegment[];
}

export interface TextEditingSession {
  getTextDocument(path: string, label: string, previewText?: string): Promise<TextDocument>;
  saveTextDocument(request: TextDocumentSaveRequest): Promise<HistorySummary>;
}

type PreparedTextWriteRequest = TextWriteRequest & {
  beforeContents?: string;
  beforeHash?: string;
};

interface LabelRange {
  start: number;
  end: number;
}

export const TEXT_BOX_LINE_WIDTH = 18;
export const TEXT_BOX_BOTTOM_LINE_WIDTH = 17;

const TEXT_LINE_PATTERN = /^(\s*)(text|next|line|cont|para|page)\s+"((?:[^"\\]|\\.)*)"(.*)$/i;
const LABEL_PATTERN = /^\s*([A-Za-z_.][A-Za-z0-9_.]*):{1,2}\s*(?:;.*)?$/;
const GLOBAL_LABEL_PATTERN = /^\s*([A-Za-z_][A-Za-z0-9_]*):{1,2}\s*(?:;.*)?$/;
const TERMINATOR_PATTERN = /^\s*(done|prompt|dex|text_end)\b/i;
const FAR_TEXT_PATTERN = /^\s*text_far\s+([A-Za-z_.][A-Za-z0-9_.]*)\b/i;
const TEXT_POINTER_LOAD_PATTERN = /^\s*ld\s+hl\s*,\s*([A-Za-z_.][A-Za-z0-9_.]*)\b/i;

// These control codes expand to runtime text. Count their maximum displayed width,
// rather than the number of characters used to spell the token in the ASM source.
const TEXT_TOKEN_WIDTHS: Readonly<Record<string, number>> = {
  "<PLAYER>": 7,
  "<RIVAL>": 7,
  "<TARGET>": 10,
  "<USER>": 10,
  "<PKMN>": 2,
  "<PC>": 2,
  "<TM>": 2,
  "<TRAINER>": 7,
  "<ROCKET>": 6,
  "<……>": 2,
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function encodeAsmString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

export function textLineDisplayWidth(value: string): number {
  let width = 0;
  for (let index = 0; index < value.length;) {
    const rest = value.slice(index);
    if (rest[0] === "@") {
      break;
    }
    if (rest[0] === "#") {
      width += 4; // the single source token displays as POKé
      index += 1;
      continue;
    }
    if (rest[0] === "<") {
      const token = rest.match(/^<[^>]+>/)?.[0];
      if (token) {
        width += TEXT_TOKEN_WIDTHS[token.toUpperCase()] ?? 1;
        index += token.length;
        continue;
      }
    }
    width += 1;
    index += 1;
  }
  return width;
}

export function textSegmentLineWidth(control: TextSegmentControl): number {
  // In the normal two-row dialogue box, these controls place text on the
  // lower row. The engine writes its continue arrow into the 18th cell there,
  // so only the first 17 cells are safe for dialogue.
  return control === "next" || control === "line" || control === "cont"
    ? TEXT_BOX_BOTTOM_LINE_WIDTH
    : TEXT_BOX_LINE_WIDTH;
}

function textRowLengthError(width: number, maxWidth: number): string | null {
  if (width <= maxWidth) return null;
  return maxWidth === TEXT_BOX_BOTTOM_LINE_WIDTH
    ? `This displayed row uses up to ${width} character spaces, but the bottom dialogue row only has ${maxWidth} safe spaces because the continue arrow uses the last cell.`
    : `This displayed row uses up to ${width} character spaces, but a dialogue row only has ${maxWidth} spaces.`;
}

export function textLineLengthError(
  value: string,
  maxWidth = TEXT_BOX_LINE_WIDTH,
): string | null {
  if (value.includes("@")) {
    return "The @ symbol is a source terminator, not visible dialogue. Yellow Editor preserves it automatically.";
  }
  return textRowLengthError(textLineDisplayWidth(value), maxWidth);
}

function textSegmentMetrics(
  displayParts: TextDisplayPart[],
  segments: TextSegment[],
): TextSegmentMetric[] {
  const metrics = segments.map((): TextSegmentMetric => ({
    width: 0,
    maxWidth: TEXT_BOX_LINE_WIDTH,
    error: null,
  }));

  let rowWidth = 0;
  let rowMaxWidth = TEXT_BOX_LINE_WIDTH;
  let rowSegments: number[] = [];
  let rowContentError: string | null = null;

  const flushRow = () => {
    const widthError = textRowLengthError(rowWidth, rowMaxWidth);
    const error = rowContentError ?? widthError;
    for (const segmentIndex of rowSegments) {
      metrics[segmentIndex] = {
        width: rowWidth,
        maxWidth: rowMaxWidth,
        error,
      };
    }
    rowWidth = 0;
    rowSegments = [];
    rowContentError = null;
  };

  for (const part of displayParts) {
    if (part.type === "break") {
      flushRow();
      rowMaxWidth = part.kind === "line"
        ? TEXT_BOX_BOTTOM_LINE_WIDTH
        : TEXT_BOX_LINE_WIDTH;
      continue;
    }

    if (part.type === "dynamic") {
      rowWidth += part.maxWidth ?? 0;
      continue;
    }

    const segment = segments[part.segmentIndex];
    if (!segment) continue;
    rowSegments.push(part.segmentIndex);
    if (segment.text.includes("@")) {
      rowContentError = "The @ symbol is a source terminator, not visible dialogue. Yellow Editor preserves it automatically.";
    }
    rowWidth += textLineDisplayWidth(segment.text);
  }
  flushRow();

  return metrics;
}

export function textDocumentSegmentMetrics(
  document: Pick<TextDocument, "displayParts" | "segments">,
  segments: TextSegment[] = document.segments,
): TextSegmentMetric[] {
  return textSegmentMetrics(document.displayParts, segments);
}

function findLabelRange(lines: string[], label: string): LabelRange {
  const exact = new RegExp(`^\\s*${escapeRegex(label)}:{1,2}\\s*(?:;.*)?$`);
  const matches: number[] = [];
  lines.forEach((line, index) => {
    if (exact.test(line)) {
      matches.push(index);
    }
  });

  if (matches.length === 0) {
    throw new Error(`Text label '${label}' was not found.`);
  }
  if (matches.length > 1) {
    throw new Error(
      `Text label '${label}' appears more than once in this file, so Yellow Editor cannot edit it safely yet.`,
    );
  }

  const start = matches[0];
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (LABEL_PATTERN.test(lines[index])) {
      end = index;
      break;
    }
  }
  return { start, end };
}

function findGlobalLabelRange(lines: string[], label: string): LabelRange {
  if (label.startsWith(".")) {
    return findLabelRange(lines, label);
  }

  const exact = new RegExp(`^\\s*${escapeRegex(label)}:{1,2}\\s*(?:;.*)?$`);
  const matches: number[] = [];
  lines.forEach((line, index) => {
    if (exact.test(line)) matches.push(index);
  });

  if (matches.length === 0) {
    throw new Error(`Text label '${label}' was not found.`);
  }
  if (matches.length > 1) {
    throw new Error(
      `Text label '${label}' appears more than once in this file, so Yellow Editor cannot edit it safely yet.`,
    );
  }

  const start = matches[0];
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (GLOBAL_LABEL_PATTERN.test(lines[index])) {
      end = index;
      break;
    }
  }
  return { start, end };
}

function parseBlock(
  lines: string[],
  range: LabelRange,
): Pick<TextDocument, "segments" | "displayParts" | "terminator" | "editable" | "warnings"> {
  const segments: TextSegment[] = [];
  const displayParts: TextDisplayPart[] = [];
  const warnings: string[] = [];
  let terminator: TextTerminator = null;

  for (let index = range.start + 1; index < range.end; index += 1) {
    const raw = lines[index];
    const clean = raw.split(";", 1)[0].trim();
    if (!clean) {
      continue;
    }

    const textLine = raw.match(TEXT_LINE_PATTERN);
    if (textLine) {
      const control = textLine[2].toLowerCase() as TextSegmentControl;
      if (control === "next" || control === "line" || control === "cont") {
        displayParts.push({ type: "break", kind: "line" });
      } else if (control === "para" || control === "page") {
        displayParts.push({ type: "break", kind: "paragraph" });
      }
      const segmentIndex = segments.length;
      segments.push({
        control,
        text: visibleAsmText(textLine[3]),
      });
      displayParts.push({ type: "segment", segmentIndex });
      continue;
    }

    const terminatorMatch = clean.match(TERMINATOR_PATTERN)?.[1]?.toLowerCase();
    if (terminatorMatch) {
      terminator = terminatorMatch as Exclude<TextTerminator, null>;
      continue;
    }

    const runtime = runtimeTextCommandPreview(clean);
    if (runtime) {
      if (runtime.kind === "break") {
        displayParts.push({ type: "break", kind: "line" });
      } else if (runtime.kind === "dynamic" && runtime.text) {
        displayParts.push({
          type: "dynamic",
          text: runtime.text,
          maxWidth: runtime.maxWidth,
        });
      }
      if (!runtime.safeToEdit) {
        warnings.push(
          `Yellow Editor can preview but cannot safely measure this runtime text command on line ${index + 1}: ${clean}`,
        );
      }
      continue;
    }

    warnings.push(
      `Unsupported text command on line ${index + 1}: ${clean}`,
    );
  }

  if (segments.length === 0) {
    warnings.push("This label does not contain ordinary quoted text lines.");
  }

  return {
    segments,
    displayParts,
    terminator,
    editable: warnings.length === 0 && segments.length > 0,
    warnings,
  };
}

function farTextLabel(contents: string, label: string): string | null {
  const newline = contents.includes("\r\n") ? "\r\n" : "\n";
  const lines = contents.split(newline);
  // A text_asm wrapper can put its actual text_far under a local label such as
  // .IntroText. Scan the whole global wrapper, including local labels, but only
  // auto-follow it when there is exactly one distinct far-text destination.
  const range = findGlobalLabelRange(lines, label);
  const labels: string[] = [];
  for (let index = range.start + 1; index < range.end; index += 1) {
    const farLabel = lines[index].match(FAR_TEXT_PATTERN)?.[1];
    if (farLabel && !labels.includes(farLabel)) labels.push(farLabel);
  }
  return labels.length === 1 ? labels[0] : null;
}

function textPointerCandidates(contents: string, label: string): string[] {
  const newline = contents.includes("\r\n") ? "\r\n" : "\n";
  const lines = contents.split(newline);
  const range = findGlobalLabelRange(lines, label);
  const labels: string[] = [];
  for (let index = range.start + 1; index < range.end; index += 1) {
    const candidate = lines[index].match(TEXT_POINTER_LOAD_PATTERN)?.[1];
    if (candidate && !labels.includes(candidate)) labels.push(candidate);
  }
  return labels;
}

function includedTextPaths(contents: string): string[] {
  return [...contents.matchAll(/^\s*INCLUDE\s+"(text\/[^"]+\.asm)"/gm)].map((match) => match[1]);
}

function pathStem(path: string): string {
  return path.split("/").pop()?.replace(/\.asm$/i, "") ?? "";
}

function containsLabel(contents: string, label: string): boolean {
  const exact = new RegExp(`^\\s*${escapeRegex(label)}:{1,2}\\s*(?:;.*)?$`, "m");
  return exact.test(contents);
}

export function textDocumentDisplayPreview(
  document: Pick<TextDocument, "displayParts" | "segments">,
  segments: TextSegment[] = document.segments,
): string {
  let result = "";
  for (const part of document.displayParts) {
    if (part.type === "break") {
      if (!result) continue;
      const separator = part.kind === "paragraph" ? "\n\n" : "\n";
      if (!result.endsWith(separator)) result += separator;
      continue;
    }
    if (part.type === "dynamic") {
      result += part.text;
      continue;
    }
    result += segments[part.segmentIndex]?.text ?? "";
  }
  return result.trim();
}

function comparableText(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

async function findExternalTextDocument(
  source: ProjectSource,
  wrapperPath: string,
  textLabel: string,
): Promise<TextDocument | null> {
  const preferredPath = `text/${pathStem(wrapperPath)}.asm`;
  if (await source.exists(preferredPath)) {
    const contents = await source.readText(preferredPath);
    if (containsLabel(contents, textLabel)) {
      return parseTextDocument(preferredPath, textLabel, contents);
    }
  }

  if (!(await source.exists("text.asm"))) return null;
  const textIndex = await source.readText("text.asm");
  const candidates = includedTextPaths(textIndex).filter((path) => path !== preferredPath);
  for (const path of candidates) {
    if (!(await source.exists(path))) continue;
    const contents = await source.readText(path);
    if (containsLabel(contents, textLabel)) {
      return parseTextDocument(path, textLabel, contents);
    }
  }
  return null;
}

async function resolveFarTextDocument(
  source: ProjectSource,
  wrapperPath: string,
  wrapperLabel: string,
  wrapperContents: string,
): Promise<TextDocument | null> {
  const textLabel = farTextLabel(wrapperContents, wrapperLabel);
  return textLabel ? findExternalTextDocument(source, wrapperPath, textLabel) : null;
}

async function resolveTextLeafDocument(
  source: ProjectSource,
  path: string,
  label: string,
  previewText: string,
  visited: Set<string>,
): Promise<TextDocument | null> {
  const visitKey = `${path}:${label}`;
  if (visited.has(visitKey)) return null;
  visited.add(visitKey);

  const contents = await source.readText(path);
  const direct = await parseTextDocument(path, label, contents);
  if (direct.editable) return direct;

  const candidates = textPointerCandidates(contents, label);
  const resolved: TextDocument[] = [];
  for (const candidate of candidates) {
    try {
      const document = await resolveTextLeafDocument(
        source,
        path,
        candidate,
        previewText,
        new Set(visited),
      );
      if (document && !resolved.some((existing) =>
        existing.path === document.path && existing.label === document.label
      )) {
        resolved.push(document);
      }
    } catch {
      // Registers may point at data that is not text. Ignore candidates that
      // cannot be proven to resolve to an editable dialogue leaf.
    }
  }

  const expected = comparableText(previewText);
  const exactMatches = resolved.filter((document) =>
    comparableText(textDocumentDisplayPreview(document)) === expected
  );
  if (exactMatches.length === 1) return exactMatches[0];
  if (resolved.length === 1) return resolved[0];
  if (resolved.length > 1) return null;

  return resolveFarTextDocument(source, path, label, contents);
}

export async function parseTextDocument(
  path: string,
  label: string,
  contents: string,
): Promise<TextDocument> {
  const newline = contents.includes("\r\n") ? "\r\n" : "\n";
  const lines = contents.split(newline);
  const range = findLabelRange(lines, label);
  const parsed = parseBlock(lines, range);

  return {
    path,
    label,
    sourceHash: await hashText(contents),
    ...parsed,
  };
}

export function applyTextDocumentEdits(
  contents: string,
  label: string,
  segments: TextSegment[],
): string {
  const newline = contents.includes("\r\n") ? "\r\n" : "\n";
  const lines = contents.split(newline);
  const range = findLabelRange(lines, label);
  const current = parseBlock(lines, range);

  if (!current.editable) {
    throw new Error(
      `Text label '${label}' contains commands Yellow Editor does not edit safely yet.`,
    );
  }
  if (segments.length !== current.segments.length) {
    throw new Error(
      `Text label '${label}' changed structure while it was being edited. Reload it before saving.`,
    );
  }

  const metrics = textSegmentMetrics(current.displayParts, segments);
  const firstMetricError = metrics.find((metric) => metric.error)?.error;
  if (firstMetricError) {
    throw new Error(`${firstMetricError} Shorten the affected displayed row before saving.`);
  }

  let segmentIndex = 0;
  for (let index = range.start + 1; index < range.end; index += 1) {
    const match = lines[index].match(TEXT_LINE_PATTERN);
    if (!match) {
      continue;
    }

    const next = segments[segmentIndex];
    const currentControl = match[2].toLowerCase() as TextSegmentControl;
    if (!next || next.control !== currentControl) {
      throw new Error(
        `Text label '${label}' changed its text flow while it was being edited. Reload it before saving.`,
      );
    }
    if (/\r|\n/.test(next.text)) {
      throw new Error(
        "A single text segment cannot contain a raw line break. Use the existing text-flow segments instead.",
      );
    }
    const originalText = decodeAsmTextString(match[3]);
    const terminatorIndex = originalText.indexOf("@");
    const sourceSuffix = terminatorIndex >= 0 ? originalText.slice(terminatorIndex) : "";
    lines[index] = `${match[1]}${match[2]} "${encodeAsmString(next.text + sourceSuffix)}"${match[4]}`;
    segmentIndex += 1;
  }

  return lines.join(newline);
}

export function attachTextEditing(
  session: ProjectSession,
  source: ProjectSource,
): ProjectSession & TextEditingSession {
  const extended = session as ProjectSession & TextEditingSession;

  extended.getTextDocument = async (path, label, previewText) => {
    const contents = await source.readText(path);
    if (previewText) {
      try {
        const leafDocument = await resolveTextLeafDocument(
          source,
          path,
          label,
          previewText,
          new Set(),
        );
        if (leafDocument) return leafDocument;
      } catch {
        // Fall through to the conservative wrapper behavior below. This keeps
        // unusual text_asm programs read-only instead of guessing a target.
      }
    }
    const farDocument = await resolveFarTextDocument(source, path, label, contents);
    return farDocument ?? parseTextDocument(path, label, contents);
  };

  extended.saveTextDocument = async (request) => {
    const current = await source.readText(request.path);
    const currentHash = await hashText(current);
    if (currentHash !== request.sourceHash) {
      throw new Error(
        `${request.path} changed outside Yellow Editor. Reload the text before saving so those changes are preserved.`,
      );
    }

    const contents = applyTextDocumentEdits(current, request.label, request.segments);
    const change: PreparedTextWriteRequest = {
      path: request.path,
      contents,
      expectedHash: request.sourceHash,
      beforeContents: current,
      beforeHash: currentHash,
    };
    return session.saveTextChanges(`Edit text ${request.label}`, [change]);
  };

  return extended;
}