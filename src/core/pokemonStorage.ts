import { append, code, newline } from "./creationSupport";

const begin = "; yellow-editor species pic banks begin";
const end = "; yellow-editor species pic banks end";
const shim = ["; yellow-editor species pic bank dispatch", "\tpush bc", "\tpush de", "\tpush hl", "\tfarcall YellowEditor_MonPicBank", "\tld a, e", "\tpop hl", "\tpop de", "\tpop bc", "\tjp UncompressSpriteData"].join("\n");
interface Entry { constant: string; front: string }
function legacy(red: boolean) {
  return ["\tld a, [wCurPartySpecies]", "\tld b, a", ...(red ? ["\tcp MEW", "\tld a, BANK(MewPicFront)", "\tjr z, .GotBank", "\tld a, b"] : []),
    "\tcp FOSSIL_KABUTOPS", "\tld a, BANK(FossilKabutopsPic)", "\tjr z, .GotBank", "\tld a, b",
    "\tcp TANGELA + 1", '\tld a, BANK("Pics 1")', "\tjr c, .GotBank", "\tld a, b",
    "\tcp MOLTRES + 1", '\tld a, BANK("Pics 2")', "\tjr c, .GotBank", "\tld a, b",
    "\tcp BEEDRILL + 2", '\tld a, BANK("Pics 3")', "\tjr c, .GotBank", "\tld a, b",
    "\tcp STARMIE + 1", '\tld a, BANK("Pics 4")', "\tjr c, .GotBank", '\tld a, BANK("Pics 5")', ".GotBank"];
}
function runtime(entries: Entry[], red: boolean) {
  return [begin, `; yellow-editor species pic profile ${red ? "red" : "yellow"}`, "PUSHS", 'SECTION "Editor species picture routing", ROMX', "YellowEditor_MonPicBank::",
    "\tld a, [wCurPartySpecies]", "\tld b, a", "\tld hl, .entries", ".find", "\tld a, [hli]", "\tand a", "\tjr z, .legacy", "\tcp b", "\tjr z, .found", "\tinc hl", "\tjr .find", ".found", "\tld e, [hl]", "\tret", ".legacy",
    ...legacy(red), "\tld e, a", "\tret", ".entries", ...entries.map(e => `\tdb ${e.constant}, BANK(${e.front})`), "\tdb 0", "POPS", end].join("\n");
}
/** Independent small ROMX sections avoid overflowing any of the five original picture banks. */
export function addPokemonPictures(pictures: string, loader: string, constant: string, slug: string, front: string, back: string) {
  let entries: Entry[] = [], red = false;
  const at = pictures.indexOf(begin), to = pictures.indexOf(end);
  if (at >= 0) {
    const old = pictures.slice(at, to + end.length).replace(/\r\n/g, "\n");
    red = old.includes("; yellow-editor species pic profile red");
    entries = [...old.matchAll(/^\tdb ([A-Z][A-Z0-9_]*), BANK\(([A-Za-z_]\w*)\)$/gm)].map(m => ({ constant: m[1], front: m[2] }));
    if (to < at || pictures.split(begin).length !== 2 || old !== runtime(entries, red) || !loader.replace(/\r\n/g, "\n").includes(shim)) throw new Error("The managed species picture routing was changed in source. Review it before adding Pokémon.");
    pictures = pictures.slice(0, at) + runtime([...entries, { constant, front }], red).replace(/\n/g, newline(pictures)) + pictures.slice(to + end.length);
  } else {
    const pattern = /; define \(by index number\) the bank that a pokemon's image is in[\s\S]*?\tjp UncompressSpriteData/;
    const block = loader.match(pattern)?.[0];
    if (!block) throw new Error("The species picture loader needs source review before allocating independent banks.");
    red = block.includes("\tcp MEW");
    if (block.split(/\r?\n/).map(code).filter(Boolean).join("\n") !== [...legacy(red), "\tjp UncompressSpriteData"].map(code).join("\n")) throw new Error("This project's species picture bank routing is unsupported.");
    if (/\bYellowEditor_MonPicBank\b/.test(pictures + loader)) throw new Error("The species picture routing symbol is already used.");
    loader = loader.replace(pattern, shim.replace(/\n/g, newline(loader)));
    pictures = append(pictures, runtime([{ constant, front }], red));
  }
  pictures = append(pictures, ["PUSHS", `SECTION "Editor Pokemon ${constant} pictures", ROMX`, `${front}:: INCBIN "gfx/pokemon/front/${slug}.pic"`, `${back}:: INCBIN "gfx/pokemon/back/${slug}b.pic"`, `\tASSERT BANK(${front}) == BANK(${back})`, "POPS"].join("\n"));
  return { pictures, loader };
}

/** Absorb the larger flags in twelve reviewed unused bytes, leaving scene storage and the stack intact. */
export function expandPokemonRam(ram: string) {
  const nl = newline(ram), growth = "2 * ((NUM_POKEMON + 7) / 8 - 19)";
  const first = /(wWalkBikeSurfState:: db\r?\n\r?\n)(?:; yellow-editor Pokédex padding\r?\n)?[ \t]*ds (?:10|10 - 2 \* \(\(NUM_POKEMON \+ 7\) \/ 8 - 19\))(\r?\n\r?\nwTownVisitedFlag:: flag_array NUM_CITY_MAPS)/;
  const firstOwned = [`; yellow-editor expanded Pokédex padding`, "IF NUM_POKEMON <= 192", `\tds 10 - ${growth}`, "ENDC"].join(nl);
  const second = /(wFossilMon:: db\r?\n\r?\n)[ \t]*ds 2(\r?\n\r?\n; trainer classes start at OPP_ID_OFFSET)/;
  const secondOwned = ["; yellow-editor expanded Pokédex padding tail", "IF NUM_POKEMON > 192", `\tds 12 - ${growth}`, "ELSE", "\tds 2", "ENDC", `\tASSERT ${growth} <= 12`].join(nl);
  if (ram.includes(firstOwned) && ram.includes(secondOwned)) return ram;
  if (!ram.includes("wPokedexOwned:: flag_array NUM_POKEMON") || !ram.includes("wPokedexSeen:: flag_array NUM_POKEMON") || !first.test(ram) || !second.test(ram)) throw new Error("Expanded Pokédex storage needs the reviewed unused RAM padding. No species was created.");
  return ram.replace(first, `$1${firstOwned}$2`).replace(second, `$1${secondOwned}$2`);
}
