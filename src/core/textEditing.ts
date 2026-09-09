import { hashText } from "./history";
import type {
  HistorySummary,
  ProjectSession,
  ProjectSource,
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

export interface TextDocument {
  path: string;
  label: string;
  sourceHash: string;
  segments: TextSegment[];
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
  getTextDocument(path: string, label: string): Promise<TextDocument>;
  saveTextDocument(request: TextDocumentSaveRequest): Promise<HistorySummary>;
}

interface LabelRange {
  start: number;
  end: number;
}

const TEXT_LINE_PATTERN = /^(\s*)(text|next|line|cont|para|page)\s+"((?:[^"\\]|\\.)*)"(.*)$/i;
const LABEL_PATTERN = /^\s*([A-Za-z_.][A-Za-z0-9_.]*):{1,2}\s*(?:;.*)?$/;
const TERMINATOR_PATTERN = /^\s*(done|prompt|dex|text_end)\b/i;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeAsmString(value: string): string {
  return value
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function encodeAsmString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
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

function parseBlock(
  lines: string[],
  range: LabelRange,
): Pick<TextDocument, "segments" | "terminator" | "editable" | "warnings"> {
  const segments: TextSegment[] = [];
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
      segments.push({
        control: textLine[2].toLowerCase() as TextSegmentControl,
        text: decodeAsmString(textLine[3]),
      });
      continue;
    }

    const terminatorMatch = clean.match(TERMINATOR_PATTERN)?.[1]?.toLowerCase();
    if (terminatorMatch) {
      terminator = terminatorMatch as Exclude<TextTerminator, null>;
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
    terminator,
    editable: warnings.length === 0 && segments.length > 0,
    warnings,
  };
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

    lines[index] = `${match[1]}${match[2]} "${encodeAsmString(next.text)}"${match[4]}`;
    segmentIndex += 1;
  }

  return lines.join(newline);
}

export function attachTextEditing(
  session: ProjectSession,
  source: ProjectSource,
): ProjectSession & TextEditingSession {
  const extended = session as ProjectSession & TextEditingSession;

  extended.getTextDocument = async (path, label) => {
    const contents = await source.readText(path);
    return parseTextDocument(path, label, contents);
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
    return session.saveTextChanges(`Edit text ${request.label}`, [{
      path: request.path,
      contents,
      expectedHash: request.sourceHash,
    }]);
  };

  return extended;
}
