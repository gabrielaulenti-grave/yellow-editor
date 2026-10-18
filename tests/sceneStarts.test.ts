import assert from "node:assert/strict";
import { test } from "node:test";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type { ProjectSource } from "../src/core/types";
import { sceneStartsChecks } from "./sceneStartsChecks";
import { sceneStartsCpuProbes } from "./sceneStartsCpuProbes";

const args = process.argv.slice(2), at = args.indexOf("--rom");
const rgbds = at < 0 ? null : resolve(args[at + 1]), binjgb = at < 0 ? null : resolve(args[at + 2]);
if (at >= 0) args.splice(at, 3);
for (const directory of args) test(`${directory}: multiple scene starts`, async () => {
  const root = resolve(directory), overlay = new Map<string, string>();
  async function listFiles(folder = ""): Promise<string[]> {
    return (await Promise.all((await readdir(join(root, folder), { withFileTypes: true })).filter(entry => !entry.name.startsWith(".")).map(entry => entry.isDirectory() ? listFiles(join(folder, entry.name)) : [join(folder, entry.name)]))).flat();
  }
  const source: ProjectSource = { listFiles, readText: async path => overlay.get(path) ?? readFile(join(root, path), "utf8"), readBytes: async path => new Uint8Array(await readFile(join(root, path))), exists: async path => { try { await readFile(join(root, path)); return true; } catch { return false; } } };
  const models = await sceneStartsChecks(source, overlay);
  if (!rgbds || !binjgb) return;
  const temporary = await mkdtemp(resolve("node_modules/.starts-runtime-"));
  const run = (cmd: string, argv: string[], cwd = temporary) => {
    const result = spawnSync(cmd, argv, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    assert.equal(result.status, 0, `${cmd}: ${result.stderr.slice(-7000)}\n${result.stdout.slice(-500)}`); return result.stdout;
  };
  try {
    const cpu = join(temporary, "cpu");
    run("cc", ["-std=gnu11", "-O2", `-I${join(binjgb, "src")}`, resolve("tests/scriptRuntimeProbe.c"), ...["memory.c", "common.c", "emulator-debug.c"].map(file => join(binjgb, "src", file)), "-lm", "-o", cpu]);
    await sceneStartsCpuProbes(root, temporary, rgbds, cpu, run, models, overlay.get("constants/event_constants.asm")!);
    const game = join(temporary, "game"); await cp(root, game, { recursive: true, filter: path => !path.split("/").includes(".git") });
    for (const [path, contents] of overlay) await writeFile(join(game, path), contents);
    const target = root.includes("pokeyellow") ? "pokeyellow" : "pokered";
    run("make", ["clean"], game); run("make", ["-j2", `RGBDS=${rgbds}/`, `${target}.gbc`], game);
    console.log(`${root}: complete multi-start following ROM assembled`);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
