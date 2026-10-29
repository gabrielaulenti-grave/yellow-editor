# Move animation inspection

Open **Graphics → Move animations**, or choose **Inspect move animation in Graphics** from a move in **Moves**.

The explorer reads the open project's move assignments and animation pointer table. It shows every move's ordered `battle_anim` commands, sound cues, selected tile sheets and delay settings. Select a step to inspect its reusable subanimation, frame-block compositions, base coordinates and frame modes. **Edit tile sheet** opens the corresponding artwork; switching back retains the selected move and step. Switching views retains unsaved artwork and the tracing reference.

**Status & other animations** includes status, capture, trade and other entries after the move animations. **Screen & special effects** lists the special-effect pointer table, effect routines and their direct move-script callers. Shared sequence and effect callers are calculated from the current source.

The move inspector also shows `AnimationIdSpecialEffects` hooks, which run after frame blocks, and source for opponent substitutions and generic hit reactions. These matter for moves such as Rock Slide and Explosion: not all visual effects are explicit commands in the move script.

Inspection is read-only. Frame previews assemble the source's `dbsprite` entries from the command's selected tile sheet, respecting tile order, per-sprite flips, transparency and sprite overlap priority. They show isolated source compositions, before base-coordinate placement, opponent transforms, frame retention, runtime palette changes, battle state and effect routines. The delay is an engine setting, not a guaranteed total duration. This is not a battle emulator or animation-script editor.

The reader supports the Gen I `battle_anim`, `subanim`, `dbsprite`, pointer-table and constant layouts used by Red and Yellow. Aliases and fall-through sequences are followed. Unsupported commands and unresolved structures appear as inspection notes; unsupported conditional pointer tables are not assigned guessed IDs. Refresh sources after external edits. Effect source bodies are displayed, not executed or automatically translated into a full animation simulation.

Validation:

```sh
npm run test:animations -- /path/to/pokered /path/to/pokeyellow
npm run test:graphics:ui -- /path/to/pokered /path/to/pokeyellow
```

The source check covers every move, subanimation, frame block and special effect in both fixtures; shared aliases; engine hooks; reassigned animation IDs; malformed/unsupported structures; and composition pixel semantics. The browser workflow covers effect inspection, engine hooks, frame previews, status browsing, tile-sheet navigation, unsaved artwork retention, return navigation and mobile layouts.
