// Structured interaction actions. Branches rejoin the following action unless
// they explicitly end the interaction. Movement remains in yielding map states.
import { actionValidationError } from "./interactionValidation";
import type { SceneEffectsDomain } from "./sceneEffects";
export type PlayerPositionTest = { mode: "tile"; x: number; y: number } | { mode: "relative"; npc: string; side: "LEFT" | "RIGHT" | "UP" | "DOWN" };
export type FacingDirection = "UP" | "DOWN" | "LEFT" | "RIGHT";
export type InteractionAction =
  | { kind: "dialogue"; lines: string[]; textId?: string }
  | { kind: "choice"; yes: InteractionAction[]; no: InteractionAction[] }
  | { kind: "if-event"; event: string; set: boolean; then: InteractionAction[]; otherwise: InteractionAction[] }
  | { kind: "if-partner"; following: InteractionAction[]; absent: InteractionAction[] }
  | { kind: "if-position"; test: PlayerPositionTest; then: InteractionAction[]; otherwise: InteractionAction[] }
  | { kind: "face-npc"; npc: string; facing: FacingDirection | "PLAYER" }
  | { kind: "face-player"; facing: FacingDirection | "NPC"; npc?: string }
  | { kind: "partner-move"; x: number; y: number; facing?: string }
  | { kind: "event"; event: string; set: boolean }
  | { kind: "wait"; frames: number }
  | { kind: "heal" }
  | { kind: "sound"; sound: string; wait: boolean }
  | { kind: "item"; item: string; quantity: number; claim?: { group: string; option: string } }
  | { kind: "pokemon"; species: string; level: number }
  | { kind: "walk-npc" | "follow-npc"; npc: string; steps: string[] }
  | { kind: "visibility"; npc: string; visible: boolean }
  | { kind: "emote"; npc: string; bubble: string }
  | { kind: "music"; mode: "play" | "stop" | "restore"; track: string; persist: boolean }
  | { kind: "fade"; mode: "out" | "in" }
  | { kind: "wild-battle"; species: string; level: number; cry: boolean; battleId?: string; won: InteractionAction[]; caught: InteractionAction[]; escaped: InteractionAction[] }
  | { kind: "trainer-battle"; trainer: string; battleId?: string; won: InteractionAction[] }
  | { kind: "end"; complete: boolean };

export interface InteractionSequenceDomains {
  sharedFlags?: Array<{ event: string; label: string }>;
  items: string[]; pokemon: string[]; events: string[]; sounds: string[];
  pokemonReason: string | null; choiceReason: string | null; soundReason: string | null;
  scene?: { reason: string | null; actors: Array<{ constant: string; canWalk?: boolean }>; emotes?: string[]; emoteReason?: string | null; partner?: { reason: string | null } };
  effects?: SceneEffectsDomain;
}

export function interactionBranches(action: InteractionAction): Array<readonly [InteractionAction[], string]> {
  if (action.kind === "choice") return [[action.yes, "Yes"], [action.no, "No"]];
  if (action.kind === "if-partner") return [[action.following, "Following"], [action.absent, "Absent"]];
  if (action.kind === "if-event" || action.kind === "if-position") return [[action.then, "Then"], [action.otherwise, "Otherwise"]];
  if (action.kind === "wild-battle") return [[action.won, "Won"], [action.caught, "Caught"], [action.escaped, "Escaped"]];
  if (action.kind === "trainer-battle") return [[action.won, "Won"]];
  return [];
}
export const isBattle = (action: InteractionAction): action is Extract<InteractionAction, { kind: "wild-battle" | "trainer-battle" }> => action.kind === "wild-battle" || action.kind === "trainer-battle";

export function newSequenceDialogueId(): string {
  return `Dialogue${[...crypto.getRandomValues(new Uint32Array(4))].map(n => n.toString(16).padStart(8, "0")).join("")}`;
}
export function newSequenceBattleId(): string { return newSequenceDialogueId().replace(/^Dialogue/, "Battle"); }

export function sequenceDialogue(actions: InteractionAction[], path = "Action"): Array<{ key: string; lines: string[] }> {
  return actions.flatMap((action, i) => {
    const key = `${path}${i + 1}`;
    if (action.kind === "dialogue") return [{ key: action.textId ?? key, lines: action.lines }];
    return interactionBranches(action).flatMap(([entries, suffix]) => sequenceDialogue(entries, `${key}${suffix}`));
  });
}

export function identifySequenceDialogue(actions: InteractionAction[]): InteractionAction[] {
  const copy = structuredClone(actions), used = new Set(sequenceDialogue(copy).map(b => b.key));
  const battles = new Set<string>();
  const collect = (entries: InteractionAction[]) => entries.forEach(action => { if (isBattle(action) && action.battleId) battles.add(action.battleId); interactionBranches(action).forEach(([branch]) => collect(branch)); });
  collect(copy);
  let next = 1;
  function visit(entries: InteractionAction[]) {
    for (const action of entries) {
      if (action.kind === "dialogue" && !action.textId) {
        while (used.has(`Dialogue${next}`)) next++;
        action.textId = `Dialogue${next++}`;
        used.add(action.textId);
      }
      if (isBattle(action) && !action.battleId) {
        let id = 1; while (battles.has(`Battle${id}`)) id++;
        action.battleId = `Battle${id}`; battles.add(action.battleId);
      }
      interactionBranches(action).forEach(([entries]) => visit(entries));
    }
  }
  visit(copy);
  return copy;
}

export function validateInteractionSequence(actions: InteractionAction[], domains: InteractionSequenceDomains, once: boolean) {
  let count = 0;
  const textIds = new Set<string>();
  const battleIds = new Set<string>();
  // Track deliveries on each possible path, including branches that rejoin.
  // A single attempt cannot partially deliver several gifts and duplicate the
  // earlier one on retry. Per-action persistent progress is a later extension.
  function visit(entries: InteractionAction[], incoming: Set<number>, depth: number, prefix = "Action"): Set<number> {
    if (!Array.isArray(entries) || depth > 4) throw new Error("Use at most four nested action branches.");
    let paths = incoming;
    for (const [index, entry] of entries.entries()) {
      const key = `${prefix}${index + 1}`;
      try {
      if (++count > 64) throw new Error("Use at most 64 actions in an interaction.");
      if (!entry || typeof entry !== "object") throw new Error("Invalid interaction action.");
      if (!paths.size) throw new Error("Remove actions after an unconditional end; they cannot run.");
      switch (entry.kind) {
        case "if-position":
        case "face-npc":
        case "face-player": {
          if (!domains.scene || domains.scene.reason) throw new Error(domains.scene?.reason ?? "This entry does not support scenes.");
          const actor = (npc: string | undefined) => domains.scene!.actors.find(actor => actor.constant === npc);
          if (entry.kind === "if-position") {
            const test = entry.test;
            if (!test || !(test.mode === "tile" && Number.isInteger(test.x) && Number.isInteger(test.y) && test.x >= 0 && test.y >= 0 && test.x < 256 && test.y < 256
              || test.mode === "relative" && actor(test.npc) && ["UP", "DOWN", "LEFT", "RIGHT"].includes(test.side))) throw new Error("Choose a map tile or an NPC and player position for the branch.");
            paths = new Set([...visit(entry.then, paths, depth + 1, `${key}Then`), ...visit(entry.otherwise, paths, depth + 1, `${key}Otherwise`)]);
          } else {
            if (!["UP", "DOWN", "LEFT", "RIGHT", entry.kind === "face-npc" ? "PLAYER" : "NPC"].includes(entry.facing)) throw new Error("Choose a supported facing direction.");
            if ((entry.kind === "face-npc" || entry.facing === "NPC") && !actor(entry.npc)) throw new Error("Choose an NPC from this map.");
            if (entry.kind === "face-npc" && actor(entry.npc)?.canWalk === false) throw new Error("This stationary sprite cannot turn. Choose an animated actor or change its sprite.");
          }
          break;
        }
        case "if-partner":
        case "partner-move":
          if (!domains.scene || domains.scene.reason) throw new Error(domains.scene?.reason ?? "This entry does not support scenes.");
          if (!domains.scene.partner || domains.scene.partner.reason) throw new Error(domains.scene.partner?.reason ?? "Following partner actions are unavailable.");
          if (entry.kind === "if-partner") paths = new Set([...visit(entry.following, paths, depth + 1, `${key}Following`), ...visit(entry.absent, paths, depth + 1, `${key}Absent`)]);
          else {
            if (!Number.isInteger(entry.x) || !Number.isInteger(entry.y)) throw new Error("Choose a whole-number partner destination on this map.");
            if (entry.facing !== undefined && !["KEEP", "UP", "DOWN", "LEFT", "RIGHT"].includes(entry.facing)) throw new Error("Choose a supported partner facing direction.");
          }
          break;
        case "music":
        case "fade":
        case "wild-battle":
        case "trainer-battle":
          if (!domains.scene || domains.scene.reason) throw new Error(domains.scene?.reason ?? "This entry does not support scenes.");
          if (!domains.effects) throw new Error("Scene effect dependencies are unavailable.");
          if (entry.kind === "music") {
            if (domains.effects.musicReason) throw new Error(domains.effects.musicReason);
            if (typeof entry.persist !== "boolean" || !["play", "stop", "restore"].includes(entry.mode) || entry.mode === "play" && !domains.effects.music.some(track => track.id === entry.track)) throw new Error("Choose a supported music track or music operation.");
          } else if (entry.kind === "fade") {
            if (domains.effects.fadeReason) throw new Error(domains.effects.fadeReason);
            if (!["out", "in"].includes(entry.mode)) throw new Error("Choose fade to black or restore screen.");
          } else {
            if (domains.effects.battleReason) throw new Error(domains.effects.battleReason);
            if (!entry.battleId || !/^Battle[A-Za-z0-9]{1,56}$/.test(entry.battleId) || battleIds.has(entry.battleId)) throw new Error("Battle actions must have unique valid identities.");
            battleIds.add(entry.battleId);
            if (entry.kind === "wild-battle" && (!domains.pokemon.includes(entry.species) || !Number.isInteger(entry.level) || entry.level < 1 || entry.level > 100 || typeof entry.cry !== "boolean")) throw new Error("Choose an encounter Pokémon and level from 1 to 100.");
            if (entry.kind === "trainer-battle" && !domains.effects.trainers.some(trainer => trainer.id === entry.trainer)) throw new Error("Choose an existing trainer party.");
            paths = new Set(interactionBranches(entry).flatMap(([branch, suffix]) => [...visit(branch, paths, depth + 1, `${key}${suffix}`)]));
          }
          break;
        case "walk-npc":
        case "follow-npc":
        case "visibility":
        case "emote":
          if (!domains.scene || domains.scene.reason) throw new Error(domains.scene?.reason ?? "This entry does not support scenes.");
          if (!domains.scene.actors.some(actor => actor.constant === entry.npc)) throw new Error("Choose a stationary NPC from this map.");
          if (entry.kind === "visibility") { if (typeof entry.visible !== "boolean") throw new Error("Choose whether the NPC is visible."); }
          else if (entry.kind === "emote") {
            if (domains.scene.emoteReason) throw new Error(domains.scene.emoteReason);
            if (!domains.scene.emotes?.includes(entry.bubble)) throw new Error("Choose an emotion bubble supported by this game.");
          } else {
            if (domains.scene.actors.find(actor => actor.constant === entry.npc)?.canWalk === false) throw new Error("This stationary sprite cannot walk. Choose an animated actor or change this action.");
            if (!Array.isArray(entry.steps) || entry.steps.length < 1 || entry.steps.length > 32 || entry.steps.some(step => !["UP", "DOWN", "LEFT", "RIGHT"].includes(step))) throw new Error("Enter 1–32 UP, DOWN, LEFT or RIGHT steps.");
          }
          break;
        case "dialogue":
          if (!Array.isArray(entry.lines)) throw new Error("Enter dialogue rows.");
          if (entry.textId !== undefined) {
            if (!/^Dialogue[A-Za-z0-9]{1,56}$/.test(entry.textId) || textIds.has(entry.textId)) throw new Error("Dialogue actions must have unique valid text identities.");
            textIds.add(entry.textId);
          }
          break;
        case "choice":
          if (domains.choiceReason) throw new Error(domains.choiceReason);
          paths = new Set([...visit(entry.yes, paths, depth + 1, `${key}Yes`), ...visit(entry.no, paths, depth + 1, `${key}No`)]);
          break;
        case "if-event":
          if (!domains.events.includes(entry.event) || typeof entry.set !== "boolean") throw new Error("Choose an existing event for the branch.");
          paths = new Set([...visit(entry.then, paths, depth + 1, `${key}Then`), ...visit(entry.otherwise, paths, depth + 1, `${key}Otherwise`)]);
          break;
        case "event":
          if (!domains.events.includes(entry.event) || typeof entry.set !== "boolean") throw new Error("Choose an existing event for the action.");
          break;
        case "wait":
          if (!Number.isInteger(entry.frames) || entry.frames < 1 || entry.frames > 255) throw new Error("Wait duration must be 1–255 frames.");
          break;
        case "heal": break;
        case "sound":
          if (domains.soundReason) throw new Error(domains.soundReason);
          if (!domains.sounds.includes(entry.sound) || typeof entry.wait !== "boolean") throw new Error("Choose a supported project sound effect.");
          break;
        case "item":
        case "pokemon":
          if (entry.kind === "item" && (!domains.items.includes(entry.item) || !Number.isInteger(entry.quantity) || entry.quantity < 1 || entry.quantity > 99)) throw new Error("Choose an item and quantity from 1 to 99.");
          if (entry.kind === "item" && entry.claim && (entry.claim.group === entry.claim.option || ![entry.claim.group, entry.claim.option].every(event => domains.sharedFlags?.some(flag => flag.event === event)))) throw new Error("Choose two different shared flags: one reward group and one chosen option.");
          if (entry.kind === "pokemon") {
            if (domains.pokemonReason) throw new Error(domains.pokemonReason);
            if (!domains.pokemon.includes(entry.species) || !Number.isInteger(entry.level) || entry.level < 1 || entry.level > 100) throw new Error("Choose a Pokémon and level from 1 to 100.");
          }
          paths = new Set([...paths].map(deliveries => deliveries + 1));
          if ([...paths].some(deliveries => deliveries > 1)) throw new Error("Use one reward per execution path so a failed delivery can be retried without duplicating a previous gift.");
          break;
        case "end":
          if (typeof entry.complete !== "boolean") throw new Error("Choose whether ending completes the interaction.");
          if (once && !entry.complete && paths.has(1)) throw new Error("A path that delivers a one-time gift must complete the interaction. End a declined path before delivery.");
          paths = new Set();
          break;
        default: throw new Error("Unsupported interaction action.");
      }
      } catch (error) { throw actionValidationError(error, key, entry && typeof entry === "object" && "npc" in entry ? entry.npc : undefined); }
    }
    return paths;
  }
  visit(actions, new Set([0]), 0);
}

// A question can flow directly into a menu even when it is the last action of
// a branch that rejoins a choice in its parent sequence.
export function sequenceDialoguePrompts(actions: InteractionAction[], following: InteractionAction["kind"] | null = null, path = "Action"): Map<string, boolean> {
  const prompts = new Map<string, boolean>();
  actions.forEach((action, i) => {
    const key = `${path}${i + 1}`, next = actions[i + 1]?.kind ?? following;
    if (action.kind === "dialogue") prompts.set(action.textId ?? key, next !== "choice");
    else {
      const branches = interactionBranches(action);
      for (const [entries, suffix] of branches) for (const [id, prompt] of sequenceDialoguePrompts(entries, next, `${key}${suffix}`)) prompts.set(id, prompt);
    }
  });
  return prompts;
}

export function renderInteractionSequence(actions: InteractionAction[], prefix: string, textPrefix: string, completion: string[], path = "Action", acknowledge = false, prompts = sequenceDialoguePrompts(actions)): string[] {
  const print = (label: string) => [`\tld hl, ${label}`, "\tcall PrintText"];
  const acknowledged = ["\tld a, 1", "\tld [wDoNotWaitForButtonPressAfterDisplayingText], a"];
  return actions.flatMap((action, i): string[] => {
    const key = `${path}${i + 1}`, p = `${prefix}${key}`;
    const branch = (condition: string[], yes: InteractionAction[], no: InteractionAction[], yesKey: string, noKey: string, jump = "nz", entered: string[] = []) => [
      ...condition, `\tjp ${jump}, ${p}Other`,
      ...entered, ...renderInteractionSequence(yes, prefix, textPrefix, completion, `${key}${yesKey}`, acknowledge, prompts), `\tjp ${p}Join`,
      `${p}Other:`, ...entered, ...renderInteractionSequence(no, prefix, textPrefix, completion, `${key}${noKey}`, acknowledge, prompts), `${p}Join:`,
    ];
    switch (action.kind) {
      case "if-position": case "face-npc": case "face-player": case "if-partner": case "partner-move": case "walk-npc": case "follow-npc": case "visibility": case "emote": case "music": case "fade": case "wild-battle": case "trainer-battle": throw new Error("This action requires a yielding scene.");
      case "dialogue": return [...print(`${textPrefix}${action.textId ?? key}Text`), ...(acknowledge && prompts.get(action.textId ?? key) ? acknowledged : [])];
      case "choice": return branch(["\tcall YesNoChoice", "\tld a, [wCurrentMenuItem]", "\tand a"], action.yes, action.no, "Yes", "No", "nz", acknowledge ? acknowledged : []);
      case "if-event": return branch([`\tCheckEvent ${action.event}`], action.then, action.otherwise, "Then", "Otherwise", action.set ? "z" : "nz");
      case "event": return [`\t${action.set ? "SetEvent" : "ResetEvent"} ${action.event}`];
      case "wait": return [`\tld c, ${action.frames}`, "\tcall DelayFrames"];
      case "heal": return ["\tpredef HealParty"];
      case "sound": return [`\tld a, ${action.sound}`, "\tcall PlaySound", ...(action.wait ? ["\tcall WaitForSoundToFinish"] : [])];
      case "item": if (action.claim) throw new Error("Shared reward claims require a yielding scene."); return [`\tlb bc, ${action.item}, ${action.quantity}`, "\tcall GiveItem", `\tjp nc, ${prefix}BagFull`, "\tld a, SFX_GET_ITEM_1", "\tcall PlaySound", "\tcall WaitForSoundToFinish"];
      case "pokemon": return [`\tlb bc, ${action.species}, ${action.level}`, "\tcall GivePokemon", `\tjp nc, ${prefix}BagFull`, "\tld a, [wAddedToParty]", "\tand a", "\tcall z, WaitForTextScrollButtonPress", "\tcall EnableAutoTextBoxDrawing"];
      case "end": return [...(action.complete ? completion : []), `\tjp ${prefix}Finish`];
    }
  });
}
