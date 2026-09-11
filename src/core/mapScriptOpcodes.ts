export type MapScriptOperationKind =
  | "condition"
  | "dialogue"
  | "movement"
  | "facing"
  | "battle"
  | "outcome"
  | "event"
  | "music"
  | "wait"
  | "object"
  | "recovery"
  | "transition";

export type MapMovementDirection = "up" | "down" | "left" | "right";

export interface MapMovementStep {
  direction?: MapMovementDirection;
  count: number;
  operation?: "change-facing" | "special";
  raw: string;
}

export interface MapScriptOpcodeDefinition {
  id: string;
  kind: MapScriptOperationKind;
  title: string;
  beginnerDescription: string;
  patterns: RegExp[];
}

export const MAP_SCRIPT_OPCODES: MapScriptOpcodeDefinition[] = [
  { id: "check-event", kind: "condition", title: "Check event", beginnerDescription: "Continue differently depending on whether an event has happened.", patterns: [/^CheckEvent\s+/i] },
  { id: "set-event", kind: "event", title: "Remember that this happened", beginnerDescription: "Turn on an event flag so the game remembers this state.", patterns: [/^SetEvent\s+/i] },
  { id: "reset-event", kind: "event", title: "Clear event state", beginnerDescription: "Turn off an event flag.", patterns: [/^ResetEvent\s+/i] },
  { id: "display-text", kind: "dialogue", title: "Show dialogue", beginnerDescription: "Display a map text entry.", patterns: [/^call\s+DisplayTextID\b/i, /^call\s+PrintText\b/i] },
  { id: "move-sprite", kind: "movement", title: "Move character", beginnerDescription: "Move a character along a scripted path.", patterns: [/^call\s+MoveSprite\b/i] },
  { id: "move-player", kind: "movement", title: "Move the player automatically", beginnerDescription: "Temporarily control the player and follow a scripted path.", patterns: [/^call\s+StartSimulatingJoypadStates\b/i] },
  { id: "face-sprite", kind: "facing", title: "Turn character", beginnerDescription: "Change the direction a character is facing.", patterns: [/^call\s+SetSpriteFacingDirectionAndDelay\b/i] },
  { id: "battle", kind: "battle", title: "Choose trainer opponent", beginnerDescription: "Prepare a trainer encounter by choosing the opponent. The battle starts after the map script returns.", patterns: [/^ld\s+\[wCurOpponent\]\s*,\s*a\b/i] },
  { id: "battle-text", kind: "outcome", title: "Prepare end-of-battle dialogue", beginnerDescription: "Save both the player-win and player-loss messages so the battle engine can choose the correct one afterward.", patterns: [/^call\s+SaveEndBattleTextPointers\b/i] },
  { id: "battle-result", kind: "condition", title: "Check battle result", beginnerDescription: "Branch based on whether the player won or lost.", patterns: [/^ld\s+a\s*,\s*\[wBattleResult\]/i] },
  { id: "show-object", kind: "object", title: "Show character or object", beginnerDescription: "Make a map object visible.", patterns: [/^predef\s+ShowObject\b/i] },
  { id: "hide-object", kind: "object", title: "Hide character or object", beginnerDescription: "Remove a map object from view.", patterns: [/^predef\s+HideObject\b/i] },
  { id: "delay", kind: "wait", title: "Wait", beginnerDescription: "Pause the script briefly.", patterns: [/^call\s+Delay3\b/i, /^call\s+DelayFrames\b/i] },
  { id: "play-music", kind: "music", title: "Play music", beginnerDescription: "Change the currently playing music.", patterns: [/^call\s+PlayMusic\b/i, /^farcall\s+Music_/i] },
  { id: "default-music", kind: "music", title: "Return to map music", beginnerDescription: "Resume the map's normal music.", patterns: [/^call\s+PlayDefaultMusic\b/i] },
  { id: "heal-party", kind: "recovery", title: "Heal the player's party", beginnerDescription: "Restore the player's Pokémon.", patterns: [/^predef\s+HealParty\b/i] },
];

export function findMapScriptOpcode(line: string): MapScriptOpcodeDefinition | null {
  return MAP_SCRIPT_OPCODES.find((opcode) => opcode.patterns.some((pattern) => pattern.test(line))) ?? null;
}

export function parseMovementStep(value: string, count: number | null): MapMovementStep | null {
  if (value === "-1" || /^\$ff$/i.test(value)) return null;
  const directions: Record<string, MapMovementDirection> = {
    NPC_MOVEMENT_UP: "up", NPC_MOVEMENT_DOWN: "down", NPC_MOVEMENT_LEFT: "left", NPC_MOVEMENT_RIGHT: "right",
    PAD_UP: "up", PAD_DOWN: "down", PAD_LEFT: "left", PAD_RIGHT: "right",
  };
  const direction = directions[value];
  if (direction) return { direction, count: count && count > 0 ? count : 1, raw: value };
  if (value === "NPC_CHANGE_FACING") return { count: count && count > 0 ? count : 1, operation: "change-facing", raw: value };
  return { count: count && count > 0 ? count : 1, operation: "special", raw: value };
}

export function renderMovementStep(step: MapMovementStep): string {
  const arrows: Record<MapMovementDirection, string> = { up: "↑", down: "↓", left: "←", right: "→" };
  const base = step.direction ? arrows[step.direction] : step.operation === "change-facing" ? "Change facing" : "Special movement step";
  return step.count > 1 ? `${base} ×${step.count}` : base;
}
