export interface SharedRoutineInsight {
  title: string;
  detail?: string;
}

function cleanLines(source: string): string[] {
  return source.split(/\r?\n/).map((line) => line.split(";", 1)[0].trim());
}

export function analyzeSharedScriptRoutine(source: string): SharedRoutineInsight[] {
  const lines = cleanLines(source);
  const insights: SharedRoutineInsight[] = [];

  const waitsForNpc = lines.some((line) =>
    /BIT_SCRIPTED_NPC_MOVEMENT/i.test(line)
  ) && lines.some((line) => /^ret\s+nz\b/i.test(line));
  if (waitsForNpc) {
    insights.push({
      title: "Wait for the trainer to finish approaching",
      detail: "Do not continue the shared trainer sequence while scripted NPC movement is still active.",
    });
  }

  if (lines.some((line) => /^call\s+DisplayTextID\b/i.test(line))) {
    insights.push({
      title: "Show the trainer's battle dialogue",
    });
  }

  if (lines.some((line) => /^call\s+InitBattleEnemyParameters\b/i.test(line))) {
    insights.push({
      title: "Initialize the trainer battle",
    });
  }

  if (
    lines.some((line) => /BIT_TALKED_TO_TRAINER/i.test(line))
    && lines.some((line) => /BIT_PRINT_END_BATTLE_TEXT/i.test(line))
  ) {
    insights.push({
      title: "Prepare trainer battle state and end-of-battle dialogue",
    });
  }

  if (
    lines.some((line) => /^ld\s+hl\s*,\s*wCurMapScript\b/i.test(line))
    && lines.some((line) => /^inc\s+\[hl\]/i.test(line))
  ) {
    insights.push({
      title: "Advance to the next map-script state",
    });
  }

  if (
    lines.some((line) => /^ld\s+a\s*,\s*\[wIsInBattle\]/i.test(line))
    && lines.some((line) => /^cp\s+LOST_BATTLE\b/i.test(line))
  ) {
    insights.push({
      title: "Check whether the player lost the trainer battle",
    });
  }

  if (lines.some((line) => /^call\s+TrainerFlagAction\b/i.test(line))) {
    insights.push({
      title: "Mark the trainer as defeated",
    });
  }

  if (lines.some((line) => /^predef\s+HideObject\b/i.test(line))) {
    insights.push({
      title: "Hide the defeated trainer when its map object is removable",
    });
  }

  if (
    lines.some((line) => /^ld\s+\[wCurMapScript\]\s*,\s*a\b/i.test(line))
    && lines.some((line) => /^xor\s+a\b/i.test(line))
  ) {
    insights.push({
      title: "Reset the shared map-script state",
    });
  }

  if (
    lines.some((line) => /BIT_PRINT_END_BATTLE_TEXT/i.test(line))
    && lines.some((line) => /^res\s+BIT_PRINT_END_BATTLE_TEXT/i.test(line))
  ) {
    insights.push({
      title: "Clear the end-of-battle dialogue flag",
    });
  }

  return insights.filter((insight, index, entries) =>
    entries.findIndex((candidate) =>
      candidate.title === insight.title && candidate.detail === insight.detail
    ) === index
  );
}
