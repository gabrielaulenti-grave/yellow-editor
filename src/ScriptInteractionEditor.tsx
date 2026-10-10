import { useEffect, useRef, useState } from "react";
import { SearchableSelect } from "./editor/SearchableSelect";
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
  const [routeText, setRouteText] = useState("");
  const [fixBagFull, setFixBagFull] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const callback = useRef(onEditStateChange); callback.current = onEditStateChange;
  const dirty = Boolean(document && (JSON.stringify(values) !== JSON.stringify(document.values) || document.reward && (item !== document.reward.item || quantity !== document.reward.quantity || fixBagFull)));
  useEffect(() => { callback.current?.(open, dirty); }, [open, dirty]);
  useEffect(() => () => callback.current?.(false, false), []);
  async function begin() {
    setOpen(true); setBusy(true); setError(null); setDocument(null);
    try {
      const next = await invoke<InteractionDocument>("get_script_interaction_document", { path, label });
      setDocument(next); setValues(structuredClone(next.values)); setItem(next.reward?.item ?? ""); setQuantity(next.reward?.quantity ?? 1); setFixBagFull(false); setRouteText(next.values.movement?.steps.join(", ") ?? "DOWN");
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }
  function close() { if (dirty && !window.confirm("Discard the unsaved interaction changes?")) return; setOpen(false); setDocument(null); }
  async function save(reward: boolean) {
    if (!document || !values) return;
    setBusy(true); setError(null);
    try {
      const history = await invoke<HistorySummary>(reward ? "save_script_reward" : "save_script_interaction", reward
        ? { document, item, quantity, fixBagFull } : { document, values });
      setOpen(false); setDocument(null); onSaved?.(history);
      window.dispatchEvent(new CustomEvent("yellow-editor:history-changed", { detail: history }));
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }
  const update = (patch: Partial<InteractionValues>) => setValues(current => current ? { ...current, ...patch } : null);
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
        <button className="small-button primary-action" disabled={busy || !dirty} onClick={() => void save(true)}>{busy ? "Saving…" : "Save reward"}</button>
      </div>}
      {document && !document.canCreate && !document.reward && <p>{document.reason}</p>}
      {document?.canCreate && values && <div className="interaction-fields">
        <p>Choose what happens when the player interacts. Item rewards handle full bags; approach sequences return the NPC to its starting tile.</p>
        <label><input type="checkbox" disabled={busy} checked={values.showOriginal} onChange={event => update({ showOriginal: event.target.checked })} />Show the original dialogue first</label>
        <label><input type="checkbox" disabled={busy} checked={values.once} onChange={event => update({ once: event.target.checked })} />Run once per save file</label>
        <label><input type="checkbox" disabled={busy} checked={Boolean(values.reward)} onChange={event => update({ reward: event.target.checked ? { item: document.items.includes("POTION") ? "POTION" : document.items[0], quantity: 1 } : null })} />Give an item</label>
        {values.reward && <>
          <label>Reward item<SearchableSelect aria-label="Reward item" value={values.reward.item} disabled={busy} onChange={event => update({ reward: { ...values.reward!, item: event.target.value } })}>{document.items.map(value => <option key={value} value={value}>{value.replace(/_/g, " ")}</option>)}</SearchableSelect></label>
          <label>Quantity<input aria-label="Reward quantity" type="number" min={1} max={99} disabled={busy} value={values.reward.quantity} onChange={event => update({ reward: { ...values.reward!, quantity: Number(event.target.value) } })} /></label>
          <label>Bag full dialogue<textarea aria-label="Bag full dialogue" rows={3} disabled={busy} value={values.bagFull.join("\n")} onChange={event => update({ bagFull: event.target.value.split("\n") })} /></label>
        </>}
        <label><input type="checkbox" disabled={busy || Boolean(document.movementReason) || document.npcs.length === 0} checked={Boolean(values.movement)} onChange={event => update({ movement: event.target.checked ? { npc: document.npcs[0].constant, steps: ["DOWN"], playerX: document.sign!.x, playerY: document.sign!.y + 1 } : null })} />Have an NPC approach</label>
        {document.movementReason && <p className="help-text">{document.movementReason}</p>}
        {!document.movementReason && !document.npcs.length && <p className="help-text">Add a stationary NPC near the sign before creating an approach sequence.</p>}
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
        <label>{values.reward ? "Reward received dialogue" : "NPC or interaction dialogue"}<textarea aria-label="Interaction dialogue" rows={3} disabled={busy} value={values.dialogue.join("\n")} onChange={event => update({ dialogue: event.target.value.split("\n") })} /></label>
        <p className="help-text">Use one game text row per line: up to 18 spaces on the first row and 17 on later rows.</p>
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
        <div className="text-editor-actions"><button className="small-button" disabled={busy} onClick={close}>Cancel</button><button className="small-button primary-action" disabled={busy} onClick={() => void save(false)}>{busy ? "Saving…" : "Save interaction"}</button></div>
      </div>}
    </section></div>}
  </>;
}
