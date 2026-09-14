import type {
  MapScriptSemanticNode,
  MapScriptSourceSpan,
  MapScriptState,
} from "./mapScriptProgram";

export type MapScriptCondition =
  | {
      type: "event-state";
      event: string;
      state: "set" | "clear";
    }
  | {
      type: "battle-result";
      result: "lost" | "not-lost";
    }
  | {
      type: "variable-compare";
      variable: string;
      comparison: "equals" | "not-equals";
      value: string;
    }
  | {
      type: "flag-state";
      variable: string;
      flag: string;
      state: "set" | "clear";
    };

export type MapScriptBranchOutcome =
  | { type: "continue" }
  | { type: "return" }
  | {
      type: "jump";
      target: string;
      summary?: string;
      targetSource?: MapScriptSourceSpan;
    };

export interface MapScriptFlowBranch {
  items: MapScriptFlowItem[];
  outcome: MapScriptBranchOutcome;
}

export interface MapScriptIfBlock {
  type: "if";
  id: string;
  condition: MapScriptCondition;
  whenTrue: MapScriptFlowBranch;
  whenFalse: MapScriptFlowBranch;
  source: MapScriptSourceSpan;
}

export type MapScriptFlowItem =
  | { type: "node"; node: MapScriptSemanticNode }
  | MapScriptIfBlock;

interface ConditionalBranch {
  flag: "z" | "nz";
  outcome: MapScriptBranchOutcome;
  index: number;
}

interface ParsedCondition {
  condition: MapScriptCondition;
  branch: ConditionalBranch;
  startIndex: number;
}

interface StructuredCondition {
  block: MapScriptIfBlock;
  nextIndex: number;
}

interface RoutineSection {
  label: string;
  startLine: number;
  lines: string[];
}

interface FlowContext {
  state: MapScriptState;
  lines: string[];
  nodesByStart: Map<number, MapScriptSemanticNode[]>;
  localLabels: Map<string, number>;
  externalSections: Map<string, RoutineSection>;
}

function withoutComment(line: string): string {
  return line.split(";", 1)[0].trim();
}

function sourceSpan(
  state: MapScriptState,
  lines: string[],
  startIndex: number,
  endIndex: number,
  confidence: MapScriptSourceSpan["confidence"] = "exact",
): MapScriptSourceSpan {
  return {
    lineStart: state.startLine + startIndex,
    lineEnd: state.startLine + endIndex,
    raw: lines.slice(startIndex, endIndex + 1).join("\n"),
    confidence,
  };
}

function conditionalBranch(line: string, index: number): ConditionalBranch | null {
  const clean = withoutComment(line);
  const jump = clean.match(/^(?:jr|jp)\s+(z|nz)\s*,\s*([A-Za-z_.][A-Za-z0-9_.]*)\b/i);
  if (jump) {
    return {
      flag: jump[1].toLowerCase() as "z" | "nz",
      outcome: { type: "jump", target: jump[2] },
      index,
    };
  }

  const conditionalReturn = clean.match(/^ret\s+(z|nz)\b/i);
  if (conditionalReturn) {
    return {
      flag: conditionalReturn[1].toLowerCase() as "z" | "nz",
      outcome: { type: "return" },
      index,
    };
  }

  return null;
}

function eventCondition(lines: string[], index: number): { condition: MapScriptCondition; branch: ConditionalBranch } | null {
  const event = withoutComment(lines[index]).match(/^CheckEvent\s+([A-Z][A-Z0-9_]*)\s*$/i)?.[1];
  if (!event) return null;
  const branch = conditionalBranch(lines[index + 1] ?? "", index + 1);
  if (!branch) return null;

  // CheckEvent leaves Z when the event is clear and NZ when it is set.
  return {
    condition: {
      type: "event-state",
      event,
      state: branch.flag === "z" ? "clear" : "set",
    },
    branch,
  };
}

function battleResultCondition(lines: string[], index: number): { condition: MapScriptCondition; branch: ConditionalBranch } | null {
  if (!/^ld\s+a\s*,\s*\[wIsInBattle\]\s*$/i.test(withoutComment(lines[index]))) return null;
  if (!/^cp\s+LOST_BATTLE\s*$/i.test(withoutComment(lines[index + 1] ?? ""))) return null;
  const branch = conditionalBranch(lines[index + 2] ?? "", index + 2);
  if (!branch) return null;

  return {
    condition: {
      type: "battle-result",
      result: branch.flag === "z" ? "lost" : "not-lost",
    },
    branch,
  };
}

function variableComparisonCondition(lines: string[], index: number): { condition: MapScriptCondition; branch: ConditionalBranch } | null {
  const variable = withoutComment(lines[index]).match(/^ld\s+a\s*,\s*\[(w[A-Za-z0-9_]+)\]\s*$/i)?.[1];
  if (!variable) return null;
  const value = withoutComment(lines[index + 1] ?? "").match(/^cp\s+([^\s;]+)\s*$/i)?.[1];
  if (!value) return null;
  const branch = conditionalBranch(lines[index + 2] ?? "", index + 2);
  if (!branch) return null;

  return {
    condition: {
      type: "variable-compare",
      variable,
      comparison: branch.flag === "z" ? "equals" : "not-equals",
      value,
    },
    branch,
  };
}

function flagCondition(lines: string[], index: number): { condition: MapScriptCondition; branch: ConditionalBranch } | null {
  const variable = withoutComment(lines[index]).match(/^ld\s+a\s*,\s*\[(w[A-Za-z0-9_]+)\]\s*$/i)?.[1];
  if (!variable) return null;
  const flag = withoutComment(lines[index + 1] ?? "").match(/^bit\s+([^,\s]+)\s*,\s*a\s*$/i)?.[1];
  if (!flag) return null;

  // mapScriptProgram already recognizes this engine idiom as a semantic wait.
  // Keep that friendlier operation instead of replacing it with a generic flag test.
  if (variable === "wStatusFlags5" && flag === "BIT_SCRIPTED_NPC_MOVEMENT") return null;

  const branch = conditionalBranch(lines[index + 2] ?? "", index + 2);
  if (!branch) return null;

  return {
    condition: {
      type: "flag-state",
      variable,
      flag,
      state: branch.flag === "z" ? "clear" : "set",
    },
    branch,
  };
}

function flowConditionAt(lines: string[], index: number): ParsedCondition | null {
  const event = eventCondition(lines, index);
  if (event) return { ...event, startIndex: index };

  const battle = battleResultCondition(lines, index);
  if (battle) return { ...battle, startIndex: index };

  const variable = variableComparisonCondition(lines, index);
  if (variable) return { ...variable, startIndex: index };

  const flag = flagCondition(lines, index);
  if (flag) return { ...flag, startIndex: index };

  return null;
}

function labelsInState(lines: string[]): Map<string, number> {
  const result = new Map<string, number>();
  lines.forEach((line, index) => {
    const label = line.match(/^\s*([A-Za-z_.][A-Za-z0-9_.]*):{1,2}\s*(?:;.*)?$/)?.[1];
    if (label) result.set(label, index);
  });
  return result;
}

function globalRoutineSections(source: string | undefined): Map<string, RoutineSection> {
  const result = new Map<string, RoutineSection>();
  if (!source) return result;
  const lines = source.split(/\r?\n/);
  const starts: Array<{ label: string; index: number }> = [];
  lines.forEach((line, index) => {
    const label = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*):{1,2}\s*(?:;.*)?$/)?.[1];
    if (label) starts.push({ label, index });
  });
  starts.forEach((start, index) => {
    const end = starts[index + 1]?.index ?? lines.length;
    result.set(start.label, {
      label: start.label,
      startLine: start.index + 1,
      lines: lines.slice(start.index, end),
    });
  });
  return result;
}

function previousExecutableIndex(lines: string[], start: number, endExclusive: number): number | null {
  for (let index = endExclusive - 1; index >= start; index -= 1) {
    const clean = withoutComment(lines[index]);
    if (!clean || /^[A-Za-z_.][A-Za-z0-9_.]*:{1,2}$/.test(clean)) continue;
    return index;
  }
  return null;
}

function unconditionalJumpTarget(line: string): string | null {
  return withoutComment(line).match(/^(?:jr|jp)\s+([A-Za-z_.][A-Za-z0-9_.]*)\b/i)?.[1] ?? null;
}

function nodeStartIndex(state: MapScriptState, node: MapScriptSemanticNode): number {
  return node.source.lineStart - state.startLine;
}

function nodeEndIndex(state: MapScriptState, node: MapScriptSemanticNode): number {
  return node.source.lineEnd - state.startLine;
}

function nodesByStart(state: MapScriptState): Map<number, MapScriptSemanticNode[]> {
  const result = new Map<number, MapScriptSemanticNode[]>();
  for (const node of state.nodes) {
    const index = nodeStartIndex(state, node);
    const existing = result.get(index) ?? [];
    existing.push(node);
    result.set(index, existing);
  }
  return result;
}

function resetRoutineSummary(section: RoutineSection | undefined): { summary: string; source: MapScriptSourceSpan } | null {
  if (!section) return null;
  const body = section.lines.map(withoutComment);
  const xorIndex = body.findIndex((line) => /^xor\s+a\b/i.test(line));
  if (xorIndex < 0) return null;
  const curScriptIndex = body.findIndex((line, index) =>
    index > xorIndex && /^ld\s+\[w[A-Za-z0-9_]*CurScript\]\s*,\s*a\b/i.test(line),
  );
  if (curScriptIndex < 0) return null;
  const returns = body.slice(curScriptIndex + 1).some((line) => /^ret\b/i.test(line));
  if (!returns) return null;

  return {
    summary: "Reset this map event to its default state",
    source: {
      lineStart: section.startLine,
      lineEnd: section.startLine + section.lines.length - 1,
      raw: section.lines.join("\n"),
      confidence: "inferred",
    },
  };
}

function enrichExternalOutcome(
  outcome: MapScriptBranchOutcome,
  context: FlowContext,
): MapScriptBranchOutcome {
  if (outcome.type !== "jump") return outcome;
  if (context.localLabels.has(outcome.target)) return outcome;

  const reset = resetRoutineSummary(context.externalSections.get(outcome.target));
  if (!reset) return outcome;
  return {
    ...outcome,
    summary: reset.summary,
    targetSource: reset.source,
  };
}

function rangeSourceEnd(lines: string[], start: number, endExclusive: number): number {
  return previousExecutableIndex(lines, start, endExclusive) ?? Math.max(start, endExclusive - 1);
}

function makeSimpleBlock(
  context: FlowContext,
  parsed: ParsedCondition,
): StructuredCondition {
  return {
    block: {
      type: "if",
      id: `${context.state.label}:${context.state.startLine + parsed.startIndex}:if`,
      condition: parsed.condition,
      whenTrue: {
        items: [],
        outcome: enrichExternalOutcome(parsed.branch.outcome, context),
      },
      whenFalse: { items: [], outcome: { type: "continue" } },
      source: sourceSpan(context.state, context.lines, parsed.startIndex, parsed.branch.index),
    },
    nextIndex: parsed.branch.index + 1,
  };
}

function structureCondition(
  context: FlowContext,
  parsed: ParsedCondition,
  endExclusive: number,
  depth: number,
): StructuredCondition | null {
  const branchOutcome = parsed.branch.outcome;
  const conditionEnd = parsed.branch.index;

  if (depth > 8) return makeSimpleBlock(context, parsed);

  if (branchOutcome.type === "return") {
    const falseItems = buildRange(context, conditionEnd + 1, endExclusive, depth + 1);
    return {
      block: {
        type: "if",
        id: `${context.state.label}:${context.state.startLine + parsed.startIndex}:if`,
        condition: parsed.condition,
        whenTrue: { items: [], outcome: { type: "return" } },
        whenFalse: { items: falseItems, outcome: { type: "continue" } },
        source: sourceSpan(
          context.state,
          context.lines,
          parsed.startIndex,
          rangeSourceEnd(context.lines, parsed.startIndex, endExclusive),
        ),
      },
      nextIndex: endExclusive,
    };
  }

  if (branchOutcome.type !== "jump") return null;
  const targetIndex = context.localLabels.get(branchOutcome.target);

  // A jump outside the current state is a guard-style exit. The branch that is
  // not taken owns the remainder of this state, which can be rendered as its
  // actual semantic body. Known reset helpers receive a friendly explanation.
  if (targetIndex === undefined) {
    const falseItems = buildRange(context, conditionEnd + 1, endExclusive, depth + 1);
    return {
      block: {
        type: "if",
        id: `${context.state.label}:${context.state.startLine + parsed.startIndex}:if`,
        condition: parsed.condition,
        whenTrue: {
          items: [],
          outcome: enrichExternalOutcome(branchOutcome, context),
        },
        whenFalse: { items: falseItems, outcome: { type: "continue" } },
        source: sourceSpan(
          context.state,
          context.lines,
          parsed.startIndex,
          rangeSourceEnd(context.lines, parsed.startIndex, endExclusive),
        ),
      },
      nextIndex: endExclusive,
    };
  }

  // Backward jumps are loops. Do not pretend they are ordinary If blocks with
  // finite branch bodies; keep the conservative jump representation instead.
  if (targetIndex <= conditionEnd || targetIndex >= endExclusive) {
    return makeSimpleBlock(context, parsed);
  }

  const fallthroughStart = conditionEnd + 1;
  const lastBeforeTarget = previousExecutableIndex(context.lines, fallthroughStart, targetIndex);
  const joinTarget = lastBeforeTarget === null ? null : unconditionalJumpTarget(context.lines[lastBeforeTarget]);
  const joinIndex = joinTarget ? context.localLabels.get(joinTarget) : undefined;

  // Canonical if/else shape:
  //   condition -> branch to .else
  //   fallthrough body
  //   jr .join
  // .else
  //   branch body
  // .join
  if (
    lastBeforeTarget !== null
    && joinTarget
    && joinIndex !== undefined
    && joinIndex > targetIndex
    && joinIndex < endExclusive
  ) {
    const falseItems = buildRange(context, fallthroughStart, lastBeforeTarget, depth + 1);
    const trueItems = buildRange(context, targetIndex + 1, joinIndex, depth + 1);
    return {
      block: {
        type: "if",
        id: `${context.state.label}:${context.state.startLine + parsed.startIndex}:if`,
        condition: parsed.condition,
        whenTrue: { items: trueItems, outcome: { type: "continue" } },
        whenFalse: { items: falseItems, outcome: { type: "continue" } },
        source: sourceSpan(context.state, context.lines, parsed.startIndex, joinIndex),
      },
      nextIndex: joinIndex + 1,
    };
  }

  // Forward conditional jumps without a skip-over jump are a conditional
  // prelude: taking the branch skips the fallthrough block and both paths join
  // at the target label.
  const falseItems = buildRange(context, fallthroughStart, targetIndex, depth + 1);
  return {
    block: {
      type: "if",
      id: `${context.state.label}:${context.state.startLine + parsed.startIndex}:if`,
      condition: parsed.condition,
      whenTrue: { items: [], outcome: { type: "continue" } },
      whenFalse: { items: falseItems, outcome: { type: "continue" } },
      source: sourceSpan(context.state, context.lines, parsed.startIndex, targetIndex),
    },
    nextIndex: targetIndex + 1,
  };
}

function buildRange(
  context: FlowContext,
  startIndex: number,
  endExclusive: number,
  depth: number,
): MapScriptFlowItem[] {
  const items: MapScriptFlowItem[] = [];
  let index = startIndex;

  while (index < endExclusive) {
    const parsed = flowConditionAt(context.lines, index);
    if (parsed && parsed.branch.index < endExclusive) {
      const structured = structureCondition(context, parsed, endExclusive, depth);
      if (structured) {
        items.push(structured.block);
        index = Math.max(index + 1, structured.nextIndex);
        continue;
      }
    }

    const visible = context.nodesByStart.get(index) ?? [];
    if (visible.length > 0) {
      for (const node of visible) items.push({ type: "node", node });
      const lastEnd = Math.max(...visible.map((node) => nodeEndIndex(context.state, node)));
      index = Math.max(index + 1, lastEnd + 1);
      continue;
    }

    index += 1;
  }

  return items;
}

export function structuredMapScriptFlow(
  state: MapScriptState,
  fullSource?: string,
): MapScriptFlowItem[] {
  const lines = state.source.split(/\r?\n/);
  const context: FlowContext = {
    state,
    lines,
    nodesByStart: nodesByStart(state),
    localLabels: labelsInState(lines),
    externalSections: globalRoutineSections(fullSource),
  };

  // Index 0 is the state's own label.
  return buildRange(context, 1, lines.length, 0);
}
