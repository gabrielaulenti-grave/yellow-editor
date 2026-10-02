import { hashText } from "./history";
import type { MacroAnalysis } from "./macroCatalog";
import {
  parseMapScriptProgram,
  type MapScriptProgram,
} from "./mapScriptProgram";
import { validateMapScriptProgram } from "./mapScriptValidation";
import { scriptSemanticNodeShape } from "./scriptRoundTripValidation";
import type {
  ProjectEventMacroSemantic,
  ProjectMovementVocabulary,
  ProjectSemanticDomainOption,
  ScriptSimpleActionCreateDocument,
  ScriptSimpleActionCreateValues,
  TextWriteRequest,
} from "./types";

interface SafeRoutineInsertion {
  insertionIndex: number;
  insertionLine: number;
  indent: string;
}

interface EventBuilderMacro {
  name: string;
  options: ProjectSemanticDomainOption[];
}

function withoutComment(line: string): string {
  const index = line.indexOf(";");
  return (index >= 0 ? line.slice(0, index) : line).trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
}

function safeRoutineInsertion(
  source: string,
  routineLabel: string,
): SafeRoutineInsertion {
  const lines = source.split(/\r?\n/);
  const startPattern = new RegExp(
    `^\\\\s*${escapeRegExp(routineLabel)}:{1,2}\\\\s*(?:;.*)?$`,
  );
  const start = lines.findIndex((line) => startPattern.test(line));
  if (start < 0) {
    throw new Error(`Routine '${routineLabel}' was not found in this script file.`);
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\s*[A-Za-z_][A-Za-z0-9_]*:{1,2}\s*(?:;.*)?$/.test(lines[index])) {
      end = index;
      break;
    }
  }

  const executable: Array<{ index: number; clean: string }> = [];
  for (let index = start + 1; index < end; index += 1) {
    const clean = withoutComment(lines[index]);
    if (!clean) continue;
    if (/^\.[A-Za-z_][A-Za-z0-9_.]*:{0,2}$/.test(clean)) {
      throw new Error(
        "This routine contains local branch labels, so Yellow Editor will not append generated actions to it yet.",
      );
    }
    if (/^(?:jr|jp)\b/i.test(clean)) {
      throw new Error(
        "This routine contains explicit jumps, so it does not have one proven straight-line insertion point.",
      );
    }
    executable.push({ index, clean });
  }

  const final = executable[executable.length - 1];
  if (!final || !/^ret\s*$/i.test(final.clean)) {
    throw new Error(
      "This routine does not end in one unconditional ret, so generated actions remain read-only for now.",
    );
  }
  if (executable.slice(0, -1).some((entry) => /^ret\b/i.test(entry.clean))) {
    throw new Error(
      "This routine has more than one return path, so Yellow Editor cannot prove a single safe append point.",
    );
  }

  return {
    insertionIndex: final.index,
    insertionLine: final.index + 1,
    indent: lines[final.index].match(/^\s*/)?.[0] || "\t",
  };
}

function eventBuilderMacro(
  action: "set" | "reset",
  analysis: MacroAnalysis,
  eventMacroSemantics: ProjectEventMacroSemantic[],
): EventBuilderMacro | null {
  const semantic = eventMacroSemantics.find((candidate) =>
    candidate.action === action
    && candidate.eventParameterIndexes.length === 1
  );
  if (!semantic) return null;

  const parameterIndex = semantic.eventParameterIndexes[0];
  const definition = analysis.catalog.macros.find(
    (candidate) => candidate.name.toLowerCase() === semantic.name.toLowerCase(),
  );
  if (
    !definition
    || parameterIndex !== 1
    || definition.parameters.length !== 1
  ) {
    return null;
  }
  const domainIds = new Set(
    definition?.parameters[parameterIndex - 1]?.semanticDomains
      .map((domain) => domain.domainId) ?? [],
  );

  for (const document of analysis.callsByScriptPath.values()) {
    for (const call of document.calls) {
      if (call.name.toLowerCase() !== semantic.name.toLowerCase()) continue;
      for (const domain of call.arguments[parameterIndex - 1]?.semanticDomains ?? []) {
        domainIds.add(domain.domainId);
      }
    }
  }

  const options = [...domainIds]
    .flatMap((domainId) =>
      analysis.catalog.domains.find((domain) => domain.id === domainId)?.options ?? []
    )
    .filter((option, index, entries) =>
      entries.findIndex((candidate) => candidate.value === option.value) === index
    )
    .sort((left, right) => left.label.localeCompare(right.label));

  return options.length > 0
    ? { name: semantic.name, options }
    : null;
}

function stateShapeMap(program: MapScriptProgram): Map<string, string[]> {
  return new Map(program.states.map((state) => [
    state.label,
    state.nodes.map(scriptSemanticNodeShape),
  ]));
}

function topology(program: MapScriptProgram): string[] {
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

function equalStrings(left: string[], right: string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function validateGeneratedInsertion(
  beforeSource: string,
  afterSource: string,
  routineLabel: string,
  expectedShape: string,
  movementVocabulary: ProjectMovementVocabulary,
  eventMacroSemantics: ProjectEventMacroSemantic[],
): void {
  const before = parseMapScriptProgram(
    beforeSource,
    routineLabel,
    movementVocabulary,
    eventMacroSemantics,
  );
  const after = parseMapScriptProgram(
    afterSource,
    routineLabel,
    movementVocabulary,
    eventMacroSemantics,
  );

  if (!equalStrings(topology(before), topology(after))) {
    throw new Error(
      "Generated source changed script states or transitions. Yellow Editor refused the insertion.",
    );
  }

  const beforeShapes = stateShapeMap(before);
  const afterShapes = stateShapeMap(after);
  const targetBefore = beforeShapes.get(routineLabel);
  const targetAfter = afterShapes.get(routineLabel);
  if (!targetBefore || !targetAfter) {
    throw new Error(
      "Yellow Editor could not reparse the target routine as the same map-script state after generation.",
    );
  }

  for (const [label, shapes] of beforeShapes) {
    const nextShapes = afterShapes.get(label);
    if (!nextShapes) {
      throw new Error(`Generated source removed parsed state '${label}'.`);
    }
    if (label === routineLabel) {
      const expected = [...shapes, expectedShape];
      if (!equalStrings(expected, nextShapes)) {
        throw new Error(
          `Generated source did not reparse as exactly one new ${expectedShape} action.`,
        );
      }
    } else if (!equalStrings(shapes, nextShapes)) {
      throw new Error(
        `Generated source changed unrelated semantic state '${label}'. Yellow Editor refused the insertion.`,
      );
    }
  }

  const beforeErrors = new Set(
    validateMapScriptProgram(before)
      .filter((issue) => issue.severity === "error")
      .map((issue) => `${issue.code}:${issue.stateLabel ?? ""}`),
  );
  const introduced = validateMapScriptProgram(after)
    .filter((issue) => issue.severity === "error")
    .map((issue) => `${issue.code}:${issue.stateLabel ?? ""}`)
    .filter((fingerprint) => !beforeErrors.has(fingerprint));
  if (introduced.length > 0) {
    throw new Error(
      `Generated source introduced ${introduced.length} semantic validation error${introduced.length === 1 ? "" : "s"}.`,
    );
  }
}

export async function loadScriptSimpleActionCreateDocument(
  sourceText: string,
  path: string,
  routineLabel: string,
  analysis: MacroAnalysis,
  movementVocabulary: ProjectMovementVocabulary,
  eventMacroSemantics: ProjectEventMacroSemantic[],
): Promise<ScriptSimpleActionCreateDocument> {
  const insertion = safeRoutineInsertion(sourceText, routineLabel);
  const program = parseMapScriptProgram(
    sourceText,
    routineLabel,
    movementVocabulary,
    eventMacroSemantics,
  );
  const target = program.states.find((state) => state.label === routineLabel);
  if (!target || target.external) {
    throw new Error(
      "This routine is not a directly parsed map-script state, so generated actions remain read-only for now.",
    );
  }

  const setMacro = eventBuilderMacro("set", analysis, eventMacroSemantics);
  const resetMacro = eventBuilderMacro("reset", analysis, eventMacroSemantics);
  const availableActions: ScriptSimpleActionCreateDocument["availableActions"] = [
    ...(setMacro ? ["set-event" as const] : []),
    ...(resetMacro ? ["reset-event" as const] : []),
    "wait",
  ];
  return {
    path,
    routineLabel,
    sourceHash: await hashText(sourceText),
    insertionLine: insertion.insertionLine,
    availableActions,
    eventOptions: {
      "set-event": [...(setMacro?.options ?? [])],
      "reset-event": [...(resetMacro?.options ?? [])],
    },
  };
}

export async function prepareScriptSimpleActionWrite(
  sourceText: string,
  document: ScriptSimpleActionCreateDocument,
  values: ScriptSimpleActionCreateValues,
  analysis: MacroAnalysis,
  movementVocabulary: ProjectMovementVocabulary,
  eventMacroSemantics: ProjectEventMacroSemantic[],
): Promise<TextWriteRequest> {
  if (await hashText(sourceText) !== document.sourceHash) {
    throw new Error(
      `${document.path} changed after the action form was loaded. Reload Scripts before adding the action.`,
    );
  }
  if (!document.availableActions.includes(values.action)) {
    throw new Error("This action is not available for the loaded project/routine.");
  }

  const insertion = safeRoutineInsertion(sourceText, document.routineLabel);
  if (insertion.insertionLine !== document.insertionLine) {
    throw new Error(
      "The routine insertion point changed. Reload Scripts before adding an action.",
    );
  }

  const generated: string[] = [];
  let expectedShape: string;
  if (values.action === "wait") {
    const frames = values.frames;
    if (!Number.isInteger(frames) || (frames ?? 0) < 1 || (frames ?? 0) > 255) {
      throw new Error("Wait duration must be a whole number from 1 to 255 frames.");
    }
    generated.push(
      `${insertion.indent}ld c, ${frames}`,
      `${insertion.indent}call DelayFrames`,
    );
    expectedShape = "wait";
  } else {
    const event = values.event?.trim();
    if (!event) throw new Error("Choose an event flag.");
    const action = values.action === "set-event" ? "set" : "reset";
    const macro = eventBuilderMacro(action, analysis, eventMacroSemantics);
    if (!macro || !macro.options.some((option) => option.value === event)) {
      throw new Error(
        "The selected event is not in the project-derived domain for this event action.",
      );
    }
    generated.push(`${insertion.indent}${macro.name} ${event}`);
    expectedShape = `event:${action}`;
  }

  const lines = sourceText.split(/\r?\n/);
  lines.splice(insertion.insertionIndex, 0, ...generated);
  const newline = sourceText.includes("\r\n") ? "\r\n" : "\n";
  const contents = lines.join(newline);

  validateGeneratedInsertion(
    sourceText,
    contents,
    document.routineLabel,
    expectedShape,
    movementVocabulary,
    eventMacroSemantics,
  );

  return {
    path: document.path,
    contents,
    expectedHash: document.sourceHash,
  };
}
