import type { HistorySummary } from "./core/types";
import type { EditorController } from "./editor/types";

interface EditorToolbarProps {
  editor: EditorController;
  history: HistorySummary | null;
  onUndo(): Promise<void>;
  onRedo(): Promise<void>;
}
export function EditorToolbar({
  editor,
  history,
  onUndo,
  onRedo,
}: EditorToolbarProps) {
  return (
    <section className="edit-toolbar" aria-label="Editing history controls">
      <div className="edit-actions">
        <button
          className="primary-action"
          disabled={editor.busy || !editor.dirty || !editor.valid}
          onClick={() => void editor.save()}
        >
          Save
        </button>
        <button
          disabled={editor.busy || editor.dirty || !history?.canUndo}
          onClick={() => void onUndo()}
          title={editor.dirty ? "Save or revert unsaved changes before undoing." : undefined}
        >
          Undo
        </button>
        <button
          disabled={editor.busy || editor.dirty || !history?.canRedo}
          onClick={() => void onRedo()}
          title={editor.dirty ? "Save or revert unsaved changes before redoing." : undefined}
        >
          Redo
        </button>
        <button
          disabled={editor.busy || !editor.dirty}
          onClick={() => void editor.revert()}
          title="Discard unsaved edits and reload the selected record from the project."
        >
          Revert
        </button>
      </div>
      <div className="history-status">
        {editor.dirty ? (
          <strong className="unsaved-indicator">Unsaved changes</strong>
        ) : history?.latestLabel ? (
          <span>Latest saved change: {history.latestLabel}</span>
        ) : (
          <span>No Yellow Editor saves yet.</span>
        )}
      </div>
    </section>
  );
}
