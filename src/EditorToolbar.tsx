import type { HistorySummary } from "./core/types";
import type { EditorController } from "./editor/types";

interface EditorToolbarProps {
  editor: EditorController;
  history: HistorySummary | null;
  onUndo(): Promise<void>;
  onRedo(): Promise<void>;
  onHistory(): void;
  onSaveAs(): Promise<void>;
  copyDisabled: boolean;
}
export function EditorToolbar({
  editor,
  history,
  onUndo,
  onRedo,
  onHistory,
  onSaveAs,
  copyDisabled,
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
        <button
          disabled={editor.busy}
          onClick={onHistory}
          title="View saved Yellow Editor changes and create a safe copy from an earlier point."
        >
          History…
        </button>
        <button
          disabled={editor.busy || copyDisabled}
          onClick={() => void onSaveAs()}
          title={copyDisabled
            ? "Save or revert unsaved editor changes before creating a project copy."
            : "Save the complete current project as an independent packed ZIP."}
        >
          Save As…
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
