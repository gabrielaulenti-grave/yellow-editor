import { useEffect, useState } from "react";
import type {
  BuildArtifact,
  BuildEnvironment,
  BuildResult,
  BuildTarget,
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

  useEffect(() => {
    let cancelled = false;

    async function inspect() {
      setEnvironment(null);
      setTarget(null);
      setResult(null);
      setError(null);
      setDownloadMap(false);
      setDownloadSym(false);

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

    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const next = await invoke<BuildResult>("build_rom", { target });
      setResult(next);
      await refreshEnvironment();
    } catch (buildError) {
      setError(String(buildError));
    } finally {
      setBusy(false);
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

  const browserArtifacts = result?.artifacts ?? [];
  const hasBrowserRom = browserArtifacts.some((candidate) => candidate.kind === "rom");
  const hasMap = browserArtifacts.some((candidate) => candidate.kind === "map");
  const hasSym = browserArtifacts.some((candidate) => candidate.kind === "sym");

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

      {error && <p className="build-error">{error}</p>}

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

      {result && (
        <div className={`build-result ${result.success ? "success" : "failure"}`}>
          <div className="build-result-heading">
            <strong>{result.success ? "Build succeeded" : "Build failed"}</strong>
            <span>{result.durationMs} ms</span>
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
            <summary>Build output</summary>
            {result.stdout && <pre>{result.stdout}</pre>}
            {result.stderr && <pre>{result.stderr}</pre>}
            {!result.stdout && !result.stderr && <p>No build output was produced.</p>}
          </details>
        </div>
      )}
    </section>
  );
}
