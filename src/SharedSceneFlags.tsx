import { useState } from "react";
import { sharedSceneFlag, type SharedSceneFlag } from "./core/sceneFlags";

export function SharedSceneFlags({ flags, busy, onCreate }: { flags: SharedSceneFlag[]; busy: boolean; onCreate(flag: SharedSceneFlag): void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  return <fieldset className="shared-scene-flags"><legend>Shared scene flags</legend>
    <p className="help-text">Remember progress across NPCs, objects and maps. New flags are saved with this interaction and then become available to other interactions. Use Branch on event and Change event to read or change them.</p>
    {flags.length > 0 && <ul>{flags.map(flag => <li key={flag.event}>{flag.label}</li>)}</ul>}
    <label>New shared flag name<input aria-label="New shared flag name" disabled={busy} value={name} maxLength={48} onChange={e => setName(e.target.value)} /></label>
    <button type="button" className="small-button" disabled={busy || !name.trim()} onClick={() => {
      try {
        const flag = sharedSceneFlag(name);
        if (flags.some(old => old.event === flag.event)) throw new Error("A shared flag with that name already exists.");
        onCreate(flag); setName(""); setError(undefined);
      } catch (error) { setError(String(error)); }
    }}>Add shared flag</button>
    {error && <p role="alert">{error}</p>}
  </fieldset>;
}
