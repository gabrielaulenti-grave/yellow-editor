import { useEffect, useState } from "react";
import { newSequenceDialogueId, newSequenceBattleId, type InteractionAction } from "./core/interactionSequence";
import type { InteractionDocument } from "./core/scriptInteractions";
import { SearchableSelect } from "./editor/SearchableSelect";
import { NPC_EMOTES } from "./core/sceneEmotes";

const titles: Record<InteractionAction["kind"], string> = {
  dialogue: "Show dialogue", choice: "Yes/No choice", "if-event": "Branch on event",
  "if-position": "Branch on player position", "face-npc": "Face NPC", "face-player": "Face player",
  event: "Change event", wait: "Wait", heal: "Heal party", sound: "Play sound",
  "walk-npc": "Walk NPC", "follow-npc": "Walk NPC with player following", visibility: "Show/hide NPC",
  emote: "NPC emote", "if-partner": "Branch on following partner", "partner-move": "Move following partner",
  music: "Change music", fade: "Screen fade", "wild-battle": "Wild Pokémon encounter", "trainer-battle": "Trainer battle",
  item: "Give item", pokemon: "Give Pokémon", end: "End interaction",
};

export function InteractionSequenceEditor({ actions, document, busy, onChange, onEnableScene, depth = 0, path = "Actions", actionPrefix = "Action", diagnosticPath }: {
  actions: InteractionAction[]; document: InteractionDocument; busy: boolean;
  onEnableScene?(): void;
  onChange(actions: InteractionAction[]): void; depth?: number; path?: string; actionPrefix?: string; diagnosticPath?: string;
}) {
  const [kind, setKind] = useState<InteractionAction["kind"]>("dialogue");
  const update = (index: number, action: InteractionAction) => onChange(actions.map((old, i) => i === index ? action : old));
  const options = (title: string, value: string, values: string[], change: (value: string) => void) => <label>{title}
    <SearchableSelect aria-label={`${path} ${title}`} value={value} disabled={busy} onChange={e => change(e.target.value)}>
      {values.map(value => <option key={value} value={value}>{value.replace(/^(EVENT_|SFX_|MUSIC_)/, "").replace(/_/g, " ")}</option>)}
    </SearchableSelect>
  </label>;
  const number = (title: string, value: number, max: number, change: (value: number) => void) => <label>{title}<input aria-label={`${path} ${title}`} type="number" min={1} max={max} value={value} disabled={busy} onChange={e => change(Number(e.target.value))} /></label>;
  const toggle = (title: string, value: boolean, change: (value: boolean) => void) => <label><input type="checkbox" disabled={busy} checked={value} onChange={e => change(e.target.checked)} />{title}</label>;
  const walkingActors = document.scene.actors.filter(actor => actor.canWalk !== false);
  const unavailable = (kind: InteractionAction["kind"]) =>
    (["if-position", "face-npc", "face-player"].includes(kind) && Boolean(document.scene.reason))
    || kind === "if-position" && depth >= 4
    || kind === "face-npc" && !walkingActors.length
    || (["if-partner", "partner-move"].includes(kind) && (Boolean(document.scene.reason) || !document.scene.partner || Boolean(document.scene.partner.reason)))
    || kind === "if-partner" && depth >= 4
    || (["walk-npc", "follow-npc", "visibility", "emote"].includes(kind) && (Boolean(document.scene.reason) || !document.scene.actors.length))
    || ["walk-npc", "follow-npc"].includes(kind) && !walkingActors.length
    || kind === "emote" && (Boolean(document.scene.emoteReason) || !document.scene.emotes.length)
    || ["music", "fade", "wild-battle", "trainer-battle"].includes(kind) && Boolean(document.scene.reason)
    || kind === "music" && Boolean(document.effects.musicReason)
    || kind === "fade" && Boolean(document.effects.fadeReason)
    || kind === "wild-battle" && (Boolean(document.effects.battleReason) || !document.pokemon.length || depth >= 4)
    || kind === "trainer-battle" && (Boolean(document.effects.battleReason) || !document.effects.trainers.length || depth >= 4)
    || kind === "choice" && (Boolean(document.choiceReason) || depth >= 4)
    || kind === "if-event" && (!document.events.length || depth >= 4)
    || kind === "event" && !document.events.length
    || kind === "sound" && (Boolean(document.soundReason) || !document.sounds.length)
    || kind === "item" && !document.items.length
    || kind === "pokemon" && (Boolean(document.pokemonReason) || !document.pokemon.length);
  function add() {
    let action: InteractionAction;
    switch (kind) {
      case "if-position": action = { kind, test: { mode: "tile", x: document.scene.defaultPlayer.x, y: document.scene.defaultPlayer.y }, then: [], otherwise: [] }; onEnableScene?.(); break;
      case "face-npc": action = { kind, npc: walkingActors[0].constant, facing: "PLAYER" }; onEnableScene?.(); break;
      case "face-player": action = { kind, facing: "DOWN" }; onEnableScene?.(); break;
      case "if-partner": action = { kind, following: [], absent: [] }; onEnableScene?.(); break;
      case "partner-move": action = { kind, x: document.scene.defaultPlayer.x + 1, y: document.scene.defaultPlayer.y }; onEnableScene?.(); break;
      case "walk-npc": case "follow-npc": action = { kind, npc: walkingActors[0].constant, steps: ["DOWN"] }; onEnableScene?.(); break;
      case "visibility": action = { kind, npc: document.scene.actors[0].constant, visible: true }; onEnableScene?.(); break;
      case "emote": action = { kind, npc: document.scene.actors[0].constant, bubble: document.scene.emotes[0] }; onEnableScene?.(); break;
      case "music": action = { kind, mode: "play", track: document.effects.music[0].id, persist: false }; onEnableScene?.(); break;
      case "fade": action = { kind, mode: "out" }; onEnableScene?.(); break;
      case "wild-battle": action = { kind, battleId: newSequenceBattleId(), species: document.pokemon.includes("SNORLAX") ? "SNORLAX" : document.pokemon[0], level: 30, cry: true, won: [], caught: [], escaped: [{ kind: "end", complete: false }] }; onEnableScene?.(); break;
      case "trainer-battle": action = { kind, battleId: newSequenceBattleId(), trainer: document.effects.trainers[0].id, won: [] }; onEnableScene?.(); break;
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
        <InteractionSequenceEditor actions={entries} document={document} busy={busy} onEnableScene={onEnableScene} onChange={change} depth={depth + 1} path={`${path} ${i + 1} ${title}`} actionPrefix={`${actionPrefix}${i + 1}${({ Yes: "Yes", "No or B": "No", Then: "Then", Otherwise: "Otherwise", Defeated: "Won", Victory: "Won", Caught: "Caught", Escaped: "Escaped", Following: "Following", Absent: "Absent" } as Record<string, string>)[title]}`} diagnosticPath={diagnosticPath} />
      </fieldset>;
      return <div className={`interaction-sequence-action${diagnosticPath === `${actionPrefix}${i + 1}` ? " interaction-action-problem" : ""}`} key={i} data-scene-action={`${actionPrefix}${i + 1}`} tabIndex={-1}>
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
        {action.kind === "if-partner" && <>
          <p className="help-text">Checks whether Yellow's starter Pikachu is currently visible and following. A boxed, fainted, hidden or temporarily detached partner follows Absent. This does not detect an ordinary Pikachu NPC.</p>
          {branch("Following", action.following, following => update(i, { ...action, following }))}
          {branch("Absent", action.absent, absent => update(i, { ...action, absent }))}
        </>}
        {action.kind === "if-position" && <>
          <label>Position test<select aria-label={`${path} action ${i + 1} position test`} disabled={busy} value={action.test.mode} onChange={e => update(i, { ...action, test: e.target.value === "tile" ? { mode: "tile", x: document.scene.defaultPlayer.x, y: document.scene.defaultPlayer.y } : { mode: "relative", npc: document.scene.actors[0].constant, side: "LEFT" } })}>
            <option value="tile">Player is on an exact tile</option><option value="relative" disabled={!document.scene.actors.length}>Player is on one side of an NPC</option>
          </select></label>
          {action.test.mode === "tile" ? <div className="interaction-coordinate-fields">{(["x", "y"] as const).map(axis => <label key={axis}>Player {axis.toUpperCase()}<input aria-label={`${path} action ${i + 1} position ${axis.toUpperCase()}`} type="number" min={0} value={action.test.mode === "tile" ? action.test[axis] : 0} disabled={busy} onChange={e => action.test.mode === "tile" && update(i, { ...action, test: { ...action.test, [axis]: Number(e.target.value) } })} /></label>)}</div> : <>
            {options("Position reference NPC", action.test.npc, document.scene.actors.map(actor => actor.constant), npc => action.test.mode === "relative" && update(i, { ...action, test: { ...action.test, npc } }))}
            <label>Player is<select aria-label={`${path} action ${i + 1} position side`} disabled={busy} value={action.test.side} onChange={e => action.test.mode === "relative" && update(i, { ...action, test: { ...action.test, side: e.target.value as typeof action.test.side } })}>
              <option value="LEFT">Left of NPC</option><option value="RIGHT">Right of NPC</option><option value="UP">Above NPC</option><option value="DOWN">Below NPC</option>
            </select></label>
          </>}
          <p className="help-text">Checks the player's position at this action, after earlier movement. Side checks compare the chosen axis; diagonal tiles can match. Add every allowed starting tile in scene settings. Each matching route is checked separately and continues with the next shared action.</p>
          {branch("Then", action.then, then => update(i, { ...action, then }))}
          {branch("Otherwise", action.otherwise, otherwise => update(i, { ...action, otherwise }))}
        </>}
        {(action.kind === "face-npc" || action.kind === "face-player") && <>
          {action.kind === "face-npc" && options("Turning NPC", action.npc, walkingActors.map(actor => actor.constant), npc => update(i, { ...action, npc }))}
          <label>Face toward<select aria-label={`${path} action ${i + 1} facing`} disabled={busy} value={action.facing} onChange={e => action.kind === "face-npc" ? update(i, { ...action, facing: e.target.value as typeof action.facing }) : update(i, { ...action, facing: e.target.value as typeof action.facing, ...(e.target.value === "NPC" ? { npc: action.npc ?? document.scene.actors[0].constant } : {}) })}>
            {["UP", "DOWN", "LEFT", "RIGHT"].map(direction => <option key={direction} value={direction}>{direction.toLowerCase()}</option>)}
            <option value={action.kind === "face-npc" ? "PLAYER" : "NPC"} disabled={action.kind === "face-player" && !document.scene.actors.length}>{action.kind === "face-npc" ? "The player" : "An NPC"}</option>
          </select></label>
          {action.kind === "face-player" && action.facing === "NPC" && options("Facing target NPC", action.npc ?? "", document.scene.actors.map(actor => actor.constant), npc => update(i, { ...action, npc }))}
          <p className="help-text">Turn in place without taking a step. For a diagonal target, turn horizontally first. Single-pose sprites cannot turn. Add both facing actions to make two characters look at each other.</p>
        </>}
        {action.kind === "partner-move" && <>
          <div className="interaction-coordinate-fields">{(["x", "y"] as const).map(axis => <label key={axis}>Partner {axis.toUpperCase()}<input aria-label={`${path} action ${i + 1} partner ${axis.toUpperCase()}`} type="number" min={0} value={action[axis]} disabled={busy} onChange={event => update(i, { ...action, [axis]: Number(event.target.value) })} /></label>)}</div>
          <label>Face after moving<select aria-label={`${path} action ${i + 1} partner facing`} disabled={busy} value={action.facing ?? "KEEP"} onChange={event => update(i, { ...action, facing: event.target.value })}>{["KEEP", "UP", "DOWN", "LEFT", "RIGHT"].map(face => <option key={face} value={face}>{face === "KEEP" ? "Keep walking direction" : face.toLowerCase()}</option>)}</select></label>
          <p className="help-text">Walk Pikachu from his current tile to this clear on-screen tile, using up to 16 steps. Place this before an NPC's walking action to clear its path. An absent partner is skipped; a blocked or unreachable route stops the scene without completing it. Pikachu stays parked during the scene and rejoins you when it ends. Battles may reposition the partner; move him again before another NPC route if needed.</p>
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
        {action.kind === "music" && <>
          <label>Music operation<select aria-label={`${path} action ${i + 1} music operation`} disabled={busy} value={action.mode} onChange={e => update(i, { ...action, mode: e.target.value as typeof action.mode })}>
            <option value="play">Play track</option><option value="stop">Stop music</option><option value="restore">Restore map music</option>
          </select></label>
          {action.mode === "play" && options("Music track", action.track, document.effects.music.map(track => track.id), track => update(i, { ...action, track }))}
          {action.mode !== "restore" && toggle("Keep music after normal scene completion", action.persist, persist => update(i, { ...action, persist }))}
          <p className="help-text">Temporary music returns to the map's usual music when the scene ends. Music also returns after a battle; add another music action afterward to change it again.</p>
        </>}
        {action.kind === "fade" && <>
          <label>Screen effect<select aria-label={`${path} action ${i + 1} screen effect`} disabled={busy} value={action.mode} onChange={e => update(i, { ...action, mode: e.target.value as "out" | "in" })}>
            <option value="out">Fade to black</option><option value="in">Fade back in</option>
          </select></label>
          <p className="help-text">To make a character disappear: fade to black, hide the NPC, then fade back in. The screen stays dark between those actions.</p>
        </>}
        {action.kind === "wild-battle" && <>
          {options("Encounter Pokémon", action.species, document.pokemon, species => update(i, { ...action, species }))}
          {number("Encounter level", action.level, 100, level => update(i, { ...action, level }))}
          {toggle("Play Pokémon cry", action.cry, cry => update(i, { ...action, cry }))}
          <p className="help-text">Defeated and caught paths continue with the next action unless ended here. Escape defaults to allowing a retry. Losing follows the game's usual defeat flow. Resolved encounters are remembered until the scene completes, so a retry continues from that result. Add a hide action after a resolved encounter to remove its overworld NPC.</p>
          {branch("Defeated", action.won, won => update(i, { ...action, won }))}
          {branch("Caught", action.caught, caught => update(i, { ...action, caught }))}
          {branch("Escaped", action.escaped, escaped => update(i, { ...action, escaped }))}
        </>}
        {action.kind === "trainer-battle" && <>
          <label>Trainer party<SearchableSelect aria-label={`${path} action ${i + 1} trainer party`} disabled={busy} value={action.trainer} onChange={e => update(i, { ...action, trainer: e.target.value })}>
            {document.effects.trainers.map(trainer => <option key={trainer.id} value={trainer.id}>{trainer.label}</option>)}
          </SearchableSelect></label>
          <p className="help-text">Fight an existing trainer party. Victory continues here; losing follows the game's usual defeat flow. This encounter has its own completion settings.</p>
          {branch("Victory", action.won, won => update(i, { ...action, won }))}
        </>}
        {action.kind === "item" && <>{options("Reward item", action.item, document.items, item => update(i, { ...action, item }))}{number("Reward quantity", action.quantity, 99, quantity => update(i, { ...action, quantity }))}</>}
        {action.kind === "pokemon" && <>{options("Gift Pokémon", action.species, document.pokemon, species => update(i, { ...action, species }))}{number("Gift level", action.level, 100, level => update(i, { ...action, level }))}</>}
        {(action.kind === "walk-npc" || action.kind === "follow-npc" || action.kind === "visibility" || action.kind === "emote") && <>
          {options("Scene NPC", action.npc, document.scene.actors.filter(actor => !["walk-npc", "follow-npc"].includes(action.kind) || actor.canWalk !== false || actor.constant === action.npc).map(actor => actor.constant), npc => update(i, { ...action, npc }))}
          {(["walk-npc", "follow-npc"].includes(action.kind) && document.scene.actors.find(actor => actor.constant === action.npc)?.canWalk === false) && <p role="alert">This actor has a stationary sprite. Choose an animated actor or change its sprite in Edit NPC.</p>}
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
      {document.scene.partner?.reason && <p className="help-text">Following partner unavailable: {document.scene.partner.reason}</p>}
      {kind === "emote" && document.scene.emoteReason && <p className="help-text">{document.scene.emoteReason}</p>}
      {document.effects.musicReason && <p className="help-text">Music unavailable: {document.effects.musicReason}</p>}
      {document.effects.fadeReason && <p className="help-text">Screen fades unavailable: {document.effects.fadeReason}</p>}
      {document.effects.battleReason && <p className="help-text">Battles unavailable: {document.effects.battleReason}</p>}
      {!document.effects.battleReason && !document.effects.trainers.length && <p className="help-text">Trainer battles need readable trainer party tables.</p>}
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
