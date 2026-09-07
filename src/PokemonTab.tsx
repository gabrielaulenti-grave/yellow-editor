import type {
  PokemonDetails,
  PokemonIndexEntry,
  ProjectInfo,
} from "./core/types";
import {
  BASE_STAT_FIELDS,
  type BaseStatKey,
  type BaseStatsDraft,
} from "./editor/pokemonBaseStatsForm";
import { ReadonlyField } from "./editor/EditorFields";
import { formatHex } from "./editor/format";
import { PokemonSpritePanel } from "./PokemonSpritePanel";

interface PokemonTabProps {
  project: ProjectInfo | null;
  pokemonIndex: PokemonIndexEntry[];
  selectedPokemonId: number | null;
  selectedPokemonEntry: PokemonIndexEntry | null;
  selectedPokemon: PokemonDetails | null;
  tmhmMoves: string[];
  baseStatsDraft: BaseStatsDraft;
  baseStatErrors: Record<BaseStatKey, string | null>;
  baseStatsDirty: boolean;
  editBusy: boolean;
  onSelectPokemon(entry: PokemonIndexEntry): Promise<void>;
  onUpdateBaseStat(key: BaseStatKey, value: string): void;
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

export function PokemonTab({
  project,
  pokemonIndex,
  selectedPokemonId,
  selectedPokemonEntry,
  selectedPokemon,
  tmhmMoves,
  baseStatsDraft,
  baseStatErrors,
  baseStatsDirty,
  editBusy,
  onSelectPokemon,
  onUpdateBaseStat,
}: PokemonTabProps) {
  return (
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
              void onSelectPokemon(entry);
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
                  onChange={(value) => onUpdateBaseStat(field.key, value)}
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
  );
}
