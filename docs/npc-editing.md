# Edit an existing NPC

In **Maps**, select an NPC marker or card and choose **Edit NPC**. Click/tap
walkable ground in the placement preview or enter X/Y movement-tile coordinates.
You can also change the compatible character sprite, facing or wandering mode.
Static sprites such as Snorlax have one pose and stay in place. They use a
separate graphics pool; repeated images share a slot. They can speak, emote, hide
and initiate encounters, but cannot wander or take walking actions.
Use **Save NPC** to update the same object; its ID, dialogue pointer and interaction
remain attached. Saving refreshes the map and retains the selected NPC.

Position changes avoid occupied tiles, warps and signs. Sprite choices respect
outdoor shared sets and indoor graphics budgets. Editing works when the map has
no free slots for another NPC. Trainer/item objects and native script-controlled
actors explain why this form is unavailable rather than changing their special
fields or hard-coded scene assumptions.

For an authored walking/visibility scene, the form lists linked player starts.
**Move linked player starts and coordinate triggers by the same offset** is
selected by default. The preview shows the resulting coordinates. Uncheck it to
keep the existing triggers; saving succeeds only if the revised scene remains
valid. NPCs used in these scenes remain stationary between scripted actions.
Every authored interaction on the map is revalidated, including routes that may
be blocked by a different NPC's new position. A legacy approach/return NPC must
upgrade to walking scene actions before repositioning.

Placement and regenerated scene logic save in one history transaction. **Undo**
and **Redo** apply the complete edit together. Stale forms, changed engine code,
manual edits to generated scenes and invalid routes are refused before writing.
Independent dialogue edits, object IDs, native toggle slots and save/RAM layouts
are preserved. Rebuild the ROM to use the saved changes in play.

Verification:

```sh
npm run test:npcs:edit -- /path/to/pokered /path/to/pokeyellow
npm run test:npcs:edit -- /path/to/pokered /path/to/pokeyellow --rom /path/to/rgbds
npm run test:npcs:edit:ui -- /path/to/pokered /path/to/pokeyellow
```

An unfinished interaction can be closed as a draft before using Edit NPC.
Reopen the interaction and choose Resume draft; the current map is inspected
again. If the project changed, review the scene and use Check scene before saving.
