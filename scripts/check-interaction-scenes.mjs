import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
const temporary = await mkdtemp(join("node_modules", ".scene-check-"));
try {
  const outfile = join(temporary, "tests.mjs");
  await build({ entryPoints: ["tests/interactionScene.test.ts"], outfile, bundle: true, platform: "node", format: "esm", target: "node22" });
  process.exitCode = await new Promise(resolve => {
    const child = spawn(process.execPath, [outfile, ...process.argv.slice(2)], { stdio: "inherit" });
    child.on("error", () => resolve(1)); child.on("exit", code => resolve(code ?? 1));
  });
} finally { await rm(temporary, { recursive: true, force: true }); }
