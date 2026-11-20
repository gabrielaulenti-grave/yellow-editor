#!/bin/sh
set -eu
PIN=8abd0d38d5bf109d7c280b27d815a8b53168adde
ROOT=/build/browser-binjgb
git init -q "$ROOT"
git -C "$ROOT" fetch -q --depth 1 https://github.com/binji/binjgb.git "$PIN"
git -C "$ROOT" checkout -q --detach "$PIN"
# Read-only Game Boy memory accessor in the same compilation unit as binjgb's
# actual memory reader. Never expose a memory write entry point.
cat >> "$ROOT/src/emulator.c" <<'EOF'

unsigned beach_read_u8(Emulator* emulator, unsigned address) {
  if (!emulator || address > 0xffff) return 0;
  return read_u8_raw(emulator, (Address)address);
}
EOF
# The upstream exported function list does not include allocator entry points.
# Yellow Editor's prebuilt WASM did, but our custom build must explicitly export
# them for the page to copy the user's ROM into emulated cartridge memory.
sed -i 's/"_set_joyp_up"/"_malloc", "_free", "_beach_read_u8", "_set_joyp_up"/' "$ROOT/src/emscripten/exported.json"
emcmake cmake -S "$ROOT" -B "$ROOT/out/play" -DWASM=ON -DWERROR=OFF -DCMAKE_BUILD_TYPE=Release
cmake --build "$ROOT/out/play" --parallel 2
mkdir -p /build/beach-browser
cp "$ROOT/out/play/binjgb.js" "$ROOT/out/play/binjgb.wasm" /build/beach-browser/
cp "$ROOT/LICENSE" /build/beach-browser/LICENSE.binjgb
test -s /build/beach-browser/binjgb.js
test -s /build/beach-browser/binjgb.wasm
# Assert the exact API the player needs exists in the distributed JS module.
for entry in _malloc _free _beach_read_u8 _emulator_new_simple _get_frame_buffer_ptr; do
  grep -q "Module\\[\\\"$entry\\\"\\]" /build/beach-browser/binjgb.js || {
    echo "Browser emulator is missing export: $entry" >&2; exit 1;
  }
done
