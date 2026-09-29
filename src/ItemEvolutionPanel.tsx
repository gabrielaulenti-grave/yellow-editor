import type {
  ItemData,
  ItemEvolutionEditData,
} from "./core/types";

interface ItemEvolutionPanelProps {
  data: ItemEvolutionEditData;
  items: ItemData[];
  busy: boolean;
  onChange(data: ItemEvolutionEditData): void;
  onOpenPokemon(internalId: number): void;
}

function itemLabel(items: ItemData[], constant: string): string {
  const item = items.find((entry) => entry.constant === constant);
  return item ? item.name + " — " + constant : constant;
}

export function ItemEvolutionPanel({
  data,
  items,
  busy,
  onChange,
  onOpenPokemon,
}: ItemEvolutionPanelProps) {
  return (
    <div className="item-routine-panel">
      <strong>Item Evolution Trigger</strong>
      <p className="help-text">
        {data.triggerMode === "native"
          ? "This item uses Gen I's native evolution-item routine."
          : "This medicine keeps its normal healing/status behavior. Yellow Editor adds a post-use evolution hook only when at least one Pokémon references it with EVOLVE_ITEM."}
      </p>

      {data.triggerMode === "medicine" && (
        <p className="help-text">
          Runtime hook: <strong>{data.runtimeEnabled ? "installed" : "not currently needed"}</strong>.
          The hook is installed automatically when an evolution is assigned to this item and is
          disabled from the managed list when no evolution references it.
        </p>
      )}

      {data.references.length === 0 ? (
        <p className="help-text">
          No Pokémon currently evolves with this item. Add an Item evolution from a Pokémon's
          Evolution section to create one.
        </p>
      ) : (
        <div className="item-evolution-reference-list">
          {data.references.map((reference, index) => (
            <div
              className="item-evolution-reference"
              key={
                reference.internalId
                + ":"
                + reference.evolutionIndex
                + ":"
                + reference.targetConstant
              }
            >
              <div className="item-evolution-route">
                <a
                  href="#pokemon"
                  onClick={(event) => {
                    event.preventDefault();
                    onOpenPokemon(reference.internalId);
                  }}
                >
                  {reference.sourceDisplayName}
                </a>
                <span>→</span>
                <strong>{reference.targetDisplayName}</strong>
                {reference.minimumLevel > 1 && (
                  <small>minimum level {reference.minimumLevel}</small>
                )}
              </div>
              <label className="editor-field">
                <span>Evolution Item</span>
                <select
                  value={reference.itemConstant}
                  disabled={busy}
                  onChange={(event) => {
                    const references = data.references.map(
                      (candidate, candidateIndex) =>
                        candidateIndex === index
                          ? { ...candidate, itemConstant: event.target.value }
                          : candidate,
                    );
                    onChange({ ...data, references });
                  }}
                >
                  {data.eligibleItemConstants.map((constant) => (
                    <option key={constant} value={constant}>
                      {itemLabel(items, constant)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ))}
        </div>
      )}

      <p className="help-text">
        Native stones and party-targeting medicines are supported. Medicines evolve only outside
        battle. If their normal effect has no effect but the selected Pokémon can evolve with the
        item, the item is still allowed to trigger the evolution.
      </p>
    </div>
  );
}
