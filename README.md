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

Yellow Editor currently supports source-backed Pokémon data and base-stat editing, move browsing, trainer parsing/editing, wild encounter editing, source-backed tile/block/map visualization with warp, sign-text, branched NPC dialogue, outdoor-map, and wild-encounter cross-navigation, ROM builds for Yellow and Red/Blue, an integrated Game Boy emulator, and persistent/exportable battery save RAM. The project checkout remains the source of truth, with edit history stored outside the checkout.

### Add an NPC

In **Maps**, select a map and choose **Add NPC** below its preview. Click or tap walkable ground, choose a compatible character and facing or wandering pattern, then write dialogue or reuse plain dialogue from that map. Review and create the NPC; its placement and dialogue save together as one undoable change. Select the new NPC to edit its dialogue afterward.

Outdoor choices respect shared sprite sets, including both halves of split maps. Indoor choices respect graphics memory, and Yellow reserves the follower's object slot. Existing object IDs stay in place; sign text pointers shift above the expanded object range. Trainers, items, and story routines are never assigned as a new NPC's interaction. Maps with ambiguous source tables, unsupported macros, exhausted slots, or numeric text dispatches that cannot be preserved refuse creation.

Placement checks map bounds and existing objects/warps; choose walkable terrain in the preview. Phase 1 creates dialogue NPCs. Battles, rewards, visibility flags, and scripted movement are outside this workflow.
