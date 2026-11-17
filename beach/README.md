# Pikachu’s Beach trainer

The separate page linked from Yellow Editor streams a real Game Boy emulator running the original minigame. The trainer runs independently of the editor, the browser, and any editor project. Its public page shows the live screen, D-pad decisions, and scores on fresh evaluation rounds.

## Build the ROM in Yellow Editor

1. Clone [pret/pokeyellow](https://github.com/pret/pokeyellow) into a separate folder and check out commit `b452f2ab07185075140061c5084ab866d5e4a794`.
2. Run `node beach/prepare-rom.mjs /path/to/pokeyellow` from the Yellow Editor repository. This patches boot and return so the original minigame starts immediately and restarts after its original exit screens. The patch supplies a Surfing Pikachu for the original results-screen cries.
3. Open that source folder in Yellow Editor. Build Pokémon Yellow with **Also download symbols (.sym)** checked. Export the ROM and symbols from the same build. You can playtest the ROM in the editor emulator. On the original results or game-over screen, press A to continue. Select is available for human play after the first round, as in the original.

## Start the trainer locally

Use Node.js 24+, Git and a C compiler on Linux. On Windows, run the server with WSL2 or Docker. The editor build in step 3 can run on Windows. The native bridge uses the same pinned binjgb emulator core as Yellow Editor.

```sh
sh beach/native/build.sh
BEACH_ROM=/path/to/pokeyellow.gbc \
BEACH_SYMBOLS=/path/to/pokeyellow.sym \
BEACH_DATA=/path/to/persistent-training-data \
node beach/server.mjs
```

Open [http://127.0.0.1:8787](http://127.0.0.1:8787). The trainer starts when the server starts. **Watch** paces it in real time while anyone is watching at that speed. **Train fast** leaves it unthrottled unless another viewer is watching in real time. Closing the last viewer leaves it running at full speed. The first run and highest-scoring run save the final ten seconds of their gameplay so you can compare actual attempts. The live stream and clips carry video without audio. Audio is available when playing the ROM in the editor emulator.

## Run on a dedicated site

Build the container from this repository’s root and mount the exported ROM and symbols read-only. Keep the training volume across deploys. Run one replica for each training volume.

```sh
docker build -f beach/Dockerfile -t pikachus-beach .
docker run -d --name pikachus-beach --restart unless-stopped \
  -p 127.0.0.1:8787:8787 \
  --mount type=bind,source=/absolute/path/to/rom-folder,target=/rom,readonly \
  --mount type=volume,source=beach-training,target=/data \
  pikachus-beach
```

Put the service behind HTTPS on your domain. The proxy needs to stream `/api/live` without buffering. Use your host’s access controls if you want to keep the live session private. The server serves the viewer and live data. Keep the ROM and symbols on the server under the paths configured at startup.

To connect from the separate page hosted with Yellow Editor, set `BEACH_VIEWER_ORIGINS` on the server to the exact allowed editor origins, comma-separated, for example `https://gabrielaulenti-grave.github.io`. Then open the **Pikachu’s Beach** link in Yellow Editor and enter the HTTPS trainer address. The standalone site needs no cross-origin setup.

## Training and observations

The learner evolves a small neural network. Each candidate surfs on four naturally generated courses. The strongest policy of that generation then surfs eight fresh evaluation rounds. The page displays the evaluation finish rate, average score, and average wipeouts. At each completed attempt the server atomically saves the policies and history. A process restart boots the ROM again and resumes training from the last completed attempt.

The inputs are Pikachu’s screen position and vertical motion, board angle, HP, speed, progress, and wave heights sampled at eight visible screen positions. Speed and progress come from the ROM’s counters, independently of the fixed water scroll. The server only accepts Left, Right or release from the policy. It handles the A button between rounds and leaves wave selection to the original ROM. Training uses neither emulator state restores nor RNG writes. The native bridge uses the same hardware power-on defaults as the editor emulator.

Run the integration checks against the locally built ROM and symbols with `BEACH_ROM=… BEACH_SYMBOLS=… node --test beach/test.mjs`.
