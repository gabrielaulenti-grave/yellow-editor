# Script round-trip checks

Run the focused writer/IR regression suite with:

```sh
npm ci
npm run test:scripts
```

The desktop CI workflow runs this suite, pinned disassembly sweeps, complete ROM
builds, and assembled CPU probes before building the app. The focused suite checks guarded
macro edits, trainer reward writes, simple action insertion, and event conditionals.
Cases include stale snapshots, invalid values, state-table retargeting, helper
routines outside the state table, blank arguments, quoted separators, nested
expressions, LF/CRLF/mixed line endings, and files without a final newline. It also
checks source-derived argument roles, event-address/bit constraints, emitted-byte
bounds (including nested wrappers and simultaneous edits), and dialogue/code
pointer separation.

To dry-run the production writers against local disassembly checkouts:

```sh
npm run test:scripts -- /path/to/pokeyellow /path/to/pokered
```

The sweep uses project-derived macro/domain, event, and movement analysis. Across
the 11 script fixtures, it tries up to three alternatives at **every** eligible macro
parameter position, including repeated calls and companion files. It also tests
all available simple actions and conditional actions in every routine that proves
one straight-line insertion point. It also saves unchanged single-line calls,
including read-only declarations, and verifies byte identity and IR preservation.
It never writes the disassembly.

Results distinguish successful edits, semantic-contract refusals, and unexpected
failures. Changing a behavior family or state topology is a refusal; corruption
of neighboring bytes is a failure. Refusals do not imply that the attempted edit
is supported. Domain membership alone cannot prove that an arbitrary routine
target has the same behavior. Symbol declarations, structural pointers, routine
targets, computed symbols, and assembly-control parameters remain read-only in
the generic value editor, with an explanation in the form. Value choices preserve
proven reused-address groups, assertion remainders, and emitted-byte bounds.
Unresolved numeric family values are excluded. Constant enumeration honors
`const_skip`, `const_next`, step sizes, and shifted/exported constants.

## Validated source revisions

The October 2, 2026 sweep used:

| Source | Commit | Unchanged saves | Macro value edits | Semantic refusals | Builder round trips | Unexpected failures |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `pret/pokeyellow` | `e89ead154b9968aa50eed9328ff2b38b6c194382` | 1004 | 1158 | 0 | 282 | 0 |
| `pret/pokered` | `d2704a63c26f9ba046ade877445216b3de0519a4` | 925 | 1110 | 0 | 144 | 0 |

574 Yellow and 475 Red/Blue structural arguments are kept read-only; these are
reported separately and are not counted as successful value edits. Hall of Fame
has no eligible macro value edit in this phase and remains covered by unchanged
saves and generated-action checks.

## Assembly and CPU validation

With native RGBDS v1.0.4, a C compiler, GNU Make, and a checkout of binjgb at
`8abd0d38d5bf109d7c280b27d815a8b53168adde`:

```sh
npm run test:scripts:rom -- /path/to/rgbds /path/to/binjgb /path/to/pokeyellow /path/to/pokered
```

This runner copies the source projects to temporary directories, builds vanilla
baselines, and assembles/links three edited macro variants per game. Each variant
changes every eligible fixture call using first/middle/last alternatives: 326
Yellow calls and 310 Red/Blue calls per variant. A fourth edited ROM per game
contains six generated insertions covering wait, heal, event set/reset, and
conditional wait/heal. Operand truncation warnings fail the check. The source
checkouts remain untouched and temporary ROMs are removed.

48 isolated assembled ROM probes execute on the app's pinned binjgb CPU. They use
the projects' real event macros and `DelayFrames` loop to verify event set/reset,
both conditional outcomes, 1/7/255 delay iterations, return to the expected
endpoint, and all 512 neighboring event bytes. Only the lower-level `DelayFrame`
frame source is stubbed with an iteration counter.

The checks cover sampled values and combinations, not every possible edit.
The CPU probes do not validate real VBlank timing, healing internals, or complete
gameplay/story behavior. Arbitrary assembly and routines with ambiguous insertion
points remain outside the generated-action writer's supported scope.

## Cross-script event dependencies

A reset can preserve every source byte and emit the correct CPU operation while
creating an invalid combination of game flags. For example, Route 22 checks
`EVENT_ROUTE22_RIVAL_WANTS_BATTLE`, locks player controls at its trigger coordinates,
then selects an encounter using `EVENT_1ST_ROUTE22_RIVAL_BATTLE` or
`EVENT_2ND_ROUTE22_RIVAL_BATTLE`. Clearing the first selector alone before the first
encounter leaves the enabling flag set, so the default dispatcher repeatedly
returns with controls locked and no rival movement started.

`EVENT_BEAT_ROUTE22_RIVAL_1ST_BATTLE` records completion and is a different flag.
Replaying an encounter requires its complete setup, including the pending and
enabling flags, visible rival object, and script state. Clearing a completion
flag alone does not rearm the encounter.

The generated-action form and macro forms now show source-derived warnings for
the bounded pattern of an enabling event check, state writes, event-selected
branches, and a return when none is selected. Warnings identify the source routine
and related flags. They do not infer dependencies from Pokémon names, change
other flags automatically, or prove all story-state combinations safe. The action
button says **Add action**, because source/reparse validation cannot guarantee
complete gameplay behavior.

22 additional assembled CPU regressions exercise the real Route 22 dispatcher,
coordinate checks, and production-generated resets at both trigger coordinates.
Yellow uses its actual Route 1 routine; Red uses a supported straight-line helper
because its original Route 1 routine ends in a tail jump. Cases cover normal first
and second encounters, the reported inconsistent pending-flag reset, cancellation
with both flags cleared, the separate completion flag, and an off-trigger position.
They verify all event bytes, input lock, saved coordinates, facing setup, and
encounter selection over five dispatcher calls. Encounter handoffs are stubbed
with markers; rival movement and battles are outside these focused probes.

The runner now executes 70 assembled CPU probes in total. Undoing a source edit
and rebuilding does not restore event bits already changed in a save; testing the
normal encounter again requires a save from before the reset ran or explicit
restoration of its setup.
