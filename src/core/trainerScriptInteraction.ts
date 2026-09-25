import { textBlockPreview } from "./textPreview";
import type { TrainerScriptReference } from "./types";

interface TextBlock {
  path: string;
  source: string;
}

interface Section {
  label: string;
  source: string;
}

interface ResolvedText {
  label: string;
  text: string | null;
  sourcePath: string | null;
}

function withoutComment(line: string): string {
  return line.split(";", 1)[0].trim();
}

function globalSections(contents: string): Section[] {
  const lines = contents.split(/\r?\n/);
  const starts: Array<{ label: string; index: number }> = [];
  lines.forEach((line, index) => {
    const label = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*):{1,2}\s*(?:;.*)?$/)?.[1];
    if (label) starts.push({ label, index });
  });
  return starts.map((start, index) => ({
    label: start.label,
    source: lines.slice(start.index, starts[index + 1]?.index ?? lines.length).join("\n"),
  }));
}

function globalBlocks(contents: string): Map<string, string> {
  return new Map(globalSections(contents).map((section) => [section.label, section.source]));
}

function localBlock(scopeSource: string, label: string): string | null {
  const lines = scopeSource.split(/\r?\n/);
  const escaped = label.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");
  const pattern = new RegExp("^\\s*" + escaped + ":{1,2}\\s*(?:;.*)?$");
  const start = lines.findIndex((line) => pattern.test(line));
  if (start < 0) return null;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\s*[A-Za-z_.][A-Za-z0-9_.]*:{1,2}\s*(?:;.*)?$/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function textPointers(source: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of source.matchAll(
    /^\s*dw_const\s+([A-Za-z_.][A-Za-z0-9_.]*)\s*,\s*(TEXT_[A-Z0-9_]+)\b/gm,
  )) {
    result.set(match[2], match[1]);
  }
  return result;
}

function scriptPointers(source: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of source.matchAll(
    /^\s*dw_const\s+([A-Za-z_][A-Za-z0-9_]*)\s*,\s*(SCRIPT_[A-Z0-9_]+)\b/gm,
  )) {
    result.set(match[2], match[1]);
  }
  return result;
}

function wrapperSource(
  reference: TrainerScriptReference,
  wrapperLabel: string,
  scopeSource: string,
): string | null {
  if (wrapperLabel.startsWith(".")) return localBlock(scopeSource, wrapperLabel);
  return globalBlocks(reference.mapScriptSource).get(wrapperLabel) ?? null;
}

function resolveWrapper(
  reference: TrainerScriptReference,
  wrapperLabel: string,
  scopeSource: string,
  textBlocks: Map<string, TextBlock>,
): ResolvedText[] {
  const source = wrapperSource(reference, wrapperLabel, scopeSource);
  const farLabels = source
    ? [...new Set(
        [...source.matchAll(/^\s*text_far\s+([A-Za-z_.][A-Za-z0-9_.]*)\b/gm)]
          .map((match) => match[1]),
      )]
    : [];
  if (farLabels.length > 0) {
    return farLabels.map((label) => {
      const block = textBlocks.get(label);
      return {
        label,
        text: block ? textBlockPreview(block.source) : null,
        sourcePath: block?.path ?? null,
      };
    });
  }

  const external = textBlocks.get(wrapperLabel);
  if (external) {
    return [{
      label: wrapperLabel,
      text: textBlockPreview(external.source),
      sourcePath: external.path,
    }];
  }

  return [{
    label: wrapperLabel,
    text: source ? textBlockPreview(source) : null,
    sourcePath: source ? reference.scriptPath : null,
  }];
}

function recentValue(
  lines: string[],
  beforeIndex: number,
  register: "a" | "hl" | "de",
  maxBack = 16,
): string | null {
  const pattern = new RegExp("^ld\\s+" + register + "\\s*,\\s*([^\\s;]+)\\b", "i");
  for (let index = beforeIndex - 1; index >= Math.max(0, beforeIndex - maxBack); index -= 1) {
    const value = withoutComment(lines[index]).match(pattern)?.[1];
    if (value) return value;
  }
  return null;
}

function eventFacts(lines: string[], beforeIndex: number): Map<string, boolean> {
  const result = new Map<string, boolean>();
  for (let index = 1; index < Math.min(beforeIndex, lines.length); index += 1) {
    const clean = withoutComment(lines[index]);
    const set = clean.match(/^SetEvent\s+([A-Z][A-Z0-9_]*)\b/i)?.[1];
    if (set) {
      result.set(set, true);
      continue;
    }
    const reset = clean.match(/^ResetEvent\s+([A-Z][A-Z0-9_]*)\b/i)?.[1];
    if (reset) result.set(reset, false);
  }
  return result;
}

function findLabelIndex(lines: string[], label: string, after: number): number | null {
  const escaped = label.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");
  const pattern = new RegExp("^\\s*" + escaped + ":{1,2}\\s*(?:;.*)?$");
  for (let index = after; index < lines.length; index += 1) {
    if (pattern.test(lines[index])) return index;
  }
  return null;
}

function selectedWrapperForFacts(
  reference: TrainerScriptReference,
  wrapperLabel: string,
  facts: Map<string, boolean>,
): { label: string; scopeSource: string } | null {
  const source = globalBlocks(reference.mapScriptSource).get(wrapperLabel);
  if (!source) return null;
  const lines = source.split(/\r?\n/);

  for (let index = 1; index < lines.length; index += 1) {
    const event = withoutComment(lines[index]).match(/^CheckEvent\s+([A-Z][A-Z0-9_]*)\b/i)?.[1];
    if (!event || !facts.has(event)) continue;

    let firstLoad = -1;
    let firstLabel: string | null = null;
    for (let next = index + 1; next <= Math.min(lines.length - 1, index + 4); next += 1) {
      const label = withoutComment(lines[next]).match(
        /^ld\s+hl\s*,\s*([A-Za-z_.][A-Za-z0-9_.]*)\b/i,
      )?.[1];
      if (label) {
        firstLoad = next;
        firstLabel = label;
        break;
      }
    }
    if (firstLoad < 0 || !firstLabel) continue;

    let branchIndex = -1;
    let branchFlag: "z" | "nz" | null = null;
    let branchTarget: string | null = null;
    for (let next = firstLoad + 1; next <= Math.min(lines.length - 1, firstLoad + 4); next += 1) {
      const match = withoutComment(lines[next]).match(
        /^jr\s+(z|nz)\s*,\s*([A-Za-z_.][A-Za-z0-9_.]*)\b/i,
      );
      if (match) {
        branchIndex = next;
        branchFlag = match[1].toLowerCase() as "z" | "nz";
        branchTarget = match[2];
        break;
      }
    }
    if (branchIndex < 0 || !branchFlag || !branchTarget) continue;

    const targetIndex = findLabelIndex(lines, branchTarget, branchIndex + 1);
    if (targetIndex === null) continue;

    let secondLabel: string | null = null;
    for (let next = branchIndex + 1; next < targetIndex; next += 1) {
      const label = withoutComment(lines[next]).match(
        /^ld\s+hl\s*,\s*([A-Za-z_.][A-Za-z0-9_.]*)\b/i,
      )?.[1];
      if (label) {
        secondLabel = label;
        break;
      }
    }
    if (!secondLabel) continue;

    const isSet = facts.get(event) === true;
    const branchTaken = branchFlag === "z" ? !isSet : isSet;
    return { label: branchTaken ? firstLabel : secondLabel, scopeSource: source };
  }
  return null;
}

function resolveTextConstant(
  reference: TrainerScriptReference,
  textConstant: string,
  scopeSource: string,
  textBlocks: Map<string, TextBlock>,
  facts: Map<string, boolean>,
): { wrapperLabel: string; resolved: ResolvedText[] } {
  const wrapper = textPointers(reference.mapScriptSource).get(textConstant);
  if (!wrapper) {
    return {
      wrapperLabel: textConstant,
      resolved: [{ label: textConstant, text: null, sourcePath: null }],
    };
  }

  const selected = selectedWrapperForFacts(reference, wrapper, facts);
  if (selected) {
    return {
      wrapperLabel: selected.label,
      resolved: resolveWrapper(reference, selected.label, selected.scopeSource, textBlocks),
    };
  }

  return {
    wrapperLabel: wrapper,
    resolved: resolveWrapper(reference, wrapper, scopeSource, textBlocks),
  };
}

function displayTargets(
  reference: TrainerScriptReference,
  section: Section,
  textBlocks: Map<string, TextBlock>,
): Array<{ wrapperLabel: string; resolved: ResolvedText[]; lineIndex: number }> {
  const result: Array<{ wrapperLabel: string; resolved: ResolvedText[]; lineIndex: number }> = [];
  const lines = section.source.split(/\r?\n/);

  for (let index = 1; index < lines.length; index += 1) {
    const clean = withoutComment(lines[index]);
    if (/^call\s+[A-Za-z0-9_]*DisplayTextID[A-Za-z0-9_]*\b/i.test(clean)) {
      const textConstant = recentValue(lines, index, "a", 8);
      if (!textConstant?.startsWith("TEXT_")) continue;
      const target = resolveTextConstant(
        reference,
        textConstant,
        section.source,
        textBlocks,
        eventFacts(lines, index),
      );
      result.push({ ...target, lineIndex: index });
      continue;
    }

    if (/^call\s+PrintText\b/i.test(clean)) {
      const label = recentValue(lines, index, "hl", 8);
      if (!label) continue;
      result.push({
        wrapperLabel: label,
        resolved: resolveWrapper(reference, label, section.source, textBlocks),
        lineIndex: index,
      });
    }
  }
  return result;
}

function battlePointers(source: string): { playerWins: string | null; playerLoses: string | null } | null {
  const lines = source.split(/\r?\n/);
  for (let index = 1; index < lines.length; index += 1) {
    if (!/^call\s+SaveEndBattleTextPointers\b/i.test(withoutComment(lines[index]))) continue;
    return {
      playerWins: recentValue(lines, index, "hl", 16),
      playerLoses: recentValue(lines, index, "de", 16),
    };
  }
  return null;
}

function addDialogue(
  reference: TrainerScriptReference,
  role: TrainerScriptReference["interaction"]["dialogues"][number]["role"],
  title: string,
  wrapperLabel: string,
  resolved: ResolvedText[],
): void {
  for (const [index, entry] of resolved.entries()) {
    if (!entry.text && !entry.sourcePath) continue;
    const id = role + ":" + wrapperLabel + ":" + entry.label + ":" + index;
    if (reference.interaction.dialogues.some((dialogue) => dialogue.id === id)) continue;
    reference.interaction.dialogues.push({
      id,
      role,
      title: index === 0 ? title : title + " — continued",
      wrapperLabel,
      textLabel: entry.label,
      text: entry.text,
      sourcePath: entry.sourcePath,
    });
  }
}

function uniqueNextState(reference: TrainerScriptReference, current: Section): Section | null {
  const pointers = scriptPointers(reference.mapScriptSource);
  const targets: string[] = [];
  const lines = current.source.split(/\r?\n/);
  for (let index = 1; index < lines.length; index += 1) {
    const constant = withoutComment(lines[index]).match(/^ld\s+a\s*,\s*(SCRIPT_[A-Z0-9_]+)\b/i)?.[1];
    if (!constant) continue;
    const window = lines.slice(index + 1, index + 5).map(withoutComment);
    if (!window.some((line) => /^ld\s+\[w[A-Za-z0-9_]*CurScript\]\s*,\s*a\b/i.test(line))) continue;
    const label = pointers.get(constant);
    if (label && !targets.includes(label)) targets.push(label);
  }
  if (targets.length !== 1) return null;
  return globalBlocks(reference.mapScriptSource).has(targets[0])
    ? globalSections(reference.mapScriptSource).find((section) => section.label === targets[0]) ?? null
    : null;
}

export function buildTrainerScriptInteraction(
  reference: TrainerScriptReference,
  textBlocks: Map<string, TextBlock>,
): TrainerScriptReference["interaction"] {
  reference.interaction = { dialogues: [], rewards: [] };
  const current = globalSections(reference.mapScriptSource)
    .find((section) => section.label === reference.routineLabel);
  if (!current) return reference.interaction;

  const currentLines = current.source.split(/\r?\n/);
  const opponentIndex = currentLines.findIndex((line) =>
    /^ld\s+\[wCurOpponent\]\s*,\s*a\b/i.test(withoutComment(line))
  );

  const currentDisplays = displayTargets(reference, current, textBlocks);
  for (const displayed of currentDisplays) {
    if (opponentIndex >= 0 && displayed.lineIndex > opponentIndex) continue;
    addDialogue(
      reference,
      "before-battle",
      "Before the battle",
      displayed.wrapperLabel,
      displayed.resolved,
    );
  }

  let pointers = battlePointers(current.source);
  if (!pointers) {
    for (const displayed of currentDisplays) {
      const source = wrapperSource(reference, displayed.wrapperLabel, current.source);
      const wrapped = source ? battlePointers(source) : null;
      if (wrapped) {
        pointers = wrapped;
        break;
      }
    }
  }

  if (pointers) {
    if (pointers.playerWins && pointers.playerWins === pointers.playerLoses) {
      addDialogue(
        reference,
        "player-wins",
        "Battle result dialogue",
        pointers.playerWins,
        resolveWrapper(reference, pointers.playerWins, current.source, textBlocks),
      );
    } else {
      if (pointers.playerWins) {
        addDialogue(
          reference,
          "player-wins",
          "If the player wins",
          pointers.playerWins,
          resolveWrapper(reference, pointers.playerWins, current.source, textBlocks),
        );
      }
      if (pointers.playerLoses) {
        addDialogue(
          reference,
          "player-loses",
          "If the player loses",
          pointers.playerLoses,
          resolveWrapper(reference, pointers.playerLoses, current.source, textBlocks),
        );
      }
    }
  }

  const followUp = uniqueNextState(reference, current);
  if (followUp) {
    for (const displayed of displayTargets(reference, followUp, textBlocks)) {
      addDialogue(
        reference,
        "post-battle",
        "After the battle",
        displayed.wrapperLabel,
        displayed.resolved,
      );
    }
  }

  return reference.interaction;
}
