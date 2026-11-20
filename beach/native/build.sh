#!/bin/sh
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
output=${1:-"$here/../.build/beach-emulator"}
commit=8abd0d38d5bf109d7c280b27d815a8b53168adde
source_dir=$(mktemp -d)
trap 'rm -rf "$source_dir"' EXIT HUP INT TERM
git -C "$source_dir" init -q
git -C "$source_dir" fetch -q --depth=1 https://github.com/binji/binjgb.git "$commit"
git -C "$source_dir" checkout -q --detach "$commit"
mkdir -p "$(dirname "$output")"
"${CC:-cc}" -O3 -std=gnu11 -I "$source_dir/src" "$here/bridge.c" \
  "$source_dir/src/common.c" "$source_dir/src/memory.c" -o "$output"
cp "$source_dir/LICENSE" "$(dirname "$output")/LICENSE.binjgb"
