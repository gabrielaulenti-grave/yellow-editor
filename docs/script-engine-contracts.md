# Reviewed choice, audio and movement contracts

This first contract tranche connects the vanilla atlas to explicit operation
behavior. It adds six source-reviewed contracts in `scriptEngineContracts.ts`.
Every evidence body has a SHA-256 fingerprint for the pinned Red and Yellow
revisions. A changed or missing body produces `source-drift`; atlas CI refuses
to accept it without a review and regenerated inventory.

| Operation | Result and scheduling | Required continuation |
| --- | --- | --- |
| Yes/No | Blocks for input; `wCurrentMenuItem` is 0 for Yes, 1 for No or B | Read RAM before another menu; commit effects on the intended branch |
| Play sound | Requests playback; current audio bank and fade state affect execution | Add an explicit completion wait when needed; restore map music when appropriate |
| Wait then play | Waits for previous effects, preserves the requested ID, starts the new cue and returns | Does not wait for the newly started cue |
| Sound completion wait | Polls effect channels 5, 6 and 8; low-health alarm bit 7 bypasses it | Keep interrupt-driven audio running; this is not a music or channel-7 wait |
| NPC movement | Copies a single shared path; sets the movement flag and locks input | Yield to the map dispatcher until the flag clears, then clear scene locks and restore facing/state |
| Player movement | Starts simulated input; overworld exhaustion clears movement state and locks | Yield through the dispatcher; index zero alone does not prove final animation completion |

The `YesNoChoice` comment says Yes sets carry. Its screen-restore tail calls
`CopyData`, which clears carry, so callers must use the RAM result. The parser
records the result contract and binds Yes/No destinations only for an adjacent
`ld a, [wCurrentMenuItem]` / `and a` / conditional `jr` or `jp` sequence. Other
branch structures remain inspectable without an invented destination.

Sound operations now appear in the script preview and routine atlas. An ID is
bound only from a directly adjacent literal `ld a`; a call, branch or older
register assignment leaves the input unknown. Operation shapes distinguish play,
wait-before-play, audio completion waits and map-state movement waits. Existing
round-trip guards therefore cannot equate different scheduling contracts.
`StopAllMusic` is a Yellow helper; Red requests the stop-all ID through
`PlaySound`. Stopping audio requires explicit restoration by the scene.

The audit recognizes unique literal EQUS aliases to text command macros,
including `sound_level_up`. Conditional aliases, conflicts, expressions and
cycles are left unresolved. The atlas's remaining classification queue stays
visible; this phase does not claim every script is understood or editable.

## Validation and limits

Run the parser tests and source/CPU boundary checks:

```sh
npm run test:scripts:contracts
npm run test:scripts:contracts -- /path/to/rgbds /path/to/binjgb /path/to/pokered /path/to/pokeyellow
npm run scripts:atlas -- /path/to/pokered /path/to/pokeyellow --check
```

The CPU runner assembles extracted vanilla code with RGBDS 1.0.4 and executes it
on the pinned binjgb CPU used by the existing script tests. It checks 42 probes:
Yes/No and both B outcomes through the actual restore/copy tail; sound wait and
alarm bypass; interrupt-driven wait completion; preserved playback registers,
Red audio-bank restoration and fade paths; NPC startup/terminator cleanup;
active/completed movement waits; and player startup/exhaustion cleanup.
A deliberate engine-source mutation must fail the fingerprint gate.

Menu rendering/input, the audio playback driver and sprite rendering are stubbed
boundaries. The tests do not establish audible output, collision-safe movement,
whole-scene timing, arbitrary bank allocation or interactive in-game correctness.
The atlas records source status separately from runtime and generation status;
source matching alone never asserts that CPU checks ran for a project.

The next phase is a scene graph with explicit choice outcomes, start/wait states,
and exit cleanup. Recipe-level dispatcher ordering, path bounds, actors, music
restoration and battle outcomes must pass their own checks before new scene
code can be generated. This phase improves inspection and establishes contracts;
it does not expose a general scene composer.
