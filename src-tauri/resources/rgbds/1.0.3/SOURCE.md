# RGBDS 1.0.3 provenance

Yellow Editor prepares its desktop RGBDS resources from the official gbdev RGBDS release:

- Release: `v1.0.3`
- Repository: `gbdev/rgbds`
- Release page: `https://github.com/gbdev/rgbds/releases/tag/v1.0.3`

Pinned official release assets and SHA-256 digests:

| Platform | Asset | SHA-256 |
| --- | --- | --- |
| Windows x64 | `rgbds-win64.zip` | `b66c23cb6d073dd3866ea30ef1ca5164549e0dae9ebe771957aff25e2658b0e3` |
| Windows x86 | `rgbds-win32.zip` | `c46f70d9df52aa72cf0d017a9042768c84bb5b1e9440cb84c0634db13ca5956e` |
| Linux x64 | `rgbds-linux-x86_64.tar.xz` | `280a52061a0c516999bee75ac357628d6d50784309e0486cef25f7460e6f330b` |
| macOS | `rgbds-macos.zip` | `dc1804b187895c4e1b730ba9d4b476052979607e613113b72dc7a494f88c898e` |

`scripts/prepare-rgbds.mjs` verifies these digests before extracting any executable into the Tauri resource tree.
