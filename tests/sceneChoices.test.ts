import assert from "node:assert/strict";
import { test } from "node:test";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type { ProjectSource } from "../src/core/types";
import { sceneChoiceChecks } from "./sceneChoiceChecks";
import { sceneChoiceCpuProbes } from "./sceneChoiceCpuProbes";




const args = process.argv.slice(2), at = args.indexOf("--rom");
const rgbds = at < 0 ? null : resolve(args[at + 1]), binjgb = at < 0 ? null : resolve(args[at + 2]);
if (at >= 0) args.splice(at, 3);
for (const directory of args) test(`${directory}: linked fossil scenes`, async () => {
  const root = resolve(directory), overlay = new Map<string, string>();
  async function listFiles(folder = ""): Promise<string[]> {
    return (await Promise.all((await readdir(join(root, folder), { withFileTypes: true })).filter(entry => !entry.name.startsWith(".")).map(entry => entry.isDirectory() ? listFiles(join(folder, entry.name)) : [join(folder, entry.name)]))).flat();
  }
  const source: ProjectSource = { listFiles, readText: async path => overlay.get(path) ?? readFile(join(root, path), "utf8"), readBytes: async path => new Uint8Array(await readFile(join(root, path))), exists: async path => { try { await readFile(join(root, path)); return true; } catch { return false; } } };
  const models = await sceneChoiceChecks(source, overlay);
  if (!rgbds || !binjgb) return;
  const temporary = await mkdtemp(resolve("node_modules/.choices-runtime-"));
  const run = (cmd: string, argv: string[], cwd = temporary) => {
    const result = spawnSync(cmd, argv, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    assert.equal(result.status, 0, `${cmd}: ${result.stderr.slice(-7000)}\n${result.stdout.slice(-500)}`); return result.stdout;
  };
  try {
    const cpu = join(temporary, "cpu");
    run("cc", ["-std=gnu11", "-O2", `-I${join(binjgb, "src")}`, resolve("tests/scriptRuntimeProbe.c"), ...["memory.c", "common.c", "emulator-debug.c"].map(file => join(binjgb, "src", file)), "-lm", "-o", cpu]);
    await sceneChoiceCpuProbes(root, temporary, rgbds, cpu, run, models, overlay.get("constants/event_constants.asm")!);
    const game = join(temporary, "game"); await cp(root, game, { recursive: true, filter: path => !path.split("/").includes(".git") });
    for (const [path, contents] of overlay) await writeFile(join(game, path), contents);
    const target = root.includes("pokeyellow") ? "pokeyellow" : "pokered";
    run("make", ["clean"], game); run("make", ["-j2", `RGBDS=${rgbds}/`, `${target}.gbc`], game);
    if (target === "pokeyellow") {
      const symbols = new Map([...(await readFile(join(game, `${target}.sym`), "utf8")).matchAll(/^([0-9a-f]+):([0-9a-f]+) (\S+)$/gm)].map(match => [match[3], { bank: parseInt(match[1], 16), address: parseInt(match[2], 16) }]));
      const rating = symbols.get("DisplayDexRating")!, pointer = symbols.get("DisplayDexRatingPredef")!, dungeon = symbols.get("IsPlayerOnDungeonWarp")!;
      assert.notEqual(rating.bank, dungeon.bank);
      const rom = await readFile(join(game, `${target}.gbc`)), at = pointer.bank * 0x4000 + pointer.address - 0x4000;
      assert.deepEqual([...rom.subarray(at, at + 3)], [rating.bank, rating.address & 255, rating.address >> 8], "The native predef table selects the relocated routine's linked bank and address");
      for (const name of ["SeafoamIslands1F_Script", "SeafoamIslandsB1F_Script", "SeafoamIslandsB2F_Script", "SeafoamIslandsB3F_Script", "VictoryRoad3F_Script"]) assert.equal(symbols.get(name)!.bank, dungeon.bank);
      const ratingPath = "engine/events/pokedex_rating.asm";
      await writeFile(join(game, ratingPath), await readFile(join(root, ratingPath), "utf8"));
      const old = spawnSync("make", ["-j2", `RGBDS=${rgbds}/`, `${target}.gbc`], { cwd: game, encoding: "utf8" });
      assert.notEqual(old.status, 0, "The native pinned map bank must reproduce the three-actor capacity failure");
      assert.match(old.stderr, /Dungeon Warps/); assert.match(old.stderr, /overflow ROMX/);
      await writeFile(join(game, ratingPath), overlay.get(ratingPath)!);
      run("make", ["-j2", `RGBDS=${rgbds}/`, `${target}.gbc`], game);
      console.log("Yellow: original map-bank overflow reproduced; floating rating predef and native dungeon-warp co-location verified");
    }
    console.log(`${root}: complete linked-fossil ROM assembled`);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
