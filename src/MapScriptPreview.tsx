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
import type { TrainerScriptReference } from "./core/types";
import { TextEditor, type TextEditorTarget } from "./TextEditor";
import "./MapScriptPreview.css";

interface MapScriptPreviewProps {
  reference: TrainerScriptReference;
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
  reference: TrainerScriptReference,
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
      return outcome.summary ?? `Continue at ${titleCaseConstant(outcome.target.replace(/Script$/, ""))}`;
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
  dialogue: TrainerScriptReference["interaction"]["dialogues"][number] | undefined,
): TextEditorTarget | undefined {
  return dialogue?.sourcePath && dialogue.textLabel
    ? { path: dialogue.sourcePath, label: dialogue.textLabel }
    : undefined;
}

function dialoguePreviewsForFlow(
  flow: MapScriptFlowItem[],
  phaseDialogue: ResolvedScriptPhaseDialogue | undefined,
  reference: TrainerScriptReference,
  state: MapScriptState,
  resumeLabels: Set<string>,
): Map<string, NodeDialoguePreview> {
  const previews = new Map<string, NodeDialoguePreview>();
  const role = state.label === reference.routineLabel
    ? "before-battle"
    : resumeLabels.has(state.label)
      ? "post-battle"
      : null;
  const interactionDialogues = role
    ? reference.interaction.dialogues.filter((dialogue) => dialogue.role === role)
    : [];
  const playerWins = reference.interaction.dialogues.find((dialogue) => dialogue.role === "player-wins");
  const playerLoses = reference.interaction.dialogues.find((dialogue) => dialogue.role === "player-loses");

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

function DialoguePreview({
  preview,
  node,
  reference,
  state,
}: {
  preview: NodeDialoguePreview | undefined;
  node: Extract<MapScriptSemanticNode, { type: "dialogue" }>;
  reference: TrainerScriptReference;
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
        initialText={preview?.text ?? (displayedLabel ? null : null)}
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
  reference: TrainerScriptReference;
}) {
  const playerWins = reference.interaction.dialogues.find((dialogue) => dialogue.role === "player-wins");
  const playerLoses = reference.interaction.dialogues.find((dialogue) => dialogue.role === "player-loses");
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
  reference: TrainerScriptReference;
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
          <strong>{node.title}</strong>
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
  reference: TrainerScriptReference;
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
  reference: TrainerScriptReference;
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
          {branch.outcome.type === "jump" && <code>{branch.outcome.target}</code>}
          {branch.outcome.type === "jump" && branch.outcome.targetSource && (
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
  reference: TrainerScriptReference;
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
    const program = parseMapScriptProgram(reference.mapScriptSource, reference.routineLabel);
    const states = focusedMapScriptStates(program, reference.routineLabel, 1, 1);
    const dialoguePhases = parseResolvedScriptDialogueSummary(reference.routineSource);
    const battleHandoffs = mapScriptBattleHandoffs(program, reference.mapScriptSource);
    const resumeLabels = new Set(battleHandoffs.map((handoff) => handoff.resumeStateLabel));
    return { states, dialoguePhases, battleHandoffs, resumeLabels };
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
          <p className="help-text">Yellow Editor follows script states, shows and edits resolved dialogue, and nests recognized branch actions directly inside beginner-friendly If / Then / Otherwise blocks.</p>
        </div>
        <span className="editable-badge">Dialogue editable</span>
      </div>

      <div className="map-script-state-list">
        {model.states.map((state, stateIndex) => {
          const flow = structuredMapScriptFlow(state, reference.mapScriptSource);
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
                {flow.length === 0 ? (
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

      <details className="trainer-full-script map-script-resolved-summary">
        <summary>View resolved plain-language summary</summary>
        <pre className="trainer-script-source"><code>{reference.routineSource}</code></pre>
      </details>
    </div>
  );
}
