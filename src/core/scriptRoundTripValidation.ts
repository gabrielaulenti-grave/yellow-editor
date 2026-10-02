import {
  parseMapScriptProgram,
  type MapScriptProgram,
  type MapScriptSemanticNode,
} from "./mapScriptProgram";
import type { MacroAnalysis } from "./macroCatalog";
import {
  loadScriptMacroEditDocument,
  prepareScriptMacroCallWrite,
} from "./scriptMacroEditing";
import { SCRIPT_REGRESSION_FIXTURES } from "./scriptSemanticIr";
import {
  analyzeTextScript,
  type TextScriptInsight,
} from "./textScriptAnalysis";
import {
  validateMapScriptProgram,
  type MapScriptValidationIssue,
} from "./mapScriptValidation";
import type { ProjectRgbdsSourceFile } from "./projectConstants";
import type {
  ProjectEventMacroSemantic,
  ProjectMovementVocabulary,
  ScriptRoundTripRegressionCase,
  ScriptRoundTripRegressionFixture,
  ScriptRoundTripRegressionReport,
} from "./types";

export function scriptSemanticNodeShape(node: MapScriptSemanticNode): string {
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
    .map(scriptSemanticNodeShape)
    .sort();
}

function semanticLayoutFingerprint(program: MapScriptProgram): string[] {
  return program.states
    .flatMap((state) =>
      state.nodes.map((node) => [
        state.label,
        String(node.source.lineStart),
        String(node.source.lineEnd),
        scriptSemanticNodeShape(node),
      ].join(":"))
    )
    .sort();
}

function topologyFingerprint(program: MapScriptProgram): string[] {
  return program.states.map((state) => JSON.stringify({
    label: state.label,
    scriptConstant: state.scriptConstant,
    external: state.external,
    transitions: state.transitions.map((transition) => ({
      targetConstant: transition.targetConstant,
      targetLabel: transition.targetLabel,
    })),
  }));
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

export class ScriptRoundTripGuardError extends Error {
  constructor(
    message: string,
    readonly reason: "semantic-contract" | "source-preservation" = "semantic-contract",
  ) {
    super(message);
    this.name = "ScriptRoundTripGuardError";
  }
}

function sourceNeighbors(source: string, line: number): [string, string] {
  if (!Number.isInteger(line) || line < 1) {
    throw new RangeError("The edited source line must be a positive integer.");
  }
  let start = 0;
  for (let index = 1; index < line; index += 1) {
    const newline = source.indexOf("\n", start);
    if (newline < 0) {
      throw new RangeError("The edited source line is outside the file.");
    }
    start = newline + 1;
  }
  const newline = source.indexOf("\n", start);
  const end = newline < 0 ? source.length
    : newline > start && source[newline - 1] === "\r" ? newline - 1 : newline;
  return [source.slice(0, start), source.slice(end)];
}

function sourceLabelAtLine(source: string, line: number): string | null {
  const lines = source.split(/\r?\n/);
  for (let index = Math.min(line - 1, lines.length - 1); index >= 0; index -= 1) {
    const label = lines[index].match(
      /^\s*([A-Za-z_][A-Za-z0-9_]*):{1,2}\s*(?:;.*)?$/,
    )?.[1];
    if (label) return label;
  }
  return null;
}

function textInsightShape(insight: TextScriptInsight): string {
  switch (insight.type) {
    case "dialogue": return "dialogue";
    case "condition": return "condition";
    case "choice": return `choice:${insight.choice}`;
    case "give-item": return "give-item";
    case "give-pokemon": return "give-pokemon";
    case "inventory": return `inventory:${insight.action}`;
    case "remove-item": return "remove-item";
    case "trade": return "trade";
    case "cry": return "cry";
    case "pokedex": return "pokedex";
    case "event": return `event:${insight.action}`;
    case "object": return `object:${insight.action}`;
    case "trainer": return "trainer";
    case "battle": return "battle";
    case "transition": return "transition";
    case "wait": return "wait";
    case "emotion": return "emotion";
    case "control": return `control:${insight.action}`;
    case "facing": return `facing:${insight.actor}`;
    case "battle-dialogue": return "battle-dialogue";
    case "economy": return `economy:${insight.action}`;
    case "service": return `service:${insight.action}`;
  }
  const exhaustive: never = insight;
  return exhaustive;
}

function textScriptShapes(
  source: string,
  line: number,
  eventMacroSemantics: ProjectEventMacroSemantic[],
): string[] {
  const label = sourceLabelAtLine(source, line);
  if (!label) return [];
  return analyzeTextScript(source, label, eventMacroSemantics)
    .map(textInsightShape);
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
  if (!arraysEqual(sourceNeighbors(beforeSource, line), sourceNeighbors(afterSource, line))) {
    throw new ScriptRoundTripGuardError(
      "The edited source changed neighboring bytes or line endings. Yellow Editor refused the save because a guarded parameter edit may only replace values on its source line.",
      "source-preservation",
    );
  }
  const focusLabel = sourceLabelAtLine(beforeSource, line) ?? undefined;
  const beforeProgram = parseMapScriptProgram(
    beforeSource,
    focusLabel,
    movementVocabulary,
    eventMacroSemantics,
  );
  const afterProgram = parseMapScriptProgram(
    afterSource,
    focusLabel,
    movementVocabulary,
    eventMacroSemantics,
  );

  const beforeShapes = semanticShapesAtLine(beforeProgram, line);
  const afterShapes = semanticShapesAtLine(afterProgram, line);
  const beforeTextShapes = textScriptShapes(
    beforeSource,
    line,
    eventMacroSemantics,
  );
  const afterTextShapes = textScriptShapes(
    afterSource,
    line,
    eventMacroSemantics,
  );
  const beforeLayout = semanticLayoutFingerprint(beforeProgram);
  const afterLayout = semanticLayoutFingerprint(afterProgram);
  const beforeTopology = topologyFingerprint(beforeProgram);
  const afterTopology = topologyFingerprint(afterProgram);

  if (!arraysEqual(beforeTopology, afterTopology)) {
    throw new ScriptRoundTripGuardError(
      "The edited source changed map-script states or transitions. Yellow Editor refused the save because guarded parameter edits may not alter control-flow topology.",
    );
  }

  if (!arraysEqual(beforeLayout, afterLayout)) {
    throw new ScriptRoundTripGuardError(
      "The edited source changed the script's semantic-node layout. Yellow Editor refused the save because a guarded parameter edit may change values, but not behavior classes or source structure.",
    );
  }

  if (!arraysEqual(beforeShapes, afterShapes)) {
    throw new ScriptRoundTripGuardError(
      `The edited source changed its semantic IR shape (${beforeShapes.join(", ")} → ${afterShapes.join(", ") || "no semantic node"}). Yellow Editor refused the save so a guarded edit cannot silently change behavior class.`,
    );
  }

  if (!arraysEqual(beforeTextShapes, afterTextShapes)) {
    throw new ScriptRoundTripGuardError(
      "The edited source changed the recognized executable text-script flow. Yellow Editor refused the save because guarded dialogue/service edits may change values, but not condition, reward, event, or service structure.",
    );
  }

  const beforeErrors = validationErrors(beforeProgram);
  const afterErrors = validationErrors(afterProgram);
  const newValidationErrors = [...afterErrors].filter(
    (fingerprint) => !beforeErrors.has(fingerprint),
  );

  if (newValidationErrors.length > 0) {
    throw new ScriptRoundTripGuardError(
      `The edited script introduced ${newValidationErrors.length} new semantic validation error${newValidationErrors.length === 1 ? "" : "s"}. Yellow Editor refused the save.`,
    );
  }

  return {
    beforeShapes,
    afterShapes,
    newValidationErrors,
  };
}


export async function runScriptRoundTripRegression(
  files: ProjectRgbdsSourceFile[],
  analysis: MacroAnalysis,
  movementVocabulary: ProjectMovementVocabulary,
  eventMacroSemantics: ProjectEventMacroSemantic[],
): Promise<ScriptRoundTripRegressionReport> {
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  const fixtures: ScriptRoundTripRegressionFixture[] = [];

  for (const fixture of SCRIPT_REGRESSION_FIXTURES) {
    const cases: ScriptRoundTripRegressionCase[] = [];
    const candidateShapes = new Set<string>();

    for (const path of fixture.paths) {
      const sourceFile = filesByPath.get(path);
      if (!sourceFile || sourceFile.readError) continue;
      const calls = analysis.callsByScriptPath.get(path)?.calls ?? [];

      for (const call of calls) {
        let editDocument;
        try {
          editDocument = await loadScriptMacroEditDocument(
            sourceFile.contents,
            path,
            call.line,
            analysis,
          );
        } catch {
          continue;
        }

        for (const editable of editDocument.editableArgumentDomains) {
          const current = editDocument.arguments[editable.index - 1];
          const next = editable.allowedValues.find(
            (value) => value !== current,
          ) ?? null;
          if (!next) continue;

          const shapeKey = [
            call.name.toLowerCase(),
            String(editable.index),
            [...editable.domainIds].sort().join("|"),
          ].join(":");
          candidateShapes.add(shapeKey);

          const nextArguments = [...editDocument.arguments];
          nextArguments[editable.index - 1] = next;
          const resultCase: ScriptRoundTripRegressionCase = {
            path,
            line: call.line,
            macroName: call.name,
            argumentIndex: editable.index,
            previousValue: current,
            nextValue: next,
            passed: false,
            beforeShapes: [],
            afterShapes: [],
          };

          try {
            const write = await prepareScriptMacroCallWrite(
              sourceFile.contents,
              path,
              call.line,
              call.name,
              editDocument.sourceHash,
              nextArguments,
              analysis,
            );
            const validation = validateScriptSemanticRoundTrip(
              sourceFile.contents,
              write.contents,
              call.line,
              movementVocabulary,
              eventMacroSemantics,
            );
            resultCase.passed = true;
            resultCase.beforeShapes = validation.beforeShapes;
            resultCase.afterShapes = validation.afterShapes;
          } catch (error) {
            resultCase.error = String(error);
            resultCase.refused = error instanceof ScriptRoundTripGuardError
              && error.reason === "semantic-contract";
          }

          cases.push(resultCase);
        }
      }
    }

    const passedCaseCount = cases.filter((entry) => entry.passed).length;
    const refusedCaseCount = cases.filter((entry) => entry.refused).length;
    const failedCaseCount = cases.length - passedCaseCount - refusedCaseCount;
    fixtures.push({
      id: fixture.id,
      label: fixture.label,
      candidateShapeCount: candidateShapes.size,
      testedCaseCount: cases.length,
      passedCaseCount,
      refusedCaseCount,
      failedCaseCount,
      passed: cases.length > 0 && failedCaseCount === 0,
      cases,
    });
  }

  const testedCaseCount = fixtures.reduce(
    (sum, fixture) => sum + fixture.testedCaseCount,
    0,
  );
  const passedCaseCount = fixtures.reduce(
    (sum, fixture) => sum + fixture.passedCaseCount,
    0,
  );
  const failedCaseCount = fixtures.reduce(
    (sum, fixture) => sum + fixture.failedCaseCount,
    0,
  );
  const refusedCaseCount = fixtures.reduce(
    (sum, fixture) => sum + fixture.refusedCaseCount,
    0,
  );
  const testedFixtureCount = fixtures.filter(
    (fixture) => fixture.testedCaseCount > 0,
  ).length;

  return {
    fixtureCount: fixtures.length,
    testedFixtureCount,
    testedCaseCount,
    passedCaseCount,
    refusedCaseCount,
    failedCaseCount,
    passed: testedCaseCount > 0 && failedCaseCount === 0,
    fixtures,
  };
}
