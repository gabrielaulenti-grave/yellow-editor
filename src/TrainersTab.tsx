import type {
  ProjectInfo,
  TrainerClassEntry,
  TrainerPartyEntry,
} from "./core/types";

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
  onSectionChange(section: TrainerSection): void;
  onSelectTrainer(id: string): void;
  onSelectClass(constant: string): void;
  onPartySearchChange(value: string): void;
  onClassSearchChange(value: string): void;
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
  if (instance.triggerKind === "talk") {
    return "Talk-only";
  }
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

function DialogueBlock({
  label,
  dialogue,
}: {
  label: string;
  dialogue: TrainerPartyEntry["instances"][number]["dialogue"]["before"];
}) {
  return (
    <div className="trainer-dialogue-block">
      <strong>{label}</strong>
      {dialogue ? (
        <>
          <p>{dialogue.text ?? "Text is referenced through a custom or unsupported wrapper."}</p>
          <code>{dialogue.textLabel ?? dialogue.wrapperLabel}</code>
        </>
      ) : (
        <p className="help-text">Handled by this trainer's custom map script.</p>
      )}
    </div>
  );
}

function PartyBrowser({
  trainers,
  selectedTrainerId,
  search,
  onSelectTrainer,
  onSearchChange,
}: {
  trainers: TrainerPartyEntry[];
  selectedTrainerId: string | null;
  search: string;
  onSelectTrainer(id: string): void;
  onSearchChange(value: string): void;
}) {
  const selectedTrainer = trainers.find((trainer) => trainer.id === selectedTrainerId) ?? null;
  const query = search.trim().toLowerCase();
  const filtered = trainers.filter((trainer) => !query || [
    trainer.id,
    trainer.className,
    trainer.classConstant,
    ...trainer.pokemon.map((pokemon) => pokemon.speciesConstant),
    ...trainer.instances.flatMap((instance) => [instance.locationName, instance.mapConstant]),
  ].some((value) => value.toLowerCase().includes(query)));

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
              <small>{trainer.instances.length === 0 ? "Unused party" : `${trainer.instances.length} map instance${trainer.instances.length === 1 ? "" : "s"}`}</small>
            </button>
          ))}
          {filtered.length === 0 && <p>No trainer parties match that search.</p>}
        </div>
      </aside>

      <section className="trainer-details">
        {selectedTrainer ? (
          <>
            <section className="editor-card">
              <div className="section-heading">
                <div>
                  <h3>{selectedTrainer.className} #{selectedTrainer.partyNumber}</h3>
                  <p className="muted-code">{selectedTrainer.id}</p>
                </div>
                <span className="read-only-badge">Read-only</span>
              </div>
              {selectedTrainer.instances.length > 1 && (
                <p className="shared-warning">Shared party: edits to this party will affect all {selectedTrainer.instances.length} instances shown below.</p>
              )}
              <h4>Party</h4>
              <div className="table-wrap">
                <table className="editor-table trainer-party-table">
                  <thead><tr><th>Slot</th><th>Level</th><th>Pokémon</th><th>Move overrides</th></tr></thead>
                  <tbody>
                    {selectedTrainer.pokemon.map((pokemon, index) => (
                      <tr key={`${pokemon.speciesConstant}:${index}`}>
                        <td>{index + 1}</td>
                        <td>{pokemon.level}</td>
                        <td>{titleCaseConstant(pokemon.speciesConstant)}</td>
                        <td>{pokemon.specialMoves.length ? pokemon.specialMoves.map((move) => `Slot ${move.moveSlot}: ${titleCaseConstant(move.moveConstant)}`).join(", ") : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {selectedTrainer.specialMoves.some((move) => move.scope === "class") && (
                <p className="help-text">Class-wide special move: {selectedTrainer.specialMoves.filter((move) => move.scope === "class").map((move) => titleCaseConstant(move.moveConstant)).join(", ")}.</p>
              )}
            </section>

            <section className="editor-card">
              <h4>Instances</h4>
              {selectedTrainer.instances.length === 0 ? (
                <p className="empty-state">This party is not currently linked to a map object.</p>
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
                <div><strong>Calculated prize</strong><span>{selectedTrainer.calculatedPrize === null ? "Unknown" : `₽${selectedTrainer.calculatedPrize}`}</span></div>
                <div><strong>Class base rate</strong><span>{selectedTrainer.baseRewardPerLevel === null ? "Unknown" : `₽${selectedTrainer.baseRewardPerLevel} × last Pokémon level`}</span></div>
                <div><strong>AI routine</strong><code>{selectedTrainer.aiRoutine ?? "Unknown"}</code></div>
                <div><strong>AI uses / Pokémon</strong><span>{selectedTrainer.aiUsesPerPokemon ?? "Unknown"}</span></div>
                <div><strong>Move-choice groups</strong><span>{selectedTrainer.moveChoiceModifiers.length ? selectedTrainer.moveChoiceModifiers.join(", ") : "None"}</span></div>
                <div><strong>Party encoding</strong><span>{selectedTrainer.partyFormat === "shared-level" ? "Shared level" : "Individual levels"}</span></div>
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
              <span>{trainerClass.name}</span><small>{trainerClass.constant}</small><small>{trainerClass.partyCount} parties · {trainerClass.placedInstanceCount} placed instances</small>
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
              <p className="shared-warning">Shared class data: future edits here will affect {selectedClass.partyCount} parties and {selectedClass.placedInstanceCount} placed instances.</p>
              <div className="trainer-facts">
                <div><strong>Base prize rate</strong><span>{selectedClass.baseRewardPerLevel === null ? "Unknown" : `₽${selectedClass.baseRewardPerLevel} × last Pokémon level`}</span></div>
                <div><strong>AI routine</strong><code>{selectedClass.aiRoutine ?? "Unknown"}</code></div>
                <div><strong>AI uses / Pokémon</strong><span>{selectedClass.aiUsesPerPokemon ?? "Unknown"}</span></div>
                <div><strong>Move-choice groups</strong><span>{selectedClass.moveChoiceModifiers.length ? selectedClass.moveChoiceModifiers.join(", ") : "None"}</span></div>
                <div><strong>Party records</strong><span>{selectedClass.partyCount}</span></div>
                <div><strong>Placed instances</strong><span>{selectedClass.placedInstanceCount}</span></div>
              </div>
              {selectedClass.classSpecialMoves.length > 0 && <p className="help-text">Class-wide move override: {selectedClass.classSpecialMoves.map((move) => `${titleCaseConstant(move.moveConstant)} (Pokémon ${move.pokemonIndex}, slot ${move.moveSlot})`).join(", ")}.</p>}
            </section>

            <section className="editor-card">
              <h4>Affected locations</h4>
              {selectedClass.affectedLocations.length ? <div className="class-location-list">{selectedClass.affectedLocations.map((location) => <span key={location}>{location}</span>)}</div> : <p className="empty-state">No placed instances use this class.</p>}
            </section>

            <section className="editor-card">
              <h4>Parties in this class</h4>
              {selectedClass.partyIds.length ? (
                <div className="table-wrap">
                  <table className="editor-table class-party-table">
                    <thead><tr><th>Party</th><th>Composition</th><th>Instances</th><th /></tr></thead>
                    <tbody>{selectedClass.partyIds.map((partyId) => {
                      const party = partyById.get(partyId);
                      if (!party) return null;
                      return <tr key={party.id}><td>#{party.partyNumber}</td><td>{party.pokemon.map((pokemon) => `Lv.${pokemon.level} ${titleCaseConstant(pokemon.speciesConstant)}`).join(", ")}</td><td>{party.instances.length}</td><td><button className="small-button" onClick={() => onOpenParty(party.id)}>View party</button></td></tr>;
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

export function TrainersTab({ project, section, trainers, classes, warnings, selectedTrainerId, selectedClassConstant, partySearch, classSearch, onSectionChange, onSelectTrainer, onSelectClass, onPartySearchChange, onClassSearchChange }: TrainersTabProps) {
  return (
    <section className="tab-content">
      <div className="tab-heading-row"><div><h2>Trainers</h2><p>Browse individual parties, their effective map instances, and shared trainer classes.</p></div></div>
      <div className="segmented-control encounter-section-control">
        <button className={section === "parties" ? "active" : ""} onClick={() => onSectionChange("parties")}>Parties</button>
        <button className={section === "classes" ? "active" : ""} onClick={() => onSectionChange("classes")}>Classes</button>
      </div>
      {!project ? <p>Open a project to browse trainers.</p> : section === "parties" ? (
        <PartyBrowser trainers={trainers} selectedTrainerId={selectedTrainerId} search={partySearch} onSelectTrainer={onSelectTrainer} onSearchChange={onPartySearchChange} />
      ) : (
        <ClassBrowser classes={classes} trainers={trainers} selectedClassConstant={selectedClassConstant} search={classSearch} onSelectClass={onSelectClass} onSearchChange={onClassSearchChange} onOpenParty={(id) => { onSelectTrainer(id); onSectionChange("parties"); }} />
      )}
      {project && warnings.length > 0 && <details className="editor-card trainer-warnings trainer-global-warnings"><summary>Parser notices ({warnings.length})</summary><ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details>}
    </section>
  );
}
