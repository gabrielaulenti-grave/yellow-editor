import { useEffect, useRef, useState, type ReactNode } from "react";
import type { HistorySummary, MapNpcCreateDocument, MapNpcCreateValues } from "./core/types";
import { npcDialogueSegments } from "./core/npcCreation";
import { textLineLengthError } from "./core/textEditing";
import { SearchableSelect } from "./editor/SearchableSelect";
import { invoke } from "./platform/compat";
import "./MapNpcWizard.css";

const nameOf = (value: string) => value.replace(/^SPRITE_/, "").toLowerCase().replace(/_/g, " ");

export function MapNpcWizard({ mapConstant, renderPlacement, onClose, onSaved }: {
  mapConstant: string;
  renderPlacement(x: number, y: number, onPlace: (x: number, y: number) => void): ReactNode;
  onClose(): void;
  onSaved(objectId: number, history: HistorySummary): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [document, setDocument] = useState<MapNpcCreateDocument | null>(null);
  const [step, setStep] = useState(0);
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const [sprite, setSprite] = useState("");
  const [movement, setMovement] = useState<"STAY" | "WALK">("STAY");
  const [direction, setDirection] = useState("DOWN");
  const [kind, setKind] = useState<"new" | "existing">("new");
  const [textLines, setTextLines] = useState([""]);
  const [existingId, setExistingId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
    let cancelled = false;
    void invoke<MapNpcCreateDocument>("get_map_npc_create_document", { mapConstant }).then(next => {
      if (cancelled) return;
      setDocument(next);
      setSprite(next.sprites.find(value => value === "SPRITE_YOUNGSTER") ?? next.sprites[0]);
      setExistingId(next.dialogueOptions[0]?.id ?? "");
      for (let row = 0; row < next.height; row++) {
        let found = false;
        for (let col = 0; col < next.width; col++) {
          if (!next.occupied.some(point => point.x === col && point.y === row)) {
            setX(col); setY(row); found = true; break;
          }
        }
        if (found) break;
      }
    }).catch(reason => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
  }, [mapConstant]);
  function close() {
    if (!saving && (!dirty || window.confirm("Discard this unsaved NPC?"))) onClose();
  }
  const placementError = !document ? null : !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= Math.min(document.width, 252) || y >= Math.min(document.height, 252)
    ? "Choose a position inside the map."
    : document.occupied.some(point => point.x === x && point.y === y) ? "This position contains an object or warp." : null;
  const segments = npcDialogueSegments(textLines);
  const textError = kind === "existing" ? !existingId ? "Choose dialogue." : null
    : segments.map((segment, i) => textLineLengthError(segment.text, i === 0 ? 18 : 17)).find(Boolean)
      ?? (!textLines.some(line => line.trim()) ? "Enter dialogue for this NPC." : null);
  const chosen = document?.dialogueOptions.find(option => option.id === existingId);
  async function save() {
    if (!document || placementError || textError) return;
    setSaving(true); setError(null);
    const values: MapNpcCreateValues = {
      x, y, sprite, movement, direction,
      dialogue: kind === "new" ? { kind, lines: textLines } : { kind, id: existingId },
    };
    try {
      const history = await invoke<HistorySummary>("create_map_npc", { document, values });
      onSaved(document.objectId, history);
    } catch (reason) { setError(String(reason)); setSaving(false); }
  }
  return <dialog ref={dialog} className="wizard-dialog npc-create-dialog" aria-labelledby="npc-create-title"
    onCancel={event => { event.preventDefault(); close(); }}>
    <div className="wizard-heading">
      <div><h2 id="npc-create-title">Add NPC{document ? ` to ${document.mapName}` : ""}</h2>
        <p>Place a character and give them dialogue.</p></div>
      <button type="button" onClick={close} disabled={saving} aria-label="Close Add NPC">×</button>
    </div>
    {error && <p role="alert" className="npc-create-error">{error}</p>}
    {!document ? <p role="status">{error ? "NPC creation is unavailable for this map." : "Checking map and sprite compatibility…"}</p> : <>
      <div className="wizard-steps">{["Placement", "Dialogue", "Review"].map((name, i) => <span key={name} className={i === step ? "active" : i < step ? "complete" : ""}>{i + 1}. {name}</span>)}</div>
      <fieldset disabled={saving} className="npc-create-fields" onChange={() => { setDirty(true); setError(null); }}>
        {step === 0 && <div className="wizard-page">
          <p>Click or tap walkable ground to place the NPC. Coordinates start at (0, 0) in the top-left corner.</p>
          {renderPlacement(x, y, (col, row) => { setX(col); setY(row); setDirty(true); })}
          <div className="npc-create-grid">
            <label>X<input type="number" value={Number.isNaN(x) ? "" : x} min={0} max={Math.min(document.width - 1, 251)} onChange={event => setX(event.target.valueAsNumber)} /></label>
            <label>Y<input type="number" value={Number.isNaN(y) ? "" : y} min={0} max={Math.min(document.height - 1, 251)} onChange={event => setY(event.target.valueAsNumber)} /></label>
          </div>
          <small>Map grid: {document.width} × {document.height}</small>
          <label>Character<SearchableSelect aria-label="Character" value={sprite} onChange={event => setSprite(event.target.value)}>{document.sprites.map(value => <option key={value} value={value}>{nameOf(value)}</option>)}</SearchableSelect></label>
          <small>{document.spriteNote}</small>
          <div className="npc-create-grid">
            <label>Movement<select aria-label="Movement" value={movement} onChange={event => { const next = event.target.value as "STAY" | "WALK"; setMovement(next); setDirection(next === "STAY" ? "DOWN" : "ANY_DIR"); }}><option value="STAY">Stay in place</option><option value="WALK">Wander</option></select></label>
            <label>{movement === "STAY" ? "Facing" : "Wandering"}<select aria-label={movement === "STAY" ? "Facing" : "Wandering"} value={direction} onChange={event => setDirection(event.target.value)}>{(movement === "STAY" ? ["DOWN", "UP", "LEFT", "RIGHT"] : ["ANY_DIR", "UP_DOWN", "LEFT_RIGHT"]).map(value => <option key={value} value={value}>{({ ANY_DIR: "Any direction", UP_DOWN: "Up and down", LEFT_RIGHT: "Left and right" } as Record<string, string>)[value] ?? value.toLowerCase()}</option>)}</select></label>
          </div>
          {placementError && <p role="alert">{placementError}</p>}
        </div>}
        {step === 1 && <div className="wizard-page">
          <label>Dialogue<select aria-label="Dialogue" value={kind} onChange={event => setKind(event.target.value as "new" | "existing")}><option value="new">Write new dialogue</option><option value="existing" disabled={!document.dialogueOptions.length}>Reuse existing dialogue</option></select></label>
          {kind === "existing" ? <>
            <label>Existing dialogue<SearchableSelect aria-label="Existing dialogue" value={existingId} onChange={event => setExistingId(event.target.value)}>{document.dialogueOptions.map(option => <option key={option.id} value={option.id}>{option.label} — {option.preview.replace(/\n/g, " ")}</option>)}</SearchableSelect></label>
            <pre className="npc-dialogue-preview">{chosen?.preview}</pre>
            <small>Only plain dialogue is reusable here. Editing shared dialogue also updates its other users.</small>
          </> : <>
            <small>18 characters on the first row, 17 on following rows. Extra rows scroll when the player advances.</small>
            {textLines.map((line, i) => <label key={i}>Line {i + 1}<input value={line} onChange={event => setTextLines(current => current.map((value, index) => index === i ? event.target.value : value))} /></label>)}
            <div className="npc-create-grid"><button type="button" disabled={textLines.length >= 16} onClick={() => { setDirty(true); setTextLines(current => [...current, ""]); }}>Add line</button><button type="button" disabled={textLines.length <= 1} onClick={() => { setDirty(true); setTextLines(current => current.slice(0, -1)); }}>Remove last line</button></div>
          </>}
          {textError && <p role="alert">{textError}</p>}
        </div>}
        {step === 2 && <div className="wizard-page">
          <p><strong>{nameOf(sprite)}</strong> at ({x}, {y}), {movement === "STAY" ? `facing ${direction.toLowerCase()}` : `wandering ${direction === "ANY_DIR" ? "in any direction" : direction.toLowerCase().replace(/_/g, " ")}`}.</p>
          <pre className="npc-dialogue-preview">{kind === "new" ? textLines.join("\n") : chosen?.preview}</pre>
          <p>Creates NPC #{document.objectId}. Placement and dialogue save together and can be undone together.</p>
          <small>You can edit the dialogue from this NPC's map inspector after saving.</small>
        </div>}
      </fieldset>
      <div className="wizard-actions">
        <button type="button" disabled={saving} onClick={step === 0 ? close : () => setStep(step - 1)}>{step === 0 ? "Cancel" : "Back"}</button>
        {step < 2 ? <button type="button" className="primary-button" disabled={saving || Boolean(step === 0 ? placementError : textError)} onClick={() => setStep(step + 1)}>Next</button>
          : <button type="button" className="primary-button" disabled={saving || Boolean(placementError || textError)} onClick={() => void save()}>{saving ? "Saving…" : "Create NPC"}</button>}
      </div>
    </>}
  </dialog>;
}
