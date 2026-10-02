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
  validateMapScriptProgram,
  type MapScriptValidationIssue,
} from "./mapScriptValidation";
import type {
  ProjectEventMacroSemantic,
  ProjectMovementVocabulary,
  ProjectRgbdsSourceFile,
  ScriptRoundTripRegressionCase,
  ScriptRoundTripRegressionFixture,
  ScriptRoundTripRegressionReport,
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


const MAX_CASES_PER_FIXTURE = 12;

function alternateDomainValue(
  analysis: MacroAnalysis,
  domainIds: string[],
  current: string,
): string | null {
  if (domainIds.length === 0) return null;
  const domains = domainIds
    .map((domainId) => analysis.catalog.domains.find((domain) => domain.id === domainId))
    .filter((domain): domain is NonNullable<typeof domain> => Boolean(domain));
  if (domains.length !== domainIds.length || domains.length === 0) return null;

  return domains[0].options
    .map((option) => option.value)
    .find((value) =>
      value !== current
      && domains.every((domain) =>
        domain.options.some((option) => option.value === value)
      )
    ) ?? null;
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
    const testedShapes = new Set<string>();
    const candidateShapes = new Set<string>();

    for (const path of fixture.paths) {
      if (cases.length >= MAX_CASES_PER_FIXTURE) break;
      const sourceFile = filesByPath.get(path);
      if (!sourceFile || sourceFile.readError) continue;
      const calls = analysis.callsByScriptPath.get(path)?.calls ?? [];

      for (const call of calls) {
        if (cases.length >= MAX_CASES_PER_FIXTURE) break;

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
          if (cases.length >= MAX_CASES_PER_FIXTURE) break;
          const current = editDocument.arguments[editable.index - 1];
          const next = alternateDomainValue(
            analysis,
            editable.domainIds,
            current,
          );
          if (!next) continue;

          const shapeKey = [
            call.name.toLowerCase(),
            String(editable.index),
            [...editable.domainIds].sort().join("|"),
          ].join(":");
          candidateShapes.add(shapeKey);
          if (testedShapes.has(shapeKey)) continue;
          testedShapes.add(shapeKey);

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
          }

          cases.push(resultCase);
        }
      }
    }

    const passedCaseCount = cases.filter((entry) => entry.passed).length;
    const failedCaseCount = cases.length - passedCaseCount;
    fixtures.push({
      id: fixture.id,
      label: fixture.label,
      candidateShapeCount: candidateShapes.size,
      testedCaseCount: cases.length,
      passedCaseCount,
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
  const testedFixtureCount = fixtures.filter(
    (fixture) => fixture.testedCaseCount > 0,
  ).length;

  return {
    fixtureCount: fixtures.length,
    testedFixtureCount,
    testedCaseCount,
    passedCaseCount,
    failedCaseCount,
    passed: testedCaseCount > 0 && failedCaseCount === 0,
    fixtures,
  };
}
