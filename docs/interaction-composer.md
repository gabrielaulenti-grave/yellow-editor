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
and name tokens. Each dialogue shows the native arrow and waits for A or B
before another action runs. A dialogue followed directly by a **Yes/No choice**
flows into that menu, including a question at a branch join. The final dialogue
requires one acknowledgement; the interaction suppresses the engine's extra
closing wait. Original dialogue and failed-delivery messages are also readable.
Existing beta sequences receive these fixes when reopened and saved; rebuild
the ROM after saving. Independently edited text rows and flow controls survive.
A **Yes/No choice** follows a question supplied by a dialogue
action; B follows No. **Branch on event** exposes Then and Otherwise. Branches
continue with the following action unless they contain **End interaction**.

For example, an NPC can ask whether the player wants help, check whether they
have the Pokédex, offer a different gift on each branch, heal the party, play a
sound, then say goodbye. A declined No/B path can say “Another time!” and end
without marking the interaction complete. This example needs no tutorial,
mentor, map or Pokémon-specific generator.

| Action | Behavior |
| --- | --- |
| Show dialogue | Print text and wait for A/B; hand a following question to Yes/No directly |
| Yes/No choice | Read `wCurrentMenuItem`; return carry is not the answer |
| Branch on event | Check a project event; Then/Otherwise rejoin |
| Change event | Set or reset the selected event at this point |
| Wait | Pause for 1–255 frames |
| Heal party | Use the native healing routine |
| Play sound | Request a project sound effect, optionally wait for effect channels |
| Give item | Give 1–99 items; stop and leave completion unclaimed on a full bag |
| Give Pokémon | Give a level 1–100 Pokémon using native naming and party/PC delivery |
| Walk NPC | Walk a stationary map NPC along 1–32 cardinal steps, yielding between tiles |
| Walk NPC with player following | Move the NPC, then move the player into its vacated tile |
| Show/hide NPC | Stage an ordinary NPC using a persistent event bit |
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
New walking actions use a resumable scene instead of the synchronous runner.
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

## Walking and coordinate scenes

Adding a walking or visibility action enables scene settings. Choose the player's
starting X/Y movement tile, the trigger (interact or reach coordinates), and the
native map state where the scene may start. Coordinate scenes also use the usual
event requirement and one-time completion settings. Native map states and Oak's
original scene remain intact. Maps without native script tables are supported.

For an Oak-style entrance, create a stationary NPC in Maps, compose its actions,
choose **Reach map coordinates**, and mark that NPC initially hidden. Add
**Show/hide NPC** (visible), dialogue, and **Walk NPC with player following**.
The player must start next to the actor for following. End with dialogue or a
hide action. Use a Yes/No branch to allow declining. A declined coordinate scene
stays latched until the player leaves the trigger tile.

Routes use UP, DOWN, LEFT and RIGHT, separated by commas or whitespace. They
stay within the map, avoid walls, signs and other objects, and keep the
leading actor on screen. Only ordinary stationary NPCs are route actors; trainers
and item objects retain their native behavior. Dynamic blockers, including Yellow's
Pikachu, abort before an occupied step. This initial version does not reroute.
The NPC stays at its destination until moved again or the map reloads. Branches
with different final staging must end separately rather than rejoin.

**Walk NPC** can enter a door or warp tile: native warps check the player's
position and do not transfer an NPC to another map. Follow that walk with
**Show/hide NPC** (hidden) to stage a departure. Player-following routes still
reject warp tiles, as do scene player starts. Walls, occupied positions, map
bounds and the on-screen route limit remain checked.

Walking can run before or after rewards. A scene records successful delivery in
a separate persistent event bit immediately after the gift succeeds. Interrupted
scenes retain this checkpoint, including across map reloads and saved games;
retrying skips delivery and continues the authored actions. Failed delivery sets
no checkpoint and remains available for retry. All mutually exclusive reward
branches share the checkpoint because only one reward per path is supported.
Normal scene completion clears it; one-time scenes also set their completion
flag, while repeatable scenes can give again on the next completed run. The
checkpoint is internal and cannot be changed through authored event actions.
Existing scenes upgrade when saved again; rebuild the ROM after saving.

Successful exits retain authored visibility; incomplete exits restore the
starting visibility. Initial visibility becomes fixed after the first save to
avoid reinterpreting existing saved event bits. Scene visibility flags share the
existing event array; native toggle IDs and save sizes are unchanged.

The runtime borrows 49 bytes from a reviewed unused 56-byte reservation without
moving any existing RAM symbol. Native movement buffers remain separate from
scene bookkeeping. Input is enabled during native dialogue/menu sessions, and
controls and NPC movement fields are restored on exit. Scene state is cleared
on map entry. Each scene has at most 128 dispatcher states.

Battles, music transitions, map-entry triggers, cross-map escorts and persistent
PC-session outcomes still need authoring interfaces and runtime checks. The
Lance/PC lesson remains a regression fixture outside the application bundle.

## Verification

```sh
npm run test:interactions -- /path/to/pokered /path/to/pokeyellow
npm run test:interactions -- /path/to/pokered /path/to/pokeyellow --rom /path/to/rgbds /path/to/binjgb
npm run test:scenes -- /path/to/pokered /path/to/pokeyellow --rom /path/to/rgbds /path/to/binjgb
npm run test:scenes:ui -- /path/to/pokered /path/to/pokeyellow
npm run test:dialogue:ui -- /path/to/pokered /path/to/pokeyellow
```

The source tests exercise reopen/edit/regenerate, neighboring bytes, stale
forms, engine drift, and independent dialogue edits. Full generated ROMs must
assemble for both games. CPU probes execute the generated control flow;
menus, inventory delivery, text, sound and healing are instrumented boundaries,
so these checks do not claim full interactive gameplay validation.

Additional prompt probes execute each game's native prompt, arrow-placement,
manual-scroll and A/B polling routines while instrumenting text drawing and
menus. They verify message retention until input, consecutive dialogue, branch
joins, menu handoff, original dialogue and final-wait suppression, and reproduce
the earlier `done`-terminator overwrite for comparison.
