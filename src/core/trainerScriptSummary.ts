import type {
  ProjectSource,
  TrainerCatalog,
  TrainerScriptReference,
} from "./types";

interface LabelSection {
  label: string;
  source: string;
}

interface TextBlock {
  path: string;
  source: string;
}

interface ResolvedText {
  label: string;
  text: string | null;
  sourcePath: string | null;
}

type ScriptActionKind =
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
  | "recovery";

interface ScriptAction {
  kind: ScriptActionKind;
  title: string;
  description?: string;
  text?: string | null;
  details?: Array<{ label: string; value: string }>;
  movements?: string[];
}

interface ScriptPhase {
  label: string;
  title: string;
  role: "lead-in" | "battle" | "follow-up";
  actions: ScriptAction[];
}

function withoutComment(line: string): string {
  return line.split(";", 1)[0].trim();
}

function pathStem(path: string): string {
  return path.split("/").pop()?.replace(/\.asm$/, "") ?? "";
}

function includedPaths(contents: string, prefix: string): string[] {
  return [...contents.matchAll(/^\s*INCLUDE\s+"([^"]+)"/gm)]
    .map((match) => match[1])
    .filter((path) => path.startsWith(prefix));
}

function globalLabelSections(contents: string): LabelSection[] {
  const lines = contents.split(/\r?\n/);
  const starts: Array<{ label: string; index: number }> = [];
  lines.forEach((line, index) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*):{1,2}\s*(?:;.*)?$/);
    if (match) {
      starts.push({ label: match[1], index });
    }
  });
  return starts.map((start, index) => ({
    label: start.label,
    source: lines.slice(start.index, starts[index + 1]?.index ?? lines.length).join("\n"),
  }));
}

function globalLabelBlocks(contents: string): Map<string, string> {
  return new Map(globalLabelSections(contents).map((section) => [section.label, section.source]));
}

function localLabelBlock(scopeSource: string, label: string): string | null {
  const lines = scopeSource.split(/\r?\n/);
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^\\s*${escaped}:{1,2}\\s*(?:;.*)?$`);
  const start = lines.findIndex((line) => pattern.test(line));
  if (start < 0) {
    return null;
  }
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\s*[A-Za-z_.][A-Za-z0-9_.]*:{1,2}\s*(?:;.*)?$/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function parseNumber(value: string): number | null {
  const clean = value.trim();
  if (/^\d+$/.test(clean)) {
    return Number(clean);
  }
  if (/^\$[0-9a-f]+$/i.test(clean)) {
    return Number.parseInt(clean.slice(1), 16);
  }
  return null;
}

function splitCamelCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function humanizeConstant(value: string, reference: TrainerScriptReference): string {
  let clean = value.replace(/^\./, "");
  clean = clean.replace(/^(OPP|EVENT|TEXT|SCRIPT|MUSIC|SFX|SPRITE_FACING|PLAYER_DIR|NPC_MOVEMENT|TOGGLE)_/, "");
  const stem = pathStem(reference.scriptPath);
  const stemConstant = stem.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (clean.toUpperCase().startsWith(`${stemConstant}_`)) {
    clean = clean.slice(stemConstant.length + 1);
  }
  const words = splitCamelCase(clean).toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : value;
}

function humanizeScriptLabel(label: string, reference: TrainerScriptReference): string {
  let clean = label.replace(/^\./, "");
  const stem = pathStem(reference.scriptPath);
  if (clean.startsWith(stem)) {
    clean = clean.slice(stem.length);
  }
  clean = clean.replace(/Script$/, "");
  const words = splitCamelCase(clean).toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : label;
}

function textPointerLabels(contents: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of contents.matchAll(
    /^\s*dw_const\s+([A-Za-z_.][A-Za-z0-9_.]*)\s*,\s*(TEXT_[A-Z0-9_]+)\b/gm,
  )) {
    result.set(match[2], match[1]);
  }
  return result;
}

function scriptPointerLabels(contents: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of contents.matchAll(
    /^\s*dw_const\s+([A-Za-z_][A-Za-z0-9_]*)\s*,\s*(SCRIPT_[A-Z0-9_]+)\b/gm,
  )) {
    result.set(match[2], match[1]);
  }
  return result;
}

function transitionTargets(contents: string, sectionSource: string): string[] {
  const pointerLabels = scriptPointerLabels(contents);
  const lines = sectionSource.split(/\r?\n/);
  const targets: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const scriptConstant = withoutComment(lines[index]).match(/^ld\s+a\s*,\s*(SCRIPT_[A-Z0-9_]+)\b/i)?.[1];
    if (!scriptConstant) {
      continue;
    }
    const window = lines.slice(index + 1, index + 5).map(withoutComment);
    if (!window.some((line) => /^ld\s+\[w[A-Za-z0-9_]*CurScript\]\s*,\s*a\b/i.test(line))) {
      continue;
    }
    const target = pointerLabels.get(scriptConstant);
    if (target && !targets.includes(target)) {
      targets.push(target);
    }
  }
  return targets;
}

function relatedPhases(reference: TrainerScriptReference): Array<{
  section: LabelSection;
  role: ScriptPhase["role"];
}> {
  const sections = globalLabelSections(reference.mapScriptSource);
  const byLabel = new Map(sections.map((section) => [section.label, section]));
  const current = byLabel.get(reference.routineLabel) ?? {
    label: reference.routineLabel,
    source: reference.routineSource.split(/\n\n; ===== Yellow Editor resolved dialogue/)[0],
  };
  const seen = new Set<string>([current.label]);
  const result: Array<{ section: LabelSection; role: ScriptPhase["role"] }> = [];

  const predecessors = sections.filter((section) =>
    section.label !== current.label &&
    transitionTargets(reference.mapScriptSource, section.source).includes(current.label)
  ).slice(0, 2);
  for (const predecessor of predecessors) {
    seen.add(predecessor.label);
    result.push({ section: predecessor, role: "lead-in" });
  }
  result.push({ section: current, role: "battle" });

  let frontier = [current];
  for (let depth = 0; depth < 3; depth += 1) {
    const labels = [...new Set(frontier.flatMap((section) =>
      transitionTargets(reference.mapScriptSource, section.source),
    ))].filter((label) => !seen.has(label));
    if (labels.length === 0) {
      break;
    }
    const next = labels
      .map((label) => byLabel.get(label))
      .filter((section): section is LabelSection => Boolean(section))
      .slice(0, 2);
    for (const section of next) {
      seen.add(section.label);
      result.push({ section, role: "follow-up" });
    }
    if (next.length !== 1) {
      break;
    }
    frontier = next;
  }

  return result;
}

function parseQuotedText(block: string): string | null {
  const parts: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    const clean = withoutComment(line);
    const match = clean.match(/^(text|line|cont|para|page|next)\s+"((?:[^"\\]|\\.)*)"/);
    if (!match) {
      continue;
    }
    const separator = match[1] === "para" || match[1] === "page"
      ? "\n\n"
      : parts.length
        ? "\n"
        : "";
    parts.push(`${separator}${match[2].replace(/\\"/g, '"')}`);
  }
  return parts.length ? parts.join("") : null;
}

function addTextBlocks(target: Map<string, TextBlock>, path: string, contents: string): void {
  for (const section of globalLabelSections(contents)) {
    target.set(section.label, { path, source: section.source });
  }
}

function wrapperSource(
  reference: TrainerScriptReference,
  wrapperLabel: string,
  scopeSource: string,
): string | null {
  if (wrapperLabel.startsWith(".")) {
    return localLabelBlock(scopeSource, wrapperLabel);
  }
  return globalLabelBlocks(reference.mapScriptSource).get(wrapperLabel) ?? null;
}

function resolveWrapperText(
  reference: TrainerScriptReference,
  wrapperLabel: string,
  scopeSource: string,
  textBlocks: Map<string, TextBlock>,
): ResolvedText[] {
  const source = wrapperSource(reference, wrapperLabel, scopeSource);
  const farLabels = source
    ? [...source.matchAll(/^\s*text_far\s+([A-Za-z_.][A-Za-z0-9_.]*)\b/gm)].map((match) => match[1])
    : [];
  if (farLabels.length > 0) {
    return farLabels.map((label) => {
      const block = textBlocks.get(label);
      return {
        label,
        text: block ? parseQuotedText(block.source) : null,
        sourcePath: block?.path ?? null,
      };
    });
  }

  const external = textBlocks.get(wrapperLabel);
  if (external) {
    return [{
      label: wrapperLabel,
      text: parseQuotedText(external.source),
      sourcePath: external.path,
    }];
  }

  return [{
    label: wrapperLabel,
    text: source ? parseQuotedText(source) : null,
    sourcePath: source ? reference.scriptPath : null,
  }];
}

function resolveTextConstant(
  reference: TrainerScriptReference,
  textConstant: string,
  scopeSource: string,
  textBlocks: Map<string, TextBlock>,
): ResolvedText[] {
  const wrapper = textPointerLabels(reference.mapScriptSource).get(textConstant);
  if (!wrapper) {
    return [{ label: textConstant, text: null, sourcePath: null }];
  }
  return resolveWrapperText(reference, wrapper, scopeSource, textBlocks);
}

function loadedValueBeforeStore(
  lines: string[],
  beforeIndex: number,
  storePattern: RegExp,
  maxBack = 12,
): string | null {
  for (let index = beforeIndex - 1; index >= Math.max(0, beforeIndex - maxBack); index -= 1) {
    if (!storePattern.test(withoutComment(lines[index]))) {
      continue;
    }
    for (let valueIndex = index - 1; valueIndex >= Math.max(0, index - 4); valueIndex -= 1) {
      const value = withoutComment(lines[valueIndex]).match(/^ld\s+a\s*,\s*([^\s;]+)\b/i)?.[1];
      if (value) {
        return value;
      }
      const xor = lines[valueIndex].match(/^\s*xor\s+a\s*(?:;\s*([^;]+))?/i);
      if (xor) {
        return xor[1]?.trim() ?? "0";
      }
    }
  }
  return null;
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
    if (value) {
      return value;
    }
  }
  return null;
}

function movementSource(
  reference: TrainerScriptReference,
  phaseSource: string,
  label: string,
): string | null {
  if (/^w[A-Za-z0-9_]+$/.test(label)) {
    return null;
  }
  if (label.startsWith(".")) {
    return localLabelBlock(phaseSource, label);
  }
  return globalLabelBlocks(reference.mapScriptSource).get(label) ?? null;
}

function movementToken(value: string, count: number | null, reference: TrainerScriptReference): string | null {
  const directions: Record<string, string> = {
    NPC_MOVEMENT_UP: "↑ Up",
    NPC_MOVEMENT_DOWN: "↓ Down",
    NPC_MOVEMENT_LEFT: "← Left",
    NPC_MOVEMENT_RIGHT: "→ Right",
    PAD_UP: "↑ Up",
    PAD_DOWN: "↓ Down",
    PAD_LEFT: "← Left",
    PAD_RIGHT: "→ Right",
    NPC_CHANGE_FACING: "Change facing",
  };
  if (value === "-1" || /^\$ff$/i.test(value)) {
    return null;
  }
  const base = directions[value]
    ?? (parseNumber(value) !== null ? "Special movement step" : humanizeConstant(value, reference));
  return count !== null && count > 1 ? `${base} ×${count}` : base;
}

function movementSteps(
  reference: TrainerScriptReference,
  phaseSource: string,
  label: string,
): string[] {
  const source = movementSource(reference, phaseSource, label);
  if (!source) {
    return [];
  }
  const steps: string[] = [];
  for (const line of source.split(/\r?\n/)) {
    const match = withoutComment(line).match(/^db\s+([^,\s]+)(?:\s*,\s*([^,\s]+))?/i);
    if (!match) {
      continue;
    }
    const token = movementToken(match[1], match[2] ? parseNumber(match[2]) : null, reference);
    if (token) {
      steps.push(token);
    }
  }
  return steps.slice(0, 16);
}

function outcomeText(
  reference: TrainerScriptReference,
  phaseSource: string,
  label: string | null,
  textBlocks: Map<string, TextBlock>,
): string {
  if (!label) {
    return "Not resolved";
  }
  const resolved = resolveWrapperText(reference, label, phaseSource, textBlocks);
  const text = resolved.map((entry) => entry.text).filter((value): value is string => Boolean(value)).join(" / ");
  return text || humanizeConstant(label, reference);
}

function actionsForPhase(
  reference: TrainerScriptReference,
  phase: LabelSection,
  role: ScriptPhase["role"],
  textBlocks: Map<string, TextBlock>,
): ScriptAction[] {
  const lines = phase.source.split(/\r?\n/);
  const actions: ScriptAction[] = [];
  const add = (action: ScriptAction) => actions.push(action);

  for (let index = 1; index < lines.length; index += 1) {
    const clean = withoutComment(lines[index]);
    if (!clean) {
      continue;
    }

    const coordinate = clean.match(/^ld\s+a\s*,\s*\[w([XY])Coord\]\b/i);
    if (coordinate) {
      const compare = withoutComment(lines[index + 1] ?? "").match(/^cp\s+([^\s;]+)/i)?.[1];
      const returnKind = withoutComment(lines[index + 2] ?? "").match(/^ret\s+(z|nz)\b/i)?.[1];
      const value = compare ? parseNumber(compare) : null;
      if (value !== null && returnKind) {
        add({
          kind: "condition",
          title: "Check player position",
          description: returnKind === "nz"
            ? `Continue only when the player's ${coordinate[1].toUpperCase()} coordinate is ${value}.`
            : `Check whether the player's ${coordinate[1].toUpperCase()} coordinate is ${value}.`,
        });
      }
    }

    const checkEvent = clean.match(/^CheckEvent\s+([A-Z][A-Z0-9_]*)\b/i)?.[1];
    if (checkEvent) {
      add({
        kind: "condition",
        title: "Check event",
        description: humanizeConstant(checkEvent, reference),
      });
    }

    const setEvent = clean.match(/^SetEvent\s+([A-Z][A-Z0-9_]*)\b/i)?.[1];
    if (setEvent) {
      add({
        kind: "event",
        title: "Remember that this happened",
        description: humanizeConstant(setEvent, reference),
      });
    }

    const resetEvent = clean.match(/^ResetEvent\s+([A-Z][A-Z0-9_]*)\b/i)?.[1];
    if (resetEvent) {
      add({
        kind: "event",
        title: "Clear event state",
        description: humanizeConstant(resetEvent, reference),
      });
    }

    if (/^call\s+DisplayTextID\b/i.test(clean)) {
      const textConstant = recentRegisterValue(lines, index, "a", 8);
      if (textConstant?.startsWith("TEXT_")) {
        for (const resolved of resolveTextConstant(reference, textConstant, phase.source, textBlocks)) {
          add({
            kind: "dialogue",
            title: "Show dialogue",
            description: resolved.text ? undefined : humanizeConstant(resolved.label, reference),
            text: resolved.text,
          });
        }
      }
    }

    if (/^call\s+PrintText\b/i.test(clean)) {
      const label = recentRegisterValue(lines, index, "hl", 6);
      if (label) {
        for (const resolved of resolveWrapperText(reference, label, phase.source, textBlocks)) {
          add({
            kind: "dialogue",
            title: "Show dialogue",
            description: resolved.text ? undefined : humanizeConstant(resolved.label, reference),
            text: resolved.text,
          });
        }
      }
    }

    if (/^call\s+SetSpriteFacingDirectionAndDelay\b/i.test(clean)) {
      const actor = loadedValueBeforeStore(lines, index, /^ldh?\s+\[hSpriteIndex\]\s*,\s*a\b/i);
      const facing = loadedValueBeforeStore(lines, index, /^ldh?\s+\[hSpriteFacingDirection\]\s*,\s*a\b/i);
      if (actor) {
        add({
          kind: "facing",
          title: `${humanizeConstant(actor, reference)} turns`,
          description: facing && facing !== "0"
            ? `Face ${humanizeConstant(facing, reference).toLowerCase()}.`
            : "Face down.",
        });
      }
    }

    if (/^call\s+MoveSprite\b/i.test(clean)) {
      const actor = loadedValueBeforeStore(lines, index, /^ldh?\s+\[hSpriteIndex\]\s*,\s*a\b/i);
      const movementLabel = recentRegisterValue(lines, index, "de", 8);
      if (actor && movementLabel) {
        const steps = movementSteps(reference, phase.source, movementLabel);
        const dynamicPath = /^w[A-Za-z0-9_]+$/.test(movementLabel);
        add({
          kind: "movement",
          title: `Move ${humanizeConstant(actor, reference)}`,
          description: dynamicPath
            ? "Walk toward the player using a path calculated at runtime."
            : steps.length === 0
              ? `Follow the ${humanizeConstant(movementLabel, reference)} movement path.`
              : undefined,
          movements: steps,
        });
      }
    }

    if (/^call\s+StartSimulatingJoypadStates\b/i.test(clean)) {
      let movementLabel: string | null = null;
      for (let back = index - 1; back >= Math.max(0, index - 14); back -= 1) {
        if (/^call\s+DecodeRLEList\b/i.test(withoutComment(lines[back]))) {
          movementLabel = recentRegisterValue(lines, back, "de", 5);
          break;
        }
      }
      const steps = movementLabel ? movementSteps(reference, phase.source, movementLabel) : [];
      add({
        kind: "movement",
        title: "Move the player automatically",
        description: steps.length === 0 ? "Temporarily controls the player's movement." : undefined,
        movements: steps,
      });
    }

    const opponentStore = clean.match(/^ld\s+\[wCurOpponent\]\s*,\s*a\b/i);
    if (opponentStore) {
      const opponent = recentRegisterValue(lines, index, "a", 4);
      if (opponent?.startsWith("OPP_")) {
        const parties = role === "battle"
          ? reference.partyIds.map((partyId) => {
            const party = partyId.split(":")[1];
            return `Party #${party}`;
          })
          : [];
        add({
          kind: "battle",
          title: "Start trainer battle",
          details: [
            { label: "Opponent", value: humanizeConstant(opponent, reference) },
            ...(parties.length > 0
              ? [{ label: parties.length === 1 ? "Party" : "Possible parties", value: parties.join(", ") }]
              : []),
          ],
        });
      }
    }

    if (/^call\s+SaveEndBattleTextPointers\b/i.test(clean)) {
      const winLabel = recentRegisterValue(lines, index, "hl", 16);
      const lossLabel = recentRegisterValue(lines, index, "de", 16);
      add({
        kind: "outcome",
        title: "Set battle result dialogue",
        details: [
          { label: "Player wins", value: outcomeText(reference, phase.source, winLabel, textBlocks) },
          { label: "Player loses", value: outcomeText(reference, phase.source, lossLabel, textBlocks) },
        ],
      });
    }

    if (/^ld\s+a\s*,\s*\[wBattleResult\]\b/i.test(clean)) {
      add({
        kind: "condition",
        title: "Check the battle result",
        description: "Later behavior changes depending on whether the player won or lost.",
      });
    }

    if (/^call\s+Delay3\b/i.test(clean)) {
      add({ kind: "wait", title: "Brief pause" });
    }

    if (/^call\s+DelayFrames\b/i.test(clean)) {
      const frames = recentRegisterValue(lines, index, "c", 4);
      const count = frames ? parseNumber(frames) : null;
      add({
        kind: "wait",
        title: count === null ? "Wait" : `Wait ${count} frames`,
      });
    }

    if (/^call\s+PlayMusic\b/i.test(clean)) {
      const music = recentRegisterValue(lines, index, "a", 6);
      if (music?.startsWith("MUSIC_")) {
        add({
          kind: "music",
          title: "Play music",
          description: humanizeConstant(music, reference),
        });
      }
    }

    if (/^call\s+PlayDefaultMusic\b/i.test(clean)) {
      add({ kind: "music", title: "Return to the map music" });
    }

    const musicRoutine = clean.match(/^farcall\s+(Music_[A-Za-z0-9_]+)\b/i)?.[1];
    if (musicRoutine) {
      add({
        kind: "music",
        title: "Play music",
        description: splitCamelCase(musicRoutine.replace(/^Music_/, "")),
      });
    }

    const objectAction = clean.match(/^predef\s+(ShowObject|HideObject)\b/i)?.[1];
    if (objectAction) {
      const object = loadedValueBeforeStore(lines, index, /^ld\s+\[wToggleableObjectIndex\]\s*,\s*a\b/i);
      add({
        kind: "object",
        title: `${objectAction.toLowerCase().startsWith("show") ? "Show" : "Hide"} character or object`,
        description: object ? humanizeConstant(object, reference) : undefined,
      });
    }

    if (/^predef\s+HealParty\b/i.test(clean)) {
      add({ kind: "recovery", title: "Heal the player's party" });
    }
  }

  const deduped: ScriptAction[] = [];
  for (const action of actions) {
    const key = JSON.stringify(action);
    if (!deduped.some((existing) => JSON.stringify(existing) === key)) {
      deduped.push(action);
    }
  }
  return deduped;
}

function roleLabel(role: ScriptPhase["role"]): string {
  switch (role) {
    case "lead-in": return "Before the battle";
    case "battle": return "Battle setup";
    case "follow-up": return "After the battle";
  }
}

function renderAction(action: ScriptAction, index: number): string[] {
  const lines = [`  ${index + 1}. ${action.title}`];
  if (action.description) {
    lines.push(`     ${action.description}`);
  }
  if (action.movements && action.movements.length > 0) {
    lines.push(`     Path: ${action.movements.join(" → ")}`);
  }
  for (const detail of action.details ?? []) {
    const valueLines = detail.value.split("\n");
    lines.push(`     ${detail.label}: ${valueLines[0]}`);
    for (const continuation of valueLines.slice(1)) {
      lines.push(`       ${continuation}`);
    }
  }
  if (action.text) {
    const textLines = action.text.split("\n");
    lines.push(`     “${textLines[0]}`);
    for (const continuation of textLines.slice(1)) {
      lines.push(`       ${continuation}`);
    }
    lines[lines.length - 1] = `${lines[lines.length - 1]}”`;
  }
  return lines;
}

function renderSummary(reference: TrainerScriptReference, phases: ScriptPhase[]): string {
  const lines = [
    "WHAT HAPPENS",
    "Yellow Editor translated the surrounding battle script into plain-language steps.",
    "",
  ];
  phases.forEach((phase, phaseIndex) => {
    lines.push(`${phaseIndex + 1}. ${roleLabel(phase.role).toUpperCase()} — ${phase.title}`);
    if (phase.actions.length === 0) {
      lines.push("   No common event actions were recognized in this phase.");
    } else {
      phase.actions.forEach((action, actionIndex) => {
        lines.push(...renderAction(action, actionIndex));
      });
    }
    lines.push("");
  });
  lines.push("Advanced assembly is still available below for unusual engine behavior or exact implementation details.");
  return lines.join("\n").trimEnd();
}

async function readTextFiles(
  source: ProjectSource,
  paths: string[],
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  let nextIndex = 0;
  const workerCount = Math.min(12, paths.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < paths.length) {
      const path = paths[nextIndex];
      nextIndex += 1;
      files.set(path, await source.readText(path));
    }
  }));
  return files;
}

export async function enrichTrainerScriptSummaries(
  source: ProjectSource,
  catalog: TrainerCatalog,
): Promise<void> {
  const references = new Map<string, TrainerScriptReference>();
  for (const trainer of catalog.trainers) {
    for (const reference of trainer.scriptReferences) {
      references.set(reference.id, reference);
    }
  }
  if (references.size === 0) {
    return;
  }

  const textBlocks = new Map<string, TextBlock>();
  if (await source.exists("text.asm")) {
    const textIndex = await source.readText("text.asm");
    const textPaths = includedPaths(textIndex, "text/");
    const scriptStems = new Set([...references.values()].map((reference) => pathStem(reference.scriptPath)));
    const likelyPaths = textPaths.filter((path) => {
      const stem = pathStem(path);
      return [...scriptStems].some((scriptStem) =>
        stem === scriptStem || stem.startsWith(`${scriptStem}_`)
      );
    });
    for (const [path, contents] of await readTextFiles(source, likelyPaths)) {
      addTextBlocks(textBlocks, path, contents);
    }
  }

  for (const reference of references.values()) {
    const phases = relatedPhases(reference).map(({ section, role }) => ({
      label: section.label,
      title: humanizeScriptLabel(section.label, reference),
      role,
      actions: actionsForPhase(reference, section, role, textBlocks),
    }));
    reference.routineSource = renderSummary(reference, phases);
  }
}
