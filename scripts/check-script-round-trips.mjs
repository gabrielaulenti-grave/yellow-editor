import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const directory = await mkdtemp(join("node_modules", ".round-trips-"));
try {
  const outfile = join(directory, "checks.mjs");
  await build({
    entryPoints: [process.argv.length > 2
      ? "tests/scriptRoundTripSweep.ts"
      : "tests/scriptRoundTrips.test.ts"],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
  });
  const result = spawnSync(process.execPath, [outfile, ...process.argv.slice(2)], {
    stdio: "inherit",
  });
  process.exitCode = result.status ?? 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
