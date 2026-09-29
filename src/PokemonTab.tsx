import type {
  PokemonDetails,
  PokemonEditDocument,
  PokemonIndexEntry,
  ProjectInfo,
} from "./core/types";
import type {
  PokemonDraft,
  PokemonEvolutionDraft,
  PokemonLearnsetDraft,
} from "./editor/pokemonForm";
import { formatHex } from "./editor/format";
import { PokemonSpritePanel } from "./PokemonSpritePanel";
import { TextEditor } from "./TextEditor";

interface PokemonTabProps {
  project: ProjectInfo | null;
  pokemonIndex: PokemonIndexEntry[];
  selectedPokemonId: number | null;
  selectedPokemonEntry: PokemonIndexEntry | null;
  selectedPokemon: PokemonDetails | null;
  document: PokemonEditDocument | null;
  draft: PokemonDraft | null;
  dirty: boolean;
  editBusy: boolean;
  onSelectPokemon(entry: PokemonIndexEntry): Promise<void>;
  onDraftChange(draft: PokemonDraft): void;
  onPaletteConstantChange(value: string): void;
}

function NumberField({
  label,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  min: number;
  max: number;
  disabled: boolean;
  onChange(value: string): void;
}) {
  return (
    <label className="editor-field">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  disabled: boolean;
  onChange(value: string): void;
}) {
  return (
    <label className="editor-field">
      <span>{label}</span>
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

export function PokemonTab({
  project,
  pokemonIndex,
  selectedPokemonId,
  selectedPokemonEntry,
  selectedPokemon,
  document,
  draft,
  dirty,
  editBusy,
  onSelectPokemon,
  onDraftChange,
  onPaletteConstantChange,
}: PokemonTabProps) {
  function patch(values: Partial<PokemonDraft>) {
    if (draft) onDraftChange({ ...draft, ...values });
  }

  function updateEvolution(index: number, values: Partial<PokemonEvolutionDraft>) {
    if (!draft || !document) return;
    const evolutions = draft.evolutions.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      const next = { ...item, ...values };
      if (values.method) {
        next.item = values.method === "item"
          ? (item.item || document.options.evolutionItems[0] || "")
          : "";
        next.move = values.method === "move"
          ? (item.move || document.options.moves[0] || "")
          : "";
      }
      return next;
    });
    patch({ evolutions });
  }

  function updateLearnset(index: number, values: Partial<PokemonLearnsetDraft>) {
    if (!draft) return;
    patch({
      learnset: draft.learnset.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...values } : item,
      ),
    });
  }

  function toggleTmhm(move: string) {
    if (!draft || !document) return;
    const selected = new Set(draft.tmhmMoves);
    if (selected.has(move)) selected.delete(move);
    else selected.add(move);
    patch({
      tmhmMoves: document.options.tmhmMoves.filter((option) => selected.has(option)),
    });
  }

  return (
    <section className="tab-content">
      <div className="tab-heading-row">
        <div>
          <h2>Pokémon</h2>
          <p>Edit the complete species progression data, presentation, learnsets, evolutions, and Pokédex entry.</p>
        </div>
        <select
          value={selectedPokemonId ?? ""}
          disabled={editBusy}
          onChange={(event) => {
            const id = Number(event.target.value);
            const entry = pokemonIndex.find((pokemon) => pokemon.internalId === id);
            if (entry) void onSelectPokemon(entry);
          }}
        >
          <option value="" disabled>Select a Pokémon</option>
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

      {selectedPokemon && selectedPokemonEntry?.sourceSlug && document && draft && (
        <div className="pokemon-editor">
          <div className="pokemon-title-row">
            <div>
              <h3>{draft.displayName || selectedPokemonEntry.displayName}</h3>
              <p className="muted-code">
                {formatHex(selectedPokemonEntry.internalId)}
                {selectedPokemonEntry.constant ? " — " + selectedPokemonEntry.constant : ""}
              </p>
            </div>
            {dirty && <span className="editable-badge">Modified</span>}
          </div>

          <section className="editor-card">
            <h4>Identity</h4>
            <div className="field-grid dex-grid">
              <label className="editor-field">
                <span>Name</span>
                <input
                  value={draft.displayName}
                  maxLength={10}
                  disabled={editBusy}
                  onChange={(event) => patch({ displayName: event.target.value })}
                />
              </label>
              <label className="editor-field">
                <span>Internal Constant</span>
                <input value={selectedPokemonEntry.constant ?? ""} readOnly />
              </label>
              <label className="editor-field">
                <span>Pokédex Constant</span>
                <input value={document.dexConstant} readOnly />
              </label>
            </div>
            <p className="help-text">The internal constant and Pokédex identity stay fixed; the in-game display name is editable.</p>
          </section>

          <PokemonSpritePanel
            document={document}
            draft={draft}
            displayName={draft.displayName || selectedPokemonEntry.displayName}
            front={selectedPokemon.sprites.front}
            back={selectedPokemon.sprites.back}
            disabled={editBusy}
            onSpriteChoiceChange={(value) => patch({ spriteChoiceId: value })}
            onPaletteConstantChange={onPaletteConstantChange}
            onPaletteColorChange={(source, index, value) => {
              const colors = source === "cgb" ? draft.cgbPalette : draft.sgbPalette;
              if (!colors) return;
              const next = [...colors] as [string, string, string, string];
              next[index] = value;
              patch(source === "cgb" ? { cgbPalette: next } : { sgbPalette: next });
            }}
          />

          <section className="editor-card">
            <h4>Battle &amp; Growth Data</h4>
            <div className="field-grid stat-grid">
              <NumberField label="HP" value={draft.hp} min={1} max={255} disabled={editBusy} onChange={(value) => patch({ hp: value })} />
              <NumberField label="Attack" value={draft.attack} min={1} max={255} disabled={editBusy} onChange={(value) => patch({ attack: value })} />
              <NumberField label="Defense" value={draft.defense} min={1} max={255} disabled={editBusy} onChange={(value) => patch({ defense: value })} />
              <NumberField label="Speed" value={draft.speed} min={1} max={255} disabled={editBusy} onChange={(value) => patch({ speed: value })} />
              <NumberField label="Special" value={draft.special} min={1} max={255} disabled={editBusy} onChange={(value) => patch({ special: value })} />
              <NumberField label="Catch Rate" value={draft.catchRate} min={0} max={255} disabled={editBusy} onChange={(value) => patch({ catchRate: value })} />
              <NumberField label="Base EXP" value={draft.baseExp} min={0} max={255} disabled={editBusy} onChange={(value) => patch({ baseExp: value })} />
            </div>

            <h5>Typing &amp; Growth</h5>
            <div className="field-grid stat-grid">
              <SelectField label="Type 1" value={draft.type1} options={document.options.types} disabled={editBusy} onChange={(value) => patch({ type1: value })} />
              <SelectField label="Type 2" value={draft.type2} options={document.options.types} disabled={editBusy} onChange={(value) => patch({ type2: value })} />
              <SelectField label="Growth Rate" value={draft.growthRate} options={document.options.growthRates} disabled={editBusy} onChange={(value) => patch({ growthRate: value })} />
            </div>

            <h5>Level 1 Moves</h5>
            <div className="field-grid stat-grid">
              {draft.startingMoves.map((move, index) => (
                <SelectField
                  key={index}
                  label={"Move " + (index + 1)}
                  value={move}
                  options={["NO_MOVE", ...document.options.moves]}
                  disabled={editBusy}
                  onChange={(value) => {
                    const next = [...draft.startingMoves];
                    next[index] = value;
                    patch({ startingMoves: next });
                  }}
                />
              ))}
            </div>
          </section>

          <section className="editor-card">
            <div className="section-heading">
              <div>
                <h4>Evolution</h4>
                <p>
                  Vanilla level, item, and trade evolutions are supported, plus Yellow Editor's
                  extended "level up knowing a move" method.
                </p>
              </div>
              <button
                type="button"
                className="small-button"
                disabled={
                  editBusy
                  || document.options.species.length === 0
                  || draft.evolutions.length >= document.options.maxEvolutions
                }
                onClick={() => patch({
                  evolutions: [
                    ...draft.evolutions,
                    {
                      method: "level",
                      level: "16",
                      item: "",
                      move: "",
                      target: document.options.species[0] || "",
                    },
                  ],
                })}
              >
                Add Evolution
              </button>
            </div>
            {draft.evolutions.length === 0 ? (
              <p className="empty-state">Does not evolve.</p>
            ) : (
              <div className="table-wrap">
                <table className="editor-table pokemon-edit-table">
                  <thead>
                    <tr>
                      <th>Method</th>
                      <th>Level / minimum</th>
                      <th>Requirement</th>
                      <th>Target</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {draft.evolutions.map((item, index) => (
                      <tr key={index}>
                        <td>
                          <select value={item.method} disabled={editBusy} onChange={(event) => updateEvolution(index, { method: event.target.value as PokemonEvolutionDraft["method"] })}>
                            <option value="level">Level</option>
                            <option value="item">Item</option>
                            <option value="trade">Trade</option>
                            <option value="move">Level up knowing move</option>
                          </select>
                        </td>
                        <td><input type="number" min={1} max={255} value={item.level} disabled={editBusy} onChange={(event) => updateEvolution(index, { level: event.target.value })} /></td>
                        <td>
                          {item.method === "item" ? (
                            <select
                              value={item.item}
                              disabled={editBusy}
                              onChange={(event) =>
                                updateEvolution(index, { item: event.target.value })}
                            >
                              {document.options.evolutionItems.map((option) => (
                                <option key={option} value={option}>{option}</option>
                              ))}
                            </select>
                          ) : item.method === "move" ? (
                            <select
                              value={item.move}
                              disabled={editBusy}
                              onChange={(event) =>
                                updateEvolution(index, { move: event.target.value })}
                            >
                              {document.options.moves.map((option) => (
                                <option key={option} value={option}>{option}</option>
                              ))}
                            </select>
                          ) : (
                            <span className="help-text">—</span>
                          )}
                        </td>
                        <td>
                          <select value={item.target} disabled={editBusy} onChange={(event) => updateEvolution(index, { target: event.target.value })}>
                            {document.options.species.map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                        </td>
                        <td>
                          <button type="button" className="small-button danger-action" disabled={editBusy} onClick={() => patch({ evolutions: draft.evolutions.filter((_, itemIndex) => itemIndex !== index) })}>
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="help-text">
              Move-based evolutions are checked after level-up move learning. A Pokémon can
              therefore learn its required move on that same level-up and evolve immediately
              afterward. Rare Candy follows the same order. This project's evolution buffer
              supports up to {document.options.maxEvolutions} evolution entries per Pokémon.
            </p>
          </section>

          <section className="editor-card">
            <div className="section-heading">
              <div>
                <h4>Level-up Learnset</h4>
                <p>These are learned after the four level-1 move slots above.</p>
              </div>
              <button
                type="button"
                className="small-button"
                disabled={editBusy || document.options.moves.length === 0}
                onClick={() => {
                  const last = Number(draft.learnset[draft.learnset.length - 1]?.level || 0);
                  patch({
                    learnset: [
                      ...draft.learnset,
                      {
                        level: String(Math.min(100, Math.max(1, last + 1))),
                        moveConstant: document.options.moves[0] || "",
                      },
                    ],
                  });
                }}
              >
                Add Move
              </button>
            </div>
            {draft.learnset.length === 0 ? (
              <p className="empty-state">No later level-up moves.</p>
            ) : (
              <div className="table-wrap">
                <table className="editor-table compact-table pokemon-edit-table">
                  <thead><tr><th>Level</th><th>Move</th><th /></tr></thead>
                  <tbody>
                    {draft.learnset.map((move, index) => (
                      <tr key={index}>
                        <td><input type="number" min={1} max={100} value={move.level} disabled={editBusy} onChange={(event) => updateLearnset(index, { level: event.target.value })} /></td>
                        <td>
                          <select value={move.moveConstant} disabled={editBusy} onChange={(event) => updateLearnset(index, { moveConstant: event.target.value })}>
                            {document.options.moves.map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                        </td>
                        <td><button type="button" className="small-button danger-action" disabled={editBusy} onClick={() => patch({ learnset: draft.learnset.filter((_, itemIndex) => itemIndex !== index) })}>Remove</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="editor-card">
            <h4>TM/HM Compatibility</h4>
            <p className="help-text">Toggle every TM and HM the species can learn.</p>
            <div className="move-chip-grid">
              {document.options.tmhmMoves.map((move) => (
                <label key={move} className="compatibility-chip">
                  <input
                    type="checkbox"
                    checked={draft.tmhmMoves.includes(move)}
                    disabled={editBusy}
                    onChange={() => toggleTmhm(move)}
                  />
                  <span>{move}</span>
                </label>
              ))}
            </div>
          </section>

          <section className="editor-card">
            <div className="section-heading">
              <div>
                <h4>Pokédex</h4>
                <p>Edit the species category, measurements, and the exact line/page structure of the entry.</p>
              </div>
            </div>
            {draft.pokedex ? (
              <>
                <div className="field-grid dex-grid">
                  <label className="editor-field">
                    <span>Species</span>
                    <input value={draft.pokedex.category} maxLength={11} disabled={editBusy} onChange={(event) => patch({ pokedex: { ...draft.pokedex!, category: event.target.value } })} />
                  </label>
                  <NumberField label="Height (ft)" value={draft.pokedex.heightFeet} min={0} max={255} disabled={editBusy} onChange={(value) => patch({ pokedex: { ...draft.pokedex!, heightFeet: value } })} />
                  <NumberField label="Height (in)" value={draft.pokedex.heightInches} min={0} max={11} disabled={editBusy} onChange={(value) => patch({ pokedex: { ...draft.pokedex!, heightInches: value } })} />
                  <label className="editor-field">
                    <span>Weight (lb)</span>
                    <input type="number" min={0} max={6553.5} step={0.1} value={draft.pokedex.weightLb} disabled={editBusy} onChange={(event) => patch({ pokedex: { ...draft.pokedex!, weightLb: event.target.value } })} />
                  </label>
                </div>

                <h5>Entry Text</h5>
                <div className="pokemon-dex-text-editor">
                  <TextEditor
                    title="Pokédex entry text"
                    target={selectedPokemon.pokedex?.textLabel ? {
                      path: "data/pokemon/dex_text.asm",
                      label: selectedPokemon.pokedex.textLabel,
                    } : null}
                    initialText={null}
                    disabled={editBusy}
                    controlledTerminator="dex"
                    controlledSegments={draft.pokedex.textLines.map((line) => ({
                      control: line.kind,
                      text: line.text,
                    }))}
                    onControlledSegmentsChange={(segments) => patch({
                      pokedex: {
                        ...draft.pokedex!,
                        textLines: segments.map((segment) => ({
                          kind: segment.control as "text" | "next" | "page",
                          text: segment.text,
                        })),
                      },
                    })}
                  />
                  <p className="help-text">
                    Text edits stay in this Pokémon draft and are saved together with the rest of the species data.
                  </p>
                </div>
              </>
            ) : (
              <p className="empty-state">No editable Pokédex data.</p>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
