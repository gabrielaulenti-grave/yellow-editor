import type { MapScriptSemanticNode, MapScriptState } from "./mapScriptProgram";

type DialogueNode = Extract<MapScriptSemanticNode, { type: "dialogue" }>;

interface LabelSection {
  label: string;
  lines: string[];
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
    result.set(start.label, {
      label: start.label,
      lines: lines.slice(start.index, starts[index + 1]?.index ?? lines.length),
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

function eventFactsBefore(state: MapScriptState, absoluteLine: number): Map<string, boolean> {
  const result = new Map<string, boolean>();
  const lines = state.source.split(/\r?\n/);
  const endIndex = Math.max(1, absoluteLine - state.startLine);
  for (let index = 1; index < Math.min(lines.length, endIndex); index += 1) {
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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");
}

function findLabelIndex(lines: string[], label: string, afterIndex: number): number | null {
  const pattern = new RegExp("^\\s*" + escapeRegex(label) + ":{1,2}\\s*(?:;.*)?$");
  for (let index = afterIndex; index < lines.length; index += 1) {
    if (pattern.test(lines[index])) return index;
  }
  return null;
}

function conditionalTextTarget(
  section: LabelSection,
  eventFacts: Map<string, boolean>,
): string | null {
  const lines = section.lines;
  for (let index = 1; index < lines.length; index += 1) {
    const event = withoutComment(lines[index]).match(/^CheckEvent\s+([A-Z][A-Z0-9_]*)\b/i)?.[1];
    if (!event || !eventFacts.has(event)) continue;

    let firstLoadIndex = -1;
    let firstLabel: string | null = null;
    for (let next = index + 1; next <= Math.min(lines.length - 1, index + 4); next += 1) {
      const label = withoutComment(lines[next]).match(
        /^ld\s+hl\s*,\s*([A-Za-z_.][A-Za-z0-9_.]*)\b/i,
      )?.[1];
      if (label) {
        firstLoadIndex = next;
        firstLabel = label;
        break;
      }
    }
    if (firstLoadIndex < 0 || !firstLabel) continue;

    let branchIndex = -1;
    let flag: "z" | "nz" | null = null;
    let branchTarget: string | null = null;
    for (let next = firstLoadIndex + 1; next <= Math.min(lines.length - 1, firstLoadIndex + 4); next += 1) {
      const branch = withoutComment(lines[next]).match(
        /^jr\s+(z|nz)\s*,\s*([A-Za-z_.][A-Za-z0-9_.]*)\b/i,
      );
      if (branch) {
        branchIndex = next;
        flag = branch[1].toLowerCase() as "z" | "nz";
        branchTarget = branch[2];
        break;
      }
    }
    if (branchIndex < 0 || !flag || !branchTarget) continue;

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

    const eventIsSet = eventFacts.get(event) === true;
    const branchTaken = flag === "z" ? !eventIsSet : eventIsSet;
    const selected = branchTaken ? firstLabel : secondLabel;

    // Global wrapper labels are safe editor targets. Local labels are scoped to
    // their parent wrapper and can collide elsewhere in the file, so leave them
    // to the existing preview-based disambiguation path.
    return selected.startsWith(".") ? null : selected;
  }
  return null;
}

export function resolvedDisplayedDialogueLabel(
  source: string,
  state: MapScriptState,
  node: DialogueNode,
): string | null {
  if (!node.textLabel?.startsWith("TEXT_")) return null;
  const wrapperLabel = textPointerLabels(source).get(node.textLabel);
  if (!wrapperLabel || wrapperLabel.startsWith(".")) return null;

  const section = globalSections(source).get(wrapperLabel);
  if (!section) return null;

  const facts = eventFactsBefore(state, node.source.lineStart);
  if (facts.size === 0) return null;
  return conditionalTextTarget(section, facts);
}
