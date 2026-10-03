import assert from "node:assert/strict";
import { applyTextDocumentEdits, attachTextEditing, parseTextDocument } from "../src/core/textEditing";
import type { ProjectSession, ProjectSource } from "../src/core/types";

// Exercise the production resolver and writer against each game's actual NPC and sign wrappers.
export async function route1DialogueRoundTrips(source: ProjectSource): Promise<Map<string, string>> {
  const session = attachTextEditing({} as ProjectSession, source);
  const edited = new Map<string, string>();
  for (const [label, count] of [["Route1Youngster1Text", 4], ["Route1Youngster2Text", 1], ["Route1SignText", 1]] as const) {
    const leaves = await session.getTextLeafDocuments("scripts/Route1.asm", label);
    assert.equal(leaves.length, count, `${label}: missing a dialogue path`);
    for (const leaf of leaves) {
      assert.ok(leaf.editable, `${leaf.label}: ${leaf.warnings.join("; ")}`);
      const original = await source.readText(leaf.path);
      assert.equal(applyTextDocumentEdits(original, leaf.label, leaf.segments), original);
      const contents = edited.get(leaf.path) ?? original;
      const segments = leaf.segments.map((segment, index) => ({ ...segment, text: index === 0 ? "Hello!" : segment.text }));
      const rewritten = applyTextDocumentEdits(contents, leaf.label, segments);
      const reparsed = await parseTextDocument(leaf.path, leaf.label, rewritten);
      assert.ok(reparsed.editable);
      assert.deepEqual(reparsed.segments, segments);
      assert.deepEqual(reparsed.displayParts, leaf.displayParts);
      assert.equal(reparsed.terminator, leaf.terminator);
      // Restoring this leaf must recover every neighboring byte, including earlier edits.
      assert.equal(applyTextDocumentEdits(rewritten, leaf.label, leaf.segments), contents);
      edited.set(leaf.path, rewritten);
    }
  }
  assert.deepEqual([...edited.keys()], ["text/Route1.asm"]);
  return edited;
}
