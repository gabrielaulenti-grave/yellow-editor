import type { HistoryTimeline } from "./core/types";

interface HistoryPanelProps {
  timeline: HistoryTimeline;
  busy: boolean;
  currentCopyDisabled: boolean;
  onClose(): void;
  onSaveCopy(historyCursor?: number): Promise<void>;
  onSelectiveUndo(entryId: string): Promise<void>;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString();
}

export function HistoryPanel({
  timeline,
  busy,
  currentCopyDisabled,
  onClose,
  onSaveCopy,
  onSelectiveUndo,
}: HistoryPanelProps) {
  const entries = [...timeline.entries].reverse();

  return (
    <section className="history-panel editor-card" aria-label="Project history">
      <div className="history-panel-heading">
        <div>
          <h2>Project history</h2>
          <p>
            {timeline.cursor} of {timeline.entryCount} saved changes are currently applied.
            {" "}
            {timeline.persistent
              ? "This timeline is stored with Yellow Editor for this project."
              : "This browser session cannot persist history after the project is closed."}
          </p>
        </div>
        <button type="button" onClick={onClose}>Close</button>
      </div>

      <div className="history-safety-card">
        <div>
          <strong>Safe project copy</strong>
          <p>
            Save the current disassembly as an independent packed ZIP project.
            The open project is not changed.
          </p>
        </div>
        <button
          type="button"
          className="primary-action"
          disabled={busy || currentCopyDisabled}
          onClick={() => void onSaveCopy()}
          title={currentCopyDisabled
            ? "Save or revert unsaved editor changes before creating a current project copy."
            : "Save the complete current project as an independent packed ZIP."}
        >
          Save As…
        </button>
      </div>

      {entries.length === 0 ? (
        <p className="history-empty">No Yellow Editor saves have been recorded yet.</p>
      ) : (
        <ol className="history-list">
          {entries.map((entry) => {
            const isCurrent = entry.cursorAfter === timeline.cursor;
            return (
              <li
                key={entry.id}
                className={[
                  "history-entry",
                  entry.applied ? "applied" : "undone",
                  isCurrent ? "current" : "",
                ].filter(Boolean).join(" ")}
              >
                <div className="history-entry-main">
                  <div>
                    <div className="history-entry-title-row">
                      <strong>{entry.label}</strong>
                      <span className="history-entry-state">
                        {isCurrent
                          ? "Current state"
                          : entry.applied
                            ? "Applied"
                            : "Undone"}
                      </span>
                    </div>
                    <time dateTime={entry.timestamp}>
                      {formatTimestamp(entry.timestamp)}
                    </time>
                  </div>
                  <div className="history-entry-actions">
                    {entry.applied && (
                      <button
                        type="button"
                        disabled={busy || currentCopyDisabled || !entry.canSelectiveUndo}
                        onClick={() => void onSelectiveUndo(entry.id)}
                        title={currentCopyDisabled
                          ? "Save or revert unsaved editor changes before undoing an older saved change."
                          : entry.canSelectiveUndo
                            ? "Undo only this saved change while preserving unrelated later changes."
                            : entry.selectiveUndoReason ?? undefined}
                      >
                        Undo this change
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void onSaveCopy(entry.cursorAfter)}
                      title="Create an independent project copy at this exact history point."
                    >
                      Save copy from here…
                    </button>
                  </div>
                </div>

                <details>
                  <summary>
                    {entry.files.length} affected file{entry.files.length === 1 ? "" : "s"}
                  </summary>
                  <ul className="history-file-list">
                    {entry.files.map((path) => <li key={path}><code>{path}</code></li>)}
                  </ul>
                </details>

                {entry.applied && !entry.canSelectiveUndo && (
                  <div className="history-selective-undo-note">
                    <strong>Independent undo unavailable:</strong>{" "}
                    {entry.selectiveUndoReason}
                    {entry.selectiveUndoBlockedBy.length > 0 && (
                      <ul>
                        {entry.selectiveUndoBlockedBy.map((blocker) => (
                          <li key={blocker.entryId}>
                            {blocker.label}: <code>{blocker.files.join(", ")}</code>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            );
          })}
          <li className={`history-entry baseline ${timeline.cursor === 0 ? "current" : "applied"}`}>
            <div className="history-entry-main">
              <div>
                <div className="history-entry-title-row">
                  <strong>History baseline</strong>
                  <span className="history-entry-state">
                    {timeline.cursor === 0 ? "Current state" : "Baseline"}
                  </span>
                </div>
                <span className="history-baseline-help">
                  The project state immediately before the oldest retained Yellow Editor change.
                </span>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void onSaveCopy(0)}
                title="Create an independent project copy from before the oldest retained Yellow Editor save."
              >
                Save baseline copy…
              </button>
            </div>
          </li>
        </ol>
      )}
    </section>
  );
}
