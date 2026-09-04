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
import { fileURLToPath } from "node:url";

const EMSCRIPTEN_VERSION = "4.0.15";
const RGBDS_VERSION = "1.0.3";
const RGBDS_TAG = `v${RGBDS_VERSION}`;
const RGBDS_COMMIT = "307846b03ea89ee57bf75f179d5f8051175ac60d";
const TOOLS = ["rgbasm", "rgblink", "rgbfix", "rgbgfx"];

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

add_compile_options(-O3 -flto)
add_link_options(
  -O3
  -flto
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
  return `set(ZLIB_FOUND TRUE)
set(ZLIB_VERSION_STRING "1.3.2")
set(ZLIB_INCLUDE_DIRS "")
if(NOT TARGET ZLIB::ZLIB)
  add_library(ZLIB::ZLIB INTERFACE IMPORTED GLOBAL)
  set_property(TARGET ZLIB::ZLIB PROPERTY INTERFACE_COMPILE_OPTIONS "--use-port=zlib")
  set_property(TARGET ZLIB::ZLIB PROPERTY INTERFACE_LINK_OPTIONS "--use-port=zlib")
endif()
`;
}

function findPngCmake() {
  return `set(PNG_FOUND TRUE)
set(PNG_VERSION_STRING "1.6.58")
set(PNG_INCLUDE_DIRS "")
if(NOT TARGET PNG::PNG)
  add_library(PNG::PNG INTERFACE IMPORTED GLOBAL)
  set_property(TARGET PNG::PNG PROPERTY INTERFACE_COMPILE_OPTIONS "--use-port=libpng")
  set_property(TARGET PNG::PNG PROPERTY INTERFACE_LINK_OPTIONS "--use-port=libpng")
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
    await Promise.all([
      copyFile(path.join(sourceDirectory, "LICENSE"), path.join(tempRoot, "LICENSE")),
      copyFile(path.join(sourceDirectory, "README.md"), path.join(tempRoot, "README.md")),
    ]);

    // RGBDS uses FetchContent with find_package integration for zlib/libpng.
    // Supply tiny find modules so its normal dependency hooks resolve to the
    // Emscripten ports instead of compiling native-oriented dependency trees.
    await mkdir(cmakeModules, { recursive: true });
    await Promise.all([
      writeFile(path.join(cmakeModules, "FindZLIB.cmake"), findZlibCmake(), "utf8"),
      writeFile(path.join(cmakeModules, "FindPNG.cmake"), findPngCmake(), "utf8"),
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
      "-DCMAKE_BUILD_TYPE=Release",
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
