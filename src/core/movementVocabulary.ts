import {
  evaluateRgbdsExpression,
  projectConstantCatalogFromSources,
  readProjectRgbdsSources,
  type ProjectConstantGroup,
  type ProjectConstantCatalog,
  type ProjectRgbdsProjectRgbdsSourceFile,
} from "./projectConstants";
import type {
  ProjectMovementDirection,
  ProjectMovementExactValue,
  ProjectMovementRange,
  ProjectMovementVocabulary,
  ProjectSource,
} from "./types";

interface SourceSection {
  label: string;
  path: string;
  lines: string[];
}

function directionFromSymbol(symbol: string): ProjectMovementDirection | null {
  const upper = symbol.toUpperCase();
  if (/(?:^|_)(UP|NORTH)(?:_|$)/.test(upper)) return "up";
  if (/(?:^|_)(DOWN|SOUTH)(?:_|$)/.test(upper)) return "down";
  if (/(?:^|_)(LEFT|WEST)(?:_|$)/.test(upper)) return "left";
  if (/(?:^|_)(RIGHT|EAST)(?:_|$)/.test(upper)) return "right";
  return null;
}

function isChangeFacingSymbol(symbol: string): boolean {
  const upper = symbol.toUpperCase();
  return /(?:^|_)CHANGE(?:_|$)/.test(upper)
    && /(?:^|_)(?:FACING|FACE)(?:_|$)/.test(upper);
}

function movementGroupDirections(group: ProjectConstantGroup) {
  return group.constants
    .map((constant) => ({
      constant,
      direction: directionFromSymbol(constant.symbol),
    }))
    .filter(
      (entry): entry is {
        constant: ProjectConstantGroup["constants"][number];
        direction: ProjectMovementDirection;
      } => Boolean(entry.direction),
    );
}

function thresholdUseCounts(
  files: ProjectRgbdsSourceFile[],
  candidateSymbols: Set<string>,
): Map<string, number> {
  const counts = new Map<string, number>();
  if (candidateSymbols.size === 0) return counts;

  for (const file of files) {
    const lines = file.contents.split(/\r?\n/);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const clean = lines[lineIndex].split(";", 1)[0].trim();
      const compare = clean.match(/^cp\s+([A-Za-z_][A-Za-z0-9_.]*)\s*$/i);
      if (!compare || !candidateSymbols.has(compare[1])) continue;

      let nextExecutable = "";
      for (
        let probe = lineIndex + 1;
        probe < Math.min(lines.length, lineIndex + 4);
        probe += 1
      ) {
        nextExecutable = lines[probe].split(";", 1)[0].trim();
        if (nextExecutable) break;
      }
      if (!/^(?:jr|jp)\s+(?:c|nc)\b/i.test(nextExecutable)) continue;
      counts.set(compare[1], (counts.get(compare[1]) ?? 0) + 1);
    }
  }
  return counts;
}

function exactValues(
  constants: ProjectConstantCatalog["constants"],
): ProjectMovementExactValue[] {
  const result: ProjectMovementExactValue[] = [];
  for (const constant of constants) {
    const direction = directionFromSymbol(constant.symbol);
    const operation = isChangeFacingSymbol(constant.symbol)
      ? "change-facing" as const
      : undefined;
    if (!direction && !operation) continue;
    result.push({
      value: constant.value,
      symbol: constant.symbol,
      direction: direction ?? undefined,
      operation,
      sourcePath: constant.sourcePath,
    });
  }
  return result;
}

function rangesFromGroup(group: ProjectConstantGroup): ProjectMovementRange[] {
  const directional = movementGroupDirections(group)
    .sort((left, right) => left.constant.value - right.constant.value);

  const deduped = directional.filter((entry, index) =>
    directional.findIndex(
      (candidate) =>
        candidate.constant.value === entry.constant.value
        && candidate.direction === entry.direction,
    ) === index
  );

  return deduped.map((entry, index) => ({
    minimum: entry.constant.value,
    maximumExclusive: deduped[index + 1]?.constant.value ?? null,
    symbol: entry.constant.symbol,
    direction: entry.direction,
    sourcePath: entry.constant.sourcePath,
  }));
}

function globalSections(file: ProjectRgbdsSourceFile): SourceSection[] {
  const lines = file.contents.split(/\r?\n/);
  const starts: Array<{ label: string; index: number }> = [];
  lines.forEach((line, index) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*):{1,2}\s*(?:;.*)?$/);
    if (match) starts.push({ label: match[1], index });
  });
  return starts.map((start, index) => ({
    label: start.label,
    path: file.path,
    lines: lines.slice(start.index, starts[index + 1]?.index ?? lines.length),
  }));
}

function localLabelIndexes(lines: string[]): Map<string, number> {
  const result = new Map<string, number>();
  lines.forEach((line, index) => {
    const match = line.match(
      /^\s*((?:\.[A-Za-z_][A-Za-z0-9_.]*)(?::{1,2})?)\s*(?:;.*)?$/,
    );
    if (match) result.set(match[1].replace(/:{1,2}$/, ""), index);
  });
  return result;
}

function helperDirections(
  sections: SourceSection[],
): Map<string, ProjectMovementDirection> {
  const result = new Map<string, ProjectMovementDirection>();
  for (const section of sections) {
    const directions = new Set<ProjectMovementDirection>();
    for (const sourceLine of section.lines) {
      const clean = sourceLine.split(";", 1)[0].trim();
      const load = clean.match(/^ld\s+c\s*,\s*([A-Za-z_][A-Za-z0-9_.]*)\s*$/i);
      const direction = load ? directionFromSymbol(load[1]) : null;
      if (direction) directions.add(direction);
    }
    if (directions.size === 1) {
      result.set(section.label, [...directions][0]);
    }
  }
  return result;
}

function directionFromTargetBlock(
  section: SourceSection,
  targetIndex: number,
  helpers: Map<string, ProjectMovementDirection>,
): ProjectMovementDirection | null {
  for (
    let index = targetIndex + 1;
    index < Math.min(section.lines.length, targetIndex + 10);
    index += 1
  ) {
    const sourceLine = section.lines[index];
    const clean = sourceLine.split(";", 1)[0].trim();
    if (!clean) continue;
    if (/^\.[A-Za-z_][A-Za-z0-9_.]*:{0,2}$/.test(clean)) break;

    const direct = clean.match(/^ld\s+c\s*,\s*([A-Za-z_][A-Za-z0-9_.]*)\s*$/i);
    if (direct) {
      const direction = directionFromSymbol(direct[1]);
      if (direction) return direction;
    }

    const call = clean.match(/^call\s+([A-Za-z_][A-Za-z0-9_]*)\b/i);
    if (call) {
      const direction = helpers.get(call[1]);
      if (direction) return direction;
    }
  }
  return null;
}

function deriveNpcExactValues(
  files: ProjectRgbdsSourceFile[],
  catalog: ProjectConstantCatalog,
): ProjectMovementExactValue[] {
  const symbols = new Map(catalog.constants.map((constant) => [
    constant.symbol,
    constant.value,
  ]));
  const sections = files.flatMap(globalSections);
  const helpers = helperDirections(sections);
  const result: ProjectMovementExactValue[] = [];

  for (const section of sections) {
    const labels = localLabelIndexes(section.lines);
    const sectionValues: ProjectMovementExactValue[] = [];

    for (let index = 1; index < section.lines.length; index += 1) {
      const clean = section.lines[index].split(";", 1)[0].trim();
      const compare = clean.match(/^cp\s+([^\s;]+)\s*$/i);
      if (!compare) continue;

      let branchIndex = index + 1;
      while (
        branchIndex < Math.min(section.lines.length, index + 4)
        && !section.lines[branchIndex].split(";", 1)[0].trim()
      ) {
        branchIndex += 1;
      }
      const branch = section.lines[branchIndex]?.split(";", 1)[0].trim().match(
        /^(?:jr|jp)\s+z\s*,\s*(\.[A-Za-z_][A-Za-z0-9_.]*)\b/i,
      );
      if (!branch) continue;

      const targetIndex = labels.get(branch[1]);
      if (targetIndex === undefined) continue;
      const direction = directionFromTargetBlock(section, targetIndex, helpers);
      if (!direction) continue;

      const value = evaluateRgbdsExpression(compare[1], symbols);
      if (value === null) continue;
      sectionValues.push({
        value,
        symbol: compare[1],
        direction,
        sourcePath: section.path,
      });
    }

    const uniqueDirections = new Set(
      sectionValues.map((entry) => entry.direction).filter(Boolean),
    );
    if (sectionValues.length >= 4 && uniqueDirections.size >= 3) {
      result.push(...sectionValues);
    }
  }

  return result.filter((entry, index, entries) =>
    entries.findIndex(
      (candidate) =>
        candidate.value === entry.value
        && candidate.direction === entry.direction,
    ) === index
  );
}

export async function loadProjectMovementVocabulary(
  source: ProjectSource,
): Promise<ProjectMovementVocabulary> {
  const files = await readProjectRgbdsSources(source);
  const catalog = projectConstantCatalogFromSources(files);
  const candidates = catalog.groups
    .map((group) => ({
      group,
      directional: movementGroupDirections(group),
    }))
    .filter(({ directional }) =>
      new Set(directional.map((entry) => entry.direction)).size >= 3,
    );

  const candidateSymbols = new Set(
    candidates.flatMap(({ directional }) =>
      directional.map((entry) => entry.constant.symbol),
    ),
  );
  const thresholdCounts = thresholdUseCounts(files, candidateSymbols);

  const ranked = candidates
    .map(({ group, directional }) => ({
      group,
      directional,
      thresholdHits: directional.reduce(
        (total, entry) => total + (thresholdCounts.get(entry.constant.symbol) ?? 0),
        0,
      ),
      thresholdSymbols: directional.filter(
        (entry) => (thresholdCounts.get(entry.constant.symbol) ?? 0) > 0,
      ).length,
    }))
    .sort((left, right) =>
      right.thresholdSymbols - left.thresholdSymbols
      || right.thresholdHits - left.thresholdHits
      || right.directional.length - left.directional.length
      || right.group.step - left.group.step,
    );

  const selected = ranked.find((candidate) => candidate.thresholdSymbols >= 2)
    ?? null;
  const warnings = [...catalog.warnings];
  if (!selected) {
    warnings.push(
      "No project constant group could be proven to define range-coded movement directions.",
    );
  }

  return {
    npcRanges: selected ? rangesFromGroup(selected.group) : [],
    npcExactValues: deriveNpcExactValues(files, catalog),
    exactValues: exactValues(catalog.constants),
    warnings,
  };
}
