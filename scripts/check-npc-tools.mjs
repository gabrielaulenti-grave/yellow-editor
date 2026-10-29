import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
const directory = await mkdtemp(resolve("node_modules/.npc-tools-check-"));
try {
  const outfile = resolve(directory, "tests.mjs");
  await build({ entryPoints: ["tests/npcTools.test.ts"], outfile, bundle: true, platform: "node", format: "esm", target: "node22" });
  process.exitCode = await new Promise(resolve => {
    const child = spawn(process.execPath, [outfile, ...process.argv.slice(2)], { stdio: "inherit" });
    child.on("exit", code => resolve(code ?? 1)); child.on("error", () => resolve(1));
  });
} finally { await rm(directory, { recursive: true, force: true }); }
