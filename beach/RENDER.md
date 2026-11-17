# Render free-tier deployment (experimental)

This is a standalone server for the Pikachu's Beach training agent and public spectator page; it is unrelated to Yellow Editor's editor state or user projects.

## Files and security

Use the existing instructions in [README.md](README.md) to build the specially modified Game Boy ROM and its matching `.sym` file in Yellow Editor. **Never commit either file** to a public or private Git repository, embed them in a client bundle, or make them downloadable from a web route.

In Render, provide these as **Secret Files** (file names exactly):
- `pokeyellow.gbc`
- `pokeyellow.sym`

Render exposes secret files at runtime under `/etc/secrets/`, matching `BEACH_ROM` and `BEACH_SYMBOLS` in the Blueprint. These inputs are required: the app deliberately refuses to start without them. Do not use environment variable values containing ROM bytes or place ROM files in Docker build context.

The player receives only rendered frames and statistics. The public service has no exposed controls to play the game. This reduces distribution exposure but does not constitute legal clearance for broadcasting copyrighted gameplay.

## Deploy

1. Connect this GitHub repository to your Render workspace.
2. Create a **Blueprint** and set the Blueprint Path to `beach/render.yaml`, branch `pikachus-beach-trainer`.
3. Confirm plan **Free**. Add the two Secret Files to the web service before starting/redeploying it.
4. Check `/api/health` (should return `{"ok":true}`) and load the service root URL to watch the agent.
5. Verify training completes an attempt and the live feed changes; `ok: true` alone only indicates the server did not report a fatal error.

The service is intended to expose a Render URL of the form `https://<assigned-service-name>.onrender.com/`; the exact URL must be obtained from the deployed service and checked. Do not assume the name is available.

## Free tier limitations — important

The current agent checkpoints to `/data/training.json`, but **Render Free does not provide persistent disks**. Local checkpoints and clips will be lost when the container is replaced, restarted, or redeployed. Render Free also sleeps after about 15 minutes without inbound traffic; the training loop is suspended while sleeping. Thus this setup is a proof of concept / live preview, **not a durable, continuous ML training environment**. The current code has no external checkpoint store; do not represent this as lossless training.

Do not add a fake keepalive loop or promise 24/7 free service. Before relying on the service for lengthy training, implement external checkpoint persistence with credentials kept server-side, and test backup/restore plus interruption recovery. If uninterrupted training is a hard requirement, move to a provider/plan that permits persistent background execution.

For Render documentation see:
- https://render.com/docs/free
- https://render.com/docs/blueprint-spec
- https://render.com/docs/configure-environment-variables
