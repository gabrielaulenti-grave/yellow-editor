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
