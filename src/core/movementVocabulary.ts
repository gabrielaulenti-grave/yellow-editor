import { movementLabelAlternativesAtCall } from "./mapScriptMovementAnalysis";
import {
  evaluateRgbdsExpression,
  projectConstantCatalogFromSources,
  readProjectRgbdsSources,
  type ProjectConstantGroup,
  type ProjectConstantCatalog,
  type ProjectRgbdsSourceFile,
} from "./projectConstants";
import type {
  ProjectMovementCommandValue,
  ProjectMovementConsumer,
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

function directionFamily(symbol: string): string | null {
  const match = symbol.toUpperCase().match(
    /^(.*?)(?:_)?(UP|DOWN|LEFT|RIGHT|NORTH|SOUTH|EAST|WEST)$/,
  );
  if (!match || !match[1]) return null;
  return match[1].replace(/_+$/, "");
}

function joypadUsageScores(
  files: ProjectRgbdsSourceFile[],
  values: ProjectMovementExactValue[],
): Map<string, number> {
  const symbols = new Set(values.map((entry) => entry.symbol));
  const scores = new Map<string, number>();

  for (const file of files) {
    const lines = file.contents.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const clean = lines[index].split(";", 1)[0].trim();
      const load = clean.match(
        /^ld\s+a\s*,\s*([A-Za-z_][A-Za-z0-9_.]*)\s*$/i,
      );
      if (!load || !symbols.has(load[1])) continue;

      for (
        let probe = index + 1;
        probe < Math.min(lines.length, index + 5);
        probe += 1
      ) {
        const next = lines[probe].split(";", 1)[0].trim();
        if (!next) continue;
        if (
          /^ld\s+\[wSimulatedJoypadStatesEnd(?:\s*\+\s*\d+)?\]\s*,\s*a\s*$/i.test(next)
          || /^ld\s+\[hli\]\s*,\s*a\s*$/i.test(next)
            && lines.slice(Math.max(0, index - 3), index + 1).some((line) =>
              /^\s*ld\s+hl\s*,\s*wSimulatedJoypadStatesEnd\b/i.test(
                line.split(";", 1)[0].trim(),
              )
            )
        ) {
          scores.set(load[1], (scores.get(load[1]) ?? 0) + 1);
        }
        break;
      }
    }
  }

  return scores;
}

function deriveJoypadExactValues(
  files: ProjectRgbdsSourceFile[],
  values: ProjectMovementExactValue[],
): ProjectMovementExactValue[] {
  const directional = values.filter((entry) => entry.direction);
  const scores = joypadUsageScores(files, directional);
  const families = new Map<string, ProjectMovementExactValue[]>();

  for (const entry of directional) {
    const family = directionFamily(entry.symbol);
    if (!family) continue;
    const familyValues = families.get(family) ?? [];
    familyValues.push(entry);
    families.set(family, familyValues);
  }

  const ranked = [...families.entries()]
    .map(([family, entries]) => ({
      family,
      entries,
      directions: new Set(entries.map((entry) => entry.direction)),
      usage: entries.reduce(
        (total, entry) => total + (scores.get(entry.symbol) ?? 0),
        0,
      ),
    }))
    .filter((candidate) => candidate.directions.size >= 3)
    .sort((left, right) =>
      right.usage - left.usage
      || right.directions.size - left.directions.size
      || right.entries.length - left.entries.length
      || left.family.localeCompare(right.family),
    );

  const selected = ranked.find((candidate) => candidate.usage > 0) ?? null;
  return selected?.entries ?? [];
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

function movementCommandCandidate(
  constant: ProjectConstantCatalog["constants"][number],
): ProjectMovementCommandValue | null {
  const upper = constant.symbol.toUpperCase();
  const direction = directionFromSymbol(constant.symbol);

  const directional = upper.match(
    /^(.*)_(STEP|MOVE|WALK|SLIDE|HOP|LOOK|FACE|FACING|TURN)_(UP|DOWN|LEFT|RIGHT|NORTH|SOUTH|EAST|WEST)$/,
  );
  if (directional && direction) {
    return {
      value: constant.value,
      symbol: constant.symbol,
      family: directional[1].replace(/_+$/, ""),
      action: /^(LOOK|FACE|FACING|TURN)$/.test(directional[2]) ? "look" : "move",
      direction,
      sourcePath: constant.sourcePath,
    };
  }

  const terminal = upper.match(/^(.*)_(DELAY|WAIT|PAUSE|END|STOP|DONE|TERMINATOR)$/);
  if (terminal) {
    return {
      value: constant.value,
      symbol: constant.symbol,
      family: terminal[1].replace(/_+$/, ""),
      action: /^(DELAY|WAIT|PAUSE)$/.test(terminal[2]) ? "delay" : "end",
      sourcePath: constant.sourcePath,
    };
  }

  return null;
}

function dataTokensFromSection(lines: string[], startIndex = 1): string[] {
  const tokens: string[] = [];
  let sawData = false;
  for (let index = startIndex; index < lines.length; index += 1) {
    const clean = lines[index].split(";", 1)[0].trim();
    if (!clean) continue;
    if (/^\.[A-Za-z_][A-Za-z0-9_.]*:{0,2}$/.test(clean)) {
      if (sawData) continue;
      continue;
    }
    const data = clean.match(/^db\s+([^,\s]+)/i);
    if (data) {
      sawData = true;
      tokens.push(data[1]);
      continue;
    }
    if (sawData) break;
  }
  return tokens;
}

function referencedDataTokens(
  owner: SourceSection,
  sections: Map<string, SourceSection>,
  label: string,
): string[] {
  if (!label.startsWith(".")) {
    const section = sections.get(label);
    return section ? dataTokensFromSection(section.lines) : [];
  }

  const index = owner.lines.findIndex((line) =>
    line.match(/^\s*(\.[A-Za-z_][A-Za-z0-9_.]*):{0,2}\s*(?:;.*)?$/)?.[1] === label
  );
  return index < 0 ? [] : dataTokensFromSection(owner.lines, index + 1);
}

function deriveMovementConsumers(
  files: ProjectRgbdsSourceFile[],
  catalog: ProjectConstantCatalog,
): ProjectMovementConsumer[] {
  const commandCandidates = catalog.constants
    .map(movementCommandCandidate)
    .filter((entry): entry is ProjectMovementCommandValue => Boolean(entry));
  const commandsBySymbol = new Map(
    commandCandidates.map((entry) => [entry.symbol, entry]),
  );
  const commandsByFamily = new Map<string, ProjectMovementCommandValue[]>();
  for (const command of commandCandidates) {
    const family = commandsByFamily.get(command.family) ?? [];
    family.push(command);
    commandsByFamily.set(command.family, family);
  }
  const symbols = new Map(
    catalog.constants.map((constant) => [constant.symbol, constant.value]),
  );

  interface Candidate {
    routine: string;
    register: "hl" | "de";
    family: string;
    sourcePaths: Set<string>;
    uses: number;
  }

  const candidates = new Map<string, Candidate>();

  function commandForToken(
    token: string,
    family: string,
  ): ProjectMovementCommandValue | null {
    const direct = commandsBySymbol.get(token);
    if (direct?.family === family) return direct;

    const value = evaluateRgbdsExpression(token, symbols);
    if (value === null) return null;
    const matches = (commandsByFamily.get(family) ?? []).filter(
      (command) => command.value === value,
    );
    const unique = matches.filter((command, index) =>
      matches.findIndex((candidate) =>
        candidate.action === command.action
        && candidate.direction === command.direction
      ) === index
    );
    return unique.length === 1 ? unique[0] : null;
  }

  function inferFamily(tokens: string[]): string | null {
    const possibleFamilies = new Set<string>();
    for (const token of tokens) {
      const direct = commandsBySymbol.get(token);
      if (direct) possibleFamilies.add(direct.family);

      const value = evaluateRgbdsExpression(token, symbols);
      if (value !== null) {
        for (const command of commandCandidates) {
          if (command.value === value) possibleFamilies.add(command.family);
        }
      }
    }

    const ranked = [...possibleFamilies]
      .map((family) => {
        const commands = tokens
          .map((token) => commandForToken(token, family))
          .filter((entry): entry is ProjectMovementCommandValue => Boolean(entry));
        return {
          family,
          commands,
          recognized: commands.length,
          ratio: tokens.length > 0 ? commands.length / tokens.length : 0,
          hasEnd: commands.some((command) => command.action === "end"),
          hasAction: commands.some((command) =>
            command.action === "move"
            || command.action === "look"
            || command.action === "delay"
          ),
        };
      })
      .filter((candidate) =>
        candidate.recognized >= 2
        && candidate.ratio >= 0.6
        && candidate.hasEnd
        && candidate.hasAction
      )
      .sort((left, right) =>
        right.recognized - left.recognized
        || right.ratio - left.ratio
        || left.family.localeCompare(right.family)
      );

    if (ranked.length === 0) return null;
    if (
      ranked.length > 1
      && ranked[0].recognized === ranked[1].recognized
      && ranked[0].ratio === ranked[1].ratio
    ) {
      return null;
    }
    return ranked[0].family;
  }

  for (const file of files.filter((entry) => /^scripts\/.+\.asm$/i.test(entry.path))) {
    const sectionList = globalSections(file);
    const sections = new Map(sectionList.map((section) => [section.label, section]));

    for (const owner of sectionList) {
      const source = owner.lines.join("\n");
      owner.lines.forEach((sourceLine, callIndex) => {
        const routine = sourceLine.split(";", 1)[0].trim()
          .match(/^call\s+([A-Za-z_][A-Za-z0-9_]*)\b/i)?.[1];
        if (!routine) return;

        for (const register of ["hl", "de"] as const) {
          const alternatives = movementLabelAlternativesAtCall(
            source,
            callIndex,
            register,
          );
          for (const alternative of alternatives) {
            const tokens = referencedDataTokens(owner, sections, alternative.label);
            if (tokens.length < 2) continue;
            const family = inferFamily(tokens);
            if (!family) continue;

            const key = `${routine}\u0000${register}\u0000${family}`;
            const candidate = candidates.get(key) ?? {
              routine,
              register,
              family,
              sourcePaths: new Set<string>(),
              uses: 0,
            };
            candidate.sourcePaths.add(file.path);
            candidate.uses += 1;
            candidates.set(key, candidate);
          }
        }
      });
    }
  }

  return [...candidates.values()]
    .filter((candidate) => candidate.uses > 0)
    .map((candidate) => ({
      routine: candidate.routine,
      register: candidate.register,
      family: candidate.family,
      commands: [...(commandsByFamily.get(candidate.family) ?? [])].sort(
        (left, right) => left.value - right.value || left.symbol.localeCompare(right.symbol),
      ),
      sourcePaths: [...candidate.sourcePaths].sort(),
    }))
    .sort((left, right) =>
      left.routine.localeCompare(right.routine)
      || left.register.localeCompare(right.register)
      || left.family.localeCompare(right.family)
    );
}

export async function loadProjectMovementVocabulary(
  source: ProjectSource,
  sourceFilesInput?: ProjectRgbdsSourceFile[] | Promise<ProjectRgbdsSourceFile[]>,
): Promise<ProjectMovementVocabulary> {
  const files = sourceFilesInput
    ? [...await Promise.resolve(sourceFilesInput)]
    : await readProjectRgbdsSources(source);
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

  const projectExactValues = exactValues(catalog.constants);
  return {
    npcRanges: selected ? rangesFromGroup(selected.group) : [],
    npcExactValues: deriveNpcExactValues(files, catalog),
    joypadExactValues: deriveJoypadExactValues(files, projectExactValues),
    exactValues: projectExactValues,
    consumers: deriveMovementConsumers(files, catalog),
    warnings,
  };
}
