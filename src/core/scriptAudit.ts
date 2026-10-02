import type { MacroAnalysis } from "./macroCatalog";
import type { ProjectRgbdsSourceFile } from "./projectConstants";
import {
  SCRIPT_REGRESSION_FIXTURES,
  SCRIPT_SEMANTIC_FAMILIES,
  SCRIPT_SEMANTIC_IR_VERSION,
  isScriptEngineInternalCall,
  isScriptEngineInternalMacro,
} from "./scriptSemanticIr";
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
  "CeruleanHideRocket",
  "PewterJigglypuff",
  "SurfingPikachuMinigame",
  "SaveGameData",
  "GiveFossilToCinnabarLab",
  "DisplayNameRaterScreen",
  "RemoveGuardDrink",
  "SchedulePikachuSpawnForAfterText",
  "RemovePokemon",
  "RemoveItemFromInventory",
  "PrintText_NoCreatingTextBox",
  "MoveMon",
  "LoadMonData",
  "EnablePikachuOverworldSpriteDrawing",
  "DisplayTextBoxID",
  "DisplayPartyMenu",
  "DisableWaitingAfterTextDisplay",
  "DisablePikachuOverworldSpriteDrawing",
  "DelayFrame",
  "CountSetBits",
  "CheckPikachuFollowingPlayer",
  "AddPartyMon",
  "PlayPikachuSoundClip",
  "Has9990Coins",
  "CheckPikachuStatusCondition",
  "Random",
  "LoadItemList",
  "GetPartyMonName",
  "GetMonName",
  "EndTrainerBattle",
  "DisplayEnemyTrainerTextAndStartBattle",
  "CheckFightingMapTrainers",
  "ArePlayerCoordsInArray",
  "CheckBoulderCoords",
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
  "IsPlayerOnDungeonWarp",
  "MoveSprite",
  "PlayCry",
  "PlayDefaultMusic",
  "PlayMusic",
  "PrintText",
  "SaveEndBattleTextPointers",
  "SetSpriteFacingDirectionAndDelay",
  "SetSpriteMovementBytesToFF",
  "StartSimulatingJoypadStates",
  "ForceBikeOrSurf",
  "TalkToTrainer",
  "YesNoChoice",
]);

const DIRECT_SEMANTIC_PREDEFS = new Set([
  "HallOfFamePC",
  "WriteMonMoves",
  "SubBCDPredef",
  "FindPathToPlayer",
  "DivideBCDPredef3",
  "DisplayDexRating",
  "CalcPositionOfPlayerRelativeToNPC",
  "AddBCDPredef",
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

interface ScriptRoutineBody {
  label: string;
  path: string;
  lines: string[];
}

function scriptRoutineBodies(files: ProjectRgbdsSourceFile[]): ScriptRoutineBody[] {
  const result: ScriptRoutineBody[] = [];
  for (const file of files.filter(isScriptFile)) {
    const lines = file.contents.split(/\r?\n/);
    let label: string | null = null;
    let body: string[] = [];

    const flush = () => {
      if (!label) return;
      result.push({ label, path: file.path, lines: body });
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
      if (label) body.push(sourceLine);
    }
    flush();
  }
  return result;
}

function directSemanticTarget(
  name: string,
  movementVocabulary: ProjectMovementVocabulary,
  setterLabels: Set<string>,
  objectWrappers: Set<string>,
): boolean {
  return DIRECT_SEMANTIC_CALLS.has(name)
    || DIRECT_SEMANTIC_PREDEFS.has(name)
    || /^RemoveItemByID(?:Bank[0-9A-F]+)?$/i.test(name)
    || /DisplayTextID/i.test(name)
    || /Print[A-Za-z0-9_]*Text/i.test(name)
    || /^Music_/i.test(name)
    || movementVocabulary.consumers.some((consumer) => consumer.routine === name)
    || setterLabels.has(name)
    || objectWrappers.has(name);
}

function compositeSemanticLabels(
  files: ProjectRgbdsSourceFile[],
  movementVocabulary: ProjectMovementVocabulary,
  setterLabels: Set<string>,
  objectWrappers: Set<string>,
  eventMacros: Map<string, ProjectEventMacroSemantic>,
  textCommandMacros: Set<string>,
  macroDefinitions: Set<string>,
): Set<string> {
  const routines = scriptRoutineBodies(files);
  const labels = new Set(routines.map((routine) => routine.label));
  const resolved = new Set<string>();

  let changed = true;
  while (changed) {
    changed = false;
    for (const routine of routines) {
      if (resolved.has(routine.label)) continue;

      const cleanRoutine = routine.lines.map(withoutComment);
      const touchesServiceEconomyState = cleanRoutine.some((line) =>
        /\b(?:wPlayerMoney|wPriceTemp|hMoney|hDivideBCD|wSafariSteps|wNumSafariBalls)\b/.test(line)
      );
      const dynamicallyPositionsSprite = cleanRoutine.some((line) =>
        /\b(?:hSpriteScreen[XY]Coord|hSpriteMap[XY]Coord)\b/.test(line)
      ) && cleanRoutine.some((line) =>
        /^call\s+SetSpritePosition1\b/i.test(line)
      );

      let hasSemanticAction = touchesServiceEconomyState || dynamicallyPositionsSprite;
      let blocked = false;

      for (const sourceLine of routine.lines) {
        const clean = withoutComment(sourceLine);
        if (!clean || isLabel(clean)) continue;

        const invocation = clean.match(
          /^(call|farcall|predef)\s+(?:(?:z|nz|c|nc)\s*,\s*)?([A-Za-z_.][A-Za-z0-9_.]*)\b/i,
        );
        if (invocation) {
          const target = invocation[2];
          if (target.startsWith(".")) continue;
          if (isScriptEngineInternalCall(target)) continue;
          if (
            directSemanticTarget(target, movementVocabulary, setterLabels, objectWrappers)
            || resolved.has(target)
          ) {
            hasSemanticAction = true;
            continue;
          }
          if (labels.has(target)) {
            blocked = true;
            break;
          }
          blocked = true;
          break;
        }

        const head = lineHead(clean);
        const lowerHead = head.toLowerCase();
        if (!head || CPU_INSTRUCTIONS.has(lowerHead) || RGBDS_DIRECTIVES.has(lowerHead)) {
          continue;
        }
        if (!macroDefinitions.has(lowerHead)) continue;
        if (isScriptEngineInternalMacro(head)) continue;

        const firstArgument = clean.slice(head.length).trim().split(",")[0]?.trim();
        const macroReason = semanticMacroReason(
          head,
          eventMacros,
          textCommandMacros,
        ) ?? wrapperMacroSemanticReason(
          head,
          firstArgument,
          movementVocabulary,
          setterLabels,
          objectWrappers,
          labels,
        );
        if (macroReason) {
          hasSemanticAction = true;
          continue;
        }

        blocked = true;
        break;
      }

      if (!blocked && hasSemanticAction) {
        resolved.add(routine.label);
        changed = true;
      }
    }
  }

  return resolved;
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

function semanticFamilyForTarget(name: string): string | undefined {
  if (/DisplayTextID|Print.*Text|DisplayPokedex/i.test(name)) return "dialogue";
  if (/^(?:GiveItem|IsItemInBag|RemoveItem|GetQuantityOfItemInBag)/i.test(name)) return "item";
  if (/^(?:HasEnoughMoney|HasEnoughCoins|Has9990Coins|AddBCDPredef|SubBCDPredef|DivideBCDPredef3)$/i.test(name)) return "economy";
  if (/^(?:GivePokemon|AddPartyMon|DisplayPartyMenu|MoveMon|RemovePokemon|LoadMonData|GetPartyMonName|WriteMonMoves)$/i.test(name)) return "party";
  if (/^(?:CheckFightingMapTrainers|DisplayEnemyTrainerTextAndStartBattle|EndTrainerBattle|TalkToTrainer|EngageMapTrainer)$/i.test(name)) return "trainer";
  if (/^(?:InitBattleEnemyParameters|SaveEndBattleTextPointers)$/i.test(name)) return "battle";
  if (/^(?:MoveSprite|SetSpriteMovementBytesToFF)$/i.test(name)) return "movement";
  if (/^(?:DecodeArrowMovementRLE|DecodeRLEList|StartSimulatingJoypadStates|ForceBikeOrSurf)$/i.test(name)) return "forced-movement";
  if (/^SetSpriteFacingDirectionAndDelay$/i.test(name)) return "facing";
  if (/^(?:ShowObject|HideObject)$/i.test(name)) return "object";
  if (/^ReplaceTileBlock$/i.test(name)) return "map-edit";
  if (/^(?:CheckBoulderCoords)$/i.test(name)) return "persistent-object-puzzle";
  if (/^(?:IsPlayerOnDungeonWarp)$/i.test(name)) return "warp";
  if (/^(?:FlagActionPredef)$/i.test(name)) return "indexed-event";
  if (/^(?:HealParty)$/i.test(name)) return "recovery";
  if (/^(?:PlayMusic|PlayDefaultMusic|PlayCry|PlayPikachuSoundClip|Music_)/i.test(name)) return "music";
  if (/^(?:YesNoChoice|Random|ArePlayerCoordsInArray|CheckPikachuStatusCondition)$/i.test(name)) return "condition";
  if (/^(?:DisplayElevatorFloorMenu|DoInGameTradeDialogue|OaksAideScript|DisplayNameRaterScreen|GiveFossilToCinnabarLab|SurfingPikachuMinigame|HallOfFamePC|SaveGameData|RemoveGuardDrink)$/i.test(name)) return "service";
  if (/^(?:CallFunctionInTable|ExecuteCurMapScriptInTable)$/i.test(name)) return "state-transition";
  return undefined;
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
    || /Print[A-Za-z0-9_]*Text/i.test(name)
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
  if (/^(?:EventFlagAddress|EventFlagBit)$/i.test(name)) {
    return "Addresses an indexed event family used by the indexed-event semantic model.";
  }
  if (/^(?:script_pokecenter_nurse|script_cable_club_receptionist)$/i.test(name)) {
    return "Defines a standard reusable service interaction.";
  }
  if (/^(?:ldpikacry|ldpikaemotion)$/i.test(name)) {
    return "Configures a Pikachu companion reaction used by the interaction model.";
  }
  return null;
}

function wrapperMacroSemanticReason(
  name: string,
  target: string | undefined,
  movementVocabulary: ProjectMovementVocabulary,
  setterLabels: Set<string>,
  objectWrappers: Set<string>,
  scriptLabels?: Set<string>,
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

  if (scriptLabels?.has(target)) {
    return `Project wrapper invokes script helper ${target}; the target body is audited independently.`;
  }

  return null;
}

interface ConstructAccumulator {
  name: string;
  kind: ScriptAuditConstructKind;
  status: ScriptAuditStatus;
  familyId?: string;
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
  familyId?: string,
): string {
  const key = `${status}:${kind}:${name}`;
  const existing = constructs.get(key);
  if (existing) {
    existing.occurrences += 1;
    if (!existing.familyId && familyId) existing.familyId = familyId;
    existing.paths.add(example.path);
    if (existing.examples.length < 4) existing.examples.push(example);
    return key;
  }
  constructs.set(key, {
    name,
    kind,
    status,
    familyId,
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
  const compositeLabels = compositeSemanticLabels(
    files,
    movementVocabulary,
    setterLabels,
    objectWrappers,
    eventMacros,
    textCommandMacros,
    macroDefinitions,
  );
  const constructs = new Map<string, ConstructAccumulator>();
  const auditFiles: ScriptAuditFile[] = [];

  let meaningfulLineCount = 0;
  let semanticLineCount = 0;
  let structuralLineCount = 0;
  let internalLineCount = 0;
  let unresolvedLineCount = 0;
  let semanticInvocationCount = 0;
  let structuralInvocationCount = 0;
  let internalInvocationCount = 0;
  let unresolvedInvocationCount = 0;

  for (const file of scriptFiles) {
    const lines = file.contents.split(/\r?\n/);
    const macroCalls = new Map(
      (macroAnalysis.callsByScriptPath.get(file.path)?.calls ?? [])
        .map((call) => [call.line, call]),
    );

    let fileSemantic = 0;
    let fileStructural = 0;
    let fileInternal = 0;
    let fileUnresolved = 0;
    let fileSemanticInvocations = 0;
    let fileStructuralInvocations = 0;
    let fileInternalInvocations = 0;
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
        if (name.startsWith(".")) {
          addConstruct(
            constructs,
            "internal",
            kind,
            name,
            "Routine-local control flow; the referenced local block is audited in place.",
            example,
          );
          internalLineCount += 1;
          fileInternal += 1;
          internalInvocationCount += 1;
          fileInternalInvocations += 1;
          return;
        }
        if (isScriptEngineInternalCall(name)) {
          addConstruct(
            constructs,
            "internal",
            kind,
            name,
            "Resolved engine presentation/bookkeeping helper; preserved as an advanced internal rather than exposed as gameplay logic.",
            example,
          );
          internalLineCount += 1;
          fileInternal += 1;
          internalInvocationCount += 1;
          fileInternalInvocations += 1;
          return;
        }
        const semanticReason = compositeLabels.has(name)
          ? "Project helper is composed entirely of semantic actions and understood control flow."
          : kind === "predef" && DIRECT_SEMANTIC_PREDEFS.has(name)
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
            semanticFamilyForTarget(name),
          );
          void key;
          semanticLineCount += 1;
          fileSemantic += 1;
          semanticInvocationCount += 1;
          fileSemanticInvocations += 1;
          return;
        }

        const key = addConstruct(
          constructs,
          "structural",
          kind,
          name,
          labels.has(name)
            ? "Project helper is resolved, but its body still contains gameplay behavior that has not been promoted into the semantic IR."
            : "Invocation syntax is understood, but the target is external to the audited script corpus and does not yet have a semantic handler.",
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
        if (isScriptEngineInternalMacro(macroCall.name)) {
          addConstruct(
            constructs,
            "internal",
            "macro",
            macroCall.name,
            "Source/data convenience macro; preserved exactly and not exposed as a gameplay action.",
            example,
          );
          internalLineCount += 1;
          fileInternal += 1;
          internalInvocationCount += 1;
          fileInternalInvocations += 1;
          return;
        }
        const wrappedTarget = macroCall.arguments[0]?.raw;
        if (
          ["callfar", "farjp", "predef_jump"].includes(macroCall.name.toLowerCase())
          && wrappedTarget
          && isScriptEngineInternalCall(wrappedTarget)
        ) {
          addConstruct(
            constructs,
            "internal",
            "macro",
            macroCall.name,
            `Project wrapper invokes engine-internal target ${wrappedTarget}.`,
            example,
          );
          internalLineCount += 1;
          fileInternal += 1;
          internalInvocationCount += 1;
          fileInternalInvocations += 1;
          return;
        }
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
          labels,
        );
        if (semanticReason) {
          addConstruct(
            constructs,
            "semantic",
            "macro",
            macroCall.name,
            semanticReason,
            example,
            eventMacros.has(macroCall.name.toLowerCase())
              ? "event"
              : /^(?:EventFlagAddress|EventFlagBit)$/i.test(macroCall.name)
                ? "indexed-event"
                : /^(?:map_coord_movement)$/i.test(macroCall.name)
                  ? "forced-movement"
                  : /^(?:trainer|def_trainers)$/i.test(macroCall.name)
                    ? "trainer"
                    : /^(?:text|text_asm|text_end|text_far|text_ram|text_decimal|line|cont|para|page|next|prompt|done)$/i.test(macroCall.name)
                      ? "dialogue"
                      : undefined,
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
        if (isScriptEngineInternalMacro(head)) {
          addConstruct(
            constructs,
            "internal",
            "macro",
            head,
            "Source/data convenience macro; preserved exactly and not exposed as a gameplay action.",
            example,
          );
          internalLineCount += 1;
          fileInternal += 1;
          internalInvocationCount += 1;
          fileInternalInvocations += 1;
          return;
        }
        const firstArgument = clean.slice(head.length).trim().split(",")[0]?.trim();
        if (
          ["callfar", "farjp", "predef_jump"].includes(lowerHead)
          && firstArgument
          && isScriptEngineInternalCall(firstArgument)
        ) {
          addConstruct(
            constructs,
            "internal",
            "macro",
            head,
            `Project wrapper invokes engine-internal target ${firstArgument}.`,
            example,
          );
          internalLineCount += 1;
          fileInternal += 1;
          internalInvocationCount += 1;
          fileInternalInvocations += 1;
          return;
        }
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
          labels,
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
      internalLines: fileInternal,
      unresolvedLines: fileUnresolved,
      meaningfulLines: fileSemantic + fileStructural + fileInternal + fileUnresolved,
      semanticInvocationCount: fileSemanticInvocations,
      structuralInvocationCount: fileStructuralInvocations,
      internalInvocationCount: fileInternalInvocations,
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
      familyId: value.familyId,
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
        internal: 3,
      };
      return statusOrder[left.status] - statusOrder[right.status]
        || right.occurrences - left.occurrences
        || left.name.localeCompare(right.name);
    });

  const unresolvedConstructCount = constructList.filter(
    (construct) => construct.status === "unresolved",
  ).length;
  const structuralConstructCount = constructList.filter(
    (construct) => construct.status === "structural",
  ).length;
  const blockerCount = unresolvedConstructCount + structuralConstructCount;
  const externalTargetConstructCount = constructList.filter(
    (construct) =>
      construct.status === "structural"
      && ["call", "farcall", "predef"].includes(construct.kind),
  ).length;
  const macroSemanticConstructCount = constructList.filter(
    (construct) =>
      construct.status === "structural"
      && construct.kind === "macro",
  ).length;
  const unresolvedSyntaxConstructCount = constructList.filter(
    (construct) => construct.status === "unresolved",
  ).length;
  const auditByPath = new Map(auditFiles.map((file) => [file.path, file]));
  const regressionFixtures = SCRIPT_REGRESSION_FIXTURES.map((fixture) => {
    const present = fixture.paths
      .map((path) => auditByPath.get(path))
      .filter((file): file is ScriptAuditFile => Boolean(file));
    const unresolved = present.reduce(
      (sum, file) => sum + file.unresolvedInvocationCount,
      0,
    );
    const structural = present.reduce(
      (sum, file) => sum + file.structuralInvocationCount,
      0,
    );
    return {
      id: fixture.id,
      label: fixture.label,
      purpose: fixture.purpose,
      paths: [...fixture.paths],
      presentPaths: present.map((file) => file.path),
      blockerCount: unresolved + structural,
      unresolvedInvocationCount: unresolved,
      structuralInvocationCount: structural,
      passed: present.length > 0 && unresolved === 0 && structural === 0,
    };
  });

  return {
    irVersion: SCRIPT_SEMANTIC_IR_VERSION,
    semanticFamilies: SCRIPT_SEMANTIC_FAMILIES.map((family) => ({ ...family })),
    releaseReadiness: {
      ready: blockerCount === 0,
      blockerCount,
      unresolvedConstructCount,
      structuralConstructCount,
      externalTargetConstructCount,
      macroSemanticConstructCount,
      unresolvedSyntaxConstructCount,
      criteria: [
        "Every scripts/*.asm source construct is classified.",
        "No gameplay-relevant invocation remains only structurally understood.",
        "Low-level engine presentation and bookkeeping is explicitly classified as internal.",
        "All builder actions target the frozen semantic IR rather than raw assembly.",
      ],
    },
    regressionFixtures,
    fileCount: scriptFiles.length,
    meaningfulLineCount,
    semanticLineCount,
    structuralLineCount,
    internalLineCount,
    unresolvedLineCount,
    semanticInvocationCount,
    structuralInvocationCount,
    internalInvocationCount,
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
