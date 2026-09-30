import { useEffect, useMemo, useState } from "react";
import type {
  ProjectInfo,
  ScriptCatalog,
  ScriptCatalogEntry,
  ScriptDocument,
  ScriptRoutineSummary,
} from "./core/types";
import {
  MapScriptPreview,
  type MapScriptPreviewReference,
} from "./MapScriptPreview";
import { invoke } from "./platform/compat";
import "./ScriptsTab.css";

export interface ScriptFocus {
  path: string;
  routineLabel?: string | null;
  previewReference?: MapScriptPreviewReference | null;
}

interface ScriptsTabProps {
  project: ProjectInfo | null;
  focus: ScriptFocus | null;
}

function routineKey(routine: ScriptRoutineSummary): string {
  return `${routine.path}:${routine.label}:${routine.startLine}`;
}

function labelTitle(value: string): string {
  return value
    .replace(/Script$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^\./, "")
    .replace(/\s+/g, " ")
    .trim();
}

function routinesForPath(entry: ScriptCatalogEntry | null, path: string | null) {
  if (!entry || !path) return [];
  return entry.routines.filter((routine) => routine.path === path);
}

function preferredRoutine(routines: ScriptRoutineSummary[]): ScriptRoutineSummary | null {
  return routines.find((routine) => routine.kind === "state")
    ?? routines.find((routine) => routine.kind === "routine")
    ?? routines[0]
    ?? null;
}

export function ScriptsTab({ project, focus }: ScriptsTabProps) {
  const [catalog, setCatalog] = useState<ScriptCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedRoutineLabel, setSelectedRoutineLabel] = useState<string | null>(null);
  const [document, setDocument] = useState<ScriptDocument | null>(null);
  const [documentLoading, setDocumentLoading] = useState(false);
  const [documentError, setDocumentError] = useState<string | null>(null);

  useEffect(() => {
    if (!project) {
      setCatalog(null);
      setSelectedGroupId(null);
      setSelectedPath(null);
      setSelectedRoutineLabel(null);
      setDocument(null);
      setCatalogError(null);
      return;
    }

    let cancelled = false;
    setCatalogLoading(true);
    setCatalogError(null);
    void invoke<ScriptCatalog>("get_script_catalog")
      .then((nextCatalog) => {
        if (cancelled) return;
        setCatalog(nextCatalog);
        if (nextCatalog.entries.length === 0) {
          setSelectedGroupId(null);
          setSelectedPath(null);
          setSelectedRoutineLabel(null);
          return;
        }

        const focusedEntry = focus
          ? nextCatalog.entries.find((entry) => entry.paths.includes(focus.path))
          : null;
        const entry = focusedEntry ?? nextCatalog.entries[0];
        const path = focusedEntry && focus ? focus.path : entry.paths[0];
        const pathRoutines = routinesForPath(entry, path);
        setSelectedGroupId(entry.id);
        setSelectedPath(path);
        setSelectedRoutineLabel(
          focusedEntry && focus?.routineLabel
            ? focus.routineLabel
            : preferredRoutine(pathRoutines)?.label ?? null,
        );
      })
      .catch((error) => {
        if (!cancelled) setCatalogError(String(error));
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [project?.storageKey]);

  useEffect(() => {
    if (!catalog || !focus) return;
    const entry = catalog.entries.find((candidate) => candidate.paths.includes(focus.path));
    if (!entry) return;
    setSelectedGroupId(entry.id);
    setSelectedPath(focus.path);
    setSelectedRoutineLabel(focus.routineLabel ?? null);
  }, [catalog, focus]);

  useEffect(() => {
    if (!project || !selectedPath) {
      setDocument(null);
      setDocumentError(null);
      return;
    }

    let cancelled = false;
    setDocumentLoading(true);
    setDocumentError(null);
    void invoke<ScriptDocument>("get_script_document", { path: selectedPath })
      .then((nextDocument) => {
        if (cancelled) return;
        setDocument(nextDocument);
        setSelectedRoutineLabel((current) =>
          current && nextDocument.routines.some((routine) => routine.label === current)
            ? current
            : nextDocument.routines[0]?.label ?? null,
        );
      })
      .catch((error) => {
        if (!cancelled) {
          setDocument(null);
          setDocumentError(String(error));
        }
      })
      .finally(() => {
        if (!cancelled) setDocumentLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [project?.storageKey, selectedPath]);

  const filteredEntries = useMemo(() => {
    if (!catalog) return [];
    const query = search.trim().toLowerCase();
    if (!query) return catalog.entries;
    return catalog.entries.filter((entry) => [
      entry.displayName,
      entry.id,
      ...entry.paths,
      ...entry.routines.map((routine) => routine.label),
    ].some((value) => value.toLowerCase().includes(query)));
  }, [catalog, search]);

  const selectedEntry =
    catalog?.entries.find((entry) => entry.id === selectedGroupId) ?? null;
  const selectedPathRoutines = routinesForPath(selectedEntry, selectedPath);
  const scriptRoutines = selectedPathRoutines.filter((routine) => routine.kind !== "source-label");
  const sourceLabels = selectedPathRoutines.filter((routine) => routine.kind === "source-label");
  const selectedRoutine =
    document?.routines.find((routine) => routine.label === selectedRoutineLabel) ?? null;

  const previewReference = useMemo<MapScriptPreviewReference | null>(() => {
    if (!document || !selectedRoutineLabel) return null;
    const focused = focus?.previewReference;
    if (
      focused
      && focused.scriptPath === document.path
      && focused.routineLabel === selectedRoutineLabel
    ) {
      return focused;
    }
    return {
      scriptPath: document.path,
      routineLabel: selectedRoutineLabel,
      mapScriptSource: document.source,
    };
  }, [document, focus, selectedRoutineLabel]);

  function selectEntry(entry: ScriptCatalogEntry) {
    const path = entry.paths[0] ?? null;
    const routines = routinesForPath(entry, path);
    setSelectedGroupId(entry.id);
    setSelectedPath(path);
    setSelectedRoutineLabel(preferredRoutine(routines)?.label ?? null);
  }

  function selectPath(path: string) {
    const routines = routinesForPath(selectedEntry, path);
    setSelectedPath(path);
    setSelectedRoutineLabel(preferredRoutine(routines)?.label ?? null);
  }

  if (!project) {
    return (
      <section className="editor-card">
        <h2>Scripts</h2>
        <p className="empty-state">
          Open a Pokémon Red, Blue, or Yellow disassembly to inspect its map scripts.
        </p>
      </section>
    );
  }

  return (
    <section className="editor-card">
      <div className="tab-heading-row">
        <div>
          <h2>Scripts</h2>
          <p>
            One workspace for map events, trainer-trigger scripts, dialogue flow,
            movement, battles, event flags, and the source that connects them.
          </p>
        </div>
        <span className="read-only-badge">Script workspace foundation</span>
      </div>

      <div className="script-browser">
        <aside className="script-browser-sidebar">
          <input
            className="full-width-input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search maps, files, or routines…"
          />
          <p className="browser-count">
            {catalogLoading
              ? "Indexing scripts…"
              : catalog
                ? `${catalog.fileCount} files · ${catalog.routineCount} script entry points`
                : "Scripts unavailable"}
          </p>

          {catalogError && (
            <div className="world-map-warning">
              <strong>Script index unavailable</strong>
              <p>{catalogError}</p>
            </div>
          )}

          <div className="script-group-list">
            {filteredEntries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={entry.id === selectedGroupId ? "active" : ""}
                onClick={() => selectEntry(entry)}
              >
                <strong>{entry.displayName}</strong>
                <small>
                  {entry.paths.length} file{entry.paths.length === 1 ? "" : "s"}
                  {" · "}
                  {entry.routines.filter((routine) => routine.kind !== "source-label").length} script entry point
                  {entry.routines.filter((routine) => routine.kind !== "source-label").length === 1 ? "" : "s"}
                </small>
              </button>
            ))}
          </div>
        </aside>

        <div className="script-browser-details">
          {selectedEntry ? (
            <>
              <div className="script-workspace-heading">
                <div>
                  <h3>{selectedEntry.displayName}</h3>
                  <p className="help-text">
                    Companion files such as <code>_2.asm</code> stay grouped with
                    the same map while preserving their exact source paths.
                  </p>
                </div>
              </div>

              <div className="script-source-tabs" aria-label="Script source files">
                {selectedEntry.paths.map((path) => (
                  <button
                    key={path}
                    type="button"
                    className={path === selectedPath ? "active" : ""}
                    onClick={() => selectPath(path)}
                  >
                    {path.split("/").pop()}
                  </button>
                ))}
              </div>

              <div className="script-workspace-grid">
                <aside className="script-routine-list">
                  <strong>Script entry points</strong>
                  {scriptRoutines.length === 0 ? (
                    <p className="empty-state">
                      No script states or recognized routines were detected in this file.
                    </p>
                  ) : (
                    scriptRoutines.map((routine) => (
                      <button
                        key={routineKey(routine)}
                        type="button"
                        className={routine.label === selectedRoutineLabel ? "active" : ""}
                        onClick={() => setSelectedRoutineLabel(routine.label)}
                      >
                        <span>{labelTitle(routine.label)}</span>
                        <code>{routine.label}</code>
                        <small>
                          {routine.kind === "state" ? "script state" : "routine"}
                          {" · line "}
                          {routine.startLine}
                          {" · "}
                          {routine.recognizedOperationCount} recognized operation
                          {routine.recognizedOperationCount === 1 ? "" : "s"}
                        </small>
                      </button>
                    ))
                  )}

                  {sourceLabels.length > 0 && (
                    <details className="script-other-labels">
                      <summary>
                        Other source labels ({sourceLabels.length})
                      </summary>
                      <p className="help-text">
                        Text, movement, tables, and unclassified assembly labels stay available
                        for inspection without crowding the main script list.
                      </p>
                      <div>
                        {sourceLabels.map((routine) => (
                          <button
                            key={routineKey(routine)}
                            type="button"
                            className={routine.label === selectedRoutineLabel ? "active" : ""}
                            onClick={() => setSelectedRoutineLabel(routine.label)}
                          >
                            <span>{labelTitle(routine.label)}</span>
                            <code>{routine.label}</code>
                            <small>source label · line {routine.startLine}</small>
                          </button>
                        ))}
                      </div>
                    </details>
                  )}
                </aside>

                <div className="script-routine-details">
                  {documentLoading && (
                    <div className="world-map-loading" aria-live="polite">
                      <strong>Reading script source…</strong>
                    </div>
                  )}

                  {documentError && !documentLoading && (
                    <div className="world-map-warning">
                      <strong>Script unavailable</strong>
                      <p>{documentError}</p>
                    </div>
                  )}

                  {document && !documentLoading && selectedRoutine && previewReference && (
                    <>
                      <div className="script-routine-heading">
                        <div>
                          <h4>{labelTitle(selectedRoutine.label)}</h4>
                          <code>{document.path}:{selectedRoutine.startLine}</code>
                        </div>
                        <span>
                          {selectedRoutine.operationKinds.length > 0
                            ? selectedRoutine.operationKinds.join(" · ")
                            : "assembly"}
                        </span>
                      </div>

                      <MapScriptPreview reference={previewReference} />

                      <details className="trainer-full-script script-source-detail">
                        <summary>Advanced: view complete source file</summary>
                        <pre className="trainer-script-source">
                          <code>{document.source}</code>
                        </pre>
                      </details>
                    </>
                  )}

                  {document && !documentLoading && !selectedRoutine && (
                    <>
                      <p className="empty-state">
                        Choose a routine to inspect its event flow. The complete source remains available below.
                      </p>
                      <details className="trainer-full-script script-source-detail" open>
                        <summary>View complete source file</summary>
                        <pre className="trainer-script-source">
                          <code>{document.source}</code>
                        </pre>
                      </details>
                    </>
                  )}
                </div>
              </div>
            </>
          ) : !catalogLoading && (
            <p className="empty-state">No script files were found in this project.</p>
          )}
        </div>
      </div>
    </section>
  );
}
