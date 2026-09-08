import type {
  ProjectSource,
  TextWriteRequest,
  TrainerEditSourceDocument,
  TrainerPartyEditValues,
  TrainerSpecialMove,
} from "./types";

const PARTIES_PATH = "data/trainers/parties.asm";
const SPECIAL_MOVES_PATH = "data/trainers/special_moves.asm";

function sourceDocument(
  sources: TrainerEditSourceDocument[],
  path: string,
): TrainerEditSourceDocument | null {
  return sources.find((source) => source.path === path) ?? null;
}

function newlineInfo(contents: string): { newline: string; trailing: boolean } {
  const newline = contents.includes("\r\n") ? "\r\n" : "\n";
  return { newline, trailing: contents.endsWith(newline) };
}

function splitLines(contents: string): string[] {
  const { trailing } = newlineInfo(contents);
  const lines = contents.split(/\r?\n/);
  if (trailing && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function joinLines(lines: string[], contents: string): string {
  const { newline, trailing } = newlineInfo(contents);
  return lines.join(newline) + (trailing ? newline : "");
}

function parsePartyId(partyId: string): { classConstant: string; partyNumber: number } {
  const match = partyId.match(/^([A-Z][A-Z0-9_]*):(\d+)$/);
  if (!match || Number(match[2]) < 1) {
    throw new Error(`Invalid trainer party id '${partyId}'.`);
  }
  return { classConstant: match[1], partyNumber: Number(match[2]) };
}

export function validateTrainerPartyValues(
  partyId: string,
  projectName: string,
  values: TrainerPartyEditValues,
  knownSpecies: Set<string>,
  knownMoves: Set<string>,
): void {
  const { classConstant } = parsePartyId(partyId);
  if (values.partyFormat !== "shared-level" && values.partyFormat !== "individual-levels") {
    throw new Error("Trainer party encoding must be shared-level or individual-levels.");
  }
  if (values.pokemon.length < 1 || values.pokemon.length > 6) {
    throw new Error("A trainer party must contain between 1 and 6 Pokémon.");
  }
  for (const [index, pokemon] of values.pokemon.entries()) {
    if (!Number.isInteger(pokemon.level) || pokemon.level < 1 || pokemon.level > 100) {
      throw new Error(`Trainer party slot ${index + 1} level must be an integer from 1 to 100.`);
    }
    if (!knownSpecies.has(pokemon.speciesConstant)) {
      throw new Error(`Trainer party slot ${index + 1} uses unknown Pokémon '${pokemon.speciesConstant}'.`);
    }
  }
  if (
    values.partyFormat === "shared-level" &&
    values.pokemon.some((pokemon) => pokemon.level !== values.pokemon[0].level)
  ) {
    throw new Error("Every Pokémon must use the same level in shared-level encoding.");
  }

  const occupiedSlots = new Set<string>();
  const sourceKeys = new Set<string>();
  for (const move of values.specialMoves) {
    if (!knownMoves.has(move.moveConstant)) {
      throw new Error(`Unknown special move '${move.moveConstant}'.`);
    }
    if (
      move.pokemonIndex === null ||
      !Number.isInteger(move.pokemonIndex) ||
      move.pokemonIndex < 1 ||
      (move.pokemonIndex > values.pokemon.length && move.sourceKind !== "red-class")
    ) {
      throw new Error("A special move references a Pokémon outside this party.");
    }
    if (move.moveSlot === null || move.moveSlot < 1 || move.moveSlot > 4) {
      throw new Error("Special move slots must be between 1 and 4.");
    }
    const occupiedKey = `${move.pokemonIndex}:${move.moveSlot}`;
    if (occupiedSlots.has(occupiedKey)) {
      throw new Error(`Pokémon ${move.pokemonIndex} move slot ${move.moveSlot} has more than one override.`);
    }
    occupiedSlots.add(occupiedKey);

    if (projectName === "pokeyellow") {
      if (
        move.scope !== "party" ||
        move.sourceKind !== "yellow-party" ||
        move.sourceKey !== partyId
      ) {
        throw new Error("Yellow special moves must belong to the selected trainer party.");
      }
      continue;
    }

    if (move.sourceKind === "red-lone") {
      if (move.scope !== "party" || move.moveSlot !== 3 || !/^LONE:\d+$/.test(move.sourceKey)) {
        throw new Error("Red/Blue lone moves must use move slot 3 and retain their source entry.");
      }
    } else if (move.sourceKind === "red-class") {
      if (
        move.scope !== "class" ||
        move.pokemonIndex !== 5 ||
        move.moveSlot !== 3 ||
        move.sourceKey !== `${classConstant}:*`
      ) {
        throw new Error("Red/Blue class moves must retain their class-wide source entry.");
      }
    } else {
      throw new Error("Unsupported Red/Blue special move source.");
    }
    if (sourceKeys.has(move.sourceKey)) {
      throw new Error(`Special move source '${move.sourceKey}' was supplied more than once.`);
    }
    sourceKeys.add(move.sourceKey);
  }
}

function dataSuffix(line: string): string {
  const commentIndex = line.indexOf(";");
  const code = commentIndex >= 0 ? line.slice(0, commentIndex) : line;
  const whitespace = code.match(/\s*$/)?.[0] ?? "";
  return whitespace + (commentIndex >= 0 ? line.slice(commentIndex) : "");
}

export function updateTrainerPartyContents(
  contents: string,
  sourceLine: number,
  values: TrainerPartyEditValues,
): string {
  const lines = splitLines(contents);
  const lineIndex = sourceLine - 1;
  const original = lines[lineIndex];
  const match = original?.match(/^(\s*)db\s+(.+)$/i);
  if (!match || !/(?:^|,)\s*0\s*(?:;.*)?$/.test(original)) {
    throw new Error(`Trainer party source line ${sourceLine} is no longer a supported party record.`);
  }
  const fields = values.partyFormat === "shared-level"
    ? [values.pokemon[0].level, ...values.pokemon.map((pokemon) => pokemon.speciesConstant), 0]
    : ["$ff", ...values.pokemon.flatMap((pokemon) => [pokemon.level, pokemon.speciesConstant]), 0];
  lines[lineIndex] = `${match[1]}db ${fields.join(", ")}${dataSuffix(original)}`;
  return joinLines(lines, contents);
}

interface YellowMoveBlock {
  start: number;
  end: number;
}

function yellowMoveBlock(
  lines: string[],
  classConstant: string,
  partyNumber: number,
): YellowMoveBlock | null {
  const start = lines.findIndex((line) => {
    const match = line.split(";", 1)[0].trim().match(/^db\s+([^,]+)\s*,\s*([^,]+)$/i);
    if (!match || match[1].trim() !== classConstant) {
      return false;
    }
    const value = match[2].trim();
    const parsed = /^\d+$/.test(value)
      ? Number(value)
      : /^\$[0-9a-f]+$/i.test(value)
        ? Number.parseInt(value.slice(1), 16)
        : null;
    return parsed === partyNumber;
  });
  if (start < 0) {
    return null;
  }
  const end = lines.findIndex((line, index) =>
    index > start && /^\s*db\s+0\s*(?:;.*)?$/i.test(line),
  );
  if (end < 0) {
    throw new Error(`Special move block for ${classConstant}:${partyNumber} has no terminator.`);
  }
  return { start, end };
}

function renderYellowMoves(
  classConstant: string,
  partyNumber: number,
  moves: TrainerSpecialMove[],
): string[] {
  return [
    `\tdb ${classConstant}, ${partyNumber}`,
    ...moves.map((move) =>
      `\tdb ${move.pokemonIndex}, ${move.moveSlot}, ${move.moveConstant}`,
    ),
    "\tdb 0",
  ];
}

function updateYellowSpecialMoves(
  contents: string,
  partyId: string,
  moves: TrainerSpecialMove[],
): string {
  const { classConstant, partyNumber } = parsePartyId(partyId);
  const lines = splitLines(contents);
  const block = yellowMoveBlock(lines, classConstant, partyNumber);
  if (block) {
    lines.splice(
      block.start,
      block.end - block.start + 1,
      ...(moves.length > 0 ? renderYellowMoves(classConstant, partyNumber, moves) : []),
    );
  } else if (moves.length > 0) {
    const terminator = lines.findIndex((line) => /^\s*db\s+-1\b/i.test(line));
    if (terminator < 0) {
      throw new Error("Could not find the end of SpecialTrainerMoves.");
    }
    lines.splice(
      terminator,
      0,
      ...renderYellowMoves(classConstant, partyNumber, moves),
      "",
    );
  }
  return joinLines(lines, contents);
}

function updateRedLoneMove(
  lines: string[],
  move: TrainerSpecialMove,
): void {
  const index = Number(move.sourceKey.split(":")[1]);
  const label = lines.findIndex((line) => /^LoneMoves::?\s*(?:;.*)?$/i.test(line));
  if (label < 0) {
    throw new Error("Could not find LoneMoves.");
  }
  let seen = 0;
  for (let lineIndex = label + 1; lineIndex < lines.length; lineIndex += 1) {
    if (/^\s*[A-Za-z_][A-Za-z0-9_]*::?\s*(?:;.*)?$/.test(lines[lineIndex])) {
      break;
    }
    if (!/^\s*db\s+\d+\s*,\s*[A-Za-z_][A-Za-z0-9_]*\b/i.test(lines[lineIndex])) {
      continue;
    }
    seen += 1;
    if (seen === index) {
      const indent = lines[lineIndex].match(/^(\s*)/)?.[1] ?? "\t";
      lines[lineIndex] = `${indent}db ${move.pokemonIndex}, ${move.moveConstant}${dataSuffix(lines[lineIndex])}`;
      return;
    }
  }
  throw new Error(`Could not find ${move.sourceKey} in LoneMoves.`);
}

function updateRedClassMove(
  lines: string[],
  classConstant: string,
  move: TrainerSpecialMove,
): void {
  const label = lines.findIndex((line) => /^TeamMoves::?\s*(?:;.*)?$/i.test(line));
  if (label < 0) {
    throw new Error("Could not find TeamMoves.");
  }
  const pattern = new RegExp(`^(\\s*db\\s+)${classConstant}(\\s*,\\s*)[A-Za-z_][A-Za-z0-9_]*(.*)$`, "i");
  for (let lineIndex = label + 1; lineIndex < lines.length; lineIndex += 1) {
    if (/^\s*db\s+-1\b/i.test(lines[lineIndex])) {
      break;
    }
    if (pattern.test(lines[lineIndex])) {
      lines[lineIndex] = lines[lineIndex].replace(
        pattern,
        (_match, prefix: string, separator: string, suffix: string) =>
          `${prefix}${classConstant}${separator}${move.moveConstant}${suffix}`,
      );
      return;
    }
  }
  throw new Error(`Could not find the ${classConstant} entry in TeamMoves.`);
}

function updateRedSpecialMoves(
  contents: string,
  partyId: string,
  moves: TrainerSpecialMove[],
): string {
  const { classConstant } = parsePartyId(partyId);
  const lines = splitLines(contents);
  for (const move of moves) {
    if (move.sourceKind === "red-lone") {
      updateRedLoneMove(lines, move);
    } else if (move.sourceKind === "red-class") {
      updateRedClassMove(lines, classConstant, move);
    }
  }
  return joinLines(lines, contents);
}

export function updateTrainerSpecialMovesContents(
  contents: string,
  projectName: string,
  partyId: string,
  moves: TrainerSpecialMove[],
): string {
  return projectName === "pokeyellow"
    ? updateYellowSpecialMoves(contents, partyId, moves)
    : updateRedSpecialMoves(contents, partyId, moves);
}

export async function prepareTrainerPartyWrites(
  source: ProjectSource,
  projectName: string,
  partyId: string,
  sourceLine: number,
  sources: TrainerEditSourceDocument[],
  values: TrainerPartyEditValues,
): Promise<TextWriteRequest[]> {
  const partySource = sourceDocument(sources, PARTIES_PATH);
  if (!partySource) {
    throw new Error(`Trainer editor requires ${PARTIES_PATH}.`);
  }
  const partyContents = await source.readText(PARTIES_PATH);
  const requests: TextWriteRequest[] = [{
    path: PARTIES_PATH,
    contents: updateTrainerPartyContents(partyContents, sourceLine, values),
    expectedHash: partySource.sourceHash,
  }];

  const specialSource = sourceDocument(sources, SPECIAL_MOVES_PATH);
  if (projectName === "pokeyellow" && !specialSource) {
    throw new Error(`Yellow special move editing requires ${SPECIAL_MOVES_PATH}.`);
  }
  if (specialSource) {
    const specialContents = await source.readText(SPECIAL_MOVES_PATH);
    const updatedSpecialMoves = updateTrainerSpecialMovesContents(
      specialContents,
      projectName,
      partyId,
      values.specialMoves,
    );
    if (updatedSpecialMoves !== specialContents) {
      requests.push({
        path: SPECIAL_MOVES_PATH,
        contents: updatedSpecialMoves,
        expectedHash: specialSource.sourceHash,
      });
    }
  }
  return requests;
}
