import type {
  ItemData,
  ItemEditDocument,
  ItemEditValues,
  MoveData,
  PokemonTmhmCompatibilityReference,
  ProjectInfo,
  TmEditDocument,
} from "./core/types";
import { ReadonlyField } from "./editor/EditorFields";
import { formatHex } from "./editor/format";

interface ItemsTabProps {
  project: ProjectInfo | null;
  items: ItemData[];
  moves: MoveData[];
  selectedItemId: number | null;
  itemSearch: string;
  affectedPokemon: PokemonTmhmCompatibilityReference[];
  retainedPokemonIds: number[];
  tmEditDocument: TmEditDocument | null;
  tmMoveDraft: string | null;
  itemEditDocument: ItemEditDocument | null;
  itemEditDraft: ItemEditValues | null;
  itemEditLoading: boolean;
  itemEditError: string | null;
  editBusy: boolean;
  compatibilityLoading: boolean;
  compatibilityError: string | null;
  onSelectItem(id: number): void;
  onSearchChange(value: string): void;
  onTmMoveChange(moveConstant: string): void;
  onItemEditDraftChange(value: ItemEditValues | null): void;
  onCompatibilityRetainedChange(internalId: number, retained: boolean): void;
  onSelectAllCompatibility(): void;
  onDeselectAllCompatibility(): void;
  onOpenPokemon(internalId: number): void;
}

function kindLabel(item: ItemData): string {
  switch (item.kind) {
    case "key-item": return "Key item";
    case "tm": return "TM";
    case "hm": return "HM";
    case "unused": return "Unused item slot";
    default: return "Item";
  }
}

function behaviorLabel(item: ItemData): string {
  switch (item.menuBehavior) {
    case "party": return "Opens party menu";
    case "overworld": return "Closes menu / overworld use";
    case "tmhm": return "TM/HM teaching flow";
    case "unusable": return "No direct Item-menu use";
    default: return "Direct item effect";
  }
}

function priceLabel(item: ItemData): string {
  return item.price === null ? "Not priced" : `₽${item.price.toLocaleString()}`;
}

export function ItemsTab({
  project,
  items,
  moves,
  selectedItemId,
  itemSearch,
  affectedPokemon,
  retainedPokemonIds,
  tmEditDocument,
  tmMoveDraft,
  itemEditDocument,
  itemEditDraft,
  itemEditLoading,
  itemEditError,
  editBusy,
  compatibilityLoading,
  compatibilityError,
  onSelectItem,
  onSearchChange,
  onTmMoveChange,
  onItemEditDraftChange,
  onCompatibilityRetainedChange,
  onSelectAllCompatibility,
  onDeselectAllCompatibility,
  onOpenPokemon,
}: ItemsTabProps) {
  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null;
  const moveByConstant = new Map(moves.map((move) => [move.constant, move]));
  const query = itemSearch.trim().toLowerCase();
  const filteredItems = items.filter((item) => {
    if (!query) return true;
    const move = item.moveConstant ? moveByConstant.get(item.moveConstant) : null;
    return (
      item.name.toLowerCase().includes(query)
      || item.constant.toLowerCase().includes(query)
      || formatHex(item.id).toLowerCase().includes(query)
      || item.moveConstant?.toLowerCase().includes(query)
      || move?.name.toLowerCase().includes(query)
      || item.useRoutine?.toLowerCase().includes(query)
    );
  });

  const taughtMove = selectedItem?.moveConstant
    ? moveByConstant.get(selectedItem.moveConstant) ?? null
    : null;
  const replacementMoves = tmEditDocument
    ? moves.filter((move) => tmEditDocument.replacementMoveConstants.includes(move.constant))
    : [];
  const pendingMove = tmMoveDraft ? moveByConstant.get(tmMoveDraft) ?? null : null;

  const retainedPokemon = new Set(retainedPokemonIds);
  const retainedCount = affectedPokemon.filter((pokemon) =>
    retainedPokemon.has(pokemon.internalId),
  ).length;

  const ordinaryItem = selectedItem
    && selectedItem.kind !== "tm"
    && selectedItem.kind !== "hm";

  function changeItemDraft(patch: Partial<ItemEditValues>) {
    if (!itemEditDraft) return;
    onItemEditDraftChange({ ...itemEditDraft, ...patch });
  }

  function changeBallParameter(
    key:
      | "greatRandomCeiling"
      | "ultraSafariRandomCeiling"
      | "greatHpDivisor"
      | "otherHpDivisor"
      | "pokeShakeDivisor"
      | "greatShakeDivisor"
      | "ultraSafariShakeDivisor",
    value: number,
  ) {
    if (!itemEditDraft || itemEditDraft.routineParameters.kind !== "ball") return;
    changeItemDraft({
      routineParameters: {
        ...itemEditDraft.routineParameters,
        [key]: value,
      },
    });
  }

  return (
    <section className="tab-content">
      <div className="tab-heading-row">
        <div>
          <h2>Items</h2>
          <p>Browse item IDs, names, prices, use routines, key-item flags, and TM/HM move assignments.</p>
        </div>
      </div>

      {!project ? (
        <p>Open a project to browse items.</p>
      ) : (
        <div className="item-browser">
          <aside>
            <input
              type="search"
              placeholder="Search items, TMs, moves..."
              value={itemSearch}
              onChange={(event) => onSearchChange(event.target.value)}
              className="full-width-input"
            />
            <p className="browser-count">{filteredItems.length} of {items.length} entries</p>

            <div className="item-list">
              {filteredItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => onSelectItem(item.id)}
                  className={item.id === selectedItemId ? "active" : ""}
                >
                  <span>{formatHex(item.id)} — {item.name}</span>
                  <small>
                    {item.kind === "tm" || item.kind === "hm"
                      ? `${item.constant} · ${item.moveConstant ?? "No move"}`
                      : item.constant}
                  </small>
                </button>
              ))}

              {filteredItems.length === 0 && <p>No items match that search.</p>}
            </div>
          </aside>

          <section className="editor-card">
            {selectedItem ? (
              <>
                <h3>{ordinaryItem && itemEditDraft ? itemEditDraft.name : selectedItem.name}</h3>
                <p className="muted-code">
                  {formatHex(selectedItem.id)} — {selectedItem.constant}
                </p>

                <h4>Item Data</h4>
                <div className="field-grid two-column-fields">
                  <ReadonlyField label="Index Number" value={formatHex(selectedItem.id)} />
                  {ordinaryItem && itemEditDraft && itemEditDocument ? (
                    <>
                      <label className="editor-field">
                        <span>Name</span>
                        <input
                          value={itemEditDraft.name}
                          maxLength={itemEditDocument.maxNameLength}
                          disabled={editBusy}
                          onChange={(event) => changeItemDraft({ name: event.target.value })}
                        />
                        <small>{itemEditDraft.name.length}/{itemEditDocument.maxNameLength}</small>
                      </label>
                      <label className="editor-field">
                        <span>Price</span>
                        <input
                          type="number"
                          min="0"
                          max="999999"
                          step="1"
                          value={itemEditDraft.price}
                          disabled={editBusy}
                          onChange={(event) => changeItemDraft({
                            price: Number.parseInt(event.target.value || "0", 10),
                          })}
                        />
                      </label>
                    </>
                  ) : (
                    <>
                      <ReadonlyField label="Name" value={selectedItem.name} />
                      <ReadonlyField label="Price" value={priceLabel(selectedItem)} />
                    </>
                  )}
                  <ReadonlyField label="Constant" value={selectedItem.constant} />
                  <ReadonlyField label="Category" value={kindLabel(selectedItem)} />
                  {ordinaryItem && itemEditDraft ? (
                    <label className="editor-field item-boolean-field">
                      <span>Key Item</span>
                      <input
                        type="checkbox"
                        checked={itemEditDraft.keyItem}
                        disabled={editBusy}
                        onChange={(event) => changeItemDraft({ keyItem: event.target.checked })}
                      />
                    </label>
                  ) : (
                    <ReadonlyField label="Key Item" value={selectedItem.keyItem ? "Yes" : "No"} />
                  )}
                  <ReadonlyField label="Menu Behavior" value={behaviorLabel(selectedItem)} />
                  <ReadonlyField
                    label="Use Routine"
                    value={selectedItem.useRoutine ?? "No routine resolved"}
                  />
                </div>

                {ordinaryItem && (
                  <>
                    <h4>Routine Details</h4>
                    {itemEditLoading ? (
                      <p className="help-text">Reading item routine parameters…</p>
                    ) : itemEditError ? (
                      <p className="item-compatibility-error">{itemEditError}</p>
                    ) : itemEditDraft?.routineParameters.kind === "fixed-heal" ? (
                      <div className="item-routine-panel">
                        <strong>Fixed HP restoration</strong>
                        <label className="editor-field">
                          <span>HP Restored</span>
                          <input
                            type="number"
                            min="0"
                            max="255"
                            step="1"
                            value={itemEditDraft.routineParameters.healAmount}
                            disabled={editBusy}
                            onChange={(event) => changeItemDraft({
                              routineParameters: {
                                kind: "fixed-heal",
                                healAmount: Number.parseInt(event.target.value || "0", 10),
                              },
                            })}
                          />
                        </label>
                        <p className="help-text">
                          This edits the byte loaded by <code>ItemUseMedicine</code> for this item.
                        </p>
                      </div>
                    ) : itemEditDraft?.routineParameters.kind === "special-heal" ? (
                      <div className="item-routine-panel">
                        <strong>Healing behavior</strong>
                        <p>{itemEditDraft.routineParameters.description}</p>
                        <p className="help-text">
                          This effect is formula-driven rather than a fixed HP byte, so it is read-only for now.
                        </p>
                      </div>
                    ) : itemEditDraft?.routineParameters.kind === "ball" ? (
                      <div className="item-routine-panel">
                        <strong>Catch Formula</strong>
                        <p className="help-text">
                          Gen I shares several constants between ball types. These fields expose the
                          exact routine values, including the Ultra/Safari shared values, rather than
                          presenting them as independent modifiers.
                        </p>
                        <div className="field-grid two-column-fields">
                          <ReadonlyField label="Master Ball" value="Guaranteed catch" />
                          <label className="editor-field">
                            <span>Great Ball RNG Ceiling</span>
                            <input
                              type="number"
                              min="0"
                              max="255"
                              value={itemEditDraft.routineParameters.greatRandomCeiling}
                              disabled={editBusy}
                              onChange={(event) => changeBallParameter(
                                "greatRandomCeiling",
                                Number.parseInt(event.target.value || "0", 10),
                              )}
                            />
                          </label>
                          <label className="editor-field">
                            <span>Ultra / Safari RNG Ceiling</span>
                            <input
                              type="number"
                              min="0"
                              max="255"
                              value={itemEditDraft.routineParameters.ultraSafariRandomCeiling}
                              disabled={editBusy}
                              onChange={(event) => changeBallParameter(
                                "ultraSafariRandomCeiling",
                                Number.parseInt(event.target.value || "0", 10),
                              )}
                            />
                          </label>
                          <label className="editor-field">
                            <span>Great Ball HP Divisor</span>
                            <input
                              type="number"
                              min="1"
                              max="255"
                              value={itemEditDraft.routineParameters.greatHpDivisor}
                              disabled={editBusy}
                              onChange={(event) => changeBallParameter(
                                "greatHpDivisor",
                                Number.parseInt(event.target.value || "1", 10),
                              )}
                            />
                          </label>
                          <label className="editor-field">
                            <span>Poké / Ultra / Safari HP Divisor</span>
                            <input
                              type="number"
                              min="1"
                              max="255"
                              value={itemEditDraft.routineParameters.otherHpDivisor}
                              disabled={editBusy}
                              onChange={(event) => changeBallParameter(
                                "otherHpDivisor",
                                Number.parseInt(event.target.value || "1", 10),
                              )}
                            />
                          </label>
                          <label className="editor-field">
                            <span>Poké Ball Shake Divisor</span>
                            <input
                              type="number"
                              min="1"
                              max="255"
                              value={itemEditDraft.routineParameters.pokeShakeDivisor}
                              disabled={editBusy}
                              onChange={(event) => changeBallParameter(
                                "pokeShakeDivisor",
                                Number.parseInt(event.target.value || "1", 10),
                              )}
                            />
                          </label>
                          <label className="editor-field">
                            <span>Great Ball Shake Divisor</span>
                            <input
                              type="number"
                              min="1"
                              max="255"
                              value={itemEditDraft.routineParameters.greatShakeDivisor}
                              disabled={editBusy}
                              onChange={(event) => changeBallParameter(
                                "greatShakeDivisor",
                                Number.parseInt(event.target.value || "1", 10),
                              )}
                            />
                          </label>
                          <label className="editor-field">
                            <span>Ultra / Safari Shake Divisor</span>
                            <input
                              type="number"
                              min="1"
                              max="255"
                              value={itemEditDraft.routineParameters.ultraSafariShakeDivisor}
                              disabled={editBusy}
                              onChange={(event) => changeBallParameter(
                                "ultraSafariShakeDivisor",
                                Number.parseInt(event.target.value || "1", 10),
                              )}
                            />
                          </label>
                        </div>
                        <p className="help-text">
                          Lower HP and shake divisors generally make capture easier. The RNG ceilings
                          limit the first random roll; lower ceilings favor capture. The Great Ball
                          ceiling is also the first gate passed by Ultra and Safari Balls in the vanilla routine.
                        </p>
                      </div>
                    ) : itemEditDraft?.routineParameters.kind === "routine" ? (
                      <div className="item-routine-panel">
                        <p>{itemEditDraft.routineParameters.description}</p>
                      </div>
                    ) : null}
                  </>
                )}

                {(selectedItem.kind === "tm" || selectedItem.kind === "hm") && (
                  <>
                    <h4>Machine Data</h4>
                    <div className="field-grid two-column-fields">
                      <ReadonlyField
                        label={selectedItem.kind === "tm" ? "TM Number" : "HM Number"}
                        value={String(selectedItem.machineNumber ?? "")}
                      />
                      {selectedItem.kind === "tm" ? (
                        <>
                          <label className="editor-field">
                            <span>Assigned Move</span>
                            <select
                              value={tmMoveDraft ?? selectedItem.moveConstant ?? ""}
                              disabled={editBusy || compatibilityLoading || !tmEditDocument}
                              onChange={(event) => onTmMoveChange(event.target.value)}
                            >
                              {replacementMoves.map((move) => (
                                <option key={move.constant} value={move.constant}>
                                  {move.name} — {move.constant}
                                </option>
                              ))}
                            </select>
                          </label>
                          <ReadonlyField
                            label="Move Constant"
                            value={tmMoveDraft ?? selectedItem.moveConstant ?? "Not resolved"}
                          />
                          <ReadonlyField
                            label="Move Name"
                            value={pendingMove?.name ?? tmMoveDraft ?? "Not resolved"}
                          />
                        </>
                      ) : (
                        <>
                          <ReadonlyField
                            label="Move Constant"
                            value={selectedItem.moveConstant ?? "Not resolved"}
                          />
                          <ReadonlyField
                            label="Move Name"
                            value={taughtMove?.name ?? selectedItem.moveConstant ?? "Not resolved"}
                          />
                        </>
                      )}
                    </div>
                    {selectedItem.kind === "hm" && (
                      <p className="help-text">
                        HM editing is intentionally disabled until Yellow Editor can safely migrate
                        field effects and badge requirements.
                      </p>
                    )}
                    {selectedItem.kind === "tm"
                      && tmEditDocument
                      && tmMoveDraft
                      && tmMoveDraft !== tmEditDocument.moveConstant && (
                        <div className="item-tm-migration-preview">
                          <strong>Pending TM migration</strong>
                          <span>
                            TM{String(tmEditDocument.tmNumber).padStart(2, "0")} will change from{" "}
                            <code>{tmEditDocument.moveConstant}</code> to <code>{tmMoveDraft}</code>.
                          </span>
                        </div>
                      )}
                    <p className="help-text">
                      This assignment comes directly from <code>constants/item_constants.asm</code>.
                      Pokémon TM/HM compatibility reads that same table, so machine assignments and
                      compatibility stay tied to one source of truth.
                    </p>

                    <div className="item-compatibility-warning" role="note">
                      <strong>
                        Compatibility review
                        {!compatibilityLoading && !compatibilityError
                          ? ` — ${affectedPokemon.length} affected Pokémon`
                          : ""}
                      </strong>
                      <p>
                        If this machine's assigned move changes, every Pokémon currently carrying
                        the <code>{selectedItem.moveConstant}</code> compatibility flag should be reviewed.
                      </p>
                      {compatibilityLoading ? (
                        <p className="help-text">Cross-referencing Pokémon base stats…</p>
                      ) : compatibilityError ? (
                        <p className="item-compatibility-error">
                          Could not load the compatibility cross-reference: {compatibilityError}
                        </p>
                      ) : affectedPokemon.length === 0 ? (
                        <p className="help-text">
                          No Pokémon currently reference this move in their TM/HM compatibility data.
                        </p>
                      ) : selectedItem.kind === "tm" ? (
                        <>
                          <div className="item-compatibility-selection-summary">
                            <span>
                              <strong>{retainedCount}</strong> of {affectedPokemon.length} selected to retain this TM slot
                            </span>
                            <div className="item-compatibility-selection-actions">
                              <button
                                type="button"
                                className="small-button"
                                disabled={editBusy || retainedCount === affectedPokemon.length}
                                onClick={onSelectAllCompatibility}
                              >
                                Select all
                              </button>
                              <button
                                type="button"
                                className="small-button"
                                disabled={editBusy || retainedCount === 0}
                                onClick={onDeselectAllCompatibility}
                              >
                                Deselect all
                              </button>
                            </div>
                          </div>
                          <p className="help-text">
                            Checked Pokémon will keep this TM slot if you save a new assigned move.
                            Unchecked Pokémon will lose the slot. Click a Pokémon name to review it first.
                          </p>
                          <div className="item-affected-pokemon-list">
                            {[...affectedPokemon]
                              .sort((left, right) => left.displayName.localeCompare(right.displayName))
                              .map((pokemon) => {
                                const retained = retainedPokemon.has(pokemon.internalId);
                                return (
                                  <div
                                    className={`item-affected-pokemon${retained ? " retained" : ""}`}
                                    key={pokemon.internalId}
                                  >
                                    <label>
                                      <input
                                        type="checkbox"
                                        checked={retained}
                                        disabled={editBusy}
                                        onChange={(event) =>
                                          onCompatibilityRetainedChange(
                                            pokemon.internalId,
                                            event.target.checked,
                                          )}
                                      />
                                      <span>Retain</span>
                                    </label>
                                    <a
                                      href="#pokemon"
                                      title={`${pokemon.constant} · ${formatHex(pokemon.internalId)}`}
                                      onClick={(event) => {
                                        event.preventDefault();
                                        onOpenPokemon(pokemon.internalId);
                                      }}
                                    >
                                      {pokemon.displayName}
                                    </a>
                                  </div>
                                );
                              })}
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="help-text">
                            These Pokémon currently reference this HM move. HM compatibility is shown
                            for review only; HM editing is not enabled.
                          </p>
                          <div className="item-affected-pokemon-list item-affected-pokemon-links-only">
                            {[...affectedPokemon]
                              .sort((left, right) => left.displayName.localeCompare(right.displayName))
                              .map((pokemon) => (
                                <a
                                  key={pokemon.internalId}
                                  href="#pokemon"
                                  title={`${pokemon.constant} · ${formatHex(pokemon.internalId)}`}
                                  onClick={(event) => {
                                    event.preventDefault();
                                    onOpenPokemon(pokemon.internalId);
                                  }}
                                >
                                  {pokemon.displayName}
                                </a>
                              ))}
                          </div>
                        </>
                      )}
                    </div>
                  </>
                )}

                <details className="item-source-details">
                  <summary>Source tables</summary>
                  <ul>
                    <li><code>constants/item_constants.asm</code> — IDs and TM/HM assignments</li>
                    {selectedItem.kind !== "tm" && selectedItem.kind !== "hm" && (
                      <>
                        <li><code>data/items/names.asm</code> — display name</li>
                        <li><code>data/items/prices.asm</code> — base price</li>
                        <li><code>data/items/key_items.asm</code> — key-item flag</li>
                        <li><code>engine/items/item_effects.asm</code> — use routine</li>
                      </>
                    )}
                    {selectedItem.kind === "tm" && (
                      <li><code>data/items/tm_prices.asm</code> — TM price</li>
                    )}
                  </ul>
                </details>
              </>
            ) : (
              <p>Select an item.</p>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
