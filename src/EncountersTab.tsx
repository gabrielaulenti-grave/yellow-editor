import { useState } from "react";
import type {
  EncounterTableEditDocument,
  EncounterTableIndexEntry,
  EncounterTerrain,
  EncounterVersion,
  PokemonIndexEntry,
  ProjectInfo,
} from "./core/types";
import {
  encounterLevelError,
  encounterRateError,
  type EncounterDraft,
} from "./editor/encounterForm";

const SLOT_CHANCES = ["19.9%", "19.9%", "15.2%", "9.8%", "9.8%", "9.8%", "5.1%", "5.1%", "4.3%", "1.2%"];

interface EncountersTabProps {
  project: ProjectInfo | null;
  encounters: EncounterTableIndexEntry[];
  selectedPath: string | null;
  document: EncounterTableEditDocument | null;
  draft: EncounterDraft;
  pokemonIndex: PokemonIndexEntry[];
  search: string;
  dirty: boolean;
  busy: boolean;
  onSearchChange(value: string): void;
  onSelect(entry: EncounterTableIndexEntry): Promise<void>;
  onUpdateRate(terrain: EncounterTerrain, value: string): void;
  onUpdateSlot(
    version: EncounterVersion,
    terrain: EncounterTerrain,
    index: number,
    field: "level" | "speciesConstant",
    value: string,
  ): void;
  onEnable(terrain: EncounterTerrain): void;
  onDisable(terrain: EncounterTerrain): void;
}

function versionLabel(version: EncounterVersion): string {
  return version[0].toUpperCase() + version.slice(1);
}

export function EncountersTab({
  project,
  encounters,
  selectedPath,
  document,
  draft,
  pokemonIndex,
  search,
  dirty,
  busy,
  onSearchChange,
  onSelect,
  onUpdateRate,
  onUpdateSlot,
  onEnable,
  onDisable,
}: EncountersTabProps) {
  const [terrain, setTerrain] = useState<EncounterTerrain>("grass");
  const [version, setVersion] = useState<EncounterVersion>("yellow");
  const query = search.trim().toLowerCase();
  const filtered = encounters.filter((entry) =>
    !query ||
    entry.displayName.toLowerCase().includes(query) ||
    entry.tableLabel.toLowerCase().includes(query) ||
    entry.path.toLowerCase().includes(query),
  );
  const availableVersions = document?.versions.map((entry) => entry.version) ?? [];
  const activeVersion = availableVersions.includes(version)
    ? version
    : availableVersions[0] ?? "yellow";
  const activeArea = draft.find((entry) => entry.version === activeVersion)?.[terrain] ?? null;
  const species = pokemonIndex.filter(
    (entry) => entry.kind === "pokemon" && entry.constant,
  );

  return (
    <section className="tab-content">
      <div className="tab-heading-row">
        <div>
          <h2>Wild Encounters</h2>
          <p>Edit grass and surfing tables. Fishing encounters are not included yet.</p>
        </div>
      </div>

      {!project ? (
        <p>Open a project to edit wild encounters.</p>
      ) : encounters.length === 0 ? (
        <p>No supported encounter tables were found in data/wild/grass_water.asm.</p>
      ) : (
        <div className="encounter-browser">
          <aside>
            <input
              type="search"
              placeholder="Search locations..."
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              className="full-width-input"
            />
            <div className="encounter-list">
              {filtered.map((entry) => (
                <button
                  key={entry.path}
                  onClick={() => void onSelect(entry)}
                  className={entry.path === selectedPath ? "active" : ""}
                  title={entry.error ?? entry.path}
                >
                  <span>{entry.displayName}</span>
                  <small>
                    {entry.error
                      ? "Unsupported syntax"
                      : [entry.hasGrass && "Grass", entry.hasWater && "Surfing"].filter(Boolean).join(" · ") || "No active encounters"}
                  </small>
                </button>
              ))}
              {filtered.length === 0 && <p>No locations match that search.</p>}
            </div>
          </aside>

          <section className="editor-card encounter-editor">
            {document && activeArea ? (
              <>
                <div className="section-heading">
                  <div>
                    <h3>{document.displayName}</h3>
                    <p className="muted-code">{document.path}</p>
                  </div>
                  {dirty && <span className="unsaved-indicator">Modified</span>}
                </div>

                {availableVersions.length > 1 && (
                  <div className="segmented-control" aria-label="Game version">
                    {availableVersions.map((item) => (
                      <button
                        key={item}
                        className={activeVersion === item ? "active" : ""}
                        onClick={() => setVersion(item)}
                      >
                        {versionLabel(item)}
                      </button>
                    ))}
                  </div>
                )}

                <div className="segmented-control" aria-label="Encounter terrain">
                  <button
                    className={terrain === "grass" ? "active" : ""}
                    onClick={() => setTerrain("grass")}
                  >
                    Grass
                  </button>
                  <button
                    className={terrain === "water" ? "active" : ""}
                    onClick={() => setTerrain("water")}
                  >
                    Surfing
                  </button>
                </div>

                {activeArea.rate === "0" ? (
                  <div className="encounter-empty-state">
                    <h4>No {terrain === "water" ? "surfing" : "grass"} encounters</h4>
                    <p>Enabling creates ten starter slots at level 5. Review every slot before saving.</p>
                    <button disabled={busy || species.length === 0} onClick={() => onEnable(terrain)}>
                      Enable {terrain === "water" ? "surfing" : "grass"} encounters
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="encounter-settings">
                      <label className={`editor-field${encounterRateError(activeArea.rate) ? " field-invalid" : ""}`}>
                        <span>Encounter rate</span>
                        <input
                          type="number"
                          min={1}
                          max={255}
                          step={1}
                          value={activeArea.rate}
                          disabled={busy}
                          onChange={(event) => onUpdateRate(terrain, event.target.value)}
                        />
                        {encounterRateError(activeArea.rate) && (
                          <small className="field-error">{encounterRateError(activeArea.rate)}</small>
                        )}
                      </label>
                      <p className="help-text">Raw game rate (0–255). Common vanilla values are 5–30.</p>
                      <button
                        className="danger-action"
                        disabled={busy}
                        onClick={() => onDisable(terrain)}
                      >
                        Disable encounters
                      </button>
                    </div>

                    <div className="table-wrap">
                      <table className="editor-table encounter-table">
                        <thead>
                          <tr><th>Slot</th><th>Chance</th><th>Pokémon</th><th>Level</th></tr>
                        </thead>
                        <tbody>
                          {activeArea.slots.map((slot, index) => {
                            const levelError = encounterLevelError(slot.level);
                            return (
                              <tr key={`${slot.sourceLine ?? "new"}-${index}`}>
                                <td>{index + 1}</td>
                                <td>{SLOT_CHANCES[index]}</td>
                                <td>
                                  <select
                                    value={slot.speciesConstant}
                                    disabled={busy}
                                    onChange={(event) =>
                                      onUpdateSlot(activeVersion, terrain, index, "speciesConstant", event.target.value)
                                    }
                                  >
                                    {species.map((pokemon) => (
                                      <option key={pokemon.internalId} value={pokemon.constant ?? ""}>
                                        {pokemon.displayName} — {pokemon.constant}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td className={levelError ? "field-invalid" : ""}>
                                  <input
                                    type="number"
                                    min={1}
                                    max={100}
                                    step={1}
                                    value={slot.level}
                                    disabled={busy}
                                    aria-invalid={levelError ? "true" : "false"}
                                    title={levelError ?? undefined}
                                    onChange={(event) =>
                                      onUpdateSlot(activeVersion, terrain, index, "level", event.target.value)
                                    }
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </>
            ) : (
              <p>Select an encounter table.</p>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
