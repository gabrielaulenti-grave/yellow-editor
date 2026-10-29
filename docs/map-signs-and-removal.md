# Signs, removal review and project map checks

## Signs

Choose **Maps → Place sign**, select an unoccupied 16×16 movement-grid position and enter the dialogue, one game-text row per line. The editor appends a background event and a text pointer without changing existing text IDs. A sign is an interaction location, not a painted graphic: use the terrain tools for its visual appearance, and leave an adjacent place where the player can stand to read it.

Select an **S** marker and choose **Edit sign** to move it and edit resolved plain dialogue in one undoable save. Text changes retain paragraph controls and terminators. Unchanged coordinate expressions and comments are preserved. The editor shows the text source and callers because existing dialogue can be shared. An executable or unresolved handler keeps its existing behavior; its position can still be edited and **Inspect map logic** remains available. Sprite-based clipboards are object records and continue to use the NPC tools.

Creation checks the project's sign/text capacity, character map, dialogue width, occupancy and supported macro encodings. Existing symbolic `dw_const` and plain numeric `dw` text tables are supported. Conditional or unfamiliar record tables require source review. Text and position saves revalidate all inspected assembly sources, save atomically and support project Undo/Redo. New signs do not allocate event flags or change save memory.

## Removal review

Select a sign or object and choose **Review sign removal** or **Review object removal**. The dialog lists the exact source record, effects and any dependencies. Confirm the reviewed operation inside the dialog to remove it; project Undo restores it.

- Background signs can be removed from a supported table. Their pointer and dialogue remain in source, retaining existing text IDs and shared callers. Other signs' editor list numbers can change; their runtime text IDs do not.
- An unreferenced **final ordinary NPC** can be physically removed from a simple map script. Its record and object constant are removed, freeing the slot. Earlier object IDs remain unchanged. Its text pointer and dialogue stay intact.
- A middle object is blocked because removing it shifts later object slots. Pickups, trainers, special encounters, boulders, managed scenes/puzzles, script-controlled objects, custom executable scripts and saved visibility references require dedicated removal adapters. The dialog explains these limits and links to discovered symbol references; it does not substitute permanent hiding for deletion.

Removal retains shared party/text data and event flags, and never compacts saved-state arrays. It supports recognized source layouts and checks known source dependencies; it is not arbitrary assembly analysis. Warps continue to use their existing editor and cannot be deleted by this tool.

Broader removal needs an explicit migration plan: map each old slot to its replacement; update symbolic and numeric script references, movement routes, trainer/header indexing, managed metadata and visibility bindings together; retain saved collection/defeat identity; then compile and exercise affected gameplay. This work is separate from the safe operations above. Automatically deleting apparently unused text or reclaiming flags would also require project-wide reference analysis.

## Project map review

**Check project maps** runs the map diagnostics across every non-unused map with its own header. Shared-header aliases are counted as skipped because their shared layout is checked through its original map. An unreadable map produces its own review message and does not stop other maps.

Reports cover bounds, overlaps, warp destinations and arrivals, ordinary warp terrain, return routes, questionable boulder terrain, source-reader warnings and unresolved positions. Unknown positions are reported rather than used as invented coordinates. **Review in map** selects the affected marker where one is known; **View source** opens its source. Saving or undoing project changes clears stale reports. One-way routes and custom activation scripts remain review messages; this is not a proof that a map or Strength puzzle is solvable.

## Verification

- `npm run test:maps:signs -- <red> <yellow>` covers sign creation, moving and shared-text edits, no-op saves, plain pointers, expressions, comments/CRLF, capacity, unknown dialogue, removal dependencies, stale sources, atomic rollback and Undo/Redo. Project review continues past an unreadable map and reports unresolved coordinates.
- Add `--rom <rgbds>` to compile complete edited Red/Yellow games and inspect emitted sign IDs and object counts after removal.
- `npm run test:maps:signs:ui -- <red> <yellow>` exercises placement, combined position/text edits, removal review, blocked middle-object removal, final-NPC removal and Undo at 320, 375 and 1280 pixels. Project-wide review, source links and report invalidation run at desktop width.

The tests verify emitted map data and authoring workflows; the new sign/removal tests do not simulate reading a sign with controller input or migrating an existing battery save.
