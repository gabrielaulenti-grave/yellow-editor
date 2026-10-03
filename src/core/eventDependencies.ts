import type { ProjectRgbdsSourceFile } from "./projectConstants";
import type { ProjectEventMacroSemantic, ScriptEventBranchDependency } from "./types";

// Recognize a bounded source pattern, rather than guessing dependencies from
// event names: an enabling check, state writes, branch selectors, then a return
// when none of the selectors is set. This is advisory; it is not a world-state
// simulator and cannot prove every possible use of an event flag.
export function deriveEventBranchDependencies(
  files: ProjectRgbdsSourceFile[],
  semantics: ProjectEventMacroSemantic[],
): ScriptEventBranchDependency[] {
  const checks = new Map(semantics.filter((semantic) => semantic.action === "check"
    && semantic.zeroMeaning === "event-clear" && semantic.eventParameterIndexes.length === 1)
    .map((semantic) => [semantic.name.toLowerCase(), semantic.eventParameterIndexes[0]]));
  function checkedEvent(line: string): string | null {
    const invocation = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+(.+)$/);
    const parameter = invocation ? checks.get(invocation[1].toLowerCase()) : undefined;
    if (parameter === undefined || !invocation) return null;
    const event = invocation[2].split(",")[parameter - 1]?.trim();
    return event && /^[A-Za-z_][A-Za-z0-9_]*$/.test(event) ? event : null;
  }
  const result: ScriptEventBranchDependency[] = [];
  for (const file of files.filter((file) => /^scripts\/.+\.asm$/i.test(file.path) && !file.readError)) {
    const lines = file.contents.split(/\r?\n/).map((line, index) => ({
      code: line.split(";")[0].trim(), line: index + 1,
    })).filter((line) => line.code);
    let routine = "";
    for (let index = 0; index < lines.length; index++) {
      const global = lines[index].code.match(/^([A-Za-z_][A-Za-z0-9_]*):{1,2}$/)?.[1];
      if (global) { routine = global; continue; }
      const guardEvent = checkedEvent(lines[index].code);
      if (!routine || !guardEvent || !/^ret\s+z$/i.test(lines[index + 1]?.code ?? "")) continue;
      const writes = new Set<string>();
      for (let cursor = index + 2; cursor < lines.length; cursor++) {
        const code = lines[cursor].code;
        if (/^[A-Za-z_.][A-Za-z0-9_.]*:{0,2}$/.test(code)
          || /^ret$/i.test(code) || /^(?:jp|jr)\s+[A-Za-z_][A-Za-z0-9_]*$/i.test(code)) break;
        const write = code.match(/^ldh?\s+\[([A-Za-z_][A-Za-z0-9_]*)\]\s*,\s*a$/i)?.[1];
        if (write) writes.add(write);
        if (!checkedEvent(code) || writes.size === 0) continue;
        const selectors: string[] = [];
        let end = cursor;
        while (end + 1 < lines.length) {
          const event = checkedEvent(lines[end].code);
          const branch = lines[end + 1].code.match(/^(?:jr|jp)\s+nz\s*,\s*([A-Za-z_][A-Za-z0-9_]*)$/i);
          if (!event || !branch) break;
          selectors.push(event);
          end += 2;
        }
        if (selectors.length > 0 && /^ret$/i.test(lines[end]?.code ?? "")
          && !selectors.includes(guardEvent)) {
          result.push({ path: file.path, routine, line: lines[index].line,
            guardEvent, branchEvents: [...new Set(selectors)], writtenSymbols: [...writes] });
          break;
        }
        // A different intervening event-dependent flow exceeds this pattern.
        break;
      }
    }
  }
  return result;
}

export function eventMutationDependencies(
  dependencies: ScriptEventBranchDependency[] | undefined,
  event: string,
  action: "set" | "reset",
): ScriptEventBranchDependency[] {
  return (dependencies ?? []).filter((dependency) => action === "set"
    ? dependency.guardEvent === event : dependency.branchEvents.includes(event));
}
