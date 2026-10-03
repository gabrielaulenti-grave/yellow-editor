import { hashText } from "./history";
import {
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
  getTextLeafDocuments(path: string, label: string): Promise<TextDocument[]>;
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
const LABEL_PATTERN = /^\s*(?:([A-Za-z_][A-Za-z0-9_]*):{1,2}|(\.[A-Za-z_][A-Za-z0-9_]*):{0,2})\s*(?:;.*)?$/;
const TERMINATOR_PATTERN = /^\s*(done|prompt|dex|text_end)\b/i;
const FAR_TEXT_PATTERN = /^\s*text_far\s+([A-Za-z_.][A-Za-z0-9_.]*)\b/i;
const TEXT_POINTER_LOAD_PATTERN = /^\s*ld\s+hl\s*,\s*([A-Za-z_.][A-Za-z0-9_.]*)\b/i;
const SHARED_TEXT_WRAPPER_PATHS = [
  "home/overworld_text.asm",
] as const;

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

export function textSegmentsDisplayParts(segments: TextSegment[]): TextDisplayPart[] {
  const displayParts: TextDisplayPart[] = [];
  for (const [segmentIndex, segment] of segments.entries()) {
    if (segment.control === "next" || segment.control === "line" || segment.control === "cont") {
      displayParts.push({ type: "break", kind: "line" });
    } else if (segment.control === "para" || segment.control === "page") {
      displayParts.push({ type: "break", kind: "paragraph" });
    }
    displayParts.push({ type: "segment", segmentIndex });
  }
  return displayParts;
}

function textSegmentMetrics(
  displayParts: TextDisplayPart[],
  segments: TextSegment[],
  terminator: TextTerminator = null,
): TextSegmentMetric[] {
  const metrics = segments.map((): TextSegmentMetric => ({
    width: 0,
    maxWidth: TEXT_BOX_LINE_WIDTH,
    error: null,
  }));

  const dexMode = terminator === "dex";
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
      rowMaxWidth = dexMode
        ? TEXT_BOX_LINE_WIDTH
        : part.kind === "line"
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
  document: Pick<TextDocument, "displayParts" | "segments" | "terminator">,
  segments: TextSegment[] = document.segments,
): TextSegmentMetric[] {
  return textSegmentMetrics(document.displayParts, segments, document.terminator);
}

function labelDefinitions(lines: string[]): { label: string; index: number; global: boolean }[] {
  let scope = "";
  return lines.flatMap<{ label: string; index: number; global: boolean }>((line, index) => {
    const match = line.match(LABEL_PATTERN);
    if (!match) return [];
    if (match[1]) {
      scope = match[1];
      return [{ label: scope, index, global: true }];
    }
    return [{ label: `${scope}${match[2]}`, index, global: false }];
  });
}

function labelRange(lines: string[], label: string, includeLocals: boolean): LabelRange {
  const definitions = labelDefinitions(lines);
  const matches = definitions.filter((entry) => label.startsWith(".")
    ? entry.label.endsWith(label) && !entry.global
    : entry.label === label);
  if (matches.length === 0) throw new Error(`Text label '${label}' was not found.`);
  if (matches.length > 1) {
    throw new Error(`Text label '${label}' appears more than once in this file, so Yellow Editor cannot edit it safely yet. Use its full scoped label.`);
  }
  const start = matches[0].index;
  const end = definitions.find((entry) => entry.index > start
    && (!includeLocals || !matches[0].global || entry.global))?.index ?? lines.length;
  return { start, end };
}

function findLabelRange(lines: string[], label: string): LabelRange {
  return labelRange(lines, label, false);
}

function findGlobalLabelRange(lines: string[], label: string): LabelRange {
  return labelRange(lines, label, true);
}

function scopedTarget(lines: string[], index: number, target: string): string {
  if (!target.startsWith(".")) return target;
  const globals = labelDefinitions(lines).filter((entry) => entry.global && entry.index <= index);
  const scope = globals[globals.length - 1];
  return `${scope?.label ?? ""}${target}`;
}

// UI references must qualify local text pointers at their actual source position.
export function qualifiedTextLabel(contents: string, target: string, sourceLine: number): string | null {
  if (!target.startsWith(".")) return target;
  const lines = contents.split(/\r?\n/);
  if (!Number.isInteger(sourceLine) || sourceLine < 1 || sourceLine > lines.length) return null;
  const scoped = scopedTarget(lines, sourceLine - 1, target);
  return scoped === target ? null : scoped;
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

function textPointerCandidates(contents: string, label: string): string[] {
  const lines = contents.split(/\r?\n/);
  const range = findGlobalLabelRange(lines, label);
  const labels: string[] = [];
  for (let index = range.start + 1; index < range.end; index += 1) {
    const candidate = lines[index].match(TEXT_POINTER_LOAD_PATTERN)?.[1];
    if (candidate) {
      const scoped = scopedTarget(lines, index, candidate);
      if (!labels.includes(scoped)) labels.push(scoped);
    }
  }
  return labels;
}

function includedTextPaths(contents: string): string[] {
  return [...contents.matchAll(
    /^\s*INCLUDE\s+"((?:text|data\/text)\/[^"]+\.asm)"/gm,
  )].map((match) => match[1]);
}

function pathStem(path: string): string {
  return path.split("/").pop()?.replace(/\.asm$/i, "") ?? "";
}

function containsLabel(contents: string, label: string): boolean {
  try { findLabelRange(contents.split(/\r?\n/), label); return true; }
  catch { return false; }
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

function farTextLabels(contents: string, label: string): string[] {
  const lines = contents.split(/\r?\n/);
  const range = findGlobalLabelRange(lines, label);
  const labels: string[] = [];
  for (let index = range.start + 1; index < range.end; index += 1) {
    const farLabel = lines[index].match(FAR_TEXT_PATTERN)?.[1];
    if (farLabel && !labels.includes(farLabel)) labels.push(farLabel);
  }
  return labels;
}

function wrapperTargets(contents: string, label: string): string[] {
  const lines = contents.split(/\r?\n/);
  const range = findGlobalLabelRange(lines, label);
  const labels: string[] = [];
  for (let index = range.start + 1; index < range.end; index += 1) {
    const target = lines[index].match(
      /^\s*(?:farcall|callfar|call|farjp|jp|jr)\s+(?:(?:nz|z|nc|c)\s*,\s*)?([A-Za-z_.][A-Za-z0-9_.]*)\s*(?:;.*)?$/i,
    )?.[1];
    if (target) {
      const scoped = scopedTarget(lines, index, target);
      if (!labels.includes(scoped)) labels.push(scoped);
    }
  }
  return labels;
}

function siblingScriptPaths(path: string): string[] {
  const match = path.match(/^scripts\/(.+)\.asm$/i);
  if (!match) return [];
  const stem = match[1];
  return stem.endsWith("_2")
    ? [`scripts/${stem.slice(0, -2)}.asm`]
    : [`scripts/${stem}_2.asm`];
}

function uniqueDocuments(documents: TextDocument[]): TextDocument[] {
  return documents.filter((document, index) =>
    documents.findIndex((candidate) =>
      candidate.path === document.path && candidate.label === document.label
    ) === index
  );
}

async function resolveTextLeafDocuments(
  source: ProjectSource,
  path: string,
  label: string,
  visited: Set<string>,
): Promise<TextDocument[]> {
  const visitKey = `${path}:${label}`;
  if (visited.has(visitKey)) return [];
  visited.add(visitKey);

  const contents = await source.readText(path);
  const direct = await parseTextDocument(path, label, contents);
  if (direct.editable) return [direct];

  const resolved: TextDocument[] = [];

  for (const farLabel of farTextLabels(contents, label)) {
    const external = await findExternalTextDocument(source, path, farLabel);
    if (external) resolved.push(external);
  }

  for (const target of wrapperTargets(contents, label)) {
    if (containsLabel(contents, target)) {
      resolved.push(...await resolveTextLeafDocuments(
        source,
        path,
        target,
        visited,
      ));
      continue;
    }
    for (const candidatePath of siblingScriptPaths(path)) {
      if (!(await source.exists(candidatePath))) continue;
      const candidateContents = await source.readText(candidatePath);
      if (!containsLabel(candidateContents, target)) continue;
      resolved.push(...await resolveTextLeafDocuments(
        source,
        candidatePath,
        target,
        visited,
      ));
      break;
    }
  }

  for (const candidate of textPointerCandidates(contents, label)) {
    if (!containsLabel(contents, candidate)) continue;
    try {
      resolved.push(...await resolveTextLeafDocuments(
        source,
        path,
        candidate,
        visited,
      ));
    } catch {
      // Some register loads point at non-text data. Ignore unproven targets.
    }
  }

  return uniqueDocuments(resolved);
}

export async function parseTextDocument(
  path: string,
  label: string,
  contents: string,
): Promise<TextDocument> {
  const lines = contents.split(/\r?\n/);
  const range = findLabelRange(lines, label);
  const parsed = parseBlock(lines, range);

  return {
    path,
    label,
    sourceHash: await hashText(contents),
    ...parsed,
  };
}

function validateDexStructure(segments: TextSegment[]): void {
  if (segments.length === 0 || segments[0].control !== "text") {
    throw new Error("Pokédex text must begin with a text line.");
  }
  for (const segment of segments) {
    if (!["text", "next", "page"].includes(segment.control)) {
      throw new Error("Pokédex entries only support text, next, and page text controls.");
    }
    if (/\r|\n/.test(segment.text)) {
      throw new Error(
        "A single text segment cannot contain a raw line break. Use the text-flow controls instead.",
      );
    }
  }
}

function rewriteDexTextBlock(
  lines: string[],
  range: LabelRange,
  segments: TextSegment[],
): void {
  validateDexStructure(segments);

  const firstTextLine = lines.slice(range.start + 1, range.end)
    .map((line) => line.match(TEXT_LINE_PATTERN))
    .find((match): match is RegExpMatchArray => Boolean(match));
  const terminatorLine = lines.slice(range.start + 1, range.end)
    .find((line) => /^\s*dex\b/i.test(line));
  const indent = firstTextLine?.[1] ?? "\t";
  const terminatorIndent = terminatorLine?.match(/^(\s*)/)?.[1] ?? indent;

  const replacement = segments.map(
    (segment) => `${indent}${segment.control} "${encodeAsmString(segment.text)}"`,
  );
  replacement.push(`${terminatorIndent}dex`);
  lines.splice(range.start + 1, range.end - range.start - 1, ...replacement);
}

export function applyTextDocumentEdits(
  contents: string,
  label: string,
  segments: TextSegment[],
): string {
  const newline = contents.includes("\r\n") ? "\r\n" : "\n";
  const separators = contents.match(/\r?\n/g) ?? [];
  const lines = contents.split(/\r?\n/);
  const offsets: number[] = [];
  let offset = 0;
  lines.forEach((line, index) => { offsets.push(offset); offset += line.length + (separators[index]?.length ?? 0); });
  const range = findLabelRange(lines, label);
  const current = parseBlock(lines, range);

  if (!current.editable) {
    throw new Error(
      `Text label '${label}' contains commands Yellow Editor does not edit safely yet.`,
    );
  }

  const displayParts = current.terminator === "dex"
    ? textSegmentsDisplayParts(segments)
    : current.displayParts;
  const metrics = textSegmentMetrics(displayParts, segments, current.terminator);
  const firstMetricError = metrics.find((metric) => metric.error)?.error;
  if (firstMetricError) {
    throw new Error(`${firstMetricError} Shorten the affected displayed row before saving.`);
  }

  const sameStructure = segments.length === current.segments.length
    && segments.every((segment, index) => segment.control === current.segments[index]?.control);

  if (!sameStructure) {
    if (current.terminator !== "dex") {
      throw new Error(
        `Text label '${label}' changed structure while it was being edited. Reload it before saving.`,
      );
    }
    const replacement = lines.slice(range.start, range.end);
    rewriteDexTextBlock(replacement, { start: 0, end: replacement.length }, segments);
    const tailSeparator = range.end < lines.length
      ? separators[range.end - 1]
      : contents.endsWith("\n") ? separators[separators.length - 1] : "";
    return contents.slice(0, offsets[range.start + 1]) + replacement.slice(1).join(newline)
      + tailSeparator + contents.slice(offsets[range.end] ?? contents.length);
  }

  const replacements: { start: number; end: number; text: string }[] = [];
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
    const terminatorIndex = match[3].indexOf("@");
    const sourceSuffix = terminatorIndex >= 0 ? match[3].slice(terminatorIndex) : "";
    if (next.text !== visibleAsmText(match[3])) {
      const start = offsets[index] + lines[index].indexOf('"') + 1;
      replacements.push({ start, end: start + match[3].length, text: encodeAsmString(next.text) + sourceSuffix });
    }
    segmentIndex += 1;
  }

  let rewritten = contents;
  for (const replacement of replacements.reverse()) {
    rewritten = rewritten.slice(0, replacement.start) + replacement.text + rewritten.slice(replacement.end);
  }
  return rewritten;
}

export function attachTextEditing(
  session: ProjectSession,
  source: ProjectSource,
): ProjectSession & TextEditingSession {
  const extended = session as ProjectSession & TextEditingSession;

  async function resolveStartingPath(path: string, label: string): Promise<string> {
    const contents = await source.readText(path);
    if (containsLabel(contents, label)) return path;

    for (const candidatePath of [...siblingScriptPaths(path), ...SHARED_TEXT_WRAPPER_PATHS]) {
      if (!(await source.exists(candidatePath))) continue;
      const candidateContents = await source.readText(candidatePath);
      if (containsLabel(candidateContents, label)) return candidatePath;
    }
    return path;
  }

  extended.getTextLeafDocuments = async (path, label) => {
    const resolvedPath = await resolveStartingPath(path, label);
    try {
      const leaves = await resolveTextLeafDocuments(
        source,
        resolvedPath,
        label,
        new Set(),
      );
      if (leaves.length > 0) return leaves;
    } catch {
      // Return the conservative wrapper document below.
    }
    const contents = await source.readText(resolvedPath);
    return [await parseTextDocument(resolvedPath, label, contents)];
  };

  extended.getTextDocument = async (path, label, previewText) => {
    const resolvedPath = await resolveStartingPath(path, label);
    const contents = await source.readText(resolvedPath);
    const leaves = await extended.getTextLeafDocuments(resolvedPath, label);

    if (previewText) {
      const expected = comparableText(previewText);
      const matches = leaves.filter((document) =>
        document.editable
        && comparableText(textDocumentDisplayPreview(document)) === expected
      );
      if (matches.length === 1) return matches[0];
    }

    const editableLeaves = leaves.filter((document) => document.editable);
    if (editableLeaves.length === 1) return editableLeaves[0];

    return parseTextDocument(resolvedPath, label, contents);
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