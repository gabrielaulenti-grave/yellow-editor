import { parseMapScriptRoutines } from "./mapScriptParser";
import { movementLabelAlternativesAtCall } from "./mapScriptMovementAnalysis";
import type {
  ProjectSource,
  ScriptCatalog,
  ScriptCatalogEntry,
  ScriptDocument,
  ScriptRoutineCategory,
  ScriptRoutineSummary,
} from "./types";

function scriptStem(path: string): string {
  return path.split("/").pop()?.replace(/\.asm$/i, "") ?? path;
}

function groupStem(path: string): string {
  return scriptStem(path).replace(/_([2-9]\d*)$/i, "");
}

function displayName(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function isScriptPath(path: string): boolean {
  return /^scripts\/.+\.asm$/i.test(path);
}

function scriptStateLabels(source: string): Set<string> {
  return new Set(
    [...source.matchAll(
      /^\s*dw_const\s+([A-Za-z_][A-Za-z0-9_]*)\s*,\s*SCRIPT_[A-Z0-9_]+\b/gm,
    )].map((match) => match[1]),
  );
}

function globalLabelSections(source: string): Map<string, string> {
  const lines = source.split(/\r?\n/);
  const starts: Array<{ label: string; index: number }> = [];
  lines.forEach((line, index) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*):{1,2}\s*(?:;.*)?$/);
    if (match) starts.push({ label: match[1], index });
  });

  return new Map(starts.map((start, index) => [
    start.label,
    lines.slice(start.index, starts[index + 1]?.index ?? lines.length).join("\n"),
  ]));
}

function textRoutineLabels(source: string, sections: Map<string, string>): Set<string> {
  const result = new Set(
    [...source.matchAll(
      /^\s*dw_const\s+([A-Za-z_][A-Za-z0-9_]*)\s*,\s*TEXT_[A-Z0-9_]+\b/gm,
    )].map((match) => match[1]),
  );

  for (const [label, body] of sections) {
    if (
      /Text$/i.test(label)
      || /^\s*text_(?:asm|far)\b/im.test(body)
    ) {
      result.add(label);
    }
  }
  return result;
}

function movementRoutineLabels(source: string, sections: Map<string, string>): Set<string> {
  const result = new Set<string>();

  for (const body of sections.values()) {
    const lines = body.split(/\r?\n/);
    lines.forEach((line, index) => {
      const clean = line.split(";", 1)[0].trim();
      if (!/^call\s+[A-Za-z_][A-Za-z0-9_]*\b/i.test(clean)) return;

      const routine = clean.match(/^call\s+([A-Za-z_][A-Za-z0-9_]*)\b/i)?.[1] ?? "";
      const registers: Array<"de" | "hl"> = /^MoveSprite$/i.test(routine)
        ? ["de"]
        : /(?:Movement|Path)/i.test(routine)
          ? ["hl", "de"]
          : [];

      for (const register of registers) {
        for (const alternative of movementLabelAlternativesAtCall(body, index, register)) {
          if (!alternative.label.startsWith(".")) result.add(alternative.label);
        }
      }
    });
  }

  for (const label of sections.keys()) {
    if (/(?:Movement(?:Data)?|MovementPath|RLE)$/i.test(label)) {
      result.add(label);
    }
  }
  return result;
}

function isDataSection(source: string): boolean {
  const body = source.split(/\r?\n/).slice(1);
  let sawData = false;
  for (const sourceLine of body) {
    const line = sourceLine.split(";", 1)[0].trim();
    if (!line) continue;
    if (/^[A-Za-z_.][A-Za-z0-9_.]*:{1,2}$/.test(line)) continue;
    if (
      /^(?:db|dw|dw_const|dl|ds|dba|dbw|dab|assert|DEF|REPT|ENDR|IF|ELIF|ELSE|ENDC|def_[A-Za-z0-9_]+)\b/i.test(line)
    ) {
      sawData = true;
      continue;
    }
    return false;
  }
  return sawData;
}

function routineCategory(
  path: string,
  label: string,
  source: string,
  stateLabels: Set<string>,
  textLabels: Set<string>,
  movementLabels: Set<string>,
): ScriptRoutineCategory {
  if (stateLabels.has(label)) return "event-state";

  const dispatcherLabel = `${groupStem(path)}_Script`;
  if (
    label === dispatcherLabel
    || (/CallFunctionInTable/i.test(source) && /ScriptPointers/i.test(source))
  ) {
    return "dispatcher";
  }

  if (textLabels.has(label)) return "dialogue";

  if (
    movementLabels.has(label)
    || /Movement(?:Script|Data|Path)?$/i.test(label)
    || /RLE_/i.test(label)
  ) {
    return "movement";
  }

  if (
    isDataSection(source)
    || /(?:Pointers?|Table|Data)$/i.test(label)
  ) {
    return "data";
  }
  return "helper";
}

function routineSummaries(path: string, source: string): ScriptRoutineSummary[] {
  const stateLabels = scriptStateLabels(source);
  const sections = globalLabelSections(source);
  const textLabels = textRoutineLabels(source, sections);
  const movementLabels = movementRoutineLabels(source, sections);

  return parseMapScriptRoutines(source).map((routine) => {
    const section = sections.get(routine.label) ?? "";
    const category = routineCategory(
      path,
      routine.label,
      section,
      stateLabels,
      textLabels,
      movementLabels,
    );
    const kind = stateLabels.has(routine.label)
      ? "state"
      : routine.instructions.length > 0
        || category === "dispatcher"
        || category === "helper"
        || /Script$/i.test(routine.label)
        ? "routine"
        : "source-label";

    return {
      path,
      label: routine.label,
      startLine: routine.startLine,
      kind,
      category,
      recognizedOperationCount: routine.instructions.length,
      operationKinds: [...new Set(routine.instructions.map((instruction) => instruction.kind))],
    };
  });
}

export async function loadScriptCatalog(source: ProjectSource): Promise<ScriptCatalog> {
  if (!source.listFiles) {
    throw new Error(
      "This project source cannot enumerate script files. Reopen the project with a current Yellow Editor workspace.",
    );
  }

  const paths = [...new Set(await source.listFiles())]
    .filter(isScriptPath)
    .sort((left, right) => left.localeCompare(right));

  const parsed = new Array<{
    path: string;
    groupId: string;
    routines: ScriptRoutineSummary[];
  }>(paths.length);
  let nextIndex = 0;
  const workerCount = Math.min(12, paths.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < paths.length) {
      const index = nextIndex;
      nextIndex += 1;
      const path = paths[index];
      const contents = await source.readText(path);
      parsed[index] = {
        path,
        groupId: groupStem(path),
        routines: routineSummaries(path, contents),
      };
    }
  });
  await Promise.all(workers);

  const groups = new Map<string, ScriptCatalogEntry>();
  for (const file of parsed) {
    const existing = groups.get(file.groupId);
    if (existing) {
      existing.paths.push(file.path);
      existing.routines.push(...file.routines);
      continue;
    }
    groups.set(file.groupId, {
      id: file.groupId,
      displayName: displayName(file.groupId),
      paths: [file.path],
      routines: [...file.routines],
    });
  }

  const entries = [...groups.values()]
    .map((entry) => ({
      ...entry,
      paths: entry.paths.sort((left, right) => left.localeCompare(right)),
      routines: entry.routines.sort((left, right) =>
        left.path.localeCompare(right.path) || left.startLine - right.startLine),
    }))
    .sort((left, right) => left.displayName.localeCompare(right.displayName));

  return {
    entries,
    fileCount: paths.length,
    routineCount: entries.reduce(
      (total, entry) => total + entry.routines.filter((routine) => routine.kind !== "source-label").length,
      0,
    ),
  };
}

export async function loadScriptDocument(
  source: ProjectSource,
  path: string,
): Promise<ScriptDocument> {
  if (!isScriptPath(path)) {
    throw new Error(`Unsupported script path: ${path}`);
  }
  if (!(await source.exists(path))) {
    throw new Error(`Script file not found: ${path}`);
  }

  const contents = await source.readText(path);
  return {
    path,
    source: contents,
    routines: routineSummaries(path, contents),
  };
}
