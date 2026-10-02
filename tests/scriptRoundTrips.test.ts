import assert from "node:assert/strict";
import test from "node:test";
import { loadMacroAnalysis } from "../src/core/macroCatalog";
import { loadScriptMacroEditDocument, prepareScriptMacroCallWrite } from "../src/core/scriptMacroEditing";
import {
  ScriptRoundTripGuardError,
  validateScriptSemanticRoundTrip,
  runScriptRoundTripRegression,
} from "../src/core/scriptRoundTripValidation";
import {
  loadScriptSimpleActionCreateDocument,
  prepareScriptSimpleActionWrite,
  loadScriptEventConditionalCreateDocument,
  prepareScriptEventConditionalWrite,
} from "../src/core/scriptActionCreation";
import { parseMapScriptProgram } from "../src/core/mapScriptProgram";
import { structuredMapScriptFlow } from "../src/core/mapScriptControlFlow";
import { prepareTrainerRewardWrite } from "../src/core/trainerRewardEditing";
import type { ProjectEventMacroSemantic, ProjectMovementVocabulary } from "../src/core/types";

const movement: ProjectMovementVocabulary = {
  npcRanges: [], npcExactValues: [], joypadExactValues: [], exactValues: [],
  consumers: [], spriteStatuses: [], warnings: [],
};
const events: ProjectEventMacroSemantic[] = [
  { name: "MarkEvent", action: "set", eventParameterIndexes: [1], sourcePath: "macros/events.asm", sourceLine: 1 },
  { name: "ClearEvent", action: "reset", eventParameterIndexes: [1], sourcePath: "macros/events.asm", sourceLine: 4 },
  { name: "TestEvent", action: "check", eventParameterIndexes: [1], zeroMeaning: "event-clear", sourcePath: "macros/events.asm", sourceLine: 7 },
];
const macros = events.map((event) => `MACRO ${event.name}\n\tdb \\1\nENDM`).join("\n");
const domains = [{
  id: "events", label: "Events", kind: "constant-family" as const, sourcePath: null,
  options: ["EVENT_ALPHA", "EVENT_BETA"].map((value) => ({ value, label: value })),
}];
const path = "scripts/OaksLab.asm";
async function analysisFor(contents: string) {
  const files = [
    { path: "macros/events.asm", contents: macros },
    { path: "scripts/DomainExamples.asm", contents: events.map((event) => `\t${event.name} EVENT_ALPHA`).join("\n") },
    { path, contents },
  ];
  const analysis = await loadMacroAnalysis({} as never, { domains, warnings: [] }, files);
  return { analysis, files };
}
function lineOf(source: string, token: string) {
  return source.split(/\r?\n/).findIndex((line) => line.includes(token)) + 1;
}
function validate(before: string, after: string, token: string) {
  return validateScriptSemanticRoundTrip(before, after, lineOf(before, token), movement, events);
}
const routine = "Target:: ; routine comment\n\tld c, 2\n\tcall DelayFrames\n\tret ; append here\n\nNeighbor:\n\tMarkEvent EVENT_ALPHA ; keep me\n\tret\n";

for (const newline of ["\n", "\r\n"]) {
  test(`macro edit preserves indentation, comment, labels, blank arguments, and ${JSON.stringify(newline)}`, async () => {
    const source = ["Target:", "\tMarkEvent   EVENT_ALPHA  ; keep spacing", "\tret", "Neighbor:", "\tdb 1, , 3 ; keep blank argument", ""].join(newline);
    const { analysis } = await analysisFor(source);
    const doc = await loadScriptMacroEditDocument(source, path, 2, analysis);
    const write = await prepareScriptMacroCallWrite(source, path, 2, doc.macroName, doc.sourceHash, ["EVENT_BETA"], analysis);
    assert.equal(write.contents, source.replace("MarkEvent   EVENT_ALPHA", "MarkEvent   EVENT_BETA"));
    const checked = validate(source, write.contents, "MarkEvent");
    assert.deepEqual(checked.beforeShapes, ["event:set"]);
    assert.deepEqual(checked.afterShapes, checked.beforeShapes);
  });
}

test("macro writer rejects stale files, argument insertion, and out-of-domain tokens", async () => {
  const source = "Target:\n\tMarkEvent EVENT_ALPHA\n\tret\n";
  const { analysis } = await analysisFor(source);
  const doc = await loadScriptMacroEditDocument(source, path, 2, analysis);
  const write = (input: string, args: string[]) => prepareScriptMacroCallWrite(input, path, 2, doc.macroName, doc.sourceHash, args, analysis);
  await assert.rejects(write(source + "; newer edit\n", ["EVENT_BETA"]), /changed after/);
  await assert.rejects(write(source, ["EVENT_BETA", "EVENT_ALPHA"]), /add or remove/);
  await assert.rejects(write(source, ["EVENT_BETA ; injection"]), /domain intersection/);
});

test("guard rejects same-family changes to neighboring source and line endings", () => {
  const source = "Target:\n\tMarkEvent EVENT_ALPHA\n\tret\nNeighbor:\n\tMarkEvent EVENT_ALPHA\n\tret\n";
  assert.throws(() => validate(source, source.replace("Neighbor:\n\tMarkEvent EVENT_ALPHA", "Neighbor:\n\tMarkEvent EVENT_BETA"), "MarkEvent"), /neighboring bytes/);
  assert.throws(() => validate(source, source.replaceAll("\n", "\r\n"), "MarkEvent"), /line endings/);
  assert.throws(() => validate(source, source + "; damaged neighbor\n", "MarkEvent"), (error) =>
    error instanceof ScriptRoundTripGuardError && error.reason === "source-preservation"
  );
});

test("multiple token replacements preserve blank slots, nested expressions, quoted commas and semicolons", async () => {
  const source = 'Target:\n\tMix  EVENT_ALPHA , , "a,b;quoted", (1 + (2 * 3)), EVENT_ALPHA ; untouched\n\tret\n';
  const { files } = await analysisFor(source);
  const definition = { path: "macros/mix.asm", contents: "MACRO Mix\n\tdb \\1, \\2, \\3, \\4, \\5\nENDM\n" };
  const analysis = await loadMacroAnalysis({} as never, { domains, warnings: [] }, [...files, definition]);
  const doc = await loadScriptMacroEditDocument(source, path, 2, analysis);
  assert.deepEqual(doc.arguments, ["EVENT_ALPHA", "", '"a,b;quoted"', "(1 + (2 * 3))", "EVENT_ALPHA"]);
  const args = [...doc.arguments];
  args[0] = args[4] = "EVENT_BETA";
  const write = await prepareScriptMacroCallWrite(source, path, 2, doc.macroName, doc.sourceHash, args, analysis);
  assert.equal(write.contents, source.replaceAll("EVENT_ALPHA", "EVENT_BETA"));
  assert.doesNotThrow(() => validate(source, write.contents, "Mix"));
});

test("helper routines outside the state table retain their IR family", () => {
  const source = "Helper:\n\tMarkEvent EVENT_ALPHA\n\tret\n";
  assert.throws(() => validate(source, source.replace("MarkEvent", "ClearEvent"), "MarkEvent"), ScriptRoundTripGuardError);
  const unknown = "Helper:\n\tUnknownMacro EVENT_ALPHA\n\tret\n";
  assert.throws(() => validate(unknown, unknown.replace("UnknownMacro", "MarkEvent"), "UnknownMacro"), ScriptRoundTripGuardError);
});

test("state table retargeting is a safety refusal", () => {
  const source = "Table:\n\tdw_const Target, SCRIPT_TARGET\nTarget:\n\tret\nOther:\n\tret\n";
  assert.throws(() => validate(source, source.replace("dw_const Target", "dw_const Other"), "dw_const"), /states or transitions/);
});

test("executable text edits preserve reward, choice, and failure branches", () => {
  const source = "RewardText:\n\ttext_asm\n\tcall YesNoChoice\n\tjr nz, .done\n\tlb bc, POTION, 1\n\tcall GiveItem\n\tjr nc, .done\n.done:\n\tjp TextScriptEnd\n";
  assert.doesNotThrow(() => validate(source, source.replace("POTION, 1", "SUPER_POTION, 2"), "lb bc"));
  assert.throws(() => validate(source, source.replace("call GiveItem", "call RemoveItemFromInventory"), "call GiveItem"), ScriptRoundTripGuardError);
});

for (const newline of ["\n", "\r\n", "mixed"]) {
  test(`production trainer reward writer preserves source neighbors (${JSON.stringify(newline)})`, async () => {
    const text = "RewardText:\n\ttext_asm\n\tlb  bc, POTION , $01  ; reward comment\n\tcall GiveItem\n\tjr nc, .done\n.done:\n\tjp TextScriptEnd\nOther:\n\tdb 3\n";
    const contents = newline === "mixed" ? text.replace("RewardText:\n", "RewardText:\r\n") : text.replaceAll("\n", newline);
    const projectFiles = new Map([
      [path, contents],
      ["constants/item_constants.asm", "\tconst POTION\n\tconst SUPER_POTION\nDEF NUM_ITEMS EQU 2\n"],
    ]);
    const source = {
      readText: async (name: string) => projectFiles.get(name)!,
      exists: async (name: string) => projectFiles.has(name),
    };
    const write = await prepareTrainerRewardWrite(source as never, path, 3, "SUPER_POTION", 2);
    assert.equal(write.contents, contents.replace("POTION , $01", "SUPER_POTION , 2"));
    assert.doesNotThrow(() => validate(contents, write.contents, "lb  bc"));
  });
}

for (const ending of ["lf", "crlf", "mixed", "no-final-newline"]) {
  const source = ending === "crlf" ? routine.replaceAll("\n", "\r\n")
    : ending === "mixed" ? routine.replace("Target:: ; routine comment\n", "Target:: ; routine comment\r\n")
    : ending === "no-final-newline" ? routine.trimEnd() : routine;
  for (const action of ["wait", "heal-party", "set-event", "reset-event"] as const) {
    test(`generated ${action} preserves neighbors (${ending})`, async () => {
      const { analysis } = await analysisFor(source);
      const doc = await loadScriptSimpleActionCreateDocument(source, path, "Target", analysis, movement, events);
      const values = { action, frames: 7, event: "EVENT_BETA" };
      const write = await prepareScriptSimpleActionWrite(source, doc, values, analysis, movement, events);
      const newline = ending === "crlf" ? "\r\n" : "\n";
      const generated = action === "wait" ? `\tld c, 7${newline}\tcall DelayFrames${newline}`
        : action === "heal-party" ? `\tpredef HealParty${newline}`
        : `\t${action === "set-event" ? "MarkEvent" : "ClearEvent"} EVENT_BETA${newline}`;
      assert.equal(write.contents, source.replace("\tret ; append here", generated + "\tret ; append here"));
      assert.equal(write.expectedHash, doc.sourceHash);
      const target = parseMapScriptProgram(write.contents, "Target", movement, events).states.find((state) => state.label === "Target")!;
      assert.equal(target.nodes.length, 2);
    });
  }
  for (const action of ["wait", "heal-party"] as const) {
    test(`event conditional ${action} reparses as the intended branch (${ending})`, async () => {
      const { analysis } = await analysisFor(source);
      const doc = await loadScriptEventConditionalCreateDocument(source, path, "Target", analysis, movement, events);
      const write = await prepareScriptEventConditionalWrite(source, doc, { event: "EVENT_ALPHA", action: { action, frames: 9 } }, analysis, movement, events);
      const beforeRet = source.indexOf("\tret ; append here");
      assert.equal(write.contents.slice(0, beforeRet), source.slice(0, beforeRet));
      assert.ok(write.contents.endsWith(source.slice(beforeRet)));
      const target = parseMapScriptProgram(write.contents, "Target", movement, events).states.find((state) => state.label === "Target")!;
      const branch = structuredMapScriptFlow(target, write.contents, events).find((item) => item.type === "if")!;
      assert.equal(branch.type, "if");
      if (branch.type === "if") {
        assert.deepEqual(branch.condition, { type: "event-state", event: "EVENT_ALPHA", state: "set", afterCheck: undefined });
        assert.equal(branch.whenTrue.items.length, 1);
        assert.equal(branch.whenFalse.items.length, 0);
      }
    });
  }
}

test("builders refuse ambiguous routines, stale files, and invalid durations", async () => {
  const { analysis } = await analysisFor(routine);
  for (const source of ["Target:\n.local:\n\tret\n", "Target:\n\tret z\n\tret\n", "Target:\n\tjp Other\n\tret\n", "Target:\n\tnop\n"]) {
    await assert.rejects(loadScriptSimpleActionCreateDocument(source, path, "Target", analysis, movement, events));
  }
  const doc = await loadScriptSimpleActionCreateDocument(routine, path, "Target", analysis, movement, events);
  await assert.rejects(prepareScriptSimpleActionWrite(routine + "; new\n", doc, { action: "wait", frames: 7 }, analysis, movement, events), /changed after/);
  for (const frames of [0, 256, 1.5]) {
    await assert.rejects(prepareScriptSimpleActionWrite(routine, doc, { action: "wait", frames }, analysis, movement, events), /1 to 255/);
  }
});

test("conditional builder accepts a proven one-argument check with an optional output mode", async () => {
  const { files } = await analysisFor(routine);
  const optional = files.map((file) => file.path === "macros/events.asm" ? {
    ...file, contents: file.contents.replace("MACRO TestEvent\n\tdb \\1\nENDM", "MACRO TestEvent\n\tdb \\1\n\tIF _NARG > 1\n\t\tdb \\2\n\tENDC\nENDM"),
  } : file);
  optional.push({ path: "scripts/CarryCheck.asm", contents: "\tTestEvent EVENT_ALPHA, 1\n" });
  const analysis = await loadMacroAnalysis({} as never, { domains, warnings: [] }, optional);
  const definition = analysis.catalog.macros.find((macro) => macro.name === "TestEvent")!;
  assert.equal(definition.parameters.length, 2);
  assert.equal(definition.parameters[1].required, false);
  const doc = await loadScriptEventConditionalCreateDocument(routine, path, "Target", analysis, movement, events);
  const write = await prepareScriptEventConditionalWrite(routine, doc, { event: "EVENT_BETA", action: { action: "wait", frames: 4 } }, analysis, movement, events);
  assert.ok(write.contents.includes("\tTestEvent EVENT_BETA\n\tjr nz,"));

  // Removing every observed one-argument form makes the extra argument required.
  const required = optional.map((file) => file.path === "scripts/DomainExamples.asm"
    ? { ...file, contents: file.contents.replace("TestEvent EVENT_ALPHA", "TestEvent EVENT_ALPHA, 1") } : file);
  const requiredAnalysis = await loadMacroAnalysis({} as never, { domains, warnings: [] }, required);
  await assert.rejects(loadScriptEventConditionalCreateDocument(routine, path, "Target", requiredAnalysis, movement, events), /could not prove/);
});

test("regression sweep covers late call sites and distinguishes behavior refusals", async () => {
  const source = "Table:\n\tdw_const Target, SCRIPT_TARGET\nTarget:\n" + Array.from({ length: 15 }, () => "\tMarkEvent EVENT_ALPHA\n").join("") + "\tret\n";
  const { analysis, files } = await analysisFor(source);
  const report = await runScriptRoundTripRegression(files, analysis, movement, events);
  assert.equal(report.passedCaseCount, 15);
  assert.equal(report.failedCaseCount, 0);
  assert.ok(report.fixtures[0].cases.some((entry) => entry.line > 12));
  assert.equal(report.fixtures[0].candidateShapeCount, 1);
});

test("regression report records state-table safety refusals separately from broken round trips", async () => {
  const source = "Table:\n\tdw_const Target, SCRIPT_TARGET\nTarget:\n\tMarkEvent EVENT_ALPHA\n\tret\nOther:\n\tret\n";
  const { files } = await analysisFor(source);
  const definitions = { path: "macros/tables.asm", contents: "MACRO dw_const\n\tdw \\1\n\tDEF \\2 EQU 0\nENDM\n" };
  const withTable = await loadMacroAnalysis({} as never, { domains, warnings: [] }, [...files, definitions]);
  const report = await runScriptRoundTripRegression([...files, definitions], withTable, movement, events);
  assert.equal(report.passedCaseCount, 1);
  assert.ok(report.refusedCaseCount > 0);
  assert.equal(report.failedCaseCount, 0);
  assert.equal(report.passed, true);
  assert.ok(report.fixtures[0].cases.find((entry) => entry.macroName === "dw_const")?.refused);
});
