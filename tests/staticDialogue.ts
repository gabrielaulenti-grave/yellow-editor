import assert from "node:assert/strict";
import { applyTextDocumentEdits, attachTextEditing, parseTextDocument, scriptTextEntryKind } from "../src/core/textEditing";
import { parseMapScriptRoutines } from "../src/core/mapScriptParser";
import type { ProjectSession, ProjectSource } from "../src/core/types";

// Sweep the game's simplest dialogue wrappers, which the macro/CPU sweeps do
// not exercise through the text reader. Unmeasurable runtime inserts remain
// explicitly read-only; every ordinary quoted leaf must support a word edit.
export async function staticDialogueRoundTrips(source: ProjectSource) {
  const session = attachTextEditing({} as ProjectSession, source);
  const edited = new Map<string, string>();
  // Yellow deliberately wraps these same static signs in far-called assembly
  // helpers. Exercise those through the production resolver too.
  for (const label of ["ViridianCitySignText", "ViridianCityTrainerTips1Text", "ViridianCityTrainerTips2Text", "ViridianCityGymSignText"]) {
    const [leaf] = await session.getTextLeafDocuments("scripts/ViridianCity.asm", label);
    assert.ok(leaf?.editable, `${label}: static sign did not resolve safely`);
    const original = edited.get(leaf.path) ?? await source.readText(leaf.path);
    edited.set(leaf.path, applyTextDocumentEdits(original, leaf.label, leaf.segments.map((segment, index) =>
      ({ ...segment, text: index === 0 ? "Hello!" : segment.text }))));
  }
  let wrappers = 0, passed = 0, readOnly = 0;
  for (const path of (await source.listFiles!()).filter(path => /^scripts\/.+\.asm$/i.test(path))) {
    const contents = await source.readText(path);
    const lines = contents.split(/\r?\n/);
    const routines = parseMapScriptRoutines(contents);
    for (const [index, routine] of routines.entries()) {
      const body = lines.slice(routine.startLine, (routines[index + 1]?.startLine ?? lines.length + 1) - 1)
        .map(line => line.split(";", 1)[0].trim()).filter(Boolean);
      if (body.length !== 2 || !/^text_far\s+[A-Za-z_][A-Za-z0-9_]*$/.test(body[0]) || body[1] !== "text_end") continue;
      wrappers++;
      assert.equal(scriptTextEntryKind(contents, routine.label), "text");
      const leaves = await session.getTextLeafDocuments(path, routine.label);
      assert.equal(leaves.length, 1, `${path}:${routine.label}: unresolved ordinary wrapper`);
      const leaf = leaves[0];
      if (!leaf.editable) {
        readOnly++;
        console.log(`  Read-only runtime text: ${leaf.path}:${leaf.label} (${leaf.warnings.join("; ")})`);
        continue;
      }
      const original = await source.readText(leaf.path);
      try {
        assert.equal(applyTextDocumentEdits(original, leaf.label, leaf.segments), original, `${leaf.label}: no-change save`);
      } catch (error) { throw new Error(`${leaf.path}:${leaf.label}: ${error}`); }
      const segments = leaf.segments.map((segment, i) => ({ ...segment, text: i === 0 ? "Hello!" : segment.text }));
      const rewritten = applyTextDocumentEdits(original, leaf.label, segments);
      const reparsed = await parseTextDocument(leaf.path, leaf.label, rewritten);
      assert.ok(reparsed.editable, `${leaf.label}: no longer editable`);
      assert.deepEqual(reparsed.segments, segments);
      assert.deepEqual(reparsed.displayParts, leaf.displayParts);
      assert.equal(reparsed.terminator, leaf.terminator);
      assert.equal(applyTextDocumentEdits(rewritten, leaf.label, leaf.segments), original, `${leaf.label}: neighbor bytes changed`);
      passed++;
      // Also build a ROM with these five real Viridian signs edited together.
      if (path === "scripts/ViridianCity.asm" && /(?:SignText|TrainerTips[12]Text)$/.test(routine.label)) {
        edited.set(leaf.path, applyTextDocumentEdits(edited.get(leaf.path) ?? original, leaf.label, segments));
      }
    }
  }
  assert.ok(wrappers > 100 && passed > 100, "Expected a full vanilla static-dialogue sweep");
  assert.ok([...edited.keys()].includes("text/ViridianCity.asm"), "Viridian signs were not tested");
  console.log(`  Static dialogue: ${wrappers} wrappers resolved; ${passed} no-change/edit/reparse checks passed; ${readOnly} runtime leaves kept read-only`);
  return edited;
}
