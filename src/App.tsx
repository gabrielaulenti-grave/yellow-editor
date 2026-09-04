import { useState } from "react";
import type {
  HistorySummary,
  MoveData,
  PokemonBaseStatsEditDocument,
  PokemonBaseStatValues,
  PokemonDetails,
  PokemonIndexEntry,
  ProjectInfo,
} from "./core/types";
import { invoke, open } from "./platform/compat";
import { PokemonSpritePanel } from "./PokemonSpritePanel";
import "./App.css";

type Tab = "pokemon" | "moves";
type BaseStatKey = keyof PokemonBaseStatValues;
type BaseStatsDraft = Record<BaseStatKey, string>;

const BASE_STAT_FIELDS: { key: BaseStatKey; label: string }[] = [
  { key: "hp", label: "HP" },
  { key: "attack", label: "Attack" },
  { key: "defense", label: "Defense" },
  { key: "speed", label: "Speed" },
  { key: "special", label: "Special" },
];

const EMPTY_BASE_STATS_DRAFT: BaseStatsDraft = {
  hp: "",
  attack: "",
  defense: "",
  speed: "",
  special: "",
};

function formatHex(value: number) {
  return `$${value.toString(16).toUpperCase().padStart(2, "0")}`;
}

function draftFromValues(values: PokemonBaseStatValues): BaseStatsDraft {
  return {
    hp: String(values.hp),
    attack: String(values.attack),
    defense: String(values.defense),
    speed: String(values.speed),
    special: String(values.special),
  };
}

function validateBaseStatInput(value: string): string | null {
  if (!/^\d+$/.test(value)) {
    return "Enter a whole number.";
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 255) {
    return "Must be between 1 and 255.";
  }

  return null;
}

function parseBaseStatsDraft(draft: BaseStatsDraft): PokemonBaseStatValues | null {
  for (const field of BASE_STAT_FIELDS) {
    if (validateBaseStatInput(draft[field.key])) {
      return null;
    }
  }

  return {
    hp: Number(draft.hp),
    attack: Number(draft.attack),
    defense: Number(draft.defense),
    speed: Number(draft.speed),
    special: Number(draft.special),
  };
}

function ReadonlyField({ label, value }: { label: string; value: string | number }) {
  return (
    <label className="editor-field">
      <span>{label}</span>
      <input value={value} readOnly />
    </label>
  );
}

function EditableStatField({
  label,
  value,
  error,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  error: string | null;
  disabled: boolean;
  onChange(value: string): void;
}) {
  return (
    <label className={`editor-field editable-stat-field${error ? " field-invalid" : ""}`}>
      <span>{label}</span>
      <input
        type="number"
        min={1}
        max={255}
        step={1}
        value={value}
        disabled={disabled}
        aria-invalid={error ? "true" : "false"}
        onChange={(event) => onChange(event.target.value)}
      />
      {error && <small className="field-error">{error}</small>}
    </label>
  );
}

function App() {
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("pokemon");
  const [pokemonIndex, setPokemonIndex] = useState<PokemonIndexEntry[]>([]);
  const [status, setStatus] = useState("No project loaded.");
  const [selectedPokemonId, setSelectedPokemonId] = useState<number | null>(null);
  const [selectedPokemon, setSelectedPokemon] = useState<PokemonDetails | null>(null);
  const [tmhmMoves, setTmhmMoves] = useState<string[]>([]);
  const [moves, setMoves] = useState<MoveData[]>([]);
  const [selectedMoveId, setSelectedMoveId] = useState<number | null>(null);
  const [moveSearch, setMoveSearch] = useState("");
  const [baseStatsDocument, setBaseStatsDocument] =
    useState<PokemonBaseStatsEditDocument | null>(null);
  const [baseStatsDraft, setBaseStatsDraft] =
    useState<BaseStatsDraft>(EMPTY_BASE_STATS_DRAFT);
  const [historySummary, setHistorySummary] = useState<HistorySummary | null>(null);
  const [editBusy, setEditBusy] = useState(false);

  const selectedMove = moves.find((move) => move.id === selectedMoveId) ?? null;
  const selectedPokemonEntry =
    pokemonIndex.find((entry) => entry.internalId === selectedPokemonId) ?? null;

  const filteredMoves = moves.filter((move) => {
    const query = moveSearch.trim().toLowerCase();
    if (!query) {
      return true;
    }

    return (
      move.name.toLowerCase().includes(query) ||
      move.constant.toLowerCase().includes(query) ||
      formatHex(move.id).toLowerCase().includes(query)
    );
  });

  const baseStatErrors = Object.fromEntries(
    BASE_STAT_FIELDS.map((field) => [field.key, validateBaseStatInput(baseStatsDraft[field.key])]),
  ) as Record<BaseStatKey, string | null>;

  const baseStatsValid = BASE_STAT_FIELDS.every((field) => !baseStatErrors[field.key]);
  const baseStatsDirty = Boolean(
    baseStatsDocument &&
      BASE_STAT_FIELDS.some(
        (field) => baseStatsDraft[field.key] !== String(baseStatsDocument.values[field.key]),
      ),
  );

  function clearPokemonEditor() {
    setSelectedPokemon(null);
    setSelectedPokemonId(null);
    setTmhmMoves([]);
    setBaseStatsDocument(null);
    setBaseStatsDraft(EMPTY_BASE_STATS_DRAFT);
  }

  async function loadPokemon(
    entry: PokemonIndexEntry,
    successMessage = "Pokémon loaded successfully.",
  ) {
    setSelectedPokemonId(entry.internalId);

    if (!project || !entry.sourceSlug) {
      setSelectedPokemon(null);
      setTmhmMoves([]);
      setBaseStatsDocument(null);
      setBaseStatsDraft(EMPTY_BASE_STATS_DRAFT);
      return;
    }

    try {
      const [details, compatibleMoves, editDocument] = await Promise.all([
        invoke<PokemonDetails>("get_pokemon_details", {
          projectPath: project.path,
          internalId: entry.internalId,
          sourceSlug: entry.sourceSlug,
        }),
        invoke<string[]>("get_pokemon_tmhm_moves", {
          projectPath: project.path,
          sourceSlug: entry.sourceSlug,
        }),
        invoke<PokemonBaseStatsEditDocument>("get_pokemon_base_stats_edit_document", {
          sourceSlug: entry.sourceSlug,
        }),
      ]);

      setSelectedPokemon(details);
      setTmhmMoves(compatibleMoves);
      setBaseStatsDocument(editDocument);
      setBaseStatsDraft(draftFromValues(editDocument.values));
      setStatus(successMessage);
    } catch (error) {
      setSelectedPokemon(null);
      setTmhmMoves([]);
      setBaseStatsDocument(null);
      setBaseStatsDraft(EMPTY_BASE_STATS_DRAFT);
      setStatus(String(error));
    }
  }

  async function selectProject() {
    if (
      baseStatsDirty &&
      !window.confirm("Discard the unsaved base stat changes and open another project?")
    ) {
      return;
    }

    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Pokémon disassembly project",
      });

      if (!selected) {
        return;
      }

      const result = await invoke<ProjectInfo>("open_project", { path: selected });

      const [index, moveData, history] = await Promise.all([
        invoke<PokemonIndexEntry[]>("get_pokemon_index", { projectPath: result.path }),
        invoke<MoveData[]>("get_moves", { projectPath: result.path }),
        invoke<HistorySummary>("get_history_summary"),
      ]);

      setProject(result);
      setPokemonIndex(index);
      setMoves(moveData);
      clearPokemonEditor();
      setSelectedMoveId(moveData[0]?.id ?? null);
      setMoveSearch("");
      setHistorySummary(history);
      setStatus("Project loaded successfully.");
    } catch (error) {
      setProject(null);
      setPokemonIndex([]);
      setMoves([]);
      clearPokemonEditor();
      setSelectedMoveId(null);
      setHistorySummary(null);
      setStatus(String(error));
    }
  }

  async function selectPokemon(entry: PokemonIndexEntry) {
    if (
      baseStatsDirty &&
      entry.internalId !== selectedPokemonId &&
      !window.confirm("Discard the unsaved base stat changes and switch Pokémon?")
    ) {
      return;
    }

    await loadPokemon(entry);
  }

  function updateBaseStat(key: BaseStatKey, value: string) {
    setBaseStatsDraft((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function saveBaseStats() {
    if (
      !selectedPokemonEntry?.sourceSlug ||
      !baseStatsDocument ||
      !baseStatsDirty ||
      !baseStatsValid
    ) {
      return;
    }

    const values = parseBaseStatsDraft(baseStatsDraft);
    if (!values) {
      setStatus("Base stats must be integer values between 1 and 255.");
      return;
    }

    setEditBusy(true);
    try {
      const history = await invoke<HistorySummary>("save_pokemon_base_stats", {
        sourceSlug: selectedPokemonEntry.sourceSlug,
        expectedHash: baseStatsDocument.sourceHash,
        values,
      });
      setHistorySummary(history);
      await loadPokemon(selectedPokemonEntry, "Base stats saved successfully.");
    } catch (error) {
      setStatus(String(error));
    } finally {
      setEditBusy(false);
    }
  }

  async function undoLastSave() {
    if (!historySummary?.canUndo || baseStatsDirty || editBusy) {
      return;
    }

    setEditBusy(true);
    try {
      const history = await invoke<HistorySummary>("undo_last_save");
      setHistorySummary(history);
      if (selectedPokemonEntry?.sourceSlug) {
        await loadPokemon(selectedPokemonEntry, "Undid the last saved change.");
      } else {
        setStatus("Undid the last saved change.");
      }
    } catch (error) {
      setStatus(String(error));
    } finally {
      setEditBusy(false);
    }
  }

  async function redoLastUndo() {
    if (!historySummary?.canRedo || baseStatsDirty || editBusy) {
      return;
    }

    setEditBusy(true);
    try {
      const history = await invoke<HistorySummary>("redo_last_undo");
      setHistorySummary(history);
      if (selectedPokemonEntry?.sourceSlug) {
        await loadPokemon(selectedPokemonEntry, "Redid the last saved change.");
      } else {
        setStatus("Redid the last saved change.");
      }
    } catch (error) {
      setStatus(String(error));
    } finally {
      setEditBusy(false);
    }
  }

  async function revertUnsavedChanges() {
    if (!baseStatsDirty || !selectedPokemonEntry?.sourceSlug || editBusy) {
      return;
    }

    setEditBusy(true);
    try {
      await loadPokemon(selectedPokemonEntry, "Unsaved base stat changes reverted.");
    } finally {
      setEditBusy(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <h1>Yellow Editor</h1>
          <p className="status-line">{status}</p>
        </div>
        <button onClick={selectProject}>Open Project</button>
      </header>

      {project && (
        <>
          <section className="project-strip">
            <strong>{project.projectName}</strong>
            <span>{project.path}</span>
          </section>

          <section className="edit-toolbar" aria-label="Editing history controls">
            <div className="edit-actions">
              <button
                className="primary-action"
                disabled={editBusy || !baseStatsDirty || !baseStatsValid}
                onClick={saveBaseStats}
              >
                Save
              </button>
              <button
                disabled={editBusy || baseStatsDirty || !historySummary?.canUndo}
                onClick={undoLastSave}
                title={baseStatsDirty ? "Save or revert unsaved changes before undoing." : undefined}
              >
                Undo
              </button>
              <button
                disabled={editBusy || baseStatsDirty || !historySummary?.canRedo}
                onClick={redoLastUndo}
                title={baseStatsDirty ? "Save or revert unsaved changes before redoing." : undefined}
              >
                Redo
              </button>
              <button
                disabled={editBusy || !baseStatsDirty}
                onClick={revertUnsavedChanges}
                title="Discard unsaved edits and reload the selected Pokémon from the project."
              >
                Revert
              </button>
            </div>
            <div className="history-status">
              {baseStatsDirty ? (
                <strong className="unsaved-indicator">Unsaved changes</strong>
              ) : historySummary?.latestLabel ? (
                <span>Latest saved change: {historySummary.latestLabel}</span>
              ) : (
                <span>No Yellow Editor saves yet.</span>
              )}
            </div>
          </section>
        </>
      )}

      <nav className="tab-bar">
        <button
          className={activeTab === "pokemon" ? "active" : ""}
          onClick={() => setActiveTab("pokemon")}
        >
          Pokémon
        </button>
        <button
          className={activeTab === "moves" ? "active" : ""}
          onClick={() => setActiveTab("moves")}
        >
          Moves
        </button>
      </nav>

      {activeTab === "pokemon" && (
        <section className="tab-content">
          <div className="tab-heading-row">
            <div>
              <h2>Pokémon</h2>
              <p>Base stats are editable; the remaining fields are still read-only.</p>
            </div>
            <select
              value={selectedPokemonId ?? ""}
              onChange={(event) => {
                const id = Number(event.target.value);
                const entry = pokemonIndex.find((pokemon) => pokemon.internalId === id);
                if (entry) {
                  void selectPokemon(entry);
                }
              }}
            >
              <option value="" disabled>
                Select a Pokémon
              </option>
              {pokemonIndex
                .filter((entry) => entry.kind !== "system")
                .map((entry) => (
                  <option key={entry.internalId} value={entry.internalId}>
                    {formatHex(entry.internalId)} — {entry.displayName}
                  </option>
                ))}
            </select>
          </div>

          {!project && <p>Open a project to browse Pokémon.</p>}

          {selectedPokemon && selectedPokemonEntry?.sourceSlug && (
            <div className="pokemon-editor">
              <div className="pokemon-title-row">
                <div>
                  <h3>{selectedPokemonEntry.displayName}</h3>
                  <p className="muted-code">
                    {formatHex(selectedPokemonEntry.internalId)}
                    {selectedPokemonEntry.constant ? ` — ${selectedPokemonEntry.constant}` : ""}
                  </p>
                </div>
              </div>

              <PokemonSpritePanel
                sourceSlug={selectedPokemonEntry.sourceSlug}
                displayName={selectedPokemonEntry.displayName}
                front={selectedPokemon.sprites.front}
                back={selectedPokemon.sprites.back}
              />

              <section className="editor-card">
                <div className="section-heading">
                  <div>
                    <h4>Base Stats</h4>
                    <p>Each editable stat must be a whole number from 1 to 255.</p>
                  </div>
                  {baseStatsDirty && <span className="unsaved-indicator">Modified</span>}
                </div>

                <div className="field-grid stat-grid">
                  {BASE_STAT_FIELDS.map((field) => (
                    <EditableStatField
                      key={field.key}
                      label={field.label}
                      value={baseStatsDraft[field.key]}
                      error={baseStatErrors[field.key]}
                      disabled={editBusy}
                      onChange={(value) => updateBaseStat(field.key, value)}
                    />
                  ))}
                  <ReadonlyField label="Catch Rate" value={selectedPokemon.stats.catchRate} />
                  <ReadonlyField label="Base EXP" value={selectedPokemon.stats.baseExp} />
                  <ReadonlyField label="Dex Constant" value={selectedPokemon.stats.dexConstant} />
                </div>

                <h5>Typing</h5>
                <div className="field-grid two-column-fields">
                  <ReadonlyField label="Type 1" value={selectedPokemon.stats.type1} />
                  <ReadonlyField label="Type 2" value={selectedPokemon.stats.type2} />
                </div>
              </section>

              <section className="editor-card">
                <h4>Evolution</h4>
                {selectedPokemon.evolutions.length === 0 ? (
                  <p className="empty-state">Does not evolve.</p>
                ) : (
                  <div className="table-wrap">
                    <table className="editor-table">
                      <thead>
                        <tr>
                          <th>Method</th>
                          <th>Level</th>
                          <th>Item</th>
                          <th>Target</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedPokemon.evolutions.map((evolution, index) => (
                          <tr key={index}>
                            <td><input value={evolution.method} readOnly /></td>
                            <td><input value={evolution.level ?? ""} readOnly /></td>
                            <td><input value={evolution.item ?? ""} readOnly /></td>
                            <td><input value={evolution.target} readOnly /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="editor-card">
                <h4>Level-up Learnset</h4>
                <div className="table-wrap">
                  <table className="editor-table compact-table">
                    <thead>
                      <tr>
                        <th>Level</th>
                        <th>Move</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedPokemon.learnset.map((move, index) => (
                        <tr key={index}>
                          <td><input value={move.level} readOnly /></td>
                          <td><input value={move.moveConstant} readOnly /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="editor-card">
                <h4>TM/HM Compatibility</h4>
                {tmhmMoves.length === 0 ? (
                  <p className="empty-state">No compatible TM/HM moves.</p>
                ) : (
                  <div className="move-chip-grid">
                    {tmhmMoves.map((move) => (
                      <label key={move} className="compatibility-chip">
                        <input type="checkbox" checked readOnly />
                        <span>{move}</span>
                      </label>
                    ))}
                  </div>
                )}
              </section>

              <section className="editor-card">
                <h4>Pokédex</h4>
                {selectedPokemon.pokedex ? (
                  <>
                    <div className="field-grid dex-grid">
                      <ReadonlyField label="Species" value={selectedPokemon.pokedex.category} />
                      <ReadonlyField label="Height (ft)" value={selectedPokemon.pokedex.heightFeet} />
                      <ReadonlyField label="Height (in)" value={selectedPokemon.pokedex.heightInches} />
                      <ReadonlyField
                        label="Weight (lb)"
                        value={(selectedPokemon.pokedex.weightTenthsLb / 10).toFixed(1)}
                      />
                    </div>

                    <h5>Entry Text</h5>
                    <div className="dex-text-lines">
                      {selectedPokemon.pokedex.textLines.map((line, index) => (
                        <label key={index} className="dex-line-field">
                          <span>{line.kind}</span>
                          <input value={line.text} maxLength={18} readOnly />
                        </label>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="empty-state">No Pokédex data.</p>
                )}
              </section>
            </div>
          )}
        </section>
      )}

      {activeTab === "moves" && (
        <section className="tab-content">
          <h2>Moves</h2>

          {!project ? (
            <p>Open a project to browse moves.</p>
          ) : (
            <div className="move-browser">
              <aside>
                <input
                  type="search"
                  placeholder="Search moves..."
                  value={moveSearch}
                  onChange={(event) => setMoveSearch(event.target.value)}
                  className="full-width-input"
                />

                <div className="move-list">
                  {filteredMoves.map((move) => (
                    <button
                      key={move.id}
                      onClick={() => setSelectedMoveId(move.id)}
                      className={move.id === selectedMoveId ? "active" : ""}
                    >
                      {formatHex(move.id)} — {move.name}
                    </button>
                  ))}

                  {filteredMoves.length === 0 && <p>No moves match that search.</p>}
                </div>
              </aside>

              <section className="editor-card">
                {selectedMove ? (
                  <>
                    <h3>{selectedMove.name}</h3>
                    <p className="muted-code">
                      {formatHex(selectedMove.id)} — {selectedMove.constant}
                    </p>

                    <h4>Move Data</h4>
                    <div className="field-grid two-column-fields">
                      <ReadonlyField label="Name" value={selectedMove.name} />
                      <ReadonlyField label="Power" value={selectedMove.power} />
                      <ReadonlyField label="Accuracy" value={`${selectedMove.accuracy}%`} />
                      <ReadonlyField label="PP" value={selectedMove.pp} />
                      <ReadonlyField label="Type" value={selectedMove.moveType} />
                      <ReadonlyField label="Effect" value={selectedMove.effect} />
                    </div>

                    <h4>Animation</h4>
                    <div className="field-grid two-column-fields">
                      <ReadonlyField label="Animation Constant" value={selectedMove.animation} />
                      <ReadonlyField
                        label="Animation Label"
                        value={selectedMove.animationLabel ?? "Not found"}
                      />
                    </div>

                    <details>
                      <summary>View animation script</summary>
                      {selectedMove.animationScript.length === 0 ? (
                        <p>No animation script found.</p>
                      ) : (
                        <pre>{selectedMove.animationScript.join("\n")}</pre>
                      )}
                    </details>
                  </>
                ) : (
                  <p>Select a move.</p>
                )}
              </section>
            </div>
          )}
        </section>
      )}
    </main>
  );
}

export default App;
