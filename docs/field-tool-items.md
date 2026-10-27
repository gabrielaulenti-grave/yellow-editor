# Field tool items

In **Items → Add Item**, choose an available placeholder or a **New item table
entry**, enter a name and constant, then select **Field tool** on the Behavior
step. Choose **Surf, Flash, Strength, Cut, Fly, Dig or Teleport**.

New tools require no badge or party Pokémon and are reusable by default. You
can select any badge, require a party Pokémon knowing the corresponding move,
and add a player condition using the same All/Any/Not checks as NPC interactions.
Move checks inspect current move knowledge, including fainted party members.
They do not teach moves or add a temporary Pokémon to the party.

Choose whether to consume one item after success. Invalid uses and Fly
cancellation leave the bag unchanged. Key-item status controls tossing and selling;
it does not override an explicitly selected consumption setting.

Customize activation, invalid-target, missing-requirement and cancellation
messages. Use `<PLAYER>` and `<ITEM>` for runtime names. Renaming the item updates
its `<ITEM>` message without rewriting the message. Messages allow eight rows,
with 18 character spaces on the first row and 17 afterward.

Select an authored tool in Items to edit its action, requirements, messages and
consumption alongside its name, price and key-item status. Creation and edits
save atomically and support undo/redo, including item table expansion.

## Action behavior

| Action | Behavior and target checks |
| --- | --- |
| Surf | Native shore/water checks, tile-pair collisions, current/forced-bike restrictions, boarding and dismounting. Yellow retains follower cleanup. A map block prevents boarding; an existing surfer can still attempt to disembark. |
| Flash | Lights the current dark map. An already bright map produces the invalid-use message. Entry lighting rules still apply on re-entry. |
| Strength | Enables native boulder pushing until the game's normal reset. An already active effect does not consume another item. |
| Cut | Uses native cuttable trees and grass in the supported Overworld/Gym tilesets, including native block replacement and animation. This does not make arbitrary terrain cuttable. |
| Fly | Opens the native destination picker. Visited towns are the default; **Offer all native Fly destinations** temporarily expands the picker without marking those towns visited. |
| Dig | Uses native escape eligibility and the native last-healing destination, including Safari cleanup and Yellow-specific exclusions. |
| Teleport | Uses native outdoor eligibility and the last-healing destination. |

**Maps → Map properties** controls action availability independently of badge
and party checks. Cut, Surf and Strength now have permission controls alongside
Fly, Flash, Dig/Escape Rope and Teleport. Explicit Fly/Teleport/Dig permission
can override default map eligibility; a valid native healing destination is
still required. Map changes regenerate dependent item rules in the same save.
Normal Pokémon field moves retain their badge requirements.

## Item capacity and source compatibility

The wizard can reuse the two ordinary unnamed vanilla slots or append entries
beginning at `$62`, after the elevator floor-ID range. Existing item IDs,
compatibility aliases, floor IDs/names and TM/HM IDs stay fixed. Reserved floor
rows are unavailable as items. The first extension stops at `$78`, matching the
reviewed native key-item flag capacity; it does not resize any saved bag or
party arrays. Unsupported layouts explain why a new entry is unavailable.

Field tools require reviewed Red/Yellow routines. Changed generated code,
unsupported native mechanics and stale forms are rejected before saving. Native
HM routines are preserved; item adapters provide item-aware messages without
reading a nonexistent party nickname or playing a Pokémon cry.

## Verification

`npm run test:items:field -- /path/to/pokered /path/to/pokeyellow` checks all seven
actions' creation/editing, table indexing, original item/machine IDs, elevator
names, conditions, source guards, rollback, no-op saves and history.

Add `--rom /path/to/rgbds /path/to/binjgb` for whole-game builds and banked CPU
checks using native collision, block replacement and inventory routines. Drawing,
audio, sprite lookup and Fly input are instrumented in those isolated probes.
The same command also plays full native games through controller input: all
seven tools and Fly cancellation, with no badges and an empty party, runtime
player/item names, expected bag quantities and restored player control.
Fixture-only new-game setup and map geometry accelerate those gameplay tests.

`npm run test:items:field:ui -- /path/to/pokered /path/to/pokeyellow` exercises
the wizard, extended slots, validation, requirements, save/reload and undo/redo
at mobile and desktop widths.
