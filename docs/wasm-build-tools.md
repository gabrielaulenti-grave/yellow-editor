# Shared WebAssembly build tools

Yellow Editor uses one self-contained ROM build pipeline for both the web app and the Tauri desktop app. The small pret helper programs and the RGBDS assembler/linker/fixer are compiled to WebAssembly ahead of time, while Gen I PNG-to-tile conversion is implemented in TypeScript with browser/WebView image APIs.

End users do not need GNU Make, a C compiler, system RGBDS, Node, npm, or Emscripten to build a ROM.

## Pret helper bundle

`scripts/prepare-pret-tools-wasm.mjs` builds the helper bundle with Emscripten 4.0.15. It pins the helper sources to a specific `pret/pokeyellow` commit and verifies each downloaded source file against its Git blob SHA before compiling it.

The shared Red/Blue and Yellow helper sources are currently byte-identical for:

- `scan_includes`
- `gfx`
- `pkmncompress`
- `make_patch`
- `common.h`

Yellow additionally uses `pcm` for Pikachu audio conversion.

For a normal ROM build, Yellow Editor requires `scan_includes`, `gfx`, and `pkmncompress` for both projects and additionally requires `pcm` when the checkout contains `tools/pcm.c`. `make_patch` is bundled for the later Virtual Console patch workflow but is not required for a normal ROM build.

Generated files live under:

```text
public/wasm-tools/pret-gen1/
  manifest.json
  scan_includes.mjs
  scan_includes.wasm
  gfx.mjs
  gfx.wasm
  pkmncompress.mjs
  pkmncompress.wasm
  make_patch.mjs
  make_patch.wasm
  pcm.mjs
  pcm.wasm
```

## RGBDS bundle

`scripts/prepare-rgbds-wasm.mjs` pins RGBDS 1.0.3 and builds:

```text
public/wasm-tools/rgbds/1.0.3/
  manifest.json
  rgbasm.mjs
  rgbasm.wasm
  rgblink.mjs
  rgblink.wasm
  rgbfix.mjs
  rgbfix.wasm
```

The manifest records the exact RGBDS commit and Emscripten version. Yellow Editor validates the checkout's `.rgbds-version` before enabling the build.

`rgbgfx` is intentionally not executed as RGBDS WASM. The Gen I build graph uses `src/core/gen1Graphics.ts`, which reproduces the RGBDS 1.0.3 DMG graphics behavior needed by current Yellow and Red/Blue sources while avoiding the libpng/Emscripten failure encountered during the original port.

## Runtime design

`src/core/toolRuntime.ts` defines the command-style tool runtime. Each invocation receives arguments plus virtual input files and returns its exit code, stdout, stderr, requested outputs, and elapsed time.

`src/core/pretWasmTools.ts` and `src/core/rgbdsWasm.ts` instantiate fresh Emscripten modules per invocation. This keeps command-line globals, parser state, and `getopt` state isolated between tool calls.

`src/core/webBuildGraph.ts` owns the Yellow and Red/Blue build graph. Despite the historical filename, this graph is shared by both platform adapters:

- the web adapter reads project files through the File System Access API;
- the desktop adapter reads the selected checkout through Tauri filesystem commands;
- both feed identical file bytes into the same build graph and WASM tools.

The generated ROM stays in application memory and can be passed directly to the integrated binjgb emulator without first writing or downloading the ROM.

## Checkout compatibility

The pret helper manifest contains SHA-256 hashes of the exact helper C/header sources used to produce the WASM bundle. Yellow Editor hashes the checkout's corresponding `tools/*.c` and `tools/common.h` files before marking a helper as available.

If pret changes a helper implementation later, Yellow Editor refuses to silently use stale helper modules. Updating the pinned source commit/blob SHAs and rebuilding the bundle is required instead.

## Development and release preparation

The full pinned bundle can be generated in an Emscripten 4.0.15 environment with:

```sh
npm run prepare:wasm-tools
```

For ordinary local Tauri development, `scripts/prepare-shared-wasm-dev.mjs` can synchronize the already-published, pinned RGBDS and pret bundles instead. It verifies the manifest family, pinned source/commit versions, Emscripten version, expected tool names, and WASM magic before accepting the files. This avoids requiring every Yellow Editor contributor to install Emscripten just to run the desktop app.

Release builds generate the WASM assets before Vite packages the frontend. The resulting desktop application therefore carries the required build tools locally; it does not contact GitHub Pages or any other server to compile a user's ROM.
