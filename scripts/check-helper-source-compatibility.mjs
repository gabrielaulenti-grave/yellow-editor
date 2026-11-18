import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const temporary = await mkdtemp(path.join(os.tmpdir(), "yellow-helper-compat-"));
const originalFetch = globalThis.fetch;
const files = new Map([
  ["tools/common.h", "shared header\n"],
  ["tools/gfx.c", "graphics tool\n"],
  ["tools/pkmncompress.c", "compression tool\n"],
  ["tools/pcm.c", "audio tool\n"],
  ["tools/scan_includes.c", "changed dependency scanner\n"],
]);
const sha = value => createHash("sha256").update(value).digest("hex");
const sourceManifest = Object.fromEntries(
  [...files].map(([name, data]) => [name, { sha256: sha(data) }]),
);
sourceManifest["tools/scan_includes.c"].sha256 = sha("old dependency scanner\n");

const manifest = {
  schemaVersion: 1, family: "pret-gen1", generatedAt: "fixture",
  source: { repository: "fixture", commit: "a".repeat(40), files: sourceManifest },
  emscripten: { version: "4.0.15", versionLine: "fixture" },
  tools: Object.fromEntries(["gfx", "pkmncompress", "pcm", "scan_includes"].map(name =>
    [name, { source: `tools/${name}.c`, module: `${name}.mjs`, wasm: `${name}.wasm` }],
  )),
};

try {
  await build({
    entryPoints: ["src/core/pretWasmTools.ts"],
    outfile: path.join(temporary, "tools.mjs"),
    bundle: true, platform: "browser", format: "esm",
    define: { "import.meta.env.BASE_URL": '"/"' },
    logLevel: "silent",
  });
  globalThis.fetch = async () => ({ ok: true, json: async () => manifest });
  const { inspectPretWasmTools } = await import(pathToFileURL(path.join(temporary, "tools.mjs")).href);
  const source = {
    exists: async name => files.has(name),
    readText: async name => {
      if (!files.has(name)) throw Error(`Missing ${name}`);
      return files.get(name);
    },
  };
  const changedScanner = await inspectPretWasmTools(source);
  assert.equal(changedScanner.readyForRomBuild, true,
    "An altered, unused scan_includes.c must not block ROM builds");
  assert.equal(changedScanner.tools.find(tool => tool.name === "scan_includes").available, false,
    "The mismatched optional helper must still be reported as unavailable");
  assert.match(changedScanner.message, /Optional helper sources differ/);

  files.delete("tools/scan_includes.c");
  const missingScanner = await inspectPretWasmTools(source);
  assert.equal(missingScanner.readyForRomBuild, true,
    "An absent unused scanner must not block ROM builds");

  files.set("tools/gfx.c", "different graphics implementation\n");
  const changedGraphics = await inspectPretWasmTools(source);
  assert.equal(changedGraphics.readyForRomBuild, false,
    "A changed executed helper must block ROM builds");

  files.set("tools/gfx.c", "graphics tool\n");
  files.set("tools/pcm.c", "different audio implementation\n");
  const changedAudio = await inspectPretWasmTools(source);
  assert.equal(changedAudio.readyForRomBuild, false,
    "A changed conditional audio helper must block Yellow builds");

  console.log("Helper compatibility regression passed: modified/missing unused scanner allowed; required graphics and audio mismatches rejected.");
} finally {
  globalThis.fetch = originalFetch;
  await rm(temporary, { recursive: true, force: true });
}
