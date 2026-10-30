import { parseMoves, parsePokemonDetails, parsePokemonIndex } from "./parsers";
import { loadGraphicsCatalog, loadGraphicsDocument } from "./graphics";
import { encodeGraphicsPng } from "./graphicsPixels";
import { bytesToHex, hashText } from "./history";
import { legacyPokedexMask, upgradePokedexMask } from "./playerConditions";
import { append, before, checkStamps, code, creationSnapshot, creationWrites, extendNames, freeSections, gameText, identifier, rows, type CreationStamp } from "./creationSupport";
import type { ProjectSource, TextWriteRequest } from "./types";

export interface PokemonCreateDocument { sources: CreationStamp[]; nextInternalId: number; nextDexNumber: number; templates: Array<{ id: number; constant: string; name: string; slug: string }>; moves: string[]; reason: string | null }
export interface PokemonCreateValues { constant: string; name: string; templateId: number; startingMove: string; category: string; description: string[] }
const P = {
  constants: "constants/pokemon_constants.asm", dex: "constants/pokedex_constants.asm", names: "data/pokemon/names.asm", order: "data/pokemon/dex_order.asm", base: "data/pokemon/base_stats.asm", cries: "data/pokemon/cries.asm", icons: "data/pokemon/menu_icons.asm", palettes: "data/pokemon/palettes.asm", evos: "data/pokemon/evos_moves.asm", entries: "data/pokemon/dex_entries.asm", text: "data/pokemon/dex_text.asm", pictures: "gfx/pics.asm", loader: "home/pics.asm", naming: "home/names2.asm", layout: "layout.link",
};
async function state(source: ProjectSource) {
  const index = await parsePokemonIndex(source);
  const paths = [...Object.values(P), "constants/trainer_constants.asm", "constants/move_constants.asm", "data/moves/moves.asm", "data/moves/names.asm", "data/moves/animations.asm", "main.asm", "ram/wram.asm", ...index.filter(entry => entry.kind === "pokemon" && entry.sourceSlug).map(entry => `data/pokemon/base_stats/${entry.sourceSlug}.asm`)];
  const snapshot = await creationSnapshot(source, paths);
  for (const file of snapshot.files.filter(file => file.contents.includes("; yellow-editor") && file.contents.includes(legacyPokedexMask))) {
    if (!snapshot.stamps.some(stamp => stamp.path === file.path)) snapshot.stamps.push({ path: file.path, hash: await hashText(file.contents) });
  }
  return { ...snapshot, index };
}
export async function loadPokemonCreateDocument(source: ProjectSource): Promise<PokemonCreateDocument> {
  const current = await state(source), count = current.symbols.get("NUM_POKEMON_INDEXES"), dexCount = current.symbols.get("NUM_POKEMON"), opponentOffset = current.symbols.get("OPP_ID_OFFSET");
  let reason: string | null = null;
  if (count === undefined || dexCount === undefined || opponentOffset === undefined) throw new Error("Cannot resolve the species, Pokédex and opponent ID bounds.");
  if (count + 1 >= opponentOffset || dexCount + 1 >= 255) reason = "No safe species ID remains within the current one-byte opponent and Pokédex ranges. Further expansion needs engine support.";
  for (const [path, label, directive] of [[P.names, "MonsterNames", "dname"], [P.order, "PokedexOrder", "db"], [P.cries, "CryData", "mon_cry"], [P.evos, "EvosMovesPointerTable", "dw"], [P.entries, "PokedexEntryPointers", "dw"]]) if (rows(current.text.get(path)!, label, directive).length !== count) reason = "Species-indexed tables must be synchronized before adding a Pokémon.";
  const templates = current.index.filter(entry => entry.kind === "pokemon" && entry.constant && entry.sourceSlug).map(entry => ({ id: entry.internalId, constant: entry.constant!, name: entry.displayName, slug: entry.sourceSlug! }));
  return { sources: current.stamps, nextInternalId: count + 1, nextDexNumber: dexCount + 1, templates, moves: (await parseMoves(source)).map(move => move.constant), reason };
}
export async function preparePokemonCreateWrites(source: ProjectSource, document: PokemonCreateDocument, values: PokemonCreateValues) {
  const current = await loadPokemonCreateDocument(source); checkStamps(document.sources, current.sources); if (current.reason) throw new Error(current.reason);
  const { files, text, symbols } = await state(source); identifier(values.constant, files); identifier(`DEX_${values.constant}`, files); gameText(values.name, 10, "Pokémon name"); gameText(values.category, 10, "Pokédex category");
  if (!values.description.length || values.description.length > 6) throw new Error("Use 1–6 Pokédex lines, with at most 18 characters per line.");
  values.description.forEach(line => gameText(line, 18, "Pokédex line"));
  if (!current.moves.includes(values.startingMove)) throw new Error("Choose a starting move from this project.");
  const template = current.templates.find(entry => entry.id === values.templateId); if (!template) throw new Error("Choose an existing Pokémon template.");
  const details = await parsePokemonDetails(source, template.id, template.slug), dexId = symbols.get(details.stats.dexConstant);
  if (dexId === undefined || !details.pokedex) throw new Error("The template's Pokédex identity could not be resolved.");
  const slug = values.constant.toLowerCase(), statsPath = `data/pokemon/base_stats/${slug}.asm`;
  if (await source.exists(statsPath)) throw new Error("That Pokémon source file already exists.");
  const frontLabel = `YellowEditor_${values.constant}_Front`, backLabel = `YellowEditor_${values.constant}_Back`, dexLabel = `YellowEditor_${values.constant}_Dex`, textLabel = `_YellowEditor_${values.constant}_Dex`, evosLabel = `YellowEditor_${values.constant}_EvosMoves`;
  for (const label of [frontLabel, backLabel, dexLabel, textLabel, evosLabel]) if (files.some(file => new RegExp(`\\b${label}\\b`).test(file.contents))) throw new Error(`Label ${label} already exists.`);
  let stats = text.get(`data/pokemon/base_stats/${template.slug}.asm`)!;
  const pair = stats.match(/^[ \t]*dw[ \t]+([A-Za-z_]\w*)[ \t]*,[ \t]*([A-Za-z_]\w*)/m); if (!pair) throw new Error("The template needs a standard front/back picture pointer pair.");
  const graphics = await loadGraphicsCatalog(source), creates: TextWriteRequest[] = [];
  for (const [label, path] of [[pair[1], `gfx/pokemon/front/${slug}.png`], [pair[2], `gfx/pokemon/back/${slug}b.png`]]) {
    const candidates = graphics.assets.filter(asset => asset.references.some(ref => ref.labels.includes(label)));
    if (candidates.length !== 1) throw new Error("Each template picture must resolve to one editable source asset.");
    if ((await Promise.all(["png", "pic", "2bpp", "1bpp"].map(extension => source.exists(path.replace(/\.png$/, `.${extension}`))))).some(Boolean)) throw new Error(`Picture ${path} already exists.`);
    const picture = await loadGraphicsDocument(source, candidates[0].path, graphics);
    if (picture.depth !== 2) throw new Error("Pokémon pictures require four-shade source graphics.");
    creates.push({ path, operation: "create", encoding: "hex", contents: bytesToHex(encodeGraphicsPng(picture)) });
  }
  stats = stats.replace(new RegExp(`\\b${details.stats.dexConstant}\\b`), `DEX_${values.constant}`)
    .replace(/INCBIN\s+"gfx\/pokemon\/front\/[^"\n]+\.pic"/, `INCBIN "gfx/pokemon/front/${slug}.pic"`)
    .replace(pair[0], `\tdw ${frontLabel}, ${backLabel}`);
  const starterLines = stats.split(/\r?\n/), starterAt = starterLines.findIndex(line => /^db\s/.test(code(line)) && code(line).slice(2).split(",").length === 4);
  if (starterAt < 0) throw new Error("The template's four starting move slots are not understood.");
  starterLines[starterAt] = `\tdb ${values.startingMove}, NO_MOVE, NO_MOVE, NO_MOVE ; level 1 learnset`;
  creates.push({ path: statsPath, operation: "create", contents: starterLines.join(stats.includes("\r\n") ? "\r\n" : "\n") });
  const updates = new Map<string, string>();
  updates.set(P.constants, before(text.get(P.constants)!, /^[ \t]*DEF[ \t]+NUM_POKEMON_INDEXES\b[^\r\n]*/, `\tconst ${values.constant}`));
  let dexConstants = before(text.get(P.dex)!, /^[ \t]*DEF[ \t]+NUM_POKEMON\b[^\r\n]*/, `\tconst DEX_${values.constant}`);
  if (!dexConstants.includes("; yellow-editor species schema")) dexConstants += "\n; yellow-editor species schema\n";
  updates.set(P.dex, dexConstants);
  const speciesBoundary = /^[ \t]*assert_table_length[ \t]+NUM_POKEMON_INDEXES\b[^\r\n]*/;
  updates.set(P.names, before(text.get(P.names)!, speciesBoundary, `\tdname "${values.name}"`));
  updates.set(P.order, before(text.get(P.order)!, speciesBoundary, `\tdb DEX_${values.constant}`));
  updates.set(P.cries, before(text.get(P.cries)!, speciesBoundary, rows(text.get(P.cries)!, "CryData", "mon_cry")[template.id - 1].split(";", 1)[0] + ` ; ${values.constant}`));
  let base = text.get(P.base)!;
  if (/assert_table_length\s+NUM_POKEMON\s*-\s*1/.test(base)) {
    if (current.nextDexNumber !== 152 || symbols.get("DEX_MEW") !== 151 || !await source.exists("data/pokemon/base_stats/mew.asm")) throw new Error("The separate Mew header layout needs source review.");
    base = base.replace(/^[ \t]*assert_table_length[ \t]+NUM_POKEMON[ \t]*-[ \t]*1[^\r\n]*/m, 'INCLUDE "data/pokemon/base_stats/mew.asm"\n\tassert_table_length NUM_POKEMON');
  }
  const headerCount = [...base.matchAll(/^INCLUDE "data\/pokemon\/base_stats\/[^"\n]+"/gm)].length;
  if (headerCount !== current.nextDexNumber - 1) throw new Error("Base-stat headers do not match the Pokédex order.");
  updates.set(P.base, before(base, /^[ \t]*assert_table_length[ \t]+NUM_POKEMON\b[^\r\n]*/, `INCLUDE "${statsPath}"`));
  const palettes = rows(text.get(P.palettes)!, "MonsterPalettes", "db"); if (palettes.length !== current.nextDexNumber) throw new Error("Pokémon palette table is not synchronized.");
  updates.set(P.palettes, before(text.get(P.palettes)!, /^[ \t]*assert_table_length[ \t]+NUM_POKEMON[ \t]*\+[ \t]*1[^\r\n]*/, palettes[dexId].split(";", 1)[0] + ` ; ${values.constant}`));
  const icons = text.get(P.icons)!.split(/\r?\n/).filter(line => /^nybble\s/.test(code(line)));
  if (icons.length !== current.nextDexNumber - 1) throw new Error("Pokémon menu icons do not match Pokédex order.");
  updates.set(P.icons, before(text.get(P.icons)!, /^[ \t]*end_nybble_array[ \t]+NUM_POKEMON\b[^\r\n]*/, icons[dexId - 1].split(";", 1)[0] + ` ; ${values.constant}`));
  const learned = details.learnset.filter(move => move.level > 1).map(move => `\tdb ${move.level}, ${move.moveConstant}`).join("\n");
  updates.set(P.evos, append(before(text.get(P.evos)!, speciesBoundary, `\tdw ${evosLabel}`), `${evosLabel}:\n\tdb 0 ; no evolutions\n${learned}${learned ? "\n" : ""}\tdb 0 ; end learnset`));
  const dex = details.pokedex;
  updates.set(P.entries, append(before(text.get(P.entries)!, speciesBoundary, `\tdw ${dexLabel}`), `${dexLabel}:\n\tdb "${values.category}@"\n\tdb ${dex.heightFeet}, ${dex.heightInches}\n\tdw ${dex.weightTenthsLb}\n\ttext_far ${textLabel}\n\ttext_end`));
  updates.set(P.text, append(text.get(P.text)!, `${textLabel}::\n${values.description.map((line, i) => `\t${i === 0 ? "text" : i === 3 ? "page" : "next"} "${line}"`).join("\n")}\n\tdex`));
  const pics = text.get(P.pictures)!, beforeTrainers = pics.split(/^[ \t]*SECTION "Trainer Pics"/m)[0];
  const sections = beforeTrainers.split(/\r?\n/).filter(line => /^SECTION\b/.test(code(line))); if (code(sections[sections.length - 1] ?? "") !== 'SECTION "Pics 5", ROMX') throw new Error("New species currently require the standard Pics 5 image bank routing.");
  updates.set(P.pictures, before(pics, /^[ \t]*SECTION "Trainer Pics"[^\r\n]*/, `${frontLabel}:: INCBIN "gfx/pokemon/front/${slug}.pic"\n${backLabel}:: INCBIN "gfx/pokemon/back/${slug}b.pic"\n`));
  updates.set(P.naming, extendNames(text.get(P.naming)!));
  const ram = text.get("ram/wram.asm")!;
  if (!ram.includes("; yellow-editor Pokédex padding")) {
    const padding = /(wWalkBikeSurfState:: db\r?\n\r?\n)[ \t]*ds 10(\r?\n\r?\nwTownVisitedFlag:: flag_array NUM_CITY_MAPS)/;
    if (!padding.test(ram) || !ram.includes("wPokedexOwned:: flag_array NUM_POKEMON") || !ram.includes("wPokedexSeen:: flag_array NUM_POKEMON")) throw new Error("The expanded Pokédex needs reviewed unused RAM padding before adding species.");
    updates.set("ram/wram.asm", ram.replace(padding, "$1; yellow-editor Pokédex padding\n\tds 10 - 2 * ((NUM_POKEMON + 7) / 8 - 19)$2"));
  }
  // Pics 5 is the existing route for appended species; preserve that complete group.
  let layout = freeSections(text.get(P.layout)!, files, [P.base, P.cries, P.evos, P.entries, P.text, P.palettes, P.icons, P.names, P.order]);
  layout = layout.split(/\r?\n/).filter(line => line.trim() !== '"Pics 5"').join(layout.includes("\r\n") ? "\r\n" : "\n");
  updates.set(P.layout, layout);
  // Earlier managed count checks masked out the whole final byte at Pokédex #152.
  for (const file of files.filter(file => file.contents.includes("; yellow-editor") && file.contents.includes(legacyPokedexMask))) updates.set(file.path, upgradePokedexMask(updates.get(file.path) ?? file.contents));
  return { internalId: current.nextInternalId, dexNumber: current.nextDexNumber, sourceSlug: slug, changes: [...creationWrites(text, current.sources, updates), ...creates] };
}
