import type { MacroAnalysis } from "./macroCatalog";
import type { ProjectRgbdsSourceFile } from "./projectConstants";
import type {
  ProjectEventMacroSemantic,
  ProjectMovementVocabulary,
  ScriptAuditConstruct,
  ScriptAuditConstructKind,
  ScriptAuditExample,
  ScriptAuditFile,
  ScriptAuditReport,
  ScriptAuditStatus,
} from "./types";

const CPU_INSTRUCTIONS = new Set([
  "adc", "add", "and", "bit", "call", "ccf", "cp", "cpl", "daa",
  "dec", "di", "ei", "halt", "inc", "jp", "jr", "ld", "ldh", "nop",
  "or", "pop", "push", "res", "ret", "reti", "rl", "rla", "rlc",
  "rlca", "rr", "rra", "rrc", "rrca", "rst", "sbc", "scf", "set",
  "sla", "sra", "srl", "stop", "sub", "swap", "xor",
]);

const RGBDS_DIRECTIVES = new Set([
  "assert", "charmap", "db", "def", "dl", "ds", "dw", "elif", "else",
  "endc", "endr", "endu", "equ", "eq", "export", "fail", "for", "if",
  "import", "incbin", "include", "load", "newcharmap", "nextu", "opt",
  "popc", "pops", "pushc", "pushs", "purge", "rb", "rept", "rl", "rsreset",
  "rsset", "rw", "section", "setchar", "union", "warn",
]);

const DIRECT_SEMANTIC_CALLS = new Set([
  "CallFunctionInTable",
  "ExecuteCurMapScriptInTable",
  "DecodeArrowMovementRLE",
  "DecodeRLEList",
  "Delay3",
  "DelayFrames",
  "DisplayPokedex",
  "DisplayTextID",
  "EngageMapTrainer",
  "GiveItem",
  "GivePokemon",
  "HasEnoughCoins",
  "HasEnoughMoney",
  "InitBattleEnemyParameters",
  "IsItemInBag",
  "MoveSprite",
  "PlayCry",
  "PlayDefaultMusic",
  "PlayMusic",
  "PrintText",
  "SaveEndBattleTextPointers",
  "SetSpriteFacingDirectionAndDelay",
  "StartSimulatingJoypadStates",
  "TalkToTrainer",
  "YesNoChoice",
]);

const DIRECT_SEMANTIC_PREDEFS = new Set([
  "EmotionBubble",
  "DisplayElevatorFloorMenu",
  "DoInGameTradeDialogue",
  "FlagActionPredef",
  "GetQuantityOfItemInBag",
  "HealParty",
  "HideObject",
  "OaksAideScript",
  "ReplaceTileBlock",
  "ShowObject",
]);

const TEXT_SEMANTIC_MACROS = new Set([
  "text",
  "text_asm",
  "text_end",
  "text_far",
  "text_ram",
  "text_decimal",
  "line",
  "cont",
  "para",
  "page",
  "next",
  "prompt",
  "done",
]);

function isScriptFile(file: ProjectRgbdsSourceFile): boolean {
  return /^scripts\/.+\.asm$/i.test(file.path);
}

function withoutComment(line: string): string {
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === ";" && !quoted) return line.slice(0, index).trim();
  }
  return line.trim();
}

function isLabel(line: string): boolean {
  return (
    /^\.[A-Za-z_][A-Za-z0-9_.]*:{0,2}$/.test(line)
    || /^[A-Za-z_][A-Za-z0-9_]*:{1,2}$/.test(line)
  );
}

function directGlobalLabels(files: ProjectRgbdsSourceFile[]): Set<string> {
  const result = new Set<string>();
  for (const file of files) {
    for (const line of file.contents.split(/\r?\n/)) {
      const label = withoutComment(line).match(
        /^([A-Za-z_][A-Za-z0-9_]*):{1,2}$/,
      )?.[1];
      if (label) result.add(label);
    }
  }
  return result;
}

function scriptSetterLabels(files: ProjectRgbdsSourceFile[]): Set<string> {
  const result = new Set<string>();
  for (const file of files) {
    const lines = file.contents.split(/\r?\n/);
    let label: string | null = null;
    let body: string[] = [];

    const flush = () => {
      if (!label) return;
      const storesScript = body.some((line) =>
        /^ld\s+\[w[A-Za-z0-9_]*CurScript\]\s*,\s*a\b/i.test(line)
        || /^ld\s+\[wCurMapScript\]\s*,\s*a\b/i.test(line)
      );
      const overwritesA = body.some((line) =>
        /^ld\s+a\s*,/i.test(line) || /^xor\s+a\b/i.test(line)
      );
      if (storesScript && !overwritesA) result.add(label);
    };

    for (const sourceLine of lines) {
      const clean = withoutComment(sourceLine);
      const nextLabel = clean.match(/^([A-Za-z_][A-Za-z0-9_]*):{1,2}$/)?.[1];
      if (nextLabel) {
        flush();
        label = nextLabel;
        body = [];
        continue;
      }
      if (label && clean) body.push(clean);
    }
    flush();
  }
  return result;
}

function objectWrapperLabels(files: ProjectRgbdsSourceFile[]): Set<string> {
  const result = new Set<string>();
  for (const file of files) {
    const lines = file.contents.split(/\r?\n/);
    let label: string | null = null;
    let body: string[] = [];

    const flush = () => {
      if (!label) return;
      const storesObject = body.some((line) =>
        /^ld\s+\[wToggleableObjectIndex\]\s*,\s*a\b/i.test(line)
      );
      const performsAction = body.some((line) =>
        /^predef\s+(?:ShowObject|HideObject)\b/i.test(line)
      );
      const overwritesA = body.some((line) =>
        /^ld\s+a\s*,/i.test(line) || /^xor\s+a\b/i.test(line)
      );
      if (storesObject && performsAction && !overwritesA) result.add(label);
    };

    for (const sourceLine of lines) {
      const clean = withoutComment(sourceLine);
      const nextLabel = clean.match(/^([A-Za-z_][A-Za-z0-9_]*):{1,2}$/)?.[1];
      if (nextLabel) {
        flush();
        label = nextLabel;
        body = [];
        continue;
      }
      if (label && clean) body.push(clean);
    }
    flush();
  }
  return result;
}

function nextExecutable(lines: string[], index: number): string {
  for (let probe = index + 1; probe < Math.min(lines.length, index + 5); probe += 1) {
    const clean = withoutComment(lines[probe]);
    if (clean) return clean;
  }
  return "";
}

function semanticCall(
  name: string,
  line: string,
  lines: string[],
  index: number,
  movementVocabulary: ProjectMovementVocabulary,
  setterLabels: Set<string>,
  objectWrappers: Set<string>,
): string | null {
  if (
    DIRECT_SEMANTIC_CALLS.has(name)
    || /^RemoveItemByID(?:Bank[0-9A-F]+)?$/i.test(name)
    || /DisplayTextID/i.test(name)
    || movementVocabulary.consumers.some((consumer) => consumer.routine === name)
    || setterLabels.has(name)
    || objectWrappers.has(name)
  ) {
    return "Handled by the script semantic model.";
  }

  if (
    /^call\s+/i.test(line)
    && /^(?:jr|jp|ret)\s+(?:c|nc)\b/i.test(nextExecutable(lines, index))
  ) {
    return "Used as a carry/no-carry condition by the structured control-flow model.";
  }

  return null;
}

function projectTextCommandMacros(
  files: ProjectRgbdsSourceFile[],
): Set<string> {
  const result = new Set<string>();
  for (const file of files) {
    const lines = file.contents.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const start = withoutComment(lines[index]).match(
        /^MACRO\??\s+([A-Za-z_][A-Za-z0-9_#@.]*)\b/i,
      );
      if (!start) continue;

      let emitsTextCommand = false;
      for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
        const clean = withoutComment(lines[cursor]);
        if (/^ENDM\b/i.test(clean)) {
          index = cursor;
          break;
        }
        if (/^db\s+TX_[A-Z0-9_]+\b/i.test(clean)) {
          emitsTextCommand = true;
        }
      }
      if (emitsTextCommand) result.add(start[1].toLowerCase());
    }
  }
  return result;
}

function semanticMacroReason(
  name: string,
  eventMacros: Map<string, ProjectEventMacroSemantic>,
  textCommandMacros: Set<string>,
): string | null {
  if (eventMacros.has(name.toLowerCase())) {
    return "Event behavior is derived from this project's macro definition.";
  }
  if (TEXT_SEMANTIC_MACROS.has(name.toLowerCase())) {
    return "Handled by the dialogue/text model.";
  }
  if (textCommandMacros.has(name.toLowerCase())) {
    return "Project macro emits a text-engine command understood as part of the interaction language.";
  }
  if (/^(?:trainer|def_trainers)$/i.test(name)) {
    return "Defines trainer interaction data already modeled by Yellow Editor.";
  }
  if (/^map_coord_movement$/i.test(name)) {
    return "Defines coordinate-triggered movement data used by the movement model.";
  }
  if (/^def_script_pointers$/i.test(name)) {
    return "Defines the map script-state pointer table.";
  }
  if (/^dw_const$/i.test(name)) {
    return "Defines a typed project constant pointer.";
  }
  return null;
}

function wrapperMacroSemanticReason(
  name: string,
  target: string | undefined,
  movementVocabulary: ProjectMovementVocabulary,
  setterLabels: Set<string>,
  objectWrappers: Set<string>,
): string | null {
  if (!target) return null;
  const lower = name.toLowerCase();
  if (!["callfar", "farjp", "predef_jump"].includes(lower)) return null;

  if (
    DIRECT_SEMANTIC_CALLS.has(target)
    || DIRECT_SEMANTIC_PREDEFS.has(target)
    || /^RemoveItemByID(?:Bank[0-9A-F]+)?$/i.test(target)
    || /^Music_/i.test(target)
    || movementVocabulary.consumers.some((consumer) => consumer.routine === target)
    || setterLabels.has(target)
    || objectWrappers.has(target)
  ) {
    return `Project wrapper invokes semantic target ${target}.`;
  }

  return null;
}

interface ConstructAccumulator {
  name: string;
  kind: ScriptAuditConstructKind;
  status: ScriptAuditStatus;
  occurrences: number;
  paths: Set<string>;
  examples: ScriptAuditExample[];
  reason: string;
}

function addConstruct(
  constructs: Map<string, ConstructAccumulator>,
  status: ScriptAuditStatus,
  kind: ScriptAuditConstructKind,
  name: string,
  reason: string,
  example: ScriptAuditExample,
): string {
  const key = `${status}:${kind}:${name}`;
  const existing = constructs.get(key);
  if (existing) {
    existing.occurrences += 1;
    existing.paths.add(example.path);
    if (existing.examples.length < 4) existing.examples.push(example);
    return key;
  }
  constructs.set(key, {
    name,
    kind,
    status,
    occurrences: 1,
    paths: new Set([example.path]),
    examples: [example],
    reason,
  });
  return key;
}

function lineHead(line: string): string {
  return line.match(/^([A-Za-z_][A-Za-z0-9_#@.]*)\b/)?.[1] ?? "";
}

function isSemanticCpuLine(line: string): boolean {
  return (
    /^ld\s+\[wCurOpponent\]\s*,\s*a\b/i.test(line)
    || /^ld\s+\[wTrainerNo\]\s*,\s*a\b/i.test(line)
    || /^ld\s+\[w[A-Za-z0-9_]*CurScript\]\s*,\s*a\b/i.test(line)
    || /^ld\s+\[wCurMapScript\]\s*,\s*a\b/i.test(line)
    || /^ld\s+\[wToggleableObjectIndex\]\s*,\s*a\b/i.test(line)
    || /^ld\s+\[wSprite[0-9A-F]+StateData1(?:FacingDirection|MovementStatus)\]\s*,\s*a\b/i.test(line)
  );
}

export function buildScriptAudit(
  files: ProjectRgbdsSourceFile[],
  macroAnalysis: MacroAnalysis,
  movementVocabulary: ProjectMovementVocabulary,
  eventMacroSemantics: ProjectEventMacroSemantic[],
): ScriptAuditReport {
  const scriptFiles = files.filter(isScriptFile);
  const macroDefinitions = new Set(
    macroAnalysis.catalog.macros.map((macro) => macro.name.toLowerCase()),
  );
  const eventMacros = new Map(
    eventMacroSemantics.map((semantic) => [semantic.name.toLowerCase(), semantic]),
  );
  const textCommandMacros = projectTextCommandMacros(files);
  const labels = directGlobalLabels(files);
  const setterLabels = scriptSetterLabels(files);
  const objectWrappers = objectWrapperLabels(files);
  const constructs = new Map<string, ConstructAccumulator>();
  const auditFiles: ScriptAuditFile[] = [];

  let meaningfulLineCount = 0;
  let semanticLineCount = 0;
  let structuralLineCount = 0;
  let unresolvedLineCount = 0;
  let semanticInvocationCount = 0;
  let structuralInvocationCount = 0;
  let unresolvedInvocationCount = 0;

  for (const file of scriptFiles) {
    const lines = file.contents.split(/\r?\n/);
    const macroCalls = new Map(
      (macroAnalysis.callsByScriptPath.get(file.path)?.calls ?? [])
        .map((call) => [call.line, call]),
    );

    let fileSemantic = 0;
    let fileStructural = 0;
    let fileUnresolved = 0;
    let fileSemanticInvocations = 0;
    let fileStructuralInvocations = 0;
    let fileUnresolvedInvocations = 0;
    const unresolvedKeys = new Set<string>();
    const structuralInvocationKeys = new Set<string>();

    lines.forEach((sourceLine, index) => {
      const lineNumber = index + 1;
      const clean = withoutComment(sourceLine);
      if (!clean) return;

      meaningfulLineCount += 1;
      const example = { path: file.path, line: lineNumber, source: clean };

      if (isLabel(clean)) {
        structuralLineCount += 1;
        fileStructural += 1;
        return;
      }

      const invocation = clean.match(
        /^(call|farcall|predef)\s+(?:(?:z|nz|c|nc)\s*,\s*)?([A-Za-z_.][A-Za-z0-9_.]*)\b/i,
      );
      if (invocation) {
        const kind = invocation[1].toLowerCase() as "call" | "farcall" | "predef";
        const name = invocation[2];
        const semanticReason = kind === "predef" && DIRECT_SEMANTIC_PREDEFS.has(name)
          ? "Handled by the script semantic model."
          : kind === "farcall" && /^Music_/i.test(name)
            ? "Handled as project music playback."
            : semanticCall(
                name,
                clean,
                lines,
                index,
                movementVocabulary,
                setterLabels,
                objectWrappers,
              );

        if (semanticReason) {
          const key = addConstruct(
            constructs,
            "semantic",
            kind,
            name,
            semanticReason,
            example,
          );
          void key;
          semanticLineCount += 1;
          fileSemantic += 1;
          semanticInvocationCount += 1;
          fileSemanticInvocations += 1;
          return;
        }

        const reason = labels.has(name)
          ? "Project routine is resolved, but Yellow Editor has not promoted its gameplay meaning yet."
          : "Invocation syntax is understood, but the target does not yet have a semantic handler.";
        const key = addConstruct(
          constructs,
          "structural",
          kind,
          name,
          reason,
          example,
        );
        structuralLineCount += 1;
        fileStructural += 1;
        structuralInvocationCount += 1;
        fileStructuralInvocations += 1;
        structuralInvocationKeys.add(key);
        return;
      }

      const macroCall = macroCalls.get(lineNumber);
      if (macroCall) {
        const semanticReason = semanticMacroReason(
          macroCall.name,
          eventMacros,
          textCommandMacros,
        ) ?? wrapperMacroSemanticReason(
          macroCall.name,
          macroCall.arguments[0]?.raw,
          movementVocabulary,
          setterLabels,
          objectWrappers,
        );
        if (semanticReason) {
          addConstruct(
            constructs,
            "semantic",
            "macro",
            macroCall.name,
            semanticReason,
            example,
          );
          semanticLineCount += 1;
          fileSemantic += 1;
          semanticInvocationCount += 1;
          fileSemanticInvocations += 1;
          return;
        }

        const key = addConstruct(
          constructs,
          "structural",
          "macro",
          macroCall.name,
          "Macro definition and arguments are understood, but no beginner-facing gameplay semantic has been assigned yet.",
          example,
        );
        structuralLineCount += 1;
        fileStructural += 1;
        structuralInvocationCount += 1;
        fileStructuralInvocations += 1;
        structuralInvocationKeys.add(key);
        return;
      }

      if (isSemanticCpuLine(clean)) {
        semanticLineCount += 1;
        fileSemantic += 1;
        return;
      }

      const head = lineHead(clean);
      const lowerHead = head.toLowerCase();
      if (CPU_INSTRUCTIONS.has(lowerHead)) {
        structuralLineCount += 1;
        fileStructural += 1;
        return;
      }

      if (
        RGBDS_DIRECTIVES.has(lowerHead)
        || /^(?:db|dw|dl|ds)\b/i.test(clean)
      ) {
        structuralLineCount += 1;
        fileStructural += 1;
        return;
      }

      if (head && macroDefinitions.has(lowerHead)) {
        const firstArgument = clean.slice(head.length).trim().split(",")[0]?.trim();
        const semanticReason = semanticMacroReason(
          head,
          eventMacros,
          textCommandMacros,
        ) ?? wrapperMacroSemanticReason(
          head,
          firstArgument,
          movementVocabulary,
          setterLabels,
          objectWrappers,
        );
        if (semanticReason) {
          addConstruct(
            constructs,
            "semantic",
            "macro",
            head,
            semanticReason,
            example,
          );
          semanticLineCount += 1;
          fileSemantic += 1;
          semanticInvocationCount += 1;
          fileSemanticInvocations += 1;
        } else {
          const key = addConstruct(
            constructs,
            "structural",
            "macro",
            head,
            "Macro is defined by the loaded project, but its gameplay meaning has not been promoted yet.",
            example,
          );
          structuralLineCount += 1;
          fileStructural += 1;
          structuralInvocationCount += 1;
          fileStructuralInvocations += 1;
          structuralInvocationKeys.add(key);
        }
        return;
      }

      const unresolvedName = head || clean;
      const key = addConstruct(
        constructs,
        "unresolved",
        "instruction",
        unresolvedName,
        "Yellow Editor could not classify this source construct as RGBDS syntax, a discovered macro, or a known script semantic.",
        example,
      );
      unresolvedLineCount += 1;
      fileUnresolved += 1;
      unresolvedInvocationCount += 1;
      fileUnresolvedInvocations += 1;
      unresolvedKeys.add(key);
    });

    auditFiles.push({
      path: file.path,
      semanticLines: fileSemantic,
      structuralLines: fileStructural,
      unresolvedLines: fileUnresolved,
      meaningfulLines: fileSemantic + fileStructural + fileUnresolved,
      semanticInvocationCount: fileSemanticInvocations,
      structuralInvocationCount: fileStructuralInvocations,
      unresolvedInvocationCount: fileUnresolvedInvocations,
      unresolvedKeys: [...unresolvedKeys],
      structuralInvocationKeys: [...structuralInvocationKeys],
    });
  }

  const constructList: ScriptAuditConstruct[] = [...constructs.entries()]
    .map(([key, value]) => ({
      key,
      name: value.name,
      kind: value.kind,
      status: value.status,
      occurrences: value.occurrences,
      paths: [...value.paths].sort(),
      examples: value.examples,
      reason: value.reason,
    }))
    .sort((left, right) => {
      const statusOrder: Record<ScriptAuditStatus, number> = {
        unresolved: 0,
        structural: 1,
        semantic: 2,
      };
      return statusOrder[left.status] - statusOrder[right.status]
        || right.occurrences - left.occurrences
        || left.name.localeCompare(right.name);
    });

  return {
    fileCount: scriptFiles.length,
    meaningfulLineCount,
    semanticLineCount,
    structuralLineCount,
    unresolvedLineCount,
    semanticInvocationCount,
    structuralInvocationCount,
    unresolvedInvocationCount,
    files: auditFiles.sort((left, right) =>
      right.unresolvedInvocationCount - left.unresolvedInvocationCount
      || right.structuralInvocationCount - left.structuralInvocationCount
      || left.path.localeCompare(right.path)
    ),
    constructs: constructList,
    warnings: [
      ...macroAnalysis.catalog.warnings,
      ...movementVocabulary.warnings,
      ...files
        .filter((file) => file.readError)
        .map((file) => `${file.path}: ${file.readError}`),
    ],
  };
}
