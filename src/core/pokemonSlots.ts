import type { ProjectRgbdsSourceFile } from "./projectConstants";
import type { PokemonIndexEntry } from "./types";
import { code, rows } from "./creationSupport";

const tablePaths = {
  names: "data/pokemon/names.asm", order: "data/pokemon/dex_order.asm",
  cries: "data/pokemon/cries.asm", evos: "data/pokemon/evos_moves.asm",
  dex: "data/pokemon/dex_entries.asm",
};
const token = "(?:\\$[0-9a-fA-F]+|%[01]+|[A-Za-z_][A-Za-z_0-9]*|[0-9]+)";
// These nine unused entries retain distinct cries in both reviewed games.
const unusedCries = new Map<number, string>([
  [67, "SFX_CRY_00,$80,$10"], [69, "SFX_CRY_1D,$E0,$80"], [79, "SFX_CRY_22,$FF,$40"],
  [81, "SFX_CRY_0E,$E0,$60"], [94, "SFX_CRY_0F,$40,$C0"], [95, "SFX_CRY_0F,$20,$C0"],
  [127, "SFX_CRY_11,$20,$10"], [137, "SFX_CRY_0F,$40,$80"], [181, "SFX_CRY_1D,$00,$80"],
]);
function number(value: string, symbols: Map<string, number>) {
  const s = value.trim();
  if (/^\$[\da-f]+$/i.test(s)) return parseInt(s.slice(1), 16);
  if (/^%[01]+$/.test(s)) return parseInt(s.slice(1), 2);
  return /^\d+$/.test(s) ? Number(s) : symbols.get(s);
}
/** Species operands only: unrelated item, map, move and tile numbers are valid overlaps. */
function referencedSpecies(files: ProjectRgbdsSourceFile[], symbols: Map<string, number>) {
  const used = new Set<number>();
  const add = (s: string) => { const n = number(s, symbols); if (n !== undefined) used.add(n); };
  for (const file of files) {
    const lines = file.contents.split(/\r?\n/).map(code);
    if (/^data\/wild\//.test(file.path)) for (const line of lines) {
      const row = line.match(new RegExp(`^db\\s+${token}\\s*,\\s*(${token})$`)); if (row) add(row[1]);
    }
    if (file.path === "data/trainers/parties.asm") for (const line of lines) {
      if (!/^db\s/.test(line)) continue;
      const args = line.slice(2).split(",").map(s => s.trim());
      const individual = number(args[0], symbols) === 255;
      for (let i = individual ? 2 : 1; i < args.length - 1; i += individual ? 2 : 1) add(args[i]);
    }
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const evolution = line.match(/^db\s+EVOLVE_(?:LEVEL|ITEM|TRADE)\s*,.*?,\s*([^,]+)$/); if (evolution) add(evolution[1]);
      const macro = line.match(new RegExp(`^(?:give_mon|givemon|wild_mon|wildmon|party_mon)\\s+(${token})(?:\\s*,|$)`, "i")); if (macro) add(macro[1]);
      const load = line.match(new RegExp(`^ld\\s+a,\\s*(${token})$`));
      if (load) {
        // Follow immediate A through stores and non-clobbering setup. Stop at an
        // unknown instruction rather than guessing about arbitrary engine code.
        for (const next of lines.slice(i + 1, i + 9)) {
          if (!next || /^(?:push|pop)\s+(?:bc|de|hl)$/.test(next)) continue;
          if (/^ld\s+\[(?:wCurPartySpecies|wCurSpecies|wCurEnemySpecies|wEnemyMonSpecies|wBattleMonSpecies|wPokedexNum|wcf91)\],\s*a$/.test(next)) { add(load[1]); break; }
          if (!/^ld\s+\[[^\]]+\],\s*a$/.test(next)) break;
        }
      }
    }
  }
  return used;
}

export function inspectPokemonSlots(index: PokemonIndexEntry[], text: Map<string, string>, files: ProjectRgbdsSourceFile[], symbols: Map<string, number>) {
  const names = rows(text.get(tablePaths.names)!, "MonsterNames", "dname");
  const order = rows(text.get(tablePaths.order)!, "PokedexOrder", "db");
  const cries = rows(text.get(tablePaths.cries)!, "CryData", "mon_cry");
  const evos = rows(text.get(tablePaths.evos)!, "EvosMovesPointerTable", "dw");
  const dex = rows(text.get(tablePaths.dex)!, "PokedexEntryPointers", "dw");
  const used = referencedSpecies(files, symbols), blocked: number[] = [], reclaimed: number[] = [];
  const references = new Map<string, number>();
  for (const file of files) for (const label of file.contents.split(/\r?\n/).map(code).join("\n").match(/\bMissingNo[0-9A-F]+EvosMoves\b/g) ?? []) references.set(label, (references.get(label) ?? 0) + 1);
  const aliases = new Set([...text.get("constants/pokemon_constants.asm")!.matchAll(/^\s*DEF\s+(\w+)\s+EQU\s+([^;\r\n]+)/gm)].map(m => symbols.get(m[1]) ?? number(m[2], symbols)));
  const placeholder = text.get(tablePaths.dex)!.split(/^MissingNoDexEntry::{0,1}[ \t]*$/m)[1]?.split(/^[A-Za-z_]\w*::{0,1}/m)[0];
  const vanillaDexEntry = placeholder?.split(/\r?\n/).map(code).filter(Boolean).join("\n") === 'db "???@"\ndb 10\ndw 100\ndb "コメント　さくせいちゅう@"';
  for (const entry of index.filter(entry => entry.kind === "missingno" && entry.internalId > 0)) {
    const id = entry.internalId, at = id - 1;
    const label = code(evos[at] ?? "").match(/^dw\s+(MissingNo[0-9A-F]+EvosMoves)$/)?.[1];
    const body = label && text.get(tablePaths.evos)!.split(new RegExp(`^${label}::{0,1}\\s*$`, "m"))[1]?.split(/^[A-Za-z_]\w*::{0,1}/m)[0];
    const privateLabel = label && references.get(label) === 2;
    const unchanged = /^dname\s+"MISSINGNO\.@?"$/i.test(code(names[at] ?? ""))
      && /^db\s+0$/.test(code(order[at] ?? ""))
      && code(cries[at] ?? "").replace(/^mon_cry\s+/, "").replace(/\s/g, "") === (unusedCries.get(id) ?? "SFX_CRY_00,$00,$00")
      && code(dex[at] ?? "") === "dw MissingNoDexEntry"
      && body?.split(/\r?\n/).map(code).filter(Boolean).join("\n") === "db 0\ndb 0";
    (vanillaDexEntry && unchanged && privateLabel && !aliases.has(id) && !used.has(id) ? reclaimed : blocked).push(id);
  }
  const count = symbols.get("NUM_POKEMON_INDEXES")!, offset = Math.min(symbols.get("OPP_ID_OFFSET")!, 255);
  const appended: number[] = [];
  for (let id = count + 1; id < offset; id++) { if (used.has(id)) break; appended.push(id); }
  // The reviewed twelve bytes of RAM padding cover Pokédex counts through 200.
  const dexRoom = Math.max(0, 200 - symbols.get("NUM_POKEMON")!);
  const available = [...reclaimed, ...appended].slice(0, dexRoom);
  return { available, reclaimed, appended, blocked };
}

export function claimSpeciesConstant(text: string, id: number, constant: string) {
  const lines = text.split(/\r?\n/); let counter = 0, claimed = false;
  for (let i = 0; i < lines.length; i++) {
    const line = code(lines[i]);
    if (line === "const_def") { counter = 0; continue; }
    if (line === "const_skip" && counter === id) { lines[i] = lines[i].replace(/\bconst_skip\b/, `const ${constant}`); claimed = true; break; }
    if (/^const\s/.test(line) || line === "const_skip") counter++;
  }
  if (!claimed) throw new Error(`Species slot ${id} is no longer an unused constant entry.`);
  return lines.join(text.includes("\r\n") ? "\r\n" : "\n");
}

export function replaceSpeciesRow(text: string, label: string, directive: string, id: number, replacement: string) {
  const table = rows(text, label, directive), previous = table[id - 1];
  if (!previous) throw new Error(`Species slot ${id} is outside ${label}.`);
  const lines = text.split(/\r?\n/), start = lines.findIndex(line => new RegExp(`^${label}::{0,1}$`).test(code(line)));
  let row = 0, replaced = false;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^assert_table_length\b/.test(code(lines[i]))) break;
    if (new RegExp(`^${directive}\\s`).test(code(lines[i])) && ++row === id) { lines[i] = replacement; replaced = true; break; }
  }
  if (!replaced) throw new Error(`Cannot update species slot ${id} in ${label}.`);
  return lines.join(text.includes("\r\n") ? "\r\n" : "\n");
}
