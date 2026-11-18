// Per-run telemetry derived from observed changes to the actual ROM radness score.
export const TRICK_VALUES = [50, 150, 180, 350, 500];

export function trickAward(meter, flags) {
  if (!Number.isInteger(meter) || meter < 1 || !Number.isInteger(flags)) return 0;
  if ((flags & 3) === 3) return meter >= 3 ? 500 : 180;
  return meter >= 3 ? 350 : meter === 2 ? 150 : 50;
}

export function startRunTelemetry() {
  return { tricks: { "50":0, "150":0, "180":0, "350":0, "500":0 },
    speedSum: 0, speedSamples: 0, hpRemaining: 0, radness: 0,
    lastState: null, lastRadness: 0, lastMeter: 0, lastFlags: 0,
    uncappedRadness: 0, attributionMismatch: false,
    unclassifiedRadness: 0, confirmed500: 0 };
}

export function observeRun(run, state) {
  if (!run || state.routine !== 1) return;
  const increase = state.radness - run.lastRadness;
  const landed = run.lastState === 1 && state.state === 2;
  // The original ROM computes this reward from the flip meter/flags at
  // successful landing. Read the preceding airborne frame, uncapped.
  const award = landed ? trickAward(run.lastMeter, run.lastFlags) : 0;
  const landed500 = award === 500;
  if (award) {
    run.tricks[String(award)]++;
    run.uncappedRadness += award;
    if (landed500) run.confirmed500++;
  }
  // Score deltas become zero beyond the original ROM's 9,999 cap.
  // Require agreement while the BCD subtotal is not saturated.
  const expected = Math.min(9999, run.lastRadness + award) - run.lastRadness;
  if (increase !== expected) {
    run.attributionMismatch = true;
    if (increase > 0 && award === 0) run.unclassifiedRadness += increase;
  }
  run.lastState = state.state;
  run.lastRadness = state.radness;
  run.lastMeter = state.trickMeter ?? 0;
  run.lastFlags = state.trickFlags ?? 0;
  run.speedSum += state.speed;
  run.speedSamples++;
  run.hpRemaining = state.hp;
  run.radness = state.radness;
  return landed500;
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
    uncappedRadness: run.uncappedRadness,
    extendedScore: result.finished && !run.attributionMismatch
      ? run.uncappedRadness + run.hpRemaining : null,
    extendedValid: !run.attributionMismatch,
    confirmed500: run.confirmed500,
    unclassifiedRadness: run.unclassifiedRadness,
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
    averageExtendedScore: mean("extendedScore"),
    bestExtendedScore: count ? Math.max(0,...runs.map(row=>row.extendedScore||0)) : 0,
    averageHP: mean("hpRemaining"), averageSpeed: mean("averageSpeed"),
    bestScore: count ? Math.max(...runs.map(row => row.score || 0)) : 0,
    unclassifiedRadness: runs.reduce((sum,row)=>sum+(row.unclassifiedRadness ?? Math.max(0, (row.radness || 0) - TRICK_VALUES.reduce((s,v)=>s+v*(row.tricks?.[v] || 0),0))),0),
    tricks,
  };
}
