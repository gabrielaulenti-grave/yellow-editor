# Release checks

`Check desktop app` (`desktop-check.yml`) owns the automatic release gate on
`main`, `beta` and pull requests. Beta publication still requires a successful
push run of this workflow. Its name and deployment contract are unchanged.
Superseded runs on the same branch or pull request are cancelled.

## Coverage ownership

| Checks | Automatic owner | Focused alternative |
| --- | --- | --- |
| Graphics conversion, compression, history, tracing and responsive UI | Desktop gate | Manually run `Check graphics workspace` |
| Animation allocation, source graphs and native battles | Desktop gate | Manually run `Check animation authoring` |
| New species, moves, trainers, move behaviors, UI, capture, PC and battery saves | Desktop gate | Manually run `Check playable content creation` |
| Map, NPC, dialogue and scene source/history assertions, browser workflows and native probes | Desktop gate | Run the relevant `npm run test:*` command locally |
| Full vanilla script inventory and generated atlas | Path-filtered `Check vanilla script atlas` | Manual dispatch |

The three focused workflows retain their test commands and preview artifacts,
but run only through **Actions → Run workflow**. They previously repeated the
same coverage automatically alongside the release gate. The atlas workflow stays
automatic because its complete inventory/report checks are distinct.

## Source and native checks run together

The following commands use the same test entry point with and without `--rom`.
Their native invocation runs the unconditional source, validation, preservation
and history assertions, then adds compilation and CPU checks. The gate runs
each once with `--rom` for both pinned Red and Yellow fixtures:

- `test:maps:native`, `test:maps:signs`, `test:maps:imported`
- `test:maps:create`, `test:maps:populate`, `test:maps:edit`
- `test:maps:strength`, `test:maps:trainers`, `test:items:field`
- `test:npcs:tools`, `test:npcs:edit`
- `test:interactions`, `test:scenes`, `test:scenes:starts`

Yellow partner source assertions run in its native partner suite; Red's
unsupported-partner rejection still runs separately.

Other apparent overlaps are intentionally retained. In particular,
`test:moves:behaviors` selects **different** source and gameplay entry points
with `--rom`, as do script round-trip and assembly sweeps. Browser tests cover
application wiring and responsive layouts that source and CPU tests cannot.
Native gameplay checks cover battle flow, events and persistent saves beyond
isolated engine probes. No test assertions or gameplay scenarios were deleted.

TypeScript runs early with `tsc --noEmit`; the final frontend step runs Vite
directly to avoid repeating type checking. Rust uses `cargo test --all-targets`
to compile both the library and desktop entry point and run tests in one pass,
replacing a separate `cargo check` followed by library-only tests.

## Audit baseline

The successful beta checks for `27e2b2d` on 2026-11-04 took about 59 minutes for
the desktop gate, plus about 14 runner-minutes across the three duplicate
workflows. The 14 removed source-only suite invocations accounted for 510 seconds inside the
gate. Removing those and the duplicate automatic workflows saves approximately
23 runner-minutes per revision before compiler savings. These are estimates
from the previous run, not measured timings of the revised workflow.

When adding release coverage, assign it one automatic owner. A native run may
replace a source-only run only after confirming that it executes the same
assertions for the same fixtures. Keep focused manual workflows for diagnosis;
do not add another automatic copy of the gate's tests.
