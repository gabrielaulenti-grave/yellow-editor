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
