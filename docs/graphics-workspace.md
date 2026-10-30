# Graphics workspace

Open **Graphics** to browse the loaded project's source artwork. **Edit front artwork** and **Edit back artwork** in Pokémon, **Edit portrait artwork** in Trainers, and **Edit tileset artwork** in Maps open the same workspace at the relevant source. **Return to …** returns to the originating editor. Existing sprite assignments and palette editing remain available in their original panels.

## Drawing and tracing

Choose a category or search by name, source path, or assembly label. Source PNGs take precedence over their generated tile/compressed siblings, following the ROM build. Uncompressed 1bpp and 2bpp files can also be edited when no PNG source exists. Binary-only sheets use a rectangular tile arrangement without changing their stored tile order.

The pixel editor provides a pencil with interpolated strokes, bounded flood fill, eyedropper, rectangle selection, internal copy/paste, horizontal/vertical flips, integer zoom, grid and original comparison. Copy/flip uses the selection or the current editing region. On tilesets, pick an 8×8 tile from the sheet, use **Edit region**, or choose the whole sheet. A tile fill cannot spill into adjacent tiles. **Scroll artwork** permits touch scrolling; choose a drawing tool to paint. Arrow keys move the drawing cursor and Space paints; Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z undo/redo local strokes.

**Upload reference image** accepts a PNG, JPEG or WebP up to 16 MB. References may contain arbitrary colors and dimensions, within the displayed limits. Adjust opacity, scale and X/Y position, choose **Move reference** to drag it, or **Fit reference** to fit the current tile/image region. Hide or remove it at any time. The reference is local to the current workspace session. It is never written into project source, exported artwork, or ROM graphics, and must be selected again after leaving the workspace.

**Import artwork PNG** replaces pixels as an undoable local edit. Imported artwork must match the source dimensions and the build converter's opaque grayscale palette requirements: two shades for 1bpp or four for 2bpp. Reference images can be scaled freely without replacing the artwork. **Export artwork PNG** exports the current pixel draft as an opaque grayscale PNG, excluding reference overlays, grids, selections and palette previews.

## Previews and shared source files

The artwork preview displays the complete sheet, independently of the tracing overlay. Grayscale, DMG green and a palette supplied by the originating editor are preview choices; drawing always stores shade indices. Editing source pixels does not change game palette assignments.

Opening tileset artwork from Maps also shows the draft in that map. Collision tables, block composition, sprite assignments, frame layouts and animation commands remain separate. **Source references** lists literal `INCBIN` sites and adjacent labels, including aliases and Pokémon dimension headers. This is a direct reference inventory, not a complete engine dependency graph; computed paths are reported as scan notes. Acknowledge that an edit applies to every use of the source before saving a referenced asset.

## Saves, drafts and limits

**Save graphic** or the global **Save** writes only the authoritative source PNG/raw tile file through the shared project history. No-op saves preserve the original file bytes. Dimensions and bit depth stay fixed. Reopening a document is required if its source, literal references, preferred source format or Makefile changed externally. A failed validation leaves the pixel draft available. PNG cache invalidation and map read-model invalidation apply to saves and project undo/redo.

**Undo stroke** / **Redo stroke** operate on the unsaved pixel draft; project history operates on saved files, including selective undo and Save As. Pixel drafts are retained in device storage independently of the project, with separate main/beta databases. Reopening offers **Resume draft**, **Export draft PNG** and **Discard draft**. A draft whose original source hash or dimensions no longer match can be exported or discarded, without overwriting the changed source. Reference images are not retained in draft storage. If device storage is unavailable, the workspace reports it and PNG export remains available.

The artwork editor does not yet resize sources, edit palettes, compose overworld poses or change collisions. **Move animations** can allocate independent scripts and assemble existing frame sequences and effects; see [the animation composer guide](battle-animations.md). Creating new frame sequences and tile sheets remains future work. **Add trainer class** can create a private copy of an existing portrait as a new source graphic, ready for editing, importing matching artwork or tracing in Graphics. The new class, image, source reference and linker placement share one undoable history entry. For standard projects, the expanded Trainer Pics section is freed from its fixed linker placement so its existing symbolic bank references resolve to a bank with enough room. The section remains together because portrait pointers are bank-relative; arbitrary per-portrait bank loading is not implemented.

Compressed-only assets, ambiguous bit depths, sliced binary consumers other than known dimension headers, and known deduplicated/interleaved compositions explain why they cannot yet be edited. Tileset changes that alter the built tile count through trailing-whitespace trimming are refused so existing tile slots stay intact. Run Build & Test to check ROM space and integration after edits.

## Verification

`npm run test:graphics -- <red> <yellow>` inventories both source trees, decodes and independently re-exports every eligible graphic, checks raw bitplanes/tile order, bounded fills, reference discovery, external changes, source precedence, shared edits, failures and binary history. It verifies map-preview invalidation after a tileset edit and after undo. Add `--native` to compile each project's `pkmncompress` and round-trip edited Pokémon/trainer images through the native compression tools. These checks verify graphics conversion/compression, not complete ROM gameplay.

`npm run test:graphics:ui -- <red> <yellow>` exercises reference upload/transforms, clean exports, brush undo/redo, draft recovery, source conflicts, saves and saved history, tile selection, and layouts at 320, 375 and 1280 pixels, plus application-shell navigation. The graphics CI workflow uses the same pinned disassembly revisions as the desktop checks.
