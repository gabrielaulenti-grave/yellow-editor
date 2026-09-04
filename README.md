# Yellow Editor

A Pokémon Generation I disassembly editor for `pokeyellow` and `pokered` projects.

Yellow Editor has a shared React/TypeScript core with two project adapters:

- **Web:** reads a user-selected disassembly folder directly in the browser with the File System Access API. Project files stay on the user's machine.
- **Desktop:** uses Tauri for the folder picker and filesystem access while sharing the same TypeScript parsing layer.

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

Install the normal Tauri prerequisites, then run:

```bash
npm install
npm run tauri dev
```

The desktop build keeps native folder access while using the same Pokémon and move parsers as the web build.

## Current editor coverage

The project currently reads Pokémon base stats, evolutions, level-up learnsets, Pokédex data, sprites, TM/HM compatibility, and move data/animation scripts. Editing support will be layered onto the same shared project abstraction.
