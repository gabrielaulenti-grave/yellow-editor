import { hashText } from "./history";
import type { MacroAnalysis } from "./macroCatalog";
import { editableScriptMacroArguments, scriptMacroReadOnlyReason, scriptMacroByteExpressionsValid } from "./scriptMacroEligibility";
import type {
  ScriptMacroEditDocument,
  TextWriteRequest,
} from "./types";

interface InvocationArgumentSpan {
  start: number;
  end: number;
  raw: string;
}

interface ParsedInvocationLine {
  macroName: string;
  arguments: InvocationArgumentSpan[];
}

export type PreparedScriptMacroWrite = TextWriteRequest;

function commentStart(line: string): number {
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === ";" && !quoted) {
      return index;
    }
  }
  return line.length;
}

function trimBounds(line: string, start: number, end: number): {
  start: number;
  end: number;
} {
  let left = start;
  let right = end;
  while (left < right && /\s/.test(line[left])) left += 1;
  while (right > left && /\s/.test(line[right - 1])) right -= 1;
  return { start: left, end: right };
}

function argumentSpans(
  line: string,
  start: number,
  end: number,
): InvocationArgumentSpan[] {
  const spans: InvocationArgumentSpan[] = [];
  let segmentStart = start;
  let quoted = false;
  let escaped = false;
  let depth = 0;

  function push(segmentEnd: number): void {
    const bounds = trimBounds(line, segmentStart, segmentEnd);
    spans.push({
      start: bounds.start,
      end: bounds.end,
      raw: line.slice(bounds.start, bounds.end),
    });
  }

  for (let index = start; index < end; index += 1) {
    const char = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;

    if (char === "(" || char === "[" || char === "{") {
      depth += 1;
      continue;
    }
    if (char === ")" || char === "]" || char === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (char === "," && depth === 0) {
      push(index);
      segmentStart = index + 1;
    }
  }

  push(end);
  if (spans.length === 1 && spans[0].raw === "") {
    return [];
  }
  return spans;
}

function parseInvocationLine(line: string): ParsedInvocationLine | null {
  const end = commentStart(line);
  const code = line.slice(0, end);
  if (!code.trim() || code.trimEnd().endsWith("\\")) {
    return null;
  }

  const match = code.match(/^(\s*)([A-Za-z_][A-Za-z0-9_#@.]*)(\s*)(.*)$/);
  if (!match) return null;

  const prefixLength = match[1].length + match[2].length;
  const gapLength = match[3].length;
  const remainder = match[4];
  if (remainder && gapLength === 0) {
    return null;
  }

  const argsStart = prefixLength + gapLength;
  const argsEnd = end;
  return {
    macroName: match[2],
    arguments: remainder.trim().length > 0
      ? argumentSpans(line, argsStart, argsEnd)
      : [],
  };
}

function lineBounds(source: string, lineNumber: number): {
  start: number;
  end: number;
  text: string;
} {
  if (!Number.isInteger(lineNumber) || lineNumber < 1) {
    throw new Error("Macro source line must be a positive integer.");
  }

  let currentLine = 1;
  let start = 0;
  while (currentLine < lineNumber) {
    const newline = source.indexOf("\n", start);
    if (newline < 0) {
      throw new Error(`Macro source line ${lineNumber} is outside the file.`);
    }
    start = newline + 1;
    currentLine += 1;
  }

  const newline = source.indexOf("\n", start);
  const rawEnd = newline < 0 ? source.length : newline;
  const end = rawEnd > start && source[rawEnd - 1] === "\r"
    ? rawEnd - 1
    : rawEnd;
  return {
    start,
    end,
    text: source.slice(start, end),
  };
}

function callFor(
  analysis: MacroAnalysis,
  path: string,
  line: number,
) {
  return analysis.callsByScriptPath.get(path)?.calls.find(
    (call) => call.line === line,
  ) ?? null;
}

function verifyAnalysisMatchesLine(
  analysis: MacroAnalysis,
  path: string,
  line: number,
  parsed: ParsedInvocationLine,
): void {
  const call = callFor(analysis, path, line);
  if (!call) {
    throw new Error(
      "Yellow Editor no longer recognizes this source line as the same project macro call. Reload Scripts before editing it.",
    );
  }
  if (call.name.toLowerCase() !== parsed.macroName.toLowerCase()) {
    throw new Error(
      "The project macro name changed since it was analyzed. Reload Scripts before editing it.",
    );
  }
  if (
    call.arguments.length !== parsed.arguments.length
    || call.arguments.some(
      (argument, index) => argument.raw !== parsed.arguments[index]?.raw,
    )
  ) {
    throw new Error(
      "The project macro arguments changed since they were analyzed. Reload Scripts before editing them.",
    );
  }
}

export async function loadScriptMacroEditDocument(
  sourceText: string,
  path: string,
  line: number,
  analysis: MacroAnalysis,
): Promise<ScriptMacroEditDocument> {
  const bounds = lineBounds(sourceText, line);
  const parsed = parseInvocationLine(bounds.text);
  if (!parsed) {
    throw new Error(
      "This macro call is not a safe single-line invocation and cannot be edited structurally yet.",
    );
  }

  verifyAnalysisMatchesLine(analysis, path, line, parsed);
  const call = callFor(analysis, path, line);
  if (!call) {
    throw new Error(
      "Yellow Editor no longer recognizes this source line as the same project macro call. Reload Scripts before editing it.",
    );
  }
  const editableArgumentDomains = editableScriptMacroArguments(
    analysis.catalog,
    call,
  );

  return {
    path,
    line,
    macroName: parsed.macroName,
    sourceHash: await hashText(sourceText),
    sourceLine: bounds.text,
    arguments: parsed.arguments.map((argument) => argument.raw),
    editableArgumentDomains,
  };
}

export async function prepareScriptMacroCallWrite(
  sourceText: string,
  path: string,
  line: number,
  macroName: string,
  expectedHash: string,
  nextArguments: string[],
  analysis: MacroAnalysis,
): Promise<PreparedScriptMacroWrite> {
  const currentHash = await hashText(sourceText);
  if (currentHash !== expectedHash) {
    throw new Error(
      `${path} changed after this macro form was loaded. Reload Scripts before saving so newer changes are preserved.`,
    );
  }

  const bounds = lineBounds(sourceText, line);
  const parsed = parseInvocationLine(bounds.text);
  if (!parsed || parsed.macroName.toLowerCase() !== macroName.toLowerCase()) {
    throw new Error(
      "The macro invocation no longer matches the form that was loaded. Reload Scripts before saving.",
    );
  }

  verifyAnalysisMatchesLine(analysis, path, line, parsed);

  if (nextArguments.length !== parsed.arguments.length) {
    throw new Error(
      "This editing phase can replace existing macro parameters but cannot add or remove arguments yet.",
    );
  }

  const analyzedCall = callFor(analysis, path, line);
  if (!analyzedCall) {
    throw new Error(
      "Yellow Editor no longer recognizes this source line as the same project macro call. Reload Scripts before saving it.",
    );
  }
  const editable = new Map(
    editableScriptMacroArguments(analysis.catalog, analyzedCall)
      .map((entry) => [entry.index, entry] as const),
  );

  for (let index = 0; index < nextArguments.length; index += 1) {
    const previous = parsed.arguments[index].raw;
    const next = nextArguments[index];
    if (previous === next) continue;

    const editableEntry = editable.get(index + 1);
    if (!editableEntry) {
      const parameter = analysis.catalog.macros.find((definition) => definition.name.toLowerCase() === macroName.toLowerCase())?.parameters[index];
      const reason = scriptMacroReadOnlyReason(parameter);
      throw new Error(
        reason ? `Argument ${index + 1} is read-only: ${reason}`
          : `Argument ${index + 1} does not have a proven project semantic domain, so Yellow Editor will not rewrite it yet.`,
      );
    }

    if (!editableEntry.allowedValues.includes(next)) {
      throw new Error(
        `Argument ${index + 1} value '${next}' would leave its proven semantic-domain intersection. Yellow Editor refused the save so the parameter cannot silently change meaning.`,
      );
    }
  }

  if (nextArguments.some((value, index) => value !== parsed.arguments[index].raw)
    && !scriptMacroByteExpressionsValid(analysis.catalog, analyzedCall, nextArguments)) {
    throw new Error("These arguments together exceed the macro's emitted byte range. Yellow Editor refused the save to prevent operand truncation.");
  }

  let nextLine = bounds.text;
  for (let index = parsed.arguments.length - 1; index >= 0; index -= 1) {
    const span = parsed.arguments[index];
    const next = nextArguments[index];
    if (span.raw === next) continue;
    nextLine = nextLine.slice(0, span.start) + next + nextLine.slice(span.end);
  }

  const rewritten = parseInvocationLine(nextLine);
  if (
    !rewritten
    || rewritten.macroName.toLowerCase() !== parsed.macroName.toLowerCase()
    || rewritten.arguments.length !== nextArguments.length
    || rewritten.arguments.some(
      (argument, index) => argument.raw !== nextArguments[index],
    )
  ) {
    throw new Error(
      "The rewritten macro did not round-trip to the same invocation shape. Yellow Editor refused the save so the source cannot be structurally corrupted.",
    );
  }

  return {
    path,
    contents: sourceText.slice(0, bounds.start) + nextLine + sourceText.slice(bounds.end),
    expectedHash,
  };
}
