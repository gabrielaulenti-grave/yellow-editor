import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ScriptsTab } from "../src/ScriptsTab";
import { attachTextEditing } from "../src/core/textEditing";
import { loadScriptCatalog, loadScriptDocument } from "../src/core/scriptCatalog";
import type { ProjectSession, ProjectSource, TextWriteRequest } from "../src/core/types";

const fixture = window as unknown as {
  dialogueFiles: Record<string, string>;
  dialogueInvoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
  dialogueSaves: TextWriteRequest[][];
  dialogueDirty: boolean;
};
fixture.dialogueSaves = [];
const source = {
  readText: async (path: string) => {
    if (!(path in fixture.dialogueFiles)) throw new Error(`Missing fixture: ${path}`);
    return fixture.dialogueFiles[path];
  },
  exists: async (path: string) => path in fixture.dialogueFiles,
  listFiles: async () => Object.keys(fixture.dialogueFiles),
} as ProjectSource;
const session = attachTextEditing({ saveTextChanges: async (_title: string, changes: TextWriteRequest[]) => {
  fixture.dialogueSaves.push(changes);
  for (const change of changes) fixture.dialogueFiles[change.path] = change.contents;
  return { canUndo: true, canRedo: false };
} } as ProjectSession, source);
fixture.dialogueInvoke = async (command, args) => {
  switch (command) {
    case "get_script_catalog": return loadScriptCatalog(source);
    case "get_script_document": return loadScriptDocument(source, args!.path as string);
    case "get_script_audit": return null;
    case "get_macro_catalog": return null;
    case "get_script_macro_calls": return { path: args!.path, calls: [] };
    case "get_text_leaf_documents": return session.getTextLeafDocuments(args!.path as string, args!.label as string);
    case "get_text_document": return session.getTextDocument(args!.path as string, args!.label as string);
    case "save_text_document": return session.saveTextDocument(args as never);
    default: throw new Error(`Unexpected dialogue UI command: ${command}`);
  }
};
const project = { path: "fixture", storageKey: "fixture", valid: true, projectName: "pokemon" };
const focus = { path: "scripts/ViridianCity.asm", routineLabel: "ViridianCitySignText" };
function Fixture() {
  const [version, setVersion] = useState(0);
  return <>
    <button onClick={() => setVersion(value => value + 1)}>Reload scripts</button>
    <ScriptsTab key={version} project={project} focus={focus} onDirtyChange={dirty => { fixture.dialogueDirty = dirty; }} />
  </>;
}
createRoot(window.document.getElementById("root")!).render(<Fixture />);
