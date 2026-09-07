import { hashText } from "./history";
import type {
  EncounterArea,
  EncounterTableEditDocument,
  EncounterTableIndexEntry,
  EncounterTerrain,
  EncounterVersion,
  EncounterVersionData,
  ProjectSource,
} from "./types";

const ENCOUNTER_INDEX_PATH = "data/wild/grass_water.asm";
const TERRAIN_MACROS: Record<EncounterTerrain, [string, string]> = {
  grass: ["def_grass_wildmons", "end_grass_wildmons"],
  water: ["def_water_wildmons", "end_water_wildmons"],
};

interface ParsedSection {
  terrain: EncounterTerrain;
  startLine: number;
  endLine: number;
  rate: number;
  slotsByVersion: Map<EncounterVersion, EncounterArea["slots"]>;
}

interface ParsedTable {
  tableLabel: string;
  displayName: string;
  sections: Record<EncounterTerrain, ParsedSection>;
}

function versionsForProject(projectName: string): EncounterVersion[] {
  return projectName === "pokered" ? ["red", "blue"] : ["yellow"];
}

function displayNameFromLabel(label: string): string {
  return label
    .replace(/WildMons$/, "")
    .replace(/^Pokemon/, "Pokémon")
    .replace(/([a-zé])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/^Mt Moon/, "Mt. Moon");
}

function encounterLabel(lines: string[]): string {
  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*WildMons):\s*(?:;.*)?$/);
    if (match) {
      return match[1];
    }
  }
  throw new Error("Could not find a WildMons table label.");
}

function conditionApplies(line: string, version: EncounterVersion): boolean | null {
  const match = line.match(/^\s*IF\s+DEF\(_(RED|BLUE|YELLOW)\)\s*(?:;.*)?$/i);
  if (!match) {
    return null;
  }
  return match[1].toLowerCase() === version;
}

function parseSection(
  lines: string[],
  terrain: EncounterTerrain,
  versions: EncounterVersion[],
): ParsedSection {
  const [startMacro, endMacro] = TERRAIN_MACROS[terrain];
  const startLine = lines.findIndex((line) =>
    new RegExp(`^\\s*${startMacro}\\s+`).test(line),
  );
  if (startLine < 0) {
    throw new Error(`Could not find ${startMacro}.`);
  }

  const endLine = lines.findIndex(
    (line, index) => index > startLine && new RegExp(`^\\s*${endMacro}\\b`).test(line),
  );
  if (endLine < 0) {
    throw new Error(`Could not find ${endMacro}.`);
  }

  const rateMatch = lines[startLine].match(
    new RegExp(`^\\s*${startMacro}\\s+(\\d+)\\b`),
  );
  if (!rateMatch) {
    throw new Error(`${startMacro} must use a numeric encounter rate.`);
  }
  const rate = Number(rateMatch[1]);
  const slotsByVersion = new Map<EncounterVersion, EncounterArea["slots"]>();

  for (const version of versions) {
    const slots: EncounterArea["slots"] = [];
    const activeConditions: boolean[] = [];

    for (let lineIndex = startLine + 1; lineIndex < endLine; lineIndex += 1) {
      const line = lines[lineIndex];
      const condition = conditionApplies(line, version);
      if (condition !== null) {
        activeConditions.push(condition);
        continue;
      }
      if (/^\s*ENDC\b/.test(line)) {
        if (activeConditions.length === 0) {
          throw new Error(`Unexpected ENDC in the ${terrain} encounter table.`);
        }
        activeConditions.pop();
        continue;
      }
      if (/^\s*(?:IF|ELIF|ELSE)\b/.test(line)) {
        throw new Error(
          `Unsupported conditional syntax in the ${terrain} encounter table: ${line.trim()}`,
        );
      }
      if (activeConditions.some((active) => !active)) {
        continue;
      }

      const slotMatch = line.match(
        /^\s*db\s+(\d+)\s*,\s*([A-Za-z_][A-Za-z0-9_]*)\b/,
      );
      if (slotMatch) {
        slots.push({
          level: Number(slotMatch[1]),
          speciesConstant: slotMatch[2],
          sourceLine: lineIndex,
        });
      }
    }

    if ((rate === 0 && slots.length !== 0) || (rate !== 0 && slots.length !== 10)) {
      throw new Error(
        `${displayNameFromLabel(encounterLabel(lines))} has ${slots.length} ${terrain} slots for ${version}; expected ${rate === 0 ? 0 : 10}.`,
      );
    }
    slotsByVersion.set(version, slots);
  }

  return { terrain, startLine, endLine, rate, slotsByVersion };
}

function parseTable(contents: string, versions: EncounterVersion[]): ParsedTable {
  const lines = contents.split(/\r?\n/);
  const tableLabel = encounterLabel(lines);
  return {
    tableLabel,
    displayName: displayNameFromLabel(tableLabel),
    sections: {
      grass: parseSection(lines, "grass", versions),
      water: parseSection(lines, "water", versions),
    },
  };
}

function versionData(parsed: ParsedTable, versions: EncounterVersion[]): EncounterVersionData[] {
  return versions.map((version) => ({
    version,
    grass: {
      rate: parsed.sections.grass.rate,
      slots: parsed.sections.grass.slotsByVersion.get(version) ?? [],
    },
    water: {
      rate: parsed.sections.water.rate,
      slots: parsed.sections.water.slotsByVersion.get(version) ?? [],
    },
  }));
}

export async function parseEncounterIndex(
  source: ProjectSource,
  projectName: string,
): Promise<EncounterTableIndexEntry[]> {
  if (!(await source.exists(ENCOUNTER_INDEX_PATH))) {
    return [];
  }

  const indexContents = await source.readText(ENCOUNTER_INDEX_PATH);
  const includePattern = /^\s*INCLUDE\s+"(data\/wild\/maps\/[^"\r\n]+\.asm)"/gm;
  const paths: string[] = [];
  let includeMatch: RegExpExecArray | null;
  while ((includeMatch = includePattern.exec(indexContents)) !== null) {
    if (!includeMatch[1].endsWith("/nothing.asm") && !paths.includes(includeMatch[1])) {
      paths.push(includeMatch[1]);
    }
  }

  const versions = versionsForProject(projectName);
  return Promise.all(paths.map(async (path) => {
    const fallbackLabel = path.split("/").pop()?.replace(/\.asm$/, "") ?? path;
    try {
      const parsed = parseTable(await source.readText(path), versions);
      const data = versionData(parsed, versions);
      return {
        path,
        tableLabel: parsed.tableLabel,
        displayName: parsed.displayName,
        versions,
        hasGrass: data.some((entry) => entry.grass.rate > 0),
        hasWater: data.some((entry) => entry.water.rate > 0),
        error: null,
      };
    } catch (error) {
      return {
        path,
        tableLabel: fallbackLabel,
        displayName: displayNameFromLabel(fallbackLabel),
        versions,
        hasGrass: false,
        hasWater: false,
        error: String(error),
      };
    }
  }));
}

export async function loadEncounterTableEditDocument(
  source: ProjectSource,
  projectName: string,
  path: string,
): Promise<EncounterTableEditDocument> {
  if (!/^data\/wild\/maps\/[A-Za-z0-9_./-]+\.asm$/.test(path) || path.includes("..")) {
    throw new Error("Encounter table path is outside data/wild/maps.");
  }
  const contents = await source.readText(path);
  const versions = versionsForProject(projectName);
  const parsed = parseTable(contents, versions);
  return {
    path,
    sourceHash: await hashText(contents),
    tableLabel: parsed.tableLabel,
    displayName: parsed.displayName,
    versions: versionData(parsed, versions),
  };
}

function validateArea(area: EncounterArea, terrain: EncounterTerrain, version: EncounterVersion): void {
  if (!Number.isInteger(area.rate) || area.rate < 0 || area.rate > 255) {
    throw new Error(`${version} ${terrain} encounter rate must be an integer from 0 to 255.`);
  }
  if (area.rate > 0 && area.slots.length !== 10) {
    throw new Error(`${version} ${terrain} encounters must contain exactly 10 slots.`);
  }
  for (const slot of area.rate > 0 ? area.slots : []) {
    if (!Number.isInteger(slot.level) || slot.level < 1 || slot.level > 100) {
      throw new Error(`${version} ${terrain} encounter levels must be integers from 1 to 100.`);
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(slot.speciesConstant)) {
      throw new Error(`Invalid ${version} ${terrain} Pokémon constant '${slot.speciesConstant}'.`);
    }
  }
}

export function validateEncounterVersions(
  versions: EncounterVersionData[],
  knownSpecies: Set<string>,
): void {
  if (versions.length === 0) {
    throw new Error("Encounter table has no supported game versions.");
  }
  for (const entry of versions) {
    validateArea(entry.grass, "grass", entry.version);
    validateArea(entry.water, "water", entry.version);
    for (const area of [entry.grass, entry.water]) {
      for (const slot of area.rate > 0 ? area.slots : []) {
        if (!knownSpecies.has(slot.speciesConstant)) {
          throw new Error(`Unknown Pokémon constant '${slot.speciesConstant}'.`);
        }
      }
    }
  }
  for (const terrain of ["grass", "water"] as const) {
    const firstRate = versions[0][terrain].rate;
    if (versions.some((entry) => entry[terrain].rate !== firstRate)) {
      throw new Error(`${terrain} encounter rate is shared by Red and Blue and must match.`);
    }
  }
}

function sameSlot(a: EncounterArea["slots"][number], b: EncounterArea["slots"][number]): boolean {
  return a.level === b.level && a.speciesConstant === b.speciesConstant;
}

function replaceRate(line: string, macro: string, rate: number): string {
  return line.replace(
    new RegExp(`^(\\s*${macro}\\s+)\\d+(.*)$`),
    (_match, prefix: string, suffix: string) => `${prefix}${rate}${suffix}`,
  );
}

function replaceSlotLine(line: string, level: number, species: string): string {
  return line.replace(
    /^(\s*db\s+)\d+(\s*,\s*)[A-Za-z_][A-Za-z0-9_]*(.*)$/,
    (_match, prefix: string, separator: string, suffix: string) =>
      `${prefix}${level}${separator}${species}${suffix}`,
  );
}

function renderSection(
  lines: string[],
  parsed: ParsedSection,
  requested: EncounterArea[],
): string[] {
  const [startMacro] = TERRAIN_MACROS[parsed.terrain];
  const rate = requested[0].rate;
  const start = replaceRate(lines[parsed.startLine], startMacro, rate);
  const end = lines[parsed.endLine];

  if (rate === 0) {
    return [start, end];
  }

  const originalEnabled = parsed.rate > 0;
  if (!originalEnabled) {
    const slots = requested[0].slots;
    if (requested.some((area) => area.slots.some((slot, index) => !sameSlot(slot, slots[index])))) {
      throw new Error(
        `New ${parsed.terrain} encounters are shared by Red and Blue; initialize both versions with the same slots.`,
      );
    }
    return [start, ...slots.map((slot) => `\tdb ${String(slot.level).padStart(2, " ")}, ${slot.speciesConstant}`), end];
  }

  const desiredByLine = new Map<number, EncounterArea["slots"][number]>();
  for (const area of requested) {
    for (const slot of area.slots) {
      if (slot.sourceLine === null || slot.sourceLine < 0) {
        throw new Error(`Existing ${parsed.terrain} encounter slots lost their source location.`);
      }
      const previous = desiredByLine.get(slot.sourceLine);
      if (previous && !sameSlot(previous, slot)) {
        throw new Error(
          `A shared Red/Blue ${parsed.terrain} slot has conflicting values. Edit it to the same value in both versions.`,
        );
      }
      desiredByLine.set(slot.sourceLine, slot);
    }
  }

  return lines.slice(parsed.startLine, parsed.endLine + 1).map((line, offset) => {
    if (offset === 0) {
      return start;
    }
    const sourceLine = parsed.startLine + offset;
    const desired = desiredByLine.get(sourceLine);
    return desired ? replaceSlotLine(line, desired.level, desired.speciesConstant) : line;
  });
}

export function updateEncounterTableContents(
  contents: string,
  projectName: string,
  requestedVersions: EncounterVersionData[],
  knownSpecies: Set<string>,
): string {
  validateEncounterVersions(requestedVersions, knownSpecies);
  const versions = versionsForProject(projectName);
  if (
    requestedVersions.length !== versions.length ||
    requestedVersions.some((entry, index) => entry.version !== versions[index])
  ) {
    throw new Error("Encounter version data does not match this project.");
  }

  const newline = contents.includes("\r\n") ? "\r\n" : "\n";
  const hadTrailingNewline = contents.endsWith(newline);
  const lines = contents.split(/\r?\n/);
  if (hadTrailingNewline) {
    lines.pop();
  }
  const parsed = parseTable(contents, versions);
  const replacements = (["grass", "water"] as const)
    .map((terrain) => ({
      startLine: parsed.sections[terrain].startLine,
      endLine: parsed.sections[terrain].endLine,
      lines: renderSection(
        lines,
        parsed.sections[terrain],
        requestedVersions.map((entry) => entry[terrain]),
      ),
    }))
    .sort((a, b) => b.startLine - a.startLine);

  for (const replacement of replacements) {
    lines.splice(
      replacement.startLine,
      replacement.endLine - replacement.startLine + 1,
      ...replacement.lines,
    );
  }

  return lines.join(newline) + (hadTrailingNewline ? newline : "");
}

export async function prepareEncounterTableWrite(
  source: ProjectSource,
  projectName: string,
  path: string,
  versions: EncounterVersionData[],
  knownSpecies: Set<string>,
): Promise<{ path: string; contents: string }> {
  const contents = await source.readText(path);
  return {
    path,
    contents: updateEncounterTableContents(contents, projectName, versions, knownSpecies),
  };
}
