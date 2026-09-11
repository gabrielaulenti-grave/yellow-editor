import { parseMovementPath } from "./mapScriptParser";
import type { MapMovementStep, MapScriptOperationKind } from "./mapScriptOpcodes";

export type MapScriptConfidence = "exact" | "inferred";

export interface MapScriptSourceSpan {
  lineStart: number;
  lineEnd: number;
  raw: string;
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
    })
  | (BaseNode & {
      type: "wait";
      frames?: number;
      reason?: string;
    })
  | (BaseNode & {
      type: "event";
      action: "check" | "set" | "reset";
      event: string;
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
    })
  | (BaseNode & {
      type: "music";
      music?: string;
    })
  | (BaseNode & {
      type: "facing";
      actor?: string;
      facing?: string;
    })
  | (BaseNode & {
      type: "recovery";
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
  register: "a" | "c" | "de" | "hl",
  maxBack = 12,
): string | null {
  const pattern = new RegExp(`^ld\\s+${register}\\s*,\\s*([^\\s;]+)\\b`, "i");
  for (let index = beforeIndex - 1; index >= Math.max(0, beforeIndex - maxBack); index -= 1) {
    const value = withoutComment(lines[index]).match(pattern)?.[1];
    if (value) return value;
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

function movementSource(sections: Map<string, LabelSection>, label: string): string | null {
  return sections.get(label)?.source ?? null;
}

function transitionsForSection(
  section: LabelSection,
  pointers: Map<string, string>,
): MapScriptStateTransition[] {
  const lines = section.source.split(/\r?\n/);
  const transitions: MapScriptStateTransition[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const constant = withoutComment(lines[index]).match(/^ld\s+a\s*,\s*(SCRIPT_[A-Z0-9_]+)\b/i)?.[1];
    if (!constant) continue;
    for (let next = index + 1; next <= Math.min(lines.length - 1, index + 4); next += 1) {
      if (/^ld\s+\[w[A-Za-z0-9_]*CurScript\]\s*,\s*a\b/i.test(withoutComment(lines[next]))) {
        transitions.push({
          targetConstant: constant,
          targetLabel: pointers.get(constant) ?? null,
          source: sourceSpan(section, lines, index, next),
        });
        break;
      }
    }
  }
  return transitions;
}

function nodesForSection(
  section: LabelSection,
  sections: Map<string, LabelSection>,
  pointers: Map<string, string>,
): MapScriptSemanticNode[] {
  const lines = section.source.split(/\r?\n/);
  const nodes: MapScriptSemanticNode[] = [];
  const transitions = transitionsForSection(section, pointers);
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

    const event = clean.match(/^(CheckEvent|SetEvent|ResetEvent)\s+([A-Z][A-Z0-9_]*)\b/i);
    if (event) {
      const action = event[1].toLowerCase().startsWith("check")
        ? "check"
        : event[1].toLowerCase().startsWith("set") ? "set" : "reset";
      nodes.push({
        id: `${section.label}:${absoluteLine}:${action}-event`,
        type: "event",
        kind: action === "check" ? "condition" : "event",
        title: action === "check" ? "Check event" : action === "set" ? "Remember that this happened" : "Clear event state",
        action,
        event: event[2],
        source: sourceSpan(section, lines, index),
      });
      continue;
    }

    if (/^call\s+StartSimulatingJoypadStates\b/i.test(clean)) {
      let movementLabel: string | null = null;
      let sourceStart = index;
      for (let back = index - 1; back >= Math.max(1, index - 16); back -= 1) {
        if (/^call\s+DecodeRLEList\b/i.test(withoutComment(lines[back]))) {
          movementLabel = recentRegisterValue(lines, back, "de", 6);
          sourceStart = Math.max(1, back - 2);
          break;
        }
      }
      const movement = movementLabel ? movementSource(sections, movementLabel) : null;
      const path = movementLabel && movement ? parseMovementPath(movementLabel, movement).steps : [];
      nodes.push({
        id: `${section.label}:${absoluteLine}:move-player`,
        type: "movement",
        kind: "movement",
        title: "Move the player automatically",
        actor: "player",
        pathLabel: movementLabel ?? undefined,
        path,
        dynamic: !movementLabel || path.length === 0,
        description: path.length === 0 ? "Temporarily controls the player's movement." : undefined,
        source: sourceSpan(section, lines, sourceStart, index, movementLabel ? "exact" : "inferred"),
      });
      continue;
    }

    if (/^call\s+MoveSprite\b/i.test(clean)) {
      const actor = loadedValueBeforeStore(lines, index, /^ldh?\s+\[hSpriteIndex\]\s*,\s*a\b/i);
      const movementLabel = recentRegisterValue(lines, index, "de", 10);
      const movement = movementLabel ? movementSource(sections, movementLabel) : null;
      const path = movementLabel && movement ? parseMovementPath(movementLabel, movement).steps : [];
      nodes.push({
        id: `${section.label}:${absoluteLine}:move-character`,
        type: "movement",
        kind: "movement",
        title: "Move character",
        actor: "character",
        actorConstant: actor ?? undefined,
        pathLabel: movementLabel ?? undefined,
        path,
        dynamic: !movementLabel || path.length === 0 || /^w[A-Za-z0-9_]+$/.test(movementLabel),
        source: sourceSpan(section, lines, index),
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
      nodes.push({
        id: `${section.label}:${absoluteLine}:opponent`,
        type: "opponent",
        kind: "battle",
        title: "Choose trainer opponent",
        description: "Prepare the trainer encounter. The battle engine starts after this map script returns.",
        opponent: recentRegisterValue(lines, index, "a", 6) ?? undefined,
        source: sourceSpan(section, lines, Math.max(1, index - 1), index),
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

    const objectAction = clean.match(/^predef\s+(ShowObject|HideObject)\b/i)?.[1];
    if (objectAction) {
      const action = objectAction.toLowerCase().startsWith("show") ? "show" : "hide";
      nodes.push({
        id: `${section.label}:${absoluteLine}:${action}-object`,
        type: "object",
        kind: "object",
        title: `${action === "show" ? "Show" : "Hide"} character or object`,
        action,
        object: loadedValueBeforeStore(lines, index, /^ld\s+\[wToggleableObjectIndex\]\s*,\s*a\b/i) ?? undefined,
        source: sourceSpan(section, lines, index),
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

export function parseMapScriptProgram(source: string, focusLabel?: string): MapScriptProgram {
  const sectionList = globalLabelSections(source);
  const sections = new Map(sectionList.map((section) => [section.label, section]));
  const pointers = scriptPointers(source);
  const constantByLabel = new Map([...pointers.entries()].map(([constant, label]) => [label, constant]));
  const labels = new Set<string>(pointers.values());
  if (focusLabel && sections.has(focusLabel)) labels.add(focusLabel);

  const states: MapScriptState[] = [...labels]
    .map((label) => sections.get(label))
    .filter((section): section is LabelSection => Boolean(section))
    .map((section) => ({
      label: section.label,
      scriptConstant: constantByLabel.get(section.label) ?? null,
      startLine: section.startLine,
      source: section.source,
      nodes: nodesForSection(section, sections, pointers),
      transitions: transitionsForSection(section, pointers),
      predecessorLabels: [],
    }));

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
