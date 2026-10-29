# Encounters and item pickups on new maps

Create a map and connect its warps first. New maps start with an independent
object list and no encounters; a terrain template does not copy its residents.

## Assign wild encounters

In **Maps**, select the map and choose **Assign encounters** in the Wild
encounters card. The same control also works on existing maps.

- **Create a new empty table** makes an independent table with walking/cave and
  surfing encounters disabled. Choose **Open in Wild Encounters**, enable the
  desired encounter type, then set all ten Pokémon/level slots and the rate.
- **Copy a table into an independent table** copies encounters, rates and native
  Red/Blue differences. Edits to the copy do not change the template's table.
- **Share an existing table** points the map at the selected table. The dialog
  lists the other locations affected by later edits to that shared table.
- **No wild encounters** removes only this map's assignment. It does not delete
  the old table or alter other maps.

Replacing an existing assignment requires acknowledgment. New table files,
their includes and the map pointer save as one undoable change. Undo removes a
newly created file and restores the old assignment; redo restores both. Changed
sources and unsupported pointer layouts are rejected before saving.

For DIGLETT_BASEMENT, copy Diglett's Cave for similar encounters, or start empty
and configure its own species and levels. Encounter-capable terrain is still
required: assigning data does not change tileset collision/encounter rules.
Walking encounters in a cave use the editor's **Grass** category. Fishing uses
its separate native tables and is not assigned by this dialog.

## Place visible items

Choose **Place item** in the map's **NPCs & items** panel. Select an item
(including TM/HM items), quantity 1–99 and an unoccupied movement-grid position.
Tap the placement map or enter coordinates. Existing objects, warps and signs
are marked. Place items where the player can reach and interact with them.

New pickups default to two receipt rows: `<PLAYER> received` and the in-game
item name followed by `!` (for example, `TM28!`). Existing pickups keep their
saved dialogue; change it through **Edit interaction → Dialogue after delivery**.

Each pickup uses one object slot and compatible Poké Ball graphics. If a map's
graphics budget is full, the editor explains why placement is unavailable.
Successful delivery hides the object immediately and keeps it collected in
the player's save. A full bag leaves the item available. A loaded save or a map
reload does not respawn a collected pickup.

Select the new object and use **Edit NPC** to move it, or **Edit
interaction** to change its reward and dialogue. Its one-time collection and
visibility settings are managed together. Review the dialogue when changing
the item or quantity. Placement, interaction, event allocation and the needed
runtime changes save atomically and support undo/redo. Existing event and native
toggle-object IDs are not renumbered, and the save layout is not enlarged.

For trainers, use **Place trainer** in the same panel. See
[trainer placement](map-trainers.md) for independent parties, sight challenges
and persistent defeat flags. Hidden-item placement remains a separate future tool.

## Verification

`npm run test:maps:populate -- /path/to/pokered /path/to/pokeyellow` checks new
maps, empty/copy/share/remove assignments, Red/Blue preservation, rollback,
stale-source guards, cache refresh and pickup history. Add
`--rom /path/to/rgbds /path/to/binjgb` for complete ROM builds, linked encounter
pointer verification and CPU checks of the generated pickup with native bag
delivery. Those CPU checks instrument text, sound and the sprite-refresh entry;
they execute the generated visibility predicate with retained event state.

`npm run test:maps:populate:ui -- /path/to/pokered /path/to/pokeyellow` exercises
new-map encounter and item authoring at 320, 375 and 1280px, including replacement
acknowledgment and reward save/reopen.
