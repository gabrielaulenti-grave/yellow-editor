import type {
  MapScriptProgram,
  MapScriptSemanticNode,
  MapScriptSourceSpan,
  MapScriptState,
} from "./mapScriptProgram";

type BattleDialogueNode = Extract<MapScriptSemanticNode, { type: "battle-dialogue" }>;
type DialogueNode = Extract<MapScriptSemanticNode, { type: "dialogue" }>;
type OpponentNode = Extract<MapScriptSemanticNode, { type: "opponent" }>;

interface LabelSection {
  label: string;
  startLine: number;
  lines: string[];
}

export interface MapScriptBattleHandoff {
  id: string;
  setupStateLabel: string;
  resumeStateLabel: string;
  opponent?: string;
  playerWins?: string;
  playerLoses?: string;
  preparationSource: MapScriptSourceSpan;
  preparationNodeId?: string;
  preparationKind: "map-script" | "dialogue-wrapper";
}

function withoutComment(line: string): string {
  return line.split(";", 1)[0].trim();
}

function globalSections(source: string): Map<string, LabelSection> {
  const lines = source.split(/\r?\n/);
  const starts: Array<{ label: string; index: number }> = [];
  lines.forEach((line, index) => {
    const label = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*):{1,2}\s*(?:;.*)?$/)?.[1];
    if (label) starts.push({ label, index });
  });

  const result = new Map<string, LabelSection>();
  starts.forEach((start, index) => {
    const end = starts[index + 1]?.index ?? lines.length;
    result.set(start.label, {
      label: start.label,
      startLine: start.index + 1,
      lines: lines.slice(start.index, end),
    });
  });
  return result;
}

function textPointerLabels(source: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of source.matchAll(
    /^\s*dw_const\s+([A-Za-z_.][A-Za-z0-9_.]*)\s*,\s*(TEXT_[A-Z0-9_]+)\b/gm,
  )) {
    result.set(match[2], match[1]);
  }
  return result;
}

function recentRegisterValue(
  lines: string[],
  beforeIndex: number,
  register: "hl" | "de",
  maxBack = 16,
): string | null {
  const pattern = new RegExp(`^ld\\s+${register}\\s*,\\s*([^\\s;]+)\\b`, "i");
  for (let index = beforeIndex - 1; index >= Math.max(0, beforeIndex - maxBack); index -= 1) {
    const value = withoutComment(lines[index]).match(pattern)?.[1];
    if (value) return value;
  }
  return null;
}

function battleDialogueInSection(section: LabelSection): {
  playerWins?: string;
  playerLoses?: string;
  source: MapScriptSourceSpan;
} | null {
  for (let index = 1; index < section.lines.length; index += 1) {
    if (!/^call\s+SaveEndBattleTextPointers\b/i.test(withoutComment(section.lines[index]))) continue;
    const playerWins = recentRegisterValue(section.lines, index, "hl") ?? undefined;
    const playerLoses = recentRegisterValue(section.lines, index, "de") ?? undefined;
    if (!playerWins && !playerLoses) continue;

    let start = index;
    for (let back = index - 1; back >= Math.max(1, index - 16); back -= 1) {
      const clean = withoutComment(section.lines[back]);
      if (
        /^ld\s+hl\s*,/i.test(clean)
        || /^ld\s+de\s*,/i.test(clean)
        || /^set\s+BIT_PRINT_END_BATTLE_TEXT\b/i.test(clean)
        || /^set\s+BIT_TALKED_TO_TRAINER\b/i.test(clean)
        || /^ld\s+hl\s*,\s*wStatusFlags3\b/i.test(clean)
      ) {
        start = back;
        continue;
      }
      if (clean && start < index) break;
    }

    return {
      playerWins,
      playerLoses,
      source: {
        lineStart: section.startLine + start,
        lineEnd: section.startLine + index,
        raw: section.lines.slice(start, index + 1).join("\n"),
        confidence: "exact",
      },
    };
  }
  return null;
}

function wrapperBattleDialogue(
  state: MapScriptState,
  sections: Map<string, LabelSection>,
  pointers: Map<string, string>,
): {
  playerWins?: string;
  playerLoses?: string;
  source: MapScriptSourceSpan;
} | null {
  const dialogueNodes = state.nodes.filter(
    (node): node is DialogueNode => node.type === "dialogue" && Boolean(node.textLabel),
  );
  for (const node of dialogueNodes) {
    const textLabel = node.textLabel;
    if (!textLabel) continue;
    const wrapperLabel = textLabel.startsWith("TEXT_") ? pointers.get(textLabel) : textLabel;
    if (!wrapperLabel || wrapperLabel.startsWith(".")) continue;
    const section = sections.get(wrapperLabel);
    if (!section) continue;
    const result = battleDialogueInSection(section);
    if (result) return result;
  }
  return null;
}

function uniqueResumeState(state: MapScriptState): string | null {
  const labels = state.transitions
    .map((transition) => transition.targetLabel)
    .filter((label): label is string => Boolean(label));
  const unique = [...new Set(labels)];
  return unique.length === 1 ? unique[0] : null;
}

export function mapScriptBattleHandoffs(
  program: MapScriptProgram,
  source: string,
): MapScriptBattleHandoff[] {
  const sections = globalSections(source);
  const pointers = textPointerLabels(source);
  const handoffs: MapScriptBattleHandoff[] = [];

  for (const state of program.states) {
    const opponent = state.nodes.find((node): node is OpponentNode => node.type === "opponent");
    const resumeStateLabel = uniqueResumeState(state);
    if (!opponent || !resumeStateLabel) continue;

    const direct = state.nodes.find(
      (node): node is BattleDialogueNode => node.type === "battle-dialogue",
    );
    if (direct) {
      handoffs.push({
        id: `${state.label}:battle-handoff`,
        setupStateLabel: state.label,
        resumeStateLabel,
        opponent: opponent.opponent,
        playerWins: direct.playerWins,
        playerLoses: direct.playerLoses,
        preparationSource: direct.source,
        preparationNodeId: direct.id,
        preparationKind: "map-script",
      });
      continue;
    }

    const wrapped = wrapperBattleDialogue(state, sections, pointers);
    if (!wrapped) continue;
    handoffs.push({
      id: `${state.label}:battle-handoff`,
      setupStateLabel: state.label,
      resumeStateLabel,
      opponent: opponent.opponent,
      playerWins: wrapped.playerWins,
      playerLoses: wrapped.playerLoses,
      preparationSource: wrapped.source,
      preparationKind: "dialogue-wrapper",
    });
  }

  return handoffs;
}
