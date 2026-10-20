import assert from "node:assert/strict";
import { test } from "node:test";
import { atlasCode, atlasLabelIndex, atlasReferences, atlasStateEntries } from "../src/core/scriptAtlas";
import type { ProjectRgbdsSourceFile } from "../src/core/projectConstants";

const file = (path: string, contents: string) => ({ path, contents } as ProjectRgbdsSourceFile);

test("atlas comments preserve quoted semicolons and escaped quotes", () => {
  assert.equal(atlasCode('text "Yes; really!" ; outside'), 'text "Yes; really!"');
  assert.equal(atlasCode('text "say \\"; now" ; outside'), 'text "say \\"; now"');
  assert.equal(atlasCode("ld a, ';' ; outside"), "ld a, ';'");
  assert.equal(atlasCode("ld a, '\"' ; outside"), "ld a, '\"'");
});

test("all local labels resolve in their global scope, including explicit qualified jumps", () => {
  const source = file("scripts/Test.asm", "First:\n\tcall .branch\n.branch\n\tret\nSecond:\n\tjp First.branch\n\tjr z, .branch\n.branch:\n\tret\n");
  const index = atlasLabelIndex([source]);
  assert.equal(index.get("First.branch")?.[0].line, 3);
  assert.equal(index.get("Second.branch")?.[0].line, 8);
  const refs = atlasReferences(source, index);
  assert.deepEqual(refs.filter(r => ["call", "jump"].includes(r.kind)).map(r => [r.target, r.resolution, r.condition]), [
    ["First.branch", "resolved", null], ["First.branch", "resolved", null], ["Second.branch", "resolved", "z"],
  ]);
});

test("cross-file helpers, text, state tables, trainer dialogue and register pointers retain every occurrence", () => {
  const source = file("scripts/Test.asm", "Root:\n\tfarcall Engine\n\tcallfar Engine\n\tpredef Engine\n\ttext_far _Words\n\tld hl, Path\n\tdw_const Root, SCRIPT_ROOT\n\ttrainer EVENT_DONE, 3, _Words, _Words, _Words\n\tfarjp Engine\n");
  const external = file("engine/events/helper.asm", "Engine::\n\tret\nPath:\n\tdb -1\n");
  const text = file("text/Test.asm", "_Words:\n\ttext \"hello\"\n\tdone\n");
  const refs = atlasReferences(source, atlasLabelIndex([source, external, text]));
  assert.equal(refs.length, 10);
  assert.ok(refs.every(r => r.resolution === "resolved"));
  assert.equal(refs.filter(r => r.target === "_Words").length, 4);
  assert.equal(refs[0].definitions[0].path, external.path);
});

test("duplicates, missing targets, computed pointers and indirect returns are not invented", () => {
  const source = file("scripts/Test.asm", "Root:\n\tcall Duplicate\n\tcall Missing\n\tjp hl\n\tdw Generated{n}\n\tret nc\nNext:\n\tret\n");
  const refs = atlasReferences(source, atlasLabelIndex([source, file("engine/a.asm", "Duplicate:\n\tret"), file("engine/b.asm", "Duplicate:\n\tret")]));
  assert.equal(refs[0].resolution, "ambiguous");
  assert.equal(refs[1].resolution, "missing");
  assert.equal(refs[2].kind, "indirect"); assert.equal(refs[2].resolution, "runtime");
  assert.equal(refs[3].target, null); assert.equal(refs[3].expression, "Generated{n}");
  assert.equal(refs[4].condition, "nc");
  assert.equal(refs[5].kind, "fallthrough");
});

test("unconditional exits prevent physical fall-through; data adjacency stays explicitly provisional", () => {
  const source = file("scripts/Test.asm", "First:\n\tjp Exit\nSecond:\n\tret\nData:\n\tdb 1\nNext:\n\tret\nExit:\n\tret\n");
  const refs = atlasReferences(source, atlasLabelIndex([source]));
  assert.deepEqual(refs.filter(r => r.kind === "fallthrough").map(r => [r.owner, r.target]), [["Data", "Next"]]);
});

test("computed register pointers preserve expressions without fabricating labels", () => {
  const source = file("scripts/Test.asm", "Root:\n\tld hl, Table + 1\n\tld de, .Path + offset\n\tret\n");
  const refs = atlasReferences(source, atlasLabelIndex([source]));
  assert.deepEqual(refs.filter(r => r.kind === "pointer").map(r => [r.target, r.expression, r.resolution]), [
    [null, "Table + 1", "runtime"], [null, ".Path + offset", "runtime"],
  ]);
});

test("state-table aliases retain every constant and table entry", () => {
  const source = file("scripts/Test.asm", "Test_ScriptPointers:\n\tdef_script_pointers\n\tdw_const Shared, SCRIPT_FIRST\n\tdw_const Shared, SCRIPT_SECOND\nShared:\n\tret\n");
  const entries = atlasStateEntries(source, atlasLabelIndex([source]));
  assert.deepEqual(entries.map(e => [e.table, e.constant, e.label, e.declaredOrder]), [
    ["Test_ScriptPointers", "SCRIPT_FIRST", "Shared", 0], ["Test_ScriptPointers", "SCRIPT_SECOND", "Shared", 1],
  ]);
  assert.ok(entries.every(e => e.definitions[0].line === 5));
});
