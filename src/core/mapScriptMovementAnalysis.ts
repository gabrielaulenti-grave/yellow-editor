export interface MovementLabelAlternative {
  label: string;
  conditions: string[];
  confidence: "exact" | "inferred";
}

interface SymbolicComparison {
  left: string;
  right: string;
}

interface SymbolicState {
  pc: number;
  de: string | null;
  a: string | null;
  comparison: SymbolicComparison | null;
  conditions: string[];
  confidence: "exact" | "inferred";
  steps: number;
}

function withoutComment(line: string): string {
  return line.split(";", 1)[0].trim();
}

function localLabels(lines: string[]): Map<string, number> {
  const result = new Map<string, number>();
  lines.forEach((line, index) => {
    const match = line.match(
      /^\s*((?:\.[A-Za-z_][A-Za-z0-9_.]*)(?::{1,2})?|(?:[A-Za-z_][A-Za-z0-9_]*):{1,2})\s*(?:;.*)?$/,
    );
    if (!match) return;
    result.set(match[1].replace(/:{1,2}$/, ""), index);
  });
  return result;
}

function operandValue(value: string): string {
  return value.trim();
}

function conditionText(
  comparison: SymbolicComparison | null,
  equality: boolean,
): string | null {
  if (!comparison) return null;
  return `${comparison.left} ${equality ? "=" : "≠"} ${comparison.right}`;
}

function targetIndex(labels: Map<string, number>, target: string): number | null {
  return labels.get(target) ?? null;
}

function stateKey(state: SymbolicState): string {
  return [
    state.pc,
    state.de ?? "",
    state.a ?? "",
    state.comparison ? `${state.comparison.left}:${state.comparison.right}` : "",
    state.conditions.join("&"),
  ].join("|");
}

function mergeAlternatives(
  alternatives: MovementLabelAlternative[],
): MovementLabelAlternative[] {
  const result: MovementLabelAlternative[] = [];
  for (const alternative of alternatives) {
    const existing = result.find((candidate) =>
      candidate.label === alternative.label
      && candidate.conditions.join("\u0000") === alternative.conditions.join("\u0000")
    );
    if (!existing) {
      result.push(alternative);
      continue;
    }
    if (alternative.confidence === "exact") existing.confidence = "exact";
  }
  return result;
}

export function movementLabelAlternativesAtCall(
  source: string,
  callIndex: number,
  register: "de" = "de",
): MovementLabelAlternative[] {
  const lines = source.split(/\r?\n/);
  if (callIndex <= 0 || callIndex >= lines.length) return [];
  const labels = localLabels(lines);
  const queue: SymbolicState[] = [{
    pc: 1,
    de: null,
    a: null,
    comparison: null,
    conditions: [],
    confidence: "exact",
    steps: 0,
  }];
  const visited = new Set<string>();
  const alternatives: MovementLabelAlternative[] = [];
  let processed = 0;

  while (queue.length > 0 && processed < 1024) {
    const state = queue.shift()!;
    processed += 1;
    if (state.steps > 256 || state.pc < 0 || state.pc >= lines.length) continue;
    if (state.pc === callIndex) {
      if (state.de) {
        alternatives.push({
          label: state.de,
          conditions: state.conditions,
          confidence: state.confidence,
        });
      }
      continue;
    }

    const key = stateKey(state);
    if (visited.has(key)) continue;
    visited.add(key);

    const clean = withoutComment(lines[state.pc]);
    const next = (updates: Partial<SymbolicState> = {}): SymbolicState => ({
      ...state,
      ...updates,
      pc: updates.pc ?? state.pc + 1,
      steps: state.steps + 1,
    });

    if (!clean || /^\.?[A-Za-z_][A-Za-z0-9_.]*:{0,2}$/.test(clean)) {
      queue.push(next());
      continue;
    }

    if (/^(?:db|dw|dl|ds)\b/i.test(clean)) {
      continue;
    }

    if (/^(?:ret|reti)\b/i.test(clean)) {
      continue;
    }

    const loadDe = clean.match(new RegExp(`^ld\\s+${register}\\s*,\\s*([A-Za-z_.][A-Za-z0-9_.]*)\\b`, "i"));
    if (loadDe) {
      queue.push(next({ de: operandValue(loadDe[1]), comparison: null }));
      continue;
    }

    const loadAFromVariable = clean.match(/^ld\s+a\s*,\s*\[([^\]]+)\]\s*$/i);
    if (loadAFromVariable) {
      queue.push(next({
        a: operandValue(loadAFromVariable[1]),
        comparison: null,
      }));
      continue;
    }

    const loadAImmediate = clean.match(/^ld\s+a\s*,\s*([^\s;]+)\s*$/i);
    if (loadAImmediate) {
      queue.push(next({
        a: operandValue(loadAImmediate[1]),
        comparison: null,
      }));
      continue;
    }

    const compare = clean.match(/^cp\s+([^\s;]+)\s*$/i);
    if (compare) {
      queue.push(next({
        comparison: state.a
          ? { left: state.a, right: operandValue(compare[1]) }
          : null,
      }));
      continue;
    }

    const conditional = clean.match(/^(?:jr|jp)\s+(z|nz)\s*,\s*([A-Za-z_.][A-Za-z0-9_.]*)\b/i);
    if (conditional) {
      const target = targetIndex(labels, conditional[2]);
      if (target === null || target <= state.pc) {
        queue.push(next({ confidence: "inferred" }));
        continue;
      }

      const jumpOnEqual = conditional[1].toLowerCase() === "z";
      const jumpCondition = conditionText(state.comparison, jumpOnEqual);
      const fallthroughCondition = conditionText(state.comparison, !jumpOnEqual);
      queue.push(next({
        pc: target,
        conditions: jumpCondition
          ? [...state.conditions, jumpCondition]
          : state.conditions,
        comparison: null,
        confidence: jumpCondition ? state.confidence : "inferred",
      }));
      queue.push(next({
        conditions: fallthroughCondition
          ? [...state.conditions, fallthroughCondition]
          : state.conditions,
        comparison: null,
        confidence: fallthroughCondition ? state.confidence : "inferred",
      }));
      continue;
    }

    const jump = clean.match(/^(?:jr|jp)\s+([A-Za-z_.][A-Za-z0-9_.]*)\b/i);
    if (jump) {
      const target = targetIndex(labels, jump[1]);
      if (target === null || target <= state.pc) continue;
      queue.push(next({ pc: target, comparison: null }));
      continue;
    }

    if (/^(?:call|farcall|predef)\b/i.test(clean)) {
      queue.push(next({
        comparison: null,
        confidence: state.de ? "inferred" : state.confidence,
      }));
      continue;
    }

    queue.push(next({ comparison: null }));
  }

  return mergeAlternatives(alternatives);
}
