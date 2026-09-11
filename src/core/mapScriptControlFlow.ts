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
  | { type: "jump"; target: string };

export interface MapScriptIfBlock {
  type: "if";
  id: string;
  condition: MapScriptCondition;
  whenTrue: MapScriptBranchOutcome;
  whenFalse: MapScriptBranchOutcome;
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

function withoutComment(line: string): string {
  return line.split(";", 1)[0].trim();
}

function sourceSpan(state: MapScriptState, lines: string[], startIndex: number, endIndex: number): MapScriptSourceSpan {
  return {
    lineStart: state.startLine + startIndex,
    lineEnd: state.startLine + endIndex,
    raw: lines.slice(startIndex, endIndex + 1).join("\n"),
    confidence: "exact",
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

  // CheckEvent uses a bit test: Z means the event is clear, NZ means it is set.
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

function flowConditionAt(
  lines: string[],
  index: number,
): { condition: MapScriptCondition; branch: ConditionalBranch; startIndex: number } | null {
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

function shouldSuppressNode(node: MapScriptSemanticNode, blocks: MapScriptIfBlock[]): boolean {
  if (!(node.type === "condition" || (node.type === "event" && node.action === "check"))) return false;
  return blocks.some((block) =>
    node.source.lineStart >= block.source.lineStart
    && node.source.lineEnd <= block.source.lineEnd,
  );
}

function itemLine(item: MapScriptFlowItem): number {
  return item.type === "if" ? item.source.lineStart : item.node.source.lineStart;
}

export function structuredMapScriptFlow(state: MapScriptState): MapScriptFlowItem[] {
  const lines = state.source.split(/\r?\n/);
  const blocks: MapScriptIfBlock[] = [];

  for (let index = 1; index < lines.length; index += 1) {
    const parsed = flowConditionAt(lines, index);
    if (!parsed) continue;

    blocks.push({
      type: "if",
      id: `${state.label}:${state.startLine + parsed.startIndex}:if`,
      condition: parsed.condition,
      whenTrue: parsed.branch.outcome,
      whenFalse: { type: "continue" },
      source: sourceSpan(state, lines, parsed.startIndex, parsed.branch.index),
    });
    index = parsed.branch.index;
  }

  const items: MapScriptFlowItem[] = [
    ...blocks,
    ...state.nodes
      .filter((node) => !shouldSuppressNode(node, blocks))
      .map((node): MapScriptFlowItem => ({ type: "node", node })),
  ];

  return items.sort((left, right) => itemLine(left) - itemLine(right));
}
