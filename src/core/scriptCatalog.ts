import { parseMapScriptRoutines } from "./mapScriptParser";
import type {
  ProjectSource,
  ScriptCatalog,
  ScriptCatalogEntry,
  ScriptDocument,
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

function routineSummaries(path: string, source: string): ScriptRoutineSummary[] {
  const stateLabels = scriptStateLabels(source);
  return parseMapScriptRoutines(source).map((routine) => {
    const kind = stateLabels.has(routine.label)
      ? "state"
      : routine.instructions.length > 0 || /Script$/i.test(routine.label)
        ? "routine"
        : "source-label";
    return {
      path,
      label: routine.label,
      startLine: routine.startLine,
      kind,
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
