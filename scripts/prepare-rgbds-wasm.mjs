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
const TOOLS = ["rgbasm", "rgblink", "rgbfix", "rgbgfx"];

// A tiny original 8x8 grayscale PNG with four two-pixel-wide shade bands.
// This is intentionally embedded rather than borrowed from a game checkout so
// CI can prove that the production rgbgfx module can actually decode PNG data.
const RGBGFX_SMOKE_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAAAAADhZOFXAAAAF0lEQVR4nGP8z7CaYTXDagYmBiggjwEAz4QDEI2ITS0AAAAASUVORK5CYII=";

const repoRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const outputDirectory = path.join(
  repoRoot,
  "public",
  "wasm-tools",
  "rgbds",
  RGBDS_VERSION,
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
  const output = run(process.env.EMCC || "emcc", ["--version"], { capture: true });
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? "unknown";
}

function wrapperCmake() {
  return `cmake_minimum_required(VERSION 3.24...4.4 FATAL_ERROR)
project(yellow_editor_rgbds_wasm)

set(BUILD_TESTING OFF CACHE BOOL "" FORCE)
list(PREPEND CMAKE_MODULE_PATH "\${CMAKE_SOURCE_DIR}/cmake-modules")

# RGBDS 1.0.3 pins zlib 1.3.2 and libpng 1.6.58 in cmake/deps.cmake.
# Do not replace those with Emscripten's generic ports: the port bundled with
# our Emscripten release currently identifies itself as libpng 1.6.39. Force
# FetchContent to cross-compile the dependency versions RGBDS itself declares.
set(FETCHCONTENT_TRY_FIND_PACKAGE_MODE NEVER CACHE STRING "" FORCE)

# Emscripten reports an x86-like processor name to some CMake projects. Do not
# let libpng select native x86 SIMD sources for a WebAssembly build.
set(PNG_HARDWARE_OPTIMIZATIONS OFF CACHE BOOL "" FORCE)

# RGBDS enables CMake IPO/LTO automatically for Release configurations. The
# Emscripten build of rgbgfx traps in its PNG read path with IPO enabled, even
# with RGBDS's own pinned libpng/zlib. Use the non-IPO configuration but retain
# normal optimization explicitly. This is a packaging choice, not a debug build
# exposed to users.
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
foreach(TGT rgbasm rgblink rgbfix rgbgfx)
  set_target_properties(\${TGT} PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "\${RGBDS_WASM_OUT}"
  )

  if(TGT STREQUAL "rgbasm")
    set(EXP_NAME "createRgbAsm")
  elseif(TGT STREQUAL "rgblink")
    set(EXP_NAME "createRgbLink")
  elseif(TGT STREQUAL "rgbfix")
    set(EXP_NAME "createRgbFix")
  else()
    set(EXP_NAME "createRgbGfx")
  endif()

  target_link_options(\${TGT} PRIVATE
    "-sEXPORT_NAME=\${EXP_NAME}"
    "-sEXPORTED_RUNTIME_METHODS=['FS','callMain']"
  )
endforeach()
`;
}

function findZlibCmake() {
  return `# libpng performs its own find_package(ZLIB) even when it is embedded
# through RGBDS FetchContent. At this point RGBDS has already populated zlib
# 1.3.2 and created ZLIB::ZLIB; expose that existing target rather than finding
# a host library or falling back to Emscripten's port.
if(TARGET ZLIB::ZLIB)
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

async function functionalTestRgbgfx(directory) {
  const modulePath = path.join(directory, "rgbgfx.mjs");
  const wasmPath = path.join(directory, "rgbgfx.wasm");
  const moduleUrl = `${pathToFileURL(modulePath).href}?smoke=${Date.now()}`;
  const imported = await import(moduleUrl);
  if (typeof imported.default !== "function") {
    throw new Error("rgbgfx.mjs did not export an Emscripten module factory.");
  }

  const stdout = [];
  const stderr = [];
  const wasmBinary = await readFile(wasmPath);
  const module = await imported.default({
    noInitialRun: true,
    wasmBinary,
    print(text) {
      stdout.push(String(text));
    },
    printErr(text) {
      stderr.push(String(text));
    },
  });

  module.FS.mkdirTree("/workspace");
  module.FS.chdir("/workspace");
  module.FS.writeFile("fixture.png", Buffer.from(RGBGFX_SMOKE_PNG, "base64"));

  const exitCode = callMain(module, [
    "--colors",
    "dmg",
    "-o",
    "fixture.2bpp",
    "fixture.png",
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `rgbgfx PNG smoke test exited with ${exitCode}: ${stderr.join("\n") || stdout.join("\n")}`,
    );
  }

  const output = module.FS.readFile("fixture.2bpp");
  if (output.length !== 16) {
    throw new Error(
      `rgbgfx PNG smoke test produced ${output.length} bytes; expected one 16-byte 2bpp tile.`,
    );
  }

  console.log("Verified rgbgfx can decode and convert PNG input in WebAssembly.");
}

async function main() {
  const versionLine = emscriptenVersionLine();
  if (!versionLine.includes(EMSCRIPTEN_VERSION)) {
    throw new Error(
      `Yellow Editor pins Emscripten ${EMSCRIPTEN_VERSION} for browser tools, but '${versionLine}' is active.`,
    );
  }

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "yellow-editor-rgbds-wasm-"));
  const sourceDirectory = path.join(tempRoot, "rgbds");
  const buildDirectory = path.join(tempRoot, "build");
  const buildOut = path.join(buildDirectory, "out");
  const cmakeModules = path.join(tempRoot, "cmake-modules");

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

    // RGBDS is normally configured as the top-level CMake project. Its CPack
    // setup resolves these two resources through CMAKE_SOURCE_DIR, so mirror
    // them into our wrapper root rather than patching any RGBDS source.
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
      ...TOOLS,
      "--parallel",
    ]);

    await rm(outputDirectory, { recursive: true, force: true });
    await mkdir(outputDirectory, { recursive: true });

    const manifestTools = {};
    for (const tool of TOOLS) {
      const { moduleName, wasmName } = await findBuiltModule(buildOut, tool);
      const moduleDestination = path.join(outputDirectory, `${tool}.mjs`);
      const wasmDestination = path.join(outputDirectory, `${tool}.wasm`);

      await copyFile(path.join(buildOut, moduleName), moduleDestination);
      await copyFile(path.join(buildOut, wasmName), wasmDestination);
      await verifyWasmMagic(wasmDestination);

      manifestTools[tool] = {
        module: `${tool}.mjs`,
        wasm: `${tool}.wasm`,
      };
    }

    // A valid WASM magic header is not enough for rgbgfx: our first port could
    // instantiate but trapped on every PNG. Exercise the exact production
    // module here so a broken graphics converter can never deploy green again.
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
      dependencies: {
        zlib: "1.3.2",
        libpng: "1.6.58",
        source: "RGBDS FetchContent pins",
      },
      tools: manifestTools,
    };

    await writeFile(
      path.join(outputDirectory, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );

    console.log(
      `Prepared RGBDS ${RGBDS_VERSION} WebAssembly toolchain (${TOOLS.join(", ")}).`,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

await main();
