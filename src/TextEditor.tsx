import { useEffect, useState } from "react";
import type { HistorySummary } from "./core/types";
import {
  TEXT_BOX_BOTTOM_LINE_WIDTH,
  TEXT_BOX_LINE_WIDTH,
  textDocumentDisplayPreview,
  textDocumentSegmentMetrics,
  type TextDocument,
  type TextSegment,
  type TextSegmentControl,
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
  onSaved,
}: TextEditorProps) {
  const [open, setOpen] = useState(false);
  const [document, setDocument] = useState<TextDocument | null>(null);
  const [draft, setDraft] = useState<TextSegment[]>([]);
  const [preview, setPreview] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = Boolean(document && !sameSegments(draft, document.segments));
  const segmentMetrics = document
    ? textDocumentSegmentMetrics(document, draft)
    : draft.map(() => ({ width: 0, maxWidth: TEXT_BOX_LINE_WIDTH, error: null }));
  const lineErrors = segmentMetrics.map((metric) => metric.error);
  const hasLineErrors = lineErrors.some(Boolean);

  useEffect(() => {
    setPreview(initialText);
  }, [initialText]);

  useEffect(() => {
    if (initialText !== null || !target) return;

    let cancelled = false;
    void invoke<TextDocument>("get_text_document", {
      path: target.path,
      label: target.label,
    }).then((next) => {
      if (cancelled || next.segments.length === 0) return;
      setPreview(textDocumentDisplayPreview(next));
    }).catch(() => {
      // A custom wrapper may need contextual disambiguation. Leave its preview
      // unresolved rather than surfacing a background-loading error.
    });

    return () => {
      cancelled = true;
    };
  }, [initialText, target?.path, target?.label]);

  useEffect(() => {
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
  }, [document?.path, document?.label]);

  async function beginEdit() {
    if (!target || disabled) {
      return;
    }
    setOpen(true);
    setBusy(true);
    setError(null);
    try {
      const next = await invoke<TextDocument>("get_text_document", {
        path: target.path,
        label: target.label,
        previewText: preview ?? undefined,
      });
      setDocument(next);
      setDraft(next.segments.map((segment) => ({ ...segment })));
      setPreview(textDocumentDisplayPreview(next));
    } catch (loadError) {
      setDocument(null);
      setDraft([]);
      setError(String(loadError));
    } finally {
      setBusy(false);
    }
  }

  function closeEditor() {
    if (dirty && !window.confirm("Discard the unsaved text changes?")) {
      return;
    }
    setOpen(false);
    setError(null);
  }

  function updateSegment(index: number, value: string) {
    const singleLine = value.replace(/\r?\n/g, " ");
    setDraft((current) => current.map((segment, segmentIndex) =>
      segmentIndex === index ? { ...segment, text: singleLine } : segment,
    ));
  }

  async function save() {
    if (!document || !document.editable || !dirty || hasLineErrors) {
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
      const savedSegments = draft.map((segment) => ({ ...segment }));
      setDocument({ ...document, segments: savedSegments });
      setDraft(savedSegments);
      setPreview(textDocumentDisplayPreview(document, savedSegments));
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
        {target && (
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

            {busy && !document ? <p>Loading text…</p> : null}
            {error && <p className="text-editor-error">{error}</p>}

            {document && (
              <>
                <p className="help-text">
                  Yellow Editor preserves the existing text flow. Upper dialogue rows have {TEXT_BOX_LINE_WIDTH} character spaces; the bottom row has {TEXT_BOX_BOTTOM_LINE_WIDTH} safe spaces because the continue arrow uses the final cell. The counter includes runtime inserts where their maximum width is known: <code>#</code> displays as <code>POKé</code> (4), <code>&lt;PLAYER&gt;</code> and <code>&lt;RIVAL&gt;</code> reserve 7, <code>&lt;USER&gt;</code> / <code>&lt;TARGET&gt;</code> reserve 10 for Pokémon names, and common dynamic item/name buffers are reserved automatically. Source terminator <code>@</code> characters are hidden and preserved for you.
                </p>
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
                    return (
                      <label className={`text-editor-segment${lineError ? " invalid" : ""}`} key={`${segment.control}:${index}`}>
                        <span className="text-editor-segment-heading">
                          <span>{controlLabel(segment.control)}</span>
                          <small>{width} / {maxWidth}</small>
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

                <div className="text-editor-preview-card">
                  <strong>Combined preview</strong>
                  <p>{textDocumentDisplayPreview(document, draft)}</p>
                </div>

                <div className="text-editor-actions">
                  <button type="button" className="small-button" disabled={busy} onClick={closeEditor}>Cancel</button>
                  <button
                    type="button"
                    className="small-button primary-action"
                    disabled={busy || !document.editable || !dirty || hasLineErrors}
                    onClick={() => void save()}
                  >
                    {busy ? "Saving…" : "Save text"}
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
