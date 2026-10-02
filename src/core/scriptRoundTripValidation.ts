import {
  parseMapScriptProgram,
  type MapScriptProgram,
  type MapScriptSemanticNode,
} from "./mapScriptProgram";
import {
  validateMapScriptProgram,
  type MapScriptValidationIssue,
} from "./mapScriptValidation";
import type {
  ProjectEventMacroSemantic,
  ProjectMovementVocabulary,
} from "./types";

function semanticShape(node: MapScriptSemanticNode): string {
  switch (node.type) {
    case "movement":
      return `movement:${node.actor}:${node.dynamic ? "dynamic" : "literal"}`;
    case "dialogue":
      return "dialogue";
    case "battle-dialogue":
      return "battle-dialogue";
    case "opponent":
      return "opponent";
    case "wait":
      return "wait";
    case "event":
      return `event:${node.action}`;
    case "condition":
      return "condition";
    case "transition":
      return "transition";
    case "object":
      return `object:${node.action}`;
    case "music":
      return "music";
    case "map-edit":
      return `map-edit:${node.action}`;
    case "indexed-event":
      return `indexed-event:${node.action}`;
    case "object-puzzle":
      return `object-puzzle:${node.action}`;
    case "warp":
      return `warp:${node.action}`;
    case "facing":
      return "facing";
    case "recovery":
      return "recovery";
    case "item":
      return `item:${node.action}`;
    case "economy":
      return `economy:${node.action}`;
    case "party":
      return `party:${node.action}`;
    case "service":
      return `service:${node.service}`;
    case "semantic-helper":
      return `semantic-helper:${node.family}:${node.helper}`;
    case "control":
      return `control:${node.control}`;
    case "flag":
      return `flag:${node.action}`;
    case "screen":
      return `screen:${node.action}`;
  }
  const exhaustive: never = node;
  return exhaustive;
}

function semanticShapesAtLine(
  program: MapScriptProgram,
  line: number,
): string[] {
  return program.states
    .flatMap((state) => state.nodes)
    .filter((node) =>
      node.source.lineStart <= line && node.source.lineEnd >= line
    )
    .map(semanticShape)
    .sort();
}

function validationErrorFingerprint(
  issue: MapScriptValidationIssue,
): string {
  return [
    issue.code,
    issue.stateLabel ?? "",
    String(issue.sourceLine ?? ""),
  ].join(":");
}

function validationErrors(program: MapScriptProgram): Set<string> {
  return new Set(
    validateMapScriptProgram(program)
      .filter((issue) => issue.severity === "error")
      .map(validationErrorFingerprint),
  );
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

export interface ScriptSemanticRoundTripResult {
  beforeShapes: string[];
  afterShapes: string[];
  newValidationErrors: string[];
}

export function validateScriptSemanticRoundTrip(
  beforeSource: string,
  afterSource: string,
  line: number,
  movementVocabulary: ProjectMovementVocabulary,
  eventMacroSemantics: ProjectEventMacroSemantic[],
): ScriptSemanticRoundTripResult {
  const beforeProgram = parseMapScriptProgram(
    beforeSource,
    undefined,
    movementVocabulary,
    eventMacroSemantics,
  );
  const afterProgram = parseMapScriptProgram(
    afterSource,
    undefined,
    movementVocabulary,
    eventMacroSemantics,
  );

  const beforeShapes = semanticShapesAtLine(beforeProgram, line);
  const afterShapes = semanticShapesAtLine(afterProgram, line);

  if (beforeShapes.length > 0 && !arraysEqual(beforeShapes, afterShapes)) {
    throw new Error(
      `The edited source changed its semantic IR shape (${beforeShapes.join(", ")} → ${afterShapes.join(", ") || "no semantic node"}). Yellow Editor refused the save so a guarded edit cannot silently change behavior class.`,
    );
  }

  const beforeErrors = validationErrors(beforeProgram);
  const afterErrors = validationErrors(afterProgram);
  const newValidationErrors = [...afterErrors].filter(
    (fingerprint) => !beforeErrors.has(fingerprint),
  );

  if (newValidationErrors.length > 0) {
    throw new Error(
      `The edited script introduced ${newValidationErrors.length} new semantic validation error${newValidationErrors.length === 1 ? "" : "s"}. Yellow Editor refused the save.`,
    );
  }

  return {
    beforeShapes,
    afterShapes,
    newValidationErrors,
  };
}
