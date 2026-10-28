# Map creation, terrain and warps

For encounter-table creation/assignment and visible item pickups on new maps, see [Populating maps](map-population.md).

For post-game blockers, compound player conditions, payments and shops, see [NPC conditions and services](npc-conditions-and-services.md).

The Maps tab has **Create map**, **Edit terrain**, **Strength puzzles**, **Map properties**, **Check map**, **Add warp**, and **Edit selected warp**.

## Create an independent map

1. Choose **Create map** and enter an uppercase map constant such as `PALLET_NEW_HOUSE`.
2. Choose an interior terrain template. Copy its terrain, or choose a blank map with custom dimensions and a fill block. The template supplies the tileset; the new map gets its own terrain file, empty object list and script.
3. Choose a border block, town-map location and music from an existing map.
4. Optionally enable **Connect to … now** to add an entrance on the currently selected map and a return warp inside the new map. Place both on appropriate door, stair or warp tiles. For a new house, paint the exterior building with the terrain tools first.
5. Create the map. Maps selects it automatically; its terrain, warps, NPCs and dialogue can then be edited with the existing tools. Compile and playtest the edited game.

Creation saves the map constant and dimensions, header and bank pointers, music, encounter pointer, town-map group/location, assembly section, header, objects, script and binary terrain together. Optional entrance/return warps join the same history entry. Undo removes the created files and entries; redo restores them. Save As can reconstruct a project from before or after creation.

New IDs append after existing maps. `$FF` remains reserved for `LAST_MAP`; the wizard shows the number of available IDs and refuses creation once the table reaches that boundary. This preserves all existing map IDs. Unused-ID reclamation is not implemented. Custom dimensions must be 2–64 blocks per axis and fit the engine's 1300-block buffer including its six-block padding: `(width + 6) × (height + 6) ≤ 1300`.

This version creates interior maps using existing tilesets. It does not copy the template's NPCs, quests, text, encounters or runtime script state. Existing NPC tools work on new maps. New layouts are independent; tile graphics and block definitions remain shared tileset assets. New maps use a floating ROM section, so the linker chooses available bank space; a project with insufficient ROM space will fail compilation.

## Add a house to an existing map

1. Open the exterior map and choose **Edit terrain**.
2. Select the roof and wall blocks from the block palette, or choose **Pick block from map** in **Map tool** to sample an existing building. Choose **Paint blocks** to click or drag the new footprint. On a touchscreen, choose **Scroll map** and swipe horizontally or vertically to move around without painting, then switch back to **Paint blocks**. Block and tile palettes support swipe scrolling and tap selection. Preserve a door tile at its entrance.
3. For a custom block, expand **Edit the tiles inside block**, duplicate the selected block, choose a tile, and paint the block's 4×4 tile grid. Paint the duplicate onto the map. Changes to an existing block affect its occurrences across every map using that blockset; saving requires acknowledging shared blockset changes.
4. Save terrain. Painting uses the 32×32 block grid. Warps and characters use the smaller 16×16 movement grid.
5. Choose **Add warp**, place the entrance on the door, and choose an existing interior map.
6. Choose an existing destination warp, or enable **Create a new return warp in the destination** and place that return on an appropriate exit tile. If necessary, edit the interior's terrain first. The entrance and return save together and can be undone together.
7. Select the new warp and use **Go to …** to inspect the destination. Compile and playtest both directions.

A source warp entry alone does not make ordinary ground act as a door. The existing tileset's collision, door, carpet, ladder and directional movement rules still control activation. Painting changes tile arrangement, not tile graphics or collision tables. Reusing an interior shares its objects and scripts as well as its appearance; use **Create map** to allocate a separate interior map.

## Strength puzzles

Open **Strength puzzles** from the selected map. The preview marks boulder starting positions with **B**, existing targets with **T**, new switches with **S**, holes with **H**, and current triggers with **C**. Placement uses tap selection and swipe scrolling. Boulder, target, landing and current coordinates use the 16×16 movement grid; terrain changes use the 32×32 block grid.

For existing Victory Road and Seafoam puzzles, edit boulder starts, switch/hole coordinates, replacement blocks, player landings and current movement runs. The original event flags, reset rules, object links and current conditions remain intact. Current runs appear in player travel order, even though the native queue stores them in reverse.

To build a new puzzle:

1. Create an independent interior using a cave terrain template, or choose a map without existing native boulder/current scripts. Paint the floor, gates, holes and water first.
2. Add boulders. Each addition saves its own undoable entry; the form remains open. Starting positions can be edited afterward.
3. Add a switch target, choose its boulder and place the target. Add terrain changes, choose replacement blocks and select all targets required to open each path.
4. For a hole, add an independent receiving boulder on another map first. Choose that map, receiving boulder and an existing player landing warp. Saving creates a linked source warp and manages which boulder is visible on each floor. A boulder can receive one incoming drop and have one outgoing drop, allowing chains through several floors. Native or scene-controlled objects cannot be claimed by a new drop.
5. Save upstream targets before adding currents. On the water map, choose a current trigger, completion flags and a sequence of cardinal movement runs. Currents affect surfing players and stop when all selected flags are set. Managed hole landings on CAVERN water automatically place the player in Surf mode.
6. Compile and playtest the complete route, including leaving, returning and saving the game. New completion flags persist in the existing event array without changing its size. Normal boulder positions reset on map entry; completed drops and opened paths are restored from their flags. Existing native puzzles retain their original reset behavior.

New holes require CAVERN hole tiles, and new current routes must remain on CAVERN water. A map supports up to eight targets, eight terrain changes and eight current triggers. Each current supports up to sixteen movement runs totaling sixty-four steps. Existing target identities and types stay stable; positions, boulder links, destinations, terrain changes and currents can be edited. Hole-owned warps must be moved through **Strength puzzles**, keeping player and boulder routes together.

Unrelated NPCs and item pickups can still be added, moved and edited after saving a puzzle. Their dialogue regeneration preserves adjacent puzzle metadata and code. Strength loading accepts comments and blank lines within its managed section, including spacing introduced by older NPC edits; opening the wizard does not rewrite the source. Changed puzzle instructions, missing metadata or altered hooks still require source review.

## Map properties and checks

**Map properties** provides Default / Allowed / Blocked overrides for cycling, Dig/Escape Rope, Teleport, Fly departure and Flash. Defaults reflect native map/tileset rules. Overrides affect one map while preserving normal move, item and badge requirements. Scripted forced-bike routes retain their native behavior. Fly destination registration is separate. Dig and Escape Rope share their native routine and last-healing-location destination.

Lighting can retain native behavior, force normal lighting, or become dark on entry until Flash is used. A dark override resets on entry from another map, including stairs and outdoor connections. Leaving an explicitly lit map clears that override before ordinary or special warps; connected outdoor maps use their destination lighting rule. Loading an existing save preserves its stored lighting state. Rules use banked helper sections and a reviewed bicycle fallback relocation to avoid filling the home bank.

**Check map** reports invalid destinations, unsuitable ordinary warp terrain, missing direct return routes, object/sign/warp overlaps and boulders on questionable terrain. These are review messages: one-way routes, hidden boulders and custom activation scripts can be intentional. A `LAST_MAP` return counts as a direct return only when its incoming source is an outdoor map. Map checks are diagnostics, not a puzzle-solvability proof.

## Save behavior

- Paint strokes have local undo/redo before saving. Saved layout, blockset and warp changes use normal project history, including selective undo and Save As at a history point.
- Binary map and blockset snapshots preserve all byte values. Folder, browser workspace and packed ZIP sources support binary saves.
- New warps append, keeping existing warp IDs stable. Editing preserves formatting, comments, signs, objects and generated arrival tables. Deletion and reordering are intentionally unavailable because incoming references and scripts can depend on the IDs.
- Bounds, duplicate warp positions, occupied object/sign positions, destination warp IDs, available warp slots, reviewed warp macros and source hashes are checked before saving. LAST_MAP is preserved as a dynamic destination; use explicit destinations for a fixed new entrance.
- Unsupported warp expressions, conditional tables, shared map headers, sliced binary includes and incomplete/padded layouts are refused instead of being rewritten.
- Layout files shared under multiple labels require acknowledgment. Blocksets are shared assets, so editing their tile composition always requires acknowledgment.

## Future map tools

Outdoor map creation and connections, resizing existing maps, unused-ID reclamation, tile-pixel editing and collision-table editing remain future work. Creating maps does not allocate per-map WRAM script-state variables or change the save-memory layout.

## Validation

```sh
npm run test:maps:create -- path/to/pokered path/to/pokeyellow
npm run test:maps:create -- path/to/pokered path/to/pokeyellow --rom path/to/rgbds
npm run test:maps:create:ui -- path/to/pokered path/to/pokeyellow
npm run test:maps:edit -- path/to/pokered path/to/pokeyellow
npm run test:maps:edit -- path/to/pokered path/to/pokeyellow --rom path/to/rgbds
npm run test:maps:edit:ui -- path/to/pokered path/to/pokeyellow
npm run test:maps:strength -- path/to/pokered path/to/pokeyellow
npm run test:maps:strength:ui -- path/to/pokered path/to/pokeyellow
npm run test:maps:strength -- path/to/pokered path/to/pokeyellow --rom path/to/rgbds path/to/binjgb
```

The ROM test places a second house footprint in Pallet Town, adds an exit tile in an existing interior, compiles Red and Yellow, and verifies both the map layout and reciprocal warp records directly in the ROM. The browser workflow covers painting, local and saved undo/redo, shared block duplication and tile editing, paired warps, validation and navigation at 320, 375 and 1280 pixels. CI uses pinned disassembly revisions from the desktop workflow.

Map-creation tests cover table registration, independent files, custom dimensions, source guards, browser mirror operations, packed ZIP additions/removals, rollback, undo/redo, selective undo and historical Save As. Native RGBDS tests verify the new map’s bank, header pointers, music, encounter defaults and reciprocal warp bytes in both Red and Yellow.
