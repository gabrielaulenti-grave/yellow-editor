import { useMemo } from "react";
import {
  parseMapScriptRoutines,
  parseMovementPath,
  type ParsedMapScriptInstruction,
} from "./core/mapScriptParser";
import type { TrainerScriptReference } from "./core/types";

interface MapScriptPreviewProps {
  reference: TrainerScriptReference;
}

function withoutComment(line: string): string {
  return line.split(";", 1)[0].trim();
}

function titleCaseConstant(value: string): string {
  return value
    .replace(/^\./, "")
    .replace(/^(EVENT|TEXT|OPP|MUSIC|SPRITE_FACING|NPC_MOVEMENT|PAD)_/, "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function labelBlock(source: string, label: string): string | null {
  const lines = source.split(/\r?\n/);
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const globalPattern = new RegExp(`^\\s*${escaped}:{1,2}\\s*(?:;.*)?$`);
  const start = lines.findIndex((line) => globalPattern.test(line));
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

function recentRegisterValue(lines: string[], beforeIndex: number, register: "a" | "c" | "de" | "hl", maxBack = 12): string | null {
  const pattern = new RegExp(`^ld\\s+${register}\\s*,\\s*([^\\s;]+)\\b`, "i");
  for (let index = beforeIndex - 1; index >= Math.max(0, beforeIndex - maxBack); index -= 1) {
    const value = withoutComment(lines[index]).match(pattern)?.[1];
    if (value) return value;
  }
  return null;
}

function parseNumber(value: string | null): number | null {
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value);
  if (/^\$[0-9a-f]+$/i.test(value)) return Number.parseInt(value.slice(1), 16);
  return null;
}

function detailForInstruction(
  instruction: ParsedMapScriptInstruction,
  routineSource: string,
  mapSource: string,
): { label?: string; value?: string; path?: string } {
  const lines = routineSource.split(/\r?\n/);
  const lineIndex = Math.max(0, instruction.line - 1);
  const mapLines = mapSource.split(/\r?\n/);
  const absoluteLine = mapLines[instruction.line - 1];
  const localIndex = absoluteLine
    ? lines.findIndex((line) => line === absoluteLine)
    : -1;
  const index = localIndex >= 0 ? localIndex : Math.min(lineIndex, lines.length - 1);

  switch (instruction.opcodeId) {
    case "check-event":
    case "set-event":
    case "reset-event": {
      const value = withoutComment(lines[index] ?? "").split(/\s+/, 2)[1];
      return value ? { label: "Event", value: titleCaseConstant(value) } : {};
    }
    case "display-text": {
      const text = instruction.source.match(/^\s*call\s+PrintText/i)
        ? recentRegisterValue(lines, index, "hl", 8)
        : recentRegisterValue(lines, index, "a", 8);
      return text ? { label: "Text", value: titleCaseConstant(text) } : {};
    }
    case "move-sprite": {
      const movementLabel = recentRegisterValue(lines, index, "de", 10);
      if (!movementLabel || /^w[A-Za-z0-9_]+$/.test(movementLabel)) {
        return { value: "The movement path is calculated while the game is running." };
      }
      const source = labelBlock(mapSource, movementLabel);
      if (!source) return { label: "Movement", value: titleCaseConstant(movementLabel) };
      const path = parseMovementPath(movementLabel, source).display;
      return path ? { label: "Path", value: path, path } : { label: "Movement", value: titleCaseConstant(movementLabel) };
    }
    case "move-player": {
      let movementLabel: string | null = null;
      for (let back = index - 1; back >= Math.max(0, index - 16); back -= 1) {
        if (/^call\s+DecodeRLEList\b/i.test(withoutComment(lines[back]))) {
          movementLabel = recentRegisterValue(lines, back, "de", 6);
          break;
        }
      }
      if (!movementLabel) return { value: "Temporarily controls the player's movement." };
      const source = labelBlock(mapSource, movementLabel);
      const path = source ? parseMovementPath(movementLabel, source).display : "";
      return path ? { label: "Path", value: path, path } : { label: "Movement", value: titleCaseConstant(movementLabel) };
    }
    case "battle": {
      const opponent = recentRegisterValue(lines, index, "a", 6);
      return opponent ? { label: "Opponent", value: titleCaseConstant(opponent) } : {};
    }
    case "delay": {
      if (/DelayFrames/i.test(instruction.source)) {
        const frames = parseNumber(recentRegisterValue(lines, index, "c", 5));
        if (frames !== null) return { label: "Duration", value: `${frames} frame${frames === 1 ? "" : "s"}` };
      }
      return {};
    }
    case "play-music": {
      const routine = instruction.source.match(/^\s*farcall\s+Music_([A-Za-z0-9_]+)/i)?.[1];
      const music = routine ?? recentRegisterValue(lines, index, "a", 8);
      return music ? { label: "Music", value: titleCaseConstant(music) } : {};
    }
    default:
      return {};
  }
}

function iconFor(kind: ParsedMapScriptInstruction["kind"]): string {
  switch (kind) {
    case "condition": return "?";
    case "dialogue": return "“”";
    case "movement": return "↕";
    case "facing": return "↻";
    case "battle": return "⚔";
    case "outcome": return "✓";
    case "event": return "◆";
    case "music": return "♪";
    case "wait": return "…";
    case "object": return "◉";
    case "recovery": return "+";
    case "transition": return "→";
  }
}

export function MapScriptPreview({ reference }: MapScriptPreviewProps) {
  const model = useMemo(() => {
    const routines = parseMapScriptRoutines(reference.mapScriptSource);
    const routine = routines.find((entry) => entry.label === reference.routineLabel) ?? null;
    const source = labelBlock(reference.mapScriptSource, reference.routineLabel) ?? "";
    return { routine, source };
  }, [reference.mapScriptSource, reference.routineLabel]);

  if (!model.routine) {
    return (
      <div className="map-script-preview">
        <p className="empty-state">Yellow Editor could not isolate this routine safely. Use the advanced source below to review it.</p>
      </div>
    );
  }

  return (
    <div className="map-script-preview">
      <div className="map-script-preview-heading">
        <div>
          <h5>Script steps</h5>
          <p className="help-text">Recognized engine operations are translated into editable concepts. Editing controls will be added on top of this same model.</p>
        </div>
        <span className="read-only-badge">Preview</span>
      </div>

      {model.routine.instructions.length === 0 ? (
        <p className="empty-state">No library operations were recognized in this routine yet.</p>
      ) : (
        <ol className="map-script-step-list">
          {model.routine.instructions.map((instruction, index) => {
            const detail = detailForInstruction(instruction, model.source, reference.mapScriptSource);
            return (
              <li className={`map-script-step map-script-step-${instruction.kind}`} key={`${instruction.line}:${instruction.opcodeId}:${index}`}>
                <span className="map-script-step-number">{index + 1}</span>
                <span className="map-script-step-icon" aria-hidden="true">{iconFor(instruction.kind)}</span>
                <div className="map-script-step-body">
                  <strong>{instruction.title}</strong>
                  <p>{detail.value ?? instruction.description}</p>
                  {detail.path && <code className="map-script-path">{detail.path}</code>}
                  {detail.label && !detail.path && <span className="map-script-detail"><small>{detail.label}</small><code>{detail.value}</code></span>}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <details className="trainer-full-script map-script-resolved-summary">
        <summary>View resolved plain-language summary</summary>
        <pre className="trainer-script-source"><code>{reference.routineSource}</code></pre>
      </details>
    </div>
  );
}
