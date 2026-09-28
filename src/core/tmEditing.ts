import { hashText } from "./history";
import { parseItemConstantDefinitions } from "./itemConstants";
import { parsePokemonIndex } from "./parsers";
import type {
  PokemonTmhmCompatibilityReference,
  ProjectSource,
  TextWriteRequest,
  TmEditDocument,
  TmEditSourceDocument,
  TmEditValues,
} from "./types";

const ITEM_CONSTANTS_PATH = "constants/item_constants.asm";
const MOVE_CONSTANTS_PATH = "constants/move_constants.asm";

function codeOnly(line: string): string {
  return (line.split(";", 1)[0] || "").trim();
}

function baseStatsPath(sourceSlug: string): string {
  return `data/pokemon/base_stats/${sourceSlug}.asm`;
}

function parseMoveConstants(contents: string): string[] {
  const result: string[] = [];
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = codeOnly(rawLine);
    if (/^DEF[ \t]+NUM_ATTACKS\b/.test(line)) break;
    const match = line.match(/^const[ \t]+([A-Za-z0-9_]+)/);
    if (match && match[1] !== "NO_MOVE") result.push(match[1]);
  }
  return result;
}

function tmhmBlock(contents: string): {
  start: number;
  end: number;
  indent: string;
  moves: string[];
} {
  const lines = contents.match(/[^\r\n]*(?:\r?\n|$)/g) || [];
  let offset = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index].replace(/\r?\n$/, "");
    const match = raw.match(/^([ \t]*)tmhm(?:[ \t]+(.*))?$/);
    if (!match) {
      offset += lines[index].length;
      continue;
    }

    const start = offset;
    let end = offset + raw.length;
    let current = (match[2] || "").trim();
    const parts: string[] = [];

    while (true) {
      const clean = (current.split(";", 1)[0] || "").trimEnd();
      const continues = clean.endsWith("\\");
      const values = (continues ? clean.slice(0, -1) : clean).trim();
      if (values) parts.push(values);
      if (!continues) break;

      offset += lines[index].length;
      index += 1;
      if (index >= lines.length) {
        throw new Error("TM/HM block has an unfinished continuation.");
      }
      const continuation = lines[index].replace(/\r?\n$/, "");
      end = offset + continuation.length;
      current = continuation.trim();
    }

    return {
      start,
      end,
      indent: match[1],
      moves: parts.join(" ").split(",").map((value) => value.trim()).filter(Boolean),
    };
  }

  throw new Error("Could not locate the TM/HM compatibility block.");
}

function formatTmhm(indent: string, moves: string[], newline: string): string {
  if (moves.length === 0) return indent + "tmhm";

  const groups: string[][] = [];
  for (let index = 0; index < moves.length; index += 5) {
    groups.push(moves.slice(index, index + 5));
  }

  return groups.map((group, index) => {
    const prefix = index === 0 ? indent + "tmhm " : indent + "     ";
    const suffix = index < groups.length - 1 ? ", \\" : "";
    return prefix + group.join(", ") + suffix;
  }).join(newline);
}

function replaceTmhmCompatibility(
  contents: string,
  oldMoveConstant: string,
  newMoveConstant: string,
  retained: boolean,
): string {
  const block = tmhmBlock(contents);
  const oldMatches = block.moves.filter((move) => move === oldMoveConstant).length;
  if (oldMatches !== 1) {
    throw new Error(
      `Expected exactly one ${oldMoveConstant} compatibility entry, found ${oldMatches}.`,
    );
  }

  let moves = retained
    ? block.moves.map((move) => move === oldMoveConstant ? newMoveConstant : move)
    : block.moves.filter((move) => move !== oldMoveConstant);

  if (new Set(moves).size !== moves.length) {
    throw new Error(
      `Replacing ${oldMoveConstant} with ${newMoveConstant} would create duplicate compatibility entries.`,
    );
  }

  const newline = contents.includes("\r\n") ? "\r\n" : "\n";
  const replacement = formatTmhm(block.indent, moves, newline);
  return contents.slice(0, block.start) + replacement + contents.slice(block.end);
}

function replaceTmAssignment(
  contents: string,
  tmNumber: number,
  expectedMoveConstant: string,
  nextMoveConstant: string,
): string {
  let currentTm = 0;
  let replaced = false;
  const next = contents.replace(
    /^([ \t]*add_tm[ \t]+)([A-Za-z0-9_]+)(.*)$/gm,
    (line, prefix: string, moveConstant: string, suffix: string) => {
      currentTm += 1;
      if (currentTm !== tmNumber) return line;
      if (moveConstant !== expectedMoveConstant) {
        throw new Error(
          `TM${String(tmNumber).padStart(2, "0")} changed outside Yellow Editor. Reload Items before saving.`,
        );
      }
      replaced = true;
      return prefix + nextMoveConstant + suffix;
    },
  );

  if (!replaced) {
    throw new Error(`Could not locate TM${String(tmNumber).padStart(2, "0")}.`);
  }
  return next;
}

function sameNumberSet(left: number[], right: number[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

export async function loadTmEditDocument(
  source: ProjectSource,
  itemId: number,
  compatibilityResolver?: (
    moveConstant: string,
  ) => Promise<PokemonTmhmCompatibilityReference[]>,
): Promise<TmEditDocument> {
  const [itemConstantsContents, moveConstantsContents, pokemonIndex] = await Promise.all([
    source.readText(ITEM_CONSTANTS_PATH),
    source.readText(MOVE_CONSTANTS_PATH),
    parsePokemonIndex(source),
  ]);

  const definitions = parseItemConstantDefinitions(itemConstantsContents);
  const tm = definitions.find((definition) => definition.id === itemId);
  if (!tm || tm.machineKind !== "tm" || !tm.machineNumber || !tm.moveConstant) {
    throw new Error("Only existing TMs can be edited. HM editing is not enabled.");
  }

  const duplicateMachine = definitions.find((definition) =>
    definition.id !== itemId
    && definition.machineKind !== null
    && definition.moveConstant === tm.moveConstant,
  );
  if (duplicateMachine) {
    throw new Error(
      `${tm.moveConstant} is assigned to more than one TM/HM slot. Yellow Editor cannot safely migrate an ambiguous machine assignment yet.`,
    );
  }

  let affectedPokemon: PokemonTmhmCompatibilityReference[];
  let affectedRows: Array<{
    path: string;
    contents: string;
  }>;

  if (compatibilityResolver) {
    affectedPokemon = await compatibilityResolver(tm.moveConstant);
    affectedRows = await Promise.all(affectedPokemon.map(async (pokemon) => {
      const path = baseStatsPath(pokemon.sourceSlug);
      const contents = await source.readText(path);
      if (!tmhmBlock(contents).moves.includes(tm.moveConstant as string)) {
        throw new Error(
          `${pokemon.displayName}'s cached TM/HM compatibility is stale. Reload the project before editing this TM.`,
        );
      }
      return { path, contents };
    }));
  } else {
    const pokemon = pokemonIndex.filter(
      (entry) => entry.kind === "pokemon" && entry.constant && entry.sourceSlug,
    );
    const rows = await Promise.all(pokemon.map(async (entry) => {
      const path = baseStatsPath(entry.sourceSlug as string);
      const contents = await source.readText(path);
      return {
        entry,
        path,
        contents,
        moves: tmhmBlock(contents).moves,
      };
    }));

    const matchingRows = rows.filter((row) => row.moves.includes(tm.moveConstant as string));
    affectedPokemon = matchingRows.map(({ entry }) => ({
      internalId: entry.internalId,
      constant: entry.constant as string,
      displayName: entry.displayName,
      sourceSlug: entry.sourceSlug as string,
    }));
    affectedRows = matchingRows.map(({ path, contents }) => ({ path, contents }));
  }

  const sources: TmEditSourceDocument[] = [
    {
      path: ITEM_CONSTANTS_PATH,
      sourceHash: await hashText(itemConstantsContents),
    },
    {
      path: MOVE_CONSTANTS_PATH,
      sourceHash: await hashText(moveConstantsContents),
    },
    ...await Promise.all(affectedRows.map(async ({ path, contents }) => ({
      path,
      sourceHash: await hashText(contents),
    }))),
  ];

  const assignedElsewhere = new Set(
    definitions
      .filter((definition) =>
        definition.machineKind !== null
        && definition.id !== itemId
        && definition.moveConstant,
      )
      .map((definition) => definition.moveConstant as string),
  );

  const replacementMoveConstants = parseMoveConstants(moveConstantsContents).filter(
    (moveConstant) =>
      moveConstant === tm.moveConstant || !assignedElsewhere.has(moveConstant),
  );

  return {
    itemId,
    tmNumber: tm.machineNumber,
    moveConstant: tm.moveConstant,
    affectedPokemon,
    replacementMoveConstants,
    sources,
  };
}

function expectedHash(document: TmEditDocument, path: string): string {
  const source = document.sources.find((entry) => entry.path === path);
  if (!source) {
    throw new Error(`Missing TM edit source guard for ${path}. Reload the TM before saving.`);
  }
  return source.sourceHash;
}

export async function prepareTmEditWrites(
  source: ProjectSource,
  document: TmEditDocument,
  values: TmEditValues,
): Promise<TextWriteRequest[]> {
  const fresh = await loadTmEditDocument(source, document.itemId);
  if (
    fresh.tmNumber !== document.tmNumber
    || fresh.moveConstant !== document.moveConstant
    || !sameNumberSet(
      fresh.affectedPokemon.map((pokemon) => pokemon.internalId),
      document.affectedPokemon.map((pokemon) => pokemon.internalId),
    )
  ) {
    throw new Error("This TM or its Pokémon compatibility changed outside Yellow Editor. Reload it before saving.");
  }

  for (const sourceDocument of document.sources) {
    const freshSource = fresh.sources.find((entry) => entry.path === sourceDocument.path);
    if (!freshSource || freshSource.sourceHash !== sourceDocument.sourceHash) {
      throw new Error(
        `${sourceDocument.path} changed outside Yellow Editor. Reload the TM before saving so external edits are preserved.`,
      );
    }
  }

  if (!fresh.replacementMoveConstants.includes(values.moveConstant)) {
    throw new Error(
      `${values.moveConstant} cannot be assigned to TM${String(document.tmNumber).padStart(2, "0")}. It may already belong to another TM or HM.`,
    );
  }
  if (values.moveConstant === document.moveConstant) {
    return [];
  }
  if (new Set(values.retainedPokemonIds).size !== values.retainedPokemonIds.length) {
    throw new Error("TM compatibility selection contains duplicate Pokémon.");
  }

  const affectedIds = new Set(document.affectedPokemon.map((pokemon) => pokemon.internalId));
  for (const internalId of values.retainedPokemonIds) {
    if (!affectedIds.has(internalId)) {
      throw new Error("TM compatibility selection contains a Pokémon that is not affected by this TM.");
    }
  }
  const retainedIds = new Set(values.retainedPokemonIds);

  const itemConstantsContents = await source.readText(ITEM_CONSTANTS_PATH);
  const writes: TextWriteRequest[] = [{
    path: ITEM_CONSTANTS_PATH,
    contents: replaceTmAssignment(
      itemConstantsContents,
      document.tmNumber,
      document.moveConstant,
      values.moveConstant,
    ),
    expectedHash: expectedHash(document, ITEM_CONSTANTS_PATH),
  }];

  for (const pokemon of document.affectedPokemon) {
    const path = baseStatsPath(pokemon.sourceSlug);
    const contents = await source.readText(path);
    writes.push({
      path,
      contents: replaceTmhmCompatibility(
        contents,
        document.moveConstant,
        values.moveConstant,
        retainedIds.has(pokemon.internalId),
      ),
      expectedHash: expectedHash(document, path),
    });
  }

  return writes;
}
