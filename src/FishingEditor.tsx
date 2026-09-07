import { useState } from "react";
import type { FishingEditDocument, PokemonIndexEntry } from "./core/types";
import { encounterLevelError } from "./editor/encounterForm";
import type {
  FishingDraft,
  FishingRod,
  FishingSlotDraft,
  SuperRodTableDraft,
} from "./editor/fishingForm";

interface FishingEditorProps {
  document: FishingEditDocument | null;
  draft: FishingDraft | null;
  error: string | null;
  pokemonIndex: PokemonIndexEntry[];
  dirty: boolean;
  busy: boolean;
  onUpdateSlot(
    rod: FishingRod,
    tableId: string | null,
    slotIndex: number,
    field: "level" | "speciesConstant",
    value: string,
  ): void;
}

function AffectedLocations({ locations }: { locations: string[] }) {
  return (
    <div className="affected-locations">
      <strong>{locations.length > 1 ? `Shared by ${locations.length} locations` : "Affects"}</strong>
      <span>{locations.length ? locations.join(", ") : "Every map where this rod can be used"}</span>
    </div>
  );
}

function FishingSlotsTable({
  slots,
  chances,
  species,
  busy,
  rod,
  tableId,
  onUpdateSlot,
}: {
  slots: FishingSlotDraft[];
  chances: string[];
  species: PokemonIndexEntry[];
  busy: boolean;
  rod: FishingRod;
  tableId: string | null;
  onUpdateSlot: FishingEditorProps["onUpdateSlot"];
}) {
  return (
    <div className="table-wrap">
      <table className="editor-table encounter-table">
        <thead>
          <tr><th>Slot</th><th>Chance</th><th>Pokémon</th><th>Level</th></tr>
        </thead>
        <tbody>
          {slots.map((slot, index) => {
            const levelError = encounterLevelError(slot.level);
            return (
              <tr key={`${slot.sourceLine}-${index}`}>
                <td>{index + 1}</td>
                <td>{chances[index]}</td>
                <td>
                  <select
                    value={slot.speciesConstant}
                    disabled={busy}
                    onChange={(event) =>
                      onUpdateSlot(rod, tableId, index, "speciesConstant", event.target.value)
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
                      onUpdateSlot(rod, tableId, index, "level", event.target.value)
                    }
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function FishingEditor({
  document,
  draft,
  error,
  pokemonIndex,
  dirty,
  busy,
  onUpdateSlot,
}: FishingEditorProps) {
  const [rod, setRod] = useState<FishingRod>("old");
  const [search, setSearch] = useState("");
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  if (!document || !draft) {
    return <p>Fishing data could not be loaded from this project.{error ? ` ${error}` : ""}</p>;
  }

  const species = pokemonIndex.filter((entry) => entry.kind === "pokemon" && entry.constant);
  const query = search.trim().toLowerCase();
  const filteredTables = draft.superRodTables.filter((table) =>
    !query ||
    table.displayName.toLowerCase().includes(query) ||
    table.affectedLocations.some((location) => location.toLowerCase().includes(query)),
  );
  const selectedTable = draft.superRodTables.find((table) => table.id === selectedTableId)
    ?? draft.superRodTables[0]
    ?? null;

  function superRodChances(table: SuperRodTableDraft): string[] {
    if (draft?.format === "yellow") {
      return ["39.8%", "29.7%", "19.9%", "10.5%"]; 
    }
    const chance = `${(100 / table.slots.length).toFixed(1)}%`;
    return table.slots.map(() => chance);
  }

  return (
    <div className="fishing-editor">
      <div className="section-heading">
        <div>
          <h3>Fishing</h3>
          <p>Rod encounter contents are editable; bite rates remain part of the game mechanics.</p>
        </div>
        {dirty && <span className="unsaved-indicator">Modified</span>}
      </div>

      <div className="segmented-control" aria-label="Fishing rod">
        {(["old", "good", "super"] as const).map((item) => (
          <button key={item} className={rod === item ? "active" : ""} onClick={() => setRod(item)}>
            {item === "old" ? "Old Rod" : item === "good" ? "Good Rod" : "Super Rod"}
          </button>
        ))}
      </div>

      {rod === "old" && (
        <section className="editor-card nested-editor-card">
          <h4>Old Rod</h4>
          <p className="muted-code">engine/items/item_effects.asm</p>
          <AffectedLocations locations={[]} />
          <p className="help-text">The Old Rod always hooks this encounter when fishing is allowed.</p>
          <FishingSlotsTable
            slots={[draft.oldRod]}
            chances={["100%"]}
            species={species}
            busy={busy}
            rod="old"
            tableId={null}
            onUpdateSlot={onUpdateSlot}
          />
        </section>
      )}

      {rod === "good" && (
        <section className="editor-card nested-editor-card">
          <h4>Good Rod</h4>
          <p className="muted-code">data/wild/good_rod.asm</p>
          <AffectedLocations locations={[]} />
          <p className="help-text">Each successful bite chooses equally between these two slots.</p>
          <FishingSlotsTable
            slots={draft.goodRod}
            chances={["50%", "50%"]}
            species={species}
            busy={busy}
            rod="good"
            tableId={null}
            onUpdateSlot={onUpdateSlot}
          />
        </section>
      )}

      {rod === "super" && selectedTable && (
        <div className="super-rod-browser">
          <aside>
            <input
              type="search"
              placeholder="Search fishing locations..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="full-width-input"
            />
            <div className="encounter-list">
              {filteredTables.map((table) => (
                <button
                  key={table.id}
                  className={table.id === selectedTable.id ? "active" : ""}
                  onClick={() => setSelectedTableId(table.id)}
                >
                  <span>{table.displayName}</span>
                  <small>
                    {table.affectedLocations.length > 1
                      ? `Shared by ${table.affectedLocations.length} locations`
                      : table.affectedLocations[0] ?? "No assigned locations"}
                  </small>
                </button>
              ))}
              {filteredTables.length === 0 && <p>No fishing locations match that search.</p>}
            </div>
          </aside>

          <section className="editor-card nested-editor-card">
            <h4>{selectedTable.displayName}</h4>
            <p className="muted-code">data/wild/super_rod.asm</p>
            <AffectedLocations locations={selectedTable.affectedLocations} />
            {document.format === "red-blue" && selectedTable.affectedLocations.length > 1 && (
              <p className="shared-warning">Editing this group changes Super Rod encounters in every listed location.</p>
            )}
            <FishingSlotsTable
              slots={selectedTable.slots}
              chances={superRodChances(selectedTable)}
              species={species}
              busy={busy}
              rod="super"
              tableId={selectedTable.id}
              onUpdateSlot={onUpdateSlot}
            />
          </section>
        </div>
      )}
    </div>
  );
}
