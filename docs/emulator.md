# Integrated emulator

Yellow Editor uses the MIT-licensed [binjgb](https://github.com/binji/binjgb) Game Boy / Game Boy Color emulator for the first integrated test runner.

## Pinned build

- binjgb version: `0.1.11`
- source commit: `8abd0d38d5bf109d7c280b27d815a8b53168adde`
- runtime assets: upstream `docs/binjgb.js` and `docs/binjgb.wasm`
- license: MIT

`scripts/prepare-binjgb-wasm.mjs` downloads the two upstream runtime files plus the license into `public/wasm-tools/binjgb/0.1.11/`. Each downloaded file is checked against its pinned Git blob SHA before it is accepted.

## ROM handling

The web build already returns the generated ROM as an in-memory `BuildArtifact`. The emulator receives those bytes directly; it does not upload the ROM and does not require the user to download and re-open it. Desktop builds also expose the locally generated ROM bytes as a build artifact so the same React emulator panel can be used there.

The ROM bytes are copied into binjgb's WebAssembly linear memory and treated as cartridge data. Yellow Editor never evaluates the ROM as JavaScript or native code. A deliberately malformed ROM could still try to exercise a bug in the emulator, so the ROM size is capped at 8 MiB and the emulator remains subject to the browser/WebView's WebAssembly sandbox.

## First-pass controls

- Screen rendering through a 160 × 144 Canvas 2D surface.
- On-screen D-pad, A, B, Start, and Select buttons using pointer events for touch/mouse input.
- Keyboard: arrow keys, X = A, Z = B, Enter = Start, Tab = Select.
- Pause/resume, reset, and 0.5× / 1× / 2× / 4× speed throttle.

Audio, battery-backed save RAM persistence, save states, and deeper emulator isolation are intentionally deferred to later passes.
