import { useEffect, useState } from "react";
import type {
  BuildArtifact,
  BuildEnvironment,
  BuildProgressEvent,
  BuildResult,
  BuildTarget,
  BuildTaskProgress,
  BuildToolStatus,
} from "./core/types";
import { invoke } from "./platform/compat";
import "./BuildPanel.css";

function toolchainLabel(environment: BuildEnvironment): string {
  if (environment.backend === "web-wasm" && environment.toolchainSource === "bundled") {
    return "RGBDS / WASM";
  }

  switch (environment.toolchainSource) {
    case "bundled":
      return "Bundled RGBDS";
    case "system":
      return "System RGBDS";
    default:
      return environment.backend === "web-wasm"
        ? "RGBDS/WASM unavailable"
        : "RGBDS unavailable";
  }
}

function targetLabel(target: BuildTarget): string {
  switch (target) {
    case "yellow":
      return "Pokémon Yellow";
    case "red":
      return "Pokémon Red";
    case "blue":
      return "Pokémon Blue";
  }
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function resolveTaskPercent(task: BuildTaskProgress | undefined): number | null {
  if (!task) {
    return null;
  }
  if (task.percent !== undefined) {
    return Math.max(0, Math.min(100, task.percent));
  }
  if (
    task.completed !== undefined &&
    task.total !== undefined &&
    task.total > 0
  ) {
    return Math.max(0, Math.min(100, Math.round((task.completed / task.total) * 100)));
  }
  return null;
}

function taskCountLabel(task: BuildTaskProgress): string | null {
  if (task.completed === undefined || task.total === undefined) {
    return null;
  }
  const unit = task.unit ? ` ${task.unit}` : "";
  return `${task.completed} of ${task.total}${unit}`;
}

function ToolRows({ tools }: { tools: BuildToolStatus[] }) {
  return (
    <>
      {tools.map((tool) => (
        <div key={`${tool.name}-${tool.path ?? "missing"}`}>
          <strong>{tool.name}</strong>
          <span>{tool.available ? "Available" : "Missing"}</span>
          {tool.version && <code>{tool.version}</code>}
          {tool.path && <code>{tool.path}</code>}
        </div>
      ))}
    </>
  );
}

function downloadArtifact(artifact: BuildArtifact) {
  const blob = new Blob([new Uint8Array(artifact.bytes)], {
    type: artifact.mimeType,
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = artifact.fileName;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildDiagnosticReport(
  environment: BuildEnvironment | null,
  target: BuildTarget | null,
  startedAt: number | null,
  now: number,
  events: BuildProgressEvent[],
  result: BuildResult | null,
  error: string | null,
): string {
  const lines = [
    "Yellow Editor build report",
    `Target: ${target ?? "not selected"}`,
    `Backend: ${environment?.backend ?? "unknown"}`,
    `Toolchain: ${environment ? toolchainLabel(environment) : "unknown"}`,
    `Requested RGBDS: ${environment?.requiredRgbdsVersion ?? "not specified"}`,
    `Detected RGBDS: ${environment?.detectedRgbdsVersion ?? "not detected"}`,
    `Elapsed: ${startedAt ? formatDuration((result?.durationMs ?? now - startedAt)) : "not started"}`,
    `Result: ${result ? (result.success ? "success" : "failure") : error ? "error" : "in progress"}`,
  ];

  if (result?.exitCode !== null && result?.exitCode !== undefined) {
    lines.push(`Exit code: ${result.exitCode}`);
  }
  if (error) {
    lines.push("", "UI error:", error);
  }

  lines.push("", "Activity:");
  if (events.length === 0) {
    lines.push("(no progress events received)");
  } else {
    for (const event of events) {
      const offset = startedAt ? `+${formatDuration(event.timestamp - startedAt)}` : new Date(event.timestamp).toISOString();
      lines.push(
        `[${offset}] ${event.percent}% ${event.level.toUpperCase()} ${event.stage}: ${event.message}`,
      );
      if (event.detail) {
        lines.push(`  ${event.detail}`);
      }
      if (event.task) {
        const taskPercent = resolveTaskPercent(event.task);
        const count = taskCountLabel(event.task);
        lines.push(
          `  Current task: ${event.task.label}${taskPercent !== null ? ` (${taskPercent}%)` : ""}${count ? ` — ${count}` : ""}`,
        );
      }
    }
  }

  if (result?.stdout) {
    lines.push("", "stdout:", result.stdout);
  }
  if (result?.stderr) {
    lines.push("", "stderr:", result.stderr);
  }

  return lines.join("\n");
}

export function BuildPanel({
  projectPath,
  hasUnsavedChanges,
}: {
  projectPath: string;
  hasUnsavedChanges: boolean;
}) {
  const [environment, setEnvironment] = useState<BuildEnvironment | null>(null);
  const [target, setTarget] = useState<BuildTarget | null>(null);
  const [result, setResult] = useState<BuildResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloadMap, setDownloadMap] = useState(false);
  const [downloadSym, setDownloadSym] = useState(false);
  const [progress, setProgress] = useState<BuildProgressEvent | null>(null);
  const [progressEvents, setProgressEvents] = useState<BuildProgressEvent[]>([]);
  const [buildStartedAt, setBuildStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function inspect() {
      setEnvironment(null);
      setTarget(null);
      setResult(null);
      setError(null);
      setDownloadMap(false);
      setDownloadSym(false);
      setProgress(null);
      setProgressEvents([]);
      setBuildStartedAt(null);
      setCopyStatus(null);

      try {
        const next = await invoke<BuildEnvironment>("get_build_environment", {
          projectPath,
        });
        if (!cancelled) {
          setEnvironment(next);
          setTarget(next.targets[0] ?? null);
        }
      } catch (inspectionError) {
        if (!cancelled) {
          setError(String(inspectionError));
        }
      }
    }

    void inspect();
    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  useEffect(() => {
    if (!busy) {
      return;
    }
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);

  async function refreshEnvironment() {
    try {
      const next = await invoke<BuildEnvironment>("get_build_environment", {
        projectPath,
      });
      setEnvironment(next);
      if (!target || !next.targets.includes(target)) {
        setTarget(next.targets[0] ?? null);
      }
      setError(null);
    } catch (inspectionError) {
      setError(String(inspectionError));
    }
  }

  async function build() {
    if (!environment?.ready || !target || hasUnsavedChanges || busy) {
      return;
    }

    const startedAt = Date.now();
    let latestPercent = 0;
    setBusy(true);
    setBuildStartedAt(startedAt);
    setNow(startedAt);
    setError(null);
    setResult(null);
    setProgress(null);
    setProgressEvents([]);
    setCopyStatus(null);

    const onProgress = (event: BuildProgressEvent) => {
      latestPercent = event.percent;
      setProgress(event);
      setProgressEvents((current) => [...current.slice(-249), event]);
    };

    try {
      const next = await invoke<BuildResult>("build_rom", {
        target,
        onProgress,
      });
      setResult(next);
      await refreshEnvironment();
    } catch (buildError) {
      const message = buildError instanceof Error ? buildError.message : String(buildError);
      setError(message);
      onProgress({
        stage: "error",
        level: "error",
        message: "Build request failed",
        detail: message,
        task: {
          label: "Build request",
          completed: 1,
          total: 1,
          percent: 100,
        },
        percent: latestPercent,
        timestamp: Date.now(),
      });
    } finally {
      setBusy(false);
      setNow(Date.now());
    }
  }

  function downloadBuildOutputs() {
    const artifacts = result?.artifacts ?? [];
    const rom = artifacts.find((candidate) => candidate.kind === "rom");
    if (!rom) {
      return;
    }

    downloadArtifact(rom);
    if (downloadMap) {
      const map = artifacts.find((candidate) => candidate.kind === "map");
      if (map) {
        downloadArtifact(map);
      }
    }
    if (downloadSym) {
      const sym = artifacts.find((candidate) => candidate.kind === "sym");
      if (sym) {
        downloadArtifact(sym);
      }
    }
  }

  async function copyBuildReport() {
    const report = buildDiagnosticReport(
      environment,
      target,
      buildStartedAt,
      now,
      progressEvents,
      result,
      error,
    );
    try {
      await navigator.clipboard.writeText(report);
      setCopyStatus("Copied build report.");
    } catch (copyError) {
      setCopyStatus(`Could not copy report: ${String(copyError)}`);
    }
  }

  const browserArtifacts = result?.artifacts ?? [];
  const hasBrowserRom = browserArtifacts.some((candidate) => candidate.kind === "rom");
  const hasMap = browserArtifacts.some((candidate) => candidate.kind === "map");
  const hasSym = browserArtifacts.some((candidate) => candidate.kind === "sym");
  const elapsedMs = buildStartedAt
    ? result?.durationMs ?? Math.max(0, now - buildStartedAt)
    : 0;
  const secondsSinceProgress = busy && progress
    ? Math.max(0, Math.floor((now - progress.timestamp) / 1000))
    : 0;
  const longRunningStep = busy && secondsSinceProgress >= 45;
  const currentTaskPercent = resolveTaskPercent(progress?.task);
  const currentTaskCount = progress?.task ? taskCountLabel(progress.task) : null;

  return (
    <section className="build-panel" aria-label="ROM build tools">
      <div className="build-panel-heading">
        <div>
          <h2>Build ROM</h2>
          <p>
            Yellow Editor supports the normal Pokémon Yellow and Pokémon Red/Blue
            build layouts. Desktop uses native RGBDS; the web version runs RGBDS and
            the pret helper utilities as WebAssembly.
          </p>
        </div>

        <div className="build-actions">
          {environment && environment.targets.length > 1 && (
            <select
              value={target ?? ""}
              disabled={busy}
              onChange={(event) => setTarget(event.target.value as BuildTarget)}
              aria-label="Build target"
            >
              {environment.targets.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {targetLabel(candidate)}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            className="primary-action"
            disabled={
              busy ||
              hasUnsavedChanges ||
              !environment?.ready ||
              !target
            }
            title={
              hasUnsavedChanges
                ? "Save or revert unsaved edits before building."
                : undefined
            }
            onClick={() => void build()}
          >
            {busy ? "Building…" : "Build ROM"}
          </button>
        </div>
      </div>

      {error && (
        <div className="build-error" role="alert">
          <strong>Build error</strong>
          <pre>{error}</pre>
        </div>
      )}

      {!environment && !error ? (
        <p className="build-muted">Inspecting build environment…</p>
      ) : environment ? (
        <>
          <div className="build-summary-grid">
            <div>
              <span>Backend</span>
              <strong>
                {environment.backend === "desktop-native"
                  ? "Desktop native"
                  : "Web / WASM"}
              </strong>
            </div>
            <div>
              <span>Toolchain</span>
              <strong>{toolchainLabel(environment)}</strong>
            </div>
            <div>
              <span>Requested RGBDS</span>
              <strong>{environment.requiredRgbdsVersion ?? "Not specified"}</strong>
            </div>
            <div>
              <span>Detected RGBDS</span>
              <strong>{environment.detectedRgbdsVersion ?? "Not detected"}</strong>
            </div>
          </div>

          <p className="build-message">{environment.message}</p>

          {environment.versionMatches === false && (
            <p className="build-warning">
              The detected RGBDS version does not match the checkout's requested version.
              Yellow Editor will not enable the browser build with a mismatched compiler.
            </p>
          )}

          {hasUnsavedChanges && (
            <p className="build-warning">Save or revert the current edits before building.</p>
          )}

          <details className="build-tool-details">
            <summary>Tool details</summary>
            <div className="build-tool-list">
              <ToolRows
                tools={[...environment.tools, environment.buildTool].concat(
                  environment.helperCompiler ? [environment.helperCompiler] : [],
                )}
              />
            </div>

            {environment.helperTools.length > 0 && (
              <>
                <h4>Pret helper tools</h4>
                <div className="build-tool-list">
                  <ToolRows tools={environment.helperTools} />
                </div>
              </>
            )}
          </details>
        </>
      ) : null}

      {(busy || progress) && (
        <div className={`build-live-status ${progress?.level === "error" ? "failure" : ""}`}>
          <div className="build-live-heading">
            <strong>{progress?.message ?? "Starting build…"}</strong>
            <span>{progress?.percent ?? 0}% · {formatDuration(elapsedMs)}</span>
          </div>
          <div
            className="build-progress-track"
            role="progressbar"
            aria-label="Overall ROM build progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress?.percent ?? 0}
          >
            <div
              className="build-progress-fill"
              style={{ width: `${Math.max(0, Math.min(100, progress?.percent ?? 0))}%` }}
            />
          </div>

          {progress?.task && (
            <div className="build-task-status">
              <div className="build-task-heading">
                <span>Current task</span>
                <strong>{progress.task.label}</strong>
                <span>{currentTaskPercent !== null ? `${currentTaskPercent}%` : "Working…"}</span>
              </div>
              <div
                className={`build-progress-track build-task-progress-track ${currentTaskPercent === null ? "indeterminate" : ""}`}
                role="progressbar"
                aria-label={`Current task: ${progress.task.label}`}
                aria-valuemin={0}
                aria-valuemax={100}
                {...(currentTaskPercent !== null ? { "aria-valuenow": currentTaskPercent } : {})}
              >
                <div
                  className="build-progress-fill build-task-progress-fill"
                  style={currentTaskPercent !== null ? { width: `${currentTaskPercent}%` } : undefined}
                />
              </div>
              {currentTaskCount && <p className="build-task-count">{currentTaskCount}</p>}
            </div>
          )}

          {progress?.detail && <code className="build-current-detail">{progress.detail}</code>}
          {progress?.completed !== undefined && progress.total !== undefined && (
            <p className="build-muted">
              {progress.completed} of {progress.total} object groups complete
            </p>
          )}
          {longRunningStep && (
            <p className="build-warning" role="status">
              This task has not produced a new status update for {secondsSinceProgress}s.
              A WebAssembly tool or browser file read may still be working on the task shown above;
              if the elapsed time keeps growing, copy the build report below so the exact task is recorded.
            </p>
          )}
        </div>
      )}

      {(busy || progressEvents.length > 0 || result || error) && (
        <details className="build-activity" open={busy || Boolean(error) || result?.success === false}>
          <summary>
            Build activity report ({progressEvents.length} events)
          </summary>
          <div className="build-report-actions">
            <button type="button" onClick={() => void copyBuildReport()}>
              Copy build report
            </button>
            {copyStatus && <span>{copyStatus}</span>}
          </div>
          {progressEvents.length === 0 ? (
            <p className="build-muted">No build activity has been reported yet.</p>
          ) : (
            <ol className="build-activity-list">
              {progressEvents.map((event, index) => {
                const eventTaskPercent = resolveTaskPercent(event.task);
                const eventTaskCount = event.task ? taskCountLabel(event.task) : null;
                return (
                  <li key={`${event.timestamp}-${index}`} className={`level-${event.level}`}>
                    <div>
                      <time>
                        {buildStartedAt
                          ? `+${formatDuration(event.timestamp - buildStartedAt)}`
                          : new Date(event.timestamp).toLocaleTimeString()}
                      </time>
                      <strong>{event.message}</strong>
                      <span>{event.percent}%</span>
                    </div>
                    {event.detail && <code>{event.detail}</code>}
                    {event.task && (
                      <small className="build-event-task">
                        Current task: {event.task.label}
                        {eventTaskPercent !== null ? ` · ${eventTaskPercent}%` : ""}
                        {eventTaskCount ? ` · ${eventTaskCount}` : ""}
                      </small>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </details>
      )}

      {result && (
        <div className={`build-result ${result.success ? "success" : "failure"}`} role={!result.success ? "alert" : undefined}>
          <div className="build-result-heading">
            <strong>{result.success ? "Build succeeded" : "Build failed"}</strong>
            <span>
              {formatDuration(result.durationMs)}
              {result.exitCode !== null ? ` · exit ${result.exitCode}` : ""}
            </span>
          </div>
          {result.romPath && <code className="build-rom-path">{result.romPath}</code>}

          {result.success && hasBrowserRom && (
            <div className="build-downloads">
              <div className="build-download-options">
                {hasMap && (
                  <label>
                    <input
                      type="checkbox"
                      checked={downloadMap}
                      onChange={(event) => setDownloadMap(event.target.checked)}
                    />
                    Also download map (.map)
                  </label>
                )}
                {hasSym && (
                  <label>
                    <input
                      type="checkbox"
                      checked={downloadSym}
                      onChange={(event) => setDownloadSym(event.target.checked)}
                    />
                    Also download symbols (.sym)
                  </label>
                )}
              </div>
              <button type="button" className="primary-action" onClick={downloadBuildOutputs}>
                Download ROM
              </button>
            </div>
          )}

          <details open={!result.success}>
            <summary>Compiler output</summary>
            {result.stdout && <pre>{result.stdout}</pre>}
            {result.stderr && <pre>{result.stderr}</pre>}
            {!result.stdout && !result.stderr && <p>No build output was produced.</p>}
          </details>
        </div>
      )}
    </section>
  );
}
