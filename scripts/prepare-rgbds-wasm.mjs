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

# RGBDS enables CMake IPO/LTO automatically for Release configurations. Keep
# the WASM package on a non-IPO configuration while we validate the portable
# PNG boundary. The explicit optimization flags retain production codegen.
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

async function replaceExactlyOnce(filePath, before, after) {
  const source = await readFile(filePath, "utf8");
  const index = source.indexOf(before);
  if (index < 0) {
    throw new Error(
      `RGBDS WASM adaptation could not find its expected source fragment in ${filePath}. The pinned upstream source may have changed.`,
    );
  }
  if (source.indexOf(before, index + before.length) >= 0) {
    throw new Error(
      `RGBDS WASM adaptation found its source fragment more than once in ${filePath}; refusing an ambiguous edit.`,
    );
  }

  await writeFile(
    filePath,
    `${source.slice(0, index)}${after}${source.slice(index + before.length)}`,
    "utf8",
  );
}

async function applyRgbgfxMemoryIoAdaptation(sourceDirectory) {
  const pngHeader = path.join(sourceDirectory, "include", "gfx", "png.hpp");
  const pngSource = path.join(sourceDirectory, "src", "gfx", "png.cpp");
  const processSource = path.join(sourceDirectory, "src", "gfx", "process.cpp");
  const reverseSource = path.join(sourceDirectory, "src", "gfx", "reverse.cpp");

  await replaceExactlyOnce(
    pngHeader,
    `#include <stdint.h>\n#include <streambuf>\n#include <vector>`,
    `#include <stddef.h>\n#include <stdint.h>\n#include <vector>`,
  );
  await replaceExactlyOnce(
    pngHeader,
    `\tPng(char const *filename, std::streambuf &file);`,
    `\tPng(char const *filename, uint8_t const *data, size_t size);`,
  );

  await replaceExactlyOnce(
    pngSource,
    `struct Input {\n\tchar const *filename;\n\tstd::streambuf &file;\n\n\tInput(char const *filename_, std::streambuf &file_) : filename(filename_), file(file_) {}\n};`,
    `struct Input {\n\tchar const *filename;\n\tuint8_t const *data;\n\tsize_t size;\n\tsize_t offset = 0;\n\n\tInput(char const *filename_, uint8_t const *data_, size_t size_)\n\t    : filename(filename_), data(data_), size(size_) {}\n};`,
  );
  await replaceExactlyOnce(
    pngSource,
    `static void readData(png_structp png, png_bytep data, size_t length) {\n\tInput &input = *reinterpret_cast<Input *>(png_get_io_ptr(png));\n\tstd::streamsize expectedLen = length;\n\tstd::streamsize nbBytesRead = input.file.sgetn(reinterpret_cast<char *>(data), expectedLen);\n\n\tif (nbBytesRead != expectedLen) {\n\t\tfatal(\n\t\t    "Error reading PNG image (\\\"%s\\\"): file too short (expected at least %zd more "\n\t\t    "bytes after reading %zu)",\n\t\t    input.filename,\n\t\t    length - nbBytesRead,\n\t\t    static_cast<size_t>(input.file.pubseekoff(0, std::ios_base::cur))\n\t\t);\n\t}\n}`,
    `static void readData(png_structp png, png_bytep data, size_t length) {\n\tInput &input = *reinterpret_cast<Input *>(png_get_io_ptr(png));\n\tif (input.offset > input.size || length > input.size - input.offset) {\n\t\tsize_t const available = input.offset <= input.size ? input.size - input.offset : 0;\n\t\tfatal(\n\t\t    "Error reading PNG image (\\\"%s\\\"): file too short (expected at least %zu more "\n\t\t    "bytes after reading %zu)",\n\t\t    input.filename,\n\t\t    length - available,\n\t\t    input.offset\n\t\t);\n\t}\n\n\tmemcpy(data, input.data + input.offset, length);\n\tinput.offset += length;\n}`,
  );
  await replaceExactlyOnce(
    pngSource,
    `Png::Png(char const *filename, std::streambuf &file) {\n\tInput input(filename, file);`,
    `Png::Png(char const *filename, uint8_t const *data, size_t size) {\n\tInput input(filename, data, size);`,
  );
  await replaceExactlyOnce(
    pngSource,
    `\tstd::array<unsigned char, 8> pngHeader;\n\tif (input.file.sgetn(reinterpret_cast<char *>(pngHeader.data()), pngHeader.size())\n\t        != static_cast<std::streamsize>(pngHeader.size()) // Not enough bytes?\n\t    || png_sig_cmp(pngHeader.data(), 0, pngHeader.size()) != 0) {\n\t\tfatal("File \\\"%s\\\" is not a valid PNG image", input.filename); // LCOV_EXCL_LINE\n\t}`,
    `\tstd::array<unsigned char, 8> pngHeader;\n\tif (input.size < pngHeader.size()) {\n\t\tfatal("File \\\"%s\\\" is not a valid PNG image", input.filename); // LCOV_EXCL_LINE\n\t}\n\tmemcpy(pngHeader.data(), input.data, pngHeader.size());\n\tinput.offset = pngHeader.size();\n\tif (png_sig_cmp(pngHeader.data(), 0, pngHeader.size()) != 0) {\n\t\tfatal("File \\\"%s\\\" is not a valid PNG image", input.filename); // LCOV_EXCL_LINE\n\t}`,
  );

  await replaceExactlyOnce(
    processSource,
    `struct Image {\n`,
    `static std::vector<uint8_t> readPngBytes(std::string const &path) {\n\tFILE *file = fopen(path.c_str(), "rb");\n\tif (!file) {\n\t\tfatal("Failed to open input image (\\\"%s\\\"): %s", path.c_str(), strerror(errno));\n\t}\n\n\tstd::vector<uint8_t> data;\n\tstd::array<uint8_t, 64 * 1024> buffer;\n\tfor (;;) {\n\t\tsize_t const count = fread(buffer.data(), 1, buffer.size(), file);\n\t\tdata.insert(data.end(), buffer.begin(), buffer.begin() + count);\n\t\tif (count != buffer.size()) {\n\t\t\tif (ferror(file)) {\n\t\t\t\tint const error = errno;\n\t\t\t\tfclose(file);\n\t\t\t\tfatal("Failed to read input image (\\\"%s\\\"): %s", path.c_str(), strerror(error));\n\t\t\t}\n\t\t\tbreak;\n\t\t}\n\t}\n\n\tfclose(file);\n\treturn data;\n}\n\nstruct Image {\n`,
  );
  await replaceExactlyOnce(
    processSource,
    `\texplicit Image(std::string const &path) {\n\t\tFile input;\n\t\tif (input.open(path, std::ios_base::in | std::ios_base::binary) == nullptr) {\n\t\t\tfatal("Failed to open input image (\\\"%s\\\"): %s", input.c_str(path), strerror(errno));\n\t\t}\n\n\t\tpng = Png(input.c_str(path), *input);`,
    `\texplicit Image(std::string const &path) {\n\t\tstd::vector<uint8_t> const input = readPngBytes(path);\n\t\tpng = Png(path.c_str(), input.data(), input.size());`,
  );

  await replaceExactlyOnce(
    reverseSource,
    `[[noreturn]]\nstatic void pngError(png_structp png, char const *msg) {\n\tfatal(\n\t    "libpng error while writing reversed image (\\\"%s\\\"): %s",\n\t    reinterpret_cast<char const *>(png_get_error_ptr(png)),\n\t    msg\n\t);\n}\n\nstatic void pngWarning(png_structp png, char const *msg) {\n\twarnx(\n\t    "libpng found while writing reversed image (\\\"%s\\\"): %s",\n\t    reinterpret_cast<char const *>(png_get_error_ptr(png)),\n\t    msg\n\t);\n}\n\nstatic void writePng(png_structp png, png_bytep data, size_t length) {\n\tFile &pngFile = *static_cast<File *>(png_get_io_ptr(png));\n\tpngFile->sputn(reinterpret_cast<char *>(data), length);\n}\n\nstatic void flushPng(png_structp png) {\n\tFile &pngFile = *static_cast<File *>(png_get_io_ptr(png));\n\tpngFile->pubsync();\n}`,
    `struct PngOutput {\n\tchar const *filename;\n\tstd::vector<uint8_t> bytes;\n};\n\n[[noreturn]]\nstatic void pngError(png_structp png, char const *msg) {\n\tPngOutput &output = *static_cast<PngOutput *>(png_get_error_ptr(png));\n\tfatal(\n\t    "libpng error while writing reversed image (\\\"%s\\\"): %s",\n\t    output.filename,\n\t    msg\n\t);\n}\n\nstatic void pngWarning(png_structp png, char const *msg) {\n\tPngOutput &output = *static_cast<PngOutput *>(png_get_error_ptr(png));\n\twarnx(\n\t    "libpng found while writing reversed image (\\\"%s\\\"): %s",\n\t    output.filename,\n\t    msg\n\t);\n}\n\nstatic void writePng(png_structp png, png_bytep data, size_t length) {\n\tPngOutput &output = *static_cast<PngOutput *>(png_get_io_ptr(png));\n\toutput.bytes.insert(output.bytes.end(), data, data + length);\n}\n\nstatic void flushPng(png_structp) {}\n\nstatic void writePngBytes(std::string const &path, std::vector<uint8_t> const &bytes) {\n\tFILE *file = fopen(path.c_str(), "wb");\n\tif (!file) {\n\t\tfatal("Failed to create \\\"%s\\\": %s", path.c_str(), strerror(errno));\n\t}\n\tif (!bytes.empty() && fwrite(bytes.data(), 1, bytes.size(), file) != bytes.size()) {\n\t\tint const error = errno;\n\t\tfclose(file);\n\t\tfatal("Failed to write \\\"%s\\\": %s", path.c_str(), strerror(error));\n\t}\n\tif (fclose(file) != 0) {\n\t\tfatal("Failed to close \\\"%s\\\": %s", path.c_str(), strerror(errno));\n\t}\n}`,
  );
  await replaceExactlyOnce(
    reverseSource,
    `\tverbosePrint(VERB_NOTICE, "Writing image...\\n");\n\tFile pngFile;\n\tif (!pngFile.open(options.input, std::ios::out | std::ios::binary)) {\n\t\t// LCOV_EXCL_START\n\t\tfatal("Failed to create \\\"%s\\\": %s", pngFile.c_str(options.input), strerror(errno));\n\t\t// LCOV_EXCL_STOP\n\t}\n\tpng_structp png = png_create_write_struct(\n\t    PNG_LIBPNG_VER_STRING,\n\t    const_cast<char *>(pngFile.c_str(options.input)),\n\t    pngError,\n\t    pngWarning\n\t);`,
    `\tverbosePrint(VERB_NOTICE, "Writing image...\\n");\n\tPngOutput pngOutput{options.input.c_str(), {}};\n\tpng_structp png = png_create_write_struct(\n\t    PNG_LIBPNG_VER_STRING,\n\t    &pngOutput,\n\t    pngError,\n\t    pngWarning\n\t);`,
  );
  await replaceExactlyOnce(
    reverseSource,
    `\tpng_set_write_fn(png, &pngFile, writePng, flushPng);`,
    `\tpng_set_write_fn(png, &pngOutput, writePng, flushPng);`,
  );
  await replaceExactlyOnce(
    reverseSource,
    `\tpng_destroy_write_struct(&png, &pngInfo);\n}`,
    `\tpng_destroy_write_struct(&png, &pngInfo);\n\twritePngBytes(options.input, pngOutput.bytes);\n}`,
  );

  console.log(
    `Adapted RGBDS ${RGBDS_VERSION} rgbgfx PNG I/O to pointer+length memory buffers.`,
  );
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

  const wasmBinary = await readFile(wasmPath);
  const instantiate = async () => {
    const stdout = [];
    const stderr = [];
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
    return { module, stdout, stderr };
  };

  const forward = await instantiate();
  forward.module.FS.writeFile(
    "fixture.png",
    Buffer.from(RGBGFX_SMOKE_PNG, "base64"),
  );

  const exitCode = callMain(forward.module, [
    "--colors",
    "dmg",
    "-o",
    "fixture.2bpp",
    "fixture.png",
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `rgbgfx PNG smoke test exited with ${exitCode}: ${forward.stderr.join("\n") || forward.stdout.join("\n")}`,
    );
  }

  const output = forward.module.FS.readFile("fixture.2bpp");
  if (output.length !== 16) {
    throw new Error(
      `rgbgfx PNG smoke test produced ${output.length} bytes; expected one 16-byte 2bpp tile.`,
    );
  }

  const reverse = await instantiate();
  reverse.module.FS.writeFile("fixture.2bpp", output);
  const reverseExitCode = callMain(reverse.module, [
    "-r",
    "1",
    "-o",
    "fixture.2bpp",
    "roundtrip.png",
  ]);
  if (reverseExitCode !== 0) {
    throw new Error(
      `rgbgfx reverse PNG smoke test exited with ${reverseExitCode}: ${reverse.stderr.join("\n") || reverse.stdout.join("\n")}`,
    );
  }

  const roundtrip = reverse.module.FS.readFile("roundtrip.png");
  const pngMagic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (
    roundtrip.length < pngMagic.length ||
    pngMagic.some((byte, index) => roundtrip[index] !== byte)
  ) {
    throw new Error("rgbgfx reverse PNG smoke test did not produce a valid PNG header.");
  }

  console.log(
    "Verified rgbgfx PNG decode/encode paths use the WASM memory-buffer compatibility boundary.",
  );
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

    await applyRgbgfxMemoryIoAdaptation(sourceDirectory);

    // RGBDS is normally configured as the top-level CMake project. Its CPack
    // setup resolves these two resources through CMAKE_SOURCE_DIR, so mirror
    // them into our wrapper root rather than modifying the release metadata.
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

    // A valid WASM magic header is not enough for rgbgfx. Exercise both PNG
    // directions so the compatibility boundary must work before Pages can ship.
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
        sourceAdaptation: "rgbgfx memory-buffer PNG I/O",
        pngIoBoundary: "pointer + length",
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
