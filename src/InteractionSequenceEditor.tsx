import { useEffect, useState } from "react";
import { newSequenceDialogueId, type InteractionAction } from "./core/interactionSequence";
import type { InteractionDocument } from "./core/scriptInteractions";
import { SearchableSelect } from "./editor/SearchableSelect";
import { NPC_EMOTES } from "./core/sceneEmotes";

const titles: Record<InteractionAction["kind"], string> = {
  dialogue: "Show dialogue", choice: "Yes/No choice", "if-event": "Branch on event",
  event: "Change event", wait: "Wait", heal: "Heal party", sound: "Play sound",
  "walk-npc": "Walk NPC", "follow-npc": "Walk NPC with player following", visibility: "Show/hide NPC",
  emote: "NPC emote",
  item: "Give item", pokemon: "Give Pokémon", end: "End interaction",
};

export function InteractionSequenceEditor({ actions, document, busy, onChange, onEnableScene, depth = 0, path = "Actions" }: {
  actions: InteractionAction[]; document: InteractionDocument; busy: boolean;
  onEnableScene?(): void;
  onChange(actions: InteractionAction[]): void; depth?: number; path?: string;
}) {
  const [kind, setKind] = useState<InteractionAction["kind"]>("dialogue");
  const update = (index: number, action: InteractionAction) => onChange(actions.map((old, i) => i === index ? action : old));
  const options = (title: string, value: string, values: string[], change: (value: string) => void) => <label>{title}
    <SearchableSelect aria-label={`${path} ${title}`} value={value} disabled={busy} onChange={e => change(e.target.value)}>
      {values.map(value => <option key={value} value={value}>{value.replace(/^(EVENT_|SFX_)/, "").replace(/_/g, " ")}</option>)}
    </SearchableSelect>
  </label>;
  const number = (title: string, value: number, max: number, change: (value: number) => void) => <label>{title}<input aria-label={`${path} ${title}`} type="number" min={1} max={max} value={value} disabled={busy} onChange={e => change(Number(e.target.value))} /></label>;
  const toggle = (title: string, value: boolean, change: (value: boolean) => void) => <label><input type="checkbox" disabled={busy} checked={value} onChange={e => change(e.target.checked)} />{title}</label>;
  const unavailable = (kind: InteractionAction["kind"]) =>
    (["walk-npc", "follow-npc", "visibility", "emote"].includes(kind) && (Boolean(document.scene.reason) || !document.scene.actors.length))
    || kind === "emote" && (Boolean(document.scene.emoteReason) || !document.scene.emotes.length)
    || kind === "choice" && (Boolean(document.choiceReason) || depth >= 4)
    || kind === "if-event" && (!document.events.length || depth >= 4)
    || kind === "event" && !document.events.length
    || kind === "sound" && (Boolean(document.soundReason) || !document.sounds.length)
    || kind === "item" && !document.items.length
    || kind === "pokemon" && (Boolean(document.pokemonReason) || !document.pokemon.length);
  function add() {
    let action: InteractionAction;
    switch (kind) {
      case "walk-npc": case "follow-npc": action = { kind, npc: document.scene.actors[0].constant, steps: ["DOWN"] }; onEnableScene?.(); break;
      case "visibility": action = { kind, npc: document.scene.actors[0].constant, visible: true }; onEnableScene?.(); break;
      case "emote": action = { kind, npc: document.scene.actors[0].constant, bubble: document.scene.emotes[0] }; onEnableScene?.(); break;
      case "dialogue": action = { kind, lines: ["Hello!"], textId: newSequenceDialogueId() }; break;
      case "choice": action = { kind, yes: [], no: [{ kind: "end", complete: false }] }; break;
      case "if-event": action = { kind, event: document.events[0], set: true, then: [], otherwise: [] }; break;
      case "event": action = { kind, event: document.events[0], set: true }; break;
      case "wait": action = { kind, frames: 30 }; break;
      case "heal": action = { kind }; break;
      case "sound": action = { kind, sound: document.sounds.includes("SFX_GET_ITEM_1") ? "SFX_GET_ITEM_1" : document.sounds[0], wait: true }; break;
      case "item": action = { kind, item: document.items.includes("POTION") ? "POTION" : document.items[0], quantity: 1 }; break;
      case "pokemon": action = { kind, species: document.pokemon.includes("EEVEE") ? "EEVEE" : document.pokemon[0], level: 5 }; break;
      case "end": action = { kind, complete: false }; break;
    }
    onChange([...actions, action]);
  }
  return <div className="interaction-sequence" role="group" aria-label={path}>
    {actions.map((action, i) => {
      const branch = (title: string, entries: InteractionAction[], change: (entries: InteractionAction[]) => void) => <fieldset className="interaction-sequence-branch"><legend>{title}</legend>
        <InteractionSequenceEditor actions={entries} document={document} busy={busy} onEnableScene={onEnableScene} onChange={change} depth={depth + 1} path={`${path} ${i + 1} ${title}`} />
      </fieldset>;
      return <div className="interaction-sequence-action" key={i}>
        <strong>{i + 1}. {titles[action.kind]}</strong>
        <div className="interaction-sequence-controls">
          <button type="button" className="small-button" aria-label={`${path} move action ${i + 1} up`} disabled={busy || i === 0} onClick={() => { const next = [...actions]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; onChange(next); }}>Up</button>
          <button type="button" className="small-button" aria-label={`${path} move action ${i + 1} down`} disabled={busy || i === actions.length - 1} onClick={() => { const next = [...actions]; [next[i + 1], next[i]] = [next[i], next[i + 1]]; onChange(next); }}>Down</button>
          <button type="button" className="small-button" aria-label={`${path} remove action ${i + 1}`} disabled={busy} onClick={() => onChange(actions.filter((_, n) => n !== i))}>Remove</button>
        </div>
        {action.kind === "dialogue" && <><label>Dialogue<textarea aria-label={`${path} action ${i + 1} dialogue`} rows={3} disabled={busy} value={action.lines.join("\n")} onChange={e => update(i, { ...action, lines: e.target.value.split("\n") })} /></label>
          <p className="help-text">The player presses A or B to advance. A following Yes/No choice takes over directly.</p></>}
        {action.kind === "choice" && <>
          <p className="help-text">Show the question in a dialogue action before this choice. B follows No. Branches continue with the next action unless they end the interaction.</p>
          {branch("Yes", action.yes, yes => update(i, { ...action, yes }))}
          {branch("No or B", action.no, no => update(i, { ...action, no }))}
        </>}
        {action.kind === "if-event" && <>
          {options("Event condition", action.event, document.events, event => update(i, { ...action, event }))}
          {toggle("Event must be set", action.set, set => update(i, { ...action, set }))}
          {branch("Then", action.then, then => update(i, { ...action, then }))}
          {branch("Otherwise", action.otherwise, otherwise => update(i, { ...action, otherwise }))}
        </>}
        {action.kind === "event" && <>{options("Changed event", action.event, document.events, event => update(i, { ...action, event }))}{toggle("Set event (uncheck to clear)", action.set, set => update(i, { ...action, set }))}</>}
        {action.kind === "wait" && number("Wait frames", action.frames, 255, frames => update(i, { ...action, frames }))}
        {action.kind === "sound" && <>{options("Sound effect", action.sound, document.sounds, sound => update(i, { ...action, sound }))}{toggle("Wait for effect channels", action.wait, wait => update(i, { ...action, wait }))}<p className="help-text">Playback uses the game's current audio bank. The wait covers effect channels 5, 6 and 8; the low-health alarm can bypass it.</p></>}
        {action.kind === "item" && <>{options("Reward item", action.item, document.items, item => update(i, { ...action, item }))}{number("Reward quantity", action.quantity, 99, quantity => update(i, { ...action, quantity }))}</>}
        {action.kind === "pokemon" && <>{options("Gift Pokémon", action.species, document.pokemon, species => update(i, { ...action, species }))}{number("Gift level", action.level, 100, level => update(i, { ...action, level }))}</>}
        {(action.kind === "walk-npc" || action.kind === "follow-npc" || action.kind === "visibility" || action.kind === "emote") && <>
          {options("Scene NPC", action.npc, document.scene.actors.map(actor => actor.constant), npc => update(i, { ...action, npc }))}
          {action.kind === "emote" ? <>
            <label>Emotion bubble<select aria-label={`${path} action ${i + 1} emotion bubble`} disabled={busy} value={action.bubble} onChange={e => update(i, { ...action, bubble: e.target.value })}>
              {document.scene.emotes.map(bubble => <option key={bubble} value={bubble}>{NPC_EMOTES[bubble]}</option>)}
            </select></label>
            <p className="help-text">Show a reaction above a visible NPC for about one second, then continue. Use Play sound separately to add a cue.</p>
            {document.scene.emoteReason && <p className="help-text">{document.scene.emoteReason}</p>}
          </> : action.kind === "visibility" ? toggle("Visible (uncheck to hide)", action.visible, visible => update(i, { ...action, visible })) : <>
            <SceneRouteInput label={`${path} action ${i + 1} route`} steps={action.steps} busy={busy} onChange={steps => update(i, { ...action, steps })} />
            <p className="help-text">UP, DOWN, LEFT or RIGHT; up to 32 steps. {action.kind === "follow-npc" ? "The player starts beside the NPC and follows into each vacated tile. Following routes cannot enter warps." : "The NPC can walk onto a door or warp tile without changing maps. Add Show/hide NPC afterward to make the character leave. Otherwise the NPC stays at its destination until moved again or the map reloads."}</p>
          </>}
        </>}
        {action.kind === "end" && <>{toggle("Mark interaction complete", action.complete, complete => update(i, { ...action, complete }))}<p className="help-text">An incomplete end allows a later retry. A complete end applies the success events and the one-time flag. Scenes restore player controls; an incomplete scene restores its starting visibility.</p></>}
      </div>;
    })}
    {!actions.length && <p className="help-text">This branch continues with the following action.</p>}
    <div className="interaction-sequence-add">
      {kind === "emote" && document.scene.emoteReason && <p className="help-text">{document.scene.emoteReason}</p>}
      <label>Action type<select aria-label={`${path} action type`} value={kind} disabled={busy} onChange={e => setKind(e.target.value as InteractionAction["kind"])}>
        {Object.entries(titles).map(([kind, title]) => <option key={kind} value={kind} disabled={Boolean(unavailable(kind as InteractionAction["kind"]))}>{title}</option>)}
      </select></label>
      <button type="button" className="small-button" aria-label={`${path} add action`} disabled={busy || actions.length >= 64 || Boolean(unavailable(kind))} onClick={add}>Add action</button>
    </div>
  </div>;
}

function SceneRouteInput({ label, steps, busy, onChange }: { label: string; steps: string[]; busy: boolean; onChange(steps: string[]): void }) {
  const [raw, setRaw] = useState(steps.join(", "));
  const parse = (value: string) => value.toUpperCase().split(/[\s,]+/).filter(Boolean);
  useEffect(() => { if (JSON.stringify(parse(raw)) !== JSON.stringify(steps)) setRaw(steps.join(", ")); }, [steps, raw]);
  return <label>Route<textarea aria-label={label} rows={2} disabled={busy} value={raw} onChange={e => { setRaw(e.target.value); onChange(parse(e.target.value)); }} /></label>;
}
