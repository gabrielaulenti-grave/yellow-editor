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
const RGBDS_WASM_TOOLS = ["rgbasm", "rgblink", "rgbfix"];

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
  return run(process.env.EMCC || "emcc", ["--version"], { capture: true })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? "unknown";
}

function wrapperCmake() {
  return `cmake_minimum_required(VERSION 3.24...4.4 FATAL_ERROR)
project(yellow_editor_rgbds_wasm)

set(BUILD_TESTING OFF CACHE BOOL "" FORCE)
list(PREPEND CMAKE_MODULE_PATH "\${CMAKE_SOURCE_DIR}/cmake-modules")

# RGBDS configures its graphics dependencies even when Yellow Editor only builds
# rgbasm/rgblink/rgbfix. Force the pinned cross-compiled dependencies rather
# than accidentally resolving host libraries during configuration.
set(FETCHCONTENT_TRY_FIND_PACKAGE_MODE NEVER CACHE STRING "" FORCE)
set(PNG_HARDWARE_OPTIMIZATIONS OFF CACHE BOOL "" FORCE)

# Every invocation gets a fresh module and Yellow Editor reads generated files
# after callMain returns, so keep the Emscripten runtime alive rather than
# running process-wide C/C++ shutdown handlers.
add_compile_options(-O2 -g0 -DNDEBUG)
add_link_options(
  -O2
  -g0
  "-sEXPORT_ES6=1"
  "-sALLOW_MEMORY_GROWTH=1"
  "-sENVIRONMENT=web,worker"
  "-sMODULARIZE=1"
  "-sINVOKE_RUN=0"
  "-sEXIT_RUNTIME=0"
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
      ...RGBDS_WASM_TOOLS,
      "--parallel",
    ]);

    await rm(outputDirectory, { recursive: true, force: true });
    await mkdir(outputDirectory, { recursive: true });

    const manifestTools = {};
    for (const tool of RGBDS_WASM_TOOLS) {
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

    await copyFile(
      path.join(sourceDirectory, "LICENSE"),
      path.join(outputDirectory, "RGBDS-LICENSE.txt"),
    );

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
        implementation: "Yellow Editor browser image decoder + RGBDS-compatible Gen I tile encoder",
        reason: "Avoid libpng/Emscripten traps in RGBDS 1.0.3 rgbgfx while preserving the pret Gen I command subset",
        supportedRgbgfxSubset: [
          "--colors dmg",
          "--columns",
          "--depth 1",
          "1bpp/2bpp tile output",
        ],
      },
      tools: manifestTools,
    };
    await writeFile(
      path.join(outputDirectory, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );

    console.log(
      `Prepared RGBDS ${RGBDS_VERSION} browser WASM tools: ${RGBDS_WASM_TOOLS.join(", ")}. Gen I graphics conversion runs in TypeScript/browser APIs.`,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

await main();
