# Viridian City PC lesson regression scenario

The Lance/Dratini PC lesson is a test case for reusable scripting tools. Its
recipe generator, evidence and wizard live under `tests/`; there is no dedicated
PC tutorial button or tutorial command in the application session API. The
product provides [interaction composition](interaction-composer.md), with
general scene triggers, movement and persistent service outcomes still to come.

Creation is one history operation affecting eight existing source files. Undo
restores the original map, text, flag declarations, exports and storage hooks.
The regression fixture also edits the gift and its three main dialogue blocks;
those edits affect one script file. Already-delivered gifts in a save are not
reissued or changed by recipe edits. The mentor returns to its starting tile and
remains available after the lesson.

## Generated tools and behavior

- **Direct PC gift:** checks current-box capacity, creates the chosen Pokémon
  using the native data/naming routines, records ownership and sends it directly
  to the box. It never fakes a full party or temporarily changes party count.
- **Resumable scene:** first-entry detection, Yes/No, NPC approach, NPC escort,
  player escort, gift, real PC session, mentor return and input restoration are
  separate map states. Movement waits return to the overworld; player movement
  must exhaust its input stream and finish its walking animation before delivery.
- **Exact gift tracking:** stores the gift's box and slot. A head insertion shifts
  its slot; removing an earlier box Pokémon shifts it back. Deposits append to
  the box, so they do not shift it. A successful native withdrawal of that exact
  slot completes the lesson. Withdrawing another Pokémon does not.
- **Cancellation and release:** No/B declines. A full box leaves the gift
  unclaimed. Logging off without withdrawal retains the gift and allows retry.
  Releasing the tracked gift ends that gift's lesson without issuing a replacement.
- **Persistence:** three verified unused bytes at the tail of the existing event
  array hold milestones, transient scene phase, box and slot. The event array and
  save structures retain their original sizes. Map entry resets the transient
  phase while retaining gift identity and milestones.
- **PC guidance:** the scene displays the gift's original box number, including
  after the player switches boxes. Instructions refer to the first storage-PC
  menu entry, which works with both Someone's PC and Bill's PC.

Routes are computed from the project's real map blocks and collision tiles. Two
route variants avoid the ordinary wandering visitor. The scene pauses wandering
NPCs, waits for an in-progress step, then checks current sprite positions before
walking. Yellow also checks a visible Pikachu follower. If neither route is clear,
normal control returns and the player can retry later.

The recipe preserves the Center's nurse, link receptionist and other native
interactions. Storage hooks run only while this specific gift is pending and
preserve the caller's registers, flags and ROM bank. New helpers live with the
map scene to avoid expanding crowded engine banks. Three native helper labels
are exported without changing their instructions.

## Guarded scope

This is the first scene recipe, not a general assembly composer. It requires the
reviewed Red/Yellow storage, menu, banking, object and text contracts and the
Pokémon Center layout. Changed engine bodies, conflicting symbols, unavailable
sprite slots, occupied mentor tiles, unsafe routes or exhausted event space
refuse creation. Source hashes prevent saving a stale form, and generated-code
checks prevent overwriting manual source edits.

The object table and walking assets are recorded as route dependencies. Review
routes before changing the cast or terrain. Add the intended NPCs before creating
the tutorial; **Add NPC** refuses further additions to a managed tutorial map.
Undo tutorial creation first if you need to change its cast. Source/text editing
remains available, but manually edited generated code requires review before the
recipe can regenerate it. Only one managed PC tutorial is supported per project.

## Verification

```sh
npm run test:pc-tutorial -- /path/to/pokered /path/to/pokeyellow
npm run test:pc-tutorial -- /path/to/pokered /path/to/pokeyellow --rom /path/to/rgbds /path/to/binjgb
npm run test:pc-tutorial:ui -- /path/to/pokered /path/to/pokeyellow
```

Both complete tutorial ROMs assemble and link with RGBDS 1.0.4. Across both games,
234 assembled CPU probes cover direct storage, exact slot tracking, insertion and
removal, wrong Pokémon, box switching, release, capacity, entrance sides, manual
retry, alternate routes, asynchronous waits, saved-phase reset and real bank-switch
register/flag preservation. Movement completion, menus and native creation/naming
are controlled boundaries in the scene probes; they do not constitute a full
interactive gameplay replay. The browser checks cover creation, review, dirty
close, reopening, editing and atomic undo at 320, 375 and 1280 pixels in both games.

In-game checks should include:

1. A new save with one party Pokémon: Dratini enters the PC and the party is unchanged.
2. Yes, No and B; enter through either doorway and resume by speaking to Lance.
3. A full box: no ownership/gift milestone is committed; make room and retry.
4. A full party: use the PC to deposit another Pokémon, then withdraw Dratini.
5. Cancel and re-enter; change boxes and save/reload during the PC session.
6. Insert another Pokémon ahead of the gift, withdraw/release an earlier entry,
   and verify that only the tutorial gift's withdrawal completes the lesson.
7. Release the gift: retry produces no duplicate.
8. Yellow's follower, ordinary healing/link interactions, and final input/facing restoration.
