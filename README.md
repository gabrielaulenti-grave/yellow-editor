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

### Main and beta URLs

- [Main app](https://gabrielaulenti-grave.github.io/yellow-editor/) builds from `main`.
- [Beta app](https://gabrielaulenti-grave.github.io/yellow-editor/beta/) builds from `beta`, which can contain unmerged PR changes.

Pages publishes both builds as one artifact. A main deployment preserves the beta URL, and a beta deployment preserves the main app. Beta has a visible testing banner and separate browser edit history, trainer caches, and emulator battery saves. Project folders remain user-selected files: use **Save As** or a separate project copy when testing beta edits.

To promote a PR for browser testing, update the `beta` branch with the desired PR and the Pages channel infrastructure. A push to `beta` runs **Check desktop app**; a successful push check automatically starts **Deploy web app to GitHub Pages** from `main`. The deployment pins current `main` and the latest beta revision that passed push checks, then verifies their asset paths before publishing. A newer beta revision that fails checks leaves the previous passing beta available. `release.json` at each URL records the exact deployed commit. Updating beta does not merge the feature into main.

For a manual rebuild of both URLs, open **Actions → Deploy web app to GitHub Pages → Run workflow** and select `main`. A failed build never publishes a partial site.

## Run the desktop app

Install the normal Tauri development prerequisites, then run:

```bash
npm install
npm run tauri dev
```

For source development, Yellow Editor synchronizes the already-published pinned WASM tool bundles into `public/wasm-tools` when they are not present locally. Release builds generate and package those assets with the application, so an installed desktop build does not depend on the Yellow Editor website or any external build tools at runtime.

## Current editor coverage

The [vanilla script atlas](docs/script-atlas.md) inventories every Red/Blue and
Yellow script file, with complete per-map tables, scoped references, helper
boundaries, classification gaps, and the roadmap for a scene composer. Run
`npm run scripts:atlas -- /path/to/pokered /path/to/pokeyellow` to regenerate its
pinned source reports; `npm run test:scripts:atlas` checks the inventory scanner.

Yellow Editor currently supports source-backed Pokémon data and base-stat editing, move browsing, trainer parsing/editing, wild encounter editing, source-backed tile/block/map visualization with warp, sign-text, branched NPC dialogue, outdoor-map, and wild-encounter cross-navigation, ROM builds for Yellow and Red/Blue, an integrated Game Boy emulator, and persistent/exportable battery save RAM. The project checkout remains the source of truth, with edit history stored outside the checkout.

### Add an NPC

In **Maps**, select a map and choose **Add NPC** below its preview. Click or tap walkable ground, choose a compatible character and facing or wandering pattern, then write dialogue or reuse plain dialogue from that map. Review and create the NPC; its placement and dialogue save together as one undoable change. Select the new NPC to edit its dialogue afterward.

Outdoor choices respect shared sprite sets, including both halves of split maps. Indoor choices track separate animated and stationary graphics slots, and Yellow reserves the follower's object slot. Static sprites such as Snorlax stay in place and can use dialogue, visibility, emotes and encounters. Existing object IDs stay in place; sign text pointers shift above the expanded object range. Trainers, items, and story routines are never assigned as a new NPC's interaction. Maps with ambiguous source tables, unsupported macros, exhausted slots, or numeric text dispatches that cannot be preserved refuse creation.

Placement checks map bounds and existing objects/warps; choose walkable terrain in the preview. After creating an NPC, use Edit interaction to compose its actions.
The [reviewed engine contracts](docs/script-engine-contracts.md) document choice outcomes, audio scheduling, and resumable movement waits, with source fingerprints and CPU boundary tests.

Select an ordinary NPC or sign in **Maps** and use **Edit interaction → Compose action sequence** to build ordered dialogue, Yes/No choices, event branches, rewards, healing, waits, sound effects, music changes, fades, emotes, walking/following routes, Yellow partner detection/movement and wild or trainer battles. The same composer is available in **Scripts**. Unsupported interactions explain their limitation and offer **View script**. Branches can rejoin the following action or end without claiming completion. Existing approach/return routes and atomic undo remain available. See [interaction composition](docs/interaction-composer.md) for scope and retry behavior.

The [Viridian PC lesson](docs/pc-tutorial.md) is a regression scenario for the scripting tools. It is not a dedicated product button. Coordinate and arrival-warp triggers, movement and battles are available through the general composer. Cross-map escorts and persistent PC-session tracking remain future work.

Interaction edits are kept as recoverable drafts on the current device, separately from project source. Close an invalid scene to repair an NPC, then reopen and choose Resume draft. Scene review shows trigger/state requirements; Check scene validates without writing assembly and identifies affected actions and blocked tiles. Save applies the validated interaction to the project as an undoable edit.
