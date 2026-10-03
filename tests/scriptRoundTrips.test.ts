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
import { editableScriptMacroArguments } from "../src/core/scriptMacroEligibility";
import { analyzeTextScript } from "../src/core/textScriptAnalysis";
import { projectConstantCatalogFromSources } from "../src/core/projectConstants";
import { deriveEventBranchDependencies, eventMutationDependencies } from "../src/core/eventDependencies";
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
    { path: "constants/events.asm", contents: "DEF EVENT_ALPHA EQU 0\nDEF EVENT_BETA EQU 1\n" },
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

test("declaration arguments stay read-only before a save is offered", async () => {
  const source = "Table:\n\tdw_const Target, SCRIPT_TARGET\nTarget:\n\tMarkEvent EVENT_ALPHA\n\tret\nOther:\n\tret\n";
  const { files } = await analysisFor(source);
  const definitions = { path: "macros/tables.asm", contents: "MACRO dw_const\n\tdw \\1\n\tDEF \\2 EQU 0\nENDM\n" };
  const withTable = await loadMacroAnalysis({} as never, { domains, warnings: [] }, [...files, definitions]);
  const report = await runScriptRoundTripRegression([...files, definitions], withTable, movement, events);
  assert.equal(report.passedCaseCount, 1);
  assert.equal(report.refusedCaseCount, 0);
  assert.equal(report.readOnlyArgumentCount, 2);
  assert.equal(report.failedCaseCount, 0);
  assert.equal(report.passed, true);
  assert.ok(!report.fixtures[0].cases.some((entry) => entry.macroName === "dw_const"));
  const doc = await loadScriptMacroEditDocument(source, path, 2, withTable);
  assert.equal(doc.editableArgumentDomains.length, 0);
  const unchanged = await prepareScriptMacroCallWrite(source, path, 2, "dw_const", doc.sourceHash, doc.arguments, withTable);
  assert.equal(unchanged.contents, source);
  assert.doesNotThrow(() => validate(source, unchanged.contents, "dw_const"));
  await assert.rejects(prepareScriptMacroCallWrite(source, path, 2, "dw_const", doc.sourceHash, ["Other", "SCRIPT_TARGET"], withTable), /structural edit/);
});

test("repeated dialogue, event checks, and battles keep every source occurrence", () => {
  const source = "Talk:\n\ttext_asm\n\tTestEvent EVENT_ALPHA\n\tTestEvent EVENT_BETA\n\tcall InitBattleEnemyParameters\n\tcall InitBattleEnemyParameters\n.one:\n\ttext_far _First\n\ttext_end\n.two:\n\ttext_far _Second\n\ttext_end\n";
  const next = source.replace("_First", "_Second");
  const before = analyzeTextScript(source, "Talk", events);
  const after = analyzeTextScript(next, "Talk", events);
  assert.equal(before.filter((insight) => insight.type === "battle").length, 2);
  assert.equal(after.filter((insight) => insight.type === "dialogue").length, 2);
  assert.doesNotThrow(() => validate(source, next, "text_far _First"));
  const nextEvents = source.replace("TestEvent EVENT_ALPHA", "TestEvent EVENT_BETA");
  assert.equal(analyzeTextScript(nextEvents, "Talk", events).filter((insight) => insight.type === "event").length, 2);
  assert.doesNotThrow(() => validate(source, nextEvents, "TestEvent EVENT_ALPHA"));
});

test("renamed direct and banked dispatch wrappers derive a routine-target role", async () => {
  const source = "Target:\n\tInvoke HelperOne\n\tAcrossBank HelperOne\n\tret\nHelperOne:\n\tret\nHelperTwo:\n\tret\n";
  const { files } = await analysisFor(source);
  const definitions = { path: "macros/dispatch.asm", contents: "MACRO Invoke\n\tcall \\1\nENDM\nMACRO AcrossBank\n\tld b, BANK(\\1)\n\tld hl, \\1\n\tcall Dispatch\nENDM\n" };
  const analysis = await loadMacroAnalysis({} as never, { domains, warnings: [] }, [...files, definitions]);
  for (const name of ["Invoke", "AcrossBank"]) {
    assert.equal(analysis.catalog.macros.find((macro) => macro.name === name)?.parameters[0].sourceRole, "routine-target");
    const call = analysis.callsByScriptPath.get(path)!.calls.find((call) => call.name === name)!;
    assert.equal(editableScriptMacroArguments(analysis.catalog, call).length, 0);
  }
});

test("reused register addresses permit new bits only within the original address group", async () => {
  const source = "Target:\n\tPinnedBit EVENT_A\n\tret\n";
  const files = [
    { path, contents: source },
    { path: "macros/bits.asm", contents: "MACRO PinnedBit\n\tDEF event_byte = (\\1) / 8\n\tbit (\\1) % 8, [hl]\nENDM\n" },
    { path: "constants/events.asm", contents: "DEF EVENT_A EQU 9\nDEF EVENT_B EQU 10\nDEF EVENT_OTHER EQU 25\n" },
  ];
  const catalog = { domains: [{ ...domains[0], options: ["EVENT_A", "EVENT_B", "EVENT_OTHER"].map((value) => ({ value, label: value })) }], warnings: [] };
  const analysis = await loadMacroAnalysis({} as never, catalog, files);
  const doc = await loadScriptMacroEditDocument(source, path, 2, analysis);
  assert.deepEqual(doc.editableArgumentDomains[0].allowedValues, ["EVENT_A", "EVENT_B"]);
  await assert.doesNotReject(prepareScriptMacroCallWrite(source, path, 2, "PinnedBit", doc.sourceHash, ["EVENT_B"], analysis));
  await assert.rejects(prepareScriptMacroCallWrite(source, path, 2, "PinnedBit", doc.sourceHash, ["EVENT_OTHER"], analysis), /domain intersection/);
});

test("constant enumeration honors skipped slots, explicit offsets, and steps", () => {
  const catalog = projectConstantCatalogFromSources([{ path: "constants/events.asm", contents: "const_def 1, 2\nconst EVENT_A\nconst_skip 2\nconst EVENT_B\nconst_next $20\nconst EVENT_C\nconst_skip\nconst_export EVENT_D\nconst_def 3\nshift_const MASK\n" }]);
  const values = Object.fromEntries(catalog.constants.map((entry) => [entry.symbol, entry.value]));
  assert.deepEqual(values, { EVENT_A: 1, EVENT_B: 7, EVENT_C: 32, EVENT_D: 36, MASK: 8 });
});

test("trainer event alternatives preserve the assembler's required bit position", async () => {
  const source = "Target:\n\tTrainerFlag EVENT_A\n\tret\n";
  const files = [{ path, contents: source },
    { path: "macros/trainers.asm", contents: "MACRO TrainerFlag\n\tDEF _ev_bit = \\1 % 8\n\tASSERT _ev_bit == CURRENT_TRAINER_BIT\n\tdw wEventFlags + (\\1 - CURRENT_TRAINER_BIT) / 8\nENDM\n" },
    { path: "constants/events.asm", contents: "const_def 1\nconst EVENT_A\nconst_skip 7\nconst EVENT_B\nconst EVENT_OTHER\n" }];
  const catalog = { domains: [{ ...domains[0], options: ["EVENT_A", "EVENT_B", "EVENT_OTHER"].map((value) => ({ value, label: value })) }], warnings: [] };
  const analysis = await loadMacroAnalysis({} as never, catalog, files);
  const doc = await loadScriptMacroEditDocument(source, path, 2, analysis);
  assert.deepEqual(doc.editableArgumentDomains[0].allowedValues, ["EVENT_A", "EVENT_B"]);
  await assert.rejects(prepareScriptMacroCallWrite(source, path, 2, "TrainerFlag", doc.sourceHash, ["EVENT_OTHER"], analysis), /domain intersection/);
});

test("relative byte operands refuse overflow and preserve their address base", async () => {
  const source = "Target:\n\tRelativeBit a, EVENT_A, EVENT_BASE\n\tRelativeBit a, EVENT_A\n\tret\n";
  const files = [{ path, contents: source },
    { path: "macros/bits.asm", contents: "MACRO RelativeBit\n\tIF _NARG > 2\n\tld \\1, ((\\3) % 8) + ((\\2) - (\\3))\n\tELSE\n\tld \\1, (\\2) % 8\n\tENDC\nENDM\n" },
    { path: "constants/events.asm", contents: "DEF EVENT_BASE EQU 8\nDEF EVENT_A EQU 9\nDEF EVENT_B EQU 263\nDEF EVENT_OTHER EQU 264\n" }];
  const catalog = { domains: [{ ...domains[0], options: ["EVENT_BASE", "EVENT_A", "EVENT_B", "EVENT_OTHER"].map((value) => ({ value, label: value })) }], warnings: [] };
  const analysis = await loadMacroAnalysis({} as never, catalog, files);
  const doc = await loadScriptMacroEditDocument(source, path, 2, analysis);
  assert.deepEqual(doc.editableArgumentDomains.find((entry) => entry.index === 2)?.allowedValues, ["EVENT_BASE", "EVENT_A", "EVENT_B"]);
  assert.ok(!doc.editableArgumentDomains.some((entry) => entry.index === 3));
  await assert.rejects(prepareScriptMacroCallWrite(source, path, 2, "RelativeBit", doc.sourceHash, ["a", "EVENT_OTHER", "EVENT_BASE"], analysis), /domain intersection/);
  const optional = await loadScriptMacroEditDocument(source, path, 3, analysis);
  assert.ok(optional.editableArgumentDomains.find((entry) => entry.index === 2)?.allowedValues.includes("EVENT_OTHER"));
});

test("simultaneous argument changes are checked against the final emitted byte", async () => {
  const source = "Target:\n\tCombined EVENT_A, EVENT_A\n\tret\n";
  const files = [{ path, contents: source },
    { path: "macros/bits.asm", contents: "MACRO Combined\n\tld a, ((\\1) % 256) + ((\\2) % 256)\nENDM\n" },
    { path: "constants/events.asm", contents: "DEF EVENT_A EQU 10\nDEF EVENT_B EQU 200\n" }];
  const catalog = { domains: [{ ...domains[0], options: ["EVENT_A", "EVENT_B"].map((value) => ({ value, label: value })) }], warnings: [] };
  const analysis = await loadMacroAnalysis({} as never, catalog, files);
  const doc = await loadScriptMacroEditDocument(source, path, 2, analysis);
  await assert.doesNotReject(prepareScriptMacroCallWrite(source, path, 2, "Combined", doc.sourceHash, ["EVENT_B", "EVENT_A"], analysis));
  await assert.rejects(prepareScriptMacroCallWrite(source, path, 2, "Combined", doc.sourceHash, ["EVENT_B", "EVENT_B"], analysis), /together.*byte range/);
});

test("nested wrappers inherit emitted byte constraints", async () => {
  const source = "Target:\n\tWrapped EVENT_A, EVENT_A\n\tret\n";
  const files = [{ path, contents: source },
    { path: "macros/bits.asm", contents: "MACRO Inner\n\tld a, ((\\1) % 256) + ((\\2) % 256)\nENDM\nMACRO Wrapped\n\tInner \\2, \\1\nENDM\n" },
    { path: "constants/events.asm", contents: "DEF EVENT_A EQU 10\nDEF EVENT_B EQU 200\n" }];
  const catalog = { domains: [{ ...domains[0], options: ["EVENT_A", "EVENT_B"].map((value) => ({ value, label: value })) }], warnings: [] };
  const analysis = await loadMacroAnalysis({} as never, catalog, files);
  const doc = await loadScriptMacroEditDocument(source, path, 2, analysis);
  await assert.doesNotReject(prepareScriptMacroCallWrite(source, path, 2, "Wrapped", doc.sourceHash, ["EVENT_B", "EVENT_A"], analysis));
  await assert.rejects(prepareScriptMacroCallWrite(source, path, 2, "Wrapped", doc.sourceHash, ["EVENT_B", "EVENT_B"], analysis), /together.*byte range/);
});

test("dialogue pointer alternatives exclude executable helpers", async () => {
  const source = "Target:\n\tTextPointer TextA\n\tret\nTextA:\n\ttext_start\n\ttext_end\nTextB:\n\ttext_start\n\ttext_end\nTextHelper:\n\tInvokeHelper\n";
  const files = [{ path, contents: source }, { path: "macros/text.asm", contents: "MACRO TextPointer\n\tdw \\1\nENDM\nMACRO text_start\n\tdb 0\nENDM\nMACRO InvokeHelper\n\tld a, 1\n\tret\nENDM\n" }];
  const catalog = { domains: [{ id: "text", label: "Text", kind: "label-family" as const, sourcePath: null, options: ["TextA", "TextB", "TextHelper"].map((value) => ({ value, label: value })) }], warnings: [] };
  const analysis = await loadMacroAnalysis({} as never, catalog, files);
  const doc = await loadScriptMacroEditDocument(source, path, 2, analysis);
  assert.deepEqual(doc.editableArgumentDomains[0].allowedValues, ["TextA", "TextB"]);
  await assert.rejects(prepareScriptMacroCallWrite(source, path, 2, "TextPointer", doc.sourceHash, ["TextHelper"], analysis), /domain intersection/);
});

test("event builders exclude unresolved count symbols from the selector and writer", async () => {
  const { files } = await analysisFor(routine);
  files.push({ path: "constants/count.asm", contents: "DEF NUM_EVENTS EQU const_value\n" });
  const extended = [{ ...domains[0], options: [...domains[0].options, { value: "NUM_EVENTS", label: "NUM_EVENTS" }] }];
  const analysis = await loadMacroAnalysis({} as never, { domains: extended, warnings: [] }, files);
  const doc = await loadScriptSimpleActionCreateDocument(routine, path, "Target", analysis, movement, events);
  assert.ok(!doc.eventOptions["set-event"].some((option) => option.value === "NUM_EVENTS"));
  await assert.rejects(prepareScriptSimpleActionWrite(routine, doc, { action: "set-event", event: "NUM_EVENTS" }, analysis, movement, events));
});

const guardedEncounter = "Encounter:\n\tTestEvent EVENT_ENABLED\n\tret z\n\tcall CoordinateTest\n\tret nc\n\tld a, $f0\n\tld [wInputMask], a\n\tTestEvent EVENT_ALPHA\n\tjr nz, FirstBranch\n\tTestEvent EVENT_BETA\n\tjp nz, SecondBranch\n\tret\nFirstBranch:\n\tret\nSecondBranch:\n\tret\n";

test("event dependency analysis identifies enabling flags and pending branch selectors from source", () => {
  const files = [{ path: "scripts/Encounter.asm", contents: guardedEncounter }];
  const dependencies = deriveEventBranchDependencies(files, events);
  assert.deepEqual(dependencies, [{ path: "scripts/Encounter.asm", routine: "Encounter", line: 2,
    guardEvent: "EVENT_ENABLED", branchEvents: ["EVENT_ALPHA", "EVENT_BETA"], writtenSymbols: ["wInputMask"] }]);
  assert.equal(eventMutationDependencies(dependencies, "EVENT_ALPHA", "reset").length, 1);
  assert.equal(eventMutationDependencies(dependencies, "EVENT_ENABLED", "set").length, 1);
  assert.equal(eventMutationDependencies(dependencies, "EVENT_ALPHA", "set").length, 0);
  assert.equal(eventMutationDependencies(dependencies, "EVENT_ENABLED", "reset").length, 0);
});

test("event dependency analysis leaves cleanup, local branches, and read-only checks unclassified", () => {
  for (const contents of [
    guardedEncounter.replace("\tret\nFirstBranch:", "\txor a\n\tld [wInputMask], a\n\tret\nFirstBranch:"),
    guardedEncounter.replace("jr nz, FirstBranch", "jr nz, .first"),
    guardedEncounter.replace("\tld [wInputMask], a\n", ""),
    guardedEncounter.replace("ret nc", "jp OtherRoutine"),
  ]) assert.equal(deriveEventBranchDependencies([{ path: "scripts/Encounter.asm", contents }], events).length, 0);
  assert.equal(deriveEventBranchDependencies([{ path: "engine/Encounter.asm", contents: guardedEncounter }], events).length, 0);
});

test("generated event-action documents include project-derived dependency warnings", async () => {
  const source = "Target:\n\tret\n";
  const { files } = await analysisFor(source);
  files.push({ path: "scripts/Encounter.asm", contents: guardedEncounter.replaceAll("TestEvent", "ReadFlag") });
  files.push({ path: "macros/check.asm", contents: "MACRO ReadFlag\n\tld hl, wEventFlags + (\\1 / 8)\n\tbit (\\1) % 8, [hl]\nENDM\n" });
  const analysis = await loadMacroAnalysis({} as never, { domains, warnings: [] }, files);
  const doc = await loadScriptSimpleActionCreateDocument(source, path, "Target", analysis, movement, events);
  assert.equal(doc.eventBranchDependencies?.[0].guardEvent, "EVENT_ENABLED");
  assert.deepEqual(doc.eventBranchDependencies?.[0].branchEvents, ["EVENT_ALPHA", "EVENT_BETA"]);
});
