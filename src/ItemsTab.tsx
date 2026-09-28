import type {
  ItemData,
  MoveData,
  PokemonTmhmCompatibilityReference,
  ProjectInfo,
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
  compatibilityLoading: boolean;
  compatibilityError: string | null;
  onSelectItem(id: number): void;
  onSearchChange(value: string): void;
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
  compatibilityLoading,
  compatibilityError,
  onSelectItem,
  onSearchChange,
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
                <h3>{selectedItem.name}</h3>
                <p className="muted-code">
                  {formatHex(selectedItem.id)} — {selectedItem.constant}
                </p>

                <h4>Item Data</h4>
                <div className="field-grid two-column-fields">
                  <ReadonlyField label="Index Number" value={formatHex(selectedItem.id)} />
                  <ReadonlyField label="Name" value={selectedItem.name} />
                  <ReadonlyField label="Constant" value={selectedItem.constant} />
                  <ReadonlyField label="Category" value={kindLabel(selectedItem)} />
                  <ReadonlyField label="Price" value={priceLabel(selectedItem)} />
                  <ReadonlyField label="Key Item" value={selectedItem.keyItem ? "Yes" : "No"} />
                  <ReadonlyField label="Menu Behavior" value={behaviorLabel(selectedItem)} />
                  <ReadonlyField
                    label="Use Routine"
                    value={selectedItem.useRoutine ?? "No routine resolved"}
                  />
                </div>

                {(selectedItem.kind === "tm" || selectedItem.kind === "hm") && (
                  <>
                    <h4>Machine Data</h4>
                    <div className="field-grid two-column-fields">
                      <ReadonlyField
                        label={selectedItem.kind === "tm" ? "TM Number" : "HM Number"}
                        value={String(selectedItem.machineNumber ?? "")}
                      />
                      <ReadonlyField
                        label="Move Constant"
                        value={selectedItem.moveConstant ?? "Not resolved"}
                      />
                      <ReadonlyField
                        label="Move Name"
                        value={taughtMove?.name ?? selectedItem.moveConstant ?? "Not resolved"}
                      />
                    </div>
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
                      ) : (
                        <div className="item-affected-pokemon-list">
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
