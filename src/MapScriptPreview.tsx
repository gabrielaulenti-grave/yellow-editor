import { useMemo } from "react";
import {
  structuredMapScriptFlow,
  type MapScriptBranchOutcome,
  type MapScriptCondition,
  type MapScriptIfBlock,
} from "./core/mapScriptControlFlow";
import {
  findResolvedScriptPhaseDialogue,
  parseResolvedScriptDialogueSummary,
  type ResolvedScriptBattleDialogue,
} from "./core/mapScriptDialoguePreview";
import { renderMovementStep, type MapScriptOperationKind } from "./core/mapScriptOpcodes";
import {
  focusedMapScriptStates,
  parseMapScriptProgram,
  type MapScriptSemanticNode,
  type MapScriptState,
} from "./core/mapScriptProgram";
import type { TrainerScriptReference } from "./core/types";
import "./MapScriptPreview.css";

interface MapScriptPreviewProps {
  reference: TrainerScriptReference;
}

interface NodeDialoguePreview {
  text?: string;
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
    case "transition": return "→";
  }
}

function nodeDetails(node: MapScriptSemanticNode): Array<{ label: string; value: string; path?: boolean }> {
  switch (node.type) {
    case "movement": {
      const path = node.path.map(renderMovementStep).join(" · ");
      return [
        ...(node.actor === "character" && node.actorConstant
          ? [{ label: "Character", value: titleCaseConstant(node.actorConstant) }]
          : []),
        ...(path ? [{ label: "Path", value: path, path: true }] : []),
        ...(!path && node.pathLabel ? [{ label: "Movement", value: titleCaseConstant(node.pathLabel) }] : []),
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
      return node.opponent ? [{ label: "Opponent", value: titleCaseConstant(node.opponent) }] : [];
    case "wait":
      return node.frames !== undefined ? [{ label: "Duration", value: `${node.frames} frame${node.frames === 1 ? "" : "s"}` }] : [];
    case "event":
      return [{ label: "Event", value: titleCaseConstant(node.event) }];
    case "condition":
      return [
        { label: "Condition", value: node.condition },
        ...(node.branchTarget ? [{ label: "If true", value: titleCaseConstant(node.branchTarget) }] : []),
      ];
    case "transition":
      return [{ label: "Next state", value: node.targetLabel ? stateTitle(node.targetLabel) : titleCaseConstant(node.targetConstant) }];
    case "object":
      return node.object ? [{ label: "Object", value: titleCaseConstant(node.object) }] : [];
    case "music":
      return node.music ? [{ label: "Music", value: titleCaseConstant(node.music) }] : [];
    case "facing":
      return [
        ...(node.actor ? [{ label: "Character", value: titleCaseConstant(node.actor) }] : []),
        ...(node.facing ? [{ label: "Facing", value: node.facing === "0" ? "Down" : titleCaseConstant(node.facing) }] : []),
      ];
    case "recovery":
      return [];
  }
}

function conditionText(condition: MapScriptCondition): string {
  switch (condition.type) {
    case "event-state":
      return `${titleCaseConstant(condition.event)} ${condition.state === "set" ? "has happened" : "has not happened"}`;
    case "battle-result":
      return condition.result === "lost" ? "the player lost the battle" : "the player did not lose the battle";
    case "variable-compare":
      return `${variableTitle(condition.variable)} ${condition.comparison === "equals" ? "is" : "is not"} ${titleCaseConstant(condition.value)}`;
    case "flag-state":
      return `${titleCaseConstant(condition.flag)} is ${condition.state === "set" ? "on" : "off"} in ${variableTitle(condition.variable)}`;
  }
}

function branchOutcomeText(outcome: MapScriptBranchOutcome): string {
  switch (outcome.type) {
    case "continue":
      return "Continue with the next step";
    case "return":
      return "Stop this script state here";
    case "jump":
      return `Continue at ${titleCaseConstant(outcome.target.replace(/Script$/, ""))}`;
  }
}

function DialoguePreview({ preview }: { preview: NodeDialoguePreview }) {
  if (preview.text) {
    return (
      <div className="map-script-dialogue-preview">
        <small>Dialogue</small>
        <p>“{preview.text}”</p>
      </div>
    );
  }

  if (preview.battle) {
    return (
      <div className="map-script-dialogue-outcomes">
        {preview.battle.playerWins && (
          <div className="map-script-dialogue-preview">
            <small>If the player wins</small>
            <p>“{preview.battle.playerWins}”</p>
          </div>
        )}
        {preview.battle.playerLoses && (
          <div className="map-script-dialogue-preview">
            <small>If the player loses</small>
            <p>“{preview.battle.playerLoses}”</p>
          </div>
        )}
      </div>
    );
  }

  return null;
}

function ScriptNodeCard({
  node,
  index,
  dialoguePreview,
}: {
  node: MapScriptSemanticNode;
  index: number;
  dialoguePreview?: NodeDialoguePreview;
}) {
  const details = nodeDetails(node);
  const description = node.type === "wait" && node.reason ? node.reason : node.description;
  return (
    <li className={`map-script-step map-script-step-${node.kind}`}>
      <span className="map-script-step-number">{index + 1}</span>
      <span className="map-script-step-icon" aria-hidden="true">{iconFor(node.kind)}</span>
      <div className="map-script-step-body">
        <div className="map-script-step-title-row">
          <strong>{node.title}</strong>
          {node.source.confidence === "inferred" && <small className="map-script-confidence">Inferred</small>}
        </div>
        {description && <p>{description}</p>}
        {dialoguePreview && <DialoguePreview preview={dialoguePreview} />}
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

function IfBlockCard({ block, index }: { block: MapScriptIfBlock; index: number }) {
  return (
    <li className="map-script-step map-script-step-condition map-script-if-step">
      <span className="map-script-step-number">{index + 1}</span>
      <span className="map-script-step-icon" aria-hidden="true">?</span>
      <div className="map-script-step-body">
        <div className="map-script-step-title-row">
          <strong>If {conditionText(block.condition)}</strong>
        </div>
        <div className="map-script-branches">
          <div className="map-script-branch">
            <small>Then</small>
            <span>{branchOutcomeText(block.whenTrue)}</span>
            {block.whenTrue.type === "jump" && <code>{block.whenTrue.target}</code>}
          </div>
          <div className="map-script-branch">
            <small>Otherwise</small>
            <span>{branchOutcomeText(block.whenFalse)}</span>
            {block.whenFalse.type === "jump" && <code>{block.whenFalse.target}</code>}
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

function stateRole(state: MapScriptState, focusLabel: string, index: number, focusIndex: number): string {
  if (state.label === focusLabel) return "Current state";
  if (index < focusIndex) return "Before this state";
  return "Next state";
}

export function MapScriptPreview({ reference }: MapScriptPreviewProps) {
  const model = useMemo(() => {
    const program = parseMapScriptProgram(reference.mapScriptSource, reference.routineLabel);
    const states = focusedMapScriptStates(program, reference.routineLabel, 1, 1);
    const dialoguePhases = parseResolvedScriptDialogueSummary(reference.routineSource);
    return { states, dialoguePhases };
  }, [reference.mapScriptSource, reference.routineLabel, reference.routineSource]);

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
          <p className="help-text">Yellow Editor follows script states, shows resolved dialogue, and turns recognized conditional jumps into beginner-friendly If / Then / Otherwise branches.</p>
        </div>
        <span className="read-only-badge">Semantic preview</span>
      </div>

      <div className="map-script-state-list">
        {model.states.map((state, stateIndex) => {
          const flow = structuredMapScriptFlow(state);
          const phaseDialogue = findResolvedScriptPhaseDialogue(
            model.dialoguePhases,
            summaryStateTitle(state.label, reference.scriptPath),
          );
          let dialogueIndex = 0;
          let battleDialogueIndex = 0;

          return (
            <details
              className={`map-script-state${state.label === reference.routineLabel ? " current" : ""}`}
              key={state.label}
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
                {flow.length === 0 ? (
                  <p className="empty-state">No semantic operations are recognized in this state yet. The original source remains available below.</p>
                ) : (
                  <ol className="map-script-step-list">
                    {flow.map((item, index) => {
                      if (item.type === "if") {
                        return <IfBlockCard block={item} index={index} key={item.id} />;
                      }

                      let dialoguePreview: NodeDialoguePreview | undefined;
                      if (item.node.type === "dialogue") {
                        const text = phaseDialogue?.dialogues[dialogueIndex];
                        dialogueIndex += 1;
                        if (text) dialoguePreview = { text };
                      } else if (item.node.type === "battle-dialogue") {
                        const battle = phaseDialogue?.battleDialogues[battleDialogueIndex];
                        battleDialogueIndex += 1;
                        if (battle?.playerWins || battle?.playerLoses) dialoguePreview = { battle };
                      }

                      return (
                        <ScriptNodeCard
                          node={item.node}
                          index={index}
                          key={item.node.id}
                          dialoguePreview={dialoguePreview}
                        />
                      );
                    })}
                  </ol>
                )}
              </div>
            </details>
          );
        })}
      </div>

      <details className="trainer-full-script map-script-resolved-summary">
        <summary>View resolved plain-language summary</summary>
        <pre className="trainer-script-source"><code>{reference.routineSource}</code></pre>
      </details>
    </div>
  );
}
