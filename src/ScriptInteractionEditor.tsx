import { useEffect, useRef, useState } from "react";
import { SearchableSelect } from "./editor/SearchableSelect";
import { SceneReview } from "./SceneReview";
import { maximumSceneStarts, scenePlayerStarts } from "./core/interactionScene";
import { InteractionValidationError, type InteractionCheckReport } from "./core/interactionValidation";
import { InteractionSequenceEditor } from "./InteractionSequenceEditor";
import { PlayerConditionEditor } from "./PlayerConditionEditor";
import { SharedSceneFlags } from "./SharedSceneFlags";
import { newSequenceDialogueId, type InteractionAction } from "./core/interactionSequence";
import { readInteractionDraft, writeInteractionDraft, deleteInteractionDraft, interactionDraftBaseline, type InteractionDraft, type InteractionDraftData } from "./platform/interactionDraftStore";
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
  const currentValues = useRef(values); currentValues.current = values;
  const checkTask = useRef(0);
  const dialogRef = useRef<HTMLElement>(null);
  const [checkReport, setCheckReport] = useState<InteractionCheckReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [diagnosticPath, setDiagnosticPath] = useState<string>();
  const [selectedStart, setSelectedStart] = useState(0);
  useEffect(() => { setCheckReport(null); setDiagnosticPath(undefined); }, [values]);
  const [draftReady, setDraftReady] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<InteractionDraft | null>(null);
  const [draftStatus, setDraftStatus] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftChangedSources, setDraftChangedSources] = useState(false);
  const draftRevision = useRef(0);
  const callback = useRef(onEditStateChange); callback.current = onEditStateChange;
  const dirty = Boolean(document && (JSON.stringify(values) !== JSON.stringify(document.values) || document.reward && (item !== document.reward.item || quantity !== document.reward.quantity || fixBagFull) || document.gift && (species !== document.gift.species || level !== document.gift.level)));
  useEffect(() => { callback.current?.(open, dirty); }, [open, dirty]);
  useEffect(() => () => callback.current?.(false, false), []);
  const draftData = values ? { values, item, quantity, species, level, fixBagFull, routeText } : null;
  useEffect(() => {
    if (!open || !document || !draftData || busy || pendingDraft || !draftReady) return;
    if (!dirty) { void deleteInteractionDraft(document).then(() => setDraftStatus(""), error => setDraftError(`Could not clear the old draft: ${String(error)}`)); return; }
    const revision = ++draftRevision.current;
    setDraftStatus("Keeping draft…");
    void writeInteractionDraft(document, draftData).then(() => {
      if (revision === draftRevision.current) { setDraftStatus("Draft kept on this device"); setDraftError(null); }
    }, error => { if (revision === draftRevision.current) { setDraftStatus(""); setDraftError(`Could not keep draft: ${String(error)}. Your editor is still open. Save the interaction or try closing again.`); } });
  }, [open, document, values, item, quantity, species, level, fixBagFull, routeText, dirty, busy, pendingDraft, draftReady]);
  function applyDraft(data: InteractionDraftData) {
    setValues(structuredClone(data.values)); setItem(data.item); setQuantity(data.quantity); setSpecies(data.species); setLevel(data.level); setFixBagFull(data.fixBagFull); setRouteText(data.routeText);
  }
  async function begin() {
    setSelectedStart(0);
    ++checkTask.current; setChecking(false); setCheckReport(null);
    ++draftRevision.current;
    setOpen(true); setBusy(true); setDraftReady(false); setError(null); setDocument(null); setPendingDraft(null); setDraftStatus(""); setDraftError(null); setDraftChangedSources(false);
    try {
      const next = await invoke<InteractionDocument>("get_script_interaction_document", { path, label });
      const baseline = interactionDraftBaseline(next);
      let draft: InteractionDraft | null = null;
      try { draft = await readInteractionDraft(next); setDraftReady(true); }
      catch (error) { setDraftError(`Draft recovery is unavailable: ${String(error)}`); }
      if (draft && JSON.stringify(draft.data) === JSON.stringify(baseline)) { await deleteInteractionDraft(next).catch(() => undefined); draft = null; }
      setDocument(next); applyDraft(baseline); setPendingDraft(draft);
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }
  async function close() {
    if (busy) return;
    setBusy(true);
    try {
      if (dirty && document && draftData && !pendingDraft) { if (!draftReady) await readInteractionDraft(document); await writeInteractionDraft(document, draftData); }
      ++checkTask.current; setChecking(false); ++draftRevision.current; setOpen(false); setDocument(null);
    } catch (error) { setDraftError(`Could not keep draft: ${String(error)}. Your editor is still open.`); }
    finally { setBusy(false); }
  }
  function resumeDraft() {
    if (!pendingDraft || !document) return;
    setDraftChangedSources(JSON.stringify(pendingDraft.sources) !== JSON.stringify(document.sources));
    applyDraft(pendingDraft.data); setPendingDraft(null); setDraftStatus("Draft recovered");
  }
  async function discardDraft() {
    if (!document || !window.confirm("Discard this unfinished interaction draft and use the saved project version?")) return;
    setBusy(true);
    try { await deleteInteractionDraft(document); ++draftRevision.current; applyDraft(interactionDraftBaseline(document)); setDraftReady(true); setPendingDraft(null); setDraftStatus(""); setDraftError(null); setDraftChangedSources(false); }
    catch (error) { setDraftError(String(error)); }
    finally { setBusy(false); }
  }
  async function checkScene() {
    if (!document || !values) return;
    const task = ++checkTask.current, requested = values;
    setChecking(true);
    try { const report = await invoke<InteractionCheckReport>("check_script_interaction", { document, values }); if (task === checkTask.current && currentValues.current === requested) setCheckReport(report); }
    catch (error) { if (task === checkTask.current && currentValues.current === requested) setCheckReport({ valid: false, issues: [{ message: String(error) }] }); }
    finally { if (task === checkTask.current) setChecking(false); }
  }
  function locateAction(path: string) {
    setDiagnosticPath(path);
    requestAnimationFrame(() => {
      const target = [...(dialogRef.current?.querySelectorAll<HTMLElement>("[data-scene-action]") ?? [])].find(element => element.dataset.sceneAction === path);
      target?.scrollIntoView({ block: "center" }); target?.focus({ preventScroll: true });
    });
  }
  async function save(kind: "reward" | "pokemon" | "interaction") {
    if (!document || !values) return;
    setBusy(true); setError(null);
    try {
      const history = await invoke<HistorySummary>(kind === "reward" ? "save_script_reward" : kind === "pokemon" ? "save_script_pokemon_gift" : "save_script_interaction",
        kind === "reward" ? { document, item, quantity, fixBagFull } : kind === "pokemon" ? { document, species, level } : { document, values });
      await deleteInteractionDraft(document).catch(() => undefined);
      ++checkTask.current; setChecking(false); ++draftRevision.current; setOpen(false); setDocument(null); onSaved?.(history);
      window.dispatchEvent(new CustomEvent("yellow-editor:history-changed", { detail: history }));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); if (e instanceof InteractionValidationError && values.scene) { setError(null); setCheckReport({ valid: false, issues: [e.detail] }); } }
    finally { setBusy(false); }
  }
  const update = (patch: Partial<InteractionValues>) => setValues(current => current ? { ...current, ...patch } : null);
  const enableScene = () => {
    if (!values || !document || values.scene) return;
    update({ scene: { trigger: "interaction", playerX: document.scene.defaultPlayer.x, playerY: document.scene.defaultPlayer.y, idleState: document.scene.idleStates[0]?.id ?? 0, hiddenNpcs: [] }, movement: null });
  };
  function moveStart(index: number, coordinate: { x: number; y: number }) {
    if (!values?.scene) return;
    const scene = { ...values.scene }, old = scenePlayerStarts(scene)[index];
    if (index === 0) { scene.playerX = coordinate.x; scene.playerY = coordinate.y; }
    else scene.additionalStarts = scene.additionalStarts!.map((point, i) => i === index - 1 ? coordinate : point);
    if (scene.automaticStarts) scene.automaticStarts = scene.automaticStarts.map(point => point.x === old.x && point.y === old.y ? coordinate : point);
    update({ scene });
  }
  const eventSelect = (value: string, onChange: (next: string) => void, title: string) => <SearchableSelect aria-label={title} value={value} disabled={busy} onChange={event => onChange(event.target.value)}>
    {[...new Set([...(document?.events ?? []), ...(values?.sharedFlags ?? []).map(flag => flag.event)])].map(event => <option key={event} value={event}>{document?.sharedFlags?.find(flag => flag.event === event)?.label ?? values?.sharedFlags?.find(flag => flag.event === event)?.label ?? event.replace(/^EVENT_/, "").replace(/_/g, " ")}</option>)}
  </SearchableSelect>;
  return <>
    <button type="button" className="small-button" disabled={disabled} onClick={() => void begin()}>Edit interaction</button>
    {open && <div className="text-editor-backdrop" role="presentation"><section ref={dialogRef} className="text-editor-dialog" role="dialog" aria-modal="true" aria-label="Edit interaction">
      <div className="text-editor-dialog-heading"><h3>Edit interaction</h3><button className="small-button" disabled={busy} onClick={() => void close()}>Close</button></div>
      {busy && !document && <p>Loading interaction…</p>}
      {pendingDraft && <div className="interaction-draft-notice" role="status">
        <p>An unfinished draft was kept {new Date(pendingDraft.updatedAt).toLocaleString()}.</p>
        <button className="small-button primary-action" disabled={busy} onClick={resumeDraft}>Resume draft</button>{" "}
        <button className="small-button" disabled={busy} onClick={() => void discardDraft()}>Use saved interaction</button>
      </div>}
      {document && !pendingDraft && <div className="interaction-draft-notice">
        <p className="help-text">Changes are kept as a draft on this device. Close to fix an NPC or map, then reopen this interaction to resume. Use Save to apply changes to the project.</p>
        {draftStatus && <p role="status">{draftStatus}</p>}
        {(dirty || draftStatus || draftError) && <button className="small-button" disabled={busy} onClick={() => void discardDraft()}>Discard draft</button>}
      </div>}
      {draftChangedSources && <p role="status" className="help-text">The project changed while this draft was closed. Review the scene against the current map; saving rechecks its actors, routes and source.</p>}
      {draftError && <p role="alert" className="text-editor-error">{draftError}</p>}
      {error && <p className="text-editor-error" role="alert">{error}</p>}
      {document?.reward && <div className="interaction-fields" inert={Boolean(pendingDraft)}>
        <p>Edit this interaction's item reward. Use <strong>Edit text</strong> to choose and edit its dialogue paths.</p>
        <label>Reward item<SearchableSelect aria-label="Reward item" value={item} disabled={busy} onChange={event => setItem(event.target.value)}>{document.items.map(value => <option key={value} value={value}>{value.replace(/_/g, " ")}</option>)}</SearchableSelect></label>
        <label>Quantity<input aria-label="Reward quantity" type="number" min={1} max={99} disabled={busy} value={quantity} onChange={event => setQuantity(Number(event.target.value))} /></label>
        {document.reward.earlyFlag && <label><input type="checkbox" disabled={busy} checked={fixBagFull} onChange={event => setFixBagFull(event.target.checked)} />Allow another attempt when the bag is full</label>}
        {document.reward.earlyFlag && <p className="help-text">The existing script marks this gift claimed before checking bag space. Selecting this option moves that flag update after successful delivery.</p>}
        <button className="small-button primary-action" disabled={busy || !dirty} onClick={() => void save("reward")}>{busy ? "Saving…" : "Save reward"}</button>
      </div>}
      {document?.gift && <div className="interaction-fields" inert={Boolean(pendingDraft)}>
        <p>Edit this existing Pokémon gift. Use <strong>Edit text</strong> to change any available associated dialogue.</p>
        <label>Gift Pokémon<SearchableSelect aria-label="Gift Pokémon" value={species} disabled={busy} onChange={event => setSpecies(event.target.value)}>{document.pokemon.map(value => <option key={value} value={value}>{value.replace(/_/g, " ")}</option>)}</SearchableSelect></label>
        <label>Gift level<input aria-label="Gift level" type="number" min={1} max={100} disabled={busy} value={level} onChange={event => setLevel(Number(event.target.value))} /></label>
        <p className="help-text">A full party sends the Pokémon to the current PC box. If both are full, the player can try again. Existing completion flags{document.gift.hidesObject ? " and Poké Ball removal" : ""} are preserved.</p>
        <button className="small-button primary-action" disabled={busy || !dirty} onClick={() => void save("pokemon")}>{busy ? "Saving…" : "Save Pokémon gift"}</button>
      </div>}
      {document && !document.canCreate && !document.reward && !document.gift && <p>{document.reason}</p>}
      {document?.canCreate && values && <div className="interaction-fields" inert={Boolean(pendingDraft)}>
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
          <p>Actions run in order. Yes/No and event branches can rejoin the next action or end early. Use one reward per path; failed delivery shows the no-room dialogue and leaves the interaction available for retry. Scenes remember a successful gift if later movement is interrupted, so retrying skips that gift.</p>
          <SharedSceneFlags flags={[...new Map([...(document.sharedFlags ?? []), ...(values.sharedFlags ?? [])].map(flag => [flag.event, flag])).values()]} busy={busy} onCreate={flag => update({ sharedFlags: [...(values.sharedFlags ?? []), flag] })} />
          <InteractionSequenceEditor actions={values.actions} document={{ ...document, sharedFlags: [...new Map([...(document.sharedFlags ?? []), ...(values.sharedFlags ?? [])].map(flag => [flag.event, flag])).values()], events: [...new Set([...document.events, ...(values.sharedFlags ?? []).map(flag => flag.event)])] }} busy={busy} onEnableScene={enableScene} diagnosticPath={diagnosticPath} onChange={actions => update({ actions })} />
          <label><input type="checkbox" disabled={busy || Boolean(document.scene.reason) || Boolean(document.values.scene)} checked={Boolean(values.scene)} onChange={e => e.target.checked ? enableScene() : update({ scene: undefined })} />Use a scene for movement, effects, battles or coordinate triggers</label>
          {document.scene.reason && <p className="help-text">{document.scene.reason}</p>}
          {values.scene && <>
            <SceneReview document={document} values={values} selectedStart={Math.min(selectedStart, values.scene.additionalStarts?.length ?? 0)} report={checkReport} checking={checking || busy} onCheck={() => void checkScene()} onLocate={locateAction} onPlayerStart={(x, y) => {
              if (busy) return;
              const index = Math.min(selectedStart, values.scene!.additionalStarts?.length ?? 0);
              moveStart(index, { x, y });
            }} />
            <label>Scene trigger<select aria-label="Scene trigger" disabled={busy} value={values.scene.trigger} onChange={e => {
              const scene = { ...values.scene!, trigger: e.target.value as "interaction" | "coordinate" };
              if (scene.trigger === "coordinate") { delete scene.automaticStarts; delete scene.automaticCondition; }
              update({ scene });
            }}><option value="interaction">Interact with this NPC or sign</option><option value="coordinate">Reach map coordinates</option></select></label>
            {scenePlayerStarts(values.scene).map((point, index) => <div key={index} role="group" aria-label={`Player start ${index + 1}`}>
              <strong>Player start {index + 1}</strong>
              <div className="interaction-coordinate-fields">{(["X", "Y"] as const).map(axis => <label key={axis}>Player {axis}<input aria-label={index === 0 ? `Scene player ${axis}` : `Scene start ${index + 1} player ${axis}`} type="number" min={0} disabled={busy} value={point[axis === "X" ? "x" : "y"]} onChange={e => {
                const coordinate = { ...point, [axis === "X" ? "x" : "y"]: Number(e.target.value) };
                moveStart(index, coordinate);
              }} /></label>)}</div>
              <button type="button" className="small-button" disabled={busy} aria-pressed={Math.min(selectedStart, values.scene!.additionalStarts?.length ?? 0) === index} onClick={() => setSelectedStart(index)}>Edit start {index + 1} on map</button>
              {values.scene!.trigger === "interaction" && <label><input type="checkbox" aria-label={`Start automatically at player start ${index + 1}`} disabled={busy} checked={Boolean(values.scene!.automaticStarts?.some(start => start.x === point.x && start.y === point.y))} onChange={e => {
                const scene = { ...values.scene! }, automaticStarts = e.target.checked ? [...(scene.automaticStarts ?? []), point] : (scene.automaticStarts ?? []).filter(start => start.x !== point.x || start.y !== point.y);
                if (automaticStarts.length) scene.automaticStarts = automaticStarts;
                else { delete scene.automaticStarts; delete scene.automaticCondition; }
                update({ scene });
              }} />Also start automatically here</label>}
              {index > 0 && <button type="button" className="small-button" disabled={busy} onClick={() => {
                const additionalStarts = values.scene!.additionalStarts!.filter((_, i) => i !== index - 1);
                const scene = { ...values.scene! }; if (additionalStarts.length) scene.additionalStarts = additionalStarts; else delete scene.additionalStarts;
                if (scene.automaticStarts) { scene.automaticStarts = scene.automaticStarts.filter(start => start.x !== point.x || start.y !== point.y); if (!scene.automaticStarts.length) { delete scene.automaticStarts; delete scene.automaticCondition; } }
                setSelectedStart(0); update({ scene });
              }}>Remove start {index + 1}</button>}
            </div>)}
            <button type="button" className="small-button" disabled={busy || scenePlayerStarts(values.scene).length >= maximumSceneStarts} onClick={() => {
              const starts = scenePlayerStarts(values.scene!);
              let x = values.scene!.playerX + 1; while (starts.some(point => point.x === x && point.y === values.scene!.playerY)) x++;
              setSelectedStart(starts.length); update({ scene: { ...values.scene!, additionalStarts: [...(values.scene!.additionalStarts ?? []), { x, y: values.scene!.playerY }] } });
            }}>Add player start</button>
            <p className="help-text">The same scene can start from any listed tile (up to {maximumSceneStarts}). For interaction triggers, choose tiles from which the player can address this NPC or sign. Check scene validates every start. Completion and gifts are shared across all starts.</p>
            {values.scene.automaticStarts && <>
              <label><input type="checkbox" disabled={busy} checked={Boolean(values.scene.automaticCondition)} onChange={e => {
                const scene = { ...values.scene! };
                if (e.target.checked) scene.automaticCondition = { event: values.sharedFlags?.[0]?.event ?? document.sharedFlags?.[0]?.event ?? document.events[0], set: false };
                else delete scene.automaticCondition;
                update({ scene });
              }} />Require a condition for the automatic trigger</label>
              {values.scene.automaticCondition && <PlayerConditionEditor label="Automatic trigger condition" eventLabel="Automatic trigger event" setLabel="Automatic trigger event must be set (uncheck for clear)" busy={busy} value={values.scene.automaticCondition} domains={{ ...document, sharedFlags: [...(document.sharedFlags ?? []), ...(values.sharedFlags ?? [])], events: [...new Set([...document.events, ...(values.sharedFlags ?? []).map(flag => flag.event)])] }} onChange={automaticCondition => update({ scene: { ...values.scene!, automaticCondition } })} />}
              <p className="help-text">The NPC can still be addressed manually from every listed start. Use a separate automatic condition to stop an automatic challenge after a battle while keeping later conversations available. Automatic triggers rearm after leaving their tiles.</p>
            </>}
            <label>Native idle state<select aria-label="Scene idle state" disabled={busy} value={values.scene.idleState} onChange={e => update({ scene: { ...values.scene!, idleState: Number(e.target.value) } })}>{document.scene.idleStates.map(state => <option key={state.id} value={state.id}>{state.id}: {state.label}</option>)}</select></label>
            <strong>Initially hidden actors</strong>
            {document.scene.actors.map(actor => <label key={actor.constant}><input type="checkbox" disabled={busy || Boolean(document.values.scene)} checked={values.scene!.hiddenNpcs.includes(actor.constant)} onChange={e => update({ scene: { ...values.scene!, hiddenNpcs: e.target.checked ? [...values.scene!.hiddenNpcs, actor.constant] : values.scene!.hiddenNpcs.filter(npc => npc !== actor.constant) } })} />{actor.constant.replace(/_/g, " ")} ({actor.x}, {actor.y})</label>)}
            <p className="help-text">Coordinates are movement tiles, as shown in Maps. A coordinate trigger can use the arrival warp to start when the player enters. Show a hidden NPC before walking or emoting. Coordinate scenes can use an event condition and run once per save. Declining requires leaving all trigger tiles or re-entering the map before retrying. Routes stay within this map.</p>
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
        <label><input type="checkbox" disabled={busy} checked={Boolean(values.condition)} onChange={event => update({ condition: event.target.checked ? { event: document.events[0], set: true } : null })} />Require a condition</label>
        {values.condition && <><PlayerConditionEditor label="Interaction condition" eventLabel="Required event" busy={busy} value={values.condition} domains={{ ...document, sharedFlags: [...(document.sharedFlags ?? []), ...(values.sharedFlags ?? [])], events: [...new Set([...document.events, ...(values.sharedFlags ?? []).map(flag => flag.event)])] }} onChange={condition => update({ condition })} /><p className="help-text">When the condition does not match, the original dialogue is shown.</p></>}
        {document.visibilityNpc && <><label><input type="checkbox" disabled={busy} checked={Boolean(values.visibleWhen)} onChange={e => update({ visibleWhen: e.target.checked ? { kind: "not", condition: { kind: "hall-of-fame" } } : null, ...(e.target.checked && !document.managed && !values.actions && !values.reward && !values.pokemon && !values.movement && JSON.stringify(values.dialogue) === JSON.stringify(["Here you go!"]) ? { actions: [], once: false, showOriginal: true } : {}) })} />Show this NPC only when a condition matches</label>
          {values.visibleWhen && <><PlayerConditionEditor label="NPC visibility condition" busy={busy} value={values.visibleWhen} domains={{ ...document, sharedFlags: [...(document.sharedFlags ?? []), ...(values.sharedFlags ?? [])], events: [...new Set([...document.events, ...(values.sharedFlags ?? []).map(flag => flag.event)])] }} onChange={visibleWhen => update({ visibleWhen })} /><p className="help-text">Applies automatically when map sprites load or refresh, including after loading a saved game. “Not → Hall of Fame completed” keeps a blocker visible until the player becomes Champion. Native and scene rules can still hide an eligible NPC.</p></>}
        </>}
        <strong>Event changes after success</strong>
        {values.events.map((entry, i) => <div key={i}>{eventSelect(entry.event, event => update({ events: values.events.map((old, n) => n === i ? { ...old, event } : old) }), `Changed event ${i + 1}`)}
          <label><input type="checkbox" disabled={busy} checked={entry.set} onChange={event => update({ events: values.events.map((old, n) => n === i ? { ...old, set: event.target.checked } : old) })} />Set event (uncheck to clear)</label>
          <button className="small-button" disabled={busy} onClick={() => update({ events: values.events.filter((_, n) => n !== i) })}>Remove event change</button>
        </div>)}
        <button className="small-button" disabled={busy || !document.events.length || values.events.length >= 16} onClick={() => update({ events: [...values.events, { event: document.events[0], set: true }] })}>Add event change</button>
        <div className="text-editor-actions"><button className="small-button" disabled={busy} onClick={() => void close()}>Close and keep draft</button><button className="small-button primary-action" disabled={busy} onClick={() => void save("interaction")}>{busy ? "Saving…" : "Save interaction"}</button></div>
      </div>}
    </section></div>}
  </>;
}
