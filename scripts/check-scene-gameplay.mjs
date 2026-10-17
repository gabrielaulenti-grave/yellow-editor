import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const args = process.argv.slice(2), at = args.indexOf("--rom");
assert.ok(at > 0 && args[at + 1] && args[at + 2], "Supply source directories followed by --rom RGBDS binjgb.");
const roots = args.slice(0, at), rgbds = resolve(args[at + 1]), cpu = resolve(args[at + 2]);
const temporary = await mkdtemp(join("node_modules", ".scene-gameplay-check-"));
try {
  const outfile = join(temporary, "tests.mjs");
  await build({ entryPoints: ["tests/sceneGameplay.ts"], outfile, bundle: true, platform: "node", format: "esm", target: "node22" });
  for (const root of roots) {
    const status = await new Promise(resolve => {
      const child = spawn(process.execPath, [outfile, root, rgbds, cpu], { stdio: "inherit" });
      child.on("error", () => resolve(1)); child.on("exit", code => resolve(code ?? 1));
    });
    if (status !== 0) { process.exitCode = status; break; }
  }
} finally { await rm(temporary, { recursive: true, force: true }); }
