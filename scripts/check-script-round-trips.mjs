import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const directory = await mkdtemp(join("node_modules", ".round-trips-"));
const args = process.argv.slice(2);
const assembly = args[0] === "--rom";
if (assembly) args.shift();
try {
  const outfile = join(directory, "checks.mjs");
  await build({
    entryPoints: [assembly ? "tests/scriptAssemblySweep.ts"
      : args.length > 0 ? "tests/scriptRoundTripSweep.ts" : "tests/scriptRoundTrips.test.ts"],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
  });
  const result = spawnSync(process.execPath, [outfile, ...args], {
    stdio: "inherit",
  });
  process.exitCode = result.status ?? 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
