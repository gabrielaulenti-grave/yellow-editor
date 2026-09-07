import type { ProjectInfo, TrainerPartyEntry } from "./core/types";

interface TrainersTabProps {
  project: ProjectInfo | null;
  trainers: TrainerPartyEntry[];
  warnings: string[];
  selectedTrainerId: string | null;
  search: string;
  onSelectTrainer(id: string): void;
  onSearchChange(value: string): void;
}

function titleCaseConstant(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part ? part[0].toUpperCase() + part.slice(1) : part)
    .join(" ");
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

export function TrainersTab({
  project,
  trainers,
  warnings,
  selectedTrainerId,
  search,
  onSelectTrainer,
  onSearchChange,
}: TrainersTabProps) {
  const selectedTrainer = trainers.find((trainer) => trainer.id === selectedTrainerId) ?? null;
  const query = search.trim().toLowerCase();
  const filtered = trainers.filter((trainer) => {
    if (!query) {
      return true;
    }
    return [
      trainer.id,
      trainer.className,
      trainer.classConstant,
      ...trainer.pokemon.map((pokemon) => pokemon.speciesConstant),
      ...trainer.instances.flatMap((instance) => [instance.locationName, instance.mapConstant]),
    ].some((value) => value.toLowerCase().includes(query));
  });

  return (
    <section className="tab-content">
      <div className="tab-heading-row">
        <div>
          <h2>Trainers</h2>
          <p>Browse trainer parties and every map instance that uses them.</p>
        </div>
      </div>

      {!project ? (
        <p>Open a project to browse trainers.</p>
      ) : (
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
                  <small>
                    {trainer.pokemon.map((pokemon) => titleCaseConstant(pokemon.speciesConstant)).join(", ")}
                  </small>
                  <small>
                    {trainer.instances.length === 0
                      ? "Unused party"
                      : `${trainer.instances.length} map instance${trainer.instances.length === 1 ? "" : "s"}`}
                  </small>
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
                    <p className="shared-warning">
                      Shared party: edits to this party will affect all {selectedTrainer.instances.length} instances shown below.
                    </p>
                  )}

                  <h4>Party</h4>
                  <div className="table-wrap">
                    <table className="editor-table trainer-party-table">
                      <thead>
                        <tr><th>Slot</th><th>Level</th><th>Pokémon</th><th>Move overrides</th></tr>
                      </thead>
                      <tbody>
                        {selectedTrainer.pokemon.map((pokemon, index) => (
                          <tr key={`${pokemon.speciesConstant}:${index}`}>
                            <td>{index + 1}</td>
                            <td>{pokemon.level}</td>
                            <td>{titleCaseConstant(pokemon.speciesConstant)}</td>
                            <td>
                              {pokemon.specialMoves.length
                                ? pokemon.specialMoves.map((move) => `Slot ${move.moveSlot}: ${titleCaseConstant(move.moveConstant)}`).join(", ")
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {selectedTrainer.specialMoves.some((move) => move.scope === "class") && (
                    <p className="help-text">
                      Class-wide special move: {selectedTrainer.specialMoves
                        .filter((move) => move.scope === "class")
                        .map((move) => titleCaseConstant(move.moveConstant))
                        .join(", ")}.
                    </p>
                  )}
                </section>

                <section className="editor-card">
                  <h4>Instances</h4>
                  {selectedTrainer.instances.length === 0 ? (
                    <p className="empty-state">This party is not referenced by a standard map object.</p>
                  ) : (
                    <div className="trainer-instance-list">
                      {selectedTrainer.instances.map((instance) => (
                        <details key={instance.id} open={selectedTrainer.instances.length === 1}>
                          <summary>
                            <span>{instance.locationName}</span>
                            <small>{triggerLabel(instance)}</small>
                          </summary>
                          <div className="trainer-instance-body">
                            <div className="trainer-facts">
                              <div><strong>Position</strong><span>({instance.x}, {instance.y})</span></div>
                              <div><strong>Trigger</strong><span>{triggerLabel(instance)}</span></div>
                              <div><strong>Facing</strong><span>{titleCaseConstant(instance.facingConstant)}</span></div>
                              <div><strong>Event flag</strong><code>{instance.eventFlag ?? "Custom script"}</code></div>
                              <div><strong>Object</strong><code>{instance.objectConstant ?? instance.textConstant}</code></div>
                              <div><strong>Header</strong><code>{instance.trainerHeaderLabel ?? "Custom script"}</code></div>
                            </div>
                            {instance.triggerKind === "scripted" && (
                              <p className="shared-warning">
                                This battle is controlled by custom map code. The party and placement are resolved, but sight range, event flag, and dialogue roles are not inferred.
                              </p>
                            )}
                            <div className="trainer-dialogue-grid">
                              <DialogueBlock label="Before battle" dialogue={instance.dialogue.before} />
                              <DialogueBlock label="Defeat text" dialogue={instance.dialogue.defeat} />
                              <DialogueBlock label="After battle" dialogue={instance.dialogue.after} />
                            </div>
                            <p className="trainer-source-paths">
                              <code>{instance.objectPath}</code>
                              {instance.scriptPath && <code>{instance.scriptPath}</code>}
                            </p>
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

                {warnings.length > 0 && (
                  <details className="editor-card trainer-warnings">
                    <summary>Parser notices ({warnings.length})</summary>
                    <ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                  </details>
                )}
              </>
            ) : (
              <section className="editor-card"><p>Select a trainer party.</p></section>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
