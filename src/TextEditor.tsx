import { useEffect, useState } from "react";
import type { HistorySummary } from "./core/types";
import {
  TEXT_BOX_BOTTOM_LINE_WIDTH,
  TEXT_BOX_LINE_WIDTH,
  textDocumentDisplayPreview,
  textDocumentSegmentMetrics,
  textSegmentsDisplayParts,
  type TextDocument,
  type TextSegment,
  type TextSegmentControl,
  type TextTerminator,
} from "./core/textEditing";
import { invoke } from "./platform/compat";
import "./TextEditor.css";

export interface TextEditorTarget {
  path: string;
  label: string;
}

interface TextEditorProps {
  title: string;
  target: TextEditorTarget | null;
  initialText: string | null;
  disabled?: boolean;
  controlledSegments?: TextSegment[];
  controlledTerminator?: TextTerminator;
  onControlledSegmentsChange?(segments: TextSegment[]): void;
  onSaved?(history: HistorySummary): void;
}

function controlLabel(control: TextSegmentControl): string {
  switch (control) {
    case "text": return "Start text";
    case "next": return "Next line";
    case "line": return "Bottom line";
    case "cont": return "Scroll to next line";
    case "para": return "New paragraph";
    case "page": return "New Pokédex page";
  }
}

function sameSegments(left: TextSegment[], right: TextSegment[]): boolean {
  return left.length === right.length && left.every((segment, index) =>
    segment.control === right[index]?.control && segment.text === right[index]?.text,
  );
}

export function TextEditor({
  title,
  target,
  initialText,
  disabled = false,
  controlledSegments,
  controlledTerminator = null,
  onControlledSegmentsChange,
  onSaved,
}: TextEditorProps) {
  const [open, setOpen] = useState(false);
  const [document, setDocument] = useState<TextDocument | null>(null);
  const [leafDocuments, setLeafDocuments] = useState<TextDocument[]>([]);
  const [draft, setDraft] = useState<TextSegment[]>([]);
  const [preview, setPreview] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const controlled = Boolean(controlledSegments && onControlledSegmentsChange);
  const workingDocument = document && document.terminator === "dex"
    ? {
        ...document,
        displayParts: textSegmentsDisplayParts(draft),
      }
    : document;
  const dirty = Boolean(document && !sameSegments(draft, document.segments));
  const segmentMetrics = workingDocument
    ? textDocumentSegmentMetrics(workingDocument, draft)
    : draft.map(() => ({ width: 0, maxWidth: TEXT_BOX_LINE_WIDTH, error: null }));
  const lineErrors = segmentMetrics.map((metric) => metric.error);
  const dexStructureError = workingDocument?.terminator === "dex" && (
    draft.length === 0
    || draft[0]?.control !== "text"
    || draft.some((segment) => !["text", "next", "page"].includes(segment.control))
  );
  const hasLineErrors = lineErrors.some(Boolean) || dexStructureError;

  useEffect(() => {
    setPreview(initialText);
  }, [initialText]);

  useEffect(() => {
    if (controlled) return;
    setDocument(null);
    setLeafDocuments([]);
    setDraft([]);
    setPreview(initialText);
    setError(null);
  }, [controlled, target?.path, target?.label]);

  useEffect(() => {
    if (!controlled || !controlledSegments) return;
    const segments = controlledSegments.map((segment) => ({ ...segment }));
    const localDocument: TextDocument = {
      path: target?.path ?? "",
      label: target?.label ?? title,
      sourceHash: "",
      segments,
      displayParts: textSegmentsDisplayParts(segments),
      terminator: controlledTerminator,
      editable: true,
      warnings: [],
    };
    setDocument(localDocument);
    if (!open) setDraft(segments);
    setPreview(textDocumentDisplayPreview(localDocument, segments));
  }, [
    controlled,
    controlledSegments,
    controlledTerminator,
    open,
    target?.path,
    target?.label,
    title,
  ]);

  useEffect(() => {
    if (controlled || initialText !== null || !target) return;

    let cancelled = false;
    void invoke<TextDocument[]>("get_text_leaf_documents", {
      path: target.path,
      label: target.label,
    }).then((documents) => {
      if (cancelled) return;
      const editable = documents.filter((entry) => entry.editable && entry.segments.length > 0);
      if (editable.length > 1) {
        setLeafDocuments(editable);
        setPreview(`${editable.length} dialogue paths available. Open the editor to choose one.`);
        return;
      }
      setLeafDocuments([]);
      const next = editable[0] ?? documents.find((entry) => entry.segments.length > 0);
      if (next) setPreview(textDocumentDisplayPreview(next));
    }).catch(() => {
      // A custom wrapper may still be too dynamic to resolve safely.
    });

    return () => {
      cancelled = true;
    };
  }, [controlled, initialText, target?.path, target?.label]);

  useEffect(() => {
    if (controlled) return;
    const path = document?.path;
    const label = document?.label;
    if (!path || !label) {
      return;
    }

    function handleHistoryChanged() {
      void (async () => {
        try {
          // Once a programmable wrapper has been resolved, document points at
          // the concrete editable leaf. Reload that leaf directly so Undo/Redo
          // immediately updates the dialogue card without re-running wrapper
          // disambiguation against stale preview text.
          const next = await invoke<TextDocument>("get_text_document", { path, label });
          setDocument(next);
          setDraft(next.segments.map((segment) => ({ ...segment })));
          setPreview(textDocumentDisplayPreview(next));
          setError(null);
        } catch (reloadError) {
          setError(String(reloadError));
        }
      })();
    }

    window.addEventListener("yellow-editor:history-changed", handleHistoryChanged);
    return () => window.removeEventListener("yellow-editor:history-changed", handleHistoryChanged);
  }, [controlled, document?.path, document?.label]);

  async function beginEdit() {
    if ((!target && !controlled) || disabled) {
      return;
    }
    setOpen(true);
    setError(null);

    if (controlled && controlledSegments) {
      const segments = controlledSegments.map((segment) => ({ ...segment }));
      const next: TextDocument = {
        path: target?.path ?? "",
        label: target?.label ?? title,
        sourceHash: "",
        segments,
        displayParts: textSegmentsDisplayParts(segments),
        terminator: controlledTerminator,
        editable: true,
        warnings: [],
      };
      setDocument(next);
      setDraft(segments);
      setPreview(textDocumentDisplayPreview(next, segments));
      return;
    }

    if (!target) return;
    setBusy(true);
    try {
      if (initialText === null) {
        const documents = await invoke<TextDocument[]>("get_text_leaf_documents", {
          path: target.path,
          label: target.label,
        });
        const editable = documents.filter((entry) => entry.editable && entry.segments.length > 0);
        if (editable.length > 1) {
          setLeafDocuments(editable);
          setDocument(null);
          setDraft([]);
          setPreview(`${editable.length} dialogue paths available. Open the editor to choose one.`);
          return;
        }
        if (editable.length === 1) {
          const next = editable[0];
          setLeafDocuments([]);
          setDocument(next);
          setDraft(next.segments.map((segment) => ({ ...segment })));
          setPreview(textDocumentDisplayPreview(next));
          return;
        }
      }

      const next = await invoke<TextDocument>("get_text_document", {
        path: target.path,
        label: target.label,
        previewText: preview ?? undefined,
      });
      setLeafDocuments([]);
      setDocument(next);
      setDraft(next.segments.map((segment) => ({ ...segment })));
      setPreview(textDocumentDisplayPreview(next));
    } catch (loadError) {
      setDocument(null);
      setLeafDocuments([]);
      setDraft([]);
      setError(String(loadError));
    } finally {
      setBusy(false);
    }
  }

  function chooseLeaf(next: TextDocument) {
    setDocument(next);
    setDraft(next.segments.map((segment) => ({ ...segment })));
    setPreview(textDocumentDisplayPreview(next));
    setError(null);
  }

  function flowSummary(): string | null {
    return leafDocuments.length > 1
      ? `${leafDocuments.length} dialogue paths available. Open the editor to choose one.`
      : null;
  }

  function returnToDialoguePaths() {
    if (dirty && !window.confirm("Discard the unsaved text changes and choose another dialogue path?")) {
      return;
    }
    setDocument(null);
    setDraft([]);
    const summary = flowSummary();
    if (summary) setPreview(summary);
    setError(null);
  }

  function closeEditor() {
    if (dirty && !window.confirm("Discard the unsaved text changes?")) {
      return;
    }
    setOpen(false);
    const summary = flowSummary();
    if (summary) setPreview(summary);
    setError(null);
  }

  function updateSegment(index: number, value: string) {
    const singleLine = value.replace(/\r?\n/g, " ");
    setDraft((current) => current.map((segment, segmentIndex) =>
      segmentIndex === index ? { ...segment, text: singleLine } : segment,
    ));
  }

  function updateSegmentControl(index: number, control: TextSegmentControl) {
    setDraft((current) => current.map((segment, segmentIndex) =>
      segmentIndex === index ? { ...segment, control } : segment,
    ));
  }

  function removeSegment(index: number) {
    setDraft((current) => current.filter((_, segmentIndex) => segmentIndex !== index));
  }

  function addDexSegment() {
    setDraft((current) => [...current, { control: "next", text: "" }]);
  }

  async function save() {
    if (!document || !document.editable || !dirty || hasLineErrors) {
      return;
    }

    const savedSegments = draft.map((segment) => ({ ...segment }));
    if (controlled && onControlledSegmentsChange) {
      onControlledSegmentsChange(savedSegments);
      const nextDocument = {
        ...document,
        segments: savedSegments,
        displayParts: textSegmentsDisplayParts(savedSegments),
      };
      setDocument(nextDocument);
      setDraft(savedSegments);
      setPreview(textDocumentDisplayPreview(nextDocument, savedSegments));
      setOpen(false);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const history = await invoke<HistorySummary>("save_text_document", {
        path: document.path,
        label: document.label,
        sourceHash: document.sourceHash,
        segments: draft,
      });
      setDocument({ ...document, segments: savedSegments });
      setDraft(savedSegments);
      setPreview(
        leafDocuments.length > 1
          ? `${leafDocuments.length} dialogue paths available. Open the editor to choose one.`
          : textDocumentDisplayPreview(document, savedSegments),
      );
      setLeafDocuments((current) => current.map((entry) =>
        entry.path === document.path && entry.label === document.label
          ? { ...document, segments: savedSegments }
          : entry
      ));
      onSaved?.(history);
      window.dispatchEvent(new CustomEvent("yellow-editor:history-changed", { detail: history }));
      setOpen(false);
    } catch (saveError) {
      setError(String(saveError));
    } finally {
      setBusy(false);
    }
  }

  const displayTarget = document
    ? { path: document.path, label: document.label }
    : target;

  return (
    <div className="text-editor-summary">
      <div className="text-editor-summary-heading">
        <strong>{title}</strong>
        {(target || controlled) && (
          <button className="small-button" type="button" disabled={disabled} onClick={() => void beginEdit()}>
            Edit text
          </button>
        )}
      </div>
      <p className="text-editor-preview">
        {preview ?? "Text is referenced through a custom or unsupported wrapper."}
      </p>
      {target ? <code>{target.label}</code> : <span className="help-text">No editable text label was resolved.</span>}

      {open && (
        <div className="text-editor-backdrop" role="presentation">
          <section className="text-editor-dialog" role="dialog" aria-modal="true" aria-label={`Edit ${title}`}>
            <div className="text-editor-dialog-heading">
              <div>
                <h3>{title}</h3>
                {displayTarget && <p><code>{displayTarget.path}</code> · <code>{displayTarget.label}</code></p>}
              </div>
              <button type="button" className="small-button" disabled={busy} onClick={closeEditor}>Close</button>
            </div>

            {busy && !document && leafDocuments.length === 0 ? <p>Loading text…</p> : null}
            {error && <p className="text-editor-error">{error}</p>}

            {!document && leafDocuments.length > 1 && (
              <div className="text-editor-path-picker">
                <div>
                  <strong>This interaction has {leafDocuments.length} dialogue paths.</strong>
                  <p className="help-text">
                    Choose the piece of dialogue you want to edit. Yellow Editor keeps the surrounding game-state and Yes/No logic unchanged.
                  </p>
                </div>
                <div className="text-editor-path-list">
                  {leafDocuments.map((entry, index) => (
                    <button
                      key={`${entry.path}:${entry.label}`}
                      type="button"
                      onClick={() => chooseLeaf(entry)}
                    >
                      <strong>Dialogue path {index + 1}</strong>
                      <span>{textDocumentDisplayPreview(entry) || entry.label}</span>
                      <code>{entry.label}</code>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {document && (
              <>
                {leafDocuments.length > 1 && (
                  <button
                    type="button"
                    className="small-button text-editor-back-to-paths"
                    disabled={busy}
                    onClick={returnToDialoguePaths}
                  >
                    ← Dialogue paths
                  </button>
                )}
                {document.terminator === "dex" ? (
                  <p className="help-text">
                    Pokédex rows have {TEXT_BOX_LINE_WIDTH} character spaces. Use <strong>Next line</strong> for another row on the same page and <strong>New Pokédex page</strong> to begin the next page. The entry must begin with <strong>Start text</strong>.
                  </p>
                ) : (
                  <p className="help-text">
                    Yellow Editor preserves the existing text flow. Upper dialogue rows have {TEXT_BOX_LINE_WIDTH} character spaces; the bottom row has {TEXT_BOX_BOTTOM_LINE_WIDTH} safe spaces because the continue arrow uses the final cell. The counter includes runtime inserts where their maximum width is known: <code>#</code> displays as <code>POKé</code> (4), <code>&lt;PLAYER&gt;</code> and <code>&lt;RIVAL&gt;</code> reserve 7, <code>&lt;USER&gt;</code> / <code>&lt;TARGET&gt;</code> reserve 10 for Pokémon names, and common dynamic item/name buffers are reserved automatically. Source terminator <code>@</code> characters are hidden and preserved for you.
                  </p>
                )}
                {document.warnings.length > 0 && (
                  <div className="text-editor-warning">
                    <strong>This text is read-only for now.</strong>
                    <ul>{document.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                  </div>
                )}

                <div className="text-editor-segments">
                  {draft.map((segment, index) => {
                    const metric = segmentMetrics[index];
                    const width = metric?.width ?? 0;
                    const maxWidth = metric?.maxWidth ?? TEXT_BOX_LINE_WIDTH;
                    const lineError = lineErrors[index];
                    const dexMode = document.terminator === "dex";
                    return (
                      <label className={`text-editor-segment${lineError ? " invalid" : ""}`} key={`${index}:${segment.control}`}>
                        <span className="text-editor-segment-heading">
                          {dexMode ? (
                            <select
                              value={segment.control}
                              disabled={busy || !document.editable}
                              onChange={(event) => updateSegmentControl(index, event.target.value as TextSegmentControl)}
                            >
                              <option value="text">Start text</option>
                              <option value="next">Next line</option>
                              <option value="page">New Pokédex page</option>
                            </select>
                          ) : (
                            <span>{controlLabel(segment.control)}</span>
                          )}
                          <span className="text-editor-segment-meta">
                            <small>{width} / {maxWidth}</small>
                            {dexMode && (
                              <button
                                type="button"
                                className="small-button danger-action"
                                disabled={busy || !document.editable || draft.length <= 1}
                                onClick={() => removeSegment(index)}
                              >
                                Remove
                              </button>
                            )}
                          </span>
                        </span>
                        <textarea
                          rows={2}
                          value={segment.text}
                          disabled={busy || !document.editable}
                          aria-invalid={lineError ? "true" : "false"}
                          onChange={(event) => updateSegment(index, event.target.value)}
                        />
                        {lineError && <small className="text-editor-line-error">{lineError}</small>}
                      </label>
                    );
                  })}
                </div>

                {document.terminator === "dex" && (
                  <>
                    <button
                      type="button"
                      className="small-button text-editor-add-segment"
                      disabled={busy || !document.editable}
                      onClick={addDexSegment}
                    >
                      Add text line
                    </button>
                    {dexStructureError && (
                      <small className="text-editor-line-error">
                        Pokédex text must begin with Start text and may only use Start text, Next line, or New Pokédex page.
                      </small>
                    )}
                  </>
                )}

                <div className="text-editor-preview-card">
                  <strong>Combined preview</strong>
                  <p>{textDocumentDisplayPreview(workingDocument ?? document, draft)}</p>
                </div>

                <div className="text-editor-actions">
                  <button type="button" className="small-button" disabled={busy} onClick={closeEditor}>Cancel</button>
                  <button
                    type="button"
                    className="small-button primary-action"
                    disabled={busy || !document.editable || !dirty || hasLineErrors}
                    onClick={() => void save()}
                  >
                    {busy ? "Saving…" : controlled ? "Apply text" : "Save text"}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
