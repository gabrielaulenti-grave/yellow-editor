import { useState } from "react";
import type { HistorySummary } from "./core/types";
import type {
  TextDocument,
  TextSegment,
  TextSegmentControl,
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

function segmentsToPreview(segments: TextSegment[]): string {
  let result = "";
  segments.forEach((segment, index) => {
    if (index > 0) {
      result += segment.control === "para" || segment.control === "page" ? "\n\n" : "\n";
    }
    result += segment.text;
  });
  return result;
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

  async function beginEdit() {
    if (!target || disabled) {
      return;
    }
    setOpen(true);
    setBusy(true);
    setError(null);
    try {
      const next = await invoke<TextDocument>("get_text_document", target);
      setDocument(next);
      setDraft(next.segments.map((segment) => ({ ...segment })));
      setPreview(segmentsToPreview(next.segments));
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
    if (!document || !document.editable || !dirty) {
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
      const refreshed = await invoke<TextDocument>("get_text_document", {
        path: document.path,
        label: document.label,
      });
      setDocument(refreshed);
      setDraft(refreshed.segments.map((segment) => ({ ...segment })));
      setPreview(segmentsToPreview(refreshed.segments));
      onSaved?.(history);
      window.dispatchEvent(new CustomEvent("yellow-editor:history-changed", { detail: history }));
      setOpen(false);
    } catch (saveError) {
      setError(String(saveError));
    } finally {
      setBusy(false);
    }
  }

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
                {target && <p><code>{target.path}</code> · <code>{target.label}</code></p>}
              </div>
              <button type="button" className="small-button" disabled={busy} onClick={closeEditor}>Close</button>
            </div>

            {busy && !document ? <p>Loading text…</p> : null}
            {error && <p className="text-editor-error">{error}</p>}

            {document && (
              <>
                <p className="help-text">
                  Yellow Editor preserves the existing text flow. Edit the words here; line, scroll, paragraph, and page controls stay in their original positions.
                </p>
                {document.warnings.length > 0 && (
                  <div className="text-editor-warning">
                    <strong>This text is read-only for now.</strong>
                    <ul>{document.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                  </div>
                )}

                <div className="text-editor-segments">
                  {draft.map((segment, index) => (
                    <label className="text-editor-segment" key={`${segment.control}:${index}`}>
                      <span>{controlLabel(segment.control)}</span>
                      <textarea
                        rows={2}
                        value={segment.text}
                        disabled={busy || !document.editable}
                        onChange={(event) => updateSegment(index, event.target.value)}
                      />
                    </label>
                  ))}
                </div>

                <div className="text-editor-preview-card">
                  <strong>Combined preview</strong>
                  <p>{segmentsToPreview(draft)}</p>
                </div>

                <div className="text-editor-actions">
                  <button type="button" className="small-button" disabled={busy} onClick={closeEditor}>Cancel</button>
                  <button
                    type="button"
                    className="small-button primary-action"
                    disabled={busy || !document.editable || !dirty}
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
