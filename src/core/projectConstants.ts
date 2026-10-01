import type { ProjectSource } from "./types";

export interface ProjectNumericConstant {
  symbol: string;
  value: number;
  sourcePath: string;
  line: number;
  groupId: string | null;
}

export interface ProjectConstantGroup {
  id: string;
  sourcePath: string;
  startLine: number;
  step: number;
  constants: ProjectNumericConstant[];
}

export interface ProjectConstantCatalog {
  constants: ProjectNumericConstant[];
  groups: ProjectConstantGroup[];
  warnings: string[];
}

interface PendingDefinition {
  symbol: string;
  expression: string;
  sourcePath: string;
  line: number;
}

type Token =
  | { type: "number"; value: number }
  | { type: "identifier"; value: string }
  | { type: "operator"; value: string }
  | { type: "left" }
  | { type: "right" };

function stripComment(line: string): string {
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
    if (char === ";" && !quoted) return line.slice(0, index).trim();
  }
  return line.trim();
}

function numericLiteral(raw: string): number | null {
  const clean = raw.replace(/_/g, "");
  if (/^\$[0-9a-f]+$/i.test(clean)) return Number.parseInt(clean.slice(1), 16);
  if (/^%[01]+$/.test(clean)) return Number.parseInt(clean.slice(1), 2);
  if (/^&[0-7]+$/.test(clean)) return Number.parseInt(clean.slice(1), 8);
  if (/^0x[0-9a-f]+$/i.test(clean)) return Number.parseInt(clean.slice(2), 16);
  if (/^\d+$/.test(clean)) return Number.parseInt(clean, 10);
  return null;
}

function tokenize(expression: string): Token[] | null {
  const tokens: Token[] = [];
  let index = 0;
  while (index < expression.length) {
    const char = expression[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (char === "(") {
      tokens.push({ type: "left" });
      index += 1;
      continue;
    }
    if (char === ")") {
      tokens.push({ type: "right" });
      index += 1;
      continue;
    }

    const two = expression.slice(index, index + 2);
    if (two === "<<" || two === ">>") {
      tokens.push({ type: "operator", value: two });
      index += 2;
      continue;
    }

    const literal = expression.slice(index).match(/^(?:\$[0-9A-Fa-f_]+|%[01_]+|&[0-7_]+|0x[0-9A-Fa-f_]+|\d[\d_]*)/);
    if (literal) {
      const value = numericLiteral(literal[0]);
      if (value === null) return null;
      tokens.push({ type: "number", value });
      index += literal[0].length;
      continue;
    }

    if ("+-*/%|&^~".includes(char)) {
      tokens.push({ type: "operator", value: char });
      index += 1;
      continue;
    }

    const identifier = expression.slice(index).match(/^[A-Za-z_][A-Za-z0-9_.]*/);
    if (identifier) {
      tokens.push({ type: "identifier", value: identifier[0] });
      index += identifier[0].length;
      continue;
    }

    return null;
  }
  return tokens;
}

const PRECEDENCE: Record<string, number> = {
  "|": 1,
  "^": 2,
  "&": 3,
  "<<": 4,
  ">>": 4,
  "+": 5,
  "-": 5,
  "*": 6,
  "/": 6,
  "%": 6,
};

function applyBinary(operator: string, left: number, right: number): number | null {
  switch (operator) {
    case "|": return left | right;
    case "^": return left ^ right;
    case "&": return left & right;
    case "<<": return left << right;
    case ">>": return left >> right;
    case "+": return left + right;
    case "-": return left - right;
    case "*": return left * right;
    case "/": return right === 0 ? null : Math.trunc(left / right);
    case "%": return right === 0 ? null : left % right;
    default: return null;
  }
}

function evaluateTokens(
  tokens: Token[],
  symbols: Map<string, number>,
): number | null {
  let position = 0;

  function primary(): number | null {
    const token = tokens[position];
    if (!token) return null;

    if (token.type === "operator" && ["+", "-", "~"].includes(token.value)) {
      position += 1;
      const value = primary();
      if (value === null) return null;
      if (token.value === "+") return value;
      if (token.value === "-") return -value;
      return ~value;
    }

    if (token.type === "number") {
      position += 1;
      return token.value;
    }

    if (token.type === "identifier") {
      position += 1;
      return symbols.get(token.value) ?? null;
    }

    if (token.type === "left") {
      position += 1;
      const value = expressionAt(1);
      if (value === null || tokens[position]?.type !== "right") return null;
      position += 1;
      return value;
    }

    return null;
  }

  function expressionAt(minimumPrecedence: number): number | null {
    let left = primary();
    if (left === null) return null;

    while (true) {
      const token = tokens[position];
      if (!token || token.type !== "operator") break;
      const precedence = PRECEDENCE[token.value];
      if (!precedence || precedence < minimumPrecedence) break;

      position += 1;
      const right = expressionAt(precedence + 1);
      if (right === null) return null;
      left = applyBinary(token.value, left, right);
      if (left === null) return null;
    }
    return left;
  }

  const result = expressionAt(1);
  return result !== null && position === tokens.length ? result : null;
}

export function evaluateRgbdsExpression(
  expression: string,
  symbols: Map<string, number>,
): number | null {
  const tokens = tokenize(expression);
  return tokens ? evaluateTokens(tokens, symbols) : null;
}

function sourcePathEligible(path: string): boolean {
  return /\.(?:asm|inc)$/i.test(path);
}

async function readProjectSources(
  source: ProjectSource,
): Promise<Array<{ path: string; contents: string }>> {
  if (!source.listFiles) {
    throw new Error(
      "This project source cannot enumerate RGBDS files for constant analysis.",
    );
  }
  const paths = [...new Set(await source.listFiles())]
    .filter(sourcePathEligible)
    .sort((left, right) => left.localeCompare(right));

  const result = new Array<{ path: string; contents: string }>(paths.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(12, paths.length) }, async () => {
    while (nextIndex < paths.length) {
      const index = nextIndex;
      nextIndex += 1;
      const path = paths[index];
      try {
        result[index] = { path, contents: await source.readText(path) };
      } catch {
        result[index] = { path, contents: "" };
      }
    }
  });
  await Promise.all(workers);
  return result;
}

export async function loadProjectConstantCatalog(
  source: ProjectSource,
): Promise<ProjectConstantCatalog> {
  const files = await readProjectSources(source);
  const symbols = new Map<string, number>();
  const constants = new Map<string, ProjectNumericConstant>();
  const groups: ProjectConstantGroup[] = [];
  const pending: PendingDefinition[] = [];
  const warnings: string[] = [];

  for (const file of files) {
    const lines = file.contents.split(/\r?\n/);
    let currentValue = 0;
    let currentStep = 1;
    let activeGroup: ProjectConstantGroup | null = null;

    lines.forEach((sourceLine, index) => {
      const lineNumber = index + 1;
      const line = stripComment(sourceLine);
      if (!line) return;

      const constDef = line.match(/^const_def(?:\s+([^,\s]+))?(?:\s*,\s*([^,\s]+))?\s*$/i);
      if (constDef) {
        const start = constDef[1]
          ? evaluateRgbdsExpression(constDef[1], symbols)
          : 0;
        const step = constDef[2]
          ? evaluateRgbdsExpression(constDef[2], symbols)
          : 1;
        if (start === null || step === null) {
          activeGroup = null;
          warnings.push(
            `${file.path}:${lineNumber} uses a const_def expression that could not be evaluated.`,
          );
          return;
        }
        currentValue = start;
        currentStep = step;
        activeGroup = {
          id: `${file.path}:${lineNumber}`,
          sourcePath: file.path,
          startLine: lineNumber,
          step,
          constants: [],
        };
        groups.push(activeGroup);
        return;
      }

      const constLine = line.match(/^const\s+([A-Za-z_][A-Za-z0-9_.]*)\b/i);
      if (constLine && activeGroup) {
        const symbol = constLine[1];
        const constant: ProjectNumericConstant = {
          symbol,
          value: currentValue,
          sourcePath: file.path,
          line: lineNumber,
          groupId: activeGroup.id,
        };
        if (!constants.has(symbol)) {
          constants.set(symbol, constant);
          symbols.set(symbol, currentValue);
          activeGroup.constants.push(constant);
        }
        currentValue += currentStep;
        return;
      }

      const definition = line.match(
        /^(?:DEF\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s+EQU\s+(.+)$/i,
      );
      if (definition) {
        pending.push({
          symbol: definition[1],
          expression: definition[2].trim(),
          sourcePath: file.path,
          line: lineNumber,
        });
      }
    });
  }

  let unresolved = [...pending];
  for (let pass = 0; pass < 20 && unresolved.length > 0; pass += 1) {
    const next: PendingDefinition[] = [];
    let progress = false;
    for (const definition of unresolved) {
      if (constants.has(definition.symbol)) continue;
      const value = evaluateRgbdsExpression(definition.expression, symbols);
      if (value === null) {
        next.push(definition);
        continue;
      }
      const constant: ProjectNumericConstant = {
        symbol: definition.symbol,
        value,
        sourcePath: definition.sourcePath,
        line: definition.line,
        groupId: null,
      };
      constants.set(definition.symbol, constant);
      symbols.set(definition.symbol, value);
      progress = true;
    }
    unresolved = next;
    if (!progress) break;
  }

  if (unresolved.length > 0) {
    warnings.push(
      `${unresolved.length} RGBDS constant definition${unresolved.length === 1 ? "" : "s"} could not be reduced to numeric values.`,
    );
  }

  return {
    constants: [...constants.values()].sort((left, right) =>
      left.sourcePath.localeCompare(right.sourcePath)
      || left.line - right.line
      || left.symbol.localeCompare(right.symbol),
    ),
    groups: groups.filter((group) => group.constants.length > 0),
    warnings,
  };
}
