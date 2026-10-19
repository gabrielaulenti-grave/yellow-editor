import { useEffect, useState } from "react";
import { invoke } from "./platform/compat";
import type { InteractionDocument } from "./core/scriptInteractions";
import { ScriptInteractionEditor } from "./ScriptInteractionEditor";
import { TextEditor, type TextEditorTarget } from "./TextEditor";

export function MapInteractionEditor({ title, target, dialogueTarget, onOpenScript, onDirtyChange, onInspectHere }: {
  title: string;
  target: TextEditorTarget | null;
  dialogueTarget: TextEditorTarget | null;
  onOpenScript(path: string, label?: string | null): void;
  onInspectHere?(path: string, label?: string | null): void;
  onDirtyChange?(dirty: boolean): void;
}) {
  const [support, setSupport] = useState<{ editable: boolean; reason: string | null } | null>(null);
  const [textOpen, setTextOpen] = useState(false);
  const [interactionOpen, setInteractionOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setSupport(null);
    if (!target) {
      setSupport({ editable: false, reason: "This object's script entry could not be resolved." });
      return;
    }
    void invoke<InteractionDocument>("get_script_interaction_document", { ...target })
      .then(document => {
        if (!cancelled) setSupport({ editable: Boolean(document.canCreate || document.reward || document.gift),
          reason: document.reason ?? "This interaction requires editing through Scripts." });
      })
      .catch(error => { if (!cancelled) setSupport({ editable: false, reason: String(error) }); });
    return () => { cancelled = true; };
  }, [target?.path, target?.label, revision]);
  return <div className="world-map-object-editors">
    <TextEditor title={title} target={dialogueTarget} initialText={null} disabled={interactionOpen}
      onEditStateChange={(open, dirty) => { setTextOpen(open); onDirtyChange?.(dirty); }}
      onSaved={() => setRevision(value => value + 1)} />
    <div className="world-map-interaction-actions">
      {target && support?.editable
        ? <ScriptInteractionEditor path={target.path} label={target.label} disabled={textOpen}
            onEditStateChange={(open, dirty) => { setInteractionOpen(open); onDirtyChange?.(dirty); }} />
        : <button type="button" className="small-button" disabled>Edit interaction</button>}
      {target && onInspectHere && <button type="button" className="small-button" disabled={textOpen || interactionOpen} onClick={() => onInspectHere(target.path, target.label)}>Inspect map logic</button>}
      {target && <button type="button" className="small-button" disabled={textOpen || interactionOpen}
        onClick={() => onOpenScript(target.path, target.label)}>View script</button>}
    </div>
    {!support && <p className="help-text">Checking interaction support…</p>}
    {support && !support.editable && <p className="help-text">{support.reason}</p>}
  </div>;
}
