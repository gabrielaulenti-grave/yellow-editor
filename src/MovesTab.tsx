import type { MoveData, ProjectInfo } from "./core/types";
import { ReadonlyField } from "./editor/EditorFields";
import { formatHex } from "./editor/format";
import { requestGraphicsEditor } from "./editor/graphicsNavigation";
import { useState } from "react";
import { ContentCreateDialog, type CreatedContent } from "./ContentCreateDialog";
import type { MoveEditDocument } from "./core/moveEditing";
import type { MoveDraft } from "./editor/moveForm";

interface MovesTabProps {
  project: ProjectInfo | null;
  moves: MoveData[];
  selectedMoveId: number | null;
  moveSearch: string;
  onSelectMove(id: number): void;
  onSearchChange(value: string): void;
  onCreated(result: CreatedContent): Promise<void>;
  document: MoveEditDocument | null;
  draft: MoveDraft | null;
  dirty: boolean;
  busy: boolean;
  error: string | null;
  validationError: string | null;
  onDraftChange(draft: MoveDraft): void;
  onReload(): void;
}

export function MovesTab({
  project,
  moves,
  selectedMoveId,
  moveSearch,
  onSelectMove,
  onSearchChange,
  onCreated,
  document, draft, dirty, busy, error, validationError, onDraftChange, onReload,
}: MovesTabProps) {
  const [creating, setCreating] = useState(false);
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
      <div className="tab-heading-row"><div><h2>Moves</h2><p>Edit move names, stats, types and existing battle behaviors.</p></div>{project && <button type="button" disabled={busy || dirty} onClick={() => setCreating(true)}>New move</button>}</div>
      {creating && <ContentCreateDialog kind="move" templateId={selectedMoveId ?? undefined} onClose={() => setCreating(false)} onCreated={onCreated} />}

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
                  disabled={busy}
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
                {busy && !document && <p role="status">Reading move data…</p>}
                {error && <p role="alert" className="graphics-error">{error}</p>}
                {validationError && <p role="alert" className="graphics-error">{validationError}</p>}
                {document?.id === selectedMove.id && draft ? <fieldset disabled={busy} className="move-edit-fields">
                  <div className="field-grid two-column-fields">
                    <label className="editor-field"><span>Name</span><input aria-label="Move name" value={draft.name} maxLength={document.maxNameLength} onChange={event => onDraftChange({ ...draft, name: event.target.value.toUpperCase() })} /></label>
                    {(["power", "accuracy", "pp"] as const).map(field => <label className="editor-field" key={field}><span>{field === "pp" ? "PP" : field === "accuracy" ? "Accuracy (%)" : "Power"}</span><input aria-label={`Move ${field}`} type="number" min={field === "pp" ? 1 : 0} max={field === "power" ? 255 : field === "accuracy" ? 100 : 40} step={1} value={draft[field]} onChange={event => onDraftChange({ ...draft, [field]: event.target.value })} /></label>)}
                    <label className="editor-field"><span>Type</span><select aria-label="Move type" value={draft.moveType} onChange={event => onDraftChange({ ...draft, moveType: event.target.value })}>{document.options.types.map(type => <option key={type} value={type}>{type}</option>)}</select></label>
                    <label className="editor-field"><span>Battle behavior</span><select aria-label="Move battle behavior" value={draft.effect} onChange={event => onDraftChange({ ...draft, effect: event.target.value })}>{document.options.effects.map(effect => <option key={effect} value={effect}>{effect.replace(/_/g, " ")}</option>)}</select></label>
                  </div>
                  <p className="help-text">Power 0 is valid for status moves. Accuracy is the game's percentage setting. Battle behavior reuses an existing mechanic; special moves may also have rules tied to their move ID.</p>
                </fieldset> : <div className="field-grid two-column-fields">
                  <ReadonlyField label="Name" value={selectedMove.name} />
                  <ReadonlyField label="Power" value={selectedMove.power} />
                  <ReadonlyField label="Accuracy" value={`${selectedMove.accuracy}%`} />
                  <ReadonlyField label="PP" value={selectedMove.pp} />
                  <ReadonlyField label="Type" value={selectedMove.moveType} />
                  <ReadonlyField label="Effect" value={selectedMove.effect} />
                </div>}
                <button type="button" disabled={busy} onClick={() => { if (!dirty || window.confirm("Discard the unsaved move changes and reload source data?")) onReload(); }}>Reload move sources</button>

                <h4>Animation</h4>
                <button type="button" disabled={busy} onClick={() => requestGraphicsEditor({ moveId: selectedMove.id, returnTab: "moves" })}>Inspect move animation in Graphics</button>
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
