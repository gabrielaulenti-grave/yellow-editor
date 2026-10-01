export interface MovementLabelAlternative {
  label: string;
  conditions: string[];
  confidence: "exact" | "inferred";
}

export interface PlayerMovementAlternative {
  label: string | null;
  values: string[];
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
  hl: string | null;
  joypadPointerIndex: number | null;
  playerMovementLabel: string | null;
  playerMovementValues: Array<string | null>;
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
    state.hl ?? "",
    state.joypadPointerIndex ?? "",
    state.playerMovementLabel ?? "",
    state.playerMovementValues.map((value) => value ?? "").join(","),
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
  register: "de" | "hl" = "de",
): MovementLabelAlternative[] {
  const lines = source.split(/\r?\n/);
  if (callIndex <= 0 || callIndex >= lines.length) return [];
  const labels = localLabels(lines);
  const queue: SymbolicState[] = [{
    pc: 1,
    de: null,
    a: null,
    hl: null,
    joypadPointerIndex: null,
    playerMovementLabel: null,
    playerMovementValues: [],
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

    const sourceLine = lines[state.pc];
    const clean = withoutComment(sourceLine);
    const next = (updates: Partial<SymbolicState> = {}): SymbolicState => ({
      ...state,
      ...updates,
      pc: updates.pc ?? state.pc + 1,
      steps: state.steps + 1,
    });

    if (!clean) {
      queue.push(next());
      continue;
    }

    if (/^(?:ret|reti)\b/i.test(clean)) {
      continue;
    }

    if (
      /^\s*(?:\.[A-Za-z_][A-Za-z0-9_.]*)(?::{1,2})?\s*(?:;.*)?$/.test(sourceLine)
      || /^\s*[A-Za-z_][A-Za-z0-9_]*:{1,2}\s*(?:;.*)?$/.test(sourceLine)
    ) {
      queue.push(next());
      continue;
    }

    if (/^(?:db|dw|dl|ds)\b/i.test(clean)) {
      continue;
    }

    const loadDe = clean.match(new RegExp(`^ld\\s+${register}\\s*,\\s*([A-Za-z_.][A-Za-z0-9_.]*)\\b`, "i"));
    if (loadDe) {
      queue.push(next({ de: operandValue(loadDe[1]) }));
      continue;
    }

    const loadHl = clean.match(/^ld\s+hl\s*,\s*([A-Za-z_.][A-Za-z0-9_.]*)\b/i);
    if (loadHl) {
      queue.push(next({
        hl: operandValue(loadHl[1]),
        joypadPointerIndex: loadHl[1] === "wSimulatedJoypadStatesEnd" ? 0 : null,
      }));
      continue;
    }

    const loadAFromVariable = clean.match(/^ld\s+a\s*,\s*\[([^\]]+)\]\s*$/i);
    if (loadAFromVariable) {
      queue.push(next({
        a: operandValue(loadAFromVariable[1]),
      }));
      continue;
    }

    const loadAImmediate = clean.match(/^ld\s+a\s*,\s*([^\s;]+)\s*$/i);
    if (loadAImmediate) {
      queue.push(next({
        a: operandValue(loadAImmediate[1]),
      }));
      continue;
    }

    const directJoypadStore = clean.match(
      /^ld\s+\[wSimulatedJoypadStatesEnd(?:\s*\+\s*(\d+))?\]\s*,\s*a\s*$/i,
    );
    if (directJoypadStore && state.a) {
      const slot = directJoypadStore[1] ? Number(directJoypadStore[1]) : 0;
      const values = [...state.playerMovementValues];
      values[slot] = state.a;
      queue.push(next({
        playerMovementLabel: null,
        playerMovementValues: values,
      }));
      continue;
    }

    if (/^ld\s+\[hli\]\s*,\s*a\s*$/i.test(clean)
      && state.joypadPointerIndex !== null
      && state.a) {
      const values = [...state.playerMovementValues];
      values[state.joypadPointerIndex] = state.a;
      queue.push(next({
        playerMovementLabel: null,
        playerMovementValues: values,
        joypadPointerIndex: state.joypadPointerIndex + 1,
      }));
      continue;
    }

    if (/^call\s+DecodeRLEList\b/i.test(clean) && state.de) {
      queue.push(next({
        playerMovementLabel: state.de,
        playerMovementValues: [],
        comparison: null,
      }));
      continue;
    }

    if (/^and\s+a\b/i.test(clean)) {
      queue.push(next({
        comparison: state.a
          ? { left: state.a, right: "0" }
          : null,
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
      queue.push(next({ pc: target }));
      continue;
    }

    if (/^(?:call|farcall|predef)\b/i.test(clean)) {
      queue.push(next({
        comparison: null,
        confidence: state.de || state.playerMovementLabel || state.playerMovementValues.length > 0
          ? "inferred"
          : state.confidence,
      }));
      continue;
    }

    queue.push(next({ comparison: null }));
  }

  return mergeAlternatives(alternatives);
}

function completePlayerValues(values: Array<string | null>): string[] {
  if (values.length === 0 || values.some((value) => !value)) return [];
  return values as string[];
}

export function playerMovementAlternativesAtCall(
  source: string,
  callIndex: number,
): PlayerMovementAlternative[] {
  const lines = source.split(/\r?\n/);
  if (callIndex <= 0 || callIndex >= lines.length) return [];
  const labels = localLabels(lines);
  const queue: SymbolicState[] = [{
    pc: 1,
    de: null,
    a: null,
    hl: null,
    joypadPointerIndex: null,
    playerMovementLabel: null,
    playerMovementValues: [],
    comparison: null,
    conditions: [],
    confidence: "exact",
    steps: 0,
  }];
  const visited = new Set<string>();
  const alternatives: PlayerMovementAlternative[] = [];
  let processed = 0;

  while (queue.length > 0 && processed < 1024) {
    const state = queue.shift()!;
    processed += 1;
    if (state.steps > 256 || state.pc < 0 || state.pc >= lines.length) continue;

    if (state.pc === callIndex) {
      const values = completePlayerValues(state.playerMovementValues);
      if (state.playerMovementLabel || values.length > 0) {
        alternatives.push({
          label: state.playerMovementLabel,
          values,
          conditions: state.conditions,
          confidence: state.confidence,
        });
      }
      continue;
    }

    const key = stateKey(state);
    if (visited.has(key)) continue;
    visited.add(key);

    const sourceLine = lines[state.pc];
    const clean = withoutComment(sourceLine);
    const next = (updates: Partial<SymbolicState> = {}): SymbolicState => ({
      ...state,
      ...updates,
      pc: updates.pc ?? state.pc + 1,
      steps: state.steps + 1,
    });

    if (!clean) {
      queue.push(next());
      continue;
    }
    if (/^(?:ret|reti)\b/i.test(clean)) continue;
    if (
      /^\s*(?:\.[A-Za-z_][A-Za-z0-9_.]*)(?::{1,2})?\s*(?:;.*)?$/.test(sourceLine)
      || /^\s*[A-Za-z_][A-Za-z0-9_]*:{1,2}\s*(?:;.*)?$/.test(sourceLine)
    ) {
      queue.push(next());
      continue;
    }
    if (/^(?:db|dw|dl|ds)\b/i.test(clean)) continue;

    const loadDe = clean.match(/^ld\s+de\s*,\s*([A-Za-z_.][A-Za-z0-9_.]*)\b/i);
    if (loadDe) {
      queue.push(next({ de: operandValue(loadDe[1]) }));
      continue;
    }

    const loadHl = clean.match(/^ld\s+hl\s*,\s*([A-Za-z_.][A-Za-z0-9_.]*)\b/i);
    if (loadHl) {
      queue.push(next({
        hl: operandValue(loadHl[1]),
        joypadPointerIndex: loadHl[1] === "wSimulatedJoypadStatesEnd" ? 0 : null,
      }));
      continue;
    }

    const loadAFromVariable = clean.match(/^ld\s+a\s*,\s*\[([^\]]+)\]\s*$/i);
    if (loadAFromVariable) {
      queue.push(next({ a: operandValue(loadAFromVariable[1]) }));
      continue;
    }

    const loadAImmediate = clean.match(/^ld\s+a\s*,\s*([^\s;]+)\s*$/i);
    if (loadAImmediate) {
      queue.push(next({ a: operandValue(loadAImmediate[1]) }));
      continue;
    }

    const directJoypadStore = clean.match(
      /^ld\s+\[wSimulatedJoypadStatesEnd(?:\s*\+\s*(\d+))?\]\s*,\s*a\s*$/i,
    );
    if (directJoypadStore && state.a) {
      const slot = directJoypadStore[1] ? Number(directJoypadStore[1]) : 0;
      const values = [...state.playerMovementValues];
      values[slot] = state.a;
      queue.push(next({
        playerMovementLabel: null,
        playerMovementValues: values,
      }));
      continue;
    }

    if (/^ld\s+\[hli\]\s*,\s*a\s*$/i.test(clean)
      && state.joypadPointerIndex !== null
      && state.a) {
      const values = [...state.playerMovementValues];
      values[state.joypadPointerIndex] = state.a;
      queue.push(next({
        playerMovementLabel: null,
        playerMovementValues: values,
        joypadPointerIndex: state.joypadPointerIndex + 1,
      }));
      continue;
    }

    if (/^call\s+DecodeRLEList\b/i.test(clean) && state.de) {
      queue.push(next({
        playerMovementLabel: state.de,
        playerMovementValues: [],
        comparison: null,
      }));
      continue;
    }

    if (/^and\s+a\b/i.test(clean)) {
      queue.push(next({
        comparison: state.a
          ? { left: state.a, right: "0" }
          : null,
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
      queue.push(next({ pc: target }));
      continue;
    }

    if (/^(?:call|farcall|predef)\b/i.test(clean)) {
      queue.push(next({
        comparison: null,
        confidence: state.playerMovementLabel || state.playerMovementValues.length > 0
          ? "inferred"
          : state.confidence,
      }));
      continue;
    }

    queue.push(next({ comparison: null }));
  }

  return alternatives.filter((alternative, index, entries) =>
    entries.findIndex((candidate) =>
      candidate.label === alternative.label
      && candidate.values.join("\u0000") === alternative.values.join("\u0000")
      && candidate.conditions.join("\u0000") === alternative.conditions.join("\u0000")
    ) === index
  );
}
