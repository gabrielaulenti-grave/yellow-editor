import type {
  MacroCatalog,
  MacroDefinitionSummary,
  MacroInferenceConfidence,
  MacroParameterKind,
  MacroParameterSummary,
  ProjectSource,
  ScriptMacroArgument,
  ScriptMacroCall,
  ScriptMacroCallDocument,
} from "./types";

interface SourceFile {
  path: string;
  contents: string;
}

interface MacroDefinitionInternal {
  name: string;
  path: string;
  startLine: number;
  endLine: number;
  body: string[];
  parameterCount: number;
  usageHints: Map<number, MacroParameterKind[]>;
  producedSymbols: Map<number, "label" | "constant">;
  nestedBindings: Array<{
    parentParameter: number;
    macroName: string;
    childParameter: number;
  }>;
}

interface ParameterObservations {
  values: string[];
  kinds: MacroParameterKind[];
}

export interface MacroAnalysis {
  catalog: MacroCatalog;
  callsByScriptPath: Map<string, ScriptMacroCallDocument>;
}

function isRgbdsSourcePath(path: string): boolean {
  return /\.(?:asm|inc)$/i.test(path);
}

function isScriptPath(path: string): boolean {
  return /^scripts\/.+\.asm$/i.test(path);
}

function withoutComment(line: string): string {
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
    if (char === "\"") {
      quoted = !quoted;
      continue;
    }
    if (char === ";" && !quoted) {
      return line.slice(0, index).trim();
    }
  }
  return line.trim();
}

function splitArguments(value: string): string[] {
  if (!value.trim()) return [];

  const result: string[] = [];
  let start = 0;
  let quoted = false;
  let escaped = false;
  let depth = 0;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
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
      result.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }

  result.push(value.slice(start).trim());
  return result;
}

function parameterReferences(line: string, shift: number): number[] {
  return [...line.matchAll(/\\([1-9])/g)].map(
    (match) => shift + Number(match[1]),
  );
}

function shiftCount(line: string): number | null {
  const match = line.match(/^\s*SHIFT(?:\s+(\d+))?\s*$/i);
  if (!match) return null;
  return match[1] ? Number(match[1]) : 1;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&");
}

function usageKind(line: string, token: string): MacroParameterKind | null {
  const escaped = escapeRegex(token);
  if (new RegExp("\\b(?:call|jp|jr)\\s+" + escaped + "\\b", "i").test(line)) {
    return "label";
  }
  if (new RegExp("\\bINCLUDE\\s+" + escaped + "\\b", "i").test(line)) {
    return "string";
  }
  if (new RegExp("\\b(?:db|dw|dl)\\s+.*" + escaped, "i").test(line)) {
    return "expression";
  }
  if (new RegExp("\\b(?:ld|cp|and|or|xor|add|adc|sub|sbc)\\b.*" + escaped, "i").test(line)) {
    return "expression";
  }
  return null;
}

function parseDefinitions(file: SourceFile): MacroDefinitionInternal[] {
  const lines = file.contents.split(/\r?\n/);
  const result: MacroDefinitionInternal[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const clean = withoutComment(lines[index]);
    const start = clean.match(/^MACRO\s+([A-Za-z_][A-Za-z0-9_#@.]*)\b/i);
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

    let shift = 0;
    let parameterCount = 0;
    const usageHints = new Map<number, MacroParameterKind[]>();
    const producedSymbols = new Map<number, "label" | "constant">();

    for (const sourceLine of body) {
      const bodyLine = withoutComment(sourceLine);
      const count = shiftCount(bodyLine);
      if (count !== null) {
        shift += count;
        continue;
      }

      for (const parameter of parameterReferences(bodyLine, shift)) {
        parameterCount = Math.max(parameterCount, parameter);
        const localIndex = parameter - shift;
        const token = "\\" + String(localIndex);
        const escaped = escapeRegex(token);
        if (new RegExp("^\\s*" + escaped + ":{1,2}(?:\\s|$)").test(bodyLine)) {
          producedSymbols.set(parameter, "label");
        } else if (
          new RegExp("^\\s*DEF\\s+" + escaped + "\\s+", "i").test(bodyLine)
          || new RegExp("^\\s*" + escaped + "\\s+(?:EQU|EQUS)\\b", "i").test(bodyLine)
        ) {
          producedSymbols.set(parameter, "constant");
        }
        const hint = usageKind(bodyLine, token);
        if (hint) {
          const list = usageHints.get(parameter) ?? [];
          list.push(hint);
          usageHints.set(parameter, list);
        }
      }
    }

    result.push({
      name: start[1],
      path: file.path,
      startLine: index + 1,
      endLine: end + 1,
      body,
      parameterCount,
      usageHints,
      producedSymbols,
      nestedBindings: [],
    });
    index = end;
  }

  return result;
}

function definitionRanges(
  definitions: MacroDefinitionInternal[],
): Map<string, Array<{ startLine: number; endLine: number }>> {
  const result = new Map<string, Array<{ startLine: number; endLine: number }>>();
  for (const definition of definitions) {
    const ranges = result.get(definition.path) ?? [];
    ranges.push({ startLine: definition.startLine, endLine: definition.endLine });
    result.set(definition.path, ranges);
  }
  return result;
}

function lineIsInsideDefinition(
  ranges: Array<{ startLine: number; endLine: number }> | undefined,
  line: number,
): boolean {
  return ranges?.some((range) => line >= range.startLine && line <= range.endLine) ?? false;
}

function collectProjectSymbols(files: SourceFile[]): {
  labels: Set<string>;
  constants: Set<string>;
} {
  const labels = new Set<string>();
  const constants = new Set<string>();

  for (const file of files) {
    for (const sourceLine of file.contents.split(/\r?\n/)) {
      const line = withoutComment(sourceLine);
      const label = line.match(/^([A-Za-z_][A-Za-z0-9_.]*):{1,2}(?:\s|$)/);
      if (label) labels.add(label[1]);

      const def = line.match(/^DEF\s+([A-Za-z_][A-Za-z0-9_.]*)\s+(?:EQU|EQUS|RB|RW|RL)\b/i);
      if (def) constants.add(def[1]);

      const equ = line.match(/^([A-Za-z_][A-Za-z0-9_.]*)\s+(?:EQU|EQUS)\b/i);
      if (equ) constants.add(equ[1]);
    }
  }

  return { labels, constants };
}

function classifyArgument(
  raw: string,
  labels: Set<string>,
  constants: Set<string>,
): { kind: MacroParameterKind; confidence: MacroInferenceConfidence } {
  const value = raw.trim();
  if (!value) return { kind: "unknown", confidence: "low" };
  if (/^"(?:[^"\\]|\\.)*"$/.test(value)) {
    return { kind: "string", confidence: "high" };
  }
  if (/^(?:-?\d+|\$[0-9a-f]+|%[01]+)$/i.test(value)) {
    return { kind: "number", confidence: "high" };
  }
  if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(value)) {
    if (labels.has(value)) return { kind: "label", confidence: "high" };
    if (constants.has(value)) return { kind: "constant", confidence: "high" };
    return { kind: "symbol", confidence: "medium" };
  }
  return { kind: "expression", confidence: "medium" };
}

function parseCall(
  path: string,
  sourceLine: string,
  line: number,
  definitions: Map<string, MacroDefinitionInternal>,
  labels: Set<string>,
  constants: Set<string>,
): ScriptMacroCall | null {
  const clean = withoutComment(sourceLine);
  if (!clean || /^[.@A-Za-z_][A-Za-z0-9_.@#]*:{1,2}(?:\s|$)/.test(clean)) {
    return null;
  }

  const match = clean.match(/^([A-Za-z_][A-Za-z0-9_#@.]*)\b(?:\s+(.*))?$/);
  if (!match) return null;
  const definition = definitions.get(match[1].toLowerCase());
  if (!definition) return null;

  const values = match[2] ? splitArguments(match[2]) : [];
  const args: ScriptMacroArgument[] = values.map((raw, index) => {
    const inferred = classifyArgument(raw, labels, constants);
    return {
      index: index + 1,
      raw,
      inferredKind: inferred.kind,
      confidence: inferred.confidence,
    };
  });

  return {
    name: definition.name,
    path,
    line,
    definitionPath: definition.path,
    definitionLine: definition.startLine,
    arguments: args,
  };
}

function observe(
  observations: Map<string, ParameterObservations[]>,
  call: ScriptMacroCall,
): void {
  const key = call.name.toLowerCase();
  const params = observations.get(key) ?? [];
  for (const argument of call.arguments) {
    while (params.length < argument.index) {
      params.push({ values: [], kinds: [] });
    }
    const slot = params[argument.index - 1];
    if (slot.values.length < 8 && !slot.values.includes(argument.raw)) {
      slot.values.push(argument.raw);
    }
    slot.kinds.push(argument.inferredKind);
  }
  observations.set(key, params);
}

function mergeKinds(kinds: MacroParameterKind[]): {
  kind: MacroParameterKind;
  confidence: MacroInferenceConfidence;
} {
  const meaningful = kinds.filter((kind) => kind !== "unknown");
  if (meaningful.length === 0) {
    return { kind: "unknown", confidence: "low" };
  }

  const unique = [...new Set(meaningful)];
  if (unique.length === 1) {
    return {
      kind: unique[0],
      confidence: meaningful.length > 1 ? "high" : "medium",
    };
  }

  if (unique.every((kind) => kind === "label" || kind === "symbol")) {
    return { kind: "symbol", confidence: "medium" };
  }
  if (unique.every((kind) => kind === "constant" || kind === "number" || kind === "expression")) {
    return { kind: "expression", confidence: "medium" };
  }
  return { kind: "unknown", confidence: "low" };
}

function addNestedBindings(
  definitions: MacroDefinitionInternal[],
  byName: Map<string, MacroDefinitionInternal>,
): void {
  for (const definition of definitions) {
    let shift = 0;
    for (const sourceLine of definition.body) {
      const line = withoutComment(sourceLine);
      const count = shiftCount(line);
      if (count !== null) {
        shift += count;
        continue;
      }

      const match = line.match(/^([A-Za-z_][A-Za-z0-9_#@.]*)\b(?:\s+(.*))?$/);
      if (!match || !byName.has(match[1].toLowerCase())) continue;
      const values = match[2] ? splitArguments(match[2]) : [];
      values.forEach((value, childIndex) => {
        const direct = value.match(/^\\([1-9])$/);
        if (!direct) return;
        definition.nestedBindings.push({
          parentParameter: shift + Number(direct[1]),
          macroName: match[1],
          childParameter: childIndex + 1,
        });
      });
    }
  }
}

function propagateProducedSymbols(
  definitions: MacroDefinitionInternal[],
  byName: Map<string, MacroDefinitionInternal>,
): void {
  for (let pass = 0; pass < 4; pass += 1) {
    for (const definition of definitions) {
      for (const binding of definition.nestedBindings) {
        const child = byName.get(binding.macroName.toLowerCase());
        const produced = child?.producedSymbols.get(binding.childParameter);
        if (produced && !definition.producedSymbols.has(binding.parentParameter)) {
          definition.producedSymbols.set(binding.parentParameter, produced);
        }
      }
    }
  }
}

function collectMacroProducedSymbols(
  files: SourceFile[],
  ranges: Map<string, Array<{ startLine: number; endLine: number }>>,
  definitions: Map<string, MacroDefinitionInternal>,
  labels: Set<string>,
  constants: Set<string>,
): void {
  for (const file of files) {
    const lines = file.contents.split(/\r?\n/);
    lines.forEach((sourceLine, index) => {
      const lineNumber = index + 1;
      if (lineIsInsideDefinition(ranges.get(file.path), lineNumber)) return;

      const clean = withoutComment(sourceLine);
      if (!clean || /^[.@A-Za-z_][A-Za-z0-9_.@#]*:{1,2}(?:\s|$)/.test(clean)) {
        return;
      }

      const match = clean.match(/^([A-Za-z_][A-Za-z0-9_#@.]*)\b(?:\s+(.*))?$/);
      if (!match) return;
      const definition = definitions.get(match[1].toLowerCase());
      if (!definition || definition.producedSymbols.size === 0) return;

      const values = match[2] ? splitArguments(match[2]) : [];
      for (const [parameter, kind] of definition.producedSymbols) {
        const value = values[parameter - 1]?.trim();
        if (!value || !/^[A-Za-z_][A-Za-z0-9_.]*$/.test(value)) continue;
        if (kind === "label") labels.add(value);
        else constants.add(value);
      }
    });
  }
}

function summarizeParameters(
  definition: MacroDefinitionInternal,
  observations: Map<string, ParameterObservations[]>,
  argumentCounts: Map<string, number[]>,
  summaries: Map<string, MacroDefinitionSummary>,
): MacroParameterSummary[] {
  const key = definition.name.toLowerCase();
  const observed = observations.get(key) ?? [];
  const counts = argumentCounts.get(key) ?? [];
  const minimumArguments = counts.length > 0 ? Math.min(...counts) : null;
  const parameterCount = Math.max(definition.parameterCount, observed.length);
  const result: MacroParameterSummary[] = [];

  for (let index = 1; index <= parameterCount; index += 1) {
    const slot = observed[index - 1] ?? { values: [], kinds: [] };
    const hints = definition.usageHints.get(index) ?? [];
    const nestedKinds: MacroParameterKind[] = [];
    const nestedEvidence: string[] = [];

    for (const binding of definition.nestedBindings.filter(
      (candidate) => candidate.parentParameter === index,
    )) {
      const child = summaries.get(binding.macroName.toLowerCase());
      const parameter = child?.parameters[binding.childParameter - 1];
      if (parameter && parameter.inferredKind !== "unknown") {
        nestedKinds.push(parameter.inferredKind);
        nestedEvidence.push(
          "passed to " + binding.macroName + " argument " + String(binding.childParameter),
        );
      }
    }

    const merged = mergeKinds([...slot.kinds, ...hints, ...nestedKinds]);
    const evidence: string[] = [];
    if (slot.kinds.length > 0) {
      evidence.push(
        String(slot.kinds.length) + " project call" + (slot.kinds.length === 1 ? "" : "s") + " observed",
      );
    }
    if (hints.length > 0) evidence.push("inferred from RGBDS instruction context");
    evidence.push(...nestedEvidence);

    result.push({
      index,
      displayName: "Argument " + String(index),
      required: minimumArguments === null ? index <= definition.parameterCount : minimumArguments >= index,
      inferredKind: merged.kind,
      confidence: merged.confidence,
      examples: slot.values,
      evidence,
    });
  }

  return result;
}

function buildSummaries(
  definitions: MacroDefinitionInternal[],
  observations: Map<string, ParameterObservations[]>,
  callCounts: Map<string, number>,
  argumentCounts: Map<string, number[]>,
): MacroDefinitionSummary[] {
  const summaries = new Map<string, MacroDefinitionSummary>();

  for (const definition of definitions) {
    summaries.set(definition.name.toLowerCase(), {
      name: definition.name,
      path: definition.path,
      startLine: definition.startLine,
      endLine: definition.endLine,
      parameters: [],
      callCount: callCounts.get(definition.name.toLowerCase()) ?? 0,
      nestedMacros: [...new Set(definition.nestedBindings.map((binding) => binding.macroName))],
    });
  }

  for (let pass = 0; pass < 4; pass += 1) {
    for (const definition of definitions) {
      const summary = summaries.get(definition.name.toLowerCase());
      if (!summary) continue;
      summary.parameters = summarizeParameters(
        definition,
        observations,
        argumentCounts,
        summaries,
      );
    }
  }

  return [...summaries.values()].sort(
    (left, right) => left.name.localeCompare(right.name)
      || left.path.localeCompare(right.path)
      || left.startLine - right.startLine,
  );
}

export async function loadMacroAnalysis(source: ProjectSource): Promise<MacroAnalysis> {
  if (!source.listFiles) {
    throw new Error(
      "This project source cannot enumerate RGBDS source files. Reopen the project with a current Yellow Editor workspace.",
    );
  }

  const paths = [...new Set(await source.listFiles())]
    .filter(isRgbdsSourcePath)
    .sort((left, right) => left.localeCompare(right));
  const files = new Array<SourceFile | null>(paths.length).fill(null);
  const warnings: string[] = [];
  let nextIndex = 0;
  const workerCount = Math.min(12, paths.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < paths.length) {
      const index = nextIndex;
      nextIndex += 1;
      const path = paths[index];
      try {
        files[index] = { path, contents: await source.readText(path) };
      } catch (error) {
        warnings.push("Could not inspect " + path + ": " + String(error));
      }
    }
  }));

  const readableFiles = files.filter((file): file is SourceFile => file !== null);
  const definitions = readableFiles.flatMap(parseDefinitions);
  const byName = new Map<string, MacroDefinitionInternal>();
  for (const definition of definitions) {
    const key = definition.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, definition);
    else warnings.push("Duplicate macro definition '" + definition.name + "' found at " + definition.path + ":" + String(definition.startLine) + ".");
  }

  addNestedBindings(definitions, byName);
  propagateProducedSymbols(definitions, byName);
  const ranges = definitionRanges(definitions);
  const symbols = collectProjectSymbols(readableFiles);
  collectMacroProducedSymbols(
    readableFiles,
    ranges,
    byName,
    symbols.labels,
    symbols.constants,
  );
  const observations = new Map<string, ParameterObservations[]>();
  const callCounts = new Map<string, number>();
  const argumentCounts = new Map<string, number[]>();
  const callsByScriptPath = new Map<string, ScriptMacroCallDocument>();
  let callCount = 0;

  for (const file of readableFiles) {
    const scriptCalls: ScriptMacroCall[] = [];
    const lines = file.contents.split(/\r?\n/);
    lines.forEach((sourceLine, index) => {
      const line = index + 1;
      if (lineIsInsideDefinition(ranges.get(file.path), line)) return;
      const call = parseCall(
        file.path,
        sourceLine,
        line,
        byName,
        symbols.labels,
        symbols.constants,
      );
      if (!call) return;

      callCount += 1;
      const key = call.name.toLowerCase();
      callCounts.set(key, (callCounts.get(key) ?? 0) + 1);
      const counts = argumentCounts.get(key) ?? [];
      counts.push(call.arguments.length);
      argumentCounts.set(key, counts);
      observe(observations, call);
      if (isScriptPath(file.path)) scriptCalls.push(call);
    });

    if (isScriptPath(file.path)) {
      callsByScriptPath.set(file.path, { path: file.path, calls: scriptCalls });
    }
  }

  const macros = buildSummaries(definitions, observations, callCounts, argumentCounts);
  return {
    catalog: {
      macros,
      sourceFileCount: readableFiles.length,
      scriptFileCount: readableFiles.filter((file) => isScriptPath(file.path)).length,
      definitionCount: macros.length,
      callCount,
      warnings,
    },
    callsByScriptPath,
  };
}
