# Script round-trip checks

Run the focused writer/IR regression suite with:

```sh
npm ci
npm run test:scripts
```

The desktop CI workflow runs this suite and the pinned disassembly sweeps before
building the app. The focused suite checks guarded
macro edits, trainer reward writes, simple action insertion, and event conditionals.
Cases include stale snapshots, invalid values, state-table retargeting, helper
routines outside the state table, blank arguments, quoted separators, nested
expressions, LF/CRLF/mixed line endings, and files without a final newline.

To dry-run the production writers against local disassembly checkouts:

```sh
npm run test:scripts -- /path/to/pokeyellow /path/to/pokered
```

The sweep uses project-derived macro/domain, event, and movement analysis. Across
the 11 script fixtures, it tries one alternative at **every** eligible macro
parameter position, including repeated calls and companion files. It also tests
all available simple actions and conditional actions in every routine that proves
one straight-line insertion point. It never writes the disassembly.

Results distinguish successful edits, semantic-contract refusals, and unexpected
failures. Changing a behavior family or state topology is a refusal; corruption
of neighboring bytes is a failure. Refusals do not imply that the attempted edit
is supported. Domain membership alone cannot prove that an arbitrary routine
target has the same behavior.

## Validated source revisions

The October 2, 2026 sweep used:

| Source | Commit | Macro round trips | Semantic refusals | Builder round trips | Unexpected failures |
| --- | --- | ---: | ---: | ---: | ---: |
| `pret/pokeyellow` | `e89ead154b9968aa50eed9328ff2b38b6c194382` | 542 | 395 | 282 | 0 |
| `pret/pokered` | `d2704a63c26f9ba046ade877445216b3de0519a4` | 505 | 331 | 144 | 0 |

This validates parsing and rewriting, not assembled-ROM execution. Each macro
position uses one alternate value; this is not an exhaustive enumeration of all
values or combinations. Arbitrary assembly and routines with ambiguous insertion
points remain outside the generated-action writer's supported scope.
