import type { MoveData, ProjectInfo } from "./core/types";
import { ReadonlyField } from "./editor/EditorFields";
import { formatHex } from "./editor/format";

interface MovesTabProps {
  project: ProjectInfo | null;
  moves: MoveData[];
  selectedMoveId: number | null;
  moveSearch: string;
  onSelectMove(id: number): void;
  onSearchChange(value: string): void;
}

export function MovesTab({
  project,
  moves,
  selectedMoveId,
  moveSearch,
  onSelectMove,
  onSearchChange,
}: MovesTabProps) {
  const selectedMove = moves.find((move) => move.id === selectedMoveId) ?? null;
  const query = moveSearch.trim().toLowerCase();
  const filteredMoves = moves.filter((move) => {
    if (!query) {
      return true;
    }

    return (
      move.name.toLowerCase().includes(query) ||
      move.constant.toLowerCase().includes(query) ||
      formatHex(move.id).toLowerCase().includes(query)
    );
  });

  return (
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
              onChange={(event) => onSearchChange(event.target.value)}
              className="full-width-input"
            />

            <div className="move-list">
              {filteredMoves.map((move) => (
                <button
                  key={move.id}
                  onClick={() => onSelectMove(move.id)}
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
  );
}
