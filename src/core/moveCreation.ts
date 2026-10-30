import { loadBattleAnimationCatalog } from "./battleAnimations";
import { loadGraphicsCatalog } from "./graphics";
import { parseMoves } from "./parsers";
import { before, checkStamps, code, creationSnapshot, creationWrites, extendNames, freeSections, gameText, identifier, newline, rows, type CreationStamp } from "./creationSupport";
import type { MoveData, ProjectSource } from "./types";

export interface MoveCreateDocument { sources: CreationStamp[]; nextId: number; moves: MoveData[]; effects: string[]; types: string[]; animations: Array<{ constant: string; label: string }>; reason: string | null }
export interface MoveCreateValues { constant: string; name: string; power: number; accuracy: number; pp: number; effect: string; moveType: string; animation: string; soundMoveId: number }
const paths = ["constants/move_constants.asm", "data/moves/moves.asm", "data/moves/names.asm", "data/moves/sfx.asm", "data/moves/animations.asm", "engine/battle/core.asm", "home/names2.asm", "layout.link"];
export async function loadMoveCreateDocument(source: ProjectSource): Promise<MoveCreateDocument> {
  const snapshot = await creationSnapshot(source, paths), moves = await parseMoves(source);
  const catalog = await loadBattleAnimationCatalog(source, await loadGraphicsCatalog(source));
  const nextId = moves.length + 1;
  let reason: string | null = null;
  if (snapshot.symbols.get("NUM_ATTACKS") !== moves.length || rows(snapshot.text.get(paths[1])!, "Moves", "move").length !== moves.length || rows(snapshot.text.get(paths[2])!, "MoveNames", "li").length !== moves.length || rows(snapshot.text.get(paths[3])!, "MoveSoundTable", "db").length !== moves.length) reason = "Move constants, names, sounds and stats must have synchronized table lengths.";
  if (nextId >= 255 || nextId > catalog.scripts.length) reason = "No safe move ID is available within the current byte and animation-table limits.";
  return { sources: snapshot.stamps, moves, nextId, effects: [...new Set(moves.map(move => move.effect))], types: [...new Set(moves.map(move => move.moveType))], animations: catalog.scripts.filter(script => !script.warnings.length && (moves.some(move => move.animationLabel === script.label) || script.label.startsWith("YellowEditor_"))).map(script => ({ constant: script.constant, label: script.label })), reason };
}
export async function prepareMoveCreateWrites(source: ProjectSource, document: MoveCreateDocument, values: MoveCreateValues) {
  const current = await loadMoveCreateDocument(source); checkStamps(document.sources, current.sources); if (current.reason) throw new Error(current.reason);
  const { text, files } = await creationSnapshot(source, paths); identifier(values.constant, files); gameText(values.name, 12, "Move name");
  for (const [field, value, max, min] of [["Power", values.power, 255, 0], ["Accuracy", values.accuracy, 100, 0], ["PP", values.pp, 40, 1]] as const) if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${field} must be an integer from ${min} to ${max}.`);
  if (!current.effects.includes(values.effect) || !current.types.includes(values.moveType) || !current.animations.some(animation => animation.constant === values.animation)) throw new Error("Choose a battle behavior, type and animation available in this project.");
  const sound = current.moves.find(move => move.id === values.soundMoveId); if (!sound) throw new Error("Choose an existing move sound template.");
  let constants = before(text.get(paths[0])!, /^[ \t]*DEF[ \t]+NUM_ATTACKS\b[^\r\n]*/, `\tconst ${values.constant}`);
  if (!constants.includes("; yellow-editor separate animation IDs")) {
    const firstAnimation = text.get(paths[0])!.match(/; Moves do double duty as animation identifiers\.[\s\S]*?^[ \t]*const[ \t]+([A-Z_0-9]+)/m)?.[1];
    const existing = firstAnimation && current.moves.length + 1;
    if (!firstAnimation || !existing) throw new Error("The move/animation boundary needs source review.");
    constants = constants.replace(new RegExp(`(^[ \\t]*const[ \\t]+${firstAnimation}\\b)`, "m"), `; yellow-editor separate animation IDs${newline(constants)}\tconst_def ${existing}${newline(constants)}$1`);
    if (!constants.includes("; yellow-editor separate animation IDs")) throw new Error("The animation ID boundary is unsupported.");
  }
  const updates = new Map<string, string>([
    [paths[0], constants],
    [paths[1], before(text.get(paths[1])!, /^[ \t]*assert_table_length[ \t]+NUM_ATTACKS\b[^\r\n]*/, `\tmove ${values.animation}, ${values.effect}, ${values.power}, ${values.moveType}, ${values.accuracy}, ${values.pp}`)],
    [paths[2], before(text.get(paths[2])!, /^[ \t]*assert_list_length[ \t]+NUM_ATTACKS\b[^\r\n]*/, `\tli "${values.name}"`)],
    [paths[3], before(text.get(paths[3])!, /^[ \t]*assert_table_length[ \t]+NUM_ATTACKS\b[^\r\n]*/, rows(text.get(paths[3])!, "MoveSoundTable", "db")[sound.id - 1].split(";", 1)[0].trimEnd() + ` ; ${values.constant}`)],
    [paths[6], extendNames(text.get(paths[6])!)],
  ]);
  // This assertion describes a pointer prefix, not move identity: moves can share animations.
  let animations = text.get(paths[4])!.replace(/^[ \t]*assert_table_length[ \t]+NUM_ATTACKS\b[^\r\n]*\r?\n/m, "");
  let seen = 0, inserted = false, table = false;
  animations = animations.split(/\r?\n/).map(line => { if (code(line) === "AttackAnimationPointers:") table = true; if (table && /^dw\s/.test(code(line)) && ++seen === current.nextId) { inserted = true; return line + newline(animations) + "\tassert_table_length NUM_ATTACKS"; } return line; }).join(newline(animations));
  if (!inserted) throw new Error("Cannot retain the animation pointer prefix assertion."); updates.set(paths[4], animations);
  let core = text.get(paths[5])!;
  if (!core.includes("; yellow-editor expanded Metronome range")) {
    const pattern = /\tcp STRUGGLE\r?\n[ \t]*ASSERT NUM_ATTACKS == STRUGGLE[^\r\n]*\r?\n[ \t]*jr nc, \.pickMoveLoop/;
    if (!pattern.test(core)) throw new Error("Metronome needs source review before appending move IDs.");
    core = core.replace(pattern, "; yellow-editor expanded Metronome range\n\tcp NUM_ATTACKS + 1\n\tjr nc, .pickMoveLoop\n\tcp STRUGGLE\n\tjr z, .pickMoveLoop");
  }
  updates.set(paths[5], core);
  updates.set(paths[7], freeSections(text.get(paths[7])!, files, [paths[1], paths[2], paths[3], paths[4]]));
  return { id: current.nextId, changes: creationWrites(text, current.sources, updates) };
}
