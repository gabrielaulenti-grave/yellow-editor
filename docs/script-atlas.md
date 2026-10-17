# Vanilla script atlas and scene-builder roadmap

The atlas inventories every `scripts/*.asm` file in pinned vanilla Red/Blue and
Yellow, including companion files, helper routines, data, scoped local labels,
map object/sign/warp triggers, state-table entries, and literal call/jump/pointer
references. It supplements the existing source audit and 11 edit-regression
fixture groups. It does not declare arbitrary assembly editable.

The full per-group inventories, classification queues, and engine helper lists
are in [Red](script-atlas/pokered.md) and [Yellow](script-atlas/pokeyellow.md).
[The manifest](script-atlas/manifest.json) records exact source revisions, input
digests, and counts. CI uploads the complete machine-readable routine/reference
graphs as the `vanilla-script-atlas` artifact.

## What the complete inventory establishes

| Source occurrence | Red/Blue | Yellow |
| --- | ---: | ---: |
| Script files | 224 | 251 |
| Script groups, including companions | 223 | 224 |
| Global labels, including data and text | 3,503 | 3,766 |
| Scoped local labels | 1,120 | 1,222 |
| Declared state-table entries, including shared targets | 381 | 440 |
| Direct Yes/No calls | 30 | 36 |
| Decoded movement nodes | 61 | 108 |
| Battle-related semantic nodes | 366 | 347 |
| Direct music, sound, and cry calls | 97 | 127 |
| Unresolved literal references in the inventory | 0 | 0 |
| Distinct source-audit classification blockers | 70 | 82 |
| Source-reviewed engine contracts | 6 | 6 |
| Sound calls missing a semantic node | 0 | 0 |

Counts describe source occurrences. They include conditional and unused code;
they do not measure reachable gameplay scenes or supported writer actions.
Computed targets and indirect exits remain explicit runtime expressions. State
tables retain every constant even when multiple entries share a routine. Table
order is recorded without claiming it is the assembled numeric state ID.

The source audit still has real classification gaps. Some known macros such as
`callfar`/`farjp` have semantic invocations without a frozen family binding. The
backlog also includes menu, map-gate, event-index, sprite-pointer, and service
callbacks. Some entries are bookkeeping or declarations; they are not all
missing gameplay primitives.

The first [engine-contract tranche](script-engine-contracts.md) recognizes the
literal `sound_level_up` alias at all three vanilla sites and models all 40 Red
and 21 Yellow `PlaySound`/`PlaySoundWaitForCurrent` calls. It records six reviewed
contracts per game, with source fingerprints, explicit Yes/No outcomes, blocking
sound waits and yielding movement waits. CPU boundary probes validate those
contracts separately. A source match does not enable arbitrary scene generation.

## Evidence needed for a reusable building block

Track recognition, concrete value binding, source editing, new-code generation,
and runtime validation separately. Each primitive should have:

- Source definitions and all caller examples from both games, with the source
  revision and line recorded.
- Typed inputs, register/RAM effects, flag meanings, and return/bank conventions.
- Success, failure, cancellation, capacity, and battle-loss/whiteout behavior.
- Whether it blocks, starts asynchronous work, or must wait in a later map state.
- Required input locks, sprite visibility/facing, music state, and cleanup.
- Source/reparse checks, assembled ROM checks, and CPU/gameplay evidence appropriate
  to its contract. Existing validation scope remains documented in
  [script-round-trips.md](script-round-trips.md).

Resolving a helper's name is useful evidence. It does not prove its implementation
or make a sequence of individually valid actions safe to compose.

## Pattern library to extract next

| Pattern | Vanilla examples | Contract to review | Builder consequence |
| --- | --- | --- | --- |
| Yes/No and retry branches | Bill's House, Mt. Moon Pokécenter, guards and services | Menu result, cancellation, re-entry and which outcomes commit effects | Explicit branches and named outcomes |
| NPC/player movement | Oak's Lab, Route 22, Mt. Moon B2F | Movement family, actor, route, completion flags and facing | Start/wait steps and separate resumable states |
| Music and sound cues | Rival encounters, gym rewards, Game Corner, dock scenes | Track/SFX IDs, wait behavior and restoration | Separate play/stop/wait/restore primitives |
| Trainer/scripted battles | Oak's Lab, Route 22, Silph Co., static encounters | Opponent setup, dialogue pointers, win/loss and map reset | Outcome branches with correct continuation or whiteout handling |
| Items and Pokémon gifts | Route 1 sample, Eevee, Lapras, fossils | Carry success, bag/party/PC capacity and one-time state | Commit flags/object hiding only after delivery |
| Persistent puzzles | Seafoam, Victory Road, Silph gates | Indexed flags, boulder/door state, cross-floor persistence | Typed puzzle effects with explicit event dependencies |
| Multi-step services | Daycare, elevators, Safari admission, fossil revival | Party/money/resource ownership and cancel/retry paths | Reusable service recipes with reviewed side effects |
| Yellow-specific scenes | Catching tutorial, Jessie/James, Pikachu reactions/minigame | Follower slot, emotion/sound behavior and variant-specific state | Game-specific availability and contracts |

The JSON atlas groups routines with their operations, local labels, conditional
references, state transitions, trigger bindings, and helper boundaries. These
examples can become reviewed recipes; new scripts should target typed primitives
instead of copying arbitrary register writes from a visually similar script.

## Implementation order

1. Review the complete classification backlog, starting with sound commands,
   qualified local helpers, menu outcomes, state callbacks, and indexed events.
   Preserve honest unknown/internal classifications until source evidence supports
   a typed contract. Do not rename categories solely to make coverage green.
2. Build contract fixtures for the pattern library. Cover both games and all
   outcome paths, not just the 11 existing parameter-edit fixture groups.
3. Introduce an explicit scene graph: typed actions, conditions and choice branches,
   waits, battle outcomes, and exit/cleanup paths. Analyze which effects happen
   before versus after success and which flags enable other scenes.
4. Compile those graphs into text callbacks and map script states, allocating
   labels/states/flags within reviewed bounds and preserving source/history guards.
   Async movement and battles must resume through the engine's actual dispatcher.
5. Expose a beginner-facing composer only for contracts that pass source, ROM,
   runtime and layout checks. Keep unsupported source inspectable and explain
   which contract is missing.

## Reproduce and validate

Use the source revisions recorded in the manifest. Modified or untracked assembly
is rejected; unrelated non-assembly assets do not affect the source-only atlas.

```sh
npm ci
npm run test:scripts:atlas
npm run test:scripts:contracts
npm run scripts:atlas -- /path/to/pokered /path/to/pokeyellow
npm run scripts:atlas -- /path/to/pokered /path/to/pokeyellow --check
npm run scripts:atlas -- /path/to/pokered /path/to/pokeyellow --json-dir /path/to/output
```

The generator verifies that every script file and global label is represented.
`--check` compares the complete generated Markdown reports and manifest byte for
byte, so parser changes require a reviewed inventory update. Tests cover scoped
locals, conditional exits, state-table aliases, duplicate/missing targets,
computed pointers, repeated occurrences, quoted comments, and provisional
fall-through. The dedicated atlas CI job repeats these checks and provides the
full JSON artifacts. It changes no disassembly files or public app deployment.
