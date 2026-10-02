import { eventArgumentsForSemantic } from "./eventMacroSemantics";
import type {
  ProjectEventMacroSemantic,
} from "./types";

export type TextScriptInsight =
  | {
      type: "dialogue";
      label: string;
    }
  | {
      type: "condition";
      description: string;
      branchTarget?: string;
    }
  | {
      type: "choice";
      choice: "yes-no";
      declineTarget?: string;
    }
  | {
      type: "give-item";
      item: string;
      quantity: string;
      failureTarget?: string;
    }
  | {
      type: "give-pokemon";
      species: string;
      level: string;
      failureTarget?: string;
    }
  | {
      type: "inventory";
      action: "has-item" | "quantity";
      item?: string;
      failureTarget?: string;
    }
  | {
      type: "remove-item";
      item?: string;
    }
  | {
      type: "trade";
      trade?: string;
    }
  | {
      type: "cry";
      species?: string;
    }
  | {
      type: "pokedex";
      species?: string;
    }
  | {
      type: "event";
      action: string;
      events: string[];
    }
  | {
      type: "object";
      action: "show" | "hide";
      object?: string;
    }
  | {
      type: "trainer";
      trainerHeader?: string;
    }
  | {
      type: "battle";
      routine: string;
    }
  | {
      type: "transition";
      scriptConstant: string;
    }
  | {
      type: "wait";
      frames?: string;
    }
  | {
      type: "emotion";
      bubble?: string;
    }
  | {
      type: "control";
      action: "auto-advance-dialogue" | "normal-dialogue-wait";
    }
  | {
      type: "facing";
      actor: "player";
      direction: string;
    }
  | {
      type: "battle-dialogue";
      playerWins?: string;
      playerLoses?: string;
    }
  | {
      type: "economy";
      action: "check-affordability" | "add" | "subtract" | "divide";
    }
  | {
      type: "service";
      action: "calculate-low-cost-admission" | "select-party-member" | "transfer-party-member";
    };

interface SourceSection {
  label: string;
  lines: string[];
}

function withoutComment(line: string): string {
  return line.split(";", 1)[0].trim();
}

function sourceSections(contents: string): Map<string, SourceSection> {
  const lines = contents.split(/\r?\n/);
  const starts: Array<{ label: string; index: number }> = [];
  lines.forEach((line, index) => {
    const label = line.match(
      /^\s*([A-Za-z_][A-Za-z0-9_]*):{1,2}\s*(?:;.*)?$/,
    )?.[1];
    if (label) starts.push({ label, index });
  });

  return new Map(starts.map((start, index) => [
    start.label,
    {
      label: start.label,
      lines: lines.slice(start.index, starts[index + 1]?.index ?? lines.length),
    },
  ]));
}

function recentRegisterValue(
  lines: string[],
  beforeIndex: number,
  register: "a" | "b" | "c" | "hl" | "de",
  maxBack = 8,
): string | null {
  const pattern = new RegExp(
    `^ld\\s+${register}\\s*,\\s*([^\\s;]+)\\b`,
    "i",
  );
  for (
    let index = beforeIndex - 1;
    index >= Math.max(1, beforeIndex - maxBack);
    index -= 1
  ) {
    const clean = withoutComment(lines[index]);
    if (/^xor\s+a\s*$/i.test(clean) && register === "a") return "0";
    const value = clean.match(pattern)?.[1];
    if (value) return value;
  }
  return null;
}

function recentStoredAValue(
  lines: string[],
  beforeIndex: number,
  destination: RegExp,
  maxBack = 10,
): string | null {
  for (
    let index = beforeIndex - 1;
    index >= Math.max(1, beforeIndex - maxBack);
    index -= 1
  ) {
    if (!destination.test(withoutComment(lines[index]))) continue;
    return recentRegisterValue(lines, index, "a", maxBack);
  }
  return null;
}

function recentBcPair(
  lines: string[],
  beforeIndex: number,
  maxBack = 10,
): { first: string; second: string } | null {
  for (
    let index = beforeIndex - 1;
    index >= Math.max(1, beforeIndex - maxBack);
    index -= 1
  ) {
    const clean = withoutComment(lines[index]);
    const pair = clean.match(
      /^lb\s+bc\s*,\s*([^,\s]+)\s*,\s*([^\s;]+)\s*$/i,
    );
    if (pair) return { first: pair[1], second: pair[2] };
  }

  let first = recentRegisterValue(lines, beforeIndex, "b", maxBack);
  const second = recentRegisterValue(lines, beforeIndex, "c", maxBack);
  if (!first || !second) return null;

  if (first.toLowerCase() === "a") {
    for (
      let index = beforeIndex - 1;
      index >= Math.max(1, beforeIndex - maxBack);
      index -= 1
    ) {
      const clean = withoutComment(lines[index]);
      if (!/^ld\s+b\s*,\s*a\s*$/i.test(clean)) continue;
      const source = recentRegisterValue(lines, index, "a", maxBack);
      if (source) first = source.replace(/^\[|\]$/g, "");
      break;
    }
  }

  return { first, second };
}

function setterLabels(sections: Map<string, SourceSection>): Set<string> {
  const result = new Set<string>();
  for (const section of sections.values()) {
    const clean = section.lines.map(withoutComment);
    const storesScript = clean.some((line) =>
      /^ld\s+\[w[A-Za-z0-9_]*CurScript\]\s*,\s*a\b/i.test(line)
      || /^ld\s+\[wCurMapScript\]\s*,\s*a\b/i.test(line)
    );
    const overwritesA = clean.slice(1).some((line) =>
      /^ld\s+a\s*,/i.test(line) || /^xor\s+a\b/i.test(line)
    );
    if (storesScript && !overwritesA) result.add(section.label);
  }
  return result;
}

function objectWrapperActions(
  sections: Map<string, SourceSection>,
): Map<string, "show" | "hide"> {
  const result = new Map<string, "show" | "hide">();
  for (const section of sections.values()) {
    const clean = section.lines.map(withoutComment);
    const storeIndex = clean.findIndex((line) =>
      /^ld\s+\[wToggleableObjectIndex\]\s*,\s*a\b/i.test(line)
    );
    if (storeIndex < 0) continue;
    const action = clean.slice(storeIndex + 1, storeIndex + 5)
      .map((line) => line.match(/^predef\s+(ShowObject|HideObject)\b/i)?.[1])
      .find(Boolean);
    if (!action) continue;
    const overwritesA = clean.slice(1, storeIndex).some((line) =>
      /^ld\s+a\s*,/i.test(line) || /^xor\s+a\b/i.test(line)
    );
    if (overwritesA) continue;
    result.set(
      section.label,
      action.toLowerCase().startsWith("show") ? "show" : "hide",
    );
  }
  return result;
}

function trainerHelperLabels(
  sections: Map<string, SourceSection>,
): Set<string> {
  const result = new Set<string>();
  for (const section of sections.values()) {
    if (
      section.lines.some((line) =>
        /^\s*call\s+TalkToTrainer\b/i.test(withoutComment(line))
      )
    ) {
      result.add(section.label);
    }
  }
  return result;
}

function printWrapperLabels(
  sections: Map<string, SourceSection>,
): Set<string> {
  const result = new Set<string>();
  for (const section of sections.values()) {
    const clean = section.lines.map(withoutComment);
    const hasTextPointer = clean.some((line) =>
      /^ld\s+hl\s*,\s*[A-Za-z_.][A-Za-z0-9_.]*\b/i.test(line)
    );
    const prints = clean.some((line) =>
      /^(?:call|jp)\s+PrintText\b/i.test(line)
    );
    if (hasTextPointer && prints) result.add(section.label);
  }
  return result;
}

function readableOperand(value: string): string {
  const bare = value.replace(/^\[|\]$/g, "");
  if (/^w[A-Z]/.test(bare)) {
    return bare
      .slice(1)
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/_/g, " ")
      .toLowerCase();
  }
  return bare.replace(/_/g, " ").toLowerCase();
}

function comparisonDescription(
  left: string,
  right: string,
  flag: string,
): string {
  const lhs = readableOperand(left);
  const rhs = readableOperand(right);
  switch (flag.toLowerCase()) {
    case "z": return `${lhs} equals ${rhs}`;
    case "nz": return `${lhs} does not equal ${rhs}`;
    case "c": return `${lhs} is below ${rhs}`;
    case "nc": return `${lhs} is at least ${rhs}`;
    default: return `${lhs} compared with ${rhs} returns ${flag.toUpperCase()}`;
  }
}

function branchDescription(
  semantic: ProjectEventMacroSemantic,
  events: string[],
  flag: string,
): string {
  const zeroBranch = flag.toLowerCase() === "z";
  if (semantic.zeroMeaning === "event-clear") {
    return `${events[0]} is ${zeroBranch ? "clear" : "set"}`;
  }
  if (semantic.zeroMeaning === "none-set") {
    return zeroBranch
      ? `none of ${events.join(", ")} are set`
      : `at least one of ${events.join(", ")} is set`;
  }
  if (semantic.zeroMeaning === "all-set") {
    return zeroBranch
      ? `all of ${events.join(", ")} are set`
      : `not all of ${events.join(", ")} are set`;
  }
  return `${semantic.name} result is ${flag.toUpperCase()}`;
}

export function analyzeTextScript(
  contents: string,
  label: string,
  eventMacroSemantics: ProjectEventMacroSemantic[] = [],
): TextScriptInsight[] {
  const sections = sourceSections(contents);
  const section = sections.get(label);
  if (!section) return [];
  if (!section.lines.some((line) => /^\s*text_asm\b/i.test(withoutComment(line)))) {
    return [];
  }

  const setters = setterLabels(sections);
  const objectWrappers = objectWrapperActions(sections);
  const trainerHelpers = trainerHelperLabels(sections);
  const printWrappers = printWrapperLabels(sections);
  const eventMacros = new Map(
    eventMacroSemantics.map((semantic) => [
      semantic.name.toLowerCase(),
      semantic,
    ]),
  );

  const lines = section.lines;
  const insights: TextScriptInsight[] = [];
  let pendingItem: { item: string; quantity: string } | null = null;

  for (let index = 1; index < lines.length; index += 1) {
    const clean = withoutComment(lines[index]);
    if (!clean) continue;

    const farText = clean.match(/^text_far\s+([A-Za-z_.][A-Za-z0-9_.]*)\b/i)?.[1];
    if (farText) {
      insights.push({ type: "dialogue", label: farText });
      continue;
    }

    if (/^call\s+PrintText\b/i.test(clean)) {
      const textLabel = recentRegisterValue(lines, index, "hl");
      if (textLabel) insights.push({ type: "dialogue", label: textLabel });
      continue;
    }

    if (/^call\s+SaveEndBattleTextPointers\b/i.test(clean)) {
      insights.push({
        type: "battle-dialogue",
        playerWins: recentRegisterValue(lines, index, "hl") ?? undefined,
        playerLoses: recentRegisterValue(lines, index, "de") ?? undefined,
      });
      continue;
    }

    if (/^ld\s+\[wDoNotWaitForButtonPressAfterDisplayingText\]\s*,\s*a\s*$/i.test(clean)) {
      const value = recentRegisterValue(lines, index, "a");
      insights.push({
        type: "control",
        action: value === "0"
          ? "normal-dialogue-wait"
          : "auto-advance-dialogue",
      });
      continue;
    }

    if (/^ld\s+\[wPlayerMovingDirection\]\s*,\s*a\s*$/i.test(clean)) {
      const direction = recentRegisterValue(lines, index, "a");
      if (direction) {
        insights.push({
          type: "facing",
          actor: "player",
          direction,
        });
      }
      continue;
    }

    const macroInvocation = clean.match(
      /^([A-Za-z_][A-Za-z0-9_#@.]*)\s+(.+)$/,
    );
    if (macroInvocation) {
      const semantic = eventMacros.get(macroInvocation[1].toLowerCase());
      if (semantic) {
        const args = macroInvocation[2].split(",").map((value) => value.trim());
        const events = eventArgumentsForSemantic(
          semantic,
          args,
        );
        if (events.length > 0) {
          insights.push({
            type: "event",
            action: semantic.action,
            events,
          });
          const branch = withoutComment(lines[index + 1] ?? "").match(
            /^(?:jr|jp)\s+(z|nz)\s*,\s*([A-Za-z_.][A-Za-z0-9_.]*)\b/i,
          );
          if (branch && semantic.zeroMeaning) {
            insights.push({
              type: "condition",
              description: branchDescription(
                semantic,
                events,
                branch[1],
              ),
              branchTarget: branch[2],
            });
          }
          continue;
        }
      }
    }

    const bitTest = clean.match(/^bit\s+([^,\s]+)\s*,\s*a\s*$/i);
    if (bitTest) {
      const source = recentRegisterValue(lines, index, "a", 6);
      if (source) {
        for (
          let probe = index + 1;
          probe <= Math.min(lines.length - 1, index + 4);
          probe += 1
        ) {
          const next = withoutComment(lines[probe]);
          if (!next) continue;
          const branch = next.match(
            /^(?:jr|jp)\s+(z|nz)\s*,\s*([A-Za-z_.][A-Za-z0-9_.]*)\b/i,
          );
          if (branch) {
            const set = branch[1].toLowerCase() === "nz";
            insights.push({
              type: "condition",
              description: `${readableOperand(bitTest[1])} is ${set ? "set" : "clear"} in ${readableOperand(source)}`,
              branchTarget: branch[2],
            });
            break;
          }
          if (/^ldh?\s+/i.test(next)) continue;
          break;
        }
      }
      continue;
    }

    if (/^(?:and|or)\s+a\s*$/i.test(clean)) {
      const source = recentRegisterValue(lines, index, "a", 6);
      if (source) {
        for (
          let probe = index + 1;
          probe <= Math.min(lines.length - 1, index + 4);
          probe += 1
        ) {
          const next = withoutComment(lines[probe]);
          if (!next) continue;
          const branch = next.match(
            /^(?:jr|jp)\s+(z|nz)\s*,\s*([A-Za-z_.][A-Za-z0-9_.]*)\b/i,
          );
          if (branch) {
            const zero = branch[1].toLowerCase() === "z";
            insights.push({
              type: "condition",
              description: `${readableOperand(source)} is ${zero ? "zero" : "nonzero"}`,
              branchTarget: branch[2],
            });
            break;
          }
          if (/^ldh?\s+/i.test(next)) continue;
          break;
        }
      }
      continue;
    }

    const comparison = clean.match(/^cp\s+([^\s;]+)\s*$/i);
    if (comparison) {
      const left = recentRegisterValue(lines, index, "a", 6);
      if (left) {
        for (
          let probe = index + 1;
          probe <= Math.min(lines.length - 1, index + 4);
          probe += 1
        ) {
          const next = withoutComment(lines[probe]);
          if (!next) continue;
          const branch = next.match(
            /^(?:jr|jp)\s+(z|nz|c|nc)\s*,\s*([A-Za-z_.][A-Za-z0-9_.]*)\b/i,
          );
          if (branch) {
            insights.push({
              type: "condition",
              description: comparisonDescription(left, comparison[1], branch[1]),
              branchTarget: branch[2],
            });
            break;
          }
          if (/^ldh?\s+/i.test(next)) continue;
          break;
        }
      }
      continue;
    }

    if (/^call\s+HasEnoughMoney\b/i.test(clean)) {
      insights.push({ type: "economy", action: "check-affordability" });
      continue;
    }

    const bcdEconomy = clean.match(
      /^predef\s+(AddBCDPredef|SubBCDPredef|DivideBCDPredef3)\b/i,
    )?.[1];
    if (bcdEconomy) {
      insights.push({
        type: "economy",
        action: bcdEconomy === "AddBCDPredef"
          ? "add"
          : bcdEconomy === "SubBCDPredef"
            ? "subtract"
            : "divide",
      });
      continue;
    }

    if (/^call\s+[A-Za-z0-9_]*CalculateLowCostAdmission\b/i.test(clean)) {
      insights.push({ type: "service", action: "calculate-low-cost-admission" });
      continue;
    }

    if (/^call\s+DisplayPartyMenu\b/i.test(clean)) {
      insights.push({ type: "service", action: "select-party-member" });
      continue;
    }

    if (/^call\s+(?:MoveMon|RemovePokemon)\b/i.test(clean)) {
      insights.push({ type: "service", action: "transfer-party-member" });
      continue;
    }

    if (/^call\s+YesNoChoice\b/i.test(clean)) {
      let declineTarget: string | undefined;
      for (
        let probe = index + 1;
        probe <= Math.min(lines.length - 1, index + 5);
        probe += 1
      ) {
        const branch = withoutComment(lines[probe]).match(
          /^(?:jr|jp)\s+nz\s*,\s*([A-Za-z_.][A-Za-z0-9_.]*)\b/i,
        );
        if (branch) {
          declineTarget = branch[1];
          break;
        }
      }
      insights.push({ type: "choice", choice: "yes-no", declineTarget });
      continue;
    }

    const itemLoad = clean.match(
      /^lb\s+bc\s*,\s*([A-Z][A-Z0-9_]*)\s*,\s*([^\s;]+)\s*$/i,
    );
    if (itemLoad) {
      pendingItem = { item: itemLoad[1], quantity: itemLoad[2] };
      continue;
    }

    if (/^call\s+GiveItem\b/i.test(clean) && pendingItem) {
      const failureTarget = withoutComment(lines[index + 1] ?? "").match(
        /^(?:jr|jp)\s+nc\s*,\s*([A-Za-z_.][A-Za-z0-9_.]*)\b/i,
      )?.[1];
      insights.push({
        type: "give-item",
        ...pendingItem,
        failureTarget,
      });
      pendingItem = null;
      continue;
    }

    if (/^call\s+GivePokemon\b/i.test(clean)) {
      const pair = recentBcPair(lines, index, 12);
      if (pair) {
        const failureTarget = withoutComment(lines[index + 1] ?? "").match(
          /^(?:jr|jp)\s+nc\s*,\s*([A-Za-z_.][A-Za-z0-9_.]*)\b/i,
        )?.[1];
        insights.push({
          type: "give-pokemon",
          species: pair.first,
          level: pair.second,
          failureTarget,
        });
      }
      continue;
    }

    if (/^call\s+IsItemInBag\b/i.test(clean)) {
      const item = recentRegisterValue(lines, index, "b", 8) ?? undefined;
      const branch = withoutComment(lines[index + 1] ?? "").match(
        /^(?:jr|jp)\s+z\s*,\s*([A-Za-z_.][A-Za-z0-9_.]*)\b/i,
      );
      insights.push({
        type: "inventory",
        action: "has-item",
        item,
        failureTarget: branch?.[1],
      });
      continue;
    }

    if (/^predef\s+GetQuantityOfItemInBag\b/i.test(clean)) {
      insights.push({
        type: "inventory",
        action: "quantity",
        item: recentRegisterValue(lines, index, "b", 8) ?? undefined,
      });
      continue;
    }

    if (/^(?:call|farcall)\s+RemoveItemByID(?:Bank[0-9A-F]+)?\b/i.test(clean)) {
      const item = recentStoredAValue(
        lines,
        index,
        /^ldh?\s+\[hItemToRemoveID\]\s*,\s*a\b/i,
      ) ?? recentRegisterValue(lines, index, "a", 8) ?? undefined;
      insights.push({ type: "remove-item", item });
      continue;
    }

    if (/^predef\s+DoInGameTradeDialogue\b/i.test(clean)) {
      const trade = recentStoredAValue(
        lines,
        index,
        /^ld\s+\[wWhichTrade\]\s*,\s*a\b/i,
      ) ?? undefined;
      insights.push({ type: "trade", trade });
      continue;
    }

    if (/^call\s+PlayCry\b/i.test(clean)) {
      insights.push({
        type: "cry",
        species: recentRegisterValue(lines, index, "a", 8) ?? undefined,
      });
      continue;
    }

    if (/^call\s+DisplayPokedex\b/i.test(clean)) {
      insights.push({
        type: "pokedex",
        species: recentRegisterValue(lines, index, "a", 8) ?? undefined,
      });
      continue;
    }

    const objectAction = clean.match(/^predef\s+(ShowObject|HideObject)\b/i)?.[1];
    if (objectAction) {
      insights.push({
        type: "object",
        action: objectAction.toLowerCase().startsWith("show") ? "show" : "hide",
        object: recentRegisterValue(lines, index, "a") ?? undefined,
      });
      continue;
    }

    const call = clean.match(/^call\s+([A-Za-z_][A-Za-z0-9_]*)\b/i)?.[1];
    if (call && printWrappers.has(call)) {
      insights.push({ type: "dialogue", label: call });
      continue;
    }
    if (call && objectWrappers.has(call)) {
      insights.push({
        type: "object",
        action: objectWrappers.get(call)!,
        object: recentRegisterValue(lines, index, "a") ?? undefined,
      });
      continue;
    }

    if (call === "TalkToTrainer") {
      insights.push({
        type: "trainer",
        trainerHeader: recentRegisterValue(lines, index, "hl") ?? undefined,
      });
      continue;
    }

    const jump = clean.match(
      /^(?:jr|jp)\s+([A-Za-z_][A-Za-z0-9_]*)\b/i,
    )?.[1];
    if (jump && trainerHelpers.has(jump)) {
      insights.push({
        type: "trainer",
        trainerHeader: recentRegisterValue(lines, index, "hl") ?? undefined,
      });
      continue;
    }

    if (call === "EngageMapTrainer" || call === "InitBattleEnemyParameters") {
      if (!insights.some((insight) =>
        insight.type === "battle" && insight.routine === call
      )) {
        insights.push({ type: "battle", routine: call });
      }
      continue;
    }

    if (call === "DelayFrames") {
      insights.push({
        type: "wait",
        frames: recentRegisterValue(lines, index, "c") ?? undefined,
      });
      continue;
    }

    if (/^predef\s+EmotionBubble\b/i.test(clean)) {
      let bubble: string | undefined;
      for (
        let probe = index - 1;
        probe >= Math.max(1, index - 8);
        probe -= 1
      ) {
        if (
          /^ld\s+\[wWhichEmotionBubble\]\s*,\s*a\b/i.test(
            withoutComment(lines[probe]),
          )
        ) {
          bubble = recentRegisterValue(lines, probe, "a") ?? undefined;
          break;
        }
      }
      insights.push({ type: "emotion", bubble });
      continue;
    }

    const scriptConstant = clean.match(
      /^ld\s+a\s*,\s*(SCRIPT_[A-Z0-9_]+)\b/i,
    )?.[1];
    if (scriptConstant) {
      for (
        let probe = index + 1;
        probe <= Math.min(lines.length - 1, index + 4);
        probe += 1
      ) {
        const helper = withoutComment(lines[probe]).match(
          /^call\s+([A-Za-z_][A-Za-z0-9_]*)\b/i,
        )?.[1];
        if (helper && setters.has(helper)) {
          insights.push({ type: "transition", scriptConstant });
          break;
        }
      }
    }
  }

  return insights.filter((insight, index, entries) =>
    entries.findIndex((candidate) =>
      JSON.stringify(candidate) === JSON.stringify(insight)
    ) === index
  );
}
