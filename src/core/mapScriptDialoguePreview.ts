export interface ResolvedScriptBattleDialogue {
  playerWins: string | null;
  playerLoses: string | null;
}

export interface ResolvedScriptPhaseDialogue {
  title: string;
  dialogues: string[];
  battleDialogues: ResolvedScriptBattleDialogue[];
}

interface SummaryAction {
  title: string;
  detailLines: string[];
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function unquote(lines: string[]): string | null {
  const start = lines.findIndex((line) => line.trimStart().startsWith("“"));
  if (start < 0) return null;

  const collected: string[] = [];
  for (let index = start; index < lines.length; index += 1) {
    let text = lines[index].trimStart();
    if (index === start) text = text.replace(/^“/, "");
    const closes = text.endsWith("”");
    if (closes) text = text.slice(0, -1);
    collected.push(text);
    if (closes) break;
  }

  return collected.join("\n").trim() || null;
}

function labelledValue(lines: string[], label: string, stopLabels: string[]): string | null {
  const labelPattern = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*(.*)$`, "i");
  const stopPatterns = stopLabels.map((stop) => new RegExp(`^${stop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:`, "i"));
  const start = lines.findIndex((line) => labelPattern.test(line.trim()));
  if (start < 0) return null;

  const first = lines[start].trim().match(labelPattern)?.[1] ?? "";
  const parts = [first];
  for (let index = start + 1; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (!trimmed) break;
    if (stopPatterns.some((pattern) => pattern.test(trimmed))) break;
    if (/^\d+\.\s+/.test(trimmed)) break;
    parts.push(trimmed);
  }
  return parts.join("\n").trim() || null;
}

function addAction(phase: ResolvedScriptPhaseDialogue, action: SummaryAction | null): void {
  if (!action) return;
  if (normalize(action.title) === "show dialogue") {
    const text = unquote(action.detailLines);
    if (text) phase.dialogues.push(text);
    return;
  }

  const title = normalize(action.title);
  if (title === "set battle result dialogue" || title === "prepare end-of-battle dialogue") {
    phase.battleDialogues.push({
      playerWins: labelledValue(action.detailLines, "Player wins", ["Player loses"]),
      playerLoses: labelledValue(action.detailLines, "Player loses", ["Player wins"]),
    });
  }
}

export function parseResolvedScriptDialogueSummary(summary: string): ResolvedScriptPhaseDialogue[] {
  const phases: ResolvedScriptPhaseDialogue[] = [];
  let phase: ResolvedScriptPhaseDialogue | null = null;
  let action: SummaryAction | null = null;

  const flushAction = () => {
    if (phase) addAction(phase, action);
    action = null;
  };

  for (const line of summary.split(/\r?\n/)) {
    const phaseMatch = line.match(/^\d+\.\s+[A-Z][A-Z ]+\s+—\s+(.+)$/);
    if (phaseMatch) {
      flushAction();
      phase = {
        title: phaseMatch[1].trim(),
        dialogues: [],
        battleDialogues: [],
      };
      phases.push(phase);
      continue;
    }

    const actionMatch = line.match(/^\s{2}\d+\.\s+(.+)$/);
    if (actionMatch && phase) {
      flushAction();
      action = { title: actionMatch[1].trim(), detailLines: [] };
      continue;
    }

    if (action) action.detailLines.push(line);
  }
  flushAction();
  return phases;
}

export function findResolvedScriptPhaseDialogue(
  phases: ResolvedScriptPhaseDialogue[],
  title: string,
): ResolvedScriptPhaseDialogue | null {
  const key = normalize(title);
  return phases.find((phase) => normalize(phase.title) === key) ?? null;
}
