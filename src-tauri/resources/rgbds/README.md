# RGBDS runtime resources

Yellow Editor's desktop build backend looks here first for a project-compatible RGBDS toolchain before falling back to executables on the user's `PATH`.

Current `pret/pokeyellow` and `pret/pokered` checkouts both request RGBDS **1.0.3** through `.rgbds-version`. Yellow Editor pins that release and prepares the matching official prebuilt archive for the host desktop platform before `tauri dev` or `tauri build` runs.

The generated layout is:

```text
resources/rgbds/1.0.3/bin/
  rgbasm[.exe]
  rgblink[.exe]
  rgbfix[.exe]
  rgbgfx[.exe]
  ...platform runtime files, if supplied by RGBDS
```

The binaries are intentionally not committed to this repository. `npm run prepare:rgbds` downloads the official gbdev release archive, verifies its SHA-256 digest against the pinned manifest in the preparation script, extracts it, and writes the generated resource tree. Tauri then includes that tree in the desktop application bundle.

Configured upstream archives:

- Windows x64: `rgbds-win64.zip`
- Windows x86: `rgbds-win32.zip`
- Linux x64: `rgbds-linux-x86_64.tar.xz`
- macOS x64 / Apple Silicon: `rgbds-macos.zip`

Unsupported desktop architectures skip preparation and may still use a compatible RGBDS installation from `PATH`.

RGBDS is maintained by gbdev and distributed under the MIT license. The license for the pinned release is included next to these resources. Do not place ROMs or Nintendo-owned binary assets in this resource tree.
