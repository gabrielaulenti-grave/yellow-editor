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

interface SymbolicCarryResult {
  routine: string;
  argument: string | null;
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
  carryResult: SymbolicCarryResult | null;
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

function carryConditionText(
  result: SymbolicCarryResult | null,
  carry: boolean,
): string | null {
  if (!result) return null;
  const argument = result.argument ? `(${result.argument})` : "";
  return `${result.routine}${argument} ${carry ? "returned carry" : "returned without carry"}`;
}

function symbolicBranchConditions(
  state: SymbolicState,
  flag: string,
): { jump: string | null; fallthrough: string | null } {
  const normalized = flag.toLowerCase();
  if (normalized === "z" || normalized === "nz") {
    const equality = normalized === "z";
    return {
      jump: conditionText(state.comparison, equality),
      fallthrough: conditionText(state.comparison, !equality),
    };
  }
  if (normalized === "c" || normalized === "nc") {
    const carry = normalized === "c";
    return {
      jump: carryConditionText(state.carryResult, carry),
      fallthrough: carryConditionText(state.carryResult, !carry),
    };
  }
  return { jump: null, fallthrough: null };
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
    state.carryResult
      ? `${state.carryResult.routine}:${state.carryResult.argument ?? ""}`
      : "",
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
    carryResult: null,
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
        carryResult: null,
      }));
      continue;
    }

    if (/^and\s+a\b/i.test(clean)) {
      queue.push(next({
        comparison: state.a
          ? { left: state.a, right: "0" }
          : null,
        carryResult: null,
      }));
      continue;
    }

    const compare = clean.match(/^cp\s+([^\s;]+)\s*$/i);
    if (compare) {
      queue.push(next({
        comparison: state.a
          ? { left: state.a, right: operandValue(compare[1]) }
          : null,
        carryResult: null,
      }));
      continue;
    }

    const conditional = clean.match(/^(?:jr|jp)\s+(z|nz|c|nc)\s*,\s*([A-Za-z_.][A-Za-z0-9_.]*)\b/i);
    if (conditional) {
      const target = targetIndex(labels, conditional[2]);
      if (target === null || target <= state.pc) {
        queue.push(next({ confidence: "inferred" }));
        continue;
      }

      const branchConditions = symbolicBranchConditions(state, conditional[1]);
      queue.push(next({
        pc: target,
        conditions: branchConditions.jump
          ? [...state.conditions, branchConditions.jump]
          : state.conditions,
        comparison: null,
        carryResult: null,
        confidence: branchConditions.jump ? state.confidence : "inferred",
      }));
      queue.push(next({
        conditions: branchConditions.fallthrough
          ? [...state.conditions, branchConditions.fallthrough]
          : state.conditions,
        comparison: null,
        carryResult: null,
        confidence: branchConditions.fallthrough ? state.confidence : "inferred",
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

    const genericCall = clean.match(/^(?:call|farcall|predef)\s+([A-Za-z_][A-Za-z0-9_]*)\b/i);
    if (genericCall) {
      queue.push(next({
        comparison: null,
        carryResult: {
          routine: genericCall[1],
          argument: state.hl,
        },
        confidence: state.de || state.playerMovementLabel || state.playerMovementValues.length > 0
          ? "inferred"
          : state.confidence,
      }));
      continue;
    }

    queue.push(next({ comparison: null, carryResult: null }));
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
    carryResult: null,
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
        carryResult: null,
      }));
      continue;
    }

    if (/^and\s+a\b/i.test(clean)) {
      queue.push(next({
        comparison: state.a
          ? { left: state.a, right: "0" }
          : null,
        carryResult: null,
      }));
      continue;
    }

    const compare = clean.match(/^cp\s+([^\s;]+)\s*$/i);
    if (compare) {
      queue.push(next({
        comparison: state.a
          ? { left: state.a, right: operandValue(compare[1]) }
          : null,
        carryResult: null,
      }));
      continue;
    }

    const conditional = clean.match(/^(?:jr|jp)\s+(z|nz|c|nc)\s*,\s*([A-Za-z_.][A-Za-z0-9_.]*)\b/i);
    if (conditional) {
      const target = targetIndex(labels, conditional[2]);
      if (target === null || target <= state.pc) {
        queue.push(next({ confidence: "inferred" }));
        continue;
      }

      const branchConditions = symbolicBranchConditions(state, conditional[1]);
      queue.push(next({
        pc: target,
        conditions: branchConditions.jump
          ? [...state.conditions, branchConditions.jump]
          : state.conditions,
        comparison: null,
        carryResult: null,
        confidence: branchConditions.jump ? state.confidence : "inferred",
      }));
      queue.push(next({
        conditions: branchConditions.fallthrough
          ? [...state.conditions, branchConditions.fallthrough]
          : state.conditions,
        comparison: null,
        carryResult: null,
        confidence: branchConditions.fallthrough ? state.confidence : "inferred",
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

    const genericCall = clean.match(/^(?:call|farcall|predef)\s+([A-Za-z_][A-Za-z0-9_]*)\b/i);
    if (genericCall) {
      queue.push(next({
        comparison: null,
        carryResult: {
          routine: genericCall[1],
          argument: state.hl,
        },
        confidence: state.playerMovementLabel || state.playerMovementValues.length > 0
          ? "inferred"
          : state.confidence,
      }));
      continue;
    }

    queue.push(next({ comparison: null, carryResult: null }));
  }

  return alternatives.filter((alternative, index, entries) =>
    entries.findIndex((candidate) =>
      candidate.label === alternative.label
      && candidate.values.join("\u0000") === alternative.values.join("\u0000")
      && candidate.conditions.join("\u0000") === alternative.conditions.join("\u0000")
    ) === index
  );
}
