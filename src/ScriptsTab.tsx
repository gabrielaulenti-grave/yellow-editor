import { useEffect, useMemo, useState } from "react";
import type {
  MacroCatalog,
  MacroDefinitionSummary,
  HistorySummary,
  ProjectInfo,
  ProjectSemanticDomain,
  ScriptCatalog,
  ScriptCatalogEntry,
  ScriptDocument,
  ScriptMacroCall,
  ScriptMacroCallDocument,
  ScriptMacroEditDocument,
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
  onDirtyChange?(dirty: boolean): void;
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

function macroKindLabel(value: string): string {
  return value === "unknown"
    ? "unresolved"
    : value.replace(/-/g, " ");
}

function MacroCallForm({
  call,
  definition,
  domains,
  editBlocked,
  onEditStateChange,
  onSaved,
}: {
  call: ScriptMacroCall;
  definition: MacroDefinitionSummary | null;
  domains: ProjectSemanticDomain[];
  editBlocked: boolean;
  onEditStateChange(open: boolean, dirty: boolean): void;
  onSaved(): void;
}) {
  const [editDocument, setEditDocument] = useState<ScriptMacroEditDocument | null>(null);
  const [draftArguments, setDraftArguments] = useState<string[]>([]);
  const [editLoading, setEditLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setEditDocument(null);
    setDraftArguments([]);
    setEditError(null);
    setNotice(null);
  }, [call.path, call.line, call.name]);

  const parameters = definition?.parameters.length
    ? definition.parameters
    : call.arguments.map((argument) => ({
        index: argument.index,
        displayName: `Argument ${argument.index}`,
        required: true,
        inferredKind: argument.inferredKind,
        confidence: argument.confidence,
        examples: [argument.raw],
        evidence: [],
        semanticDomains: argument.semanticDomains,
      }));

  const hasSemanticCandidate = parameters.some(
    (parameter) => parameter.semanticDomains.length > 0,
  ) || call.arguments.some((argument) => argument.semanticDomains.length > 0);

  async function beginEdit() {
    onEditStateChange(true, false);
    setEditLoading(true);
    setEditError(null);
    setNotice(null);
    try {
      const nextDocument = await invoke<ScriptMacroEditDocument>(
        "get_script_macro_edit_document",
        { path: call.path, line: call.line },
      );
      if (nextDocument.editableArgumentDomains.length === 0) {
        throw new Error(
          "No parameter in this invocation currently has a semantic domain that Yellow Editor can rewrite safely.",
        );
      }
      setEditDocument(nextDocument);
      setDraftArguments([...nextDocument.arguments]);
    } catch (error) {
      onEditStateChange(false, false);
      setEditError(String(error));
    } finally {
      setEditLoading(false);
    }
  }

  async function saveEdit() {
    if (!editDocument) return;
    setSaving(true);
    setEditError(null);
    setNotice(null);
    try {
      const history = await invoke<HistorySummary>("save_script_macro_call", {
        path: editDocument.path,
        line: editDocument.line,
        macroName: editDocument.macroName,
        expectedHash: editDocument.sourceHash,
        arguments: draftArguments,
      });
      window.dispatchEvent(new CustomEvent("yellow-editor:history-changed", {
        detail: history,
      }));
      setEditDocument(null);
      setDraftArguments([]);
      onEditStateChange(false, false);
      setNotice("Saved to project history.");
      onSaved();
    } catch (error) {
      setEditError(String(error));
    } finally {
      setSaving(false);
    }
  }

  const dirty = editDocument
    ? draftArguments.some((value, index) => value !== editDocument.arguments[index])
    : false;

  return (
    <article className="script-macro-call-card">
      <div className="script-macro-call-heading">
        <div>
          <strong>{call.name}</strong>
          <code>{call.path}:{call.line}</code>
        </div>
        <small>
          defined at {call.definitionPath}:{call.definitionLine}
        </small>
      </div>

      {parameters.length === 0 ? (
        <p className="help-text">This project macro takes no observed positional arguments.</p>
      ) : (
        <div className="script-macro-parameter-grid">
          {parameters.map((parameter) => {
            const argument = call.arguments.find((candidate) => candidate.index === parameter.index);
            const inferredKind = parameter.inferredKind !== "unknown"
              ? parameter.inferredKind
              : argument?.inferredKind ?? "unknown";
            const confidence = parameter.inferredKind !== "unknown"
              ? parameter.confidence
              : argument?.confidence ?? "low";
            const parameterSemanticMatches = parameter.semanticDomains;
            const argumentSemanticMatches = argument?.semanticDomains ?? [];
            const exactParameterMatch = argumentSemanticMatches.find((argumentMatch) =>
              parameterSemanticMatches.some(
                (parameterMatch) => parameterMatch.domainId === argumentMatch.domainId,
              ));
            const defaultPrimaryMatch = exactParameterMatch
              ?? parameterSemanticMatches[0]
              ?? argumentSemanticMatches[0]
              ?? null;
            const semanticMatches = [
              ...(defaultPrimaryMatch ? [defaultPrimaryMatch] : []),
              ...parameterSemanticMatches,
              ...argumentSemanticMatches,
            ].filter(
              (match, index, matches) =>
                matches.findIndex((candidate) => candidate.domainId === match.domainId) === index,
            );
            const editableEntry = editDocument?.editableArgumentDomains.find(
              (entry) => entry.index === parameter.index,
            ) ?? null;
            const editableMatch = editableEntry
              ? semanticMatches.find((match) => editableEntry.domainIds.includes(match.domainId)) ?? null
              : null;
            const primarySemanticMatch = editableMatch ?? defaultPrimaryMatch;
            const semanticDomain = primarySemanticMatch
              ? domains.find((candidate) => candidate.id === primarySemanticMatch.domainId) ?? null
              : null;
            const rawValue = editDocument
              ? draftArguments[parameter.index - 1] ?? ""
              : argument?.raw ?? "";
            const optionExists = semanticDomain?.options.some((option) => option.value === rawValue) ?? false;
            const editable = Boolean(
              editDocument
              && editableEntry
              && semanticDomain
              && editableEntry.domainIds.includes(semanticDomain.id),
            );

            return (
              <label key={parameter.index} className="script-macro-parameter">
                <span>
                  <strong>{parameter.displayName}</strong>
                  <small>
                    {primarySemanticMatch
                      ? `${primarySemanticMatch.domainLabel} · ${primarySemanticMatch.confidence} semantic confidence`
                      : `${macroKindLabel(inferredKind)} · ${confidence} confidence`}
                    {" · "}
                    {parameter.required ? "required" : "optional/conditional"}
                  </small>
                </span>
                {semanticDomain ? (
                  <select
                    value={rawValue}
                    disabled={!editable || saving}
                    onChange={(event) => {
                      if (!editable) return;
                      const next = [...draftArguments];
                      next[parameter.index - 1] = event.target.value;
                      setDraftArguments(next);
                      onEditStateChange(
                        true,
                        next.some(
                          (value, index) => value !== editDocument?.arguments[index],
                        ),
                      );
                    }}
                    aria-label={`${call.name} ${parameter.displayName}`}
                  >
                    {!optionExists && rawValue && (
                      <option value={rawValue}>{rawValue}</option>
                    )}
                    {!rawValue && (
                      <option value="">{parameter.required ? "Not supplied" : "Optional"}</option>
                    )}
                    {semanticDomain.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label === option.value
                          ? option.value
                          : `${option.label} — ${option.value}`}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={rawValue}
                    readOnly
                    placeholder={parameter.required ? "Not supplied" : "Optional"}
                    aria-label={`${call.name} ${parameter.displayName}`}
                  />
                )}
                {editDocument && !editable && semanticDomain && (
                  <small className="script-macro-evidence">
                    Read-only in this phase: the backend did not confirm this parameter as safely rewritable.
                  </small>
                )}
                {semanticMatches.length > 1 && (
                  <small className="script-macro-evidence">
                    Also matches: {semanticMatches.slice(1).map((match) => match.domainLabel).join(", ")}
                  </small>
                )}
                {primarySemanticMatch?.evidence.length ? (
                  <small className="script-macro-evidence">
                    {primarySemanticMatch.evidence.join(" · ")}
                  </small>
                ) : null}
                {parameter.evidence.length > 0 && (
                  <small className="script-macro-evidence">
                    {parameter.evidence.join(" · ")}
                  </small>
                )}
              </label>
            );
          })}
        </div>
      )}

      {hasSemanticCandidate && parameters.length > 0 && (
        <div className="script-macro-edit-actions">
          {editDocument ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setEditDocument(null);
                  setDraftArguments([]);
                  setEditError(null);
                  onEditStateChange(false, false);
                }}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => void saveEdit()}
                disabled={!dirty || saving}
              >
                {saving ? "Saving…" : "Save parameters"}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => void beginEdit()}
              disabled={editLoading || editBlocked}
            >
              {editBlocked
                ? "Finish current macro edit first"
                : editLoading
                  ? "Checking source…"
                  : "Edit safe parameters"}
            </button>
          )}
          <small>
            Only source tokens backed by a proven project domain can be changed.
          </small>
        </div>
      )}

      {editError && (
        <div className="world-map-warning script-macro-edit-message">
          <strong>Macro edit stopped</strong>
          <p>{editError}</p>
        </div>
      )}
      {notice && (
        <p className="help-text script-macro-edit-message">{notice}</p>
      )}
    </article>
  );
}

export function ScriptsTab({ project, focus, onDirtyChange }: ScriptsTabProps) {
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
  const [macroCatalog, setMacroCatalog] = useState<MacroCatalog | null>(null);
  const [macroCatalogLoading, setMacroCatalogLoading] = useState(false);
  const [macroCatalogError, setMacroCatalogError] = useState<string | null>(null);
  const [macroCalls, setMacroCalls] = useState<ScriptMacroCallDocument | null>(null);
  const [macroCallsLoading, setMacroCallsLoading] = useState(false);
  const [macroCallsError, setMacroCallsError] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [activeMacroEdit, setActiveMacroEdit] = useState<{
    key: string;
    dirty: boolean;
  } | null>(null);

  useEffect(() => {
    onDirtyChange?.(activeMacroEdit?.dirty ?? false);
  }, [activeMacroEdit?.dirty, onDirtyChange]);

  useEffect(() => () => {
    onDirtyChange?.(false);
  }, [onDirtyChange]);

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
    if (!project) {
      setMacroCatalog(null);
      setMacroCatalogError(null);
      return;
    }

    let cancelled = false;
    setMacroCatalogLoading(true);
    setMacroCatalogError(null);
    void invoke<MacroCatalog>("get_macro_catalog")
      .then((nextCatalog) => {
        if (!cancelled) setMacroCatalog(nextCatalog);
      })
      .catch((error) => {
        if (!cancelled) setMacroCatalogError(String(error));
      })
      .finally(() => {
        if (!cancelled) setMacroCatalogLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [project?.storageKey, refreshVersion]);

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
            : preferredRoutine(nextDocument.routines)?.label ?? null,
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
  }, [project?.storageKey, selectedPath, refreshVersion]);

  useEffect(() => {
    if (!project || !selectedPath) {
      setMacroCalls(null);
      setMacroCallsError(null);
      return;
    }

    let cancelled = false;
    setMacroCallsLoading(true);
    setMacroCallsError(null);
    void invoke<ScriptMacroCallDocument>("get_script_macro_calls", { path: selectedPath })
      .then((nextCalls) => {
        if (!cancelled) setMacroCalls(nextCalls);
      })
      .catch((error) => {
        if (!cancelled) {
          setMacroCalls(null);
          setMacroCallsError(String(error));
        }
      })
      .finally(() => {
        if (!cancelled) setMacroCallsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [project?.storageKey, selectedPath, refreshVersion]);

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

  const macroDefinitions = useMemo(
    () => new Map(
      (macroCatalog?.macros ?? []).map((definition) => [definition.name.toLowerCase(), definition]),
    ),
    [macroCatalog],
  );
  const selectedRoutineMacroCalls = useMemo(() => {
    if (!selectedRoutine || !macroCalls || !document) return [];
    const nextStart = document.routines
      .filter((routine) => routine.startLine > selectedRoutine.startLine)
      .reduce((minimum, routine) => Math.min(minimum, routine.startLine), Number.POSITIVE_INFINITY);
    return macroCalls.calls.filter(
      (call) => call.line >= selectedRoutine.startLine && call.line < nextStart,
    );
  }, [document, macroCalls, selectedRoutine]);

  const previewReference = useMemo<MapScriptPreviewReference | null>(() => {
    if (!document || !selectedRoutineLabel) return null;
    const focused = focus?.previewReference;
    if (
      focused
      && focused.scriptPath === document.path
      && focused.routineLabel === selectedRoutineLabel
      && focused.mapScriptSource === document.source
    ) {
      return focused;
    }
    return {
      scriptPath: document.path,
      routineLabel: selectedRoutineLabel,
      mapScriptSource: document.source,
    };
  }, [document, focus, selectedRoutineLabel]);

  function confirmDiscardMacroEdit(): boolean {
    if (!activeMacroEdit) return true;
    if (
      activeMacroEdit.dirty
      && !window.confirm("Discard the unsaved macro parameter changes?")
    ) {
      return false;
    }
    setActiveMacroEdit(null);
    return true;
  }

  function selectEntry(entry: ScriptCatalogEntry) {
    if (entry.id === selectedGroupId || !confirmDiscardMacroEdit()) return;
    const path = entry.paths[0] ?? null;
    const routines = routinesForPath(entry, path);
    setSelectedGroupId(entry.id);
    setSelectedPath(path);
    setSelectedRoutineLabel(preferredRoutine(routines)?.label ?? null);
  }

  function selectPath(path: string) {
    if (path === selectedPath || !confirmDiscardMacroEdit()) return;
    const routines = routinesForPath(selectedEntry, path);
    setSelectedPath(path);
    setSelectedRoutineLabel(preferredRoutine(routines)?.label ?? null);
  }

  function selectRoutine(label: string) {
    if (label === selectedRoutineLabel || !confirmDiscardMacroEdit()) return;
    setSelectedRoutineLabel(label);
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
        <span className="read-only-badge">Guarded structured editing</span>
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
          <p className="browser-count script-macro-count">
            {macroCatalogLoading
              ? "Learning project macros…"
              : macroCatalog
                ? `${macroCatalog.definitionCount} project macros · ${macroCatalog.callCount} calls analyzed · ${macroCatalog.domains.length} semantic domains`
                : "Macro model unavailable"}
          </p>

          {catalogError && (
            <div className="world-map-warning">
              <strong>Script index unavailable</strong>
              <p>{catalogError}</p>
            </div>
          )}

          {macroCatalogError && (
            <div className="world-map-warning">
              <strong>Project macro model unavailable</strong>
              <p>{macroCatalogError}</p>
            </div>
          )}

          {macroCatalog && macroCatalog.domainWarnings.length > 0 && (
            <details className="script-macro-warnings">
              <summary>
                {macroCatalog.domainWarnings.length} semantic-domain warning
                {macroCatalog.domainWarnings.length === 1 ? "" : "s"}
              </summary>
              <ul>
                {macroCatalog.domainWarnings.map((warning, index) => (
                  <li key={`domain:${index}:${warning}`}>{warning}</li>
                ))}
              </ul>
            </details>
          )}

          {macroCatalog && macroCatalog.warnings.length > 0 && (
            <details className="script-macro-warnings">
              <summary>
                {macroCatalog.warnings.length} macro analysis warning
                {macroCatalog.warnings.length === 1 ? "" : "s"}
              </summary>
              <ul>
                {macroCatalog.warnings.slice(0, 20).map((warning, index) => (
                  <li key={`${index}:${warning}`}>{warning}</li>
                ))}
              </ul>
              {macroCatalog.warnings.length > 20 && (
                <p className="help-text">
                  {macroCatalog.warnings.length - 20} additional warnings are not shown here.
                </p>
              )}
            </details>
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
                        onClick={() => selectRoutine(routine.label)}
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
                            onClick={() => selectRoutine(routine.label)}
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

                      <section className="script-macro-inspector">
                        <div className="script-macro-inspector-heading">
                          <div>
                            <h5>Project-derived macro forms</h5>
                            <p className="help-text">
                              These fields are generated from RGBDS macros found in the loaded
                              project. Proven semantic parameters can now be rewritten safely
                              without a built-in Pokémon macro list.
                            </p>
                          </div>
                          {selectedRoutineMacroCalls.length > 0 && (
                            <span className="read-only-badge">
                              {selectedRoutineMacroCalls.length} macro call
                              {selectedRoutineMacroCalls.length === 1 ? "" : "s"}
                            </span>
                          )}
                        </div>

                        {macroCallsLoading && (
                          <div className="world-map-loading" aria-live="polite">
                            <strong>Resolving project macro calls…</strong>
                          </div>
                        )}

                        {macroCallsError && !macroCallsLoading && (
                          <div className="world-map-warning">
                            <strong>Macro calls unavailable</strong>
                            <p>{macroCallsError}</p>
                          </div>
                        )}

                        {!macroCallsLoading && !macroCallsError && selectedRoutineMacroCalls.length === 0 && (
                          <p className="empty-state">
                            No project-defined macro calls were detected in this routine.
                            Direct RGBDS assembly remains visible in the semantic preview above.
                          </p>
                        )}

                        {!macroCallsLoading && selectedRoutineMacroCalls.map((call) => (
                          <MacroCallForm
                            key={`${call.path}:${call.line}:${call.name}`}
                            call={call}
                            definition={macroDefinitions.get(call.name.toLowerCase()) ?? null}
                            domains={macroCatalog?.domains ?? []}
                            editBlocked={Boolean(
                              activeMacroEdit
                              && activeMacroEdit.key !== `${call.path}:${call.line}:${call.name}`,
                            )}
                            onEditStateChange={(open, dirty) => {
                              const key = `${call.path}:${call.line}:${call.name}`;
                              setActiveMacroEdit((current) => {
                                if (!open) {
                                  return current?.key === key ? null : current;
                                }
                                return { key, dirty };
                              });
                            }}
                            onSaved={() => setRefreshVersion((value) => value + 1)}
                          />
                        ))}
                      </section>

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
