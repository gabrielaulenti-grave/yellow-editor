// Per-run telemetry derived from actual ROM state transitions; no guessed rewards.
export const TRICK_VALUES = [50, 150, 180, 350, 500];

export function trickAward(meter, flags) {
  if (!Number.isInteger(meter) || meter < 1 || !Number.isInteger(flags)) return 0;
  if ((flags & 3) === 3) return meter >= 3 ? 500 : 180;
  return meter >= 3 ? 350 : meter === 2 ? 150 : 50;
}

export function startRunTelemetry() {
  return { tricks: { "50":0, "150":0, "180":0, "350":0, "500":0 },
    speedSum: 0, speedSamples: 0, hpRemaining: 0, radness: 0,
    lastState: null, lastMeter: 0, lastFlags: 0 };
}

export function observeRun(run, state) {
  if (!run || state.routine !== 1) return;
  if (run.lastState === 1 && state.state === 2) {
    // The original ROM awards radness when Jumping -> Landing succeeds.
    // These meter/flags are from the immediately preceding jumping frame.
    const award = trickAward(run.lastMeter, run.lastFlags);
    if (award) run.tricks[String(award)]++;
  }
  run.lastState = state.state;
  run.lastMeter = state.trickMeter;
  run.lastFlags = state.trickFlags;
  run.speedSum += state.speed;
  run.speedSamples++;
  run.hpRemaining = state.hp;
  run.radness = state.radness;
}

export function finishRunTelemetry(run, result) {
  return {
    finished: !!result.finished,
    score: result.score,
    progress: result.progress,
    wipeouts: result.wipeouts,
    radness: run.radness,
    hpRemaining: run.hpRemaining,
    averageSpeed: run.speedSamples ? +(run.speedSum / run.speedSamples).toFixed(4) : 0,
    tricks: { ...run.tricks },
  };
}

export function generationSummary(generation, runs) {
  const count = runs.length;
  const mean = key => count ? +(runs.reduce((sum, row) => sum + (row[key] || 0), 0) / count).toFixed(3) : 0;
  const tricks = Object.fromEntries(TRICK_VALUES.map(value =>
    [String(value), runs.reduce((sum, row) => sum + (row.tricks?.[value] || 0), 0)]));
  return {
    generation, runs: count, complete: count === 48,
    completionRate: count ? +(runs.filter(row => row.finished).length / count).toFixed(4) : 0,
    averageScore: mean("score"), averageRadness: mean("radness"),
    averageHP: mean("hpRemaining"), averageSpeed: mean("averageSpeed"),
    bestScore: count ? Math.max(...runs.map(row => row.score || 0)) : 0,
    tricks,
  };
}
