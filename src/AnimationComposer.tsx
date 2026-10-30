import { useCallback, useEffect, useRef, useState } from "react";
import type { AnimationEditDocument, AnimationEditValues, AnimationStepValues } from "./core/battleAnimationEditing";
import { animationTitle, type BattleAnimationScript, type BattleAnimationStep } from "./core/battleAnimations";
import type { HistorySummary } from "./core/types";
import type { EditorController } from "./editor/types";
import { invoke } from "./platform/compat";
import { StepInspector } from "./BattleAnimationsPanel";

function initialValues(doc: AnimationEditDocument, templateId: number | null, moveId: number | null): AnimationEditValues {
  const template = doc.catalog.scripts.find(script => script.id === templateId);
  const base = `${template?.constant.replace(/_ANIM$/, "") ?? "CUSTOM"}_COPY_ANIM`.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  let constant = base, suffix = 2;
  while (doc.catalog.scripts.some(script => script.constant === constant)) constant = `${base}_${suffix++}`;
  return {
    constant: doc.animationId === null ? constant : template!.constant,
    steps: template?.steps.filter(step => step.kind !== "unknown").map(step => ({ kind: step.kind as AnimationStepValues["kind"], targetId: step.targetId!, sound: step.sound, sheetId: step.sheetId ?? 0, delay: step.delay ?? 8 })) ?? [],
    hook: doc.animationId === null ? null : doc.catalog.hooks.find(hook => hook.animationId === templateId)?.routine ?? null,
    assignMoveId: doc.animationId === null ? moveId : null, confirmShared: false,
  };
}

export function AnimationComposer({ templateId, editing, moveId, onClose, onSaved, onControllerChange }: {
  templateId: number | null; editing: boolean; moveId: number | null;
  onClose(): void; onSaved(animationId: number, moveId: number | null): void;
  onControllerChange(controller: EditorController | null): void;
}) {
  const [doc, setDoc] = useState<AnimationEditDocument | null>(null), [values, setValues] = useState<AnimationEditValues | null>(null);
  const [baseline, setBaseline] = useState(""), [selected, setSelected] = useState(0), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [revision, setRevision] = useState(0);
  const undo = useRef<AnimationEditValues[]>([]), redo = useRef<AnimationEditValues[]>([]), dialog = useRef<HTMLDialogElement>(null);
  const dirty = Boolean(values && (!editing || JSON.stringify(values) !== baseline));
  const valid = Boolean(doc && !doc.reason && values && /^[A-Z][A-Z0-9_]{0,63}$/.test(values.constant) && values.steps.length > 0 && values.steps.length <= 128 && values.steps.every(step => doc.sounds.includes(step.sound) && (step.kind === "effect" ? doc.catalog.effects.some(effect => effect.id === step.targetId) : Number.isInteger(step.delay) && step.delay >= 0 && step.delay <= 63 && step.sheetId >= 0 && step.sheetId < 3)) && (!editing || values.confirmShared));
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  useEffect(() => {
    let cancelled = false; setLoading(true); setError(null);
    void invoke<AnimationEditDocument>("get_animation_edit_document", { animationId: editing ? templateId : null }).then(doc => {
      if (cancelled) return;
      const next = initialValues(doc, templateId, moveId);
      setDoc(doc); setValues(next); setBaseline(JSON.stringify(next)); setSelected(0); undo.current = []; redo.current = [];
    }).catch(error => { if (!cancelled) setError(String(error)); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [templateId, editing, moveId, revision]);
  const update = (next: AnimationEditValues) => { if (values) { undo.current.push(values); if (undo.current.length > 60) undo.current.shift(); redo.current = []; } setValues(next); };
  const save = useCallback(async () => {
    if (!doc || !values || !valid || !dirty || busy || loading) return;
    setBusy(true); setError(null);
    try {
      const result = await invoke<{ history: HistorySummary; animationId: number }>("save_animation", { document: doc, values });
      window.dispatchEvent(new CustomEvent("yellow-editor:history-changed", { detail: result.history }));
      onSaved(result.animationId, values.assignMoveId);
    } catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  }, [doc, values, valid, dirty, busy, loading, onSaved]);
  const revert = useCallback(async () => {
    if (values && dirty && !window.confirm("Discard this animation draft and reload its source?")) return;
    setRevision(value => value + 1);
  }, [values, dirty]);
  useEffect(() => { onControllerChange({ dirty, valid, busy: busy || loading, save, revert }); }, [dirty, valid, busy, loading, save, revert, onControllerChange]);
  useEffect(() => () => onControllerChange(null), [onControllerChange]);
  useEffect(() => { const guard = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } }; window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard); }, [dirty]);
  const close = () => { if (!busy && (!dirty || window.confirm("Discard the unsaved animation draft?"))) onClose(); };
  const stepIndex = Math.min(selected, Math.max(0, (values?.steps.length ?? 1) - 1)), step = values?.steps[stepIndex];
  function patchStep(patch: Partial<AnimationStepValues>) { if (values) update({ ...values, steps: values.steps.map((value, i) => i === stepIndex ? { ...value, ...patch } : value) }); }
  function addStep(kind: AnimationStepValues["kind"]) {
    if (!doc || !values) return;
    const id = kind === "effect" ? doc.catalog.effects[0]?.id : doc.catalog.subanimations.find(sub => !sub.warnings.length)?.id;
    if (id === undefined) return;
    update({ ...values, steps: [...values.steps, { kind, targetId: id, sound: "NO_MOVE", sheetId: 0, delay: 8 }] }); setSelected(values.steps.length);
  }
  const title = (step: AnimationStepValues) => step.kind === "effect" ? doc?.catalog.effects.find(effect => effect.id === step.targetId)?.constant ?? "Unresolved effect" : doc?.catalog.subanimations.find(sub => sub.id === step.targetId)?.label ?? "Unresolved sequence";
  const preview: BattleAnimationStep | null = step ? { ...step, target: title(step), source: { path: "Unsaved animation draft", line: stepIndex + 1, text: `battle_anim ${step.sound}, ${title(step)}${step.kind === "subanimation" ? `, ${step.sheetId}, ${step.delay}` : ""}` } } : null;
  const synthetic: BattleAnimationScript = { id: doc?.animationId ?? 0, constant: values?.constant ?? "", label: values?.constant ?? "", steps: [], warnings: [], source: { path: "Draft", line: 1, text: "" } };
  return <dialog ref={dialog} className="animation-composer" aria-label="Animation composer" onCancel={event => { event.preventDefault(); close(); }}>
    <div className="tab-heading-row"><div><h3>{editing ? "Edit animation" : templateId === null ? "New animation" : "Duplicate animation"}</h3><p>{editing ? "Edit this animation ID. Shared frame sequences and effect routines remain unchanged." : "Create an independent script using existing frame sequences, effects and sound cues."}</p></div><button type="button" disabled={busy} onClick={close}>Close composer</button></div>
    {loading && <p role="status">Preparing animation sources…</p>}
    {error && <p className="graphics-error" role="alert">{error}</p>}
    {doc?.reason && <p className="graphics-error" role="status">{doc.reason}</p>}
    {doc && values && !loading && <>
      <fieldset disabled={busy || Boolean(doc.reason)} className="animation-composer-fields">
        <div className="field-grid two-column-fields"><label className="editor-field"><span>Animation constant</span><input aria-label="Animation constant" value={values.constant} disabled={editing} maxLength={64} onChange={event => update({ ...values, constant: event.target.value.toUpperCase() })} /><small>{editing ? `Existing ID ${doc.animationId}` : `New ID ${doc.nextId}; existing IDs stay unchanged.`}</small></label>
        <label className="editor-field"><span>Assign to move</span><select aria-label="Assign to move" value={values.assignMoveId ?? "none"} onChange={event => update({ ...values, assignMoveId: event.target.value === "none" ? null : Number(event.target.value) })}><option value="none">Keep current move assignments</option>{doc.catalog.moves.map(move => <option key={move.id} value={move.id}>{move.name} · {move.constant}</option>)}</select></label></div>
        <label className="editor-field"><span>Additional per-frame hook</span><select aria-label="Additional per-frame hook" value={values.hook ?? "none"} onChange={event => update({ ...values, hook: event.target.value === "none" ? null : event.target.value })}><option value="none">None</option>{[...new Set(doc.catalog.hooks.filter(hook => hook.routineSource).map(hook => hook.routine))].map(routine => <option key={routine}>{routine}</option>)}</select></label>
        <p className="help-text">Copies reuse the selected command steps. Per-frame hooks are chosen explicitly. Other engine branches tied to an original animation ID, including opponent substitutions, are not copied automatically. Sound cues come from existing moves.</p>
        <div className="graphics-controls"><button type="button" disabled={values.steps.length >= 128} onClick={() => addStep("subanimation")}>Add frame sequence</button><button type="button" disabled={values.steps.length >= 128} onClick={() => addStep("effect")}>Add screen effect</button><button type="button" disabled={!undo.current.length} onClick={() => { const previous = undo.current.pop(); if (previous) { redo.current.push(values); setValues(previous); } }}>Undo animation change</button><button type="button" disabled={!redo.current.length} onClick={() => { const next = redo.current.pop(); if (next) { undo.current.push(values); setValues(next); } }}>Redo animation change</button></div>
        <ol className="animation-step-list" aria-label="Draft animation steps">{values.steps.map((step, i) => <li key={i}><button type="button" aria-pressed={i === stepIndex} onClick={() => setSelected(i)}><strong>{i + 1}. {animationTitle(title(step))}</strong><span>{step.kind === "effect" ? "Special effect" : `Sheet ${step.sheetId} · delay ${step.delay}`} · {step.sound === "NO_MOVE" ? "No sound" : step.sound}</span></button></li>)}</ol>
        {step && <section className="animation-step-fields" aria-label="Draft step settings"><h4>Step {stepIndex + 1}</h4><label className="editor-field"><span>{step.kind === "effect" ? "Screen effect" : "Frame sequence"}</span><select aria-label="Step component" value={step.targetId} onChange={event => patchStep({ targetId: Number(event.target.value) })}>{step.kind === "effect" ? doc.catalog.effects.map(effect => <option key={effect.id} value={effect.id}>{animationTitle(effect.constant)} · {effect.constant}</option>) : doc.catalog.subanimations.map(sub => <option key={sub.id} value={sub.id} disabled={sub.warnings.length > 0}>{sub.label}</option>)}</select></label>
          <label className="editor-field"><span>Sound cue</span><select aria-label="Step sound cue" value={step.sound} onChange={event => patchStep({ sound: event.target.value })}>{doc.sounds.map(sound => <option key={sound} value={sound}>{sound === "NO_MOVE" ? "No sound" : sound}</option>)}</select></label>
          {step.kind === "subanimation" && <div className="field-grid two-column-fields"><label className="editor-field"><span>Tile sheet</span><select aria-label="Step tile sheet" value={step.sheetId} onChange={event => patchStep({ sheetId: Number(event.target.value) })}>{doc.catalog.sheets.filter(sheet => sheet.id < 3).map(sheet => <option key={sheet.id} value={sheet.id} disabled={!sheet.path}>Sheet {sheet.id} · {sheet.path}</option>)}</select></label><label className="editor-field"><span>Frame delay</span><input aria-label="Step frame delay" type="number" min="0" max="63" value={Number.isFinite(step.delay) ? step.delay : ""} onChange={event => patchStep({ delay: event.target.value === "" ? NaN : Number(event.target.value) })} /></label></div>}
          <p className="help-text">Delay is an engine setting, not total duration. A zero delay does not guarantee an instantaneous frame.</p>
          <div className="graphics-controls"><button type="button" disabled={stepIndex === 0} onClick={() => { const next = values.steps.slice(); [next[stepIndex - 1], next[stepIndex]] = [next[stepIndex], next[stepIndex - 1]]; update({ ...values, steps: next }); setSelected(stepIndex - 1); }}>Move step earlier</button><button type="button" disabled={stepIndex === values.steps.length - 1} onClick={() => { const next = values.steps.slice(); [next[stepIndex + 1], next[stepIndex]] = [next[stepIndex], next[stepIndex + 1]]; update({ ...values, steps: next }); setSelected(stepIndex + 1); }}>Move step later</button><button type="button" disabled={values.steps.length >= 128} onClick={() => { const next = values.steps.slice(); next.splice(stepIndex + 1, 0, { ...step }); update({ ...values, steps: next }); setSelected(stepIndex + 1); }}>Duplicate step</button><button type="button" onClick={() => { update({ ...values, steps: values.steps.filter((_, i) => i !== stepIndex) }); setSelected(Math.max(0, stepIndex - 1)); }}>Remove step</button></div>
        </section>}
        {editing && <label className="graphics-shared"><input type="checkbox" checked={values.confirmShared} onChange={event => update({ ...values, confirmShared: event.target.checked })} /> Apply this sequence to every use of animation ID {doc.animationId}.{doc.catalog.moves.filter(move => move.animationId === doc.animationId).map(move => ` ${move.name}`).join(",")}</label>}
      </fieldset>
      <div className="graphics-controls"><button type="button" className="primary-action" disabled={!valid || !dirty || busy} onClick={() => void save()}>{editing ? "Save animation" : "Create animation"}</button><button type="button" disabled={busy} onClick={() => void revert()}>Reload composer sources</button></div>
      {preview && <details><summary>Inspect selected draft component</summary><StepInspector catalog={doc.catalog} script={synthetic} step={preview} /></details>}
    </>}
  </dialog>;
}
