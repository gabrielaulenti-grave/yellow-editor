import type {
  MapScriptProgram,
  MapScriptSemanticNode,
  MapScriptState,
} from "./mapScriptProgram";

export type MapScriptValidationSeverity = "error" | "warning";

export interface MapScriptValidationIssue {
  severity: MapScriptValidationSeverity;
  code: string;
  message: string;
  stateLabel?: string;
  nodeId?: string;
  sourceLine?: number;
}

function issueForNode(
  state: MapScriptState,
  node: MapScriptSemanticNode,
  severity: MapScriptValidationSeverity,
  code: string,
  message: string,
): MapScriptValidationIssue {
  return {
    severity,
    code,
    message,
    stateLabel: state.label,
    nodeId: node.id,
    sourceLine: node.source.lineStart,
  };
}

function validateNode(
  state: MapScriptState,
  node: MapScriptSemanticNode,
  knownStateLabels: Set<string>,
): MapScriptValidationIssue[] {
  const issues: MapScriptValidationIssue[] = [];

  switch (node.type) {
    case "transition":
      if (node.targetLabel && !knownStateLabels.has(node.targetLabel)) {
        issues.push(issueForNode(
          state,
          node,
          "error",
          "unknown-state-target",
          `Transition points to ${node.targetLabel}, but that state is not present in the parsed program.`,
        ));
      }
      break;

    case "movement":
      if (node.dynamic && node.alternatives.length === 0) {
        issues.push(issueForNode(
          state,
          node,
          "warning",
          "dynamic-movement",
          "Movement is dynamic but Yellow Editor could not resolve a concrete path.",
        ));
      }
      for (const alternative of node.alternatives) {
        if (alternative.path.length === 0) {
          issues.push(issueForNode(
            state,
            node,
            "warning",
            "unresolved-movement-alternative",
            `Movement alternative ${alternative.pathLabel} has no decoded steps.`,
          ));
        }
      }
      break;

    case "object":
      if (!node.object && (!node.alternatives || node.alternatives.length === 0)) {
        issues.push(issueForNode(
          state,
          node,
          "warning",
          "missing-object-target",
          "Object action does not resolve to a concrete object.",
        ));
      }
      break;

    case "opponent":
      if (!node.opponent) {
        issues.push(issueForNode(
          state,
          node,
          "warning",
          "missing-opponent",
          "Battle setup does not resolve an opponent class/species.",
        ));
      }
      break;

    case "battle-dialogue":
      if (!node.playerWins && !node.playerLoses) {
        issues.push(issueForNode(
          state,
          node,
          "warning",
          "missing-battle-dialogue",
          "Battle outcome dialogue could not be resolved.",
        ));
      }
      break;

    case "item":
      if (node.action === "give-item" && !node.item) {
        issues.push(issueForNode(
          state,
          node,
          "warning",
          "missing-item",
          "Item reward does not resolve to a concrete item.",
        ));
      }
      if (node.action === "give-pokemon" && !node.species) {
        issues.push(issueForNode(
          state,
          node,
          "warning",
          "missing-pokemon",
          "Pokémon reward does not resolve to a concrete species.",
        ));
      }
      break;

    case "warp":
      if (!node.destinationMap) {
        issues.push(issueForNode(
          state,
          node,
          "warning",
          "missing-warp-destination",
          "Dungeon-warp logic does not resolve a destination map.",
        ));
      }
      break;

    case "indexed-event":
      if (!node.baseEvent) {
        issues.push(issueForNode(
          state,
          node,
          "error",
          "missing-indexed-event-base",
          "Indexed event operation is missing its base event.",
        ));
      }
      break;

    case "object-puzzle":
      if (!node.coordinates) {
        issues.push(issueForNode(
          state,
          node,
          "warning",
          "missing-puzzle-coordinates",
          "Persistent object-puzzle check does not resolve its target coordinate table.",
        ));
      }
      break;

    default:
      break;
  }

  return issues;
}

export function validateMapScriptProgram(
  program: MapScriptProgram,
): MapScriptValidationIssue[] {
  const issues: MapScriptValidationIssue[] = [];
  const knownStateLabels = new Set(program.states.map((state) => state.label));
  const seenConstants = new Map<string, string>();

  for (const state of program.states) {
    if (state.scriptConstant) {
      const previous = seenConstants.get(state.scriptConstant);
      if (previous && previous !== state.label) {
        issues.push({
          severity: "error",
          code: "duplicate-script-constant",
          message: `${state.scriptConstant} is assigned to both ${previous} and ${state.label}.`,
          stateLabel: state.label,
          sourceLine: state.startLine,
        });
      } else {
        seenConstants.set(state.scriptConstant, state.label);
      }
    }

    for (const node of state.nodes) {
      issues.push(...validateNode(state, node, knownStateLabels));
    }
  }

  return issues;
}
