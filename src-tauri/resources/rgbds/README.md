# RGBDS runtime resources

Yellow Editor's desktop build backend looks here first for a project-compatible RGBDS toolchain before falling back to executables on the user's `PATH`.

The expected layout is:

```text
resources/rgbds/<version>/bin/
  rgbasm[.exe]
  rgblink[.exe]
  rgbfix[.exe]
  rgbgfx[.exe]
```

`<version>` is read from the selected pret checkout's `.rgbds-version` file. This directory currently contains no RGBDS executables; adding pinned upstream binaries/build artifacts is the next packaging step.

RGBDS is maintained by gbdev and distributed under the MIT license. Do not place ROMs or Nintendo-owned binary assets in this resource tree.
