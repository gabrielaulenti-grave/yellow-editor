# Place trainers on new maps

In **Maps → NPCs & items → Place trainer**, choose a trainer class and party,
sprite, position, facing and sight range. Enter the challenge, defeat and
post-battle dialogue. Range **0** makes a talk-only challenge; range **1–8** lets
the trainer spot the player along a clear corridor. Sight challenges require an
animated walking sprite. Existing objects, signs and warps are marked on the
placement grid, which also previews the sight corridor.

**Copy into an independent party** is enabled by default. The copy appends to
its class without shifting any existing parties. Yellow's party-specific move
overrides are copied; Red's class-wide moves remain inherited. Gym and other
map-specific story scripts are not copied. Turn copying off only when you intend
to share the selected party with its existing trainers.

Select a placed trainer to **Edit trainer** or **Edit trainer party**. The latter
opens its full party in **Trainers** for species, levels and move editing. The
Maps dialog keeps the same persistent defeat flag when changing the trainer.

Battles use the game's native trainer engine: approach, challenge, battle,
blackout and post-battle interaction. Each placement receives a separate unused
event flag. Winning prevents a rematch after leaving the map or loading a save;
losing leaves the trainer available. Trainers remain on the map after defeat.
A player without a healthy party cannot start a challenge.

Party copying, placement, dialogue, flag allocation and runtime changes form one
undoable save. Existing object IDs and event flags are preserved, and the save
layout is unchanged. Placement revalidates existing managed scenes; trainers
cannot occupy a scene's player start or break its movement routes.

## First-pass scope

Placement supports newly created maps and existing maps with a simple map
script, including supported scene and Strength hooks. Maps with an existing
custom or native trainer dispatcher are rejected with an explanation. This
protects their story logic. Existing trainer parties remain editable through
**Trainers**. Hidden items and trainer-rematch scheduling are separate features.

A new cave can now be created, connected by warps, assigned encounters, and
populated with visible items and trainers entirely through Maps.

## Verification

- `npm run test:maps:trainers -- /path/to/pokered /path/to/pokeyellow` checks
  independent parties and move overrides, separate defeat flags, placement,
  scene preservation, atomic rollback, undo/redo and stale-source guards.
- Add `--rom /path/to/rgbds /path/to/binjgb` for complete new-cave ROM builds
  and native dispatcher CPU probes, including distinct flag bases and loss.
- `npm run test:maps:trainers:ui -- /path/to/pokered /path/to/pokeyellow`
  checks the authoring workflow in light/dark themes at mobile and desktop widths.
- `npm run test:maps:trainers:gameplay -- /path/to/pokered /path/to/pokeyellow
  --rom /path/to/rgbds /path/to/binjgb` plays the native games with controller
  input: sight challenges, talk challenges from all four sides, blackout, victory
  and Continue from battery saves. Fixture-only starting parties and a save helper
  accelerate the tests; the native movement and battle engines are unchanged.
