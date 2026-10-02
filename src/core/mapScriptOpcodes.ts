import type { ProjectMovementVocabulary } from "./types";

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
  | "item"
  | "economy"
  | "party"
  | "service"
  | "control"
  | "flag"
  | "screen"
  | "map"
  | "transition";

export type MapMovementDirection =
  | "up"
  | "down"
  | "left"
  | "right"
  | "up-left"
  | "up-right"
  | "down-left"
  | "down-right";

export interface MapMovementStep {
  direction?: MapMovementDirection;
  count: number;
  operation?: "change-facing" | "look" | "delay" | "special";
  style?: "step" | "slide" | "hop" | "walk";
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
  { id: "give-item", kind: "item", title: "Give item", beginnerDescription: "Add an item reward to the player's Bag.", patterns: [/^call\s+GiveItem\b/i] },
  { id: "give-pokemon", kind: "item", title: "Give Pokémon", beginnerDescription: "Add a Pokémon reward to the player's party or storage.", patterns: [/^call\s+GivePokemon\b/i] },
  { id: "money-check", kind: "economy", title: "Check money", beginnerDescription: "Branch according to whether the player can afford a cost.", patterns: [/^call\s+HasEnoughMoney\b/i, /^call\s+HasEnoughCoins\b/i, /^call\s+Has9990Coins\b/i] },
  { id: "party-menu", kind: "party", title: "Choose a party Pokémon", beginnerDescription: "Open the party menu so the player can choose a Pokémon.", patterns: [/^call\s+DisplayPartyMenu\b/i] },
  { id: "service-menu", kind: "service", title: "Run service interaction", beginnerDescription: "Open a reusable service/menu interaction.", patterns: [/^predef\s+(?:DisplayElevatorFloorMenu|OaksAideScript|DoInGameTradeDialogue)\b/i] },
];

export function findMapScriptOpcode(line: string): MapScriptOpcodeDefinition | null {
  return MAP_SCRIPT_OPCODES.find((opcode) => opcode.patterns.some((pattern) => pattern.test(line))) ?? null;
}

function movementByteValue(value: string): number | null {
  if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10);
  if (/^\$[0-9a-f]+$/i.test(value)) return Number.parseInt(value.slice(1), 16);
  if (/^%[01_]+$/.test(value)) return Number.parseInt(value.slice(1).replace(/_/g, ""), 2);
  return null;
}

function customCommandMeaning(
  value: string,
  vocabulary: ProjectMovementVocabulary | undefined,
  consumerRoutine: string | undefined,
): {
  direction?: MapMovementDirection;
  operation?: "look" | "delay";
  style?: "step" | "slide" | "hop" | "walk";
  end?: boolean;
} | null {
  if (!vocabulary || !consumerRoutine) return null;
  const consumer = vocabulary.consumers.find(
    (candidate) => candidate.routine === consumerRoutine,
  );
  if (!consumer) return null;

  const numeric = movementByteValue(value);
  const matches = consumer.commands.filter((command) =>
    command.symbol === value || (numeric !== null && command.value === numeric)
  );
  const unique = matches.filter((command, index) =>
    matches.findIndex((candidate) =>
      candidate.action === command.action
      && candidate.style === command.style
      && candidate.direction === command.direction
    ) === index
  );
  if (unique.length !== 1) return null;

  const command = unique[0];
  if (command.action === "end") return { end: true };
  if (command.action === "delay") return { operation: "delay" };
  if (command.action === "look") {
    return {
      operation: "look",
      direction: command.direction as MapMovementDirection | undefined,
    };
  }
  if (command.action === "move" && command.direction) {
    return {
      direction: command.direction as MapMovementDirection,
      style: command.style,
    };
  }
  return null;
}

function projectDirectionForSymbol(
  value: string,
  vocabulary: ProjectMovementVocabulary | undefined,
): MapMovementDirection | null {
  const matches = vocabulary?.exactValues.filter(
    (entry) => entry.symbol === value && entry.direction,
  ) ?? [];
  const directions = [...new Set(matches.map((entry) => entry.direction))];
  return directions.length === 1 ? directions[0] as MapMovementDirection : null;
}

function projectOperationForSymbol(
  value: string,
  vocabulary: ProjectMovementVocabulary | undefined,
): "change-facing" | null {
  return vocabulary?.exactValues.some(
    (entry) => entry.symbol === value && entry.operation === "change-facing",
  ) ? "change-facing" : null;
}

function projectNumericMeaning(
  value: number,
  vocabulary: ProjectMovementVocabulary | undefined,
  mode: "npc" | "joypad",
): { direction?: MapMovementDirection; operation?: "change-facing" } | null {
  if (!vocabulary) return null;

  const operationMatches = vocabulary.exactValues.filter(
    (entry) => entry.value === value && entry.operation === "change-facing",
  );
  if (operationMatches.length > 0 && mode === "npc") {
    return { operation: "change-facing" };
  }

  if (mode === "npc") {
    const exactNpcDirections = [...new Set(
      vocabulary.npcExactValues
        .filter((entry) => entry.value === value && entry.direction)
        .map((entry) => entry.direction),
    )];
    if (exactNpcDirections.length === 1) {
      return { direction: exactNpcDirections[0] as MapMovementDirection };
    }

    const range = vocabulary.npcRanges.find(
      (candidate) =>
        value >= candidate.minimum
        && (candidate.maximumExclusive === null || value < candidate.maximumExclusive),
    );
    if (range) return { direction: range.direction };
  }

  const exactSource = mode === "joypad"
    ? vocabulary.joypadExactValues
    : vocabulary.exactValues;
  const exactDirections = [...new Set(
    exactSource
      .filter((entry) => entry.value === value && entry.direction)
      .map((entry) => entry.direction),
  )];
  if (exactDirections.length === 1) {
    return { direction: exactDirections[0] as MapMovementDirection };
  }
  return null;
}

export function parseMovementStep(
  value: string,
  count: number | null,
  vocabulary?: ProjectMovementVocabulary,
  mode: "npc" | "joypad" | "custom" = "npc",
  consumerRoutine?: string,
): MapMovementStep | null {
  if (value === "-1" || /^\$ff$/i.test(value)) return null;
  const stepCount = count && count > 0 ? count : 1;

  if (mode === "custom") {
    const command = customCommandMeaning(value, vocabulary, consumerRoutine);
    if (command?.end) return null;
    if (command?.operation === "delay") {
      return { count: stepCount, operation: "delay", raw: value };
    }
    if (command?.operation === "look") {
      return {
        direction: command.direction,
        count: stepCount,
        operation: "look",
        raw: value,
      };
    }
    if (command?.direction) {
      return {
        direction: command.direction,
        count: stepCount,
        style: command.style,
        raw: value,
      };
    }
    return { count: stepCount, operation: "special", raw: value };
  }

  const symbolicOperation = projectOperationForSymbol(value, vocabulary);
  if (symbolicOperation) {
    return { count: stepCount, operation: symbolicOperation, raw: value };
  }
  const symbolicDirection = projectDirectionForSymbol(value, vocabulary);
  if (symbolicDirection) {
    return { direction: symbolicDirection, count: stepCount, raw: value };
  }

  const numeric = movementByteValue(value);
  if (numeric !== null) {
    const meaning = projectNumericMeaning(numeric, vocabulary, mode);
    if (meaning?.operation) {
      return { count: stepCount, operation: meaning.operation, raw: value };
    }
    if (meaning?.direction) {
      return { direction: meaning.direction, count: stepCount, raw: value };
    }
  }

  // Legacy fallback keeps previews useful if project-wide constant analysis is
  // unavailable. Project-derived semantics take precedence whenever present.
  const directions: Record<string, MapMovementDirection> = {
    NPC_MOVEMENT_UP: "up", NPC_MOVEMENT_DOWN: "down", NPC_MOVEMENT_LEFT: "left", NPC_MOVEMENT_RIGHT: "right",
    PAD_UP: "up", PAD_DOWN: "down", PAD_LEFT: "left", PAD_RIGHT: "right",
  };
  const direction = directions[value];
  if (direction) return { direction, count: stepCount, raw: value };
  if (value === "NPC_CHANGE_FACING") {
    return { count: stepCount, operation: "change-facing", raw: value };
  }
  return { count: stepCount, operation: "special", raw: value };
}

export function renderMovementStep(step: MapMovementStep): string {
  const arrows: Record<MapMovementDirection, string> = {
    up: "↑",
    down: "↓",
    left: "←",
    right: "→",
    "up-left": "↖",
    "up-right": "↗",
    "down-left": "↙",
    "down-right": "↘",
  };
  const styledDirection = step.direction
    ? `${step.style === "hop"
        ? "Hop "
        : step.style === "slide"
          ? "Slide "
          : step.style === "walk"
            ? "Walk "
            : step.style === "step"
              ? "Step "
              : ""}${arrows[step.direction]}`
    : null;
  const base = step.operation === "delay"
    ? "Pause"
    : step.operation === "look"
      ? `Face ${step.direction ? arrows[step.direction] : "direction"}`
      : step.operation === "change-facing"
        ? "Change facing"
        : styledDirection
          ? styledDirection
          : `Unresolved step (${step.raw})`;
  return step.count > 1 ? `${base} ×${step.count}` : base;
}
