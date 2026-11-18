# Render Free deployment

The spectator and trainer run as a separate free Docker web service.

## Automated private ROM build

The Render Docker build uses the pinned pret/pokeyellow source revision and RGBDS 1.0.4. It applies the same patch in `beach/prepare-rom.mjs` that was tested with Yellow Editor's WebAssembly build graph.

The compiled `pokeyellow.gbc` and `pokeyellow.sym` are gzip-compressed in a dedicated Docker stage, then copied **only** into the private final container image as compressed files. The runtime decompresses them to `/tmp/` before starting the headless emulator.

No ROM, symbols, or private generated files are committed to GitHub or served from the public web directory. **A private container image is still a copy of the copyrighted game, however; this is not a determination of legal permission to host or broadcast it.** Keep Render image and registry access restricted.

There is **no need to upload Render Secret Files**. The existing service uses `BEACH_ROM=/tmp/pokeyellow.gbc` and `BEACH_SYMBOLS=/tmp/pokeyellow.sym`.

## Existing deployment

- Git branch: `pikachus-beach-trainer`
- Dockerfile: `beach/Dockerfile`
- Host: Render free, Virginia
- Spectator site: https://pikachus-beach.onrender.com/
- Health check: https://pikachus-beach.onrender.com/api/health

For a new workspace, the Blueprint at `beach/render.yaml` describes the service. The original service was created directly using the Render API.

## Operational limitations

Render Free can sleep after inactivity and offers no persistent disk. The trainer's checkpoints and captured clips are saved only on ephemeral instance storage: they may disappear on restart, redeploy, or suspension. This deployment is a functional preview, **not** guaranteed uninterrupted or durable training. The next reliability improvement should be an external checkpoint store.

The service is intentionally watch-only. Visitors receive rendered frames and statistics, not the ROM or playable controls. A spectator can still record the video stream.

When testing, verify `/api/health` and confirm that a real viewer receives frames and that training rounds complete; health alone does not prove live gameplay is advancing.

## Durable learning checkpoints (Supabase)

The trainer has a dedicated free project under the existing Funeral Workforce organization, region us-east-1: `hytibwkykvngedxcnpee`. It does not share a database with Funeral Workforce.

A private, RLS-enabled table `public.beach_checkpoints` stores the most recent complete round checkpoint. The `anon` and `authenticated` roles have no table privileges. Two deliberately token-gated RPC functions provide ONLY the load and save operations. The separate random RPC token is stored in a private database schema and as a Render environment secret; it must NEVER be placed in Git or in public HTML. The public publishable Supabase API key is not an administrator credential.

Render environment variables:
- `BEACH_SUPABASE_URL` — `https://hytibwkykvngedxcnpee.supabase.co`
- `BEACH_SUPABASE_PUBLISHABLE_KEY` — project's default publishable API key
- `BEACH_CHECKPOINT_TOKEN` — private 256-bit credential, generated on the database and installed server-side

Only when all three are present does the trainer restore a remote checkpoint at startup. If the remote fetch fails, startup deliberately fails instead of resetting weights silently. On completed rounds the trainer saves locally and remotely, at most once per 45 seconds; failures trigger a retry at the next round.

The first redeploy into this mode necessarily replaces the old Render Free container, which may erase that container's ephemeral weights. Future restarts should restore the latest remote checkpoint. Verify `total` increases in `public.beach_checkpoints` and a later restart preserves progress.

## Scheduled health check

The dedicated Supabase project also has one cron job named `pikachus-beach-check`, schedule `*/14 * * * *`, issuing a GET to the public Render `/api/health` endpoint. Inspect `cron.job_run_details` and `net._http_response` when testing it. This is a basic availability check, not a guarantee of 24/7 training. Render retains its right to restart the instance or suspend it on exceeding free usage limits, and project sleep/restarts are still possible.

## All-time score and record-run video archive

The learner tracks `highScore` for completed courses in its remote model checkpoint. High score tracking begins with this release; older completed records were not retained as individual scores, so the display cannot retrospectively reconstruct historical best runs.

Only a *new* completed-run record is archived. The server compresses each captured 160×144 RGBA frame during the round, then uses FFmpeg's VP8/WebM encoder at 12 frames per second if the run beats the existing best. This avoids real-time encoding overhead during every candidate evaluation. Each encoded file is limited to 4 MiB. Encoding/upload failure logs an error but does not cancel learner progression.

The free Supabase project holds up to the **20 latest record-setting WebM videos** in a dedicated RLS-enabled table. Videos are accessible only through token-guarded RPCs, proxied by the Render server as `/api/records/:id`; visitors receive video but no game ROM or API token. A public `/api/records` route returns only score/round/generation metadata. The viewer offers Watch and Download buttons for archived videos.

The archive uses database space, not the separate Supabase Storage allowance. Supabase Free includes 500 MB database size; the 20×4 MiB cap bounds the archive to approximately 80 MiB of WebM bytes (plus database overhead). These are video recordings without game audio. Older entries are deleted after the 20-entry limit is reached.

### Learning fitness, unchanged

Ten candidates each play four runs. Rank policies by number of completed courses, then mean completed-course score (failed courses count as zero), then mean course progress. The selected policy plays eight additional fresh evaluation runs, recorded as finish rate, average score, and average wipeouts. Wipeouts are *not* separately penalized except insofar as they lower game score, progress, or completion probability.

Validate deployment using `node --test beach/highscores.test.mjs` (run by the Docker build). Check the Render logs for new archive messages, verify `public.beach_highscore_videos` rows grow after new records, and test a stored WebM playback across a Render restart.

## Temporal policy / points-first fitness (v2)

Training architecture v2 expands the previous 187-weight feedforward policy to 235 weights (25 inputs, 8 hidden, 3 outputs). Six new inputs describe the last four steering actions, the recent change in angle, and change in speed. The action buffer is **cleared at the beginning and end of each run**, preventing leakage across unrelated courses.

Checkpoint migration preserves the existing weights by inserting six zero-weight inputs in every hidden neuron: preexisting behavior is unchanged at migration time. Existing candidate rounds, history, champion and high score remain intact. The new weights become trainable through mutation in later generations. Migration is idempotent.

Candidate fitness now prioritizes average game score, plus a completion bonus, minus a light wipeout penalty; failures get a small proportional-progress reward. The completion bonus is 1,200 while recent finish rates are below 85%, and 400 once they are higher. This encourages successful surfing early and higher trick scores after reliability develops. All candidate runs count, including failures. A new generation preserves up to three distinct top-ranked elite policies, with the remaining candidates derived by mutation from those elites. Eight fresh-course evaluation rounds remain unchanged.

The archive now appears in the live update payload and is independently fetched from `/api/records`, so viewers see already-stored videos immediately after connecting. The stats HTML literal `\\n` markup glitch is corrected. The original archived WebMs remain in the separate Supabase table.

## Jump and landing awareness (policy v3)

The emulator bridge now reads five additional unmodified Pokémon Yellow RAM fields by the exact names in the pinned `.sym` file: `wSurfingMinigameJumpDescending`, `wSurfingMinigameJumpArcMagnitude`, `wSurfingMinigameJumpArcFraction`, `wSurfingMinigamePikachuObjectHeight`, and `wSurfingMinigameBGMapReadBuffer`. Pikachu's current orientation was **already** available as `wAnimatedObject0FramesetID` (the frameset used by the game's landing checks; it is not the per-frame animation timer).

The decision network receives eight additional normalized observations: descending flag, jump magnitude, jump fraction, unsigned modular pixel clearance between raw Pikachu sprite Y and current ground height, and four separate landing-tile indicators for rising slope (0x06), wave crest (0x14), wave face (0x12), and falling slope (0x07). All other tiles are an implicit flat/other category. These are game-observed values, not modified game logic or guaranteed time-to-landing predictions.

Policy v3 expands from 235 to 299 weights. On restart the server migrates 187-weight v1 or 235-weight v2 champions, candidates, and elite policies by zero-padding the new observation weights without modifying any previously trained values. The ROM hash and private archive remain unchanged; high scores and checkpoint counters continue across deployments. Regression tests exercise both migrations and verify raw-memory decoding.

## Forward terrain vision / landing prediction (policy v4)

The read-only native emulator bridge now samples 12 actual BG-map tiles at the surface across x=72..160 pixels in the currently generated wave window. For each tile it reads the 20-height buffer to locate the surface row, then reads the VRAM tile ID directly. There are no writes to ROM/RAM/VRAM, and no ROM changes. The JS emulator additionally reads the animated sprite's fractional Y coordinate (`wAnimatedObject0FieldC`) to follow the exact jump integration.

`beach/landing-predictor.mjs` estimates an impact frame over up to 58 future frames using the game's original half-unit-per-frame acceleration and fixed-point position updates, with the original horizontal scrolling rate of 1.5 pixels/frame. The projected contact surface is sampled from the **existing** terrain buffer, accounting for rising slopes, falling slopes, and crests. Landing severity matches the original tile/frameset collision table; it is the outcome **if Pikachu held its current orientation until contact**, not an instruction to override controller choices.

Predictions include known/unknown, estimated frames to impact, horizontal offset, tile ID and current-orientation landing severity. If the current terrain window, simulation horizon or telemetry do not support a projection, results are marked `unknown` instead of inventing future course geometry. No RNG or future wave generation is anticipated. Estimates can be imperfect near wave generation boundaries and frame timing.

The v4 policy adds 8 normalized prediction features, increasing the 33-input/299-weight v3 network to 41 inputs/363 weights (8 hidden, 3 outputs). Existing 187/235/299-weight checkpoints are expanded with **zero weights** for new inputs, preserving their learned outputs. Champion, candidates, elite policies, high score and archived videos remain stored in the existing remote checkpoint database. Prediction telemetry is also shown beneath the spectator's progress bar.

Run the Docker build's `node --test beach/highscores.test.mjs` and validate that new v4 checkpoints are written with 363 weights after the deployment. A unit test verifies actual tile types and fail-closed unknown results.

## Per-run scoring analytics and historical generations

The trainer tracks actual successful jump-to-landing trick awards by reading `wSurfingMinigameRadnessMeter` and `wSurfingMinigameTrickFlags` from the unmodified ROM on the final airborne frame. Counts are +50 (one flip), +150 (two same-direction flips), +180 (two mixed flips), +350 (three same-direction flips), and +500 (three mixed flips). A failed jump awards nothing.

For each run (including HP failures) it records game score (zero if failed), radness points accumulated during active surfing, HP remaining at the end of gameplay, arithmetic mean of all game-frame surfing speed observations, number of wipeouts, progress, finish status, and trick award counts. These are observational analytics only: they do not alter the fitness or ROM.

`training.generationRuns` is saved in the current Supabase checkpoint and displayed under the dashboard's Generation analytics section. The full 40-candidate + 8-evaluation generation is archived as a separate `public.beach_generations` row in Supabase, with a summary and up to 48 per-run JSON entries. All archive RPC operations require the private token; public visitors can view sanitized JSON through the Render proxy, not access the database token. The dashboard offers a selector to compare the current and last 100 archived generations.

At generation rollover, the trainer first durably saves the pending archive queue in the remote checkpoint, then writes the archived generation with an idempotent upsert, then clears the queue and saves the checkpoint again. Temporary failures retain pending work and retry on the next completed round.

**Historic runs from before this feature do not exist as individual records.** The first generation after deployment may be partially observed; it is labeled partial rather than showing invented rows. Older high-score video archives and the existing `history` evaluation summaries are preserved.

The landing prediction remains available internally to the neural network but has been removed from the spectator display.

### Reward attribution verification

Initial live generation metrics revealed some discrepancies between flip-meter-derived counts and the actual radness total. The trainer now classifies the exact observed positive delta of `wSurfingMinigameRadnessScore` on each gameplay frame (50, 150, 180, 350, or 500) rather than relying on the prior frame's flip meter. Any other positive delta is retained as `unclassifiedRadness`, and the dashboard shows a reconciliation note rather than inventing a trick. This measurement is for analytics and does not affect gameplay or fitness. Existing partial-generation runs retain their original counts and can show a reconciliation discrepancy.

## Verified +500 mixed-flip video evidence

Any run that produces a **genuine +500 radness delta precisely when Pikachu changes from jumping (state 1) to landing (state 2)** triggers an independent evidence recording. Attempts that crash and spurious/non-landing score changes are NOT evidence. This is separate from the high-score rule and applies even if the run later fails, scores zero, or finishes below the all-time record. Multiple +500 awards during a run are counted in one recording.

The recorder first tries a full-run 12fps WebM, subject to the existing 1,800-frame capture horizon and 4 MiB per-video cap. It also snapshots a rolling ~10-second pre-event frame buffer and the next ~10 seconds after the first +500, so it can always fall back to a centered maneuver clip when the full run is truncated or too large. The API includes `fullRun` to distinguish complete runs from event clips. Recording failures are logged, not silently reported as successes.

A dedicated `public.beach_500_videos` table holds immutable evidence. It uses RLS and secret-token-gated `beach_500_save`, `beach_500_list`, and `beach_500_read` RPCs, all called server-side with the existing private checkpoint token. No privilege-bearing token or ROM bytes are served to spectators. Each `(rom_id,total)` is unique, and **these recordings are never pruned by the 20-item high-score retention policy**. The spectator has a separate +500 gallery at `/api/milestones` and `/api/milestones/:id`.

Because the Supabase Free database has limited storage, perpetual retention ultimately depends on space remaining or a future archive/storage upgrade. The list API returns the 100 most recent entries, but no records are deleted automatically. For a rare event, the trainer bypasses the normal 45-second checkpoint throttle before uploading to satisfy ROM/round integrity checks. Historical generations and old videos are untouched.

The new detector is regression-tested for both successful +500 landings and +500 deltas occurring without a landing; deployment should validate the API is empty before the first genuine event and that remote generation progress continues after restart.

## Trick-aware fitness and policy hall of fame

The base fitness remains completed game score + completion bonus (400 once reliable, 1200 otherwise) -35 per wipeout, or a small proportional progress bonus for failed runs. Additionally, a successful +150/+180/+350/+500 award adds +15/+100/+150/+300 evolutionary fitness respectively, capped at **two rewards of each category per run** to prevent farming replacing course completion. A +50 award is already reflected in the game score and receives no extra fitness. This changes only policy ranking; it does **not** alter the ROM's scoring.

The checkpoint now includes `hallOfFame` entries for +180, +350, +500. Each tracks `first` provenance (generation, round, policy, score, finished) and, whenever a current policy discovers/re-discovers it, a `specialist` record with its **complete 363 network weights**. Future generations reserve exact unmutated survivor slots for the champion/top two elites and all retained specialists (+180/+350/+500), with mutations filling the remaining positions. The preserved specialist cannot be discarded merely because its average four-course fitness was lower than the top three.

On service startup, the trainer scans historical generation summary rows and fetches the first detailed generation for each high-value milestone; it credits historical firsts from actual archived runs without inventing neural weights. Archived generation 19 round 901 (+350, policy 10) and generation 20 round 941 (+350, policy 8) are already supported. Their exact previous networks were **not** archived, so the chart says historical discovery / weights unavailable until a current policy repeats the feat. The new small UI chart shows the first record and separately whether a specialist network is preserved, with no special +350 video/evidence system.

A milestone's new weights persist inside the same remote model checkpoint as the rest of the trainer. JSON telemetry exposes only public metadata, never the network weight arrays. Newly discovered specialties will be reintroduced on the **next generation**, not retroactively into an in-progress generation.

### Rescue of still-active generation discoveries

During migration, `recoverCurrentSpecialists` scans already recorded runs in the **current** generation. As long as that generation is still active, the ten original candidate policies are still stored in `training.candidates`; a recorded policy index is an exact, verifiable pointer to its current-generation weights. This lets the trainer immediately preserve a previously successful +180 or +350 specialist without falsely reconstructing older-generation models. Historic first-discovery provenance remains untouched; the specialty field identifies the actual recovered generation/run. Tests exercise this recovery explicitly.
