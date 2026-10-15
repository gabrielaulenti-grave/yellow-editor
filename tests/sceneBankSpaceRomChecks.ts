import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export async function sceneBankSpaceRomChecks(game: string, root: string, rgbds: string, baselineMap: string,
  baselineSymbols: string, baselineRomSize: number, run: (cmd: string, args: string[], cwd?: string) => string) {
  const symbols = (text: string) => new Map([...text.matchAll(/^([0-9a-f]{2}):([0-9a-f]{4}) (\S+)$/gm)]
    .map(match => [match[3], { bank: parseInt(match[1], 16), address: parseInt(match[2], 16) }]));
  const before = symbols(baselineSymbols), initial = symbols(await readFile(join(game, "pokered.sym"), "utf8"));
  const size = parseInt(baselineMap.match(/SECTION: \$[0-9a-f]+-\$[0-9a-f]+ \(\$([0-9a-f]+) bytes\) \["Hidden Events Core"\]/)![1], 16);
  const padding = 0x8000 - initial.get("IsPlayerOnDungeonWarp")!.address - size + 42;
  assert.ok(padding >= 0 && padding < 0x4000, "The fixture must fit before adding controlled bank pressure");
  const path = "engine/overworld/hidden_events.asm", upgraded = await readFile(join(game, path), "utf8");
  assert.ok(upgraded.includes('SECTION "Editor Scene Hidden Event Lookup", ROMX'));
  const script = join(game, "scripts/ViridianPokecenter.asm");
  await writeFile(script, (await readFile(script, "utf8")) + `\n; Regression fixture: an authored scene can consume this much space.\n\tds ${padding}, 0\n`);
  await writeFile(join(game, path), await readFile(join(root, path), "utf8"));
  run("make", ["clean"], game);
  const old = spawnSync("make", ["-j2", `RGBDS=${rgbds}/`, "pokered.gbc"], { cwd: game, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  assert.notEqual(old.status, 0, "The original pinned lookup must reproduce the linker failure");
  assert.match(old.stderr, /Hidden Events Core/);
  assert.match(old.stderr, /overflow ROMX by 42 bytes/);
  await writeFile(join(game, path), upgraded);
  run("make", ["clean"], game); run("make", ["-j2", `RGBDS=${rgbds}/`, "pokered.gbc"], game);
  const final = symbols(await readFile(join(game, "pokered.sym"), "utf8"));
  const lookup = final.get("CheckForHiddenEvent")!, dungeon = final.get("IsPlayerOnDungeonWarp")!;
  assert.notEqual(lookup.bank, dungeon.bank, "The lookup must move out of the pressured bank");
  assert.equal(dungeon.bank, before.get("IsPlayerOnDungeonWarp")!.bank);
  for (const name of ["SeafoamIslands1F_Script", "SeafoamIslandsB1F_Script", "SeafoamIslandsB2F_Script", "SeafoamIslandsB3F_Script", "VictoryRoad3F_Script"]) {
    assert.equal(final.get(name)!.bank, dungeon.bank, `${name} must retain its direct dungeon-warp calls`);
  }
  const rom = await readFile(join(game, "pokered.gbc"));
  assert.equal(rom.length, baselineRomSize, "The lookup should fit existing ROM banks without increasing cartridge size");
  const caller = final.get("CheckForHiddenEventOrBookshelfOrCardKeyDoor")!;
  assert.equal(caller.bank, 0);
  const entry = rom.subarray(caller.address, caller.address + 80);
  assert.ok(entry.includes(Buffer.from([0x3e, lookup.bank, 0xea, 0x00, 0x20])), "The native dispatcher must select the relocated lookup bank");
  assert.ok(entry.includes(Buffer.from([0xcd, lookup.address & 255, lookup.address >> 8])), "The native dispatcher must call its linked address");
  console.log(`${root}: reproduced Hidden Events Core overflow by exactly 42 bytes; split lookup builds, banked dispatcher operands and native dungeon-warp co-location verified`);
}
