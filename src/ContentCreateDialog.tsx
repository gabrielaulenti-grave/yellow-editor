import { useEffect, useRef, useState } from "react";
import type { MoveCreateDocument, MoveCreateValues } from "./core/moveCreation";
import type { PokemonCreateDocument, PokemonCreateValues } from "./core/pokemonCreation";
import type { TrainerPartyCreateDocument, TrainerPartyCreateValues } from "./core/trainerPartyCreation";
import type { HistorySummary } from "./core/types";
import { invoke } from "./platform/compat";
import "./ContentCreateDialog.css";

export type ContentKind = "move" | "pokemon" | "trainer";
export interface CreatedContent { kind: ContentKind; history: HistorySummary; id?: number; internalId?: number; dexNumber?: number; sourceSlug?: string; partyId?: string }
type CreationDocument = MoveCreateDocument | PokemonCreateDocument | TrainerPartyCreateDocument;
const titles = { move: "New move", pokemon: "New Pokémon", trainer: "New trainer party" };
const constants = (name: string) => name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const initialMove: MoveCreateValues = { constant: "", name: "", power: 40, accuracy: 100, pp: 20, effect: "NO_ADDITIONAL_EFFECT", moveType: "NORMAL", animation: "POUND", soundMoveId: 1 };

export function ContentCreateDialog({ kind, templateId, classConstant, onClose, onCreated }: {
  kind: ContentKind; templateId?: number; classConstant?: string; onClose(): void; onCreated(result: CreatedContent): Promise<void>;
}) {
  const [document, setDocument] = useState<CreationDocument | null>(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [changed, setChanged] = useState(false), [error, setError] = useState<string | null>(null), [revision, setRevision] = useState(0);
  const [move, setMove] = useState(initialMove), [moveTemplate, setMoveTemplate] = useState(1);
  const [pokemon, setPokemon] = useState<PokemonCreateValues>({ constant: "", name: "", templateId: 0, startingMove: "POUND", category: "NEW", description: ["A new Pokemon."] });
  const [trainer, setTrainer] = useState<TrainerPartyCreateValues>({ classConstant: "", partyFormat: "shared-level", pokemon: [] });
  const [constantEdited, setConstantEdited] = useState(false), dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  useEffect(() => {
    let cancelled = false; setLoading(true); setError(null);
    const command = kind === "move" ? "get_move_create_document" : kind === "pokemon" ? "get_pokemon_create_document" : "get_trainer_party_create_document";
    void invoke<CreationDocument>(command).then(doc => {
      if (cancelled) return;
      setDocument(doc); setChanged(false); setConstantEdited(false);
      if (kind === "move") { const moves = (doc as MoveCreateDocument).moves, chosen = moves.find(move => move.id === templateId) ?? moves[0]; setMoveTemplate(chosen.id); setMove({ ...initialMove, power: chosen.power, accuracy: chosen.accuracy, pp: chosen.pp, effect: chosen.effect, moveType: chosen.moveType, animation: chosen.animation, soundMoveId: chosen.id }); }
      if (kind === "pokemon") { const pokedoc = doc as PokemonCreateDocument, chosen = pokedoc.templates.find(entry => entry.id === templateId) ?? pokedoc.templates.find(entry => entry.constant === "BULBASAUR") ?? pokedoc.templates[0]; setPokemon({ constant: "", name: "", templateId: chosen?.id ?? 0, startingMove: pokedoc.moves[0] ?? "", category: "NEW", description: ["A new Pokemon."] }); }
      if (kind === "trainer") { const td = doc as TrainerPartyCreateDocument; setTrainer({ classConstant: td.classes.find(entry => entry.constant === classConstant)?.constant ?? td.classes[0]?.constant ?? "", partyFormat: "shared-level", pokemon: [{ level: 5, speciesConstant: td.species[0]?.constant ?? "" }] }); }
    }).catch(error => { if (!cancelled) setError(String(error)); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [kind, templateId, classConstant, revision]);
  useEffect(() => { const guard = (event: BeforeUnloadEvent) => { if (changed) { event.preventDefault(); event.returnValue = ""; } }; window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard); }, [changed]);
  const md = kind === "move" ? document as MoveCreateDocument | null : null, pd = kind === "pokemon" ? document as PokemonCreateDocument | null : null, td = kind === "trainer" ? document as TrainerPartyCreateDocument | null : null;
  const named = kind === "move" ? move : pokemon;
  const valid = Boolean(document && !document.reason && (kind === "trainer" ? trainer.classConstant && trainer.pokemon.length > 0 && trainer.pokemon.every(mon => Number.isInteger(mon.level) && mon.level >= 1 && mon.level <= 100 && mon.speciesConstant) : /^[A-Z][A-Z0-9_]{0,47}$/.test(named.constant) && named.name.trim().length > 0));
  const close = () => { if (!busy && (!changed || window.confirm("Discard this unfinished creation form?"))) onClose(); };
  async function create() {
    if (!valid || loading || busy || !document) return;
    setBusy(true); setError(null);
    try {
      const result = await invoke<Omit<CreatedContent, "kind">>(kind === "move" ? "create_move" : kind === "pokemon" ? "create_pokemon" : "create_trainer_party", { document, values: kind === "move" ? move : kind === "pokemon" ? pokemon : trainer });
      setChanged(false); window.dispatchEvent(new CustomEvent("yellow-editor:history-changed", { detail: result.history }));
      await onCreated({ ...result, kind }); onClose();
    } catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  }
  function nameFields() { return <div className="field-grid two-column-fields"><label className="editor-field"><span>Name</span><input aria-label="New content name" maxLength={kind === "move" ? 12 : 10} value={named.name} onChange={event => { setChanged(true); const name = event.target.value.toUpperCase(), constant = constantEdited ? named.constant : constants(name); if (kind === "move") setMove({ ...move, name, constant }); else setPokemon({ ...pokemon, name, constant }); }} /></label><label className="editor-field"><span>Constant</span><input aria-label="New content constant" maxLength={48} value={named.constant} onChange={event => { setChanged(true); setConstantEdited(true); if (kind === "move") setMove({ ...move, constant: event.target.value.toUpperCase() }); else setPokemon({ ...pokemon, constant: event.target.value.toUpperCase() }); }} /></label></div>; }
  return <dialog ref={dialog} className="content-create-dialog" aria-label={titles[kind]} onCancel={event => { event.preventDefault(); close(); }} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); event.stopPropagation(); void create(); } }}>
    <div className="tab-heading-row"><div><h3>{titles[kind]}</h3><p>Create additional content while preserving existing identifiers.</p></div><button type="button" disabled={busy} onClick={close}>Close creation form</button></div>
    {loading && <p role="status">Checking project tables and available identifiers…</p>}
    {error && <p className="graphics-error" role="alert">{error}</p>}
    {document?.reason && <p className="graphics-error" role="status">{document.reason}</p>}
    {document && !loading && <fieldset disabled={busy || Boolean(document.reason)}>
      {kind !== "trainer" && nameFields()}
      {md && <>
        <p className="help-text">New move ID {md.nextId}. Uses an existing battle behavior and an existing or composed animation.</p>
        <label className="editor-field"><span>Copy defaults from move</span><select aria-label="Move template" value={moveTemplate} onChange={event => { setChanged(true); const id = Number(event.target.value), chosen = md.moves.find(move => move.id === id)!; setMoveTemplate(id); setMove({ ...move, power: chosen.power, accuracy: chosen.accuracy, pp: chosen.pp, effect: chosen.effect, moveType: chosen.moveType, animation: chosen.animation, soundMoveId: id }); }}>{md.moves.map(move => <option key={move.id} value={move.id}>{move.name}</option>)}</select></label>
        <div className="field-grid two-column-fields">{(["power", "accuracy", "pp"] as const).map(field => <label className="editor-field" key={field}><span>{field === "pp" ? "PP" : field === "power" ? "Power" : "Accuracy (%)"}</span><input aria-label={`New move ${field}`} type="number" min={field === "pp" ? 1 : 0} max={field === "power" ? 255 : field === "accuracy" ? 100 : 40} value={Number.isFinite(move[field]) ? move[field] : ""} onChange={event => { setChanged(true); setMove({ ...move, [field]: event.target.value === "" ? NaN : Number(event.target.value) }); }} /></label>)}</div>
        <div className="field-grid two-column-fields"><label className="editor-field"><span>Type</span><select aria-label="New move type" value={move.moveType} onChange={event => { setChanged(true); setMove({ ...move, moveType: event.target.value }); }}>{md.types.map(type => <option key={type}>{type}</option>)}</select></label><label className="editor-field"><span>Battle behavior</span><select aria-label="New move behavior" value={move.effect} onChange={event => { setChanged(true); setMove({ ...move, effect: event.target.value }); }}>{md.effects.map(effect => <option key={effect}>{effect}</option>)}</select></label></div>
        <label className="editor-field"><span>Animation</span><select aria-label="New move animation" value={move.animation} onChange={event => { setChanged(true); setMove({ ...move, animation: event.target.value }); }}>{md.animations.map(animation => <option key={animation.constant} value={animation.constant}>{animation.constant} · {animation.label}</option>)}</select></label>
        <label className="editor-field"><span>Sound template</span><select aria-label="New move sound" value={move.soundMoveId} onChange={event => { setChanged(true); setMove({ ...move, soundMoveId: Number(event.target.value) }); }}>{md.moves.map(move => <option key={move.id} value={move.id}>{move.name}</option>)}</select></label><p className="help-text">After creation, teach the move through a Pokémon's starting moves, learnset or TM/HM tools. Animation steps retain their own sound cues.</p>
      </>}
      {pd && <>
        <p className="help-text">New species ID {pd.nextInternalId} · Pokédex #{pd.nextDexNumber}. Creates independent front/back graphics and a base-stat header. Evolutions start empty.</p>
        <label className="editor-field"><span>Pokémon template</span><select aria-label="Pokémon template" value={pokemon.templateId} onChange={event => { setChanged(true); setPokemon({ ...pokemon, templateId: Number(event.target.value) }); }}>{pd.templates.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label><p className="help-text">Copies stats, types, growth, later level-up moves, TM/HM compatibility, cry, palette and menu icon. Edit stats, progression and palettes after creation in Pokémon; draw, import or trace the independent artwork in Graphics.</p>
        <label className="editor-field"><span>Starting move</span><select aria-label="New Pokémon starting move" value={pokemon.startingMove} onChange={event => { setChanged(true); setPokemon({ ...pokemon, startingMove: event.target.value }); }}>{pd.moves.map(move => <option key={move}>{move}</option>)}</select></label>
        <label className="editor-field"><span>Pokédex category</span><input aria-label="New Pokémon category" maxLength={10} value={pokemon.category} onChange={event => { setChanged(true); setPokemon({ ...pokemon, category: event.target.value.toUpperCase() }); }} /></label>
        <label className="editor-field"><span>Pokédex description</span><textarea aria-label="New Pokémon description" rows={6} value={pokemon.description.join("\n")} onChange={event => { setChanged(true); setPokemon({ ...pokemon, description: event.target.value.split("\n") }); }} /><small>One line per row, up to 18 characters each. At most six rows.</small></label><p className="shared-warning">Adding a species changes this project's save schema. Use a new test save; previous builds' save files are not migrated automatically.</p>
      </>}
      {td && <>
        <label className="editor-field"><span>Trainer class</span><select aria-label="New party class" value={trainer.classConstant} onChange={event => { setChanged(true); setTrainer({ ...trainer, classConstant: event.target.value }); }}>{td.classes.map(entry => <option key={entry.constant} value={entry.constant} disabled={entry.nextParty > 255}>{entry.name} · next party #{entry.nextParty}</option>)}</select></label>
        <label className="editor-field"><span>Party levels</span><select aria-label="New party level format" value={trainer.partyFormat} onChange={event => { setChanged(true); const format = event.target.value as TrainerPartyCreateValues["partyFormat"]; setTrainer({ ...trainer, partyFormat: format, pokemon: trainer.pokemon.map(mon => ({ ...mon, level: format === "shared-level" ? trainer.pokemon[0].level : mon.level })) }); }}><option value="shared-level">One shared level</option><option value="individual-levels">Individual levels</option></select></label>
        {trainer.pokemon.map((mon, i) => <div className="creation-party-row" key={i}><label className="editor-field"><span>Pokémon {i + 1}</span><select aria-label={`New party Pokémon ${i + 1}`} value={mon.speciesConstant} onChange={event => { setChanged(true); setTrainer({ ...trainer, pokemon: trainer.pokemon.map((entry, j) => j === i ? { ...entry, speciesConstant: event.target.value } : entry) }); }}>{td.species.map(entry => <option key={entry.constant} value={entry.constant}>{entry.name}</option>)}</select></label><label className="editor-field"><span>Level</span><input aria-label={`New party level ${i + 1}`} type="number" min={1} max={100} value={Number.isFinite(mon.level) ? mon.level : ""} onChange={event => { setChanged(true); const level = event.target.value === "" ? NaN : Number(event.target.value); setTrainer({ ...trainer, pokemon: trainer.pokemon.map((entry, j) => j === i || trainer.partyFormat === "shared-level" ? { ...entry, level } : entry) }); }} /></label><button type="button" disabled={trainer.pokemon.length === 1} aria-label={`Remove new party Pokémon ${i + 1}`} onClick={() => { setChanged(true); setTrainer({ ...trainer, pokemon: trainer.pokemon.filter((_, j) => i !== j) }); }}>Remove</button></div>)}
        <button type="button" disabled={trainer.pokemon.length >= 6} onClick={() => { setChanged(true); setTrainer({ ...trainer, pokemon: [...trainer.pokemon, { level: trainer.pokemon[0]?.level ?? 5, speciesConstant: td.species[0]?.constant ?? "" }] }); }}>Add party Pokémon</button><p className="help-text">The new party becomes available in Maps and scripted battles. Its class supplies the portrait, AI and prize rate. Map placement and dialogue are configured afterward.</p>
      </>}
      <p className="help-text">Creation and its required source updates form one saved undo/redo operation.</p>
      <div className="graphics-controls"><button type="button" className="primary-action" disabled={!valid || busy} onClick={() => void create()}>{busy ? "Creating…" : `Create ${kind === "pokemon" ? "Pokémon" : kind === "trainer" ? "trainer party" : "move"}`}</button><button type="button" disabled={busy} onClick={() => { if (!changed || window.confirm("Discard this form and reload source data?")) setRevision(value => value + 1); }}>Reload creation sources</button></div>
    </fieldset>}
  </dialog>;
}
