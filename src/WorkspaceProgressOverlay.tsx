import { useEffect, useRef, useState } from "react";
import {
  PROJECT_WORKSPACE_PROGRESS_EVENT,
  type ProjectWorkspaceProgress,
} from "./platform/types";
import "./WorkspaceProgressOverlay.css";

export function WorkspaceProgressOverlay() {
  const [progress, setProgress] = useState<ProjectWorkspaceProgress | null>(null);
  const hideTimer = useRef<number | null>(null);

  useEffect(() => {
    const handleProgress = (event: Event) => {
      const next = (event as CustomEvent<ProjectWorkspaceProgress>).detail;
      if (!next) {
        return;
      }

      if (hideTimer.current !== null) {
        window.clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }

      setProgress(next);
      if (next.stage === "ready") {
        hideTimer.current = window.setTimeout(() => {
          setProgress(null);
          hideTimer.current = null;
        }, 2500);
      }
    };

    window.addEventListener(PROJECT_WORKSPACE_PROGRESS_EVENT, handleProgress);
    return () => {
      window.removeEventListener(PROJECT_WORKSPACE_PROGRESS_EVENT, handleProgress);
      if (hideTimer.current !== null) {
        window.clearTimeout(hideTimer.current);
      }
    };
  }, []);

  if (!progress) {
    return null;
  }

  const determinate = progress.total > 0 && progress.stage !== "enumerating";
  const working = progress.stage !== "ready" && progress.stage !== "error";

  return (
    <aside
      className={`workspace-progress-overlay workspace-progress-${progress.stage}`}
      aria-live="polite"
      aria-label="Browser workspace progress"
    >
      <div className="workspace-progress-title-row">
        <strong>Browser workspace</strong>
        {progress.stage === "error" && (
          <button
            type="button"
            className="workspace-progress-dismiss"
            onClick={() => setProgress(null)}
            aria-label="Dismiss workspace message"
          >
            ×
          </button>
        )}
      </div>

      <p>{progress.message}</p>
      <progress
        max="100"
        value={determinate ? Math.max(0, Math.min(100, progress.percent)) : undefined}
      />

      <div className="workspace-progress-meta">
        {progress.total > 0 ? (
          <span>{progress.completed} of {progress.total} files</span>
        ) : progress.completed > 0 ? (
          <span>{progress.completed} files found</span>
        ) : (
          <span>{working ? "Preparing…" : "Workspace status"}</span>
        )}
        {determinate && <span>{progress.percent}%</span>}
      </div>

      {working && (
        <small>You can keep using Yellow Editor while the workspace finishes in the background.</small>
      )}
    </aside>
  );
}
