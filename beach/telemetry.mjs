// Per-run telemetry derived from observed changes to the actual ROM radness score.
export const TRICK_VALUES = [50, 150, 180, 350, 500];

export function trickAward(meter, flags) {
  if (!Number.isInteger(meter) || meter < 1 || !Number.isInteger(flags)) return 0;
  if ((flags & 3) === 3) return meter >= 3 ? 500 : 180;
  return meter >= 3 ? 350 : meter === 2 ? 150 : 50;
}

export function startRunTelemetry() {
  return {
    tricks: { "50":0, "150":0, "180":0, "350":0, "500":0 },
    speedSum:0, speedSamples:0, hpRemaining:0, radness:0,
    lastState:null, lastRadness:0, lastMeter:0, lastFlags:0,
    uncappedRadness:0, unclassifiedRadness:0, confirmed500:0,
    attributionMismatch:false, overflowUncertain:false,
  };
}

export function observeRun(run, state) {
  if (!run || state.routine < 1 || state.routine > 8) return false;
  const active = state.routine === 1;
  const hasRadness = Number.isSafeInteger(state.radness);
  const current = hasRadness ? state.radness : run.lastRadness;
  const previous = run.lastRadness;
  const increase = Math.max(0, current - previous);
  const landed = run.lastState === 1 && state.state === 2;
  const award = landed ? trickAward(run.lastMeter,run.lastFlags) : 0;
  const landed500 = award === 500;

  // Before saturation, the original ROM's radness value is authoritative,
  // including any final trick that lands just after routine 1 ends.
  // Above 9,999, the register no longer changes; add only independently
  // confirmed landing awards, including the excess of a crossing award.
  if (increase > 0) run.uncappedRadness += increase;
  if (award) {
    run.tricks[String(award)]++;
    if (landed500) run.confirmed500++;
    if (previous === 9999)
      run.uncappedRadness += award;
    else if (current === 9999)
      run.uncappedRadness += Math.max(0, award-increase);
  }

  // Disagreement is diagnostic while the ROM still has an uncapped value;
  // it does NOT invalidate a score that can be independently confirmed by
  // the game's results. After saturation, uncertain extra points must not
  // enter the extended leaderboard.
  if (increase !== (award ? Math.min(9999-previous,award) : 0)) {
    run.attributionMismatch = true;
    if (!award && increase > 0) run.unclassifiedRadness += increase;
    if (previous >= 9999 && increase > 0) run.overflowUncertain = true;
  }

  run.radness = Math.max(run.radness,current);
  run.lastRadness = current;
  run.lastState = state.state;
  run.lastMeter = state.trickMeter ?? 0;
  run.lastFlags = state.trickFlags ?? 0;
  // HP is valid through routine 7. Routine 8 begins consuming it for the
  // results screen, so it must not overwrite the earned HP bonus.
  if (state.routine <= 7 && Number.isSafeInteger(state.hp))
    run.hpRemaining = state.hp;
  if (active && Number.isFinite(state.speed)) {
    run.speedSum += state.speed;
    run.speedSamples++;
  }
  return landed500;
}

export function finishRunTelemetry(run, result) {
  const finished=!!result.finished;
  // The game itself is definitive below 9,999. Above that cap, the game
  // cannot tell us the true total: use the tracked overflow and saved HP.
  const gameScore=Number.isSafeInteger(result.score) ? result.score : 0;
  const aboveCap=finished && gameScore===9999;
  const extendedValid=finished
    ? (!aboveCap || !run.overflowUncertain) : true;
  const independentlyComputed=run.uncappedRadness+run.hpRemaining;
  const extendedScore=!finished ? 0 :
    !aboveCap ? gameScore :
    extendedValid ? Math.max(9999,independentlyComputed) : null;
  return {
    finished,score:gameScore,progress:result.progress,wipeouts:result.wipeouts,
    radness:run.radness,hpRemaining:run.hpRemaining,
    averageSpeed:run.speedSamples ? +(run.speedSum/run.speedSamples).toFixed(4) : 0,
    tricks:{...run.tricks},uncappedRadness:run.uncappedRadness,
    extendedScore,extendedValid,
    scoreReconciliation:finished && !aboveCap ? gameScore-independentlyComputed : null,
    extendedSource:!finished ? "not-awarded" : aboveCap ? "uncapped-tricks" : "game-verified",
    confirmed500:run.confirmed500,unclassifiedRadness:run.unclassifiedRadness,
  };
}

export function generationSummary(generation, runs) {
  const count = runs.length;
  const mean = key => count ? +(runs.reduce((sum, row) => sum + (row[key] || 0), 0) / count).toFixed(3) : 0;
  const withExtended=runs.filter(row=>Number.isSafeInteger(row.extendedScore));
  const averageExtended=withExtended.length
    ? +(withExtended.reduce((sum,row)=>sum+row.extendedScore,0)/withExtended.length).toFixed(3)
    : null;
  const tricks = Object.fromEntries(TRICK_VALUES.map(value =>
    [String(value), runs.reduce((sum, row) => sum + (row.tricks?.[value] || 0), 0)]));
  return {
    generation, runs: count, complete: count === 48,
    completionRate: count ? +(runs.filter(row => row.finished).length / count).toFixed(4) : 0,
    averageScore: mean("score"), averageRadness: mean("radness"),
    averageExtendedScore: averageExtended,
    extendedScoredRuns: withExtended.length,
    extendedMissingRuns: count-withExtended.length,
    bestExtendedScore: count ? Math.max(0,...runs.map(row=>row.extendedScore||0)) : 0,
    averageHP: mean("hpRemaining"), averageSpeed: mean("averageSpeed"),
    bestScore: count ? Math.max(...runs.map(row => row.score || 0)) : 0,
    unclassifiedRadness: runs.reduce((sum,row)=>sum+(row.unclassifiedRadness ?? Math.max(0, (row.radness || 0) - TRICK_VALUES.reduce((s,v)=>s+v*(row.tricks?.[v] || 0),0))),0),
    tricks,
  };
}
