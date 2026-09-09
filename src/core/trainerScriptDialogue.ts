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

interface WrapperReference {
  label: string;
  scopeSource: string | null;
}

interface DialoguePlan {
  setup: WrapperReference[];
  win: WrapperReference[];
  loss: WrapperReference[];
}

interface ResolvedDialogue {
  wrapperLabel: string;
  textLabel: string | null;
  text: string | null;
  sourcePath: string | null;
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

function textPointerLabels(contents: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of contents.matchAll(
    /^\s*dw_const\s+([A-Za-z_.][A-Za-z0-9_.]*)\s*,\s*(TEXT_[A-Z0-9_]+)\b/gm,
  )) {
    result.set(match[2], match[1]);
  }
  return result;
}

function routineScriptConstants(contents: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of contents.matchAll(
    /^\s*dw_const\s+([A-Za-z_][A-Za-z0-9_]*)\s*,\s*(SCRIPT_[A-Z0-9_]+)\b/gm,
  )) {
    result.set(match[1], match[2]);
  }
  return result;
}

function transitionPredecessors(
  contents: string,
  routineLabel: string,
): LabelSection[] {
  const scriptConstant = routineScriptConstants(contents).get(routineLabel);
  if (!scriptConstant) {
    return [];
  }
  const escaped = scriptConstant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const loadPattern = new RegExp(`^\\s*ld\\s+a\\s*,\\s*${escaped}\\b`, "m");
  const storePattern = /^\s*ld\s+\[w[A-Za-z0-9_]*CurScript\]\s*,\s*a\b/m;
  return globalLabelSections(contents).filter((section) =>
    section.label !== routineLabel && loadPattern.test(section.source) && storePattern.test(section.source)
  );
}

function displayedWrappers(
  sectionSource: string,
  pointers: Map<string, string>,
): WrapperReference[] {
  const wrappers: WrapperReference[] = [];
  const add = (label: string) => {
    if (!wrappers.some((entry) => entry.label === label)) {
      wrappers.push({ label, scopeSource: sectionSource });
    }
  };

  const lines = sectionSource.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const textId = withoutComment(lines[index]).match(/^ld\s+a\s*,\s*(TEXT_[A-Z0-9_]+)\b/i)?.[1];
    if (textId) {
      const window = lines.slice(index + 1, index + 9).map(withoutComment);
      if (
        window.some((line) => /\[hTextID\]\s*,\s*a\b/i.test(line)) &&
        window.some((line) => /\b(?:call|jp)\s+[A-Za-z0-9_]*DisplayText[A-Za-z0-9_]*\b/i.test(line))
      ) {
        const wrapper = pointers.get(textId);
        if (wrapper) {
          add(wrapper);
        }
      }
    }

    const directLabel = withoutComment(lines[index]).match(
      /^ld\s+hl\s*,\s*([A-Za-z_.][A-Za-z0-9_.]*)\b/i,
    )?.[1];
    if (!directLabel) {
      continue;
    }
    const window = lines.slice(index + 1, index + 6).map(withoutComment);
    if (window.some((line) => /^call\s+PrintText\b/i.test(line))) {
      add(directLabel);
    }
  }

  return wrappers;
}

function endBattleWrappers(sectionSource: string): {
  win: WrapperReference[];
  loss: WrapperReference[];
} {
  const win: WrapperReference[] = [];
  const loss: WrapperReference[] = [];
  const lines = sectionSource.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\s*call\s+SaveEndBattleTextPointers\b/i.test(withoutComment(lines[index]))) {
      continue;
    }
    let winLabel: string | null = null;
    let lossLabel: string | null = null;
    for (let back = index - 1; back >= Math.max(0, index - 16); back -= 1) {
      const clean = withoutComment(lines[back]);
      if (!lossLabel) {
        lossLabel = clean.match(/^ld\s+de\s*,\s*([A-Za-z_.][A-Za-z0-9_.]*)\b/i)?.[1] ?? null;
      }
      if (!winLabel) {
        winLabel = clean.match(/^ld\s+hl\s*,\s*([A-Za-z_.][A-Za-z0-9_.]*)\b/i)?.[1] ?? null;
      }
      if (winLabel && lossLabel) {
        break;
      }
    }
    if (winLabel && !win.some((entry) => entry.label === winLabel)) {
      win.push({ label: winLabel, scopeSource: sectionSource });
    }
    if (lossLabel && !loss.some((entry) => entry.label === lossLabel)) {
      loss.push({ label: lossLabel, scopeSource: sectionSource });
    }
  }

  return { win, loss };
}

function planForReference(reference: TrainerScriptReference): DialoguePlan {
  const pointers = textPointerLabels(reference.mapScriptSource);
  const relatedSections = [
    ...transitionPredecessors(reference.mapScriptSource, reference.routineLabel),
    { label: reference.routineLabel, source: reference.routineSource },
  ];
  const setup: WrapperReference[] = [];
  const win: WrapperReference[] = [];
  const loss: WrapperReference[] = [];

  const addUnique = (target: WrapperReference[], entries: WrapperReference[]) => {
    for (const entry of entries) {
      if (!target.some((existing) => existing.label === entry.label)) {
        target.push(entry);
      }
    }
  };

  for (const section of relatedSections) {
    addUnique(setup, displayedWrappers(section.source, pointers));
    const endBattle = endBattleWrappers(section.source);
    addUnique(win, endBattle.win);
    addUnique(loss, endBattle.loss);
  }

  return { setup, win, loss };
}

function wrapperSource(
  reference: TrainerScriptReference,
  wrapper: WrapperReference,
): string | null {
  if (wrapper.label.startsWith(".") && wrapper.scopeSource) {
    return localLabelBlock(wrapper.scopeSource, wrapper.label);
  }
  return globalLabelBlocks(reference.mapScriptSource).get(wrapper.label) ?? null;
}

function farTextLabels(source: string | null): string[] {
  if (!source) {
    return [];
  }
  return [...source.matchAll(/^\s*text_far\s+([A-Za-z_.][A-Za-z0-9_.]*)\b/gm)]
    .map((match) => match[1]);
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

function addTextBlocks(
  target: Map<string, TextBlock>,
  path: string,
  contents: string,
): void {
  for (const section of globalLabelSections(contents)) {
    target.set(section.label, { path, source: section.source });
  }
}

async function readTextFiles(
  source: ProjectSource,
  paths: string[],
): Promise<Map<string, string>> {
  const entries = await Promise.all(paths.map(async (path) => [path, await source.readText(path)] as const));
  return new Map(entries);
}

function resolveWrapper(
  reference: TrainerScriptReference,
  wrapper: WrapperReference,
  textBlocks: Map<string, TextBlock>,
): ResolvedDialogue[] {
  const sourceBlock = wrapperSource(reference, wrapper);
  const farLabels = farTextLabels(sourceBlock);
  if (farLabels.length > 0) {
    return farLabels.map((textLabel) => {
      const external = textBlocks.get(textLabel);
      return {
        wrapperLabel: wrapper.label,
        textLabel,
        text: external ? parseQuotedText(external.source) : null,
        sourcePath: external?.path ?? null,
      };
    });
  }

  const external = textBlocks.get(wrapper.label);
  if (external) {
    return [{
      wrapperLabel: wrapper.label,
      textLabel: wrapper.label,
      text: parseQuotedText(external.source),
      sourcePath: external.path,
    }];
  }

  const inlineText = sourceBlock ? parseQuotedText(sourceBlock) : null;
  return [{
    wrapperLabel: wrapper.label,
    textLabel: null,
    text: inlineText,
    sourcePath: inlineText ? reference.scriptPath : null,
  }];
}

function renderDialogueGroup(
  title: string,
  entries: ResolvedDialogue[],
): string | null {
  if (entries.length === 0) {
    return null;
  }
  const rendered = entries.map((entry) => {
    const label = entry.textLabel
      ? `${entry.wrapperLabel} → ${entry.textLabel}`
      : entry.wrapperLabel;
    const source = entry.sourcePath ? ` (${entry.sourcePath})` : "";
    const text = entry.text ?? "[Text label found, but its quoted text could not be resolved.]";
    return `[${label}]${source}\n${text}`;
  });
  return `${title}\n${rendered.join("\n\n")}`;
}

function annotateReference(
  reference: TrainerScriptReference,
  plan: DialoguePlan,
  textBlocks: Map<string, TextBlock>,
): void {
  const setup = plan.setup.flatMap((wrapper) => resolveWrapper(reference, wrapper, textBlocks));
  const win = plan.win.flatMap((wrapper) => resolveWrapper(reference, wrapper, textBlocks));
  const loss = plan.loss.flatMap((wrapper) => resolveWrapper(reference, wrapper, textBlocks));
  const groups = [
    renderDialogueGroup("Battle setup / lead-in text", setup),
    renderDialogueGroup("Player wins", win),
    renderDialogueGroup("Player loses", loss),
  ].filter((group): group is string => Boolean(group));

  if (groups.length === 0) {
    return;
  }
  reference.routineSource = `${reference.routineSource}\n\n` +
    `; ===== Yellow Editor resolved dialogue (not assembly source) =====\n` +
    `${groups.join("\n\n")}\n` +
    `; ===== End resolved dialogue =====`;
}

export async function enrichScriptedTrainerDialogue(
  source: ProjectSource,
  catalog: TrainerCatalog,
): Promise<void> {
  const references = new Map<string, TrainerScriptReference>();
  for (const trainer of catalog.trainers) {
    for (const reference of trainer.scriptReferences) {
      references.set(reference.id, reference);
    }
  }
  if (references.size === 0 || !(await source.exists("text.asm"))) {
    return;
  }

  const plans = new Map<string, DialoguePlan>();
  const requiredFarLabels = new Set<string>();
  for (const [id, reference] of references) {
    const plan = planForReference(reference);
    plans.set(id, plan);
    for (const wrapper of [...plan.setup, ...plan.win, ...plan.loss]) {
      for (const textLabel of farTextLabels(wrapperSource(reference, wrapper))) {
        requiredFarLabels.add(textLabel);
      }
    }
  }

  const textIndex = await source.readText("text.asm");
  const textPaths = includedPaths(textIndex, "text/");
  const scriptStems = new Set([...references.values()].map((reference) => pathStem(reference.scriptPath)));
  const likelyPaths = textPaths.filter((path) => {
    const stem = pathStem(path);
    return [...scriptStems].some((scriptStem) =>
      stem === scriptStem || stem.startsWith(`${scriptStem}_`)
    );
  });

  const textBlocks = new Map<string, TextBlock>();
  for (const [path, contents] of await readTextFiles(source, likelyPaths)) {
    addTextBlocks(textBlocks, path, contents);
  }

  const unresolved = [...requiredFarLabels].filter((label) => !textBlocks.has(label));
  if (unresolved.length > 0) {
    const loaded = new Set(likelyPaths);
    const fallbackPaths = textPaths.filter((path) => !loaded.has(path));
    for (const [path, contents] of await readTextFiles(source, fallbackPaths)) {
      addTextBlocks(textBlocks, path, contents);
    }
  }

  for (const [id, reference] of references) {
    annotateReference(reference, plans.get(id) ?? { setup: [], win: [], loss: [] }, textBlocks);
  }
}
