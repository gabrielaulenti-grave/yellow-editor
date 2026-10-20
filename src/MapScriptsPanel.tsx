import { useCallback, useMemo, useRef, useState } from "react";
import { ScriptsTab } from "./ScriptsTab";
import type { ProjectInfo } from "./core/types";

export function MapScriptsPanel({ project, path, label, onClose, onDirtyChange }: {
  project: ProjectInfo | null; path: string; label?: string | null; onClose(): void; onDirtyChange?(dirty: boolean): void;
}) {
  const dirty = useRef(false);
  const callback = useRef(onDirtyChange); callback.current = onDirtyChange;
  const changed = useCallback((value: boolean) => { dirty.current = value; callback.current?.(value); }, []);
  const focus = useMemo(() => ({ path, routineLabel: label }), [path, label]);
  const [busy, setBusy] = useState(false);
  return <div className="text-editor-backdrop"><section className="text-editor-dialog map-scripts-dialog" role="dialog" aria-modal="true" aria-label="Map logic">
    <div className="text-editor-dialog-heading"><h3>Map logic</h3><button type="button" className="small-button" disabled={busy} onClick={() => {
      if (dirty.current) { setBusy(true); if (!window.confirm("Discard the unsaved script changes? Interaction drafts remain on this device.")) { setBusy(false); return; } }
      onClose();
    }}>Close map logic</button></div>
    <ScriptsTab project={project} mapContext focus={focus} onDirtyChange={changed} />
  </section></div>;
}
