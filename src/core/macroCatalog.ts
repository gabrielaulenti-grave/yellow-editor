import { projectConstantCatalogFromSources, type ProjectRgbdsSourceFile } from "./projectConstants";
import type {
  MacroCatalog,
  MacroDefinitionSummary,
  MacroInferenceConfidence,
  MacroParameterKind,
  MacroParameterSourceRole,
  MacroParameterSummary,
  ProjectSemanticDomain,
  ProjectSemanticDomainCatalog,
  ProjectSource,
  SemanticDomainMatch,
  ScriptMacroArgument,
  ScriptMacroCall,
  ScriptMacroCallDocument,
} from "./types";

interface MacroDefinitionInternal {
  name: string;
  path: string;
  startLine: number;
  endLine: number;
  body: string[];
  parameterCount: number;
  usageHints: Map<number, MacroParameterKind[]>;
  producedSymbols: Map<number, "label" | "constant">;
  sourceRoles: Map<number, MacroParameterSourceRole>;
  addressDivisors: Map<number, number[]>;
  remainders: Map<number, number[]>;
  byteExpressions: Array<{ destination: string; expression: string }>;
  nestedBindings: Array<{
    parentParameter: number;
    macroName: string;
    childParameter: number;
  }>;
}

interface ParameterObservations {
  values: string[];
  kinds: MacroParameterKind[];
  domains: string[][];
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

function parseDefinitions(file: ProjectRgbdsSourceFile): MacroDefinitionInternal[] {
  const lines = file.contents.split(/\r?\n/);
  const result: MacroDefinitionInternal[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const clean = withoutComment(lines[index]);
    const start = clean.match(/^MACRO\??\s+([A-Za-z_][A-Za-z0-9_#@.]*)\b/i);
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
    const sourceRoles = new Map<number, MacroParameterSourceRole>();
    const addressDivisors = new Map<number, number[]>();
    const remainders = new Map<number, number[]>();
    const cleanBody = body.map(withoutComment);
    const hasDispatch = cleanBody.some((line) => /^(?:call|jp|jr|rst)\b/i.test(line));

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
        if (new RegExp(`^(?:call|jp|jr)\\s+(?:(?:z|nz|c|nc)\\s*,\\s*)?${escaped}(?:\\s|$)`, "i").test(bodyLine)) {
          sourceRoles.set(parameter, "routine-target");
        } else if (new RegExp(`${escaped}[A-Za-z_]`).test(bodyLine)) {
          sourceRoles.set(parameter, "computed-symbol");
        } else if (
          hasDispatch
          && new RegExp(`\\bBANK\\(\\s*${escaped}\\s*\\)`, "i").test(bodyLine)
          && cleanBody.some((line) => new RegExp(`^ld\\s+(?:hl|de|bc)\\s*,\\s*${escaped}\\s*$`, "i").test(line))
        ) {
          sourceRoles.set(parameter, "routine-target");
        }
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

    for (let parameter = 1; parameter <= parameterCount; parameter += 1) {
      const escaped = escapeRegex("\\" + String(parameter));
      const uses = cleanBody.filter((line) => new RegExp(escaped).test(line));
      for (const use of uses) {
        const declaration = use.match(new RegExp(`^DEF\\s+([A-Za-z_][A-Za-z0-9_]*)\\s*=\\s*\\(?\\s*${escaped}\\s*\\)?\\s*%\\s*(\\d+)\\s*$`, "i"));
        if (declaration && cleanBody.some((line) => new RegExp(`^ASSERT\\s+${escapeRegex(declaration[1])}\\s*==`, "i").test(line))) {
          remainders.set(parameter, [...new Set([...(remainders.get(parameter) ?? []), Number(declaration[2])])]);
        }
      }
      if (!sourceRoles.has(parameter) && uses.length > 0
        && uses.every((line) => /^(?:DEF|REDEF|IF|ELIF|ASSERT|FOR|REPT)\b/i.test(line))) {
        sourceRoles.set(parameter, "assembly-control");
      }
      // A register-held address is an input contract when the macro only emits
      // a bit operation and does not load that register itself. Preserve the
      // address group while allowing a different bit in the same group.
      for (const register of ["hl", "de", "bc"]) {
        if (cleanBody.some((line) => new RegExp(`^ld\\s+${register}\\s*,`, "i").test(line))) continue;
        const operations = uses.filter((line) => new RegExp(`^(?:bit|set|res)\\b.*\\[${register}\\]`, "i").test(line));
        for (const operation of operations) {
          const divisor = operation.match(new RegExp(`${escaped}\\s*\\)?\\s*%\\s*(\\d+)`))?.[1];
          if (divisor && Number(divisor) > 0) {
            addressDivisors.set(parameter, [...new Set([...(addressDivisors.get(parameter) ?? []), Number(divisor)])]);
          }
        }
      }
      if (!sourceRoles.has(parameter)
        && uses.some((line) => new RegExp(`${escaped}\\s*\\)?\\s*%\\s*\\d+`).test(line)
          && new RegExp(`-\\s*\\(?\\s*${escaped}`).test(line))) {
        sourceRoles.set(parameter, "assembly-control");
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
      sourceRoles,
      addressDivisors,
      remainders,
      byteExpressions: cleanBody.flatMap((line) => {
        const match = line.match(/^ld\s+([abcdehl]|\\[1-9])\s*,\s*(.+)$/i);
        return match && match[2].includes("%") && parameterReferences(match[2], 0).length > 1
          ? [{ destination: match[1], expression: match[2] }] : [];
      }),
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

function collectProjectSymbols(files: ProjectRgbdsSourceFile[]): {
  labels: Set<string>;
  constants: Set<string>;
} {
  const labels = new Set<string>();
  const constants = new Set<string>();

  for (const file of files) {
    for (const sourceLine of file.contents.split(/\r?\n/)) {
      const line = withoutComment(sourceLine);
      const label = line.match(/^((?:\.[A-Za-z_]|[A-Za-z_])[A-Za-z0-9_.]*):{1,2}(?:\s|$)/);
      if (label) labels.add(label[1]);

      const def = line.match(/^DEF\s+([A-Za-z_][A-Za-z0-9_.]*)\s+(?:EQU|EQUS|RB|RW|RL)\b/i);
      if (def) constants.add(def[1]);

      const equ = line.match(/^([A-Za-z_][A-Za-z0-9_.]*)\s+(?:EQU|EQUS)\b/i);
      if (equ) constants.add(equ[1]);
    }
  }

  return { labels, constants };
}

function buildSemanticIndex(
  catalog: ProjectSemanticDomainCatalog,
): Map<string, ProjectSemanticDomain[]> {
  const result = new Map<string, ProjectSemanticDomain[]>();
  for (const domain of catalog.domains) {
    for (const option of domain.options) {
      const existing = result.get(option.value) ?? [];
      existing.push(domain);
      result.set(option.value, existing);
    }
  }
  return result;
}

function sourceFileTitle(path: string): string {
  const fileName = path.split("/").pop()?.replace(/\.(?:asm|inc)$/i, "") ?? path;
  return fileName
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function sourceDomainLabel(path: string): string {
  const title = sourceFileTitle(path);
  return /\bconstants?\b/i.test(title) ? title : title + " constants";
}

function sourceLabelDomainLabel(path: string): string {
  return sourceFileTitle(path) + " labels";
}

function simpleSymbol(value: string): string | null {
  const trimmed = value.trim();
  return /^(?:\.[A-Za-z_]|[A-Za-z_])[A-Za-z0-9_.]*$/.test(trimmed)
    ? trimmed
    : null;
}

function collectSourceConstantDomains(
  files: ProjectRgbdsSourceFile[],
  ranges: Map<string, Array<{ startLine: number; endLine: number }>>,
  definitions: Map<string, MacroDefinitionInternal>,
  baseCatalog: ProjectSemanticDomainCatalog,
): ProjectSemanticDomain[] {
  const coveredValues = new Set(
    baseCatalog.domains.flatMap((domain) => domain.options.map((option) => option.value)),
  );
  const byPath = new Map<string, Set<string>>();

  function add(path: string, value: string | null): void {
    if (!value || coveredValues.has(value)) return;
    const group = byPath.get(path) ?? new Set<string>();
    group.add(value);
    byPath.set(path, group);
  }

  for (const file of files) {
    const lines = file.contents.split(/\r?\n/);
    lines.forEach((sourceLine, index) => {
      const lineNumber = index + 1;
      if (lineIsInsideDefinition(ranges.get(file.path), lineNumber)) return;
      const line = withoutComment(sourceLine);
      if (!line) return;

      const def = line.match(/^DEF\s+((?:\.[A-Za-z_]|[A-Za-z_])[A-Za-z0-9_.]*)\s+(?:EQU|EQUS|RB|RW|RL)\b/i);
      if (def) add(file.path, def[1]);

      const equ = line.match(/^((?:\.[A-Za-z_]|[A-Za-z_])[A-Za-z0-9_.]*)\s+(?:EQU|EQUS)\b/i);
      if (equ) add(file.path, equ[1]);

      const call = line.match(/^([A-Za-z_][A-Za-z0-9_#@.]*)\b(?:\s+(.*))?$/);
      if (!call) return;
      const definition = definitions.get(call[1].toLowerCase());
      if (!definition || definition.producedSymbols.size === 0) return;

      const values = call[2] ? splitArguments(call[2]) : [];
      for (const [parameter, kind] of definition.producedSymbols) {
        if (kind !== "constant") continue;
        add(file.path, simpleSymbol(values[parameter - 1] ?? ""));
      }
    });
  }

  return [...byPath.entries()]
    .map(([path, values]): ProjectSemanticDomain => ({
      id: "source-constants:" + path,
      label: sourceDomainLabel(path),
      kind: "constant-family",
      sourcePath: path,
      options: [...values]
        .sort((left, right) => left.localeCompare(right))
        .map((value) => ({ value, label: value })),
    }))
    .filter((domain) => domain.options.length > 1)
    .sort((left, right) =>
      left.label.localeCompare(right.label)
      || (left.sourcePath ?? "").localeCompare(right.sourcePath ?? ""));
}

function collectSourceLabelDomains(
  files: ProjectRgbdsSourceFile[],
  ranges: Map<string, Array<{ startLine: number; endLine: number }>>,
  definitions: Map<string, MacroDefinitionInternal>,
): ProjectSemanticDomain[] {
  const byPath = new Map<string, Set<string>>();

  function add(path: string, value: string | null): void {
    if (!value || value.startsWith(".")) return;
    const group = byPath.get(path) ?? new Set<string>();
    group.add(value);
    byPath.set(path, group);
  }

  for (const file of files) {
    const lines = file.contents.split(/\r?\n/);
    lines.forEach((sourceLine, index) => {
      const lineNumber = index + 1;
      if (lineIsInsideDefinition(ranges.get(file.path), lineNumber)) return;
      const line = withoutComment(sourceLine);
      if (!line) return;

      const direct = line.match(/^([A-Za-z_][A-Za-z0-9_.]*):{1,2}(?:\s|$)/);
      if (direct) add(file.path, direct[1]);

      const call = line.match(/^([A-Za-z_][A-Za-z0-9_#@.]*)\b(?:\s+(.*))?$/);
      if (!call) return;
      const definition = definitions.get(call[1].toLowerCase());
      if (!definition || definition.producedSymbols.size === 0) return;

      const values = call[2] ? splitArguments(call[2]) : [];
      for (const [parameter, kind] of definition.producedSymbols) {
        if (kind !== "label") continue;
        add(file.path, simpleSymbol(values[parameter - 1] ?? ""));
      }
    });
  }

  return [...byPath.entries()]
    .map(([path, values]): ProjectSemanticDomain => ({
      id: "source-labels:" + path,
      label: sourceLabelDomainLabel(path),
      kind: "label-family",
      sourcePath: path,
      options: [...values]
        .sort((left, right) => left.localeCompare(right))
        .map((value) => ({ value, label: value })),
    }))
    .filter((domain) => domain.options.length > 1)
    .sort((left, right) =>
      left.label.localeCompare(right.label)
      || (left.sourcePath ?? "").localeCompare(right.sourcePath ?? ""));
}

function semanticMatchesFor(
  raw: string,
  index: Map<string, ProjectSemanticDomain[]>,
): SemanticDomainMatch[] {
  const value = raw.trim();
  const domains = index.get(value) ?? [];
  const confidence: MacroInferenceConfidence = domains.length === 1 ? "high" : "medium";
  return domains.map((domain) => ({
    domainId: domain.id,
    domainLabel: domain.label,
    domainKind: domain.kind,
    confidence,
    evidence: [`exact value found in the loaded project's ${domain.label} index`],
  }));
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
  if (/^(?:\.[A-Za-z_]|[A-Za-z_])[A-Za-z0-9_.]*$/.test(value)) {
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
  semanticIndex: Map<string, ProjectSemanticDomain[]>,
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
      semanticDomains: semanticMatchesFor(raw, semanticIndex),
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
      params.push({ values: [], kinds: [], domains: [] });
    }
    const slot = params[argument.index - 1];
    if (slot.values.length < 8 && !slot.values.includes(argument.raw)) {
      slot.values.push(argument.raw);
    }
    slot.kinds.push(argument.inferredKind);
    slot.domains.push(argument.semanticDomains.map((domain) => domain.domainId));
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
  files: ProjectRgbdsSourceFile[],
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
        if (!value || !/^(?:\.[A-Za-z_]|[A-Za-z_])[A-Za-z0-9_.]*$/.test(value)) continue;
        if (kind === "label") labels.add(value);
        else constants.add(value);
      }
    });
  }
}

function confidenceRank(value: MacroInferenceConfidence): number {
  return value === "high" ? 3 : value === "medium" ? 2 : 1;
}

function strongerConfidence(
  left: MacroInferenceConfidence,
  right: MacroInferenceConfidence,
): MacroInferenceConfidence {
  return confidenceRank(left) >= confidenceRank(right) ? left : right;
}

function inferSemanticDomains(
  slot: ParameterObservations,
  catalog: ProjectSemanticDomainCatalog,
): SemanticDomainMatch[] {
  if (slot.domains.length === 0) return [];

  const counts = new Map<string, number>();
  for (const memberships of slot.domains) {
    for (const domainId of new Set(memberships)) {
      counts.set(domainId, (counts.get(domainId) ?? 0) + 1);
    }
  }

  const total = slot.domains.length;
  return [...counts.entries()]
    .filter(([, count]) => count / total >= 0.5)
    .flatMap(([domainId, count]) => {
      const domain = catalog.domains.find((candidate) => candidate.id === domainId);
      if (!domain) return [];
      const ratio = count / total;
      const confidence: MacroInferenceConfidence =
        ratio === 1 && total >= 2
          ? "high"
          : ratio >= 0.75
            ? "medium"
            : "low";
      return [{
        domainId: domain.id,
        domainLabel: domain.label,
        domainKind: domain.kind,
        confidence,
        evidence: [
          `${count} of ${total} observed project call value${total === 1 ? "" : "s"} match the ${domain.label} domain`,
        ],
      }];
    })
    .sort((left, right) =>
      confidenceRank(right.confidence) - confidenceRank(left.confidence)
      || left.domainLabel.localeCompare(right.domainLabel));
}

function mergeSemanticDomains(
  direct: SemanticDomainMatch[],
  nested: SemanticDomainMatch[],
): SemanticDomainMatch[] {
  const merged = new Map<string, SemanticDomainMatch>();
  for (const candidate of [...direct, ...nested]) {
    const existing = merged.get(candidate.domainId);
    if (!existing) {
      merged.set(candidate.domainId, {
        ...candidate,
        evidence: [...candidate.evidence],
      });
      continue;
    }
    existing.confidence = strongerConfidence(existing.confidence, candidate.confidence);
    existing.evidence = [...new Set([...existing.evidence, ...candidate.evidence])];
  }
  return [...merged.values()].sort((left, right) =>
    confidenceRank(right.confidence) - confidenceRank(left.confidence)
    || left.domainLabel.localeCompare(right.domainLabel));
}

function summarizeParameters(
  definition: MacroDefinitionInternal,
  observations: Map<string, ParameterObservations[]>,
  argumentCounts: Map<string, number[]>,
  summaries: Map<string, MacroDefinitionSummary>,
  semanticCatalog: ProjectSemanticDomainCatalog,
): MacroParameterSummary[] {
  const key = definition.name.toLowerCase();
  const observed = observations.get(key) ?? [];
  const counts = argumentCounts.get(key) ?? [];
  const minimumArguments = counts.length > 0 ? Math.min(...counts) : null;
  const parameterCount = Math.max(definition.parameterCount, observed.length);
  const result: MacroParameterSummary[] = [];

  for (let index = 1; index <= parameterCount; index += 1) {
    const slot = observed[index - 1] ?? { values: [], kinds: [], domains: [] };
    const hints = definition.usageHints.get(index) ?? [];
    const nestedKinds: MacroParameterKind[] = [];
    const nestedEvidence: string[] = [];
    const nestedDomains: SemanticDomainMatch[] = [];
    let sourceRole: MacroParameterSourceRole = definition.producedSymbols.has(index)
      ? "symbol-definition"
      : definition.sourceRoles.get(index) ?? "value";
    if (sourceRole === "value" && definition.producedSymbols.size > 0
      && definition.usageHints.get(index)?.includes("expression")) {
      sourceRole = "structural-reference";
    }
    const preserveAddressDivisors = new Set(definition.addressDivisors.get(index) ?? []);
    const preserveRemainders = new Set(definition.remainders.get(index) ?? []);

    for (const binding of definition.nestedBindings.filter(
      (candidate) => candidate.parentParameter === index,
    )) {
      const child = summaries.get(binding.macroName.toLowerCase());
      const parameter = child?.parameters[binding.childParameter - 1];
      if (sourceRole === "value" && parameter?.sourceRole && parameter.sourceRole !== "value") {
        sourceRole = parameter.sourceRole;
      }
      for (const divisor of parameter?.preserveAddressDivisors ?? []) preserveAddressDivisors.add(divisor);
      for (const divisor of parameter?.preserveRemainders ?? []) preserveRemainders.add(divisor);
      if (parameter && parameter.inferredKind !== "unknown") {
        nestedKinds.push(parameter.inferredKind);
        nestedEvidence.push(
          "passed to " + binding.macroName + " argument " + String(binding.childParameter),
        );
        for (const domain of parameter.semanticDomains) {
          nestedDomains.push({
            ...domain,
            evidence: [
              ...domain.evidence,
              "inherited through " + binding.macroName + " argument " + String(binding.childParameter),
            ],
          });
        }
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
    if (sourceRole !== "value") evidence.push(`project macro uses this argument as ${sourceRole}`);
    const semanticDomains = mergeSemanticDomains(
      inferSemanticDomains(slot, semanticCatalog),
      nestedDomains,
    );

    result.push({
      index,
      displayName: "Argument " + String(index),
      required: minimumArguments === null ? index <= definition.parameterCount : minimumArguments >= index,
      inferredKind: merged.kind,
      confidence: merged.confidence,
      examples: slot.values,
      evidence,
      semanticDomains,
      sourceRole,
      preserveAddressDivisors: [...preserveAddressDivisors],
      preserveRemainders: [...preserveRemainders],
    });
  }

  return result;
}

function buildSummaries(
  definitions: MacroDefinitionInternal[],
  observations: Map<string, ParameterObservations[]>,
  callCounts: Map<string, number>,
  argumentCounts: Map<string, number[]>,
  semanticCatalog: ProjectSemanticDomainCatalog,
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
      byteExpressions: definition.byteExpressions,
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
        semanticCatalog,
      );
      const expressions = [...definition.byteExpressions];
      let shift = 0;
      for (const sourceLine of definition.body) {
        const line = withoutComment(sourceLine);
        const count = shiftCount(line);
        if (count !== null) { shift += count; continue; }
        const invocation = line.match(/^([A-Za-z_][A-Za-z0-9_#@.]*)\b(?:\s+(.*))?$/);
        const child = invocation ? summaries.get(invocation[1].toLowerCase()) : undefined;
        if (!child?.byteExpressions?.length) continue;
        const values = splitArguments(invocation?.[2] ?? "").map((value) => value.replace(/\\([1-9])/g, (_, index) => `\\${Number(index) + shift}`));
        for (const expression of child.byteExpressions) {
          if ([...expression.expression.matchAll(/\\([1-9])/g)].some((match) => values[Number(match[1]) - 1] === undefined)) continue;
          expressions.push({
            destination: expression.destination.replace(/\\([1-9])/g, (_, index) => values[Number(index) - 1] ?? ""),
            expression: expression.expression.replace(/\\([1-9])/g, (_, index) => `(${values[Number(index) - 1]})`),
          });
        }
      }
      summary.byteExpressions = expressions.filter((expression, index) => expressions.findIndex((candidate) => candidate.destination === expression.destination && candidate.expression === expression.expression) === index);
    }
  }

  return [...summaries.values()].sort(
    (left, right) => left.name.localeCompare(right.name)
      || left.path.localeCompare(right.path)
      || left.startLine - right.startLine,
  );
}

function labelSignatures(files: ProjectRgbdsSourceFile[], definitions: Map<string, MacroDefinitionInternal>): Record<string, string> {
  const signatures: Record<string, string> = {};
  const cpuInstruction = /^(?:ldh?|call|jp|jr|ret[i]?|rst|push|pop|bit|set|res|inc|dec|xor|and|or|cp|nop|halt|stop|di|ei|add|adc|sub|sbc|rlca|rrca|rla|rra|rl|rr|sla|sra|srl|swap|daa|cpl|scf|ccf)\b/i;
  function containsInstructions(line: string, seen = new Set<string>()): boolean {
    if (cpuInstruction.test(line)) return true;
    const opcode = line.match(/^([A-Za-z_][A-Za-z0-9_#@.]*)\b/)?.[1].toLowerCase();
    const macro = opcode ? definitions.get(opcode) : undefined;
    if (!macro || seen.has(macro.name)) return false;
    const nextSeen = new Set([...seen, macro.name]);
    return macro.body.some((line) => containsInstructions(withoutComment(line), nextSeen));
  }
  for (const file of files) {
    const lines = file.contents.split(/\r?\n/);
    const starts = lines.flatMap((line, index) => {
      const label = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*):{1,2}\s*(?:;.*)?$/)?.[1];
      return label ? [{ label, index }] : [];
    });
    for (let index = starts.length - 1; index >= 0; index--) {
      const entry = starts[index];
      const code = lines.slice(entry.index + 1, starts[index + 1]?.index ?? lines.length)
        .map(withoutComment).filter((line) => line && !/^\.[\w.]+:{0,2}$/.test(line));
      let signature = "unknown";
      if (code.length === 0) signature = signatures[starts[index + 1]?.label] ?? "unknown";
      else if (code.some((line) => containsInstructions(line))) signature = "executable";
      else {
        const opcode = code[0].match(/^([A-Za-z_][A-Za-z0-9_#@.]*)\b/)?.[1].toLowerCase();
        const macro = opcode ? definitions.get(opcode) : null;
        if (macro) signature = `macro-data:${macro.path}`;
        else if (/^db\s+"/.test(code[0])) signature = "string-data";
        else if (/^(?:db|dw|dl)\b/i.test(code[0])) signature = `data:${opcode}`;
      }
      signatures[entry.label] = signatures[entry.label] && signatures[entry.label] !== signature ? "unknown" : signature;
    }
  }
  return signatures;
}

export async function loadMacroAnalysis(
  source: ProjectSource,
  semanticCatalogInput: ProjectSemanticDomainCatalog | Promise<ProjectSemanticDomainCatalog>,
  sourceFilesInput?: ProjectRgbdsSourceFile[] | Promise<ProjectRgbdsSourceFile[]>,
): Promise<MacroAnalysis> {
  const semanticCatalogPromise = Promise.resolve(semanticCatalogInput);
  const warnings: string[] = [];
  let readableFiles: ProjectRgbdsSourceFile[];

  if (sourceFilesInput) {
    const snapshot = [...await Promise.resolve(sourceFilesInput)]
      .filter((file) => isRgbdsSourcePath(file.path))
      .sort((left, right) => left.path.localeCompare(right.path));
    for (const file of snapshot) {
      if (file.readError) {
        warnings.push("Could not inspect " + file.path + ": " + file.readError);
      }
    }
    readableFiles = snapshot.filter((file) => !file.readError);
  } else {
    if (!source.listFiles) {
      throw new Error(
        "This project source cannot enumerate RGBDS source files. Reopen the project with a current Yellow Editor workspace.",
      );
    }
    const paths = [...new Set(await source.listFiles())]
      .filter(isRgbdsSourcePath)
      .sort((left, right) => left.localeCompare(right));
    const files = new Array<ProjectRgbdsSourceFile | null>(paths.length).fill(null);
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
    readableFiles = files.filter(
      (file): file is ProjectRgbdsSourceFile => file !== null,
    );
  }
  const baseSemanticCatalog = await semanticCatalogPromise;
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
  const semanticCatalog: ProjectSemanticDomainCatalog = {
    domains: [
      ...baseSemanticCatalog.domains,
      ...collectSourceConstantDomains(
        readableFiles,
        ranges,
        byName,
        baseSemanticCatalog,
      ),
      ...collectSourceLabelDomains(
        readableFiles,
        ranges,
        byName,
      ),
    ],
    warnings: baseSemanticCatalog.warnings,
  };
  const semanticIndex = buildSemanticIndex(semanticCatalog);
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
        semanticIndex,
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

  const macros = buildSummaries(
    definitions,
    observations,
    callCounts,
    argumentCounts,
    semanticCatalog,
  );
  return {
    catalog: {
      macros,
      sourceFileCount: readableFiles.length,
      scriptFileCount: readableFiles.filter((file) => isScriptPath(file.path)).length,
      definitionCount: macros.length,
      callCount,
      warnings,
      domains: semanticCatalog.domains,
      domainWarnings: semanticCatalog.warnings,
      numericConstants: Object.fromEntries(projectConstantCatalogFromSources(readableFiles).constants
        .map((constant) => [constant.symbol, constant.value])),
      labelSignatures: labelSignatures(readableFiles, byName),
    },
    callsByScriptPath,
  };
}
