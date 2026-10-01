import type { ProjectRgbdsSourceFile } from "./projectConstants";
import type {
  ProjectEventMacroAction,
  ProjectEventMacroSemantic,
  ProjectEventZeroMeaning,
} from "./types";

function withoutComment(line: string): string {
  const index = line.indexOf(";");
  return (index >= 0 ? line.slice(0, index) : line).trim();
}

function parameterIndexes(lines: string[]): number[] {
  const result = new Set<number>();
  for (const line of lines) {
    if (!/(?:wEventFlags|\bbit\b|\bset\b|\bres\b|1\s*<<)/i.test(line)) {
      continue;
    }
    for (const match of line.matchAll(/\\([1-9])/g)) {
      result.add(Number(match[1]));
    }
  }
  return [...result].sort((left, right) => left - right);
}

function semanticFromBody(
  name: string,
  path: string,
  line: number,
  body: string[],
): ProjectEventMacroSemantic | null {
  const clean = body.map(withoutComment).filter(Boolean);
  const eventParameterIndexes = parameterIndexes(clean);
  if (eventParameterIndexes.length === 0) return null;

  const hasBit = clean.some((sourceLine) => /^bit\b/i.test(sourceLine));
  const hasSet = clean.some((sourceLine) => /^set\b/i.test(sourceLine));
  const hasReset = clean.some((sourceLine) => /^res\b/i.test(sourceLine));
  const multiMask = clean.some((sourceLine) =>
    /^and\b/i.test(sourceLine)
    && eventParameterIndexes.slice(0, 2).every((parameter) =>
      sourceLine.includes(`\\${parameter}`)
    )
  );
  const comparesMask = clean.some((sourceLine) =>
    /^cp\b/i.test(sourceLine)
    && eventParameterIndexes.slice(0, 2).every((parameter) =>
      sourceLine.includes(`\\${parameter}`)
    )
  );

  let action: ProjectEventMacroAction | null = null;
  let zeroMeaning: ProjectEventZeroMeaning | undefined;

  if (eventParameterIndexes.length > 1 && !multiMask) {
    return null;
  }

  if (eventParameterIndexes.length >= 2 && multiMask) {
    action = comparesMask ? "check-all" : "check-any";
    zeroMeaning = comparesMask ? "all-set" : "none-set";
  } else if (hasBit && hasSet && !hasReset) {
    action = "check-set";
    zeroMeaning = "event-clear";
  } else if (hasBit && hasReset && !hasSet) {
    action = "check-reset";
    zeroMeaning = "event-clear";
  } else if (hasBit && !hasSet && !hasReset) {
    action = "check";
    zeroMeaning = "event-clear";
  } else if (hasSet && !hasReset) {
    action = "set";
  } else if (hasReset && !hasSet) {
    action = "reset";
  }

  if (!action) return null;
  return {
    name,
    action,
    eventParameterIndexes,
    zeroMeaning,
    sourcePath: path,
    sourceLine: line,
  };
}

export function deriveProjectEventMacroSemantics(
  files: ProjectRgbdsSourceFile[],
): ProjectEventMacroSemantic[] {
  const result: ProjectEventMacroSemantic[] = [];

  for (const file of files) {
    if (!file.contents) continue;
    const lines = file.contents.split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
      const start = withoutComment(lines[index]).match(
        /^MACRO\??\s+([A-Za-z_][A-Za-z0-9_#@.]*)\b/i,
      );
      if (!start) continue;

      const body: string[] = [];
      let end = index;
      for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
        if (/^ENDM\b/i.test(withoutComment(lines[cursor]))) {
          end = cursor;
          break;
        }
        body.push(lines[cursor]);
        end = cursor;
      }

      const semantic = semanticFromBody(
        start[1],
        file.path,
        index + 1,
        body,
      );
      if (semantic) result.push(semantic);
      index = end;
    }
  }

  return result
    .filter((semantic, index, entries) =>
      entries.findIndex((candidate) =>
        candidate.name.toLowerCase() === semantic.name.toLowerCase()
      ) === index
    )
    .sort((left, right) => left.name.localeCompare(right.name));
}
