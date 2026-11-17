import { readFile, rename, writeFile } from "node:fs/promises";
import { decide, newTraining, recordRound, trainingStats } from "./learner.mjs";
import { actionNames } from "./emulator.mjs";

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
  while (!options.signal.aborted) {
    const active = state?.routine === 1 && attempt?.finished === undefined;
    const observation = active && {
      state: state.state, x: state.x, y: state.y, angle: state.angle,
      speed: state.speed, hp: state.hp, progress: state.progress, water: state.water,
    };
    const action = active ? decide(training, observation, state.y - lastY) : 0;
    // A is a host-only action. It is tapped on the original exit screens.
    const exit = (state?.routine === 11 || state?.routine === 12) && frame % 12 === 0;
    lastY = state?.y ?? 0;
    const capture = active && frame % captureEvery === 0;
    const live = options.wantsFrame();
    const result = await emulator.step(exit ? 3 : action, capture || live);
    if (capture) clip[clipFrames++ % clipSize] = { pixels: result.pixels, action: actionNames[action] };
    frame++;
    state = result.state;
    if (!attempt && state.routine === 1) {
      lastY = state.y;
      attempt = { wipeouts: 0, previousState: state.state };
    }
    if (attempt && attempt.finished === undefined) {
      if (state.state === 3 && attempt.previousState !== 3) attempt.wipeouts++;
      attempt.previousState = state.state;
      if (state.routine >= 2 && state.routine <= 12) {
        // The results animation deposits its final total before routine 10.
        const finished = state.routine === 10 || state.routine === 11;
        if (finished || state.routine === 12) {
          attempt.finished = finished;
          lastRound = { finished, score: finished ? state.score : 0, progress: state.progress, wipeouts: attempt.wipeouts };
          recordRound(training, lastRound);
          if (clipFrames) {
            const start = Math.max(0, clipFrames - clipSize);
            const frames = Array.from({ length: Math.min(clipFrames, clipSize) }, (_, i) => clip[(start + i) % clipSize]);
            await options.saveClip(lastRound, frames);
          }
          clipFrames = 0;
          await options.checkpoint(training);
          watchdog = 0;
        }
      }
    }
    if (attempt?.finished !== undefined && state.routine === 0) attempt = undefined;
    if (++watchdog > 8500) throw new Error("The ROM did not start or finish a round in time.");

    if (live) {
      options.publish(result.pixels, {
        ...trainingStats(training), lastRound,
        action: actionNames[action],
        phase: state.routine === 1 ? "Surfing" : state.routine >= 2 && state.routine <= 12 ? "Results" : "Starting",
        hp: state.hp, speed: state.speed, progress: state.progress,
        angle: state.angle, radness: state.radness, wipeouts: attempt?.wipeouts ?? 0,
      });
    }
    await options.pace();
  }
}
