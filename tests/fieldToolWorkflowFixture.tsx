import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { AddItemWizard } from "../src/AddItemWizard";
import { FieldToolEditor, fieldToolError } from "../src/FieldToolEditor";
import { loadItemCreateDocument, prepareItemCreateWrites } from "../src/core/itemCreation";
import { loadItemEditDocument, prepareItemEditWrites } from "../src/core/itemEditing";
import { createProjectHistoryManager } from "../src/core/history";
import type { ItemCreateDocument, ItemCreateValues, ItemEditDocument, ItemEditValues, ProjectSource, HistoryState } from "../src/core/types";

declare global { interface Window { fieldFiles: Record<string, string>; fieldDocument: ItemCreateDocument; fieldReadItem(): Promise<ItemEditDocument>; fieldUndo(): Promise<void>; fieldRedo(): Promise<void> } }
const files = window.fieldFiles; let state: HistoryState | null = null;
const source: ProjectSource = { listFiles: async () => Object.keys(files), exists: async p => p in files, readText: async p => { if (!(p in files)) throw new Error("Missing " + p); return files[p]; }, readBytes: async p => new TextEncoder().encode(files[p]), writeText: async (p, s) => { files[p] = s; }, historyStore: { persistent: true, load: async () => state, save: async s => { state = structuredClone(s); } } };
const history = createProjectHistoryManager(source); let id = 0;
function Fixture() {
  const [document, setDocument] = useState<ItemCreateDocument | null>(null), [edit, setEdit] = useState<ItemEditDocument | null>(null), [draft, setDraft] = useState<ItemEditValues | null>(null), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  async function reload() { const d = await loadItemEditDocument(source, id); setEdit(d); setDraft({ ...d }); }
  window.fieldReadItem = () => loadItemEditDocument(source, id);
  window.fieldUndo = async () => { await (await history).undo(); await reload(); };
  window.fieldRedo = async () => { await (await history).redo(); await reload(); };
  useEffect(() => { void loadItemCreateDocument(source).then(d => { window.fieldDocument = d; setDocument(d); }).catch(e => setError(String(e))); }, []);
  async function create(values: ItemCreateValues) { setBusy(true); try { await (await history).save("Create field item", await prepareItemCreateWrites(source, document!, values)); id = values.slotId; setDocument(null); await reload(); } catch (e) { setError(String(e)); } finally { setBusy(false); } }
  async function save() { if (!edit || !draft) return; setBusy(true); try { await (await history).save("Edit field item", await prepareItemEditWrites(source, edit, draft)); await reload(); } catch (e) { setError(String(e)); } finally { setBusy(false); } }
  return <main>{error && <p role="alert">{error}</p>}{document && <AddItemWizard document={document} busy={busy} error={error} onCreate={v => void create(v)} onCancel={() => setDocument(null)} />}{edit && draft?.fieldTool && <section><h2>{edit.name}</h2><FieldToolEditor value={draft.fieldTool} support={edit.fieldToolSupport} disabled={busy} onChange={fieldTool => setDraft({ ...draft, fieldTool })} /><button disabled={busy || Boolean(fieldToolError(draft.fieldTool, edit.fieldToolSupport))} onClick={() => void save()}>Save field tool</button><button onClick={() => void reload()}>Reload field tool</button></section>}</main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
