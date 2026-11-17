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

## Optional durable learning checkpoints (Supabase)

Create a **dedicated** Supabase Free project for the trainer (do not reuse Funeral Workforce databases). Run `beach/checkpoints.sql` in that project's SQL editor or with the connected Supabase SQL tool. The new table has RLS enabled, no access for `anon` or `authenticated`, and server-only `service_role` access.

Add two Render **secret environment variables** to the existing service:
- `BEACH_SUPABASE_URL` — dedicated project's HTTPS URL, such as `https://<project-ref>.supabase.co`
- `BEACH_SUPABASE_SERVICE_KEY` — the project's **secret/service_role** key (server only; never commit, log, or embed in public HTML)

Only when BOTH are present does the trainer restore a remote checkpoint at startup. If fetching the configured remote database fails, startup fails closed instead of silently resetting weights. On each completed round, local checkpointing continues; a remote snapshot is attempted no more than once every 45 seconds. Transient remote write failures are logged and retried at the next round.

**Important migration note:** The first redeploy into this mode replaces the currently running Render Free instance, so the old ephemeral checkpoint may be lost before remote persistence is enabled. This initial transition may reset learning. Future restarts can restore from the latest durable snapshot.

Confirm initial rows appeared in `public.beach_checkpoints` and that `total` increases over time. Explicitly test a restart and check that generation/total resume rather than resetting.

For optional scheduled health checks, see `beach/optional-schedule.sql`. Do not mistake checks for guaranteed uninterrupted execution; confirm the hosting service's policy and limits first.
