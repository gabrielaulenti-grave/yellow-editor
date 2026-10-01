import { loadProjectConstantCatalog, type ProjectConstantGroup } from "./projectConstants";
import type {
  ProjectMovementDirection,
  ProjectMovementExactValue,
  ProjectMovementRange,
  ProjectMovementVocabulary,
  ProjectSource,
} from "./types";

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

async function thresholdUseCounts(
  source: ProjectSource,
  candidateSymbols: Set<string>,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!source.listFiles || candidateSymbols.size === 0) return counts;

  const paths = [...new Set(await source.listFiles())]
    .filter((path) => /\.(?:asm|inc)$/i.test(path))
    .sort((left, right) => left.localeCompare(right));

  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(12, paths.length) }, async () => {
    while (nextIndex < paths.length) {
      const index = nextIndex;
      nextIndex += 1;
      let contents = "";
      try {
        contents = await source.readText(paths[index]);
      } catch {
        continue;
      }
      const lines = contents.split(/\r?\n/);
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
  });
  await Promise.all(workers);
  return counts;
}

function exactValues(
  constants: Awaited<ReturnType<typeof loadProjectConstantCatalog>>["constants"],
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

export async function loadProjectMovementVocabulary(
  source: ProjectSource,
): Promise<ProjectMovementVocabulary> {
  const catalog = await loadProjectConstantCatalog(source);
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
  const thresholdCounts = await thresholdUseCounts(source, candidateSymbols);

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
    exactValues: exactValues(catalog.constants),
    warnings,
  };
}
