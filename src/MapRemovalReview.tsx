import { useEffect, useRef, useState } from "react";
import { invoke } from "./platform/compat";
import type { MapRemovalDocument } from "./core/mapRemoval";
import type { HistorySummary } from "./core/types";
import "./MapEditing.css";

export function MapRemovalReview({ mapConstant, kind, id, onClose, onSaved, onOpenScript }: {
  mapConstant: string; kind: "sign" | "object"; id: number; onClose(): void; onSaved(history: HistorySummary): void; onOpenScript(path: string): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), [document, setDocument] = useState<MapRemovalDocument | null>(null);
  const [acknowledged, setAcknowledged] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState<string | null>(null);
  useEffect(() => { dialog.current?.showModal(); let cancelled = false;
    void invoke<MapRemovalDocument>("get_map_removal_document", { mapConstant, kind, id }).then(d => { if (!cancelled) setDocument(d); }).catch(e => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [mapConstant, kind, id]);
  async function remove() { if (!document || document.blockers.length || !acknowledged || saving) return; setSaving(true); setError(null);
    try { onSaved(await invoke<HistorySummary>("remove_map_record", { document })); } catch(e) { setError(String(e)); setSaving(false); } }
  return <dialog ref={dialog} className="wizard-dialog map-edit-dialog" aria-labelledby="map-remove-title" onCancel={e => { if (saving) e.preventDefault(); else onClose(); }}>
    <div className="wizard-heading"><div><h2 id="map-remove-title">Review removal</h2><p>{document ? `${document.name} in ${document.mapName}` : "Inspecting source dependencies…"}</p></div><button type="button" aria-label="Close removal review" disabled={saving} onClick={onClose}>×</button></div>
    {error && <p role="alert">{error}</p>}
    {document && <>
      <p><code>{document.sourcePath}:{document.sourceLine}</code></p>
      <ul>{document.effects.map(effect => <li key={effect}>{effect}</li>)}</ul>
      {document.blockers.length > 0 ? <section aria-label="Removal dependencies"><h3>Removal needs source review</h3><ul>{document.blockers.map(reason => <li key={reason}>{reason}</li>)}</ul></section> : <label className="map-edit-ack"><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} />Remove this record. I can restore it with project Undo.</label>}
      {document.references.length > 0 && <details open><summary>References to this object</summary>{document.references.map((r, i) => <p key={i}><button type="button" className="small-button" disabled={saving} onClick={() => { onClose(); onOpenScript(r.path); }}>{r.path}:{r.line}</button> <code>{r.code}</code></p>)}</details>}
      <button type="button" className="small-button" disabled={saving} onClick={() => { onClose(); onOpenScript(document.sourcePath); }}>View object source</button>
    </>}
    <div className="wizard-actions"><button type="button" disabled={saving} onClick={onClose}>Cancel</button><button type="button" disabled={!document || Boolean(document?.blockers.length) || !acknowledged || saving} onClick={() => void remove()}>{saving ? "Removing…" : "Remove record"}</button></div>
  </dialog>;
}
