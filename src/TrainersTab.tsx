import type {
  MoveData,
  PokemonIndexEntry,
  ProjectInfo,
  TrainerClassEntry,
  TrainerPartyEntry,
} from "./core/types";
import {
  trainerLevelError,
  trainerSpecialMoveError,
  type TrainerPartyDraft,
} from "./editor/trainerPartyForm";
import { MapScriptPreview } from "./MapScriptPreview";
import { TextEditor } from "./TextEditor";

export type TrainerSection = "parties" | "classes";

interface TrainersTabProps {
  project: ProjectInfo | null;
  section: TrainerSection;
  trainers: TrainerPartyEntry[];
  classes: TrainerClassEntry[];
  warnings: string[];
  selectedTrainerId: string | null;
  selectedClassConstant: string | null;
  partySearch: string;
  classSearch: string;
  draft: TrainerPartyDraft | null;
  pokemonIndex: PokemonIndexEntry[];
  moves: MoveData[];
  dirty: boolean;
  busy: boolean;
  onSectionChange(section: TrainerSection): void;
  onSelectTrainer(id: string): void;
  onSelectClass(constant: string): void;
  onPartySearchChange(value: string): void;
  onClassSearchChange(value: string): void;
  onUpdateFormat(format: TrainerPartyEntry["partyFormat"]): void;
  onUpdatePokemon(index: number, field: "level" | "speciesConstant", value: string): void;
  onAddPokemon(): void;
  onRemovePokemon(index: number): void;
  onUpdateSpecialMove(
    index: number,
    field: "pokemonIndex" | "moveSlot" | "moveConstant",
    value: string,
  ): void;
  onAddSpecialMove(): void;
  onRemoveSpecialMove(index: number): void;
}

function titleCaseConstant(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part ? part[0].toUpperCase() + part.slice(1) : part)
    .join(" ");
}

function partyIdLabel(id: string): string {
  const [trainerClass, partyNumber] = id.split(":");
  return `${titleCaseConstant(trainerClass)} #${partyNumber}`;
}

function triggerLabel(instance: TrainerPartyEntry["instances"][number]): string {
  if (instance.triggerKind === "sight") {
    return `${instance.viewRange} tile${instance.viewRange === 1 ? "" : "s"}`;
  }
  if (instance.triggerKind === "talk") return "Talk-only";
  return "Custom script";
}

function resolutionLabel(instance: TrainerPartyEntry["instances"][number]): string {
  switch (instance.partyResolution) {
    case "object": return "Object metadata";
    case "script": return "Script override";
    case "conditional-script": return "Conditional script";
    case "unresolved": return "Unresolved; object fallback";
  }
}

function scriptSelectionLabel(reference: TrainerPartyEntry["scriptReferences"][number]): string {
  switch (reference.selectionKind) {
    case "direct": return "Direct selection";
    case "conditional": return "Conditional branches";
    case "computed": return "Computed selection";
    case "table": return "Lookup table";
  }
}

function partyUsageLabel(trainer: TrainerPartyEntry): string {
  const parts: string[] = [];
  if (trainer.instances.length > 0) {
    parts.push(`${trainer.instances.length} map object${trainer.instances.length === 1 ? "" : "s"}`);
  }
  if (trainer.scriptReferences.length > 0) {
    parts.push(`${trainer.scriptReferences.length} script reference${trainer.scriptReferences.length === 1 ? "" : "s"}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "Unreferenced party";
}

function DialogueBlock({
  label,
  dialogue,
}: {
  label: string;
  dialogue: TrainerPartyEntry["instances"][number]["dialogue"]["before"];
}) {
  if (!dialogue) {
    return (
      <div className="trainer-dialogue-block">
        <strong>{label}</strong>
        <p className="help-text">Handled by this trainer's custom map script.</p>
      </div>
    );
  }

  const target = dialogue.sourcePath && dialogue.textLabel
    ? { path: dialogue.sourcePath, label: dialogue.textLabel }
    : null;

  return (
    <div className="trainer-dialogue-block">
      <TextEditor title={label} target={target} initialText={dialogue.text} />
    </div>
  );
}

function PartyBrowser({
  trainers,
  selectedTrainerId,
  search,
  projectName,
  draft,
  pokemonIndex,
  moves,
  dirty,
  busy,
  onSelectTrainer,
  onSearchChange,
  onUpdateFormat,
  onUpdatePokemon,
  onAddPokemon,
  onRemovePokemon,
  onUpdateSpecialMove,
  onAddSpecialMove,
  onRemoveSpecialMove,
}: {
  trainers: TrainerPartyEntry[];
  selectedTrainerId: string | null;
  search: string;
  projectName: string;
  draft: TrainerPartyDraft | null;
  pokemonIndex: PokemonIndexEntry[];
  moves: MoveData[];
  dirty: boolean;
  busy: boolean;
  onSelectTrainer(id: string): void;
  onSearchChange(value: string): void;
  onUpdateFormat: TrainersTabProps["onUpdateFormat"];
  onUpdatePokemon: TrainersTabProps["onUpdatePokemon"];
  onAddPokemon: TrainersTabProps["onAddPokemon"];
  onRemovePokemon: TrainersTabProps["onRemovePokemon"];
  onUpdateSpecialMove: TrainersTabProps["onUpdateSpecialMove"];
  onAddSpecialMove: TrainersTabProps["onAddSpecialMove"];
  onRemoveSpecialMove: TrainersTabProps["onRemoveSpecialMove"];
}) {
  const selectedTrainer = trainers.find((trainer) => trainer.id === selectedTrainerId) ?? null;
  const query = search.trim().toLowerCase();
  const filtered = trainers.filter((trainer) => !query || [
    trainer.id,
    trainer.className,
    trainer.classConstant,
    ...trainer.pokemon.map((pokemon) => pokemon.speciesConstant),
    ...trainer.instances.flatMap((instance) => [instance.locationName, instance.mapConstant]),
    ...trainer.scriptReferences.flatMap((reference) => [
      reference.locationName,
      reference.mapConstant,
      reference.routineLabel,
      reference.scriptPath,
    ]),
  ].some((value) => value.toLowerCase().includes(query)));
  const species = pokemonIndex.filter((entry) => entry.kind === "pokemon" && entry.constant);
  const knownMoves = new Set(moves.map((move) => move.constant));
  const draftFinalLevel = Number(draft?.pokemon[draft.pokemon.length - 1]?.level);
  const draftPrize = typeof selectedTrainer?.baseRewardPerLevel === "number" && Number.isInteger(draftFinalLevel)
    ? selectedTrainer.baseRewardPerLevel * draftFinalLevel
    : selectedTrainer?.calculatedPrize ?? null;

  return (
    <div className="trainer-browser">
      <aside>
        <input
          type="search"
          placeholder="Search trainers, Pokémon, or maps..."
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          className="full-width-input"
        />
        <p className="browser-count">{filtered.length} of {trainers.length} parties</p>
        <div className="trainer-list">
          {filtered.map((trainer) => (
            <button
              key={trainer.id}
              onClick={() => onSelectTrainer(trainer.id)}
              className={trainer.id === selectedTrainerId ? "active" : ""}
            >
              <span>{trainer.className} #{trainer.partyNumber}</span>
              <small>{trainer.pokemon.map((pokemon) => titleCaseConstant(pokemon.speciesConstant)).join(", ")}</small>
              <small>{partyUsageLabel(trainer)}</small>
            </button>
          ))}
          {filtered.length === 0 && <p>No trainer parties match that search.</p>}
        </div>
      </aside>

      <section className="trainer-details">
        {selectedTrainer ? (
          <>
            <section className="editor-card trainer-party-editor">
              <div className="section-heading">
                <div>
                  <h3>{selectedTrainer.className} #{selectedTrainer.partyNumber}</h3>
                  <p className="muted-code">{selectedTrainer.id}</p>
                </div>
                {dirty ? <span className="unsaved-indicator">Modified</span> : <span className="editable-badge">Editable</span>}
              </div>
              {selectedTrainer.instances.length + selectedTrainer.scriptReferences.length > 1 && (
                <p className="shared-warning">Shared party: changes affect every object and script reference listed for this party.</p>
              )}
              {draft ? (
                <>
                  <div className="trainer-party-settings">
                    <label className="editor-field">
                      <span>Party encoding</span>
                      <select value={draft.partyFormat} disabled={busy} onChange={(event) => onUpdateFormat(event.target.value as TrainerPartyEntry["partyFormat"])}>
                        <option value="shared-level">Shared level</option>
                        <option value="individual-levels">Individual levels</option>
                      </select>
                    </label>
                    <p className="help-text">Shared-level parties store one level for the whole team. Switching to individual levels allows each slot to differ.</p>
                  </div>
                  <div className="table-wrap">
                    <table className="editor-table trainer-party-table">
                      <thead><tr><th>Slot</th><th>Pokémon</th><th>Level</th><th /></tr></thead>
                      <tbody>
                        {draft.pokemon.map((pokemon, index) => {
                          const levelError = trainerLevelError(pokemon.level);
                          const removalLocked = draft.specialMoves.some((move) =>
                            move.sourceKind === "red-lone" && Number(move.pokemonIndex) === index + 1,
                          );
                          return (
                            <tr key={index}>
                              <td>{index + 1}</td>
                              <td>
                                <select value={pokemon.speciesConstant} disabled={busy} onChange={(event) => onUpdatePokemon(index, "speciesConstant", event.target.value)}>
                                  {species.map((entry) => <option key={entry.internalId} value={entry.constant ?? ""}>{entry.displayName} — {entry.constant}</option>)}
                                </select>
                              </td>
                              <td className={levelError ? "field-invalid" : ""}>
                                <input type="number" min={1} max={100} step={1} value={pokemon.level} disabled={busy} aria-invalid={levelError ? "true" : "false"} title={levelError ?? undefined} onChange={(event) => onUpdatePokemon(index, "level", event.target.value)} />
                              </td>
                              <td><button className="small-button danger-action" disabled={busy || draft.pokemon.length <= 1 || removalLocked} title={removalLocked ? "A fixed Red/Blue special-move record targets this slot." : "Remove Pokémon"} onClick={() => onRemovePokemon(index)}>Remove</button></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <button className="small-button trainer-add-button" disabled={busy || draft.pokemon.length >= 6 || species.length === 0} onClick={onAddPokemon}>Add Pokémon</button>
                </>
              ) : <p>Trainer party data is unavailable.</p>}
            </section>

            {draft && (
              <section className="editor-card trainer-special-move-editor">
                <div className="section-heading">
                  <div><h4>Special move overrides</h4><p className="muted-code">data/trainers/special_moves.asm</p></div>
                  {projectName === "pokeyellow" && <button className="small-button" disabled={busy || moves.length === 0 || draft.specialMoves.length >= draft.pokemon.length * 4} onClick={onAddSpecialMove}>Add override</button>}
                </div>
                {projectName === "pokeyellow" ? (
                  <p className="help-text">Yellow can override any of the four move slots on any Pokémon in this party. Empty parties are omitted from the special-move table automatically.</p>
                ) : (
                  <p className="help-text">Red/Blue’s lone and class-wide tables have fixed engine wiring. Existing records can be edited here, but arbitrary new party overrides require corresponding script changes and are not added automatically.</p>
                )}
                {draft.specialMoves.length > 0 ? (
                  <div className="table-wrap">
                    <table className="editor-table trainer-special-move-table">
                      <thead><tr><th>Scope</th><th>Pokémon</th><th>Move slot</th><th>Move</th><th /></tr></thead>
                      <tbody>{draft.specialMoves.map((move, index) => {
                        const duplicate = draft.specialMoves.some((other, otherIndex) =>
                          otherIndex !== index && other.pokemonIndex === move.pokemonIndex && other.moveSlot === move.moveSlot,
                        );
                        const error = trainerSpecialMoveError(move, draft.pokemon.length, knownMoves) ?? (duplicate ? "This move slot already has an override." : null);
                        const classWide = move.sourceKind === "red-class";
                        return (
                          <tr key={`${move.sourceKey}:${index}`} className={error ? "field-invalid" : ""}>
                            <td>{move.scope === "class" ? "Class-wide" : "This party"}</td>
                            <td><select value={move.pokemonIndex} disabled={busy || classWide} aria-invalid={error ? "true" : "false"} title={error ?? undefined} onChange={(event) => onUpdateSpecialMove(index, "pokemonIndex", event.target.value)}>{Array.from({ length: Math.max(draft.pokemon.length, classWide ? 5 : 0) }, (_item, pokemonIndex) => <option key={pokemonIndex} value={pokemonIndex + 1}>#{pokemonIndex + 1}</option>)}</select></td>
                            <td><select value={move.moveSlot} disabled={busy || move.sourceKind !== "yellow-party"} aria-invalid={error ? "true" : "false"} title={error ?? undefined} onChange={(event) => onUpdateSpecialMove(index, "moveSlot", event.target.value)}>{[1, 2, 3, 4].map((slot) => <option key={slot} value={slot}>Slot {slot}</option>)}</select></td>
                            <td><select value={move.moveConstant} disabled={busy} aria-invalid={error ? "true" : "false"} title={error ?? undefined} onChange={(event) => onUpdateSpecialMove(index, "moveConstant", event.target.value)}>{moves.map((entry) => <option key={entry.id} value={entry.constant}>{entry.name} — {entry.constant}</option>)}</select></td>
                            <td>{move.sourceKind === "yellow-party" ? <button className="small-button danger-action" disabled={busy} onClick={() => onRemoveSpecialMove(index)}>Remove</button> : <code>{move.sourceKey}</code>}</td>
                          </tr>
                        );
                      })}</tbody>
                    </table>
                  </div>
                ) : <p className="empty-state">This party has no special move overrides.</p>}
                {draft.specialMoves.some((move) => move.scope === "class") && <p className="shared-warning">A class-wide move change affects every party in the {selectedTrainer.className} class.</p>}
              </section>
            )}

            {selectedTrainer.scriptReferences.length > 0 && (
              <section className="editor-card">
                <h4>Map script references</h4>
                <p className="help-text">Yellow Editor now translates recognized map-script engine operations into beginner-friendly steps. The complete assembly remains available for unusual behavior and verification.</p>
                <div className="trainer-instance-list">
                  {selectedTrainer.scriptReferences.map((reference) => (
                    <details key={`${reference.id}:${selectedTrainer.id}`} open={selectedTrainer.scriptReferences.length === 1}>
                      <summary><span>{reference.locationName}</span><small>{reference.routineLabel} · {scriptSelectionLabel(reference)}</small></summary>
                      <div className="trainer-instance-body">
                        <p>{reference.selectionSummary}</p>
                        <div className="trainer-facts">
                          <div><strong>Possible parties</strong><span>{reference.partyIds.map(partyIdLabel).join(", ")}</span></div>
                          <div><strong>Selecting routine</strong><code>{reference.routineLabel}</code></div>
                          <div><strong>Source</strong><code>{reference.scriptPath}:{reference.sourceLine}</code></div>
                        </div>
                        <MapScriptPreview reference={reference} />
                        <details className="trainer-full-script">
                          <summary>Advanced: view complete map script and trigger conditions</summary>
                          <pre className="trainer-script-source"><code>{reference.mapScriptSource}</code></pre>
                        </details>
                      </div>
                    </details>
                  ))}
                </div>
              </section>
            )}

            <section className="editor-card">
              <h4>Instances</h4>
              {selectedTrainer.instances.length === 0 ? (
                <p className="empty-state">{selectedTrainer.scriptReferences.length > 0
                  ? "No trainer object uses this party; it is selected by the map scripts shown above."
                  : "No map object or resolvable map script currently references this party."}</p>
              ) : (
                <div className="trainer-instance-list">
                  {selectedTrainer.instances.map((instance) => (
                    <details key={`${instance.id}:${selectedTrainer.id}`} open={selectedTrainer.instances.length === 1}>
                      <summary><span>{instance.locationName}</span><small>{triggerLabel(instance)} · {resolutionLabel(instance)}</small></summary>
                      <div className="trainer-instance-body">
                        <div className="trainer-facts">
                          <div><strong>Position</strong><span>({instance.x}, {instance.y})</span></div>
                          <div><strong>Trigger</strong><span>{triggerLabel(instance)}</span></div>
                          <div><strong>Party source</strong><span>{resolutionLabel(instance)}</span></div>
                          <div><strong>Raw object party</strong><code>{instance.objectPartyId}</code></div>
                          <div><strong>Effective parties</strong><span>{instance.effectivePartyIds.map(partyIdLabel).join(", ")}</span></div>
                          <div><strong>Event flag</strong><code>{instance.eventFlag ?? "Custom script"}</code></div>
                          <div><strong>Object</strong><code>{instance.objectConstant ?? instance.textConstant}</code></div>
                          <div><strong>Header</strong><code>{instance.trainerHeaderLabel ?? "Custom script"}</code></div>
                        </div>
                        {instance.partyResolution === "script" && <p className="shared-warning">The map script overrides <code>{instance.objectPartyId}</code> with <code>{instance.effectivePartyIds[0]}</code> for the actual battle.</p>}
                        {instance.partyResolution === "conditional-script" && <p className="shared-warning">The map script chooses one of {instance.effectivePartyIds.length} parties at runtime. This instance is shown under every possible party.</p>}
                        {instance.partyResolution === "unresolved" && <p className="shared-warning">The custom script could not be resolved safely. This instance remains linked through its raw object metadata and must be reviewed before editing.</p>}
                        {instance.triggerKind === "scripted" && instance.partyResolution === "object" && <p className="help-text">Custom trigger logic starts the battle, but the script explicitly loads this object's trainer data.</p>}
                        <div className="trainer-dialogue-grid">
                          <DialogueBlock label="Before battle" dialogue={instance.dialogue.before} />
                          <DialogueBlock label="Defeat text" dialogue={instance.dialogue.defeat} />
                          <DialogueBlock label="After battle" dialogue={instance.dialogue.after} />
                        </div>
                        <p className="trainer-source-paths"><code>{instance.objectPath}</code>{instance.scriptPath && <code>{instance.scriptPath}</code>}</p>
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </section>

            <section className="editor-card">
              <h4>Rewards &amp; battle behavior</h4>
              <div className="trainer-facts">
                <div><strong>Calculated prize</strong><span>{draftPrize === null ? "Unknown" : `₽${draftPrize}`}</span></div>
                <div><strong>Class base rate</strong><span>{selectedTrainer.baseRewardPerLevel === null ? "Unknown" : `₽${selectedTrainer.baseRewardPerLevel} × last Pokémon level`}</span></div>
                <div><strong>AI routine</strong><code>{selectedTrainer.aiRoutine ?? "Unknown"}</code></div>
                <div><strong>AI uses / Pokémon</strong><span>{selectedTrainer.aiUsesPerPokemon ?? "Unknown"}</span></div>
                <div><strong>Move-choice groups</strong><span>{selectedTrainer.moveChoiceModifiers.length ? selectedTrainer.moveChoiceModifiers.join(", ") : "None"}</span></div>
                <div><strong>Party encoding</strong><span>{(draft?.partyFormat ?? selectedTrainer.partyFormat) === "shared-level" ? "Shared level" : "Individual levels"}</span></div>
              </div>
              <p className="trainer-source-paths"><code>{selectedTrainer.sourcePath}:{selectedTrainer.sourceLine}</code></p>
            </section>
          </>
        ) : <section className="editor-card"><p>Select a trainer party.</p></section>}
      </section>
    </div>
  );
}

function ClassBrowser({ classes, trainers, selectedClassConstant, search, onSelectClass, onOpenParty, onSearchChange }: {
  classes: TrainerClassEntry[];
  trainers: TrainerPartyEntry[];
  selectedClassConstant: string | null;
  search: string;
  onSelectClass(constant: string): void;
  onOpenParty(id: string): void;
  onSearchChange(value: string): void;
}) {
  const selectedClass = classes.find((trainerClass) => trainerClass.constant === selectedClassConstant) ?? null;
  const query = search.trim().toLowerCase();
  const filtered = classes.filter((trainerClass) => !query || [trainerClass.constant, trainerClass.name, trainerClass.aiRoutine ?? "", ...trainerClass.affectedLocations].some((value) => value.toLowerCase().includes(query)));
  const partyById = new Map(trainers.map((party) => [party.id, party]));

  return (
    <div className="trainer-browser">
      <aside>
        <input type="search" placeholder="Search classes, AI, or maps..." value={search} onChange={(event) => onSearchChange(event.target.value)} className="full-width-input" />
        <p className="browser-count">{filtered.length} of {classes.length} classes</p>
        <div className="trainer-list">
          {filtered.map((trainerClass) => (
            <button key={trainerClass.constant} onClick={() => onSelectClass(trainerClass.constant)} className={trainerClass.constant === selectedClassConstant ? "active" : ""}>
              <span>{trainerClass.name}</span><small>{trainerClass.constant}</small><small>{trainerClass.partyCount} parties · {trainerClass.placedInstanceCount} map objects · {trainerClass.scriptReferenceCount} script references</small>
            </button>
          ))}
          {filtered.length === 0 && <p>No trainer classes match that search.</p>}
        </div>
      </aside>

      <section className="trainer-details">
        {selectedClass ? (
          <>
            <section className="editor-card">
              <div className="section-heading">
                <div><h3>{selectedClass.name}</h3><p className="muted-code">{selectedClass.constant}</p></div>
                <span className="read-only-badge">Read-only</span>
              </div>
              <p className="shared-warning">Shared class data: future edits here will affect {selectedClass.partyCount} parties, {selectedClass.placedInstanceCount} map objects, and {selectedClass.scriptReferenceCount} script-selected battles.</p>
              <div className="trainer-facts">
                <div><strong>Base prize rate</strong><span>{selectedClass.baseRewardPerLevel === null ? "Unknown" : `₽${selectedClass.baseRewardPerLevel} × last Pokémon level`}</span></div>
                <div><strong>AI routine</strong><code>{selectedClass.aiRoutine ?? "Unknown"}</code></div>
                <div><strong>AI uses / Pokémon</strong><span>{selectedClass.aiUsesPerPokemon ?? "Unknown"}</span></div>
                <div><strong>Move-choice groups</strong><span>{selectedClass.moveChoiceModifiers.length ? selectedClass.moveChoiceModifiers.join(", ") : "None"}</span></div>
                <div><strong>Party records</strong><span>{selectedClass.partyCount}</span></div>
                <div><strong>Placed instances</strong><span>{selectedClass.placedInstanceCount}</span></div>
                <div><strong>Script references</strong><span>{selectedClass.scriptReferenceCount}</span></div>
              </div>
              {selectedClass.classSpecialMoves.length > 0 && <p className="help-text">Class-wide move override: {selectedClass.classSpecialMoves.map((move) => `${titleCaseConstant(move.moveConstant)} (Pokémon ${move.pokemonIndex}, slot ${move.moveSlot})`).join(", ")}.</p>}
            </section>

            <section className="editor-card">
              <h4>Affected locations</h4>
              {selectedClass.affectedLocations.length ? <div className="class-location-list">{selectedClass.affectedLocations.map((location) => <span key={location}>{location}</span>)}</div> : <p className="empty-state">No map object or resolvable map script uses this class.</p>}
            </section>

            <section className="editor-card">
              <h4>Parties in this class</h4>
              {selectedClass.partyIds.length ? (
                <div className="table-wrap">
                  <table className="editor-table class-party-table">
                    <thead><tr><th>Party</th><th>Composition</th><th>Map objects</th><th>Scripts</th><th /></tr></thead>
                    <tbody>{selectedClass.partyIds.map((partyId) => {
                      const party = partyById.get(partyId);
                      if (!party) return null;
                      return <tr key={party.id}><td>#{party.partyNumber}</td><td>{party.pokemon.map((pokemon) => `Lv.${pokemon.level} ${titleCaseConstant(pokemon.speciesConstant)}`).join(", ")}</td><td>{party.instances.length}</td><td>{party.scriptReferences.length}</td><td><button className="small-button" onClick={() => onOpenParty(party.id)}>View party</button></td></tr>;
                    })}</tbody>
                  </table>
                </div>
              ) : <p className="empty-state">This class has no party records.</p>}
            </section>

            <details className="editor-card trainer-warnings">
              <summary>Class source files ({selectedClass.sourcePaths.length})</summary>
              <p className="trainer-source-paths">{selectedClass.sourcePaths.map((path) => <code key={path}>{path}</code>)}</p>
            </details>
          </>
        ) : <section className="editor-card"><p>Select a trainer class.</p></section>}
      </section>
    </div>
  );
}

export function TrainersTab({
  project,
  section,
  trainers,
  classes,
  warnings,
  selectedTrainerId,
  selectedClassConstant,
  partySearch,
  classSearch,
  draft,
  pokemonIndex,
  moves,
  dirty,
  busy,
  onSectionChange,
  onSelectTrainer,
  onSelectClass,
  onPartySearchChange,
  onClassSearchChange,
  onUpdateFormat,
  onUpdatePokemon,
  onAddPokemon,
  onRemovePokemon,
  onUpdateSpecialMove,
  onAddSpecialMove,
  onRemoveSpecialMove,
}: TrainersTabProps) {
  return (
    <section className="tab-content">
      <div className="tab-heading-row"><div><h2>Trainers</h2><p>Browse individual parties, their effective map instances, and shared trainer classes.</p></div></div>
      <div className="segmented-control encounter-section-control">
        <button className={section === "parties" ? "active" : ""} onClick={() => onSectionChange("parties")}>Parties</button>
        <button className={section === "classes" ? "active" : ""} onClick={() => onSectionChange("classes")}>Classes</button>
      </div>
      {!project ? <p>Open a project to browse trainers.</p> : section === "parties" ? (
        <PartyBrowser
          trainers={trainers}
          selectedTrainerId={selectedTrainerId}
          search={partySearch}
          projectName={project.projectName}
          draft={draft}
          pokemonIndex={pokemonIndex}
          moves={moves}
          dirty={dirty}
          busy={busy}
          onSelectTrainer={onSelectTrainer}
          onSearchChange={onPartySearchChange}
          onUpdateFormat={onUpdateFormat}
          onUpdatePokemon={onUpdatePokemon}
          onAddPokemon={onAddPokemon}
          onRemovePokemon={onRemovePokemon}
          onUpdateSpecialMove={onUpdateSpecialMove}
          onAddSpecialMove={onAddSpecialMove}
          onRemoveSpecialMove={onRemoveSpecialMove}
        />
      ) : (
        <ClassBrowser classes={classes} trainers={trainers} selectedClassConstant={selectedClassConstant} search={classSearch} onSelectClass={onSelectClass} onSearchChange={onClassSearchChange} onOpenParty={(id) => { onSelectTrainer(id); onSectionChange("parties"); }} />
      )}
      {project && warnings.length > 0 && <details className="editor-card trainer-warnings trainer-global-warnings"><summary>Parser notices ({warnings.length})</summary><ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details>}
    </section>
  );
}
