import assert from "node:assert/strict";
import test from "node:test";
import { applyTextDocumentEdits, attachTextEditing, parseTextDocument, qualifiedTextLabel } from "../src/core/textEditing";
import { matchesSearch } from "../src/editor/search";
import type { ProjectSession, ProjectSource } from "../src/core/types";

function sessionFor(files: Record<string, string>) {
  return attachTextEditing({ saveTextChanges: async (_title: string, changes: { path: string; contents: string }[]) => {
    for (const change of changes) files[change.path] = change.contents;
    return {};
  } } as unknown as ProjectSession, {
    exists: async (path: string) => Object.prototype.hasOwnProperty.call(files, path),
    readText: async (path: string) => { if (!(path in files)) throw new Error("Missing file"); return files[path]; },
  } as ProjectSource);
}

test("local text leaves are scoped, including colonless labels and duplicate names", async () => {
  const source = 'First:\n\tld hl, .text\n\tcall PrintText\n\tret\n.text\n\ttext "First"\n\tdone\nSecond:\n\tld hl, .text\n\tcall PrintText\n\tret\n.text:\n\ttext "Second"\n\tdone\n';
  const session = sessionFor({ "scripts/Map.asm": source });
  assert.equal(qualifiedTextLabel(source, ".text", 2), "First.text");
  assert.equal(qualifiedTextLabel(source, ".text", 10), "Second.text");
  assert.equal(qualifiedTextLabel(source, ".text", 0), null);
  const first = await session.getTextLeafDocuments("scripts/Map.asm", "First");
  assert.deepEqual(first.map((doc) => [doc.label, doc.editable]), [["First.text", true]]);
  assert.equal((await session.getTextLeafDocuments("scripts/Map.asm", "Second"))[0].label, "Second.text");
  await assert.rejects(parseTextDocument("scripts/Map.asm", ".text", source), /more than once/);
  const changed = applyTextDocumentEdits(source, first[0].label, [{ control: "text", text: "Changed" }]);
  assert.equal(changed, source.replace('"First"', '"Changed"'));
  assert.equal((await parseTextDocument("scripts/Map.asm", "First.text", changed)).segments[0].text, "Changed");
});

test("wrapper calls and tail jumps resolve concrete leaves across companion files without rewriting code", async () => {
  const files = {
    "scripts/Map.asm": 'Npc:\n\ttext_asm\n\tfarcall Helper\n\tjp TextScriptEnd\n',
    "scripts/Map_2.asm": 'Helper::\n\tjp Choices\nChoices:\n\tld hl, .before\n\tcall PrintText\n\tjr nz, .done\n\tld hl, .after\n\tcall PrintText\n.done:\n\tret\n.before:\n\ttext "Same"\n\tdone\n.after:\n\ttext "Same"\n\tdone\n',
  };
  const session = sessionFor(files);
  const leaves = await session.getTextLeafDocuments("scripts/Map.asm", "Npc");
  assert.deepEqual(leaves.map((doc) => doc.label), ["Choices.before", "Choices.after"]);
  assert.equal((await session.getTextDocument("scripts/Map.asm", "Npc", "Same")).editable, false);
  const before = { ...files };
  await session.saveTextDocument({ ...leaves[1], segments: [{ control: "text", text: "After" }] });
  assert.equal(files["scripts/Map.asm"], before["scripts/Map.asm"]);
  assert.equal(files["scripts/Map_2.asm"], before["scripts/Map_2.asm"].replace('.after:\n\ttext "Same"', '.after:\n\ttext "After"'));
  await assert.rejects(session.saveTextDocument({ ...leaves[1], segments: [{ control: "text", text: "Again" }] }), /changed outside/);
});

test("cycles and unknown assembly stay read-only", async () => {
  const session = sessionFor({ "scripts/Map.asm": 'Loop:\n\tcall Loop\n\tret\nJump:\n\ttext_asm\n\tjr .text\n.text\n\ttext "Jumped"\n\tdone\nUnknown:\n\ttext "Hello"\n\tcustom_opcode\n\tdone\n' });
  assert.equal((await session.getTextLeafDocuments("scripts/Map.asm", "Loop"))[0].editable, false);
  assert.equal((await session.getTextLeafDocuments("scripts/Map.asm", "Jump"))[0].label, "Jump.text");
  assert.equal((await session.getTextLeafDocuments("scripts/Map.asm", "Unknown"))[0].editable, false);
});

test("dialogue saves replace only changed quoted payloads and preserve mixed newlines, escapes, spacing, and neighbors", async () => {
  const source = 'Leaf:: ; alias\r\n\ttext   "Hello; friend" ; comment\n\tline  "Bye@"\r\n\tdone\nNeighbor:\r\n\ttext "Untouched"\n\tdone';
  const document = await parseTextDocument("text/Map.asm", "Leaf", source);
  assert.equal(document.editable, true);
  assert.equal(applyTextDocumentEdits(source, "Leaf", document.segments), source);
  const segments = document.segments.map((segment, index) => ({ ...segment, text: index === 0 ? 'Say "hi"' : segment.text }));
  const changed = applyTextDocumentEdits(source, "Leaf", segments);
  assert.equal(changed, source.replace('Hello; friend', 'Say \\"hi\\"'));
  assert.deepEqual((await parseTextDocument("text/Map.asm", "Leaf", changed)).segments, segments);
  assert.throws(() => applyTextDocumentEdits(source, "Leaf", [{ control: "text", text: "Changed" }]), /changed structure/);
});

test("search finds related source labels despite spaces, underscores, case, and word order", () => {
  assert.equal(matchesSearch("route 22 rival", "Route22Rival1Script"), true);
  assert.equal(matchesSearch("rival 1st route22", "EVENT_1ST_ROUTE22_RIVAL_BATTLE"), true);
  assert.equal(matchesSearch("route22 rival", "Route22GateScript"), false);
  assert.equal(matchesSearch("", "Anything"), true);
});

test("structural Pokédex edits preserve the label separator and neighbors", async () => {
  const source = 'Dex:\n\ttext "Old"\r\n\tdex\r\nNeighbor:\n\ttext "Keep"\n\tdone';
  const segments = [{ control: "text" as const, text: "New" }, { control: "next" as const, text: "Row" }];
  const changed = applyTextDocumentEdits(source, "Dex", segments);
  assert.ok(changed.startsWith('Dex:\n'));
  assert.ok(changed.endsWith('Neighbor:\n\ttext "Keep"\n\tdone'));
  assert.deepEqual((await parseTextDocument("text/Map.asm", "Dex", changed)).segments, segments);
});
