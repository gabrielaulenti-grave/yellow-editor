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

function parametersInLine(line: string): number[] {
  return [...line.matchAll(/\\([1-9])/g)]
    .map((match) => Number(match[1]))
    .filter((value, index, values) => values.indexOf(value) === index);
}

function operationParameterIndexes(
  lines: string[],
  pattern: RegExp,
): number[] {
  const result = new Set<number>();
  for (const line of lines) {
    if (!pattern.test(line)) continue;
    for (const parameter of parametersInLine(line)) result.add(parameter);
  }
  return [...result].sort((left, right) => left - right);
}

function aggregateMaskParameters(lines: string[]): number[] {
  const candidates = lines
    .filter((line) =>
      /^(?:and|or|cp)\b/i.test(line)
      && /1\s*<</i.test(line)
    )
    .map(parametersInLine)
    .filter((parameters) => parameters.length >= 2)
    .sort((left, right) => right.length - left.length);
  return candidates[0] ?? [];
}

function directSemanticFromBody(
  name: string,
  path: string,
  line: number,
  body: string[],
): ProjectEventMacroSemantic | null {
  const clean = body.map(withoutComment).filter(Boolean);
  const bitParameters = operationParameterIndexes(clean, /^bit\b/i);
  const setParameters = operationParameterIndexes(clean, /^set\b/i);
  const resetParameters = operationParameterIndexes(clean, /^res\b/i);
  const aggregateParameters = aggregateMaskParameters(clean);

  const hasBit = bitParameters.length > 0;
  const hasSet = setParameters.length > 0;
  const hasReset = resetParameters.length > 0;

  if (aggregateParameters.length >= 2) {
    const aggregateLine = clean.find((sourceLine) =>
      /^(?:and|or|cp)\b/i.test(sourceLine)
      && aggregateParameters.every((parameter) =>
        sourceLine.includes(`\\${parameter}`)
      )
    );
    if (aggregateLine) {
      const comparesMask = clean.some((sourceLine) =>
        /^cp\b/i.test(sourceLine)
        && aggregateParameters.every((parameter) =>
          sourceLine.includes(`\\${parameter}`)
        )
      );
      const resetsRange = /^and\b/i.test(aggregateLine)
        && /~\s*\(/.test(aggregateLine);
      const setsRange = /^or\b/i.test(aggregateLine);

      if (resetsRange && !hasBit) {
        return {
          name,
          action: "reset-range",
          eventParameterIndexes: aggregateParameters.slice(0, 2),
          sourcePath: path,
          sourceLine: line,
        };
      }
      if (setsRange && !hasBit) {
        return {
          name,
          action: "set-range",
          eventParameterIndexes: aggregateParameters.slice(0, 2),
          sourcePath: path,
          sourceLine: line,
        };
      }

      return {
        name,
        action: comparesMask ? "check-all" : "check-any",
        eventParameterIndexes: aggregateParameters.slice(0, 2),
        zeroMeaning: comparesMask ? "all-set" : "none-set",
        sourcePath: path,
        sourceLine: line,
      };
    }
  }

  const primaryBit = bitParameters[0];
  const primarySet = setParameters[0];
  const primaryReset = resetParameters[0];

  if (hasBit && hasSet && !hasReset && primaryBit === primarySet) {
    return {
      name,
      action: "check-set",
      eventParameterIndexes: [primaryBit],
      zeroMeaning: "event-clear",
      sourcePath: path,
      sourceLine: line,
    };
  }
  if (hasBit && hasReset && !hasSet && primaryBit === primaryReset) {
    return {
      name,
      action: "check-reset",
      eventParameterIndexes: [primaryBit],
      zeroMeaning: "event-clear",
      sourcePath: path,
      sourceLine: line,
    };
  }
  if (hasBit && !hasSet && !hasReset) {
    return {
      name,
      action: "check",
      eventParameterIndexes: [primaryBit],
      zeroMeaning: "event-clear",
      sourcePath: path,
      sourceLine: line,
    };
  }
  if (hasSet && !hasReset && primarySet !== undefined) {
    return {
      name,
      action: "set",
      eventParameterIndexes: [primarySet],
      sourcePath: path,
      sourceLine: line,
    };
  }
  if (hasReset && !hasSet && primaryReset !== undefined) {
    return {
      name,
      action: "reset",
      eventParameterIndexes: [primaryReset],
      sourcePath: path,
      sourceLine: line,
    };
  }
  return null;
}

interface MacroSource {
  name: string;
  path: string;
  line: number;
  body: string[];
}

function nestedMutationSemantic(
  macro: MacroSource,
  known: Map<string, ProjectEventMacroSemantic>,
): ProjectEventMacroSemantic | null {
  const clean = macro.body.map(withoutComment).filter(Boolean);
  const nested: Array<{
    semantic: ProjectEventMacroSemantic;
    parameters: number[];
  }> = [];

  for (const sourceLine of clean) {
    const invocation = sourceLine.match(
      /^([A-Za-z_][A-Za-z0-9_#@.]*)\s+(.+)$/,
    );
    if (!invocation) continue;
    const semantic = known.get(invocation[1].toLowerCase());
    if (!semantic) continue;
    if (semantic.action !== "set" && semantic.action !== "reset") continue;
    nested.push({
      semantic,
      parameters: parametersInLine(invocation[2]),
    });
  }

  if (nested.length < 2) return null;
  const actions = new Set(nested.map((entry) => entry.semantic.action));
  if (actions.size !== 1) return null;
  const parameters = [...new Set(nested.flatMap((entry) => entry.parameters))]
    .sort((left, right) => left - right);
  if (parameters.length === 0) return null;

  const action = nested[0].semantic.action === "set"
    ? "set-many" as const
    : "reset-many" as const;
  return {
    name: macro.name,
    action,
    eventParameterIndexes: parameters,
    sourcePath: macro.path,
    sourceLine: macro.line,
  };
}


export function deriveProjectEventMacroSemantics(
  files: ProjectRgbdsSourceFile[],
): ProjectEventMacroSemantic[] {
  const macros: MacroSource[] = [];

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

      macros.push({
        name: start[1],
        path: file.path,
        line: index + 1,
        body,
      });
      index = end;
    }
  }

  const known = new Map<string, ProjectEventMacroSemantic>();
  for (const macro of macros) {
    const semantic = directSemanticFromBody(
      macro.name,
      macro.path,
      macro.line,
      macro.body,
    );
    if (semantic && !known.has(semantic.name.toLowerCase())) {
      known.set(semantic.name.toLowerCase(), semantic);
    }
  }

  for (let pass = 0; pass < 4; pass += 1) {
    let progress = false;
    for (const macro of macros) {
      if (known.has(macro.name.toLowerCase())) continue;
      const semantic = nestedMutationSemantic(macro, known);
      if (!semantic) continue;
      known.set(macro.name.toLowerCase(), semantic);
      progress = true;
    }
    if (!progress) break;
  }

  return [...known.values()].sort(
    (left, right) => left.name.localeCompare(right.name),
  );
}
