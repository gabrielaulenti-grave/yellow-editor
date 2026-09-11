import {
  findMapScriptOpcode,
  parseMovementStep,
  renderMovementStep,
  type MapMovementStep,
  type MapScriptOperationKind,
} from "./mapScriptOpcodes";

export interface ParsedMapScriptInstruction {
  line: number;
  source: string;
  opcodeId: string;
  kind: MapScriptOperationKind;
  title: string;
  description: string;
  operands: string[];
}

export interface ParsedMovementPath {
  label: string;
  steps: MapMovementStep[];
  display: string;
}

export interface ParsedMapScriptRoutine {
  label: string;
  startLine: number;
  instructions: ParsedMapScriptInstruction[];
}

function withoutComment(line: string): string {
  return line.split(";", 1)[0].trim();
}

function operandsFor(line: string): string[] {
  const clean = withoutComment(line);
  const firstSpace = clean.search(/\s/);
  if (firstSpace < 0) return [];
  return clean.slice(firstSpace + 1).split(",").map((value) => value.trim()).filter(Boolean);
}

export function parseMapScriptInstructions(source: string, lineOffset = 0): ParsedMapScriptInstruction[] {
  const result: ParsedMapScriptInstruction[] = [];
  source.split(/\r?\n/).forEach((sourceLine, index) => {
    const clean = withoutComment(sourceLine);
    if (!clean) return;
    const opcode = findMapScriptOpcode(clean);
    if (!opcode) return;
    result.push({
      line: lineOffset + index + 1,
      source: sourceLine,
      opcodeId: opcode.id,
      kind: opcode.kind,
      title: opcode.title,
      description: opcode.beginnerDescription,
      operands: operandsFor(clean),
    });
  });
  return result;
}

export function parseMovementPath(label: string, source: string): ParsedMovementPath {
  const steps: MapMovementStep[] = [];
  for (const line of source.split(/\r?\n/)) {
    const match = withoutComment(line).match(/^db\s+([^,\s]+)(?:\s*,\s*([^,\s]+))?/i);
    if (!match) continue;
    const rawCount = match[2]?.trim();
    const count = rawCount && /^\d+$/.test(rawCount) ? Number(rawCount)
      : rawCount && /^\$[0-9a-f]+$/i.test(rawCount) ? Number.parseInt(rawCount.slice(1), 16)
      : null;
    const step = parseMovementStep(match[1], count);
    if (step) steps.push(step);
  }
  return { label, steps, display: steps.map(renderMovementStep).join(" → ") };
}

export function parseMapScriptRoutines(source: string): ParsedMapScriptRoutine[] {
  const lines = source.split(/\r?\n/);
  const starts: Array<{ label: string; index: number }> = [];
  lines.forEach((line, index) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*):{1,2}\s*(?:;.*)?$/);
    if (match) starts.push({ label: match[1], index });
  });
  return starts.map((start, index) => {
    const end = starts[index + 1]?.index ?? lines.length;
    return {
      label: start.label,
      startLine: start.index + 1,
      instructions: parseMapScriptInstructions(lines.slice(start.index, end).join("\n"), start.index),
    };
  });
}
