# Map terrain and warps: first pass

The Maps tab now has **Edit terrain**, **Add warp**, and **Edit selected warp**.

## Add a house to an existing map

1. Open the exterior map and choose **Edit terrain**.
2. Select the roof and wall blocks from the block palette, or turn on **Pick block from map** to sample an existing building. Click or drag to paint the new footprint. Preserve a door tile at its entrance.
3. For a custom block, expand **Edit the tiles inside block**, duplicate the selected block, choose a tile, and paint the block's 4×4 tile grid. Paint the duplicate onto the map. Changes to an existing block affect its occurrences across every map using that blockset; saving requires acknowledging shared blockset changes.
4. Save terrain. Painting uses the 32×32 block grid. Warps and characters use the smaller 16×16 movement grid.
5. Choose **Add warp**, place the entrance on the door, and choose an existing interior map.
6. Choose an existing destination warp, or enable **Create a new return warp in the destination** and place that return on an appropriate exit tile. If necessary, edit the interior's terrain first. The entrance and return save together and can be undone together.
7. Select the new warp and use **Go to …** to inspect the destination. Compile and playtest both directions.

A source warp entry alone does not make ordinary ground act as a door. The existing tileset's collision, door, carpet, ladder and directional movement rules still control activation. Painting changes tile arrangement, not tile graphics or collision tables. Reusing an interior shares its objects and scripts as well as its appearance; this pass does not allocate a separate interior map.

## Save behavior

- Paint strokes have local undo/redo before saving. Saved layout, blockset and warp changes use normal project history, including selective undo and Save As at a history point.
- Binary map and blockset snapshots preserve all byte values. Folder, browser workspace and packed ZIP sources support binary saves.
- New warps append, keeping existing warp IDs stable. Editing preserves formatting, comments, signs, objects and generated arrival tables. Deletion and reordering are intentionally unavailable because incoming references and scripts can depend on the IDs.
- Bounds, duplicate warp positions, occupied object/sign positions, destination warp IDs, available warp slots, reviewed warp macros and source hashes are checked before saving. LAST_MAP is preserved as a dynamic destination; use explicit destinations for a fixed new entrance.
- Unsupported warp expressions, conditional tables, shared map headers, sliced binary includes and incomplete/padded layouts are refused instead of being rewritten.
- Layout files shared under multiple labels require acknowledgment. Blocksets are shared assets, so editing their tile composition always requires acknowledgment.

## Toward independent new maps

This pass edits existing map dimensions and uses existing tile graphics. An independent new interior needs a map-creation operation that allocates a map ID and constant, dimensions, header, block layout, objects, scripts, pointer-table entries and bank/section placement. That operation should create the exterior entrance and interior exits together, check available ROM space, and validate the compiled result. Map resizing, border blocks and outdoor connections can build on the same binary history foundation.

## Validation

```sh
npm run test:maps:edit -- path/to/pokered path/to/pokeyellow
npm run test:maps:edit -- path/to/pokered path/to/pokeyellow --rom path/to/rgbds
npm run test:maps:edit:ui -- path/to/pokered path/to/pokeyellow
```

The ROM test places a second house footprint in Pallet Town, adds an exit tile in an existing interior, compiles Red and Yellow, and verifies both the map layout and reciprocal warp records directly in the ROM. The browser workflow covers painting, local and saved undo/redo, shared block duplication and tile editing, paired warps, validation and navigation at 320, 375 and 1280 pixels. CI uses pinned disassembly revisions from the desktop workflow.
