import { Fragment, useMemo } from "react";
import {
  structuredMapScriptFlow,
  type MapScriptBranchOutcome,
  type MapScriptCondition,
  type MapScriptFlowBranch,
  type MapScriptFlowItem,
  type MapScriptIfBlock,
} from "./core/mapScriptControlFlow";
import { mapScriptBattleHandoffs, type MapScriptBattleHandoff } from "./core/mapScriptBattleFlow";
import { resolvedDisplayedDialogueLabel } from "./core/mapScriptDialogueTarget";
import {
  findResolvedScriptPhaseDialogue,
  parseResolvedScriptDialogueSummary,
  type ResolvedScriptBattleDialogue,
  type ResolvedScriptPhaseDialogue,
} from "./core/mapScriptDialoguePreview";
import { renderMovementStep, type MapScriptOperationKind } from "./core/mapScriptOpcodes";
import {
  focusedMapScriptStates,
  parseMapScriptProgram,
  type MapScriptSemanticNode,
  type MapScriptState,
} from "./core/mapScriptProgram";
import type {
  ProjectEventMacroSemantic,
  ProjectMovementVocabulary,
  ScriptExternalRoutineSource,
  TrainerInteraction,
  TrainerInteractionDialogue,
} from "./core/types";
import { TextEditor, type TextEditorTarget } from "./TextEditor";
import {
  analyzeTextScript,
  type TextScriptInsight,
} from "./core/textScriptAnalysis";
import { analyzeSharedScriptRoutine } from "./core/sharedScriptAnalysis";
import "./MapScriptPreview.css";

export interface MapScriptPreviewReference {
  scriptPath: string;
  routineLabel: string;
  mapScriptSource: string;
  routineSource?: string | null;
  movementVocabulary?: ProjectMovementVocabulary;
  externalRoutines?: ScriptExternalRoutineSource[];
  eventMacroSemantics?: ProjectEventMacroSemantic[];
  interaction?: TrainerInteraction | null;
}

interface MapScriptPreviewProps {
  reference: MapScriptPreviewReference;
}

interface NodeDialoguePreview {
  text?: string;
  target?: TextEditorTarget;
  battle?: ResolvedScriptBattleDialogue;
}

function titleCaseConstant(value: string): string {
  return value
    .replace(/^\./, "")
    .replace(/^(EVENT|TEXT|OPP|MUSIC|SPRITE_FACING|PLAYER_DIR|NPC_MOVEMENT|PAD|SCRIPT|TOGGLE)_/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function pathStem(path: string): string {
  return path.split("/").pop()?.replace(/\.asm$/, "") ?? "";
}

function stateTitle(label: string): string {
  return titleCaseConstant(label.replace(/Script$/, ""));
}

function summaryStateTitle(label: string, scriptPath: string): string {
  let clean = label.replace(/^\./, "").replace(/Script$/, "");
  const stem = pathStem(scriptPath);
  if (stem && clean.startsWith(stem)) clean = clean.slice(stem.length);
  return titleCaseConstant(clean);
}

function variableTitle(variable: string): string {
  if (variable === "wXCoord") return "player X coordinate";
  if (variable === "wYCoord") return "player Y coordinate";
  if (variable === "wIsInBattle") return "battle status";
  return titleCaseConstant(variable.replace(/^w(?=[A-Z])/, "")).toLowerCase();
}

function actorTitle(actor: string): string {
  const slot = actor.match(/^SPRITE_SLOT_([0-9A-F]+)$/i)?.[1];
  return slot ? `Sprite slot ${slot}` : titleCaseConstant(actor);
}

function provenanceConditionText(value: string): string {
  const routine = value.match(
    /^([A-Za-z_][A-Za-z0-9_]*)\(([^)]+)\) returned (carry|without carry)$/i,
  );
  if (routine) {
    const routineName = routine[1];
    const argument = titleCaseConstant(routine[2]);
    const carried = routine[3].toLowerCase() === "carry";
    if (/coords?.*in.*array|in.*coords?.*array/i.test(routineName)) {
      return `player is ${carried ? "inside" : "outside"} ${argument}`;
    }
    return `${titleCaseConstant(routineName)} for ${argument} ${carried ? "succeeded" : "did not signal carry"}`;
  }

  const event = value.match(/^(EVENT_[A-Z0-9_]+)\s*(=|≠)\s*clear$/i);
  if (event) {
    return `${titleCaseConstant(event[1])} ${event[2] === "=" ? "has not happened" : "has happened"}`;
  }

  const comparison = value.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(=|≠)\s*(.+)$/);
  if (comparison) {
    const left = comparison[1].startsWith("w")
      ? variableTitle(comparison[1])
      : titleCaseConstant(comparison[1]);
    return `${left} ${comparison[2] === "=" ? "is" : "is not"} ${titleCaseConstant(comparison[3])}`;
  }

  return value;
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

function textEditorTarget(
  reference: MapScriptPreviewReference,
  sourceLabel: string | undefined,
): TextEditorTarget | null {
  if (!sourceLabel) return null;
  let wrapperLabel = sourceLabel;
  if (sourceLabel.startsWith("TEXT_")) {
    wrapperLabel = textPointerLabels(reference.mapScriptSource).get(sourceLabel) ?? "";
  }
  if (!wrapperLabel || wrapperLabel.startsWith(".")) return null;
  return { path: reference.scriptPath, label: wrapperLabel };
}

function iconFor(kind: MapScriptOperationKind): string {
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
    case "control": return "⌘";
    case "flag": return "◇";
    case "screen": return "◐";
    case "map": return "▦";
    case "transition": return "→";
  }
}

function nodeDetails(node: MapScriptSemanticNode): Array<{ label: string; value: string; path?: boolean }> {
  switch (node.type) {
    case "movement": {
      const path = node.path.map(renderMovementStep).join(" · ");
      const conditionalPaths = node.alternatives.length > 1
        ? node.alternatives.map((alternative, index) => {
            const rendered = alternative.path.map(renderMovementStep).join(" · ");
            const condition = alternative.conditions.length > 0
              ? alternative.conditions.map(provenanceConditionText).join(" AND ")
              : `Alternative ${index + 1}`;
            return {
              label: `If ${condition}`,
              value: rendered || titleCaseConstant(alternative.pathLabel),
              path: Boolean(rendered),
            };
          })
        : [];
      return [
        ...(node.actor === "character" && node.actorConstant
          ? [{ label: "Character", value: titleCaseConstant(node.actorConstant) }]
          : []),
        ...(node.guards ?? []).map((guard) => ({
          label: "Runs when",
          value: guard,
        })),
        ...conditionalPaths,
        ...(conditionalPaths.length === 0 && path
          ? [{ label: "Path", value: path, path: true }]
          : []),
        ...(conditionalPaths.length === 0 && !path && node.pathLabel
          ? [{ label: "Movement", value: titleCaseConstant(node.pathLabel) }]
          : []),
      ];
    }
    case "dialogue":
      return node.textLabel ? [{ label: "Text source", value: titleCaseConstant(node.textLabel) }] : [];
    case "battle-dialogue":
      return [
        ...(node.playerWins ? [{ label: "Win text source", value: titleCaseConstant(node.playerWins) }] : []),
        ...(node.playerLoses ? [{ label: "Loss text source", value: titleCaseConstant(node.playerLoses) }] : []),
      ];
    case "opponent":
      return [
        ...(node.opponent ? [{ label: "Opponent", value: titleCaseConstant(node.opponent) }] : []),
        ...(node.trainerNo ? [{ label: "Trainer party", value: titleCaseConstant(node.trainerNo) }] : []),
      ];
    case "wait":
      return node.frames !== undefined ? [{ label: "Duration", value: `${node.frames} frame${node.frames === 1 ? "" : "s"}` }] : [];
    case "event":
      return node.events && node.events.length > 1
        ? [{ label: "Events", value: node.events.map(titleCaseConstant).join(" · ") }]
        : [{ label: "Event", value: titleCaseConstant(node.event) }];
    case "condition":
      return [
        { label: "Condition", value: node.condition },
        ...(node.branchTarget ? [{ label: "If true", value: titleCaseConstant(node.branchTarget) }] : []),
      ];
    case "transition":
      return [{ label: "Next state", value: node.targetLabel ? stateTitle(node.targetLabel) : titleCaseConstant(node.targetConstant) }];
    case "object":
      return node.alternatives && node.alternatives.length > 1
        ? node.alternatives.map((alternative, index) => ({
            label: alternative.conditions.length > 0
              ? `If ${alternative.conditions.map(provenanceConditionText).join(" AND ")}`
              : `Alternative ${index + 1}`,
            value: titleCaseConstant(alternative.value),
          }))
        : node.object
          ? [{ label: "Object", value: titleCaseConstant(node.object) }]
          : [];
    case "music":
      return node.music ? [{ label: "Music", value: titleCaseConstant(node.music) }] : [];
    case "facing": {
      const facingLabel = (value: string) => value === "0"
        ? "Down"
        : titleCaseConstant(value).replace(/^Sprite Facing /i, "");
      return [
        ...(node.actor ? [{ label: "Character", value: actorTitle(node.actor) }] : []),
        ...(node.alternatives && node.alternatives.length > 1
          ? node.alternatives.map((alternative, index) => ({
              label: alternative.conditions.length > 0
                ? `If ${alternative.conditions.map(provenanceConditionText).join(" AND ")}`
                : `Facing option ${index + 1}`,
              value: facingLabel(alternative.value),
            }))
          : node.facing
            ? [{ label: "Facing", value: facingLabel(node.facing) }]
            : []),
      ];
    }
    case "recovery":
      return [];
    case "control": {
      const alternatives = node.alternatives && node.alternatives.length > 1
        ? node.alternatives.map((alternative, index) => ({
            label: alternative.conditions.length > 0
              ? `If ${alternative.conditions.map(provenanceConditionText).join(" AND ")}`
              : `Input mode ${index + 1}`,
            value: alternative.value === "0"
              ? "No inputs ignored"
              : titleCaseConstant(alternative.value),
          }))
        : [];
      return [
        ...alternatives,
        ...(alternatives.length === 0 && node.value
          ? [{
              label: node.control === "player-input" ? "Ignored input mask" : "Value",
              value: node.value === "0"
                ? "0"
                : titleCaseConstant(node.value),
            }]
          : []),
      ];
    }
    case "flag":
      return [
        { label: "Flag", value: titleCaseConstant(node.flag.replace(/^BIT_/, "")) },
        { label: "Stored in", value: variableTitle(node.variable) },
        { label: "Action", value: node.action === "set" ? "Set" : "Clear" },
      ];
    case "screen":
      return [];
    case "map-edit":
      return [
        ...(node.block ? [{ label: "Block", value: titleCaseConstant(node.block) }] : []),
        ...(node.x && node.y ? [{ label: "Map coordinate", value: `(${node.x}, ${node.y})` }] : []),
      ];
    case "indexed-event":
      return [
        { label: "Base event", value: titleCaseConstant(node.baseEvent) },
        ...(node.relatedEvent ? [{ label: "Related event", value: titleCaseConstant(node.relatedEvent) }] : []),
        ...(node.destination ? [{ label: "Result", value: titleCaseConstant(node.destination) }] : []),
      ];
    case "object-puzzle":
      return node.coordinates
        ? [{ label: "Target coordinates", value: titleCaseConstant(node.coordinates) }]
        : [];
    case "warp":
      return [
        ...(node.destinationMap ? [{ label: "Destination map", value: titleCaseConstant(node.destinationMap) }] : []),
        ...(node.coordinates ? [{ label: "Warp coordinates", value: titleCaseConstant(node.coordinates) }] : []),
      ];
  }
}

function conditionText(condition: MapScriptCondition): string {
  switch (condition.type) {
    case "event-state": {
      const base = `${titleCaseConstant(condition.event)} ${condition.state === "set" ? "has happened" : "has not happened"}`;
      if (condition.afterCheck === "set") {
        return `${base}; this check then remembers the event`;
      }
      if (condition.afterCheck === "reset") {
        return `${base}; this check then clears the event`;
      }
      return base;
    }
    case "event-group": {
      const events = condition.events.map(titleCaseConstant).join(" or ");
      switch (condition.state) {
        case "none-set": return `neither ${events} has happened`;
        case "any-set": return `at least one of ${events} has happened`;
        case "all-set": return `all of ${events} have happened`;
        case "not-all-set": return `not all of ${events} have happened`;
      }
    }
    case "battle-result":
      return condition.result === "lost" ? "the player lost the battle" : "the player did not lose the battle";
    case "variable-compare":
      return `${variableTitle(condition.variable)} ${condition.comparison === "equals" ? "is" : "is not"} ${titleCaseConstant(condition.value)}`;
    case "flag-state":
      return `${titleCaseConstant(condition.flag)} is ${condition.state === "set" ? "on" : "off"} in ${variableTitle(condition.variable)}`;
    case "routine-result": {
      if (
        condition.argument
        && /coords?.*in.*array|in.*coords?.*array/i.test(condition.routine)
      ) {
        return `the player is ${condition.result === "carry" ? "inside" : "outside"} ${titleCaseConstant(condition.argument)}`;
      }
      const argument = condition.argument
        ? ` for ${titleCaseConstant(condition.argument)}`
        : "";
      const result = condition.result === "carry"
        ? "returned carry"
        : "returned without carry";
      return `${titleCaseConstant(condition.routine)}${argument} ${result}`;
    }
  }
}

function branchOutcomeText(outcome: MapScriptBranchOutcome): string {
  switch (outcome.type) {
    case "continue":
      return "Continue with the next step";
    case "return":
      return "Stop this script state here";
    case "jump":
      return outcome.summary ?? `Continue at ${titleCaseConstant(outcome.target.replace(/Script$/, ""))}`;
    case "call":
      return outcome.summary ?? `Run ${titleCaseConstant(outcome.target.replace(/Script$/, ""))} and continue`;
  }
}

function flattenFlowNodes(items: MapScriptFlowItem[]): MapScriptSemanticNode[] {
  const result: MapScriptSemanticNode[] = [];
  for (const item of items) {
    if (item.type === "node") {
      result.push(item.node);
      continue;
    }
    result.push(...flattenFlowNodes(item.whenTrue.items));
    result.push(...flattenFlowNodes(item.whenFalse.items));
  }
  return result.sort((left, right) => left.source.lineStart - right.source.lineStart);
}

function interactionTarget(
  dialogue: TrainerInteractionDialogue | undefined,
): TextEditorTarget | undefined {
  return dialogue?.sourcePath && dialogue.textLabel
    ? { path: dialogue.sourcePath, label: dialogue.textLabel }
    : undefined;
}

function dialoguePreviewsForFlow(
  flow: MapScriptFlowItem[],
  phaseDialogue: ResolvedScriptPhaseDialogue | undefined,
  reference: MapScriptPreviewReference,
  state: MapScriptState,
  resumeLabels: Set<string>,
): Map<string, NodeDialoguePreview> {
  const previews = new Map<string, NodeDialoguePreview>();
  const role = state.label === reference.routineLabel
    ? "before-battle"
    : resumeLabels.has(state.label)
      ? "post-battle"
      : null;
  const dialogues = reference.interaction?.dialogues ?? [];
  const interactionDialogues = role
    ? dialogues.filter((dialogue) => dialogue.role === role)
    : [];
  const playerWins = dialogues.find((dialogue) => dialogue.role === "player-wins");
  const playerLoses = dialogues.find((dialogue) => dialogue.role === "player-loses");

  let dialogueIndex = 0;
  let battleDialogueIndex = 0;
  for (const node of flattenFlowNodes(flow)) {
    if (node.type === "dialogue") {
      const interaction = interactionDialogues[dialogueIndex];
      const text = interaction?.text ?? phaseDialogue?.dialogues[dialogueIndex];
      dialogueIndex += 1;
      if (text || interaction) {
        previews.set(node.id, {
          text: text ?? undefined,
          target: interactionTarget(interaction),
        });
      }
    } else if (node.type === "battle-dialogue") {
      const fallback = phaseDialogue?.battleDialogues[battleDialogueIndex];
      battleDialogueIndex += 1;
      const battle = {
        playerWins: playerWins?.text ?? fallback?.playerWins ?? null,
        playerLoses: playerLoses?.text ?? fallback?.playerLoses ?? null,
      };
      if (battle.playerWins || battle.playerLoses) previews.set(node.id, { battle });
    }
  }
  return previews;
}

function textScriptInsightText(insight: TextScriptInsight): string {
  switch (insight.type) {
    case "dialogue":
      return `Show ${titleCaseConstant(insight.label)}`;
    case "condition":
      return insight.branchTarget
        ? `If ${insight.description}: continue at ${titleCaseConstant(insight.branchTarget)}`
        : `If ${insight.description}`;
    case "choice":
      return insight.declineTarget
        ? `Ask Yes / No; No continues at ${titleCaseConstant(insight.declineTarget)}`
        : "Ask Yes / No";
    case "give-item":
      return `Give ${insight.quantity} × ${titleCaseConstant(insight.item)}${insight.failureTarget ? `; if the Bag is full, continue at ${titleCaseConstant(insight.failureTarget)}` : ""}`;
    case "give-pokemon":
      return `Give level ${insight.level} ${titleCaseConstant(insight.species)}${insight.failureTarget ? `; if the Pokémon cannot be received, continue at ${titleCaseConstant(insight.failureTarget)}` : ""}`;
    case "inventory":
      return insight.action === "has-item"
        ? `Check whether the Bag contains ${insight.item ? titleCaseConstant(insight.item) : "the selected item"}${insight.failureTarget ? `; if not, continue at ${titleCaseConstant(insight.failureTarget)}` : ""}`
        : `Check the Bag quantity of ${insight.item ? titleCaseConstant(insight.item) : "the selected item"}`;
    case "remove-item":
      return `Remove ${insight.item ? titleCaseConstant(insight.item) : "the selected item"} from the Bag`;
    case "trade":
      return insight.trade
        ? `Start in-game trade ${titleCaseConstant(insight.trade)}`
        : "Start the selected in-game trade";
    case "cry":
      return insight.species
        ? `Play ${titleCaseConstant(insight.species)}'s cry`
        : "Play the selected Pokémon's cry";
    case "pokedex":
      return insight.species
        ? `Show ${titleCaseConstant(insight.species)} in the Pokédex`
        : "Show the selected Pokémon in the Pokédex";
    case "event":
      return `${titleCaseConstant(insight.action)}: ${insight.events.map(titleCaseConstant).join(" · ")}`;
    case "object":
      return `${insight.action === "show" ? "Show" : "Hide"} ${insight.object ? titleCaseConstant(insight.object) : "map object"}`;
    case "trainer":
      return insight.trainerHeader
        ? `Start trainer interaction using ${titleCaseConstant(insight.trainerHeader)}`
        : "Start trainer interaction";
    case "battle":
      return insight.routine === "EngageMapTrainer"
        ? "Engage the selected map trainer"
        : "Initialize battle enemy parameters";
    case "transition":
      return `Advance map script to ${titleCaseConstant(insight.scriptConstant)}`;
    case "wait":
      return insight.frames ? `Wait ${insight.frames} frames` : "Wait";
    case "emotion":
      return insight.bubble
        ? `Show ${titleCaseConstant(insight.bubble)} emotion bubble`
        : "Show emotion bubble";
    case "control":
      return insight.action === "auto-advance-dialogue"
        ? "Auto-advance the next dialogue without waiting for a button press"
        : "Restore normal wait-for-button dialogue behavior";
    case "facing":
      return `Set the player's scripted direction to ${titleCaseConstant(insight.direction).replace(/^Player Dir /i, "")}`;
    case "battle-dialogue": {
      const labels = [insight.playerWins, insight.playerLoses]
        .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
        .map(titleCaseConstant);
      return labels.length > 0
        ? `Prepare battle-result dialogue: ${labels.join(" / ")}`
        : "Prepare battle-result dialogue";
    }
  }
}

function TextScriptLogic({
  label,
  reference,
}: {
  label: string | null;
  reference: MapScriptPreviewReference;
}) {
  if (!label || label.startsWith("TEXT_")) return null;
  const insights = analyzeTextScript(
    reference.mapScriptSource,
    label,
    reference.eventMacroSemantics,
  );
  if (insights.length === 0) return null;

  return (
    <details className="map-script-source-detail">
      <summary>Interaction logic · {insights.length} recognized step{insights.length === 1 ? "" : "s"}</summary>
      <ol className="map-script-dialogue-logic">
        {insights.map((insight, index) => (
          <li key={`${index}:${JSON.stringify(insight)}`}>
            {textScriptInsightText(insight)}
          </li>
        ))}
      </ol>
    </details>
  );
}

function DialoguePreview({
  preview,
  node,
  reference,
  state,
}: {
  preview: NodeDialoguePreview | undefined;
  node: Extract<MapScriptSemanticNode, { type: "dialogue" }>;
  reference: MapScriptPreviewReference;
  state: MapScriptState;
}) {
  const displayedLabel = resolvedDisplayedDialogueLabel(
    reference.mapScriptSource,
    state,
    node,
  );
  return (
    <div className="map-script-dialogue-preview">
      <TextEditor
        title="Dialogue"
        target={preview?.target ?? textEditorTarget(reference, displayedLabel ?? node.textLabel)}
        initialText={preview?.target ? null : preview?.text ?? null}
      />
      <TextScriptLogic
        label={displayedLabel ?? (
          node.textLabel?.startsWith("TEXT_")
            ? textPointerLabels(reference.mapScriptSource).get(node.textLabel) ?? null
            : node.textLabel ?? null
        )}
        reference={reference}
      />
      {displayedLabel && displayedLabel !== node.textLabel && (
        <small className="map-script-dialogue-resolution">
          Displayed text: <code>{displayedLabel}</code>
        </small>
      )}
    </div>
  );
}

function PreparedBattleDialogue() {
  return (
    <div className="map-script-prepared-dialogue">
      <strong>Prepared here; displayed during the battle.</strong>
      <p>
        Yellow Editor shows the editable win/loss text once, in the Battle step
        where the player actually sees it.
      </p>
    </div>
  );
}

function BattleHandoffCard({
  handoff,
  preview,
  reference,
}: {
  handoff: MapScriptBattleHandoff;
  preview: ResolvedScriptBattleDialogue | undefined;
  reference: MapScriptPreviewReference;
}) {
  const dialogues = reference.interaction?.dialogues ?? [];
  const playerWins = dialogues.find((dialogue) => dialogue.role === "player-wins");
  const playerLoses = dialogues.find((dialogue) => dialogue.role === "player-loses");
  return (
    <section className="map-script-battle-handoff">
      <div className="map-script-battle-handoff-heading">
        <span>
          <small>Between script states</small>
          <strong>Trainer battle</strong>
        </span>
        <span className="editable-badge">Battle dialogue editable</span>
      </div>
      <p className="help-text">
        The map script has finished preparing the encounter. The battle engine
        takes over here, chooses the appropriate result dialogue, then resumes
        the map event afterward.
      </p>
      {handoff.opponent && (
        <span className="map-script-detail">
          <small>Opponent</small>
          <code>{titleCaseConstant(handoff.opponent)}</code>
        </span>
      )}
      <div className="map-script-dialogue-outcomes">
        <div className="map-script-dialogue-preview">
          <TextEditor
            title="If the player wins — display dialogue"
            target={interactionTarget(playerWins) ?? textEditorTarget(reference, handoff.playerWins)}
            initialText={playerWins?.text ?? preview?.playerWins ?? null}
          />
        </div>
        <div className="map-script-dialogue-preview">
          <TextEditor
            title="If the player loses — display dialogue"
            target={interactionTarget(playerLoses) ?? textEditorTarget(reference, handoff.playerLoses)}
            initialText={playerLoses?.text ?? preview?.playerLoses ?? null}
          />
        </div>
      </div>
      <div className="map-script-battle-resume">
        <small>After the battle</small>
        <span>Resume at <strong>{stateTitle(handoff.resumeStateLabel)}</strong></span>
        <code>{handoff.resumeStateLabel}</code>
      </div>
      <details className="map-script-source-detail">
        <summary>
          Dialogue preparation source lines {handoff.preparationSource.lineStart}
          {handoff.preparationSource.lineEnd !== handoff.preparationSource.lineStart
            ? `–${handoff.preparationSource.lineEnd}`
            : ""}
        </summary>
        <pre className="trainer-script-source">
          <code>{handoff.preparationSource.raw}</code>
        </pre>
      </details>
    </section>
  );
}

function ScriptNodeCard({
  node,
  index,
  dialoguePreview,
  reference,
  state,
  nested = false,
}: {
  node: MapScriptSemanticNode;
  index: number;
  dialoguePreview?: NodeDialoguePreview;
  reference: MapScriptPreviewReference;
  state: MapScriptState;
  nested?: boolean;
}) {
  const details = nodeDetails(node);
  const description = node.type === "wait" && node.reason ? node.reason : node.description;
  return (
    <li className={`map-script-step map-script-step-${node.kind}${nested ? " nested" : ""}`}>
      <span className="map-script-step-number">{index + 1}</span>
      <span className="map-script-step-icon" aria-hidden="true">{iconFor(node.kind)}</span>
      <div className="map-script-step-body">
        <div className="map-script-step-title-row">
          <strong>{
            node.type === "flag" && node.flag === "BIT_NO_BATTLES"
              ? node.action === "set" ? "Disable battles in this area" : "Allow battles in this area"
              : node.type === "flag" && node.flag === "BIT_PRINT_END_BATTLE_TEXT"
                ? node.action === "set" ? "Enable end-of-battle dialogue" : "Disable end-of-battle dialogue"
                : node.type === "flag" && node.flag === "BIT_TALKED_TO_TRAINER"
                  ? node.action === "set" ? "Mark trainer interaction active" : "Clear trainer interaction state"
                  : node.title
          }</strong>
          {node.source.confidence === "inferred" && <small className="map-script-confidence">Inferred</small>}
        </div>
        {description && <p>{description}</p>}
        {node.type === "dialogue" && (
          <DialoguePreview
            preview={dialoguePreview}
            node={node}
            reference={reference}
            state={state}
          />
        )}
        {node.type === "battle-dialogue" && <PreparedBattleDialogue />}
        {details.map((detail) => detail.path ? (
          <div key={`${detail.label}:${detail.value}`} className="map-script-path-detail">
            <small>{detail.label}</small>
            <code className="map-script-path">{detail.value}</code>
          </div>
        ) : (
          <span className="map-script-detail" key={`${detail.label}:${detail.value}`}>
            <small>{detail.label}</small>
            <code>{detail.value}</code>
          </span>
        ))}
        <details className="map-script-source-detail">
          <summary>Source lines {node.source.lineStart}{node.source.lineEnd !== node.source.lineStart ? `–${node.source.lineEnd}` : ""}</summary>
          <pre className="trainer-script-source"><code>{node.source.raw}</code></pre>
        </details>
      </div>
    </li>
  );
}

interface FlowListProps {
  items: MapScriptFlowItem[];
  previews: Map<string, NodeDialoguePreview>;
  reference: MapScriptPreviewReference;
  state: MapScriptState;
  nested?: boolean;
}

function BranchBody({
  branch,
  previews,
  reference,
  state,
}: {
  branch: MapScriptFlowBranch;
  previews: Map<string, NodeDialoguePreview>;
  reference: MapScriptPreviewReference;
  state: MapScriptState;
}) {
  const showOutcome = branch.outcome.type !== "continue" || branch.items.length === 0;
  return (
    <>
      {branch.items.length > 0 && (
        <FlowList
          items={branch.items}
          previews={previews}
          reference={reference}
          state={state}
          nested
        />
      )}
      {showOutcome && (
        <div className="map-script-branch-outcome">
          <span>{branchOutcomeText(branch.outcome)}</span>
          {(branch.outcome.type === "jump" || branch.outcome.type === "call") && <code>{branch.outcome.target}</code>}
          {(branch.outcome.type === "jump" || branch.outcome.type === "call") && branch.outcome.targetSource && (
            <details className="map-script-source-detail">
              <summary>Advanced: target routine source</summary>
              <pre className="trainer-script-source"><code>{branch.outcome.targetSource.raw}</code></pre>
            </details>
          )}
        </div>
      )}
    </>
  );
}

function IfBlockCard({
  block,
  index,
  previews,
  reference,
  state,
  nested = false,
}: {
  block: MapScriptIfBlock;
  index: number;
  previews: Map<string, NodeDialoguePreview>;
  reference: MapScriptPreviewReference;
  state: MapScriptState;
  nested?: boolean;
}) {
  return (
    <li className={`map-script-step map-script-step-condition map-script-if-step${nested ? " nested" : ""}`}>
      <span className="map-script-step-number">{index + 1}</span>
      <span className="map-script-step-icon" aria-hidden="true">?</span>
      <div className="map-script-step-body">
        <div className="map-script-step-title-row">
          <strong>If {conditionText(block.condition)}</strong>
        </div>
        <div className="map-script-branches">
          <div className="map-script-branch">
            <small>Then</small>
            <BranchBody
              branch={block.whenTrue}
              previews={previews}
              reference={reference}
              state={state}
            />
          </div>
          <div className="map-script-branch">
            <small>Otherwise</small>
            <BranchBody
              branch={block.whenFalse}
              previews={previews}
              reference={reference}
              state={state}
            />
          </div>
        </div>
        <details className="map-script-source-detail">
          <summary>Source lines {block.source.lineStart}{block.source.lineEnd !== block.source.lineStart ? `–${block.source.lineEnd}` : ""}</summary>
          <pre className="trainer-script-source"><code>{block.source.raw}</code></pre>
        </details>
      </div>
    </li>
  );
}

function FlowList({ items, previews, reference, state, nested = false }: FlowListProps) {
  return (
    <ol className={nested ? "map-script-branch-step-list" : "map-script-step-list"}>
      {items.map((item, index) => item.type === "if" ? (
        <IfBlockCard
          block={item}
          index={index}
          previews={previews}
          reference={reference}
          state={state}
          nested={nested}
          key={item.id}
        />
      ) : (
        <ScriptNodeCard
          node={item.node}
          index={index}
          key={item.node.id}
          dialoguePreview={previews.get(item.node.id)}
          reference={reference}
          state={state}
          nested={nested}
        />
      ))}
    </ol>
  );
}

function stateRole(state: MapScriptState, focusLabel: string, index: number, focusIndex: number): string {
  if (state.label === focusLabel) return "Current state";
  if (index < focusIndex) return "Before this state";
  return "Next state";
}

export function MapScriptPreview({ reference }: MapScriptPreviewProps) {
  const model = useMemo(() => {
    const program = parseMapScriptProgram(
      reference.mapScriptSource,
      reference.routineLabel,
      reference.movementVocabulary,
      reference.eventMacroSemantics,
    );
    const states = focusedMapScriptStates(program, reference.routineLabel, 1, 1);
    const dialoguePhases = parseResolvedScriptDialogueSummary(reference.routineSource ?? "");
    const battleHandoffs = mapScriptBattleHandoffs(program, reference.mapScriptSource);
    const resumeLabels = new Set(battleHandoffs.map((handoff) => handoff.resumeStateLabel));
    return { states, dialoguePhases, battleHandoffs, resumeLabels };
  }, [
    reference.mapScriptSource,
    reference.routineLabel,
    reference.routineSource,
    reference.movementVocabulary,
    reference.eventMacroSemantics,
  ]);

  if (model.states.length === 0) {
    return (
      <div className="map-script-preview">
        <p className="empty-state">Yellow Editor could not isolate this routine safely. Use the advanced source below to review it.</p>
      </div>
    );
  }

  const focusIndex = model.states.findIndex((state) => state.label === reference.routineLabel);

  return (
    <div className="map-script-preview">
      <div className="map-script-preview-heading">
        <div>
          <h5>Event flow</h5>
          <p className="help-text">Yellow Editor follows script states, shows and edits resolved dialogue, and nests recognized branch actions directly inside beginner-friendly If / Then / Otherwise blocks.</p>
        </div>
        <span className="editable-badge">Dialogue editable</span>
      </div>

      <div className="map-script-state-list">
        {model.states.map((state, stateIndex) => {
          const flow = structuredMapScriptFlow(
            state,
            reference.mapScriptSource,
            reference.eventMacroSemantics,
          );
          const externalRoutine = state.external
            ? reference.externalRoutines?.find((routine) => routine.label === state.label)
            : undefined;
          const phaseDialogue = findResolvedScriptPhaseDialogue(
            model.dialoguePhases,
            summaryStateTitle(state.label, reference.scriptPath),
          );
          const previews = dialoguePreviewsForFlow(
            flow,
            phaseDialogue ?? undefined,
            reference,
            state,
            model.resumeLabels,
          );
          const handoff = model.battleHandoffs.find(
            (candidate) => candidate.setupStateLabel === state.label,
          );
          const battlePreview = handoff?.preparationNodeId
            ? previews.get(handoff.preparationNodeId)?.battle
            : undefined;

          return (
            <Fragment key={state.label}>
            <details
              className={`map-script-state${state.label === reference.routineLabel ? " current" : ""}`}
              open={model.states.length <= 3 || state.label === reference.routineLabel}
            >
              <summary>
                <span>
                  <small>{stateRole(state, reference.routineLabel, stateIndex, focusIndex)}</small>
                  <strong>{stateTitle(state.label)}</strong>
                </span>
                <code>{state.scriptConstant ?? state.label}</code>
              </summary>
              <div className="map-script-state-body">
                {state.label === reference.routineLabel && (
                  <TextScriptLogic label={state.label} reference={reference} />
                )}
                {state.external ? (
                  <div className="empty-state">
                    <p>
                      This state points to a shared project routine outside this map script.
                      Yellow Editor keeps it in the state machine instead of dropping the entry.
                    </p>
                    {externalRoutine ? (
                      <>
                        <p>
                          Resolved project source: <code>{externalRoutine.path}:{externalRoutine.startLine}</code>
                        </p>
                        {(() => {
                          const insights = analyzeSharedScriptRoutine(externalRoutine.source);
                          return insights.length > 0 ? (
                            <ol className="map-script-dialogue-logic">
                              {insights.map((insight, index) => (
                                <li key={`${index}:${insight.title}`}>
                                  <strong>{insight.title}</strong>
                                  {insight.detail ? <> — {insight.detail}</> : null}
                                </li>
                              ))}
                            </ol>
                          ) : null;
                        })()}
                        <details className="map-script-source-detail">
                          <summary>View shared routine source</summary>
                          <pre className="trainer-script-source"><code>{externalRoutine.source}</code></pre>
                        </details>
                      </>
                    ) : (
                      <p>No unique project definition was resolved for this routine.</p>
                    )}
                  </div>
                ) : flow.length === 0 ? (
                  <p className="empty-state">No semantic operations are recognized in this state yet. The original source remains available below.</p>
                ) : (
                  <FlowList
                    items={flow}
                    previews={previews}
                    reference={reference}
                    state={state}
                  />
                )}
              </div>
            </details>
            {handoff && (
              <BattleHandoffCard
                handoff={handoff}
                preview={battlePreview}
                reference={reference}
              />
            )}
            </Fragment>
          );
        })}
      </div>

      {reference.routineSource && (
        <details className="trainer-full-script map-script-resolved-summary">
          <summary>View resolved plain-language summary</summary>
          <pre className="trainer-script-source"><code>{reference.routineSource}</code></pre>
        </details>
      )}
    </div>
  );
}
