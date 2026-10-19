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
| Branch on player position | Test an exact X/Y tile or the player's side of a map NPC; Then/Otherwise rejoin the next action |
| Face NPC | Turn an animated NPC in place toward a cardinal direction or toward the player |
| Face player | Turn the player in place toward a cardinal direction or toward a selected NPC |
| Walk NPC with player following | Move the NPC, then move the player into its vacated tile |
| Show/hide NPC | Stage an ordinary NPC using a persistent event bit |
| NPC emote | Show a native emotion bubble over a visible, on-screen NPC for 60 frames |
| Change music | Play a project track in its audio bank, stop music, or restore the map's usual music |
| Screen fade | Fade to black or fade back in; hide/show actors and wait while the screen stays dark |
| Wild Pokémon encounter | Choose a species and level, optionally play its cry, then branch on defeat, capture or escape |
| Trainer battle | Fight an existing trainer party and continue through its victory branch |
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

Saving an item gift also repairs Red/Blue's native end-of-bag stack scan. Without
that correction, adding more of the last item when its stack overflows can scan
past the inventory and overwrite map/save data. Yellow already checks this
boundary and stays unchanged. The repair is included in the same undoable save
for ordinary rewards, nested item actions and scenes, and adds no ROM bytes or
RAM fields. Existing item-giving interactions receive it when reopened and
saved; rebuild the ROM afterward. It prevents further corruption but does not
restore data already changed in a save file.

The existing NPC approach is an outer scene: walk, yield until arrival, run
the composed interaction, return, yield, restore facing/input/map state.
New walking actions use a resumable scene instead of the synchronous runner.
Native Poké Ball interactions with a hide-after-delivery action retain their
existing editor; they cannot upgrade to the composer yet.

Music, screen effects and battles use resumable scenes. **Change music** resolves
both the song and its bank from the project's music headers. Temporary changes
return to the map's usual music on exit; **Keep music after normal scene
completion** retains the selected cue until the game changes music again.
Aborting restores map music. A battle reloads the map and its music, so put a new
music action after the battle if the next part of the scene needs another cue.

For Giovanni's disappearance effect, use **Screen fade: Fade to black**, then
**Show/hide NPC: hidden**, then **Screen fade: Fade back in**. Wait, visibility,
music and event actions can run while black. Restore the screen before dialogue,
movement, rewards, emotes or battles. Branches that rejoin must agree on screen
brightness as well as actor staging. Ending or aborting while black restores
the previous map brightness, including a map darkened before the scene began.

**Wild Pokémon encounter** uses normal wild-battle rules, including capture into
the party or PC. Defeated and Caught branches rejoin the next action unless they
explicitly end; Escaped defaults to an incomplete end so the encounter can be
retried. Add a hide action after the successful branches to remove an overworld
Pokémon. For a one-time Snorlax/Mewtwo-style encounter, keep **Run once per save
file** enabled. **Trainer battle** selects an existing class/party; it uses its
native roster, AI and prizes without claiming the original map trainer's defeat
event. Add victory dialogue and success events in the composer.

Battle launch yields to the native overworld battle dispatcher. Victory,
capture and escape reload the map before the scene resumes, preserving authored
stationary actor positions and visibility. Losing ends the scene without
completion and lets the game's normal defeat/blackout handling continue. Normal
scripted battles are unavailable in the four Safari battle maps. An empty or
entirely fainted party cannot launch a battle.

Each battle has a stable identity and separate persistent defeat/capture
checkpoints. If a later reward fails or the scene is interrupted, retrying skips
the resolved battle and continues through its recorded result, preventing a
second capture. Escape records no resolved checkpoint. Normal scene completion
retires these checkpoints; one-time scenes also retain their completion bit.
Internal checkpoints are excluded from the editable event list. The additional
runtime fields reuse six bytes of the existing unused reservation, preserving
all existing WRAM/save addresses. Existing beta scenes migrate atomically on save.

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

Use **Add player start** to let the same scene begin from several coordinates,
including different sides of an NPC. Keep the original X/Y and add the other
tiles from which the player can address that NPC or sign. Up to eight starts
are supported for both interaction and coordinate triggers. **Edit start N on
map** selects the marker changed by clicking the preview; every start also has
X/Y fields and additional starts can be removed.

**Check scene** validates the complete sequence separately from every start and
names the failing start if a route is blocked or out of view. The first player
step in a following action adapts to the selected starting side. NPC routes
remain the authored directions; use position branches below when starts need
different routes. All starts
share completion, gift and battle checkpoints. Adding starts does not grant an
extra reward. A repeatable coordinate scene rearms after leaving all listed
trigger tiles, or re-entering the map. Starts and partner destinations shift
together when linked NPC placement moves them. Additional starts may use more
of the existing scene-state and native text-slot budgets.

### Different approaches and facing

Use **Branch on player position** when different starting tiles need different
NPC routes. Choose an exact X/Y tile, or select a reference NPC and **Left**,
**Right**, **Above** or **Below**. Side tests compare just that axis: diagonal
tiles can also match, while an equal coordinate does not. The test uses positions
at that action, including earlier scripted movement. It does not add a trigger
tile: list all allowed player starts in scene settings.

Put the left approach in **Then** and the other route in **Otherwise**, then put
shared dialogue and rewards after the branch. Each start validates its matching
route separately, so the NPC may finish at different positions for different
starts. Ordinary Yes/No and event branches still need matching positions when
they rejoin. A position test stops an unexpectedly displaced scene instead of
using a route validated for a different side. Exact tile conditions shift with
player starts when linked NPC placement moves the scene.

After the route, add **Face NPC → The player**, then **Face player → An NPC**
and select the approaching actor. Neither action takes a step. You can also
choose up, down, left or right explicitly. Diagonal targets use the horizontal
direction first. Facing is held during the scene until another turn or movement;
normal NPC idle behavior resumes after cleanup. Hidden NPCs must be shown first.
Single-pose sprites such as Snorlax cannot turn, but the player can face them.

For an Oak-style entrance, create a stationary NPC in Maps, compose its actions,
choose **Reach map coordinates**, and mark that NPC initially hidden. Add
**Show/hide NPC** (visible), dialogue, and **Walk NPC with player following**.
The player must start next to the actor for following. End with dialogue or a
hide action. Use a Yes/No branch to allow declining. A declined coordinate scene
stays latched until the player leaves all trigger tiles or re-enters the map.

Routes use UP, DOWN, LEFT and RIGHT, separated by commas or whitespace. They
stay within the map, avoid walls, signs and other objects, and keep the
leading actor on screen. Only ordinary stationary NPCs are route actors; trainers
and item objects retain their native behavior. Dynamic blockers, including Yellow's
Pikachu, abort before an occupied step. In Yellow, use Move following partner before the NPC route to move Pikachu out of its way. NPC routes do not silently reroute.
The NPC stays at its destination until moved again or the map reloads. Branches
with different final staging must end separately rather than rejoin.

**Walk NPC** can enter a door or warp tile: native warps check the player's
position and do not transfer an NPC to another map. Follow that walk with
**Show/hide NPC** (hidden) to stage a departure. Player-following routes still
reject warp tiles. Coordinate-triggered scenes can start on the player's arrival
warp: choose **Reach map coordinates** and enter that warp's X/Y. The scene runs
before the next player input; it does not move the player or disable normal
warp behavior. Interaction-triggered scenes still require an ordinary player
start. Walls, occupied positions, map
bounds and the on-screen route limit remain checked.

**NPC emote** offers exclamation, question and smile bubbles in Red. Yellow also
offers skull, heart, lightning bolt, sleep and fish bubbles. The native routine
holds the bubble for about one second and restores sprite updates before the
next action. Show a hidden actor before emoting, and keep it on screen. Add a
separate **Play sound** action for an audio cue. The picker disables emotes when
the project's emotion-bubble routine or bubble constants differ from reviewed
source; saving checks those dependencies again.

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

In Red/Blue, scene saving also separates the reviewed hidden-event lookup and
its tables into a linker-allocated ROM section. This frees about 1.8 KB in the
crowded map bank without moving its directly called dungeon-warp routine.
The native dispatcher already selects the lookup's linked bank. Source guards
verify the dispatcher, lookup, tables and incoming references before applying
this update; the change shares the scene's undoable transaction. Existing scenes
can apply it by reopening **Edit interaction**, choosing **Save interaction**,
and rebuilding. Yellow already separates these routines and is left unchanged.
ROM banks still have finite capacity; this change resolves the shared lookup
allocation conflict rather than making scene size unlimited.

Successful exits retain authored visibility; incomplete exits restore the
starting visibility. Initial visibility becomes fixed after the first save to
avoid reinterpreting existing saved event bits. Scene visibility flags share the
existing event array; native toggle IDs and save sizes are unchanged.

The runtime uses a reviewed unused 56-byte reservation without moving any
existing RAM symbol. Effects use six of the seven bytes reserved by older scenes. Native movement buffers remain separate from
scene bookkeeping. Input is enabled during native dialogue/menu sessions, and
controls and NPC movement fields are restored on exit. Scene state is cleared
on unrelated map entry; native battle returns resume the pending scene. Each scene has at most 128 dispatcher states.

Cross-map escorts and persistent PC-session outcomes still need authoring
interfaces and runtime checks. The
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

## Draft recovery and scene review

Edits are kept in project/interaction-scoped device storage, separately from
assembly source and undo history. Closing keeps even invalid or unfinished
interactions. Reopen the same project and interaction and choose **Resume draft**;
page reloads retain the draft. **Use saved interaction** or **Discard draft**
requires confirmation before deleting it. A successful project save clears the
draft. Drafts do not sync between devices or stable/beta channels.

Recovery always loads a fresh interaction document. A changed-source notice
means actors, routes, triggers and text must be reviewed against the current map;
normal source and engine guards still apply on save. Storage errors are shown,
and Close leaves the editor open when it cannot keep your changes.

**Scene review** shows all player starts, trigger type, required native map state
and event condition. **Check scene** runs the same source preparation as Save
without writing files. Invalid actions are named, **Go to action** focuses their
card, and blocked tiles are marked red on the map preview. Clicking the preview
sets the selected player start; X/Y fields remain available. Passing checks proves the
source is valid, not that an existing player's save meets its story-state/event
requirements.

The full-game smoke test (`npm run test:scenes:gameplay -- /path/to/pokered
/path/to/pokeyellow --rom /path/to/rgbds /path/to/binjgb`) assembles complete ROMs
with a test-only new-game party/map setup. A joypad controller plays native wild
and trainer battles, captures into the party and PC, escapes twice across a
rearmed trigger, and loses through both blackout paths. Success runs native
SaveGameData, restarts the emulator with its battery RAM and chooses Continue.
It checks species, ball consumption, prizes, hidden sprites, input/palette cleanup
and persistent completion. Native rendering shows Snorlax before the encounter
and removes it afterward. Setup/save-marker hooks exist only in the test ROM;
no battle, capture, save/load or graphics routine is replaced.

## Following partner (Yellow)

**Branch on following partner** checks Yellow's native starter identity, party HP,
walking mode, sprite visibility and following state. Its **Following** and
**Absent** branches can rejoin. Ordinary Pikachu NPCs, traded Pikachu, boxed or
fainted starters, hidden sprites and a partner detached by a native story script
do not count as the following partner. Red/Blue explain that this engine is not
available; the actions remain disabled there. Changed follower routines also
disable these actions without blocking ordinary interactions.

**Move following partner** chooses an X/Y destination. The scene reads Pikachu's
actual starting tile, waits for an in-progress step, then uses Yellow's native
movement commands along a checked route of up to 16 steps. Choose clear floor on
screen, away from the player, NPCs, signs and warps. Pikachu can cross door/warp tiles without changing maps, including leaving
a blocked arrival doorway across its neighboring warp. The destination must
still be ordinary clear floor. Choose a final facing direction to make him watch a character or doorway.
An absent partner is skipped. A blocked or
unreachable move ends the attempt without marking the scene complete.

Pikachu stays parked while the scene runs. On completion or interruption, the
scene rebuilds his follow queue along clear floor so he rejoins the player. A
blocked rejoin uses the game's native respawn behavior instead of walking
through an object. Map changes and battle reentry release the scene's control;
battles can reposition Pikachu, so add another partner move before a later NPC
route if needed. Existing following that was disabled by native story logic is
left alone. No RAM or battery-save fields are added.

For an entrance scene, add **Branch on following partner**, put **Move following
partner** in Following, choose a parking tile beside the NPC's route, then place
the NPC's walking action after the branch. Check scene identifies a parking tile
that overlaps the authored NPC route. Destinations shift with linked scene
starts when moving an NPC through Edit NPC. Draft recovery preserves both
branches and their destinations.

Verification:

```sh
npm run test:scenes:partner -- /path/to/pokered /path/to/pokeyellow
npm run test:scenes:partner -- /path/to/pokeyellow --rom /path/to/rgbds /path/to/binjgb
npm run test:scenes:partner:ui -- /path/to/pokered /path/to/pokeyellow
```
