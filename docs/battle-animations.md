# Move animation inspection

Open **Graphics → Move animations**, or choose **Inspect move animation in Graphics** from a move in **Moves**.

The explorer reads the open project's move assignments and animation pointer table. It shows every move's ordered `battle_anim` commands, sound cues, selected tile sheets and delay settings. Select a step to inspect its reusable subanimation, frame-block compositions, base coordinates and frame modes. **Edit tile sheet** opens the corresponding artwork; switching back retains the selected move and step. Switching views retains unsaved artwork and the tracing reference.

**Status & other animations** includes status, capture, trade and other entries after the move animations. **Screen & special effects** lists the special-effect pointer table, effect routines and their direct move-script callers. Shared sequence and effect callers are calculated from the current source.

The move inspector also shows `AnimationIdSpecialEffects` hooks, which run after frame blocks, and source for opponent substitutions and generic hit reactions. These matter for moves such as Rock Slide and Explosion: not all visual effects are explicit commands in the move script.

Choose **New animation**, **Duplicate as new animation**, or **Edit animation steps** to open the composer. Add, remove, duplicate or reorder existing frame sequences and special effects; choose tile sheets, delay settings and existing move sound cues; optionally select a per-frame hook and a move assignment. New animations append after all existing pointers, including Red's unnamed extra pointer, preserving their IDs. Copies start without a hook; select one explicitly. Engine branches keyed to an original ID, including opponent substitutions, are not automatically cloned.

Creating or editing an animation and assigning it to a move is one saved history operation. Editing redirects the selected ID to a private script when the original commands are shared by aliases. Subsequent edits reuse private blocks when they have no other references. Editing requires acknowledging every use of the ID. Shared frame sequences and effect routines remain unchanged. Source changes during a draft require reloading the composer. Animation drafts have local undo/redo while the composer is open; closing or leaving the workspace asks before discarding them. They do not yet have persistent draft recovery.

Frame previews assemble the source's `dbsprite` entries from the command's selected tile sheet, respecting tile order, per-sprite flips, transparency and sprite overlap priority. They show isolated source compositions, before base-coordinate placement, opponent transforms, frame retention, runtime palette changes, battle state and effect routines. The delay is an engine setting, not a guaranteed total duration. Full battle playback, creating frame sequences and allocating new tile sheets remain future work.

The reader supports the Gen I `battle_anim`, `subanim`, `dbsprite`, pointer-table and constant layouts used by Red and Yellow. Aliases and fall-through sequences are followed. Unsupported commands and unresolved structures appear as inspection notes; unsupported conditional pointer tables are not assigned guessed IDs. Refresh sources after external edits. Effect source bodies are displayed, not executed or automatically translated into a full animation simulation.

Validation:

```sh
npm run test:animations -- /path/to/pokered /path/to/pokeyellow
npm run test:graphics:ui -- /path/to/pokered /path/to/pokeyellow
npm run test:animations:gameplay -- /path/to/pokered /path/to/pokeyellow --rom /path/to/rgbds /path/to/binjgb
```

The source check covers every move, subanimation, frame block and special effect in both fixtures; shared aliases; engine hooks; reassigned animation IDs; malformed/unsupported structures; composition pixel semantics; allocation; atomic history and rollback; and private trainer portrait creation. Browser checks cover inspection and authoring on mobile and desktop. Native gameplay fixtures create an animation and a trainer class with its own portrait through production writers, compile the game, and drive a real battle with ordinary input.
