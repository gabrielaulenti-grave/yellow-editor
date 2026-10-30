import { parseTrainerBaseCatalog } from "./trainerBaseIndex";
import { parsePokemonIndex } from "./parsers";
import { validateTrainerPartyValues } from "./trainerEditing";
import { checkStamps, code, creationSnapshot, creationWrites, freeSections, type CreationStamp } from "./creationSupport";
import type { ProjectSource, TrainerPartyEditValues } from "./types";

export interface TrainerPartyCreateDocument { sources: CreationStamp[]; classes: Array<{ constant: string; name: string; nextParty: number }>; species: Array<{ constant: string; name: string }>; reason: string | null }
export interface TrainerPartyCreateValues { classConstant: string; partyFormat: TrainerPartyEditValues["partyFormat"]; pokemon: TrainerPartyEditValues["pokemon"] }
const paths = ["data/trainers/parties.asm", "constants/trainer_constants.asm", "data/trainers/names.asm", "data/trainers/name_pointers.asm", "data/trainers/pic_pointers_money.asm", "data/trainers/ai_pointers.asm", "data/trainers/move_choices.asm", "data/trainers/special_moves.asm", "constants/pokemon_constants.asm", "data/pokemon/names.asm", "layout.link"];
export async function loadTrainerPartyCreateDocument(source: ProjectSource): Promise<TrainerPartyCreateDocument> {
  const current = await creationSnapshot(source, paths), name = await source.exists("data/pokemon/mew.asm") ? "pokered" : "pokeyellow";
  const catalog = await parseTrainerBaseCatalog(source, name), species = await parsePokemonIndex(source);
  return { sources: current.stamps, classes: catalog.classes.map(entry => ({ constant: entry.constant, name: entry.name, nextParty: entry.partyCount + 1 })), species: species.filter(entry => entry.kind === "pokemon" && entry.constant).map(entry => ({ constant: entry.constant!, name: entry.displayName })), reason: catalog.warnings.length ? "Trainer data tables must be synchronized before appending parties." : null };
}
export async function prepareTrainerPartyCreateWrites(source: ProjectSource, document: TrainerPartyCreateDocument, values: TrainerPartyCreateValues) {
  const current = await loadTrainerPartyCreateDocument(source); checkStamps(document.sources, current.sources); if (current.reason) throw new Error(current.reason);
  const entry = current.classes.find(entry => entry.constant === values.classConstant); if (!entry || entry.nextParty > 255) throw new Error("Choose a class with an available one-byte party number.");
  validateTrainerPartyValues(`${entry.constant}:${entry.nextParty}`, "pokeyellow", { ...values, specialMoves: [] }, new Set(current.species.map(species => species.constant)), new Set());
  const { files, text } = await creationSnapshot(source, paths), parties = text.get(paths[0])!, lines = parties.split(/\r?\n/);
  const start = lines.findIndex(line => /^TrainerDataPointers::{0,1}$/.test(code(line))); if (start < 0) throw new Error("Missing trainer party pointer table.");
  const pointerLines: number[] = [];
  for (let i = start + 1; i < lines.length; i++) { if (/^assert_table_length\b/.test(code(lines[i]))) break; if (/^dw\s+[A-Za-z_]\w*\s*$/.test(code(lines[i]))) pointerLines.push(i); else if (code(lines[i]) && !/^table_width\b/.test(code(lines[i]))) throw new Error("Unsupported trainer pointer table."); }
  if (pointerLines.length !== current.classes.length) throw new Error("Trainer pointer table length changed.");
  const at = pointerLines[current.classes.indexOf(entry)], oldLabel = code(lines[at]).slice(2).trim();
  const blockStart = lines.findIndex(line => new RegExp(`^${oldLabel}::{0,1}$`).test(code(line))); if (blockStart < 0) throw new Error("Missing trainer class party block.");
  let blockEnd = lines.findIndex((line, i) => i > blockStart && /^[A-Za-z_]\w*::{0,1}$/.test(code(line))); if (blockEnd < 0) blockEnd = lines.length;
  const body = lines.slice(blockStart + 1, blockEnd);
  if (body.some(line => code(line) && !/^db\s/.test(code(line))) || body.filter(line => /^db\s/.test(code(line))).length !== entry.nextParty - 1) throw new Error("This class has an unsupported party layout; its existing records were preserved.");
  const record = values.partyFormat === "shared-level" ? `\tdb ${values.pokemon[0].level}, ${values.pokemon.map(mon => mon.speciesConstant).join(", ")}, 0` : `\tdb $ff, ${values.pokemon.flatMap(mon => [mon.level, mon.speciesConstant]).join(", ")}, 0`;
  const label = `YellowEditor_${entry.constant}_Parties`, marker = `; yellow-editor trainer parties ${entry.constant}`;
  const references = files.map(file => file.contents).join("\n").match(new RegExp(`\\b${oldLabel}\\b`, "g"))?.length ?? 0;
  if (oldLabel === label && references === 2 && parties.includes(marker)) {
    lines.splice(blockEnd, 0, `; Party ${entry.nextParty}`, record);
  } else {
    if (files.some(file => new RegExp(`\\b${label}\\b`).test(file.contents))) throw new Error("The private trainer party label is already used or shared. Source review is required.");
    lines[at] = lines[at].replace(oldLabel, label);
    lines.push("", marker, `${label}:`, ...body, `; Party ${entry.nextParty}`, record);
  }
  const updates = new Map([[paths[0], lines.join(parties.includes("\r\n") ? "\r\n" : "\n")], ["layout.link", freeSections(text.get("layout.link")!, files, [paths[0]])]]);
  return { partyId: `${entry.constant}:${entry.nextParty}`, changes: creationWrites(text, current.sources, updates) };
}
