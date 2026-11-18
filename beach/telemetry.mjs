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
    lastState: null, lastRadness: 0, unclassifiedRadness: 0, confirmed500: 0 };
}

export function observeRun(run, state) {
  if (!run || state.routine !== 1) return;
  const increase = state.radness - run.lastRadness;
  // The ROM awards a stunt on the exact jumping -> landing transition.
  // A score increase on a different animation state is not evidence of a landing.
  const landed500 = run.lastState === 1 && state.state === 2 && increase === 500;
  if (landed500) run.confirmed500++;
  // The ROM awards radness immediately when a stunt is landed. Count the
  // actual BCD-score delta rather than inferring from possibly stale meter
  // values; this also catches rewards spanning an animation boundary.
  if (increase > 0) {
    if (TRICK_VALUES.includes(increase)) run.tricks[String(increase)]++;
    else run.unclassifiedRadness += increase;
  }
  run.lastState = state.state;
  run.lastRadness = state.radness;
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
    confirmed500: run.confirmed500,
    unclassifiedRadness: Math.max(0, run.radness - TRICK_VALUES.reduce(
      (sum, value) => sum + value * run.tricks[String(value)], 0)),
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
    unclassifiedRadness: runs.reduce((sum,row)=>sum+(row.unclassifiedRadness ?? Math.max(0, (row.radness || 0) - TRICK_VALUES.reduce((s,v)=>s+v*(row.tricks?.[v] || 0),0))),0),
    tricks,
  };
}
