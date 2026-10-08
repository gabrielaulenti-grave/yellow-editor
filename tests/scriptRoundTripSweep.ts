import { route1DialogueRoundTrips } from "./route1Dialogue";
import { npcCreationChecks } from "./npcCreation";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { loadMacroAnalysis } from "../src/core/macroCatalog";
import { readProjectRgbdsSources } from "../src/core/projectConstants";
import { loadProjectSemanticDomains } from "../src/core/semanticDomains";
import { loadProjectMovementVocabulary } from "../src/core/movementVocabulary";
import { deriveProjectEventMacroSemantics } from "../src/core/eventMacroSemantics";
import { runScriptRoundTripRegression, validateScriptSemanticRoundTrip } from "../src/core/scriptRoundTripValidation";
import { loadScriptMacroEditDocument, prepareScriptMacroCallWrite } from "../src/core/scriptMacroEditing";
import { SCRIPT_REGRESSION_FIXTURES } from "../src/core/scriptSemanticIr";
import {
  loadScriptSimpleActionCreateDocument,
  prepareScriptSimpleActionWrite,
  loadScriptEventConditionalCreateDocument,
  prepareScriptEventConditionalWrite,
} from "../src/core/scriptActionCreation";
import assert from "node:assert/strict";

for (const directory of process.argv.slice(2)) {
  const root = resolve(directory);
  async function listFiles(path = ""): Promise<string[]> {
    const entries = await readdir(resolve(root, path), { withFileTypes: true });
    return (await Promise.all(entries.filter((entry) => !entry.name.startsWith("."))
      .map((entry) => {
        const child = path ? `${path}/${entry.name}` : entry.name;
        return entry.isDirectory() ? listFiles(child) : [child];
      }))).flat();
  }
  const source = {
    readText: (path: string) => readFile(resolve(root, path), "utf8"),
    readBytes: async (path: string) => new Uint8Array(await readFile(resolve(root, path))),
    exists: async (path: string) => {
      try { await readFile(resolve(root, path)); return true; } catch { return false; }
    },
    listFiles,
  };
  await route1DialogueRoundTrips(source);
  await npcCreationChecks(source);
  console.log(`${root}: all 6 Route 1 dialogue leaves save/edit/reparse with source neighbors preserved`);
  const files = await readProjectRgbdsSources(source);
  const [analysis, movement] = await Promise.all([
    loadMacroAnalysis(source, loadProjectSemanticDomains(source, root), files),
    loadProjectMovementVocabulary(source, files),
  ]);
  const events = deriveProjectEventMacroSemantics(files);
  const fixturePaths = new Set(SCRIPT_REGRESSION_FIXTURES.flatMap((fixture) => fixture.paths));
  let unchangedSaves = 0;
  for (const file of files.filter((file) => fixturePaths.has(file.path))) {
    for (const call of analysis.callsByScriptPath.get(file.path)?.calls ?? []) {
      let document;
      try { document = await loadScriptMacroEditDocument(file.contents, file.path, call.line, analysis); } catch { continue; }
      const write = await prepareScriptMacroCallWrite(file.contents, file.path, call.line, call.name, document.sourceHash, document.arguments, analysis);
      assert.equal(write.contents, file.contents);
      validateScriptSemanticRoundTrip(file.contents, write.contents, call.line, movement, events);
      unchangedSaves++;
    }
  }
  const report = await runScriptRoundTripRegression(files, analysis, movement, events);
  console.log(`${root}: ${report.passedCaseCount} passed, ${report.refusedCaseCount} refused, ${report.failedCaseCount} failed (${report.testedCaseCount} candidates)`);
  console.log(`  ${unchangedSaves} unchanged saves passed; ${report.readOnlyArgumentCount} structural arguments kept read-only`);
  for (const fixture of report.fixtures) {
    console.log(`  ${fixture.label}: ${fixture.passedCaseCount} passed, ${fixture.refusedCaseCount} refused, ${fixture.failedCaseCount} failed, ${fixture.candidateShapeCount} parameter shapes`);
    for (const entry of fixture.cases.filter((entry) => !entry.passed && !entry.refused)) {
      console.log(`    ${entry.path}:${entry.line} ${entry.macroName}[${entry.argumentIndex}] ${entry.previousValue} -> ${entry.nextValue}: ${entry.error}`);
    }
  }
  if (process.env.SCRIPT_ROUND_TRIP_DIAGNOSTICS) {
    const groups = new Map<string, typeof report.fixtures[number]["cases"]>();
    for (const entry of report.fixtures.flatMap((fixture) => fixture.cases).filter((entry) => entry.refused)) {
      const key = `${entry.macroName}[${entry.argumentIndex}]`;
      groups.set(key, [...(groups.get(key) ?? []), entry]);
    }
    for (const [key, entries] of groups) {
      console.log(`${key}: ${entries.length} refusals`);
      for (const entry of entries.slice(0, 4)) console.log(JSON.stringify(entry));
    }
  }
  if (!report.passed) process.exitCode = 1;

  let builderPassed = 0;
  let builderFailed = 0;
  let eligibleRoutines = 0;
  for (const file of files.filter((file) => fixturePaths.has(file.path))) {
    const labels = [...file.contents.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*):{1,2}\s*(?:;[^\n]*)?$/gm)].map((match) => match[1]);
    for (const label of labels) {
      let document;
      try {
        document = await loadScriptSimpleActionCreateDocument(file.contents, file.path, label, analysis, movement, events);
      } catch { continue; } // Source structure must prove one straight-line insertion point.
      eligibleRoutines += 1;
      const lines = file.contents.split("\n");
      const offset = lines.slice(0, document.insertionLine - 1).reduce((sum, line) => sum + line.length + 1, 0);
      function preservedNeighbors(contents: string) {
        assert.equal(contents.slice(0, offset), file.contents.slice(0, offset));
        assert.ok(contents.endsWith(file.contents.slice(offset)));
      }
      for (const action of document.availableActions) {
        try {
          const event = action === "set-event" || action === "reset-event" ? document.eventOptions[action][0]?.value : undefined;
          const write = await prepareScriptSimpleActionWrite(file.contents, document, { action, event, frames: 7 }, analysis, movement, events);
          preservedNeighbors(write.contents);
          builderPassed += 1;
        } catch (error) {
          builderFailed += 1;
          console.log(`  Builder failure ${file.path}:${label} ${action}: ${error}`);
        }
      }
      let conditional;
      try {
        conditional = await loadScriptEventConditionalCreateDocument(file.contents, file.path, label, analysis, movement, events);
      } catch (error) {
        builderFailed += 1;
        console.log(`  Condition document failure ${file.path}:${label}: ${error}`);
        continue;
      }
      for (const action of conditional.availableActions) {
        try {
          const write = await prepareScriptEventConditionalWrite(file.contents, conditional, {
            event: conditional.eventOptions[0].value, action: { action, frames: 9 },
          }, analysis, movement, events);
          preservedNeighbors(write.contents);
          builderPassed += 1;
        } catch (error) {
          builderFailed += 1;
          console.log(`  Condition failure ${file.path}:${label} ${action}: ${error}`);
        }
      }
    }
  }
  console.log(`  Builders: ${builderPassed} passed, ${builderFailed} failed across ${eligibleRoutines} eligible routines`);
  if (builderFailed > 0 || eligibleRoutines === 0) process.exitCode = 1;
}
