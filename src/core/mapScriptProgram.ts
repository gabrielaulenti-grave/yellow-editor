import { parseMovementPath } from "./mapScriptParser";
import {
  movementLabelAlternativesAtCall,
  playerMovementAlternativesAtCall,
} from "./mapScriptMovementAnalysis";
import type { MapMovementStep, MapScriptOperationKind } from "./mapScriptOpcodes";
import { eventArgumentsForSemantic } from "./eventMacroSemantics";
import type {
  ProjectEventMacroSemantic,
  ProjectMovementVocabulary,
} from "./types";

export type MapScriptConfidence = "exact" | "inferred";

export interface MapScriptSourceSpan {
  lineStart: number;
  lineEnd: number;
  raw: string;
  confidence: MapScriptConfidence;
}

export interface MapScriptMovementAlternative {
  pathLabel: string;
  path: MapMovementStep[];
  conditions: string[];
  confidence: MapScriptConfidence;
}

export interface MapScriptValueAlternative {
  value: string;
  conditions: string[];
  confidence: MapScriptConfidence;
}

interface BaseNode {
  id: string;
  kind: MapScriptOperationKind;
  title: string;
  description?: string;
  source: MapScriptSourceSpan;
}

export type MapScriptSemanticNode =
  | (BaseNode & {
      type: "movement";
      actor: "player" | "character";
      actorConstant?: string;
      pathLabel?: string;
      path: MapMovementStep[];
      alternatives: MapScriptMovementAlternative[];
      guards?: string[];
      dynamic: boolean;
    })
  | (BaseNode & {
      type: "dialogue";
      textLabel?: string;
    })
  | (BaseNode & {
      type: "battle-dialogue";
      playerWins?: string;
      playerLoses?: string;
    })
  | (BaseNode & {
      type: "opponent";
      opponent?: string;
      trainerNo?: string;
    })
  | (BaseNode & {
      type: "wait";
      frames?: number;
      reason?: string;
    })
  | (BaseNode & {
      type: "event";
      action:
        | "check"
        | "check-set"
        | "check-reset"
        | "check-any"
        | "check-all"
        | "set"
        | "reset"
        | "set-many"
        | "reset-many"
        | "set-range"
        | "reset-range";
      event: string;
      events?: string[];
    })
  | (BaseNode & {
      type: "condition";
      condition: string;
      branchTarget?: string;
    })
  | (BaseNode & {
      type: "transition";
      targetConstant: string;
      targetLabel?: string;
    })
  | (BaseNode & {
      type: "object";
      action: "show" | "hide";
      object?: string;
      alternatives?: MapScriptValueAlternative[];
    })
  | (BaseNode & {
      type: "music";
      music?: string;
    })
  | (BaseNode & {
      type: "map-edit";
      action: "replace-tile-block";
      block?: string;
      x?: string;
      y?: string;
    })
  | (BaseNode & {
      type: "indexed-event";
      action: "address" | "bit" | "flag-action";
      baseEvent: string;
      relatedEvent?: string;
      destination?: string;
      mode?: string;
    })
  | (BaseNode & {
      type: "object-puzzle";
      action: "check-boulder-target";
      coordinates?: string;
    })
  | (BaseNode & {
      type: "warp";
      action: "dungeon-warp-check";
      destinationMap?: string;
      coordinates?: string;
    })
  | (BaseNode & {
      type: "facing";
      actor?: string;
      facing?: string;
      alternatives?: MapScriptValueAlternative[];
    })
  | (BaseNode & {
      type: "recovery";
    })
  | (BaseNode & {
      type: "item";
      action: "give-item" | "give-pokemon" | "check-item";
      item?: string;
      quantity?: string;
      species?: string;
      level?: string;
    })
  | (BaseNode & {
      type: "economy";
      action: "check-money" | "check-coins" | "check-coin-cap";
    })
  | (BaseNode & {
      type: "party";
      action: "select" | "read-name";
    })
  | (BaseNode & {
      type: "service";
      service:
        | "pokedex"
        | "elevator"
        | "oaks-aide"
        | "trade"
        | "trainer-interaction"
        | "forced-travel"
        | "yes-no"
        | "random";
    })
  | (BaseNode & {
      type: "control";
      control: "player-input" | "dialogue-auto-advance" | "held-input";
      value?: string;
      alternatives?: MapScriptValueAlternative[];
    })
  | (BaseNode & {
      type: "flag";
      variable: string;
      flag: string;
      action: "set" | "clear";
    })
  | (BaseNode & {
      type: "screen";
      action: "fade-out" | "fade-in";
    });

export interface MapScriptStateTransition {
  targetConstant: string;
  targetLabel: string | null;
  source: MapScriptSourceSpan;
}

export interface MapScriptState {
  label: string;
  scriptConstant: string | null;
  startLine: number;
  source: string;
  external: boolean;
  nodes: MapScriptSemanticNode[];
  transitions: MapScriptStateTransition[];
  predecessorLabels: string[];
}

export interface MapScriptProgram {
  states: MapScriptState[];
}

interface LabelSection {
  label: string;
  startLine: number;
  source: string;
}

function withoutComment(line: string): string {
  return line.split(";", 1)[0].trim();
}

function parseNumber(value: string | null): number | null {
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value);
  if (/^\$[0-9a-f]+$/i.test(value)) return Number.parseInt(value.slice(1), 16);
  return null;
}

function globalLabelSections(contents: string): LabelSection[] {
  const lines = contents.split(/\r?\n/);
  const starts: Array<{ label: string; index: number }> = [];
  lines.forEach((line, index) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*):{1,2}\s*(?:;.*)?$/);
    if (match) starts.push({ label: match[1], index });
  });
  return starts.map((start, index) => ({
    label: start.label,
    startLine: start.index + 1,
    source: lines.slice(start.index, starts[index + 1]?.index ?? lines.length).join("\n"),
  }));
}

function scriptPointers(source: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of source.matchAll(/^\s*dw_const\s+([A-Za-z_][A-Za-z0-9_]*)\s*,\s*(SCRIPT_[A-Z0-9_]+)\b/gm)) {
    result.set(match[2], match[1]);
  }
  return result;
}

function recentRegisterValue(
  lines: string[],
  beforeIndex: number,
  register: "a" | "b" | "c" | "de" | "hl",
  maxBack = 12,
): string | null {
  const pattern = new RegExp(`^ld\\s+${register}\\s*,\\s*([^\\s;]+)\\b`, "i");
  for (let index = beforeIndex - 1; index >= Math.max(0, beforeIndex - maxBack); index -= 1) {
    const value = withoutComment(lines[index]).match(pattern)?.[1];
    if (value) return value;
  }
  return null;
}

function recentLbBcPair(
  lines: string[],
  beforeIndex: number,
  maxBack = 10,
): { b: string; c: string } | null {
  for (
    let index = beforeIndex - 1;
    index >= Math.max(1, beforeIndex - maxBack);
    index -= 1
  ) {
    const pair = withoutComment(lines[index]).match(
      /^lb\s+bc\s*,\s*([^,\s]+)\s*,\s*([^\s;]+)\s*$/i,
    );
    if (pair) return { b: pair[1], c: pair[2] };
  }
  return null;
}

function loadedValueBeforeStore(
  lines: string[],
  beforeIndex: number,
  storePattern: RegExp,
  maxBack = 12,
): string | null {
  for (let index = beforeIndex - 1; index >= Math.max(0, beforeIndex - maxBack); index -= 1) {
    if (!storePattern.test(withoutComment(lines[index]))) continue;
    for (let valueIndex = index - 1; valueIndex >= Math.max(0, index - 4); valueIndex -= 1) {
      const value = withoutComment(lines[valueIndex]).match(/^ld\s+a\s*,\s*([^\s;]+)\b/i)?.[1];
      if (value) return value;
      if (/^xor\s+a\b/i.test(withoutComment(lines[valueIndex]))) return "0";
    }
  }
  return null;
}

function sourceSpan(
  section: LabelSection,
  lines: string[],
  startIndex: number,
  endIndex = startIndex,
  confidence: MapScriptConfidence = "exact",
): MapScriptSourceSpan {
  return {
    lineStart: section.startLine + startIndex,
    lineEnd: section.startLine + endIndex,
    raw: lines.slice(startIndex, endIndex + 1).join("\n"),
    confidence,
  };
}

function localLabelSource(section: LabelSection, label: string): string | null {
  if (!label.startsWith(".")) return null;
  const lines = section.source.split(/\r?\n/);
  const start = lines.findIndex((line) => {
    const match = line.match(/^\s*(\.[A-Za-z_][A-Za-z0-9_.]*):{0,2}\s*(?:;.*)?$/);
    return match?.[1] === label;
  });
  if (start < 0) return null;

  const result = [lines[start]];
  let sawData = false;
  for (let index = start + 1; index < lines.length; index += 1) {
    const sourceLine = lines[index];
    const clean = withoutComment(sourceLine);
    if (!clean) {
      result.push(sourceLine);
      continue;
    }

    if (/^\.[A-Za-z_][A-Za-z0-9_.]*:{0,2}$/.test(clean)) {
      result.push(sourceLine);
      continue;
    }

    const data = clean.match(/^db\s+([^,\s]+)/i);
    if (data) {
      sawData = true;
      result.push(sourceLine);
      if (data[1] === "-1" || /^\$ff$/i.test(data[1])) break;
      continue;
    }

    if (sawData) break;
    return null;
  }
  return sawData ? result.join("\n") : null;
}

function hasMovementTerminator(source: string): boolean {
  return source.split(/\r?\n/).some((line) => {
    const value = withoutComment(line).match(/^db\s+([^,\s]+)/i)?.[1];
    return value === "-1" || Boolean(value && /^\$ff$/i.test(value));
  });
}

function dataOnlyAfterLabel(source: string): boolean {
  const lines = source.split(/\r?\n/).slice(1);
  let sawData = false;
  for (const sourceLine of lines) {
    const clean = withoutComment(sourceLine);
    if (!clean) continue;
    if (/^db\b/i.test(clean)) {
      sawData = true;
      continue;
    }
    return false;
  }
  return sawData;
}

function globalMovementSource(
  sections: Map<string, LabelSection>,
  label: string,
): string | null {
  const start = sections.get(label);
  if (!start) return null;
  const ordered = [...sections.values()].sort(
    (left, right) => left.startLine - right.startLine,
  );
  const startIndex = ordered.findIndex((section) => section.label === label);
  if (startIndex < 0) return null;

  let result = start.source;
  if (hasMovementTerminator(result)) return result;

  for (let index = startIndex + 1; index < ordered.length; index += 1) {
    const nextSection = ordered[index];
    if (!dataOnlyAfterLabel(nextSection.source)) break;
    result += `\n${nextSection.source}`;
    if (hasMovementTerminator(nextSection.source)) break;
  }
  return result;
}

function movementSource(
  sections: Map<string, LabelSection>,
  owner: LabelSection,
  label: string,
): string | null {
  return label.startsWith(".")
    ? localLabelSource(owner, label)
    : globalMovementSource(sections, label);
}

function coordinateMovementAlternatives(
  sections: Map<string, LabelSection>,
  owner: LabelSection,
  tableLabel: string,
  movementVocabulary?: ProjectMovementVocabulary,
): MapScriptMovementAlternative[] {
  const tableSource = movementSource(sections, owner, tableLabel);
  if (!tableSource) return [];

  const rows: Array<{ x: string; y: string; label: string }> = [];
  for (const line of tableSource.split(/\r?\n/)) {
    const match = withoutComment(line).match(
      /^map_coord_movement\s+([^,]+)\s*,\s*([^,]+)\s*,\s*([A-Za-z_.][A-Za-z0-9_.]*)\b/i,
    );
    if (!match) continue;
    rows.push({
      x: match[1].trim(),
      y: match[2].trim(),
      label: match[3],
    });
  }
  if (rows.length === 0) return [];

  const grouped = new Map<string, Array<{ x: string; y: string }>>();
  for (const row of rows) {
    const coords = grouped.get(row.label) ?? [];
    coords.push({ x: row.x, y: row.y });
    grouped.set(row.label, coords);
  }

  return [...grouped.entries()].map(([label, coords]) => {
    const movement = movementSource(sections, owner, label);
    const coordinateText = coords
      .map(({ x, y }) => `(${x}, ${y})`)
      .join(", ");
    return {
      pathLabel: label,
      path: movement
        ? parseMovementPath(
            label,
            movement,
            movementVocabulary,
            "joypad",
          ).steps
        : [],
      conditions: [
        coords.length === 1
          ? `player is at ${coordinateText}`
          : `player is at one of ${coordinateText}`,
      ],
      confidence: "exact",
    } satisfies MapScriptMovementAlternative;
  });
}

function objectWrapperActions(
  sections: Map<string, LabelSection>,
): Map<string, "show" | "hide"> {
  const result = new Map<string, "show" | "hide">();
  for (const section of sections.values()) {
    const lines = section.source.split(/\r?\n/).map(withoutComment);
    const storeIndex = lines.findIndex((line) =>
      /^ld\s+\[wToggleableObjectIndex\]\s*,\s*a\b/i.test(line)
    );
    if (storeIndex < 0) continue;

    const actionLine = lines.slice(storeIndex + 1, storeIndex + 5)
      .find((line) => /^predef\s+(?:ShowObject|HideObject)\b/i.test(line));
    const action = actionLine?.match(/^predef\s+(ShowObject|HideObject)\b/i)?.[1];
    if (!action) continue;

    const overwritesA = lines.slice(1, storeIndex).some((line) =>
      /^ld\s+a\s*,/i.test(line) || /^xor\s+a\b/i.test(line)
    );
    if (overwritesA) continue;

    result.set(section.label, action.toLowerCase().startsWith("show") ? "show" : "hide");
  }
  return result;
}

function scriptStateSetterLabels(
  sections: Map<string, LabelSection>,
): Set<string> {
  const result = new Set<string>();
  for (const section of sections.values()) {
    const lines = section.source.split(/\r?\n/).map(withoutComment);
    const storesCurrentScript = lines.some((line) =>
      /^ld\s+\[w[A-Za-z0-9_]*CurScript\]\s*,\s*a\b/i.test(line)
      || /^ld\s+\[wCurMapScript\]\s*,\s*a\b/i.test(line)
    );
    if (!storesCurrentScript) continue;

    const loadsDifferentA = lines.slice(1).some((line) =>
      /^ld\s+a\s*,/i.test(line) || /^xor\s+a\b/i.test(line)
    );
    if (!loadsDifferentA) result.add(section.label);
  }
  return result;
}

function sectionTerminates(source: string): boolean {
  const lines = source.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 1; index -= 1) {
    const clean = withoutComment(lines[index]);
    if (!clean || /^\.[A-Za-z_][A-Za-z0-9_.]*:{0,2}$/.test(clean)) continue;
    if (/^(?:ret|reti)\s*$/i.test(clean)) return true;
    if (/^(?:jp|jr)\s+(?!z\b|nz\b|c\b|nc\b)[A-Za-z_.][A-Za-z0-9_.]*\b/i.test(clean)) return true;
    return false;
  }
  return false;
}

function transitionsForSection(
  section: LabelSection,
  pointers: Map<string, string>,
  setterLabels: Set<string>,
  nextStateLabel: string | null,
): MapScriptStateTransition[] {
  const lines = section.source.split(/\r?\n/);
  const transitions: MapScriptStateTransition[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const constant = withoutComment(lines[index]).match(/^ld\s+a\s*,\s*(SCRIPT_[A-Z0-9_]+)\b/i)?.[1];
    if (!constant) continue;
    for (let next = index + 1; next <= Math.min(lines.length - 1, index + 4); next += 1) {
      const clean = withoutComment(lines[next]);
      const directStore = /^ld\s+\[w[A-Za-z0-9_]*CurScript\]\s*,\s*a\b/i.test(clean)
        || /^ld\s+\[wCurMapScript\]\s*,\s*a\b/i.test(clean);
      const helperCall = clean.match(/^call\s+([A-Za-z_][A-Za-z0-9_]*)\b/i)?.[1];
      if (directStore || (helperCall && setterLabels.has(helperCall))) {
        transitions.push({
          targetConstant: constant,
          targetLabel: pointers.get(constant) ?? null,
          source: sourceSpan(section, lines, index, next, directStore ? "exact" : "inferred"),
        });
        break;
      }
    }
  }

  if (nextStateLabel && !sectionTerminates(section.source)) {
    const targetConstant = [...pointers.entries()]
      .find(([, label]) => label === nextStateLabel)?.[0];
    if (targetConstant) {
      const lastIndex = Math.max(1, lines.length - 1);
      transitions.push({
        targetConstant,
        targetLabel: nextStateLabel,
        source: sourceSpan(section, lines, lastIndex, lastIndex, "inferred"),
      });
    }
  }

  return transitions;
}

function nodesForSection(
  section: LabelSection,
  sections: Map<string, LabelSection>,
  transitions: MapScriptStateTransition[],
  objectWrappers: Map<string, "show" | "hide">,
  eventMacros: Map<string, ProjectEventMacroSemantic>,
  movementVocabulary?: ProjectMovementVocabulary,
): MapScriptSemanticNode[] {
  const lines = section.source.split(/\r?\n/);
  const nodes: MapScriptSemanticNode[] = [];
  const transitionStarts = new Map(transitions.map((transition) => [transition.source.lineStart, transition]));

  for (let index = 1; index < lines.length; index += 1) {
    const clean = withoutComment(lines[index]);
    if (!clean) continue;
    const absoluteLine = section.startLine + index;

    const transition = transitionStarts.get(absoluteLine);
    if (transition) {
      nodes.push({
        id: `${section.label}:${absoluteLine}:transition`,
        type: "transition",
        kind: "transition",
        title: "Continue to next script state",
        description: "The map event continues in another named state after this routine returns.",
        targetConstant: transition.targetConstant,
        targetLabel: transition.targetLabel ?? undefined,
        source: transition.source,
      });
      continue;
    }

    if (/^ld\s+a\s*,\s*\[wSimulatedJoypadStatesIndex\]/i.test(clean)
      && /^and\s+a\b/i.test(withoutComment(lines[index + 1] ?? ""))
      && /^ret\s+nz\b/i.test(withoutComment(lines[index + 2] ?? ""))) {
      nodes.push({
        id: `${section.label}:${absoluteLine}:wait-player-movement`,
        type: "wait",
        kind: "wait",
        title: "Wait for automatic movement",
        reason: "Continue when the player's scripted movement has finished.",
        source: sourceSpan(section, lines, index, index + 2),
      });
      continue;
    }

    if (/^ld\s+a\s*,\s*\[wStatusFlags5\]/i.test(clean)
      && /^bit\s+BIT_SCRIPTED_NPC_MOVEMENT\s*,\s*a\b/i.test(withoutComment(lines[index + 1] ?? ""))
      && /^ret\s+nz\b/i.test(withoutComment(lines[index + 2] ?? ""))) {
      nodes.push({
        id: `${section.label}:${absoluteLine}:wait-npc-movement`,
        type: "wait",
        kind: "wait",
        title: "Wait for character movement",
        reason: "Continue when the scripted character movement has finished.",
        source: sourceSpan(section, lines, index, index + 2),
      });
      continue;
    }

    if (/^ld\s+a\s*,\s*\[wIsInBattle\]/i.test(clean)
      && /^cp\s+LOST_BATTLE\b/i.test(withoutComment(lines[index + 1] ?? ""))) {
      const branch = withoutComment(lines[index + 2] ?? "").match(/^jp\s+z\s*,\s*([A-Za-z_.][A-Za-z0-9_.]*)/i);
      if (branch) {
        nodes.push({
          id: `${section.label}:${absoluteLine}:lost-battle`,
          type: "condition",
          kind: "condition",
          title: "If the player lost the battle",
          condition: "Battle result is a loss",
          branchTarget: branch[1],
          description: `Run ${branch[1]} instead of continuing this state.`,
          source: sourceSpan(section, lines, index, index + 2),
        });
        continue;
      }
    }

    const macroInvocation = clean.match(
      /^([A-Za-z_][A-Za-z0-9_#@.]*)\s+(.+)$/,
    );
    if (macroInvocation) {
      const macroName = macroInvocation[1];
      const macroArguments = macroInvocation[2]
        .split(",")
        .map((value) => value.trim());

      if (/^EventFlagAddress$/i.test(macroName) && macroArguments.length >= 2) {
        nodes.push({
          id: `${section.label}:${absoluteLine}:indexed-event-address`,
          type: "indexed-event",
          kind: "event",
          title: "Address indexed event state",
          action: "address",
          destination: macroArguments[0],
          baseEvent: macroArguments[1],
          description: "Prepare the event byte containing a runtime-selected member of this event family.",
          source: sourceSpan(section, lines, index),
        });
        continue;
      }

      if (/^EventFlagBit$/i.test(macroName) && macroArguments.length >= 2) {
        nodes.push({
          id: `${section.label}:${absoluteLine}:indexed-event-bit`,
          type: "indexed-event",
          kind: "condition",
          title: "Calculate indexed event bit",
          action: "bit",
          destination: macroArguments[0],
          baseEvent: macroArguments[1],
          relatedEvent: macroArguments[2],
          description: "Calculate the bit/index for a member of a persistent event family.",
          source: sourceSpan(section, lines, index),
        });
        continue;
      }

      const semantic = eventMacros.get(macroName.toLowerCase());
      if (semantic) {
        const arguments_ = macroArguments;
        const events = eventArgumentsForSemantic(
          semantic,
          arguments_,
        );

        if (events.length > 0) {
          const checking = semantic.action.startsWith("check");
          const title = semantic.action === "check-set"
            ? "Check event and remember it"
            : semantic.action === "check-reset"
              ? "Check event and clear it"
              : semantic.action === "check-any"
                ? "Check whether any event has happened"
                : semantic.action === "check-all"
                  ? "Check whether all events have happened"
                  : semantic.action === "check"
                    ? "Check event"
                    : semantic.action === "set-many"
                      ? "Remember multiple events"
                      : semantic.action === "reset-many"
                        ? "Clear multiple events"
                        : semantic.action === "set-range"
                          ? "Remember an event range"
                          : semantic.action === "reset-range"
                            ? "Clear an event range"
                            : semantic.action === "set"
                              ? "Remember that this happened"
                              : "Clear event state";
          nodes.push({
            id: `${section.label}:${absoluteLine}:${semantic.action}-event`,
            type: "event",
            kind: checking ? "condition" : "event",
            title,
            action: semantic.action,
            event: events[0],
            events,
            source: sourceSpan(section, lines, index, index, "inferred"),
          });
          continue;
        }
      }
    }

    const joyIgnoreStore = /^ld\s+\[wJoyIgnore\]\s*,\s*a\s*$/i.test(clean);
    if (joyIgnoreStore) {
      const symbolic = movementLabelAlternativesAtCall(
        section.source,
        index,
        "a",
      ).map((alternative) => ({
        value: alternative.label,
        conditions: alternative.conditions,
        confidence: alternative.confidence,
      }));
      const single = symbolic.length === 1 ? symbolic[0] : null;
      const restoring = single?.value === "0";
      nodes.push({
        id: `${section.label}:${absoluteLine}:player-input`,
        type: "control",
        kind: "control",
        title: restoring ? "Restore player controls" : "Restrict player controls",
        control: "player-input",
        value: single?.value,
        alternatives: symbolic.length > 1 ? symbolic : undefined,
        description: restoring
          ? "Allow normal player input again."
          : "Ignore the listed inputs while this scripted scene is running.",
        source: sourceSpan(
          section,
          lines,
          index,
          index,
          symbolic.length > 0
            && symbolic.every((alternative) => alternative.confidence === "exact")
            ? "exact"
            : "inferred",
        ),
      });
      continue;
    }

    if (/^ld\s+\[wDoNotWaitForButtonPressAfterDisplayingText\]\s*,\s*a\s*$/i.test(clean)) {
      const symbolic = movementLabelAlternativesAtCall(
        section.source,
        index,
        "a",
      ).map((alternative) => ({
        value: alternative.label,
        conditions: alternative.conditions,
        confidence: alternative.confidence,
      }));
      const single = symbolic.length === 1 ? symbolic[0] : null;
      const enabled = single?.value !== "0";
      nodes.push({
        id: `${section.label}:${absoluteLine}:dialogue-auto-advance`,
        type: "control",
        kind: "control",
        title: enabled
          ? "Auto-advance the next dialogue"
          : "Wait normally after dialogue",
        control: "dialogue-auto-advance",
        value: single?.value,
        alternatives: symbolic.length > 1 ? symbolic : undefined,
        description: enabled
          ? "Do not wait for a button press after the next displayed text."
          : "Restore the normal wait-for-button behavior after dialogue.",
        source: sourceSpan(section, lines, index, index, "inferred"),
      });
      continue;
    }

    if (/^ldh?\s+\[hJoyHeld\]\s*,\s*a\s*$/i.test(clean)) {
      const symbolic = movementLabelAlternativesAtCall(
        section.source,
        index,
        "a",
      );
      if (symbolic.length === 1 && symbolic[0].label === "0") {
        nodes.push({
          id: `${section.label}:${absoluteLine}:clear-held-input`,
          type: "control",
          kind: "control",
          title: "Clear held player input",
          control: "held-input",
          value: "0",
          description: "Discard any held button state before continuing the scene.",
          source: sourceSpan(section, lines, index, index, "inferred"),
        });
        continue;
      }
    }

    const flagMutation = clean.match(
      /^(set|res)\s+([A-Za-z_][A-Za-z0-9_]*)\s*,\s*\[hl\]\s*$/i,
    );
    if (flagMutation) {
      const variable = recentRegisterValue(lines, index, "hl", 5);
      if (variable?.startsWith("w")) {
        nodes.push({
          id: `${section.label}:${absoluteLine}:${flagMutation[1].toLowerCase()}-flag`,
          type: "flag",
          kind: "flag",
          title: flagMutation[1].toLowerCase() === "set"
            ? "Set engine state flag"
            : "Clear engine state flag",
          variable,
          flag: flagMutation[2],
          action: flagMutation[1].toLowerCase() === "set" ? "set" : "clear",
          source: sourceSpan(section, lines, Math.max(1, index - 1), index),
        });
        continue;
      }
    }

    if (/^call\s+EngageMapTrainer\b/i.test(clean)) {
      nodes.push({
        id: `${section.label}:${absoluteLine}:engage-trainer`,
        type: "opponent",
        kind: "battle",
        title: "Engage selected map trainer",
        description: "Hand the current trainer interaction to the battle flow.",
        source: sourceSpan(section, lines, index),
      });
      continue;
    }

    if (/^call\s+InitBattleEnemyParameters\b/i.test(clean)) {
      nodes.push({
        id: `${section.label}:${absoluteLine}:init-battle`,
        type: "opponent",
        kind: "battle",
        title: "Initialize battle encounter",
        description: "Prepare the selected opponent and trainer-party state for battle.",
        opponent: recentRegisterValue(lines, index, "a", 8) ?? undefined,
        source: sourceSpan(section, lines, index, index, "inferred"),
      });
      continue;
    }

    if (/^call\s+TalkToTrainer\b/i.test(clean)) {
      nodes.push({
        id: `${section.label}:${absoluteLine}:talk-trainer`,
        type: "service",
        kind: "battle",
        title: "Run trainer interaction",
        service: "trainer-interaction",
        description: "Use the selected trainer header for before-battle, battle, and post-battle behavior.",
        source: sourceSpan(section, lines, index),
      });
      continue;
    }

    if (/^call\s+PlayCry\b/i.test(clean)) {
      nodes.push({
        id: `${section.label}:${absoluteLine}:cry`,
        type: "music",
        kind: "music",
        title: "Play Pokémon cry",
        music: recentRegisterValue(lines, index, "a", 8) ?? undefined,
        source: sourceSpan(section, lines, index, index, "inferred"),
      });
      continue;
    }

    if (/^predef\s+FlagActionPredef\b/i.test(clean)) {
      nodes.push({
        id: `${section.label}:${absoluteLine}:indexed-flag-action`,
        type: "indexed-event",
        kind: "event",
        title: "Apply indexed event action",
        action: "flag-action",
        baseEvent: recentRegisterValue(lines, index, "hl", 8) ?? "indexed event family",
        mode: recentRegisterValue(lines, index, "b", 8) ?? undefined,
        description: "Test, set, or clear the runtime-selected member of an indexed event family.",
        source: sourceSpan(section, lines, index, index, "inferred"),
      });
      continue;
    }

    if (/^call\s+ForceBikeOrSurf\b/i.test(clean)) {
      nodes.push({
        id: `${section.label}:${absoluteLine}:force-bike-surf`,
        type: "service",
        kind: "control",
        title: "Force bike or surf movement mode",
        service: "forced-travel",
        description: "Apply the map's required bike/surf movement state before normal control continues.",
        source: sourceSpan(section, lines, index),
      });
      continue;
    }

    if (/^call\s+GiveItem\b/i.test(clean)) {
      const pair = recentLbBcPair(lines, index, 8);
      nodes.push({
        id: `${section.label}:${absoluteLine}:give-item`,
        type: "item",
        kind: "item",
        title: "Give item",
        action: "give-item",
        item: pair?.b,
        quantity: pair?.c,
        description: "Add this reward to the player's Bag; the caller may branch if the Bag is full.",
        source: sourceSpan(section, lines, index, index, pair ? "inferred" : "exact"),
      });
      continue;
    }

    if (/^call\s+GivePokemon\b/i.test(clean)) {
      const pair = recentLbBcPair(lines, index, 8);
      nodes.push({
        id: `${section.label}:${absoluteLine}:give-pokemon`,
        type: "item",
        kind: "item",
        title: "Give Pokémon",
        action: "give-pokemon",
        species: pair?.b,
        level: pair?.c,
        description: "Give the selected Pokémon to the player.",
        source: sourceSpan(section, lines, index, index, pair ? "inferred" : "exact"),
      });
      continue;
    }

    if (/^call\s+IsItemInBag\b/i.test(clean)) {
      nodes.push({
        id: `${section.label}:${absoluteLine}:check-item`,
        type: "item",
        kind: "condition",
        title: "Check whether the player has an item",
        action: "check-item",
        item: recentRegisterValue(lines, index, "b", 6) ?? undefined,
        source: sourceSpan(section, lines, index, index, "inferred"),
      });
      continue;
    }

    if (/^call\s+HasEnoughMoney\b/i.test(clean)) {
      nodes.push({
        id: `${section.label}:${absoluteLine}:check-money`,
        type: "economy",
        kind: "economy",
        title: "Check whether the player can afford the cost",
        action: "check-money",
        source: sourceSpan(section, lines, index),
      });
      continue;
    }

    if (/^call\s+HasEnoughCoins\b/i.test(clean)) {
      nodes.push({
        id: `${section.label}:${absoluteLine}:check-coins`,
        type: "economy",
        kind: "economy",
        title: "Check whether the player has enough coins",
        action: "check-coins",
        source: sourceSpan(section, lines, index),
      });
      continue;
    }

    if (/^call\s+Has9990Coins\b/i.test(clean)) {
      nodes.push({
        id: `${section.label}:${absoluteLine}:check-coin-cap`,
        type: "economy",
        kind: "economy",
        title: "Check whether the Coin Case is near its limit",
        action: "check-coin-cap",
        source: sourceSpan(section, lines, index),
      });
      continue;
    }

    if (/^call\s+DisplayPartyMenu\b/i.test(clean)) {
      nodes.push({
        id: `${section.label}:${absoluteLine}:party-menu`,
        type: "party",
        kind: "party",
        title: "Choose a party Pokémon",
        action: "select",
        source: sourceSpan(section, lines, index),
      });
      continue;
    }

    if (/^call\s+GetPartyMonName\b/i.test(clean)) {
      nodes.push({
        id: `${section.label}:${absoluteLine}:party-name`,
        type: "party",
        kind: "party",
        title: "Read the selected Pokémon's name",
        action: "read-name",
        source: sourceSpan(section, lines, index),
      });
      continue;
    }

    if (/^call\s+DisplayPokedex\b/i.test(clean)) {
      nodes.push({
        id: `${section.label}:${absoluteLine}:pokedex`,
        type: "service",
        kind: "service",
        title: "Show Pokédex entry",
        service: "pokedex",
        source: sourceSpan(section, lines, index),
      });
      continue;
    }

    if (/^predef\s+DisplayElevatorFloorMenu\b/i.test(clean)) {
      nodes.push({
        id: `${section.label}:${absoluteLine}:elevator`,
        type: "service",
        kind: "service",
        title: "Choose elevator destination",
        service: "elevator",
        source: sourceSpan(section, lines, index),
      });
      continue;
    }

    if (/^predef\s+OaksAideScript\b/i.test(clean)) {
      nodes.push({
        id: `${section.label}:${absoluteLine}:oaks-aide`,
        type: "service",
        kind: "service",
        title: "Run Oak's aide reward check",
        service: "oaks-aide",
        source: sourceSpan(section, lines, index),
      });
      continue;
    }

    if (/^predef\s+DoInGameTradeDialogue\b/i.test(clean)) {
      nodes.push({
        id: `${section.label}:${absoluteLine}:trade`,
        type: "service",
        kind: "service",
        title: "Run in-game trade interaction",
        service: "trade",
        source: sourceSpan(section, lines, index),
      });
      continue;
    }

    if (/^call\s+YesNoChoice\b/i.test(clean)) {
      nodes.push({
        id: `${section.label}:${absoluteLine}:yes-no`,
        type: "service",
        kind: "condition",
        title: "Ask the player to choose Yes or No",
        service: "yes-no",
        source: sourceSpan(section, lines, index),
      });
      continue;
    }

    if (/^call\s+Random\b/i.test(clean)) {
      nodes.push({
        id: `${section.label}:${absoluteLine}:random`,
        type: "service",
        kind: "condition",
        title: "Choose a random branch",
        service: "random",
        source: sourceSpan(section, lines, index),
      });
      continue;
    }

    if (/^call\s+StopAllMusic\b/i.test(clean)) {
      nodes.push({
        id: `${section.label}:${absoluteLine}:stop-music`,
        type: "music",
        kind: "music",
        title: "Stop music",
        description: "Silence the current music before the scene changes tracks.",
        source: sourceSpan(section, lines, index),
      });
      continue;
    }

    if (/^call\s+GBFadeOutToBlack\b/i.test(clean)) {
      nodes.push({
        id: `${section.label}:${absoluteLine}:fade-out`,
        type: "screen",
        kind: "screen",
        title: "Fade screen to black",
        action: "fade-out",
        source: sourceSpan(section, lines, index),
      });
      continue;
    }

    if (/^call\s+GBFadeInFromBlack\b/i.test(clean)) {
      nodes.push({
        id: `${section.label}:${absoluteLine}:fade-in`,
        type: "screen",
        kind: "screen",
        title: "Fade screen back in",
        action: "fade-in",
        source: sourceSpan(section, lines, index),
      });
      continue;
    }

    if (/^call\s+CheckBoulderCoords\b/i.test(clean)) {
      nodes.push({
        id: `${section.label}:${absoluteLine}:check-boulder-target`,
        type: "object-puzzle",
        kind: "condition",
        title: "Check pushed boulder destination",
        action: "check-boulder-target",
        coordinates: recentRegisterValue(lines, index, "hl", 6) ?? undefined,
        description: "Match the boulder that was just pushed against this puzzle's switch or hole coordinates.",
        source: sourceSpan(section, lines, index, index, "inferred"),
      });
      continue;
    }

    if (/^(?:call|jp)\s+IsPlayerOnDungeonWarp\b/i.test(clean)) {
      nodes.push({
        id: `${section.label}:${absoluteLine}:dungeon-warp`,
        type: "warp",
        kind: "map",
        title: "Check dungeon warp or fall hole",
        action: "dungeon-warp-check",
        destinationMap: loadedValueBeforeStore(
          lines,
          index,
          /^ld\s+\[wDungeonWarpDestinationMap\]\s*,\s*a\b/i,
          14,
        ) ?? undefined,
        coordinates: recentRegisterValue(lines, index, "hl", 8) ?? undefined,
        description: "If the player is standing on one of these dungeon-warp coordinates, transition to the configured destination map.",
        source: sourceSpan(section, lines, index, index, "inferred"),
      });
      continue;
    }

    if (/^call\s+StartSimulatingJoypadStates\b/i.test(clean)) {
      const symbolicAlternatives = playerMovementAlternativesAtCall(
        section.source,
        index,
      );
      const alternatives = symbolicAlternatives.map((alternative) => {
        if (alternative.label) {
          const movement = movementSource(sections, section, alternative.label);
          return {
            pathLabel: alternative.label,
            path: movement
              ? parseMovementPath(
                  alternative.label,
                  movement,
                  movementVocabulary,
                  "joypad",
                ).steps
              : [],
            conditions: alternative.conditions,
            confidence: alternative.confidence,
          } satisfies MapScriptMovementAlternative;
        }

        const inlineSource = alternative.values
          .map((value) => `db ${value}`)
          .join("\n");
        return {
          pathLabel: "Prepared joypad movement",
          path: parseMovementPath(
            "Prepared joypad movement",
            inlineSource,
            movementVocabulary,
            "joypad",
          ).steps,
          conditions: alternative.conditions,
          confidence: alternative.confidence,
        } satisfies MapScriptMovementAlternative;
      });

      if (alternatives.length === 0) {
        let movementLabel: string | null = null;
        let coordinateTableLabel: string | null = null;
        for (let back = index - 1; back >= Math.max(1, index - 20); back -= 1) {
          const prior = withoutComment(lines[back]);
          if (/^call\s+DecodeRLEList\b/i.test(prior)) {
            movementLabel = recentRegisterValue(lines, back, "de", 6);
            break;
          }
          if (/^call\s+DecodeArrowMovementRLE\b/i.test(prior)) {
            coordinateTableLabel = recentRegisterValue(lines, back, "hl", 8);
            break;
          }
        }

        if (coordinateTableLabel) {
          alternatives.push(
            ...coordinateMovementAlternatives(
              sections,
              section,
              coordinateTableLabel,
              movementVocabulary,
            ),
          );
        } else if (movementLabel) {
          const movement = movementSource(sections, section, movementLabel);
          alternatives.push({
            pathLabel: movementLabel,
            path: movement
              ? parseMovementPath(
                  movementLabel,
                  movement,
                  movementVocabulary,
                  "joypad",
                ).steps
              : [],
            conditions: [],
            confidence: "inferred",
          });
        }
      }

      const single = alternatives.length === 1 ? alternatives[0] : null;
      nodes.push({
        id: `${section.label}:${absoluteLine}:move-player`,
        type: "movement",
        kind: "movement",
        title: "Move the player automatically",
        actor: "player",
        pathLabel: single?.pathLabel,
        path: single?.path ?? [],
        alternatives,
        dynamic: alternatives.length === 0
          || alternatives.some((alternative) => alternative.path.length === 0),
        description: alternatives.length > 1
          ? "The player's automatic movement depends on earlier script conditions."
          : alternatives.length === 0
            ? "Temporarily controls the player's movement."
            : undefined,
        source: sourceSpan(
          section,
          lines,
          index,
          index,
          alternatives.length > 0
            && alternatives.every((alternative) => alternative.confidence === "exact")
            ? "exact"
            : "inferred",
        ),
      });
      continue;
    }

    const customMovementCall = clean.match(/^call\s+([A-Za-z_][A-Za-z0-9_]*)\b/i);
    const customMovementConsumer = customMovementCall
      ? movementVocabulary?.consumers.find(
          (consumer) => consumer.routine === customMovementCall[1],
        )
      : undefined;
    if (customMovementCall && customMovementConsumer) {
      const symbolicAlternatives = movementLabelAlternativesAtCall(
        section.source,
        index,
        customMovementConsumer.register,
      );
      const alternatives = symbolicAlternatives.map((alternative) => {
        const movement = movementSource(sections, section, alternative.label);
        return {
          pathLabel: alternative.label,
          path: movement
            ? parseMovementPath(
                alternative.label,
                movement,
                movementVocabulary,
                "custom",
                customMovementConsumer.routine,
              ).steps
            : [],
          conditions: alternative.conditions,
          confidence: alternative.confidence,
        } satisfies MapScriptMovementAlternative;
      });

      const single = alternatives.length === 1 ? alternatives[0] : null;
      nodes.push({
        id: `${section.label}:${absoluteLine}:custom-movement`,
        type: "movement",
        kind: "movement",
        title: "Run scripted character movement",
        actor: "character",
        pathLabel: single?.pathLabel,
        path: single?.path ?? [],
        alternatives,
        guards: customMovementConsumer.guards,
        dynamic: alternatives.length === 0
          || alternatives.some((alternative) => alternative.path.length === 0)
          || customMovementConsumer.guards.length > 0,
        description: customMovementConsumer.guards.length > 0
          ? "This project-defined movement only runs when its wrapper guard conditions are satisfied."
          : alternatives.length > 1
            ? "The selected project-defined movement path depends on earlier script conditions."
            : "This movement vocabulary was derived from the loaded project.",
        source: sourceSpan(
          section,
          lines,
          index,
          index,
          alternatives.length > 0
            && alternatives.every((alternative) => alternative.confidence === "exact")
            ? "exact"
            : "inferred",
        ),
      });
      continue;
    }

    if (/^call\s+MoveSprite\b/i.test(clean)) {
      const actor = loadedValueBeforeStore(lines, index, /^ldh?\s+\[hSpriteIndex\]\s*,\s*a\b/i);
      const symbolicAlternatives = movementLabelAlternativesAtCall(section.source, index);
      const alternatives = symbolicAlternatives.map((alternative) => {
        const movement = movementSource(sections, section, alternative.label);
        return {
          pathLabel: alternative.label,
          path: movement ? parseMovementPath(alternative.label, movement, movementVocabulary, "npc").steps : [],
          conditions: alternative.conditions,
          confidence: alternative.confidence,
        } satisfies MapScriptMovementAlternative;
      });
      const fallbackLabel = recentRegisterValue(lines, index, "de", 10);
      if (alternatives.length === 0 && fallbackLabel) {
        const movement = movementSource(sections, section, fallbackLabel);
        alternatives.push({
          pathLabel: fallbackLabel,
          path: movement ? parseMovementPath(fallbackLabel, movement, movementVocabulary, "npc").steps : [],
          conditions: [],
          confidence: "inferred",
        });
      }

      const single = alternatives.length === 1 ? alternatives[0] : null;
      nodes.push({
        id: `${section.label}:${absoluteLine}:move-character`,
        type: "movement",
        kind: "movement",
        title: "Move character",
        actor: "character",
        actorConstant: actor ?? undefined,
        pathLabel: single?.pathLabel,
        path: single?.path ?? [],
        alternatives,
        dynamic: alternatives.length === 0
          || alternatives.some((alternative) =>
            alternative.path.length === 0
            || /^w[A-Za-z0-9_]+$/.test(alternative.pathLabel)
          ),
        description: alternatives.length > 1
          ? "The selected movement path depends on earlier script conditions."
          : undefined,
        source: sourceSpan(
          section,
          lines,
          index,
          index,
          alternatives.every((alternative) => alternative.confidence === "exact")
            ? "exact"
            : "inferred",
        ),
      });
      continue;
    }

    if (/^call\s+SetSpriteFacingDirectionAndDelay\b/i.test(clean)) {
      const actor = loadedValueBeforeStore(lines, index, /^ldh?\s+\[hSpriteIndex\]\s*,\s*a\b/i);
      const facing = loadedValueBeforeStore(lines, index, /^ldh?\s+\[hSpriteFacingDirection\]\s*,\s*a\b/i);
      nodes.push({
        id: `${section.label}:${absoluteLine}:facing`,
        type: "facing",
        kind: "facing",
        title: "Turn character",
        actor: actor ?? undefined,
        facing: facing ?? undefined,
        source: sourceSpan(section, lines, index),
      });
      continue;
    }

    const directFacingStore = clean.match(
      /^ld\s+\[wSprite([0-9A-F]+)StateData1FacingDirection\]\s*,\s*a\s*$/i,
    );
    if (directFacingStore) {
      const symbolic = movementLabelAlternativesAtCall(
        section.source,
        index,
        "a",
      ).map((alternative) => ({
        value: alternative.label,
        conditions: alternative.conditions,
        confidence: alternative.confidence,
      }));
      const single = symbolic.length === 1 ? symbolic[0] : null;
      nodes.push({
        id: `${section.label}:${absoluteLine}:direct-facing`,
        type: "facing",
        kind: "facing",
        title: "Turn character",
        actor: `SPRITE_SLOT_${directFacingStore[1]}`,
        facing: single?.value,
        alternatives: symbolic,
        description: symbolic.length > 1
          ? "The facing direction depends on earlier script conditions."
          : "This script writes the sprite's facing direction directly.",
        source: sourceSpan(
          section,
          lines,
          index,
          index,
          symbolic.every((alternative) => alternative.confidence === "exact")
            ? "exact"
            : "inferred",
        ),
      });
      continue;
    }

    if (/^call\s+SaveEndBattleTextPointers\b/i.test(clean)) {
      nodes.push({
        id: `${section.label}:${absoluteLine}:battle-dialogue`,
        type: "battle-dialogue",
        kind: "outcome",
        title: "Prepare end-of-battle dialogue",
        description: "Save both possible messages now; the battle engine chooses the correct one after the battle ends.",
        playerWins: recentRegisterValue(lines, index, "hl", 12) ?? undefined,
        playerLoses: recentRegisterValue(lines, index, "de", 12) ?? undefined,
        source: sourceSpan(section, lines, Math.max(1, index - 2), index),
      });
      continue;
    }

    if (/^ld\s+\[wCurOpponent\]\s*,\s*a\b/i.test(clean)) {
      let trainerNo: string | undefined;
      let sourceEnd = index;
      for (let probe = index + 1; probe <= Math.min(lines.length - 1, index + 8); probe += 1) {
        if (!/^ld\s+\[wTrainerNo\]\s*,\s*a\b/i.test(withoutComment(lines[probe]))) {
          continue;
        }
        const alternatives = movementLabelAlternativesAtCall(
          section.source,
          probe,
          "a",
        );
        if (alternatives.length === 1) trainerNo = alternatives[0].label;
        sourceEnd = probe;
        break;
      }
      nodes.push({
        id: `${section.label}:${absoluteLine}:opponent`,
        type: "opponent",
        kind: "battle",
        title: "Choose trainer opponent",
        description: "Prepare the trainer encounter. The battle engine starts after this map script returns.",
        opponent: recentRegisterValue(lines, index, "a", 6) ?? undefined,
        trainerNo,
        source: sourceSpan(section, lines, Math.max(1, index - 1), sourceEnd),
      });
      continue;
    }

    const displayTextCall = clean.match(/^call\s+([A-Za-z0-9_]*DisplayTextID[A-Za-z0-9_]*)\b/i);
    if (displayTextCall) {
      const textLabel = recentRegisterValue(lines, index, "a", 8);
      nodes.push({
        id: `${section.label}:${absoluteLine}:dialogue`,
        type: "dialogue",
        kind: "dialogue",
        title: "Show dialogue",
        textLabel: textLabel?.startsWith("TEXT_") ? textLabel : undefined,
        source: sourceSpan(section, lines, index, index, displayTextCall[1] === "DisplayTextID" ? "exact" : "inferred"),
      });
      continue;
    }

    if (/^call\s+PrintText\b/i.test(clean)) {
      nodes.push({
        id: `${section.label}:${absoluteLine}:dialogue`,
        type: "dialogue",
        kind: "dialogue",
        title: "Show dialogue",
        textLabel: recentRegisterValue(lines, index, "hl", 8) ?? undefined,
        source: sourceSpan(section, lines, index),
      });
      continue;
    }

    if (/^call\s+Delay3\b/i.test(clean)) {
      nodes.push({
        id: `${section.label}:${absoluteLine}:delay`,
        type: "wait",
        kind: "wait",
        title: "Brief pause",
        source: sourceSpan(section, lines, index),
      });
      continue;
    }

    if (/^call\s+DelayFrames\b/i.test(clean)) {
      const frames = parseNumber(recentRegisterValue(lines, index, "c", 4));
      nodes.push({
        id: `${section.label}:${absoluteLine}:delay-frames`,
        type: "wait",
        kind: "wait",
        title: frames === null ? "Wait" : `Wait ${frames} frame${frames === 1 ? "" : "s"}`,
        frames: frames ?? undefined,
        source: sourceSpan(section, lines, index),
      });
      continue;
    }

    if (/^call\s+PlayDefaultMusic\b/i.test(clean)) {
      nodes.push({
        id: `${section.label}:${absoluteLine}:default-music`,
        type: "music",
        kind: "music",
        title: "Return to map music",
        source: sourceSpan(section, lines, index),
      });
      continue;
    }

    if (/^call\s+PlayMusic\b/i.test(clean) || /^farcall\s+Music_/i.test(clean)) {
      const routine = clean.match(/^farcall\s+(Music_[A-Za-z0-9_]+)/i)?.[1];
      nodes.push({
        id: `${section.label}:${absoluteLine}:music`,
        type: "music",
        kind: "music",
        title: "Play music",
        music: routine ?? recentRegisterValue(lines, index, "a", 8) ?? undefined,
        source: sourceSpan(section, lines, index),
      });
      continue;
    }

    if (/^(?:predef|predef_jump)\s+ReplaceTileBlock\b/i.test(clean)) {
      const coords = recentLbBcPair(lines, index, 10);
      nodes.push({
        id: `${section.label}:${absoluteLine}:replace-tile-block`,
        type: "map-edit",
        kind: "map",
        title: "Replace map tile block",
        action: "replace-tile-block",
        block: loadedValueBeforeStore(
          lines,
          index,
          /^ld\s+\[wNewTileBlockID\]\s*,\s*a\b/i,
        ) ?? undefined,
        x: coords?.b,
        y: coords?.c,
        description: "Change one map block in the loaded map.",
        source: sourceSpan(section, lines, Math.max(1, index - 3), index),
      });
      continue;
    }

    const objectWrapperCall = clean.match(/^call\s+([A-Za-z_][A-Za-z0-9_]*)\b/i)?.[1];
    const objectWrapperAction = objectWrapperCall
      ? objectWrappers.get(objectWrapperCall)
      : undefined;
    if (objectWrapperCall && objectWrapperAction) {
      const symbolic = movementLabelAlternativesAtCall(
        section.source,
        index,
        "a",
      ).map((alternative) => ({
        value: alternative.label,
        conditions: alternative.conditions,
        confidence: alternative.confidence,
      }));
      const single = symbolic.length === 1 ? symbolic[0] : null;
      nodes.push({
        id: `${section.label}:${absoluteLine}:${objectWrapperAction}-object-wrapper`,
        type: "object",
        kind: "object",
        title: `${objectWrapperAction === "show" ? "Show" : "Hide"} character or object`,
        action: objectWrapperAction,
        object: single?.value ?? recentRegisterValue(lines, index, "a", 6) ?? undefined,
        alternatives: symbolic.length > 1 ? symbolic : undefined,
        description: `This action is performed through project helper ${objectWrapperCall}.`,
        source: sourceSpan(section, lines, index, index, "inferred"),
      });
      continue;
    }

    const objectAction = clean.match(/^predef\s+(ShowObject|HideObject)\b/i)?.[1];
    if (objectAction) {
      const action = objectAction.toLowerCase().startsWith("show") ? "show" : "hide";
      let storeIndex = -1;
      for (let probe = index - 1; probe >= Math.max(1, index - 10); probe -= 1) {
        if (/^ld\s+\[wToggleableObjectIndex\]\s*,\s*a\b/i.test(withoutComment(lines[probe]))) {
          storeIndex = probe;
          break;
        }
      }
      const symbolic = storeIndex >= 0
        ? movementLabelAlternativesAtCall(section.source, storeIndex, "a").map((alternative) => ({
            value: alternative.label,
            conditions: alternative.conditions,
            confidence: alternative.confidence,
          }))
        : [];
      const single = symbolic.length === 1 ? symbolic[0] : null;
      nodes.push({
        id: `${section.label}:${absoluteLine}:${action}-object`,
        type: "object",
        kind: "object",
        title: `${action === "show" ? "Show" : "Hide"} character or object`,
        action,
        object: single?.value
          ?? loadedValueBeforeStore(lines, index, /^ld\s+\[wToggleableObjectIndex\]\s*,\s*a\b/i)
          ?? undefined,
        alternatives: symbolic.length > 1 ? symbolic : undefined,
        description: symbolic.length > 1
          ? "The selected object depends on earlier script conditions."
          : undefined,
        source: sourceSpan(
          section,
          lines,
          storeIndex >= 0 ? storeIndex : index,
          index,
          symbolic.length > 0
            && symbolic.every((alternative) => alternative.confidence === "exact")
            ? "exact"
            : "inferred",
        ),
      });
      continue;
    }

    if (/^predef\s+HealParty\b/i.test(clean)) {
      nodes.push({
        id: `${section.label}:${absoluteLine}:heal-party`,
        type: "recovery",
        kind: "recovery",
        title: "Heal the player's party",
        source: sourceSpan(section, lines, index),
      });
      continue;
    }

    if (/^ld\s+a\s*,\s*\[wBattleResult\]/i.test(clean)) {
      nodes.push({
        id: `${section.label}:${absoluteLine}:battle-result`,
        type: "condition",
        kind: "condition",
        title: "Check battle result",
        condition: "Later behavior depends on whether the player won or lost",
        source: sourceSpan(section, lines, index),
      });
    }
  }

  return nodes;
}

export function parseMapScriptProgram(
  source: string,
  focusLabel?: string,
  movementVocabulary?: ProjectMovementVocabulary,
  eventMacroSemantics: ProjectEventMacroSemantic[] = [],
): MapScriptProgram {
  const sectionList = globalLabelSections(source);
  const sections = new Map(sectionList.map((section) => [section.label, section]));
  const pointers = scriptPointers(source);
  const constantByLabel = new Map([...pointers.entries()].map(([constant, label]) => [label, constant]));
  const pointerLabels = [...pointers.values()];
  const labels = new Set<string>(pointerLabels);
  if (focusLabel && sections.has(focusLabel)) labels.add(focusLabel);
  const setterLabels = scriptStateSetterLabels(sections);
  const objectWrappers = objectWrapperActions(sections);
  const eventMacros = new Map(
    eventMacroSemantics.map((semantic) => [semantic.name.toLowerCase(), semantic]),
  );

  const states: MapScriptState[] = [...labels].map((label) => {
    const section = sections.get(label);
    if (!section) {
      return {
        label,
        scriptConstant: constantByLabel.get(label) ?? null,
        startLine: 0,
        source: "",
        external: true,
        nodes: [],
        transitions: [],
        predecessorLabels: [],
      };
    }

    const pointerIndex = pointerLabels.indexOf(label);
    const sectionIndex = sectionList.findIndex(
      (candidate) => candidate.label === section.label,
    );
    const physicalNextLabel = sectionIndex >= 0
      ? sectionList[sectionIndex + 1]?.label ?? null
      : null;
    const declaredNextLabel = pointerIndex >= 0
      ? pointerLabels[pointerIndex + 1] ?? null
      : null;
    const nextStateLabel = physicalNextLabel === declaredNextLabel
      ? declaredNextLabel
      : null;
    const transitions = transitionsForSection(
      section,
      pointers,
      setterLabels,
      nextStateLabel,
    );
    return {
      label: section.label,
      scriptConstant: constantByLabel.get(section.label) ?? null,
      startLine: section.startLine,
      source: section.source,
      external: false,
      nodes: nodesForSection(
        section,
        sections,
        transitions,
        objectWrappers,
        eventMacros,
        movementVocabulary,
      ),
      transitions,
      predecessorLabels: [],
    };
  });

  const byLabel = new Map(states.map((state) => [state.label, state]));
  for (const state of states) {
    for (const transition of state.transitions) {
      const target = transition.targetLabel ? byLabel.get(transition.targetLabel) : null;
      if (target && !target.predecessorLabels.includes(state.label)) target.predecessorLabels.push(state.label);
    }
  }

  return { states };
}

export function focusedMapScriptStates(
  program: MapScriptProgram,
  focusLabel: string,
  before = 1,
  after = 1,
): MapScriptState[] {
  const byLabel = new Map(program.states.map((state) => [state.label, state]));
  const focus = byLabel.get(focusLabel);
  if (!focus) return [];

  const previous: MapScriptState[] = [];
  let cursor = focus;
  for (let depth = 0; depth < before; depth += 1) {
    if (cursor.predecessorLabels.length !== 1) break;
    const predecessor = byLabel.get(cursor.predecessorLabels[0]);
    if (!predecessor || previous.some((state) => state.label === predecessor.label)) break;
    previous.unshift(predecessor);
    cursor = predecessor;
  }

  const next: MapScriptState[] = [];
  cursor = focus;
  for (let depth = 0; depth < after; depth += 1) {
    const targets = cursor.transitions
      .map((transition) => transition.targetLabel)
      .filter((label): label is string => Boolean(label));
    const uniqueTargets = [...new Set(targets)];
    if (uniqueTargets.length !== 1) break;
    const target = byLabel.get(uniqueTargets[0]);
    if (!target || next.some((state) => state.label === target.label)) break;
    next.push(target);
    cursor = target;
  }

  return [...previous, focus, ...next];
}
