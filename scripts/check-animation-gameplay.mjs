import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
const args = process.argv.slice(2), at = args.indexOf("--rom");
assert.ok(at > 0 && args[at + 1] && args[at + 2], "Supply source directories followed by --rom RGBDS binjgb.");
const temporary = await mkdtemp(join("node_modules", ".animation-gameplay-check-"));
try {
  const outfile = join(temporary, "tests.mjs");
  await build({ entryPoints: ["tests/animationGameplay.ts"], outfile, bundle: true, packages: "external", platform: "node", format: "esm", target: "node22" });
  for (const root of args.slice(0, at)) {
    const status = await new Promise(resolveStatus => { const child = spawn(process.execPath, [outfile, root, resolve(args[at + 1]), resolve(args[at + 2])], { stdio: "inherit" }); child.on("error", () => resolveStatus(1)); child.on("exit", code => resolveStatus(code ?? 1)); });
    if (status !== 0) { process.exitCode = status; break; }
  }
} finally { await rm(temporary, { recursive: true, force: true }); }
