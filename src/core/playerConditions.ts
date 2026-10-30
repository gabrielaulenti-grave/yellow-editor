// Read-only predicates shared by interaction entry, branches and NPC visibility.
// Keep the old event shape valid so existing managed source regenerates exactly.
export type PlayerCondition =
  | { kind?: "event"; event: string; set: boolean }
  | { kind: "hall-of-fame" }
  | { kind: "item"; item: string; quantity: number }
  | { kind: "money" | "coins"; amount: number }
  | { kind: "party-species"; species: string }
  | { kind: "party-move"; move: string; species?: string }
  | { kind: "badge"; badge: string }
  | { kind: "badge-count"; minimum: number }
  | { kind: "party-count"; minimum: number }
  | { kind: "bag-space"; minimum: number }
  | { kind: "dex-species"; species: string; status: "seen" | "caught" }
  | { kind: "dex-count"; minimum: number; status: "seen" | "caught" }
  | { kind: "travel"; mode: "walking" | "cycling" | "surfing" }
  | { kind: "all" | "any"; conditions: PlayerCondition[] }
  | { kind: "not"; condition: PlayerCondition };

export interface PlayerConditionDomain { reason: string | null; moves: string[]; badges: string[]; dexPokemon: string[] }
export interface ConditionDomains { sharedFlags?: Array<{ event: string; label: string }>; items: string[]; pokemon: string[]; events: string[]; conditions?: PlayerConditionDomain }
export const conditionBadges = ["BOULDER", "CASCADE", "THUNDER", "RAINBOW", "SOUL", "MARSH", "VOLCANO", "EARTH"];
const integer = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max;
export const legacyPokedexMask = "and (1 << (NUM_POKEMON % 8)) - 1";
export const expandedPokedexMask = "and (1 << ((NUM_POKEMON - 1) % 8 + 1)) - 1";
export function upgradePokedexMask(text: string) { return text.split(legacyPokedexMask).join(expandedPokedexMask); }
export function isEventCondition(c: PlayerCondition): c is Extract<PlayerCondition, { event: string }> { return !c.kind || c.kind === "event"; }
export function inspectPlayerConditions(files: Map<string, string>, symbols: Map<string, number>): PlayerConditionDomain {
  const ram = files.get("ram/wram.asm") ?? "", macros = files.get("macros/ram.asm") ?? "";
  const dexNames = [...(files.get("constants/pokedex_constants.asm") ?? "").matchAll(/^\s*const (DEX_\w+)\b/gm)].map(m => m[1]);
  const moveNames = [...(files.get("constants/move_constants.asm") ?? "").split("; Moves do double duty as animation identifiers.")[0].matchAll(/^\s*const (\w+)\b/gm)].map(m => m[1]);
  const badgeLayout = conditionBadges.every((name, i) => symbols.get(`BIT_${name}BADGE`) === i) && /^DEF NUM_BADGES EQU const_value\s*(?:;.*)?$/m.test(files.get("constants/ram_constants.asm") ?? "");
  const dexLayout = dexNames.length > 0 && dexNames.length < 255 && dexNames.every((name, i) => symbols.get(name) === i + 1) && /^DEF NUM_POKEMON EQU const_value - 1\s*(?:;.*)?$/m.test(files.get("constants/pokedex_constants.asm") ?? "");
  const required = [/wNumHoFTeams:: db/, /wPartyCount:: db/, /wPartySpecies:: ds PARTY_LENGTH \+ 1/, /wPokedexOwned:: flag_array NUM_POKEMON/, /wPokedexSeen:: flag_array NUM_POKEMON/, /wNumBagItems:: db/, /wBagItems:: ds BAG_ITEM_CAPACITY \* 2 \+ 1/, /wPlayerMoney:: ds 3/, /wPlayerCoins:: dw/, /wObtainedBadges:: flag_array NUM_BADGES/, /wWalkBikeSurfState:: db/];
  const compatible = required.every(pattern => pattern.test(ram)) && /\\1Moves::\s+ds NUM_MOVES/.test(macros)
    && symbols.get("PARTY_LENGTH") === 6 && symbols.get("NUM_MOVES") === 4 && symbols.get("BAG_ITEM_CAPACITY") === 20
    && badgeLayout && dexLayout;
  return { reason: compatible ? null : "Player conditions require the reviewed Red/Yellow party, bag, money and Pokédex layouts.",
    moves: moveNames.filter(name => (symbols.get(name) ?? 0) > 0 && (symbols.get(name) ?? 0) <= (symbols.get("NUM_ATTACKS") ?? moveNames.length)),
    badges: conditionBadges,
    dexPokemon: dexNames.filter(name => symbols.has(name)).map(name => name.slice(4)),
  };
}
export function validatePlayerCondition(condition: PlayerCondition, domains: ConditionDomains) {
  let count = 0;
  function visit(c: PlayerCondition, depth: number) {
    if (!c || typeof c !== "object" || ++count > 24 || depth > 4) throw new Error("Use at most 24 condition checks and four nested groups.");
    if (isEventCondition(c)) { if (!domains.events.includes(c.event) || typeof c.set !== "boolean") throw new Error("Choose an existing event for the condition."); return; }
    if (!domains.conditions || domains.conditions.reason) throw new Error(domains.conditions?.reason ?? "Player condition dependencies are unavailable.");
    switch (c.kind) {
      case "all": case "any":
        if (!Array.isArray(c.conditions) || !c.conditions.length || c.conditions.length > 8) throw new Error("Choose 1–8 checks in each condition group.");
        c.conditions.forEach(child => visit(child, depth + 1)); return;
      case "not": visit(c.condition, depth + 1); return;
      case "hall-of-fame": return;
      case "item": if (domains.items.includes(c.item) && integer(c.quantity, 1, 99)) return; break;
      case "money": case "coins": if (integer(c.amount, 0, c.kind === "money" ? 999999 : 9999)) return; break;
      case "party-species": if (domains.pokemon.includes(c.species)) return; break;
      case "party-move": if (domains.conditions.moves.includes(c.move) && (c.species === undefined || domains.pokemon.includes(c.species))) return; break;
      case "badge": if (conditionBadges.includes(c.badge)) return; break;
      case "badge-count": if (integer(c.minimum, 0, 8)) return; break;
      case "party-count": if (integer(c.minimum, 0, 6)) return; break;
      case "bag-space": if (integer(c.minimum, 0, 20)) return; break;
      case "dex-species": if (domains.conditions.dexPokemon.includes(c.species) && ["seen", "caught"].includes(c.status)) return; break;
      case "dex-count": if (integer(c.minimum, 0, domains.conditions.dexPokemon.length) && ["seen", "caught"].includes(c.status)) return; break;
      case "travel": if (["walking", "cycling", "surfing"].includes(c.mode)) return; break;
    }
    throw new Error("Choose valid player condition values.");
  }
  visit(condition, 0);
}
export function bcdBytes(value: number, length: number) { return value.toString().padStart(length * 2, "0").match(/../g)!.map(pair => `$${pair}`); }

// Both exits are explicit. These predicates read state without changing native
// menu scratch, event flags, inventories, party selection or Pokédex state.
export function renderPlayerCondition(c: PlayerCondition, yes: string, no: string, prefix: string): string[] {
  let serial = 0;
  const label = () => `.${prefix.replace(/\W/g, "")}Check${serial++}`;
  function emit(c: PlayerCondition, yes: string, no: string): string[] {
    const out: string[] = [], l = label();
    const cmp = (minimum: number) => [`\tcp ${minimum}`, `\tjp nc, ${yes}`, `\tjp ${no}`];
    if (isEventCondition(c)) return [`\tCheckEvent ${c.event}`, `\tjp ${c.set ? "nz" : "z"}, ${yes}`, `\tjp ${no}`];
    switch (c.kind) {
      case "not": return emit(c.condition, no, yes);
      case "all": case "any":
        c.conditions.forEach((child, i) => { const next = i === c.conditions.length - 1 ? (c.kind === "all" ? yes : no) : label(); out.push(...emit(child, c.kind === "all" ? next : yes, c.kind === "all" ? no : next)); if (i < c.conditions.length - 1) out.push(next); }); return out;
      case "hall-of-fame": return ["\tld a, [wNumHoFTeams]", "\tand a", `\tjp nz, ${yes}`, `\tjp ${no}`];
      case "money": case "coins":
        bcdBytes(c.amount, c.kind === "money" ? 3 : 2).forEach((byte, i) => out.push(`\tld a, [${c.kind === "money" ? "wPlayerMoney" : "wPlayerCoins"} + ${i}]`, `\tcp ${byte}`, `\tjp c, ${no}`, `\tjp nz, ${yes}`)); return [...out, `\tjp ${yes}`];
      case "item":
        return ["\tld a, [wNumBagItems]", "\tcp BAG_ITEM_CAPACITY + 1", `\tjp nc, ${no}`, "\tand a", `\tjp z, ${no}`, "\tld b, a", "\tld c, 0", "\tld hl, wBagItems", l,
          "\tld a, [hli]", `\tcp ${c.item}`, `\tjr nz, ${l}Next`, "\tld a, [hl]", "\tadd c", `\tjp c, ${yes}`, `\tcp ${c.quantity}`, `\tjp nc, ${yes}`, "\tld c, a", `${l}Next`, "\tinc hl", "\tdec b", `\tjr nz, ${l}`, `\tjp ${no}`];
      case "party-species": return ["\tld a, [wPartyCount]", "\tcp PARTY_LENGTH + 1", `\tjp nc, ${no}`, "\tand a", `\tjp z, ${no}`, "\tld b, a", "\tld hl, wPartySpecies", l, "\tld a, [hli]", `\tcp ${c.species}`, `\tjp z, ${yes}`, "\tdec b", `\tjr nz, ${l}`, `\tjp ${no}`];
      case "party-move":
        return ["\tld a, [wPartyCount]", "\tcp PARTY_LENGTH + 1", `\tjp nc, ${no}`, "\tand a", `\tjp z, ${no}`, "\tld b, a", "\tld hl, wPartyMon1", l,
          ...(c.species ? ["\tld a, [hl]", `\tcp ${c.species}`, `\tjr nz, ${l}Next`] : []),
          "\tpush hl", "\tld de, MON_MOVES", "\tadd hl, de", "\tld c, NUM_MOVES", `${l}Moves`, "\tld a, [hli]", `\tcp ${c.move}`, `\tjr z, ${l}Found`, "\tdec c", `\tjr nz, ${l}Moves`, "\tpop hl", `${l}Next`, "\tld de, PARTYMON_STRUCT_LENGTH", "\tadd hl, de", "\tdec b", `\tjr nz, ${l}`, `\tjp ${no}`, `${l}Found`, "\tpop hl", `\tjp ${yes}`];
      case "badge": return ["\tld a, [wObtainedBadges]", `\tbit ${conditionBadges.indexOf(c.badge)}, a`, `\tjp nz, ${yes}`, `\tjp ${no}`];
      case "badge-count": case "dex-count": {
        const address = c.kind === "badge-count" ? "wObtainedBadges" : c.status === "caught" ? "wPokedexOwned" : "wPokedexSeen";
        return [`\tld hl, ${address}`, `\tld b, ${c.kind === "badge-count" ? 1 : "(NUM_POKEMON + 7) / 8"}`, "\tld c, 0", l, "\tld a, [hli]", ...(c.kind === "dex-count" ? ["\tld d, a", "\tld a, b", "\tcp 1", "\tld a, d", `\tjr nz, ${l}Byte`, "\tand (1 << ((NUM_POKEMON - 1) % 8 + 1)) - 1", `${l}Byte`] : []), "\tld d, 8", `${l}Bits`, "\tsrl a", `\tjr nc, ${l}Clear`, "\tinc c", `${l}Clear`, "\tdec d", `\tjr nz, ${l}Bits`, "\tdec b", `\tjr nz, ${l}`, "\tld a, c", ...cmp(c.minimum)];
      }
      case "dex-species": return [`\tld a, [${c.status === "caught" ? "wPokedexOwned" : "wPokedexSeen"} + (DEX_${c.species} - 1) / 8]`, `\tbit (DEX_${c.species} - 1) % 8, a`, `\tjp nz, ${yes}`, `\tjp ${no}`];
      case "party-count": return ["\tld a, [wPartyCount]", ...cmp(c.minimum)];
      case "bag-space": return ["\tld a, [wNumBagItems]", `\tcp BAG_ITEM_CAPACITY - ${c.minimum} + 1`, `\tjp c, ${yes}`, `\tjp ${no}`];
      case "travel": return ["\tld a, [wWalkBikeSurfState]", `\tcp ${{ walking: 0, cycling: 1, surfing: 2 }[c.mode]}`, `\tjp z, ${yes}`, `\tjp ${no}`];
    }
  }
  return emit(c, yes, no);
}
export function renderConditionFailure(c: PlayerCondition, no: string, prefix: string) {
  if (isEventCondition(c)) return [`\tCheckEvent ${c.event}`, `\tjp ${c.set ? "z" : "nz"}, ${no}`];
  const yes = `.${prefix.replace(/\W/g, "")}Matched`;
  return [...renderPlayerCondition(c, yes, no, prefix), yes];
}
export function describePlayerCondition(c: PlayerCondition): string {
  const name = (s: string) => s.replace(/^EVENT_/, "").replace(/_/g, " ");
  if (isEventCondition(c)) return `${name(c.event)} is ${c.set ? "set" : "clear"}`;
  switch (c.kind) {
    case "not": return `not (${describePlayerCondition(c.condition)})`;
    case "all": case "any": return c.conditions.map(child => `(${describePlayerCondition(child)})`).join(c.kind === "all" ? " and " : " or ");
    case "hall-of-fame": return "the player has entered the Hall of Fame";
    case "item": return `the bag contains at least ${c.quantity} ${name(c.item)}`;
    case "money": case "coins": return `the player has at least ${c.amount} ${c.kind}`;
    case "party-species": return `${name(c.species)} is in the current party`;
    case "party-move": return `${c.species ? name(c.species) : "a party Pokémon"} knows ${name(c.move)}`;
    case "badge": return `the player has the ${name(c.badge)} BADGE`;
    case "badge-count": return `the player has at least ${c.minimum} badges`;
    case "party-count": return `the party contains at least ${c.minimum} Pokémon`;
    case "bag-space": return `the bag has at least ${c.minimum} free slots`;
    case "dex-species": return `${name(c.species)} is registered as ${c.status}`;
    case "dex-count": return `the Pokédex records at least ${c.minimum} ${c.status} species`;
    case "travel": return `the player is ${c.mode}`;
  }
}
