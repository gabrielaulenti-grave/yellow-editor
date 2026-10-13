import { useEffect, useRef, useState } from "react";
import { SearchableSelect } from "./editor/SearchableSelect";
import { InteractionSequenceEditor } from "./InteractionSequenceEditor";
import { newSequenceDialogueId, type InteractionAction } from "./core/interactionSequence";
import { invoke } from "./platform/compat";
import type { InteractionDocument, InteractionValues } from "./core/scriptInteractions";
import type { HistorySummary } from "./core/types";

export function ScriptInteractionEditor({ path, label, disabled, onEditStateChange, onSaved }: {
  path: string; label: string; disabled?: boolean;
  onEditStateChange?(open: boolean, dirty: boolean): void;
  onSaved?(history: HistorySummary): void;
}) {
  const [open, setOpen] = useState(false);
  const [document, setDocument] = useState<InteractionDocument | null>(null);
  const [values, setValues] = useState<InteractionValues | null>(null);
  const [item, setItem] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [species, setSpecies] = useState("");
  const [level, setLevel] = useState(5);
  const [routeText, setRouteText] = useState("");
  const [fixBagFull, setFixBagFull] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const callback = useRef(onEditStateChange); callback.current = onEditStateChange;
  const dirty = Boolean(document && (JSON.stringify(values) !== JSON.stringify(document.values) || document.reward && (item !== document.reward.item || quantity !== document.reward.quantity || fixBagFull) || document.gift && (species !== document.gift.species || level !== document.gift.level)));
  useEffect(() => { callback.current?.(open, dirty); }, [open, dirty]);
  useEffect(() => () => callback.current?.(false, false), []);
  async function begin() {
    setOpen(true); setBusy(true); setError(null); setDocument(null);
    try {
      const next = await invoke<InteractionDocument>("get_script_interaction_document", { path, label });
      setDocument(next); setValues(structuredClone(next.values)); setItem(next.reward?.item ?? ""); setQuantity(next.reward?.quantity ?? 1); setFixBagFull(false); setRouteText(next.values.movement?.steps.join(", ") ?? "DOWN");
      setSpecies(next.gift?.species ?? ""); setLevel(next.gift?.level ?? 5);
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }
  function close() { if (dirty && !window.confirm("Discard the unsaved interaction changes?")) return; setOpen(false); setDocument(null); }
  async function save(kind: "reward" | "pokemon" | "interaction") {
    if (!document || !values) return;
    setBusy(true); setError(null);
    try {
      const history = await invoke<HistorySummary>(kind === "reward" ? "save_script_reward" : kind === "pokemon" ? "save_script_pokemon_gift" : "save_script_interaction",
        kind === "reward" ? { document, item, quantity, fixBagFull } : kind === "pokemon" ? { document, species, level } : { document, values });
      setOpen(false); setDocument(null); onSaved?.(history);
      window.dispatchEvent(new CustomEvent("yellow-editor:history-changed", { detail: history }));
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }
  const update = (patch: Partial<InteractionValues>) => setValues(current => current ? { ...current, ...patch } : null);
  const enableScene = () => {
    if (!values || !document || values.scene) return;
    update({ scene: { trigger: "interaction", playerX: document.scene.defaultPlayer.x, playerY: document.scene.defaultPlayer.y, idleState: document.scene.idleStates[0]?.id ?? 0, hiddenNpcs: [] }, movement: null });
  };
  const eventSelect = (value: string, onChange: (next: string) => void, title: string) => <SearchableSelect aria-label={title} value={value} disabled={busy} onChange={event => onChange(event.target.value)}>
    {document?.events.map(event => <option key={event} value={event}>{event.replace(/^EVENT_/, "").replace(/_/g, " ")}</option>)}
  </SearchableSelect>;
  return <>
    <button type="button" className="small-button" disabled={disabled} onClick={() => void begin()}>Edit interaction</button>
    {open && <div className="text-editor-backdrop" role="presentation"><section className="text-editor-dialog" role="dialog" aria-modal="true" aria-label="Edit interaction">
      <div className="text-editor-dialog-heading"><h3>Edit interaction</h3><button className="small-button" disabled={busy} onClick={close}>Close</button></div>
      {busy && !document && <p>Loading interaction…</p>}
      {error && <p className="text-editor-error" role="alert">{error}</p>}
      {document?.reward && <div className="interaction-fields">
        <p>Edit this interaction's item reward. Use <strong>Edit text</strong> to choose and edit its dialogue paths.</p>
        <label>Reward item<SearchableSelect aria-label="Reward item" value={item} disabled={busy} onChange={event => setItem(event.target.value)}>{document.items.map(value => <option key={value} value={value}>{value.replace(/_/g, " ")}</option>)}</SearchableSelect></label>
        <label>Quantity<input aria-label="Reward quantity" type="number" min={1} max={99} disabled={busy} value={quantity} onChange={event => setQuantity(Number(event.target.value))} /></label>
        {document.reward.earlyFlag && <label><input type="checkbox" disabled={busy} checked={fixBagFull} onChange={event => setFixBagFull(event.target.checked)} />Allow another attempt when the bag is full</label>}
        {document.reward.earlyFlag && <p className="help-text">The existing script marks this gift claimed before checking bag space. Selecting this option moves that flag update after successful delivery.</p>}
        <button className="small-button primary-action" disabled={busy || !dirty} onClick={() => void save("reward")}>{busy ? "Saving…" : "Save reward"}</button>
      </div>}
      {document?.gift && <div className="interaction-fields">
        <p>Edit this existing Pokémon gift. Use <strong>Edit text</strong> to change any available associated dialogue.</p>
        <label>Gift Pokémon<SearchableSelect aria-label="Gift Pokémon" value={species} disabled={busy} onChange={event => setSpecies(event.target.value)}>{document.pokemon.map(value => <option key={value} value={value}>{value.replace(/_/g, " ")}</option>)}</SearchableSelect></label>
        <label>Gift level<input aria-label="Gift level" type="number" min={1} max={100} disabled={busy} value={level} onChange={event => setLevel(Number(event.target.value))} /></label>
        <p className="help-text">A full party sends the Pokémon to the current PC box. If both are full, the player can try again. Existing completion flags{document.gift.hidesObject ? " and Poké Ball removal" : ""} are preserved.</p>
        <button className="small-button primary-action" disabled={busy || !dirty} onClick={() => void save("pokemon")}>{busy ? "Saving…" : "Save Pokémon gift"}</button>
      </div>}
      {document && !document.canCreate && !document.reward && !document.gift && <p>{document.reason}</p>}
      {document?.canCreate && values && <div className="interaction-fields">
        <p>Choose what happens when the player interacts. Gifts remain available if delivery fails; approach sequences return the NPC to its starting tile.</p>
        <label><input type="checkbox" disabled={busy} checked={values.showOriginal} onChange={event => update({ showOriginal: event.target.checked })} />Show the original dialogue first</label>
        <label><input type="checkbox" disabled={busy} checked={values.once} onChange={event => update({ once: event.target.checked, hideObject: event.target.checked ? values.hideObject : null })} />Run once per save file</label>
        {!values.actions && <button type="button" className="small-button" disabled={busy || Boolean(values.hideObject)} onClick={() => {
          const actions: InteractionAction[] = [
            ...(values.reward ? [{ kind: "item" as const, ...values.reward }] : []),
            ...(values.pokemon ? [{ kind: "pokemon" as const, ...values.pokemon }] : []),
            { kind: "dialogue", lines: [...values.dialogue], textId: newSequenceDialogueId() },
          ];
          update({ actions, reward: null, pokemon: null });
        }}>Compose action sequence</button>}
        {values.actions ? <>
          <p>Actions run in order. Yes/No and event branches can rejoin the next action or end early. Use one reward per path; failed delivery shows the no-room dialogue and leaves the interaction available for retry.</p>
          <InteractionSequenceEditor actions={values.actions} document={document} busy={busy} onEnableScene={enableScene} onChange={actions => update({ actions })} />
          <label><input type="checkbox" disabled={busy || Boolean(document.scene.reason) || Boolean(document.values.scene)} checked={Boolean(values.scene)} onChange={e => e.target.checked ? enableScene() : update({ scene: undefined })} />Use a walking or coordinate-triggered scene</label>
          {document.scene.reason && <p className="help-text">{document.scene.reason}</p>}
          {values.scene && <>
            <label>Scene trigger<select aria-label="Scene trigger" disabled={busy} value={values.scene.trigger} onChange={e => update({ scene: { ...values.scene!, trigger: e.target.value as "interaction" | "coordinate" } })}><option value="interaction">Interact with this NPC or sign</option><option value="coordinate">Reach map coordinates</option></select></label>
            <div className="interaction-coordinate-fields">{(["X", "Y"] as const).map(axis => <label key={axis}>Player {axis}<input aria-label={`Scene player ${axis}`} type="number" min={0} disabled={busy} value={axis === "X" ? values.scene!.playerX : values.scene!.playerY} onChange={e => update({ scene: { ...values.scene!, [axis === "X" ? "playerX" : "playerY"]: Number(e.target.value) } })} /></label>)}</div>
            <label>Native idle state<select aria-label="Scene idle state" disabled={busy} value={values.scene.idleState} onChange={e => update({ scene: { ...values.scene!, idleState: Number(e.target.value) } })}>{document.scene.idleStates.map(state => <option key={state.id} value={state.id}>{state.id}: {state.label}</option>)}</select></label>
            <strong>Initially hidden actors</strong>
            {document.scene.actors.map(actor => <label key={actor.constant}><input type="checkbox" disabled={busy || Boolean(document.values.scene)} checked={values.scene!.hiddenNpcs.includes(actor.constant)} onChange={e => update({ scene: { ...values.scene!, hiddenNpcs: e.target.checked ? [...values.scene!.hiddenNpcs, actor.constant] : values.scene!.hiddenNpcs.filter(npc => npc !== actor.constant) } })} />{actor.constant.replace(/_/g, " ")} ({actor.x}, {actor.y})</label>)}
            <p className="help-text">Coordinates are movement tiles, as shown in Maps. Show a hidden NPC before walking it. Coordinate scenes can use an event condition and run once per save. Declining requires leaving the trigger tile before retrying. Routes stay within this map.</p>
          </>}
          <label>No room dialogue<textarea aria-label="No room dialogue" rows={3} disabled={busy} value={values.bagFull.join("\n")} onChange={e => update({ bagFull: e.target.value.split("\n") })} /></label>
          {document.choiceReason && <p className="help-text">{document.choiceReason}</p>}
          {document.soundReason && <p className="help-text">{document.soundReason}</p>}
        </> : <>
        <label><input type="checkbox" disabled={busy} checked={Boolean(values.reward)} onChange={event => update({ reward: event.target.checked ? { item: document.items.includes("POTION") ? "POTION" : document.items[0], quantity: 1 } : null, ...(event.target.checked ? { pokemon: null, hideObject: null, bagFull: ["Your BAG is full."] } : {}) })} />Give an item</label>
        {values.reward && <>
          <label>Reward item<SearchableSelect aria-label="Reward item" value={values.reward.item} disabled={busy} onChange={event => update({ reward: { ...values.reward!, item: event.target.value } })}>{document.items.map(value => <option key={value} value={value}>{value.replace(/_/g, " ")}</option>)}</SearchableSelect></label>
          <label>Quantity<input aria-label="Reward quantity" type="number" min={1} max={99} disabled={busy} value={values.reward.quantity} onChange={event => update({ reward: { ...values.reward!, quantity: Number(event.target.value) } })} /></label>
          <label>Bag full dialogue<textarea aria-label="Bag full dialogue" rows={3} disabled={busy} value={values.bagFull.join("\n")} onChange={event => update({ bagFull: event.target.value.split("\n") })} /></label>
        </>}
        <label><input type="checkbox" disabled={busy || Boolean(document.pokemonReason) || !document.pokemon.length} checked={Boolean(values.pokemon)} onChange={event => update({ pokemon: event.target.checked ? { species: document.pokemon.includes("EEVEE") ? "EEVEE" : document.pokemon[0], level: 25 } : null, hideObject: null, ...(event.target.checked ? { reward: null, bagFull: ["Make room in your", "party or PC BOX."] } : {}) })} />Give a Pokémon</label>
        {document.pokemonReason && <p className="help-text">{document.pokemonReason}</p>}
        {values.pokemon && <>
          <label>Gift Pokémon<SearchableSelect aria-label="Gift Pokémon" value={values.pokemon.species} disabled={busy} onChange={event => update({ pokemon: { ...values.pokemon!, species: event.target.value } })}>{document.pokemon.map(value => <option key={value} value={value}>{value.replace(/_/g, " ")}</option>)}</SearchableSelect></label>
          <label>Gift level<input aria-label="Gift level" type="number" min={1} max={100} disabled={busy} value={values.pokemon.level} onChange={event => update({ pokemon: { ...values.pokemon!, level: Number(event.target.value) } })} /></label>
          <p className="help-text">A full party sends the gift to the current PC box. If both are full, it remains unclaimed. The game supplies its usual receipt and naming flow.</p>
          <label>No room dialogue<textarea aria-label="No room dialogue" rows={3} disabled={busy} value={values.bagFull.join("\n")} onChange={event => update({ bagFull: event.target.value.split("\n") })} /></label>
          {document.hideObject && <label><input type="checkbox" disabled={busy || !values.once || Boolean(values.movement)} checked={Boolean(values.hideObject)} onChange={event => update({ hideObject: event.target.checked ? document.hideObject : null })} />Hide the Poké Ball after delivery</label>}
        </>}
        </>}
        {!values.scene && <label><input type="checkbox" disabled={busy || Boolean(values.hideObject) || Boolean(document.movementReason) || document.npcs.length === 0} checked={Boolean(values.movement)} onChange={event => update({ movement: event.target.checked ? { npc: document.npcs[0].constant, steps: ["DOWN"], playerX: document.sign!.x, playerY: document.sign!.y + 1 } : null })} />Have an NPC approach</label>}
        {!values.scene && document.movementReason && <p className="help-text">{document.movementReason}</p>}
        {!values.scene && !document.movementReason && !document.npcs.length && <p className="help-text">Add a stationary NPC near the sign before creating an approach sequence.</p>}
        {values.movement && <>
          <label>NPC<SearchableSelect aria-label="Approaching NPC" value={values.movement.npc} disabled={busy} onChange={event => update({ movement: { ...values.movement!, npc: event.target.value } })}>{document.npcs.map(npc => <option key={npc.constant} value={npc.constant}>{npc.constant.replace(/_/g, " ")} ({npc.x}, {npc.y})</option>)}</SearchableSelect></label>
          <p className="help-text">Choose a nearby stationary NPC. The route must finish beside the player and stay on walkable tiles. Reading from another side shows the original dialogue.</p>
          <div className="interaction-coordinate-fields">
            <label>Player X<input aria-label="Player approach X" type="number" disabled={busy} value={values.movement.playerX} onChange={event => update({ movement: { ...values.movement!, playerX: Number(event.target.value) } })} /></label>
            <label>Player Y<input aria-label="Player approach Y" type="number" disabled={busy} value={values.movement.playerY} onChange={event => update({ movement: { ...values.movement!, playerY: Number(event.target.value) } })} /></label>
          </div>
          <label>Walking route<textarea aria-label="NPC walking route" rows={3} disabled={busy} value={routeText} onChange={event => { setRouteText(event.target.value); update({ movement: { ...values.movement!, steps: event.target.value.toUpperCase().split(/[\s,]+/).filter(Boolean) } }); }} /></label>
          <p className="help-text">Enter UP, DOWN, LEFT, or RIGHT, separated by commas. The NPC walks the reverse route after speaking.</p>
        </>}
        {!values.actions && <label>{values.reward || values.pokemon ? "Dialogue after delivery" : "NPC or interaction dialogue"}<textarea aria-label="Interaction dialogue" rows={3} disabled={busy} value={values.dialogue.join("\n")} onChange={event => update({ dialogue: event.target.value.split("\n") })} /></label>}
        <p className="help-text">Press Enter for another game text row: up to 18 character spaces on the first row and 17 on later rows. Tokens such as &lt;PLAYER&gt; are supported; player and rival names count as up to 7 spaces.</p>
        {values.once && <label>Repeat dialogue<textarea aria-label="Repeat dialogue" rows={3} disabled={busy} value={values.already.join("\n")} onChange={event => update({ already: event.target.value.split("\n") })} /></label>}
        <label><input type="checkbox" disabled={busy || !document.events.length} checked={Boolean(values.condition)} onChange={event => update({ condition: event.target.checked ? { event: document.events[0], set: true } : null })} />Require an event condition</label>
        {values.condition && <>{eventSelect(values.condition.event, event => update({ condition: { ...values.condition!, event } }), "Required event")}
          <label><input type="checkbox" disabled={busy} checked={values.condition.set} onChange={event => update({ condition: { ...values.condition!, set: event.target.checked } })} />Event must be set</label>
          <p className="help-text">When the condition does not match, the original dialogue is shown.</p></>}
        <strong>Event changes after success</strong>
        {values.events.map((entry, i) => <div key={i}>{eventSelect(entry.event, event => update({ events: values.events.map((old, n) => n === i ? { ...old, event } : old) }), `Changed event ${i + 1}`)}
          <label><input type="checkbox" disabled={busy} checked={entry.set} onChange={event => update({ events: values.events.map((old, n) => n === i ? { ...old, set: event.target.checked } : old) })} />Set event (uncheck to clear)</label>
          <button className="small-button" disabled={busy} onClick={() => update({ events: values.events.filter((_, n) => n !== i) })}>Remove event change</button>
        </div>)}
        <button className="small-button" disabled={busy || !document.events.length || values.events.length >= 16} onClick={() => update({ events: [...values.events, { event: document.events[0], set: true }] })}>Add event change</button>
        <div className="text-editor-actions"><button className="small-button" disabled={busy} onClick={close}>Cancel</button><button className="small-button primary-action" disabled={busy} onClick={() => void save("interaction")}>{busy ? "Saving…" : "Save interaction"}</button></div>
      </div>}
    </section></div>}
  </>;
}
