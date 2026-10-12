# Compose scripted interactions

Select an ordinary NPC or sign, open **Edit interaction**, and choose
**Compose action sequence** in the **Maps** inspector or **Scripts** tab.
The map inspector also offers **View script** at the object's original entry;
unsupported interactions explain why composition is unavailable. Dialogue
editing retains its resolved text target, including Yellow's forwarded dialogue.
Saving refreshes the map while retaining the selected object. Unsaved map
interaction changes participate in the application's tab/project switch guards.
Existing managed item/Pokémon interactions can
upgrade to the composer. Their reward and dialogue become ordered actions;
the original dialogue, one-time setting, repeat dialogue, event requirements,
success effects and approach/return route are retained.

Add, remove and reorder actions. Dialogue supports the existing text row limits
and name tokens. A **Yes/No choice** follows a question supplied by a dialogue
action; B follows No. **Branch on event** exposes Then and Otherwise. Branches
continue with the following action unless they contain **End interaction**.

For example, an NPC can ask whether the player wants help, check whether they
have the Pokédex, offer a different gift on each branch, heal the party, play a
sound, then say goodbye. A declined No/B path can say “Another time!” and end
without marking the interaction complete. This example needs no tutorial,
mentor, map or Pokémon-specific generator.

| Action | Behavior |
| --- | --- |
| Show dialogue | Print an editable game text block |
| Yes/No choice | Read `wCurrentMenuItem`; return carry is not the answer |
| Branch on event | Check a project event; Then/Otherwise rejoin |
| Change event | Set or reset the selected event at this point |
| Wait | Pause for 1–255 frames |
| Heal party | Use the native healing routine |
| Play sound | Request a project sound effect, optionally wait for effect channels |
| Give item | Give 1–99 items; stop and leave completion unclaimed on a full bag |
| Give Pokémon | Give a level 1–100 Pokémon using native naming and party/PC delivery |
| End interaction | Exit early, optionally commit completion and success events |

Reaching the end of the outer sequence completes it. **End interaction** with
completion unchecked permits retry and does not apply the one-time flag or
success events. A failed gift also takes that incomplete exit, shows the
configurable no-room dialogue and returns an approaching NPC. Events changed
by explicit actions earlier in the sequence are not rolled back; use success
effects for changes that should depend on completed delivery.

Each execution path may deliver one reward. Mutually exclusive branches can
offer different rewards. Several rewards on one path are rejected because a
later failure would allow an earlier reward to be duplicated on retry. A
one-time gift path must complete; an incomplete early end belongs before
delivery. Per-reward persistent progress is future work.

The existing NPC approach is an outer scene: walk, yield until arrival, run
the composed interaction, return, yield, restore facing/input/map state.
Movement cannot be placed arbitrarily inside the synchronous action sequence.
Native Poké Ball interactions with a hide-after-delivery action retain their
existing editor; they cannot upgrade to the composer yet.

## Source and editing guarantees

New dialogue/actions are one atomic history transaction with any needed
completion-bit allocation and map-state changes. Reopening preserves the
sequence. Action dialogue also remains editable through **Edit text**, and
regeneration retains existing text flow controls, including when actions are
reordered. Unrelated source blocks and
existing object IDs are preserved. Completion bits use verified unused space
without resizing the save layout; editor-owned completion flags are excluded
from the user event controls.

Choice and sound actions require the reviewed engine fingerprints. Source
hashes reject stale forms; generated-code comparisons reject overwriting
manual changes. Sound declarations remain symbolic linker expressions; the
composer does not guess their IDs. Playback uses the current audio bank and
fade state. Effect waits cover channels 5, 6 and 8, and the low-health alarm
can bypass the wait. Music replacement/restoration is not exposed here.

An interaction supports up to 64 actions and four nested branches. Empty
branches fall through. Actions after an unconditional end are rejected.

## General scene authoring still needed

This is a reusable interaction composer, not the complete scene editor.
Map-entry/coordinate triggers, arbitrary player/NPC movement states, battles,
general object staging, music transitions and persistent PC-session outcomes
still need authoring interfaces and composition/runtime checks. The Lance/PC
lesson is a regression fixture exercising these requirements; its generator
and wizard live under `tests/`, outside the application session API and bundle.
Existing lesson assembly remains accessible through normal script/source
editing. This change does not convert previously generated lessons into
composer sequences.

## Verification

```sh
npm run test:interactions -- /path/to/pokered /path/to/pokeyellow
npm run test:interactions -- /path/to/pokered /path/to/pokeyellow --rom /path/to/rgbds /path/to/binjgb
npm run test:dialogue:ui -- /path/to/pokered /path/to/pokeyellow
```

The source tests exercise reopen/edit/regenerate, neighboring bytes, stale
forms, engine drift, and independent dialogue edits. Full generated ROMs must
assemble for both games. CPU probes execute the generated control flow;
menus, inventory delivery, text, sound and healing are instrumented boundaries,
so these checks do not claim full interactive gameplay validation.
