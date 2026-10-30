import { SearchableSelect } from "./editor/SearchableSelect";
import { isEventCondition, type PlayerCondition, type ConditionDomains } from "./core/playerConditions";

type Kind = NonNullable<PlayerCondition["kind"]>;
const titles: Record<Kind, string> = { event: "Event flag", "hall-of-fame": "Hall of Fame completed", item: "Item in bag", money: "Money available", coins: "Coins available", "party-species": "Pokémon in party", "party-move": "Move known by party", badge: "Badge obtained", "badge-count": "Badge count", "party-count": "Party size", "bag-space": "Free bag slots", "dex-species": "Pokédex species", "dex-count": "Pokédex count", travel: "Walking, cycling or surfing", all: "All of these checks", any: "Any of these checks", not: "Not this check" };
export function PlayerConditionEditor({ value, onChange, domains, busy, label, eventLabel, setLabel, depth = 0 }: {
  value: PlayerCondition; onChange(value: PlayerCondition): void; domains: ConditionDomains; busy: boolean;
  label: string; eventLabel?: string; setLabel?: string; depth?: number;
}) {
  const conditions = domains.conditions, kind = value.kind ?? "event";
  const pretty = (s: string) => domains.sharedFlags?.find(flag => flag.event === s)?.label ?? s.replace(/^(EVENT_|DEX_)/, "").replace(/_/g, " ");
  function initial(kind: Kind): PlayerCondition {
    switch (kind) {
      case "event": return { event: domains.events[0] ?? "", set: true };
      case "hall-of-fame": return { kind };
      case "item": return { kind, item: domains.items.includes("POTION") ? "POTION" : domains.items[0], quantity: 1 };
      case "money": case "coins": return { kind, amount: 500 };
      case "party-species": return { kind, species: domains.pokemon.includes("LAPRAS") ? "LAPRAS" : domains.pokemon[0] };
      case "party-move": return { kind, move: conditions?.moves.includes("CUT") ? "CUT" : conditions?.moves[0] ?? "" };
      case "badge": return { kind, badge: "BOULDER" };
      case "badge-count": case "party-count": case "bag-space": return { kind, minimum: 1 };
      case "dex-species": return { kind, species: "BULBASAUR", status: "caught" };
      case "dex-count": return { kind, minimum: 30, status: "caught" };
      case "travel": return { kind, mode: "surfing" };
      case "all": case "any": return { kind, conditions: [{ kind: "hall-of-fame" }] };
      case "not": return { kind, condition: { kind: "hall-of-fame" } };
    }
  }
  const options = (title: string, selected: string, choices: string[], change: (s: string) => void) => <label>{title}<SearchableSelect aria-label={title} disabled={busy} value={selected} onChange={e => change(e.target.value)}>{choices.map(s => <option key={s} value={s}>{pretty(s)}</option>)}</SearchableSelect></label>;
  const number = (title: string, n: number, maximum: number, minimum: number, change: (n: number) => void) => <label>{title}<input aria-label={title} type="number" min={minimum} max={maximum} value={Number.isNaN(n) ? "" : n} disabled={busy} onChange={e => change(e.target.valueAsNumber)} /></label>;
  const status = (c: Extract<PlayerCondition, { status: string }>) => <label>{label} registration<select aria-label={`${label} registration`} disabled={busy} value={c.status} onChange={e => onChange({ ...c, status: e.target.value as "seen" | "caught" })}><option value="caught">Caught</option><option value="seen">Seen</option></select></label>;
  return <fieldset className="player-condition" disabled={busy}><legend>{label}</legend>
    <label>Check<select aria-label={`${label} type`} value={kind} onChange={e => onChange(initial(e.target.value as Kind))}>{Object.entries(titles).map(([id, title]) => <option key={id} value={id} disabled={id !== "event" && Boolean(!conditions || conditions.reason) || ["all", "any", "not"].includes(id) && depth >= 4}>{title}</option>)}</select></label>
    {isEventCondition(value) && <>{options(eventLabel ?? `${label} event`, value.event, domains.events, event => onChange({ ...value, event }))}<label><input type="checkbox" disabled={busy} checked={value.set} onChange={e => onChange({ ...value, set: e.target.checked })} />{setLabel ?? "Event must be set"}</label></>}
    {value.kind === "hall-of-fame" && <p className="help-text">Matches after the first Hall of Fame entry, including saved games. It stays true during later Elite Four challenges.</p>}
    {value.kind === "item" && <>{options(`${label} item`, value.item, domains.items, item => onChange({ ...value, item }))}{number(`${label} quantity`, value.quantity, 99, 1, quantity => onChange({ ...value, quantity }))}<p className="help-text">Checks the current bag, including multiple stacks. Items stored in the PC do not count.</p></>}
    {(value.kind === "money" || value.kind === "coins") && number(`${label} amount`, value.amount, value.kind === "money" ? 999999 : 9999, 0, amount => onChange({ ...value, amount }))}
    {value.kind === "party-species" && <>{options(`${label} Pokémon`, value.species, domains.pokemon, species => onChange({ ...value, species }))}<p className="help-text">Checks the current party. Boxed Pokémon and Pokédex registrations do not count.</p></>}
    {value.kind === "party-move" && <>{options(`${label} move`, value.move, conditions?.moves ?? [], move => onChange({ ...value, move }))}<label>{label} move user<SearchableSelect aria-label={`${label} move user`} value={value.species ?? ""} disabled={busy} onChange={e => { const next = { ...value }; if (e.target.value) next.species = e.target.value; else delete next.species; onChange(next); }}><option value="">Any party Pokémon</option>{domains.pokemon.map(s => <option key={s}>{s}</option>)}</SearchableSelect></label><p className="help-text">Checks moves actually known in the current party, including fainted Pokémon. Badge and map permission checks are separate.</p></>}
    {value.kind === "badge" && options(`${label} badge`, value.badge, conditions?.badges ?? [], badge => onChange({ ...value, badge }))}
    {(value.kind === "badge-count" || value.kind === "party-count" || value.kind === "bag-space" || value.kind === "dex-count") && number(`${label} minimum`, value.minimum, value.kind === "badge-count" ? 8 : value.kind === "party-count" ? 6 : value.kind === "bag-space" ? 20 : conditions?.dexPokemon.length ?? 0, 0, minimum => onChange({ ...value, minimum }))}
    {value.kind === "bag-space" && <p className="help-text">Counts unused bag slots. An existing item stack may accept more items even when there are no free slots. Exchanges check actual reward delivery.</p>}
    {value.kind === "dex-species" && options(`${label} Pokédex Pokémon`, value.species, conditions?.dexPokemon ?? [], species => onChange({ ...value, species }))}
    {(value.kind === "dex-species" || value.kind === "dex-count") && status(value)}
    {value.kind === "travel" && <label>{label} travel mode<select aria-label={`${label} travel mode`} value={value.mode} onChange={e => onChange({ ...value, mode: e.target.value as typeof value.mode })}><option value="walking">Walking</option><option value="cycling">Cycling</option><option value="surfing">Surfing</option></select></label>}
    {(value.kind === "all" || value.kind === "any") && <>{value.conditions.map((c, i) => <div key={i}><PlayerConditionEditor value={c} domains={domains} busy={busy} label={`${label} check ${i + 1}`} depth={depth + 1} onChange={condition => onChange({ ...value, conditions: value.conditions.map((old, n) => n === i ? condition : old) })} /><button type="button" className="small-button" disabled={busy || value.conditions.length === 1} onClick={() => onChange({ ...value, conditions: value.conditions.filter((_, n) => n !== i) })}>Remove check {i + 1}</button></div>)}<button type="button" className="small-button" disabled={busy || value.conditions.length >= 8} onClick={() => onChange({ ...value, conditions: [...value.conditions, { kind: "hall-of-fame" as const }] })}>Add condition check</button></>}
    {value.kind === "not" && <PlayerConditionEditor value={value.condition} domains={domains} busy={busy} label={`${label} inverted check`} depth={depth + 1} onChange={condition => onChange({ ...value, condition })} />}
    {conditions?.reason && <p className="help-text">{conditions.reason}</p>}
  </fieldset>;
}
