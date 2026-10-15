import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { prepareSceneBankSpace } from "../src/core/sceneBankSpace";
import type { InteractionInspection } from "../src/core/scriptInteractions";

export async function sceneBankSpaceChecks(root: string) {
  const path = "engine/overworld/hidden_events.asm";
  const paths = [path, "home/hidden_events.asm", "data/events/hidden_events.asm", "main.asm", "scripts/SeafoamIslands1F.asm"];
  const files = await Promise.all(paths.map(async path => ({ path, contents: await readFile(join(root, path), "utf8") })));
  const state = (entries = files) => ({ files: entries, byPath: new Map(entries.map(file => [file.path, file.contents])) }) as InteractionInspection;
  const changed = new Map<string, string>();
  await prepareSceneBankSpace(state(), changed);
  if (!files[0].contents.includes("IsPlayerOnDungeonWarp::")) {
    assert.equal(changed.size, 0, "Yellow already separates dungeon-warp code"); return;
  }
  assert.deepEqual([...changed.keys()], [path]);
  const next = changed.get(path)!;
  const start = next.indexOf("CheckForHiddenEvent::");
  assert.ok(next.indexOf('SECTION "Editor Scene Hidden Event Lookup", ROMX') < start);
  assert.ok(next.indexOf("IsPlayerOnDungeonWarp::") < next.indexOf("PUSHS"));
  assert.ok(next.endsWith("POPS\n; yellow-editor-scene-bank-space-end\n"));
  const upgraded = files.map(file => file.path === path ? { ...file, contents: next } : file);
  const unchanged = new Map<string, string>();
  await prepareSceneBankSpace(state(upgraded), unchanged); assert.equal(unchanged.size, 0);
  const crlf = new Map<string, string>();
  await prepareSceneBankSpace(state(files.map(file => ({ ...file, contents: file.contents.replace(/\n/g, "\r\n") }))), crlf);
  assert.equal(crlf.get(path)!.replace(/\r\n/g, "\n"), next);
  assert.ok(!/(?<!\r)\n/.test(crlf.get(path)!));
  const replace = (entries: typeof files, name: string, from: string, to: string) => entries.map(file => file.path === name ? { ...file, contents: file.contents.replace(from, to) } : file);
  await assert.rejects(() => prepareSceneBankSpace(state(replace(files, path, "call ArePlayerCoordsInArray", "call DelayFrame")), new Map()), /reviewed hidden-event lookup/);
  await assert.rejects(() => prepareSceneBankSpace(state(replace(files, "home/hidden_events.asm", "BANK(CheckForHiddenEvent)", "$11")), new Map()), /bank-switching dispatcher/);
  await assert.rejects(() => prepareSceneBankSpace(state(replace(files, "data/events/hidden_events.asm", "RARE_CANDY", "POTION")), new Map()), /reviewed hidden-event tables/);
  await assert.rejects(() => prepareSceneBankSpace(state([...files, { path: "scripts/Unreviewed.asm", contents: "Unreviewed:\n\tcall CheckForHiddenEvent\n" }]), new Map()), /unreviewed reference/);
  await assert.rejects(() => prepareSceneBankSpace(state([...files, { path: "constants/Unreviewed.asm", contents: 'DEF HiddenLookupAlias EQUS "CheckForHiddenEvent"\n' }]), new Map()), /unreviewed reference/);
  await assert.rejects(() => prepareSceneBankSpace(state(replace(upgraded, path, "PUSHS", "PUSHS\nSECTION \"Wrong\", ROMX")), new Map()), /section was changed/);
  console.log(`${root}: bank-space upgrade preserves native dungeon callers; caller/data/code drift, unsafe references and CRLF guards pass`);
}
