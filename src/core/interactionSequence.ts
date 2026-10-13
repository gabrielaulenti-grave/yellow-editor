// Structured interaction actions. Branches rejoin the following action unless
// they explicitly end the interaction. Movement remains in yielding map states.
export type InteractionAction =
  | { kind: "dialogue"; lines: string[]; textId?: string }
  | { kind: "choice"; yes: InteractionAction[]; no: InteractionAction[] }
  | { kind: "if-event"; event: string; set: boolean; then: InteractionAction[]; otherwise: InteractionAction[] }
  | { kind: "event"; event: string; set: boolean }
  | { kind: "wait"; frames: number }
  | { kind: "heal" }
  | { kind: "sound"; sound: string; wait: boolean }
  | { kind: "item"; item: string; quantity: number }
  | { kind: "pokemon"; species: string; level: number }
  | { kind: "walk-npc" | "follow-npc"; npc: string; steps: string[] }
  | { kind: "visibility"; npc: string; visible: boolean }
  | { kind: "end"; complete: boolean };

export interface InteractionSequenceDomains {
  items: string[]; pokemon: string[]; events: string[]; sounds: string[];
  pokemonReason: string | null; choiceReason: string | null; soundReason: string | null;
  scene?: { reason: string | null; actors: Array<{ constant: string }> };
}

export function newSequenceDialogueId(): string {
  return `Dialogue${[...crypto.getRandomValues(new Uint32Array(4))].map(n => n.toString(16).padStart(8, "0")).join("")}`;
}

export function sequenceDialogue(actions: InteractionAction[], path = "Action"): Array<{ key: string; lines: string[] }> {
  return actions.flatMap((action, i) => {
    const key = `${path}${i + 1}`;
    if (action.kind === "dialogue") return [{ key: action.textId ?? key, lines: action.lines }];
    if (action.kind === "choice") return [...sequenceDialogue(action.yes, `${key}Yes`), ...sequenceDialogue(action.no, `${key}No`)];
    if (action.kind === "if-event") return [...sequenceDialogue(action.then, `${key}Then`), ...sequenceDialogue(action.otherwise, `${key}Otherwise`)];
    return [];
  });
}

export function identifySequenceDialogue(actions: InteractionAction[]): InteractionAction[] {
  const copy = structuredClone(actions), used = new Set(sequenceDialogue(copy).map(b => b.key));
  let next = 1;
  function visit(entries: InteractionAction[]) {
    for (const action of entries) {
      if (action.kind === "dialogue" && !action.textId) {
        while (used.has(`Dialogue${next}`)) next++;
        action.textId = `Dialogue${next++}`;
        used.add(action.textId);
      } else if (action.kind === "choice") { visit(action.yes); visit(action.no); }
      else if (action.kind === "if-event") { visit(action.then); visit(action.otherwise); }
    }
  }
  visit(copy);
  return copy;
}

export function validateInteractionSequence(actions: InteractionAction[], domains: InteractionSequenceDomains, once: boolean) {
  let count = 0;
  const textIds = new Set<string>();
  // Track deliveries on each possible path, including branches that rejoin.
  // A single attempt cannot partially deliver several gifts and duplicate the
  // earlier one on retry. Per-action persistent progress is a later extension.
  function visit(entries: InteractionAction[], incoming: Set<number>, depth: number): Set<number> {
    if (!Array.isArray(entries) || depth > 4) throw new Error("Use at most four nested action branches.");
    let paths = incoming;
    for (const entry of entries) {
      if (++count > 64) throw new Error("Use at most 64 actions in an interaction.");
      if (!entry || typeof entry !== "object") throw new Error("Invalid interaction action.");
      if (!paths.size) throw new Error("Remove actions after an unconditional end; they cannot run.");
      switch (entry.kind) {
        case "walk-npc":
        case "follow-npc":
        case "visibility":
          if (!domains.scene || domains.scene.reason) throw new Error(domains.scene?.reason ?? "This entry does not support scenes.");
          if (!domains.scene.actors.some(actor => actor.constant === entry.npc)) throw new Error("Choose a stationary NPC from this map.");
          if (entry.kind === "visibility") { if (typeof entry.visible !== "boolean") throw new Error("Choose whether the NPC is visible."); }
          else {
            if (!Array.isArray(entry.steps) || entry.steps.length < 1 || entry.steps.length > 32 || entry.steps.some(step => !["UP", "DOWN", "LEFT", "RIGHT"].includes(step))) throw new Error("Enter 1–32 UP, DOWN, LEFT or RIGHT steps.");
            if (paths.has(1)) throw new Error("Walk before delivering rewards so interrupted movement cannot duplicate a gift.");
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
          paths = new Set([...visit(entry.yes, paths, depth + 1), ...visit(entry.no, paths, depth + 1)]);
          break;
        case "if-event":
          if (!domains.events.includes(entry.event) || typeof entry.set !== "boolean") throw new Error("Choose an existing event for the branch.");
          paths = new Set([...visit(entry.then, paths, depth + 1), ...visit(entry.otherwise, paths, depth + 1)]);
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
    else if (action.kind === "choice" || action.kind === "if-event") {
      const branches = action.kind === "choice" ? [[action.yes, "Yes"], [action.no, "No"]] as const : [[action.then, "Then"], [action.otherwise, "Otherwise"]] as const;
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
      case "walk-npc": case "follow-npc": case "visibility": throw new Error("Walking and visibility require a yielding scene.");
      case "dialogue": return [...print(`${textPrefix}${action.textId ?? key}Text`), ...(acknowledge && prompts.get(action.textId ?? key) ? acknowledged : [])];
      case "choice": return branch(["\tcall YesNoChoice", "\tld a, [wCurrentMenuItem]", "\tand a"], action.yes, action.no, "Yes", "No", "nz", acknowledge ? acknowledged : []);
      case "if-event": return branch([`\tCheckEvent ${action.event}`], action.then, action.otherwise, "Then", "Otherwise", action.set ? "z" : "nz");
      case "event": return [`\t${action.set ? "SetEvent" : "ResetEvent"} ${action.event}`];
      case "wait": return [`\tld c, ${action.frames}`, "\tcall DelayFrames"];
      case "heal": return ["\tpredef HealParty"];
      case "sound": return [`\tld a, ${action.sound}`, "\tcall PlaySound", ...(action.wait ? ["\tcall WaitForSoundToFinish"] : [])];
      case "item": return [`\tlb bc, ${action.item}, ${action.quantity}`, "\tcall GiveItem", `\tjp nc, ${prefix}BagFull`, "\tld a, SFX_GET_ITEM_1", "\tcall PlaySound", "\tcall WaitForSoundToFinish"];
      case "pokemon": return [`\tlb bc, ${action.species}, ${action.level}`, "\tcall GivePokemon", `\tjp nc, ${prefix}BagFull`, "\tld a, [wAddedToParty]", "\tand a", "\tcall z, WaitForTextScrollButtonPress", "\tcall EnableAutoTextBoxDrawing"];
      case "end": return [...(action.complete ? completion : []), `\tjp ${prefix}Finish`];
    }
  });
}
