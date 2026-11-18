import { readFile, rename, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { decide, newTraining, recordRound, trainingStats } from "./learner.mjs";
import { actionNames } from "./emulator.mjs";
import { predictLanding } from "./landing-predictor.mjs";
import { startRunTelemetry, observeRun, finishRunTelemetry } from "./telemetry.mjs";

export async function loadTraining(path, romId) {
  try {
    const saved = JSON.parse(await readFile(path, "utf8"));
    if (saved.version !== 1 || saved.romId !== romId) {
      throw new Error("The checkpoint belongs to a different ROM or trainer version. Use another BEACH_DATA directory.");
    }
    return saved.training;
  } catch (error) {
    if (error.code === "ENOENT") return newTraining();
    throw error;
  }
}

export async function saveTraining(path, romId, training) {
  await writeFile(`${path}.tmp`, JSON.stringify({ version: 1, romId, training }), { mode: 0o600 });
  await rename(`${path}.tmp`, path);
}

export async function train(emulator, training, options) {
  let state;
  let lastY = 0;
  let attempt;
  let frame = 0;
  let lastRound;
  let watchdog = 0;
  const captureEvery = 5;
  const clipSize = 120;
  const clip = new Array(clipSize);
  let clipFrames = 0;
  let fullFrames = [];
  // Keep a bounded witness of a rare +500 independently of full run length.
  const recentPacked = [];
  let milestoneFrames = null;
  let milestoneAfter = 0;
  let sampledFrames = 0;
  let actionMemory = { actions: [] };
  let runTelemetry;
  while (!options.signal.aborted) {
    const active = state?.routine === 1 && attempt?.finished === undefined;
    const observation = active && {
      state: state.state, x: state.x, y: state.y, angle: state.angle,
      speed: state.speed, hp: state.hp, progress: state.progress, water: state.water,
      descending: state.descending, jumpMagnitude: state.jumpMagnitude,
      jumpFraction: state.jumpFraction, landingClearance: state.landingClearance,
      surfaceTile: state.surfaceTile,
    };
    const prediction = active ? predictLanding(state) : null;
    const action = active ? decide(training, observation, state.y - lastY, actionMemory, prediction) : 0;
    if (active) {
      // Memory is scoped to a single course, never leaked across runs.
      actionMemory.actions.push(action);
      if (actionMemory.actions.length > 4) actionMemory.actions.shift();
      actionMemory.lastAngle = observation.angle;
      actionMemory.lastSpeed = observation.speed;
    }
    // A is a host-only action. It is tapped on the original exit screens.
    const exit = (state?.routine === 11 || state?.routine === 12) && frame % 12 === 0;
    lastY = state?.y ?? 0;
    const capture = active && frame % captureEvery === 0;
    const live = options.wantsFrame();
    const result = await emulator.step(exit ? 3 : action, capture || live);
    if (capture) {
      clip[clipFrames++ % clipSize] = { pixels: result.pixels, action: actionNames[action] };
      const packed = deflateSync(result.pixels, { level: 1 });
      sampledFrames++;
      if (fullFrames.length < 1800) fullFrames.push(packed);
      recentPacked.push(packed);
      if (recentPacked.length > 120) recentPacked.shift();
      if (milestoneFrames && milestoneAfter > 0) {
        milestoneFrames.push(packed);
        milestoneAfter--;
      }
    }
    frame++;
    state = result.state;
    if (!attempt && state.routine === 1) {
      lastY = state.y;
      attempt = { wipeouts: 0, previousState: state.state };
      actionMemory = { actions: [] };
      runTelemetry = startRunTelemetry();
      recentPacked.length = 0;
      milestoneFrames = null;
      milestoneAfter = 0;
      sampledFrames = 0;
    }
    if (attempt && attempt.finished === undefined) {
      const landed500 = observeRun(runTelemetry, state);
      if (landed500 && !milestoneFrames) {
        // Capture roughly 10 seconds before the first verified +500 and
        // the next 10 seconds at 12 video samples per second.
        milestoneFrames = recentPacked.slice(-120);
        milestoneAfter = 120;
      }
      if (state.state === 3 && attempt.previousState !== 3) attempt.wipeouts++;
      attempt.previousState = state.state;
      if (state.routine >= 2 && state.routine <= 12) {
        // The results animation deposits its final total before routine 10.
        const finished = state.routine === 10 || state.routine === 11;
        if (finished || state.routine === 12) {
          attempt.finished = finished;
          lastRound = finishRunTelemetry(runTelemetry, {
            finished, score: finished ? state.score : 0,
            progress: state.progress, wipeouts: attempt.wipeouts,
          });
          const isNewRecord = lastRound.finished && lastRound.score > (training.highScore || 0);
          const generation = training.generation;
          recordRound(training, lastRound);
          // Preserve the model before encoding/uploading a potentially long recording.
          await options.checkpoint(training, { milestone: lastRound.confirmed500 > 0 });
          if (clipFrames) {
            const start = Math.max(0, clipFrames - clipSize);
            const frames = Array.from({ length: Math.min(clipFrames, clipSize) }, (_, i) => clip[(start + i) % clipSize]);
            try {
              await options.saveClip(lastRound, frames,
                isNewRecord || lastRound.confirmed500 > 0 ? fullFrames : null, {
                generation, total: training.total,
                specialCount: lastRound.confirmed500 || 0,
                isRecord: isNewRecord,
                specialFrames: milestoneFrames,
                fullCaptureTruncated: sampledFrames > 1800,
              });
            } catch (error) {
              console.error("Video/clip archival failed:", error.message);
            }
          }
          clipFrames = 0;
          fullFrames = [];
          recentPacked.length = 0;
          milestoneFrames = null;
          milestoneAfter = 0;
          sampledFrames = 0;
          watchdog = 0;
        }
      }
    }
    if (attempt?.finished !== undefined && state.routine === 0) {
      attempt = undefined;
      actionMemory = { actions: [] };
      runTelemetry = undefined;
    }
    if (++watchdog > 8500) throw new Error("The ROM did not start or finish a round in time.");

    if (live) {
      options.publish(result.pixels, {
        ...trainingStats(training), lastRound,
        action: actionNames[action],
        phase: state.routine === 1 ? "Surfing" : state.routine >= 2 && state.routine <= 12 ? "Results" : "Starting",
        hp: state.hp, speed: state.speed, progress: state.progress,
        angle: state.angle, radness: state.radness, wipeouts: attempt?.wipeouts ?? 0,
        predictedLanding: prediction?.known ? prediction : { known: false },
      });
    }
    await options.pace();
  }
}
