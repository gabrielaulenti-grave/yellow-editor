import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  fileURLToPath,
  pathToFileURL,
} from "node:url";

const EMSCRIPTEN_VERSION = "4.0.15";
const SOURCE_REPOSITORY = "pret/pokeyellow";
const SOURCE_COMMIT = "e89ead154b9968aa50eed9328ff2b38b6c194382";
const TOOL_NAMES = [
  "scan_includes",
  "gfx",
  "pkmncompress",
  "make_patch",
  "pcm",
];

// These are Git blob SHAs from the pinned pret/pokeyellow commit. The common
// helper sources are currently byte-identical in pret/pokered; pcm is Yellow-only.
const SOURCE_FILES = {
  "tools/common.h": "8a42cebc5b95a67ffd75bee76309c7d664840368",
  "tools/gfx.c": "496cbabcf04b9151c464617f8b7d93343060203d",
  "tools/make_patch.c": "ae3e24627906823279fe70412cd28c60b7fcbc74",
  "tools/pcm.c": "e9c7ce73f366d9fb99168396c91c4eda3c092d3a",
  "tools/pkmncompress.c": "60d6fd0f05709dbe933a009e9b292c6f74bb6213",
  "tools/scan_includes.c": "538d9d7791c0521e973f007e7275ab4f74f98018",
};

const repoRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const outputDirectory = path.join(
  repoRoot,
  "public",
  "wasm-tools",
  "pret-gen1",
);
const emcc = process.env.EMCC || "emcc";

function gitBlobSha(bytes) {
  const header = Buffer.from(`blob ${bytes.length}\0`);
  return createHash("sha1")
    .update(header)
    .update(bytes)
    .digest("hex");
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fetchPinnedSource(relativePath, expectedBlobSha, sourceRoot) {
  const url = `https://raw.githubusercontent.com/${SOURCE_REPOSITORY}/${SOURCE_COMMIT}/${relativePath}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${relativePath}: HTTP ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const actualBlobSha = gitBlobSha(bytes);
  if (actualBlobSha !== expectedBlobSha) {
    throw new Error(
      `${relativePath} did not match its pinned Git blob SHA. Expected ${expectedBlobSha}, got ${actualBlobSha}.`,
    );
  }

  const destination = path.join(sourceRoot, relativePath.replace(/^tools\//, ""));
  await writeFile(destination, bytes);

  return {
    gitBlobSha: actualBlobSha,
    sha256: sha256(bytes),
  };
}

function emscriptenVersionLine() {
  try {
    return execFileSync(emcc, ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? "unknown";
  } catch (error) {
    throw new Error(
      `Emscripten is required to prepare the web helper tools. Install/activate Emscripten ${EMSCRIPTEN_VERSION}, or run this through the Yellow Editor GitHub Actions workflow. ${String(error)}`,
    );
  }
}

function compileTool(name, sourceRoot, destinationDirectory, environment) {
  const source = path.join(sourceRoot, `${name}.c`);
  const output = path.join(destinationDirectory, `${name}.mjs`);

  execFileSync(
    emcc,
    [
      source,
      "-I",
      sourceRoot,
      "-O3",
      "-std=c17",
      "-sMODULARIZE=1",
      "-sEXPORT_ES6=1",
      `-sENVIRONMENT=${environment}`,
      "-sINVOKE_RUN=0",
      "-sEXIT_RUNTIME=1",
      "-sFORCE_FILESYSTEM=1",
      "-sALLOW_MEMORY_GROWTH=1",
      '-sEXPORTED_RUNTIME_METHODS=["FS","callMain"]',
      "-o",
      output,
    ],
    {
      cwd: sourceRoot,
      stdio: "inherit",
    },
  );
}

function exitStatus(error) {
  return error && typeof error === "object" && typeof error.status === "number"
    ? error.status
    : null;
}

async function instantiateNodeTestTool(name, directory, stdout, stderr) {
  const modulePath = path.join(directory, `${name}.mjs`);
  const moduleUrl = `${pathToFileURL(modulePath).href}?test=${Date.now()}-${Math.random()}`;
  const imported = await import(moduleUrl);
  if (typeof imported.default !== "function") {
    throw new Error(`${name}.mjs did not export an Emscripten module factory.`);
  }

  return imported.default({
    noInitialRun: true,
    locateFile(fileName) {
      return path.join(directory, fileName);
    },
    print(text) {
      stdout.push(String(text));
    },
    printErr(text) {
      stderr.push(String(text));
    },
  });
}

function callMain(module, args) {
  try {
    const result = module.callMain(args);
    return typeof result === "number" ? result : 0;
  } catch (error) {
    const status = exitStatus(error);
    if (status === null) {
      throw error;
    }
    return status;
  }
}

async function functionalTestScanIncludes(directory) {
  const stdout = [];
  const stderr = [];
  const module = await instantiateNodeTestTool(
    "scan_includes",
    directory,
    stdout,
    stderr,
  );

  module.FS.mkdirTree("/workspace");
  module.FS.chdir("/workspace");
  module.FS.writeFile(
    "main.asm",
    'INCLUDE "nested.asm"\nINCBIN "gfx/root.pic"\n',
  );
  module.FS.writeFile(
    "nested.asm",
    'INCBIN "data/nested.bin"\n',
  );

  const exitCode = callMain(module, ["--strict", "main.asm"]);
  if (exitCode !== 0) {
    throw new Error(
      `scan_includes functional test exited with ${exitCode}: ${stderr.join("\n")}`,
    );
  }

  const files = stdout.join(" ").trim().split(/\s+/).filter(Boolean);
  for (const expected of ["nested.asm", "data/nested.bin", "gfx/root.pic"]) {
    if (!files.includes(expected)) {
      throw new Error(
        `scan_includes functional test did not report ${expected}. Output: ${stdout.join("\n")}`,
      );
    }
  }
}

async function main() {
  const versionLine = emscriptenVersionLine();
  if (!versionLine.includes(EMSCRIPTEN_VERSION)) {
    throw new Error(
      `Yellow Editor pins Emscripten ${EMSCRIPTEN_VERSION} for helper-tool builds, but '${versionLine}' is active.`,
    );
  }

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "yellow-editor-pret-wasm-"));
  const sourceRoot = path.join(tempRoot, "tools");
  const nodeTestDirectory = path.join(tempRoot, "node-test");

  try {
    await mkdir(sourceRoot, { recursive: true });
    await mkdir(nodeTestDirectory, { recursive: true });
    await rm(outputDirectory, { recursive: true, force: true });
    await mkdir(outputDirectory, { recursive: true });

    const sourceManifest = {};
    for (const [relativePath, blobSha] of Object.entries(SOURCE_FILES)) {
      sourceManifest[relativePath] = await fetchPinnedSource(
        relativePath,
        blobSha,
        sourceRoot,
      );
    }

    for (const tool of TOOL_NAMES) {
      console.log(`Compiling ${tool}.c -> browser WebAssembly`);
      compileTool(tool, sourceRoot, outputDirectory, "web,worker");
    }

    // Build one Node-targeted copy solely for a functional smoke test. The
    // production modules stay browser-only, which avoids Node imports in the
    // modules served directly by GitHub Pages and later by the Tauri WebView.
    compileTool("scan_includes", sourceRoot, nodeTestDirectory, "node");
    await functionalTestScanIncludes(nodeTestDirectory);

    const tools = Object.fromEntries(
      TOOL_NAMES.map((name) => [
        name,
        {
          module: `${name}.mjs`,
          wasm: `${name}.wasm`,
          source: `tools/${name}.c`,
        },
      ]),
    );

    const manifest = {
      schemaVersion: 1,
      family: "pret-gen1",
      generatedAt: new Date().toISOString(),
      source: {
        repository: SOURCE_REPOSITORY,
        commit: SOURCE_COMMIT,
        files: sourceManifest,
      },
      emscripten: {
        version: EMSCRIPTEN_VERSION,
        versionLine,
      },
      tools,
    };

    await writeFile(
      path.join(outputDirectory, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );

    // Ensure every generated browser binary exists before reporting success.
    for (const tool of TOOL_NAMES) {
      const wasm = await readFile(path.join(outputDirectory, `${tool}.wasm`));
      if (
        wasm.length < 8 ||
        wasm[0] !== 0x00 ||
        wasm[1] !== 0x61 ||
        wasm[2] !== 0x73 ||
        wasm[3] !== 0x6d
      ) {
        throw new Error(`${tool}.wasm is not a valid WebAssembly binary.`);
      }
    }

    console.log(
      `Prepared ${TOOL_NAMES.length} pret helper WASM tools from ${SOURCE_REPOSITORY}@${SOURCE_COMMIT}.`,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

await main();
