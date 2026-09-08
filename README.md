# Yellow Editor

A Pokémon Generation I disassembly editor for `pokeyellow` and `pokered` projects.

Yellow Editor has a shared React/TypeScript core with two project adapters:

- **Web:** reads a user-selected disassembly folder directly in the browser with the File System Access API. Project files stay on the user's machine.
- **Desktop:** uses Tauri for the folder picker and native filesystem access while sharing the same TypeScript parsing, editing, ROM build, and emulator layers.

Both platforms use the same self-contained WebAssembly build pipeline: pinned RGBDS assembler/linker/fixer modules, pinned pret helper utilities, and Yellow Editor's Gen I graphics conversion/build graph. End users do not need GNU Make, a C compiler, system RGBDS, Node, or Emscripten to build a ROM.

## Run the web app

```bash
npm install
npm run dev
```

Open the Vite URL in a browser that supports `showDirectoryPicker`, then choose the root of a `pokeyellow` or `pokered` checkout with **Open Project**.

A production web bundle can be created with:

```bash
npm run build
```

The static output is written to `dist/`.

## Run the desktop app

Install the normal Tauri development prerequisites, then run:

```bash
npm install
npm run tauri dev
```

For source development, Yellow Editor synchronizes the already-published pinned WASM tool bundles into `public/wasm-tools` when they are not present locally. Release builds generate and package those assets with the application, so an installed desktop build does not depend on the Yellow Editor website or any external build tools at runtime.

## Current editor coverage

Yellow Editor currently supports source-backed Pokémon data and base-stat editing, move browsing, trainer parsing/editing, wild encounter editing, ROM builds for Yellow and Red/Blue, an integrated Game Boy emulator, and persistent/exportable battery save RAM. The project checkout remains the source of truth, with edit history stored outside the checkout.
