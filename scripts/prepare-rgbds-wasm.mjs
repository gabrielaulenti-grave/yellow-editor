import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const EMSCRIPTEN_VERSION = "4.0.15";
const RGBDS_VERSION = "1.0.3";
const RGBDS_TAG = `v${RGBDS_VERSION}`;
const RGBDS_COMMIT = "307846b03ea89ee57bf75f179d5f8051175ac60d";
const OFFICIAL_RGBDS_TOOLS = ["rgbasm", "rgblink", "rgbfix"];
const RUNTIME_TOOLS = [...OFFICIAL_RGBDS_TOOLS, "rgbgfx"];

// rgbgfx's libpng path is not stable in our Emscripten build even after
// removing std::streambuf from libpng's callbacks. The Gen I pret Makefiles
// only need a narrow rgbgfx subset, so Yellow Editor packages a compatibility
// implementation backed by LodePNG. Pin both source files by Git blob SHA.
const LODEPNG_REPOSITORY = "lvandeve/lodepng";
const LODEPNG_COMMIT = "ed6fe5825c6a4fbb7f58ab35a4231c7543cd452a";
const LODEPNG_FILES = {
  "lodepng.cpp": "1a9e3e27c94ac7971579e486bbe17afaa055b1bf",
  "lodepng.h": "8517eaeb8d1f0af945bd79762c69d3ab60c46cce",
  LICENSE: "a5fb0603d9b126906087fae80174cc32d4d5bc14",
};

// Original test fixtures generated specifically for Yellow Editor CI.
const RGBGFX_SMOKE_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAAAAADhZOFXAAAAF0lEQVR4nGP8z7CaYTXDagYmBiggjwEAz4QDEI2ITS0AAAAASUVORK5CYII=";
const RGBGFX_COLUMNS_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAAAAAA6mKC9AAAAHUlEQVR4nGP8zwABjFCaiQEN0EeAZTWUETqw7gAApn8CIseRcjoAAAAASUVORK5CYII=";

const repoRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const outputDirectory = path.join(
  repoRoot,
  "public",
  "wasm-tools",
  "rgbds",
  RGBDS_VERSION,
);
const gen1RgbgfxSource = path.join(
  repoRoot,
  "scripts",
  "wasm",
  "rgbgfx-gen1.cpp",
);

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    cwd: options.cwd,
    env: process.env,
  });
}

function emscriptenVersionLine() {
  return run(process.env.EMCC || "emcc", ["--version"], { capture: true })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? "unknown";
}

function gitBlobSha(bytes) {
  const header = Buffer.from(`blob ${bytes.length}\0`);
  return createHash("sha1").update(header).update(bytes).digest("hex");
}

async function fetchPinnedFile(relativePath, expectedBlobSha, destinationDirectory) {
  const url = `https://raw.githubusercontent.com/${LODEPNG_REPOSITORY}/${LODEPNG_COMMIT}/${relativePath}`;
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
  await writeFile(path.join(destinationDirectory, relativePath), bytes);
  return actualBlobSha;
}

function wrapperCmake() {
  return `cmake_minimum_required(VERSION 3.24...4.4 FATAL_ERROR)
project(yellow_editor_rgbds_wasm)

set(BUILD_TESTING OFF CACHE BOOL "" FORCE)
list(PREPEND CMAKE_MODULE_PATH "\${CMAKE_SOURCE_DIR}/cmake-modules")

# RGBDS configures its graphics dependencies even when we only build the
# assembler/linker/fixer targets. Force its pinned cross-compiled dependencies
# rather than accidentally resolving host libraries.
set(FETCHCONTENT_TRY_FIND_PACKAGE_MODE NEVER CACHE STRING "" FORCE)
set(PNG_HARDWARE_OPTIMIZATIONS OFF CACHE BOOL "" FORCE)

# Keep the browser package off RGBDS's release-only IPO/LTO path while retaining
# normal optimization explicitly.
add_compile_options(-O2 -g0 -DNDEBUG)
add_link_options(
  -O2
  -g0
  "-sEXPORT_ES6=1"
  "-sALLOW_MEMORY_GROWTH=1"
  "-sENVIRONMENT=web,worker"
  "-sMODULARIZE=1"
  "-sINVOKE_RUN=0"
  "-sEXIT_RUNTIME=1"
  "-sFORCE_FILESYSTEM=1"
)

add_subdirectory(rgbds EXCLUDE_FROM_ALL)

set(RGBDS_WASM_OUT "\${CMAKE_BINARY_DIR}/out")
foreach(TGT rgbasm rgblink rgbfix)
  set_target_properties(\${TGT} PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "\${RGBDS_WASM_OUT}"
  )

  if(TGT STREQUAL "rgbasm")
    set(EXP_NAME "createRgbAsm")
  elseif(TGT STREQUAL "rgblink")
    set(EXP_NAME "createRgbLink")
  else()
    set(EXP_NAME "createRgbFix")
  endif()

  target_link_options(\${TGT} PRIVATE
    "-sEXPORT_NAME=\${EXP_NAME}"
    "-sEXPORTED_RUNTIME_METHODS=['FS','callMain']"
  )
endforeach()
`;
}

function findZlibCmake() {
  return `if(TARGET ZLIB::ZLIB)
  set(ZLIB_FOUND TRUE)
  set(ZLIB_VERSION "1.3.2")
  set(ZLIB_VERSION_STRING "1.3.2")
  set(ZLIB_LIBRARIES ZLIB::ZLIB)
  if(DEFINED zlib_SOURCE_DIR)
    set(ZLIB_INCLUDE_DIR "\${zlib_SOURCE_DIR}")
    set(ZLIB_INCLUDE_DIRS "\${zlib_SOURCE_DIR};\${zlib_BINARY_DIR}")
  endif()
  return()
endif()
set(ZLIB_FOUND FALSE)
if(ZLIB_FIND_REQUIRED)
  message(FATAL_ERROR "RGBDS pinned zlib target was not available to libpng")
endif()
`;
}

async function findBuiltModule(buildOut, tool) {
  const entries = await readdir(buildOut);
  const moduleName = entries.find(
    (name) => name === `${tool}.js` || name === `${tool}.mjs`,
  );
  const wasmName = entries.find((name) => name === `${tool}.wasm`);
  if (!moduleName || !wasmName) {
    throw new Error(
      `RGBDS WASM build did not produce ${tool}.js/.mjs and ${tool}.wasm. Found: ${entries.join(", ")}`,
    );
  }
  return { moduleName, wasmName };
}

async function verifyWasmMagic(filePath) {
  const bytes = await readFile(filePath);
  if (
    bytes.length < 8 ||
    bytes[0] !== 0x00 ||
    bytes[1] !== 0x61 ||
    bytes[2] !== 0x73 ||
    bytes[3] !== 0x6d
  ) {
    throw new Error(`${filePath} is not a valid WebAssembly binary.`);
  }
}

function compileGen1Rgbgfx(lodepngDirectory) {
  const emxx = process.env.EMXX || "em++";
  run(emxx, [
    gen1RgbgfxSource,
    path.join(lodepngDirectory, "lodepng.cpp"),
    "-I",
    lodepngDirectory,
    "-O2",
    "-g0",
    "-std=c++20",
    "-sMODULARIZE=1",
    "-sEXPORT_ES6=1",
    "-sEXPORT_NAME=createRgbGfx",
    "-sENVIRONMENT=web,worker",
    "-sINVOKE_RUN=0",
    "-sEXIT_RUNTIME=1",
    "-sFORCE_FILESYSTEM=1",
    "-sALLOW_MEMORY_GROWTH=1",
    '-sEXPORTED_RUNTIME_METHODS=["FS","callMain"]',
    "-o",
    path.join(outputDirectory, "rgbgfx.mjs"),
  ]);
}

function exitStatus(error) {
  return error && typeof error === "object" && typeof error.status === "number"
    ? error.status
    : null;
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

async function loadRgbgfxForTest(directory) {
  const modulePath = path.join(directory, "rgbgfx.mjs");
  const wasmPath = path.join(directory, "rgbgfx.wasm");
  const imported = await import(
    `${pathToFileURL(modulePath).href}?smoke=${Date.now()}-${Math.random()}`
  );
  if (typeof imported.default !== "function") {
    throw new Error("rgbgfx.mjs did not export an Emscripten module factory.");
  }
  const stdout = [];
  const stderr = [];
  const module = await imported.default({
    noInitialRun: true,
    wasmBinary: await readFile(wasmPath),
    print(text) {
      stdout.push(String(text));
    },
    printErr(text) {
      stderr.push(String(text));
    },
  });
  module.FS.mkdirTree("/workspace");
  module.FS.chdir("/workspace");
  return { module, stdout, stderr };
}

function assertBytes(actual, expected, description) {
  if (
    actual.length !== expected.length ||
    expected.some((byte, index) => actual[index] !== byte)
  ) {
    throw new Error(
      `${description} produced unexpected bytes. Got [${Array.from(actual).join(", ")}], expected [${expected.join(", ")}].`,
    );
  }
}

async function functionalTestRgbgfx(directory) {
  // 2bpp: each row is white, light gray, dark gray, black in two-pixel bands.
  // RGBDS DMG ordering yields low plane 0x33 and high plane 0x0f.
  const twoBpp = await loadRgbgfxForTest(directory);
  twoBpp.module.FS.writeFile(
    "fixture.png",
    Buffer.from(RGBGFX_SMOKE_PNG, "base64"),
  );
  let exitCode = callMain(twoBpp.module, [
    "--colors",
    "dmg",
    "-Weverything",
    "-o",
    "fixture.2bpp",
    "fixture.png",
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `Gen I rgbgfx 2bpp smoke test exited with ${exitCode}: ${twoBpp.stderr.join("\n") || twoBpp.stdout.join("\n")}`,
    );
  }
  assertBytes(
    twoBpp.module.FS.readFile("fixture.2bpp"),
    Array.from({ length: 8 }, () => [0x33, 0x0f]).flat(),
    "Gen I rgbgfx 2bpp smoke test",
  );

  // 1bpp uses the same RGBDS four-bin DMG mapping reduced to two shades.
  const oneBpp = await loadRgbgfxForTest(directory);
  oneBpp.module.FS.writeFile(
    "fixture.png",
    Buffer.from(RGBGFX_SMOKE_PNG, "base64"),
  );
  exitCode = callMain(oneBpp.module, [
    "--colors",
    "dmg",
    "--depth",
    "1",
    "-o",
    "fixture.1bpp",
    "fixture.png",
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `Gen I rgbgfx 1bpp smoke test exited with ${exitCode}: ${oneBpp.stderr.join("\n") || oneBpp.stdout.join("\n")}`,
    );
  }
  assertBytes(
    oneBpp.module.FS.readFile("fixture.1bpp"),
    Array(8).fill(0x0f),
    "Gen I rgbgfx 1bpp smoke test",
  );

  // Four uniform tiles arranged TL=white, TR=black, BL=light, BR=dark.
  // --columns must serialize TL, BL, TR, BR, matching RGBDS's Y-first visitor.
  const columns = await loadRgbgfxForTest(directory);
  columns.module.FS.writeFile(
    "columns.png",
    Buffer.from(RGBGFX_COLUMNS_PNG, "base64"),
  );
  exitCode = callMain(columns.module, [
    "--colors",
    "dmg",
    "--columns",
    "-o",
    "columns.2bpp",
    "columns.png",
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `Gen I rgbgfx column-order smoke test exited with ${exitCode}: ${columns.stderr.join("\n") || columns.stdout.join("\n")}`,
    );
  }
  const tile = (low, high) => Array.from({ length: 8 }, () => [low, high]).flat();
  assertBytes(
    columns.module.FS.readFile("columns.2bpp"),
    [
      ...tile(0x00, 0x00),
      ...tile(0xff, 0x00),
      ...tile(0xff, 0xff),
      ...tile(0x00, 0xff),
    ],
    "Gen I rgbgfx column-order smoke test",
  );

  console.log(
    "Verified the libpng-free Gen I rgbgfx compatibility module for 2bpp, 1bpp, and column-major output.",
  );
}

async function main() {
  const versionLine = emscriptenVersionLine();
  if (!versionLine.includes(EMSCRIPTEN_VERSION)) {
    throw new Error(
      `Yellow Editor pins Emscripten ${EMSCRIPTEN_VERSION}, but '${versionLine}' is active.`,
    );
  }

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "yellow-editor-rgbds-wasm-"));
  const sourceDirectory = path.join(tempRoot, "rgbds");
  const buildDirectory = path.join(tempRoot, "build");
  const buildOut = path.join(buildDirectory, "out");
  const cmakeModules = path.join(tempRoot, "cmake-modules");
  const lodepngDirectory = path.join(tempRoot, "lodepng");

  try {
    run("git", [
      "clone",
      "--depth",
      "1",
      "--branch",
      RGBDS_TAG,
      "--single-branch",
      "https://github.com/gbdev/rgbds.git",
      sourceDirectory,
    ]);
    const actualCommit = run("git", ["rev-parse", "HEAD"], {
      cwd: sourceDirectory,
      capture: true,
    }).trim();
    if (actualCommit !== RGBDS_COMMIT) {
      throw new Error(
        `RGBDS ${RGBDS_TAG} resolved to ${actualCommit}, expected ${RGBDS_COMMIT}.`,
      );
    }

    await mkdir(cmakeModules, { recursive: true });
    await Promise.all([
      copyFile(path.join(sourceDirectory, "LICENSE"), path.join(tempRoot, "LICENSE")),
      copyFile(path.join(sourceDirectory, "README.md"), path.join(tempRoot, "README.md")),
      writeFile(path.join(cmakeModules, "FindZLIB.cmake"), findZlibCmake(), "utf8"),
      writeFile(path.join(tempRoot, "CMakeLists.txt"), wrapperCmake(), "utf8"),
    ]);

    run("emcmake", [
      "cmake",
      "-S",
      tempRoot,
      "-B",
      buildDirectory,
      "-G",
      "Ninja",
      "-DCMAKE_BUILD_TYPE=Debug",
      "-DBUILD_TESTING=OFF",
    ]);
    run("cmake", [
      "--build",
      buildDirectory,
      "--target",
      ...OFFICIAL_RGBDS_TOOLS,
      "--parallel",
    ]);

    await rm(outputDirectory, { recursive: true, force: true });
    await mkdir(outputDirectory, { recursive: true });

    const manifestTools = {};
    for (const tool of OFFICIAL_RGBDS_TOOLS) {
      const { moduleName, wasmName } = await findBuiltModule(buildOut, tool);
      await copyFile(
        path.join(buildOut, moduleName),
        path.join(outputDirectory, `${tool}.mjs`),
      );
      await copyFile(
        path.join(buildOut, wasmName),
        path.join(outputDirectory, `${tool}.wasm`),
      );
      await verifyWasmMagic(path.join(outputDirectory, `${tool}.wasm`));
      manifestTools[tool] = {
        module: `${tool}.mjs`,
        wasm: `${tool}.wasm`,
        implementation: "RGBDS 1.0.3",
      };
    }

    await mkdir(lodepngDirectory, { recursive: true });
    const lodepngFiles = {};
    for (const [relativePath, blobSha] of Object.entries(LODEPNG_FILES)) {
      lodepngFiles[relativePath] = await fetchPinnedFile(
        relativePath,
        blobSha,
        lodepngDirectory,
      );
    }
    compileGen1Rgbgfx(lodepngDirectory);
    await verifyWasmMagic(path.join(outputDirectory, "rgbgfx.wasm"));
    await copyFile(
      path.join(lodepngDirectory, "LICENSE"),
      path.join(outputDirectory, "LODEPNG-LICENSE.txt"),
    );
    await copyFile(
      path.join(sourceDirectory, "LICENSE"),
      path.join(outputDirectory, "RGBDS-LICENSE.txt"),
    );
    manifestTools.rgbgfx = {
      module: "rgbgfx.mjs",
      wasm: "rgbgfx.wasm",
      implementation: "Yellow Editor Gen I compatibility adapter",
    };

    await functionalTestRgbgfx(outputDirectory);

    const manifest = {
      schemaVersion: 1,
      family: "rgbds",
      generatedAt: new Date().toISOString(),
      rgbds: {
        version: RGBDS_VERSION,
        tag: RGBDS_TAG,
        commit: RGBDS_COMMIT,
      },
      emscripten: {
        version: EMSCRIPTEN_VERSION,
        versionLine,
        optimization: "O2 without CMake IPO/LTO",
      },
      graphicsCompatibility: {
        reason: "RGBDS 1.0.3 libpng PNG processing traps under the pinned Emscripten runtime",
        supportedRgbgfxSubset: [
          "--colors dmg",
          "--columns",
          "--depth 1",
          "1bpp/2bpp tile output",
        ],
        decoder: {
          repository: LODEPNG_REPOSITORY,
          commit: LODEPNG_COMMIT,
          files: lodepngFiles,
        },
      },
      tools: manifestTools,
    };
    await writeFile(
      path.join(outputDirectory, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );

    for (const tool of RUNTIME_TOOLS) {
      await verifyWasmMagic(path.join(outputDirectory, `${tool}.wasm`));
    }

    console.log(
      `Prepared RGBDS ${RGBDS_VERSION} browser toolchain: official ${OFFICIAL_RGBDS_TOOLS.join(", ")} plus the Gen I rgbgfx compatibility module.`,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

await main();
