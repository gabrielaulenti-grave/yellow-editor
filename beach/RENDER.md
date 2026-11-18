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
