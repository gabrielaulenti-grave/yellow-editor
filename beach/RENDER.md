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
