import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const contracts = args[0] === "--contracts";
if (contracts) args.shift();
const tests = args[0] === "--test";
if (tests) args.shift();
const temporary = await mkdtemp(join("node_modules", ".script-atlas-"));
try {
  const outfile = join(temporary, "runner.mjs");
  await build({ entryPoints: [contracts ? "tests/scriptEngineContracts.test.ts" : tests ? "tests/scriptAtlas.test.ts" : "scripts/scriptAtlasReport.ts"], outfile,
    bundle: true, platform: "node", format: "esm", target: "node22" });
  const code = await new Promise(resolve => {
    const child = spawn(process.execPath, [outfile, ...args], { stdio: "inherit" });
    child.on("error", error => { console.error(error); resolve(1); });
    child.on("exit", code => resolve(code ?? 1));
  });
  process.exitCode = code;
} finally { await rm(temporary, { recursive: true, force: true }); }
