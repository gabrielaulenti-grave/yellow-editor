import { randomBytes } from "node:crypto";
import { generationSummary } from "./telemetry.mjs";
import { landingFeatures } from "./landing-predictor.mjs";

const ORIGINAL_INPUTS = 19;
const TEMPORAL_INPUTS = 6; // last four steering actions, turn delta, speed delta
const LANDING_INPUTS = 8; // descent, velocity, fractional velocity, clearance, four terrain types
const PREDICTION_INPUTS = 8; // known, horizon, offset, surface type and safety
const FLIP_INPUTS = 5; // left/right hold progress, credited flips, left/right trick flags
const TIMING_INPUTS = 2; // left/right frames remaining until landing after completing a flip
const INPUTS = ORIGINAL_INPUTS + TEMPORAL_INPUTS + LANDING_INPUTS + PREDICTION_INPUTS + FLIP_INPUTS + TIMING_INPUTS;
const HIDDEN = 8;
const OUTPUTS = 3;
const WEIGHTS = (INPUTS + 1) * HIDDEN + (HIDDEN + 1) * OUTPUTS;
const POPULATION = 10;
const RUNS_PER_POLICY = 4;
const EVALUATION_RUNS = 8;
const ELITE_COUNT = 3;
const SPECIALIST_GENERATIONS = 2;
const MUTATION_SCALES = [0.055, 0.085, 0.11, 0.15, 0.20, 0.26, 0.34];

const MILESTONE_BONUSES = Object.freeze({ "150": 15, "180": 100, "350": 150, "500": 300 });
export const MILESTONE_AWARDS = Object.freeze([180, 350, 500]);

function trickCount(round, award) {
  const value = round?.tricks?.[String(award)];
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

export function milestoneBonus(round) {
  // Modest and capped: impressive tricks matter, but finishing still matters.
  return Object.entries(MILESTONE_BONUSES).reduce((sum,[award,bonus]) => {
    // New +500 telemetry must corroborate the ROM's actual point increment.
    // Historic rows without confirmation metadata retain their old semantics.
    const count=award==="500" && Number.isSafeInteger(round?.confirmed500)
      ? Math.max(0,round.confirmed500) : trickCount(round,award);
    return sum+Math.min(2,count)*bonus;
  },0);
}

function validPolicy(weights) {
  return Array.isArray(weights) && weights.length === WEIGHTS &&
    weights.every(Number.isFinite);
}

export function backfillMilestones(training, generations) {
  training.hallOfFame ||= {};
  // Past generation archives contain observations but NOT candidate weights.
  for(const entry of [...generations].sort((a,b)=>a.generation-b.generation)) {
    if(!Array.isArray(entry.runs)) continue;
    for(const row of entry.runs) for(const award of MILESTONE_AWARDS) {
      if(!trickCount(row,award)) continue;
      const key=String(award);
      const first={generation:entry.generation,run:row.run,policy:row.policy,
        score:row.score,finished:!!row.finished};
      const previous=training.hallOfFame[key]?.first;
      if(!previous || first.run<previous.run) {
        training.hallOfFame[key]={...(training.hallOfFame[key]||{}),first};
      }
    }
  }
  return training.hallOfFame;
}

export function recoverCurrentSpecialists(training) {
  // Candidate weights do remain in an in-progress generation, even after
  // that candidate has finished its four evaluation runs. This permits
  // reliable reconstruction of discoveries made earlier in THIS generation.
  training.hallOfFame ||= {};
  for (const row of training.generationRuns || []) {
    for (const award of MILESTONE_AWARDS) {
      if (!trickCount(row,award)) continue;
      const key=String(award);
      const prior=training.hallOfFame[key] || {};
      if(prior.specialist) continue;
      const weights=Number.isInteger(row.policy) && row.policy>=1 && row.policy<=POPULATION
        ? training.candidates[row.policy-1]?.weights
        : row.policy==="evaluation" ? training.champion :
          row.policy==="challenger" ? training.duel?.challenger :
          row.policy==="incumbent" ? training.duel?.incumbent : null;
      if(!validPolicy(weights)) continue;
      training.hallOfFame[key]={
        first:prior.first||{generation:training.generation,run:row.run,policy:row.policy,
          score:row.score,finished:!!row.finished},
        specialist:{generation:training.generation,run:row.run,policy:row.policy,
          score:row.score,finished:!!row.finished,weights:[...weights]},
      };
    }
  }
  return training.hallOfFame;
}

export function publicMilestones(training) {
  return MILESTONE_AWARDS.map(award=>{
    const value=training.hallOfFame?.[String(award)];
    const specialist=value?.specialist;
    return {award,first:value?.first||null,specialist:specialist ? {
      generation:specialist.generation,run:specialist.run,
      policy:specialist.policy,score:specialist.score,
      active:validPolicy(specialist.weights) &&
        training.generation-specialist.generation<SPECIALIST_GENERATIONS,
      retiredAt:specialist.retiredAt||null
    } : null};
  });
}

function captureMilestones(training,round) {
  training.hallOfFame ||= {};
  for(const award of MILESTONE_AWARDS) {
    if(!trickCount(round,award)) continue;
    const key=String(award);
    const old=training.hallOfFame[key]||{};
    const provenance={generation:training.generation,run:training.total,
      policy:training.candidate<POPULATION ? training.candidate+1 : "evaluation",
      score:round.score,finished:!!round.finished};
    const weights=training.candidate<POPULATION
      ? training.candidates[training.candidate]?.weights : evaluationPolicy(training);
    training.hallOfFame[key]={
      first:old.first||provenance,
      specialist:old.specialist||(validPolicy(weights)
        ? {...provenance,weights:[...weights]} : null),
    };
  }
}


function retireOldSpecialists(training) {
  for(const award of MILESTONE_AWARDS) {
    const specialist=training.hallOfFame?.[String(award)]?.specialist;
    if (!specialist?.weights) continue;
    if (training.generation-specialist.generation>=SPECIALIST_GENERATIONS) {
      delete specialist.weights;
      specialist.retiredAt=training.generation;
    }
  }
}
function samePolicy(a,b) {
  return a.length===b.length && a.every((value,i)=>value===b[i]);
}
function nextGenerationPolicies(training) {
  retireOldSpecialists(training);
  const parents=[training.champion];
  for(const elite of training.elites||[]) {
    if(validPolicy(elite) && parents.length<ELITE_COUNT &&
       !parents.some(existing=>samePolicy(existing,elite))) parents.push(elite);
  }
  const recent=MILESTONE_AWARDS.map(award=>
    training.hallOfFame?.[String(award)]?.specialist)
    .filter(item=>item && validPolicy(item.weights) &&
       training.generation-item.generation<SPECIALIST_GENERATIONS)
    .sort((a,b)=>b.generation-a.generation);
  const candidates=parents.map(weights=>({weights:[...weights],rounds:[]}));
  let mutation=0;
  if (recent.length && candidates.length<POPULATION) {
    candidates.push({weights:perturb(recent[0].weights,0.10),rounds:[]});
    mutation++;
  }
  while(candidates.length<POPULATION) {
    const scale=MUTATION_SCALES[Math.min(mutation,MUTATION_SCALES.length-1)];
    candidates.push({weights:perturb(parents[mutation%parents.length],scale),rounds:[]});
    mutation++;
  }
  return candidates;
}
function meanFitness(rounds,baseline) {
  return average(rounds,round=>fitness(round,baseline));
}
// Champion selection uses only actual earned game points (or verified
// uncapped points). Unfinished courses earn no competitive score.
export function competitiveScore(round) {
  if (!round?.finished) return 0;
  if (round.extendedValid!==false && Number.isSafeInteger(round.extendedScore))
    return round.extendedScore;
  return Number.isSafeInteger(round.score) ? round.score : 0;
}
export function competitiveResults(rounds) {
  return {
    averageScore:average(rounds,competitiveScore),
    finishes:rounds.filter(round=>round.finished).length,
    runs:rounds.length,
  };
}
function completionBaseline(training) {
  const history=training.history.slice(-3);
  return history.length?average(history,item=>item.finishRate):0;
}
function selectCandidate(training) {
  const baseline=completionBaseline(training);
  return training.candidates.map((candidate,index)=>{
    const performance=competitiveResults(candidate.rounds);
    return {
      index,weights:candidate.weights,rounds:candidate.rounds,
      fitness:meanFitness(candidate.rounds,baseline),
      finishes:performance.finishes,gameAverage:performance.averageScore,
    };
  }).sort((a,b)=>b.fitness-a.fitness||b.finishes-a.finishes);
}
// Nominate the best genuine game score among challengers that have completed
// at least as many discovery runs as the unchanged incumbent. Shaping bonuses
// remain useful for breeding elites, but cannot nominate a worse-scoring
// candidate merely for performing particular tricks.
function selectChallenger(ranked) {
  const incumbent=ranked.find(entry=>entry.index===0);
  return ranked.filter(entry=>entry.index!==0 &&
    entry.finishes >= (incumbent?.finishes??0))
    .sort((a,b)=>b.gameAverage-a.gameAverage ||
      b.finishes-a.finishes || b.fitness-a.fitness || a.index-b.index)[0] ?? null;
}
function evaluationPolicy(training) {
  if(!training.duel) return training.champion;
  return training.evaluation.length<4?training.duel.challenger:training.duel.incumbent;
}


// Positive: a flip can finish with time to spare. Negative: the landing
// is predicted before the flip completes. A conservative 3-frame buffer
// accounts for course prediction uncertainty and steering to a safe angle.
// Zero for unknown landing time; the existing predictor-known input disambiguates.
export function rotationTimingFeatures(state, prediction) {
  if (!prediction?.known || !Number.isFinite(prediction.frames)) return [0,0];
  const frames=Math.max(0,prediction.frames);
  const margin=(needed)=>Math.max(-1,Math.min(1,(frames-needed-3)/24));
  return [
    margin(Math.max(0,12-(state.leftFlipProgress??0))),
    margin(Math.max(0,14-(state.rightFlipProgress??0))),
  ];
}

// Small bounded shaping rewards. Never infer opportunities for historical
// runs missing the new telemetry. The original score and records are untouched.
export function opportunityPenalty(round) {
  const o=round?.opportunity;
  if (!o || !Number.isSafeInteger(o.eligibleEmpty) ||
      !Number.isSafeInteger(o.abandonedRotations)) return 0;
  const missed=Math.max(0,Math.min(1000,o.eligibleEmpty));
  const abandoned=Math.max(0,Math.min(10000,o.abandonedRotations));
  return Math.min(150,8*missed+2*abandoned);
}

// Progressively shift from dependable completion to high-scoring tricks.
export function fitness(round, finishRate = 0) {
  const completionBonus = finishRate >= 0.85 ? 400 : 1200;
  const points = round.extendedValid !== false && Number.isSafeInteger(round.extendedScore)
    ? round.extendedScore : round.score;
  return (round.finished ? points + completionBonus : 125 * Math.max(0, round.progress || 0))
    - 35 * Math.max(0, round.wipeouts || 0) + milestoneBonus(round)
    - opportunityPenalty(round);
}

export function migrateTraining(training) {
  if (!training || !Array.isArray(training.champion) || !Array.isArray(training.candidates))
    throw new Error("Invalid training state");
  // Preserve all previous policy layouts (187, 235, 299, 363, 403 weights).
  // Appending zero-weight landing inputs to each hidden neuron exactly preserves
  // the old network outputs until mutations start training the new connections.
  const v1Inputs = ORIGINAL_INPUTS;
  const v2Inputs = ORIGINAL_INPUTS + TEMPORAL_INPUTS;
  const v3Inputs = v2Inputs + LANDING_INPUTS;
  const v4Inputs = v3Inputs + PREDICTION_INPUTS;
  const v5Inputs = v4Inputs + FLIP_INPUTS;
  const widthFor = inputs => (inputs + 1) * HIDDEN + (HIDDEN + 1) * OUTPUTS;
  const expand = weights => {
    if (!Array.isArray(weights)) throw new Error("Invalid policy weights");
    if (weights.length === WEIGHTS) return weights;
    const oldInputs = weights.length === widthFor(v1Inputs) ? v1Inputs :
      weights.length === widthFor(v2Inputs) ? v2Inputs :
      weights.length === widthFor(v3Inputs) ? v3Inputs :
      weights.length === widthFor(v4Inputs) ? v4Inputs :
      weights.length === widthFor(v5Inputs) ? v5Inputs : null;
    if (oldInputs === null) throw new Error("Unknown policy architecture");
    const result = [];
    for (let neuron = 0; neuron < HIDDEN; neuron++) {
      result.push(...weights.slice(neuron * (oldInputs + 1), (neuron + 1) * (oldInputs + 1)));
      result.push(...Array(INPUTS - oldInputs).fill(0));
    }
    result.push(...weights.slice((oldInputs + 1) * HIDDEN));
    return result;
  };
  training.champion = expand(training.champion);
  for (const candidate of training.candidates) candidate.weights = expand(candidate.weights);
  training.elites = (training.elites || []).map(expand);
  // A redeploy can occur halfway through the protected champion duel.
  // Both frozen contestants must migrate with the candidates to maintain
  // identical behavior before evolution learns the five new observations.
  if (training.duel) {
    training.duel.incumbent = expand(training.duel.incumbent);
    training.duel.challenger = expand(training.duel.challenger);
  }
  for (const entry of Object.values(training.hallOfFame || {})) {
    if (entry?.specialist?.weights)
      entry.specialist.weights = expand(entry.specialist.weights);
  }
  training.policyVersion = 6;
  training.selectionVersion = 3;
  training.highScore ||= 0;
  // A recorded score below the ROM cap is a proven uncapped-score floor.
  // We do not fabricate historic per-run events.
  training.highExtendedScore ??= (training.highScore < 9999 ? training.highScore : 0);
  training.generationRuns ||= [];
  training.pendingGenerations ||= [];
  training.hallOfFame ||= {};
  for(const award of MILESTONE_AWARDS) {
    const specialist=training.hallOfFame[String(award)]?.specialist;
    if(specialist?.weights && !validPolicy(specialist.weights))
      throw new Error("Invalid preserved milestone policy weights");
  }
  retireOldSpecialists(training);
  return training;
}

export function newTraining() {
  return {
    generation: 1, total: 0, candidate: 0, history: [], evaluation: [], highScore: 0, highExtendedScore: 0, policyVersion: 6, elites: [],
    generationRuns: [], pendingGenerations: [], hallOfFame: {},
    selectionVersion: 3, duel: null, lastSelection: null,
    champion: Array(WEIGHTS).fill(0),
    candidates: Array.from({ length: POPULATION }, (_, index) => ({
      weights: index === 0 ? Array(WEIGHTS).fill(0) : perturb(Array(WEIGHTS).fill(0), 0.65),
      rounds: [],
    })),
  };
}

function perturb(weights, scale) {
  // This randomness belongs to the learner. It is never passed to the ROM.
  const bytes = randomBytes(weights.length * 2);
  return weights.map((value, index) => value + (bytes.readUInt16LE(index * 2) / 32767.5 - 1) * scale);
}

export function decide(training, state, verticalMotion, memory = {}, prediction = null) {
  if (state.state !== 1) return 0;
  const policy = training.candidate < POPULATION ? training.candidates[training.candidate].weights : evaluationPolicy(training);
  const angle = (state.angle - 4) * Math.PI / 7;
  const input = [
    state.x / 160, state.y / 144, verticalMotion / 8, Math.sin(angle), Math.cos(angle),
    state.speed / 4, state.hp / 6000, state.progress,
    ...state.water.map(y => (116 - y) / 48),
    ...state.water.slice(2, 5).map((y, i) => (y - state.water[i + 1]) / 16),
    ...Array.from({ length: 4 }, (_, i) => (memory.actions?.at(-1-i) ?? 0) / 2),
    (state.angle - (memory.lastAngle ?? state.angle)) / 7,
    (state.speed - (memory.lastSpeed ?? state.speed)) / 4,
    // The original game scores the frameset against this exact contact tile.
    // Expose time-to-contact cues without predicting or overriding game physics.
    (state.descending ?? 0) ? 1 : 0,
    (state.jumpMagnitude ?? 0) / 16,
    (state.jumpFraction ?? 0) / 256,
    Math.min(2, (state.landingClearance ?? 0) / 144),
    ...[6, 20, 18, 7].map(tile => +(state.surfaceTile === tile)),
    ...landingFeatures(prediction),
    // The sound-effect-equivalent flip state. The original game requires
    // 12 uninterrupted left or 14 uninterrupted right input frames before
    // the trick meter advances; switching resets the opposite counter.
    Math.min(state.leftFlipProgress ?? 0, 12) / 12,
    Math.min(state.rightFlipProgress ?? 0, 14) / 14,
    Math.min(state.trickMeter ?? 0, 3) / 3,
    ((state.trickFlags ?? 0) & 1) ? 1 : 0,
    ((state.trickFlags ?? 0) & 2) ? 1 : 0,
    ...rotationTimingFeatures(state,prediction),

  ];
  let offset = 0;
  const layer = (values, width) => Array.from({ length: width }, () => {
    let sum = policy[offset++];
    for (const value of values) sum += value * policy[offset++];
    return Math.tanh(sum);
  });
  const outputs = layer(layer(input, HIDDEN), OUTPUTS);
  return outputs.indexOf(Math.max(...outputs));
}

function average(values, read) {
  return values.reduce((sum, value) => sum + read(value), 0) / Math.max(1, values.length);
}

function summary(rounds) {
  return {
    finishRate: average(rounds, round => +round.finished),
    averageScore: Math.round(average(rounds, round => round.score)),
    averageExtendedScore: Math.round(average(rounds, round =>
      Number.isSafeInteger(round.extendedScore) ? round.extendedScore : round.score)),
    averageWipeouts: average(rounds, round => round.wipeouts),
  };
}

export function recordRound(training, round) {
  training.total++;
  captureMilestones(training,round);
  // Retain exact run observations through candidate and evaluation phases.
  // Historic checkpoints only have summary data; never manufacture missing rows.
  if (round.tricks && Number.isFinite(round.averageSpeed)) {
    training.generationRuns.push({
      run: training.total,
      policy: training.candidate < POPULATION ? training.candidate + 1 :
        training.duel ? (training.evaluation.length<4 ? "challenger":"incumbent") : "evaluation",
      ...round,
    });
  }
  // Store only genuine, completed-course scores; partial attempts are not records.
  if (round.finished && round.score > (training.highScore || 0)) training.highScore = round.score;
  if (round.finished && round.extendedValid !== false && Number.isSafeInteger(round.extendedScore)
      && round.extendedScore > (training.highExtendedScore || 0))
    training.highExtendedScore = round.extendedScore;
  if (training.candidate < POPULATION) {
    const candidate = training.candidates[training.candidate];
    candidate.rounds.push(round);
    if (candidate.rounds.length < RUNS_PER_POLICY) return;
    training.candidate++;
    if (training.candidate !== POPULATION) return;


    const ranked=selectCandidate(training);
    // Candidate zero is the previous champion. Hold it as incumbent.
    const challenger=selectChallenger(ranked);
    training.duel={
      incumbent:[...training.champion],
      challenger:[...(challenger?.weights||training.champion)],
      challengerIndex:challenger?.index??0,
      baseline:completionBaseline(training),
      incumbentRounds:[...training.candidates[0].rounds],
      challengerRounds:[...(challenger?.rounds||training.candidates[0].rounds)]
    };
    // Keep exploration-oriented high-fitness lineages without allowing
    // their handcrafted bonuses to determine promotion.
    const eliteRows=[ranked.find(entry=>entry.index===0),challenger,
      ...ranked].filter(Boolean).filter((entry,index,rows)=>
      rows.findIndex(other=>samePolicy(other.weights,entry.weights))===index
    ).slice(0,ELITE_COUNT);
    training.elites=eliteRows.map(entry=>[...entry.weights]);
    return;
  }


  training.evaluation.push(round);
  if(training.evaluation.length<EVALUATION_RUNS) return;
  if(training.duel) {
    const duel=training.duel;
    const challengerTrials=[...duel.challengerRounds,...training.evaluation.slice(0,4)];
    const incumbentTrials=[...duel.incumbentRounds,...training.evaluation.slice(4,8)];
    // Scoring is the ROM's final score, including HP and all trick choices.
    // A safe slow strategy therefore gets exactly the same treatment as a
    // fast one. Preserve a reliability guard: no promotion if the contender
    // finishes fewer of the equal-length trial set than the incumbent.
    const challengerFitness=meanFitness(challengerTrials,duel.baseline);
    const incumbentFitness=meanFitness(incumbentTrials,duel.baseline);
    const challengerCompetitive=competitiveResults(challengerTrials);
    const incumbentCompetitive=competitiveResults(incumbentTrials);
    const promoted=duel.challengerIndex!==0 &&
      challengerCompetitive.runs===incumbentCompetitive.runs &&
      challengerCompetitive.finishes>=incumbentCompetitive.finishes &&
      challengerCompetitive.averageScore>incumbentCompetitive.averageScore;
    if(promoted) training.champion=[...duel.challenger];
    training.history.push({generation:training.generation,
      ...summary(promoted?training.evaluation.slice(0,4):
        training.evaluation.slice(4,8))});
    training.lastSelection={generation:training.generation,promoted,
      selectionMode:"game-score-v3",
      challengerIndex:duel.challengerIndex+1,
      challengerScore:Math.round(challengerCompetitive.averageScore),
      incumbentScore:Math.round(incumbentCompetitive.averageScore),
      challengerFinishes:challengerCompetitive.finishes,
      incumbentFinishes:incumbentCompetitive.finishes,
      trialCount:challengerCompetitive.runs,
      // Exploratory shaping is retained for diagnostic comparisons only.
      challengerFitness:Math.round(challengerFitness),
      incumbentFitness:Math.round(incumbentFitness),margin:0};
  } else {
    // An evaluation already in progress at deployment uses legacy semantics.
    training.history.push({generation:training.generation,
      ...summary(training.evaluation)});
  }
  const archivedRuns = training.generationRuns;
  training.pendingGenerations.push({
    generation: training.generation, runs: archivedRuns,
    summary: generationSummary(training.generation, archivedRuns),
  });
  training.generationRuns = [];
  training.history = training.history.slice(-100);
  training.generation++;
  training.candidate = 0;
  training.evaluation = [];
  training.duel = null;
  training.candidates = nextGenerationPolicies(training);
}

export function trainingStats(training) {
  return {
    generation: training.generation, total: training.total, highScore: training.highScore || 0,
    highExtendedScore: training.highExtendedScore || 0,
    evaluating: training.candidate === POPULATION,
    policy: Math.min(POPULATION, training.candidate + 1),
    population: POPULATION, history: training.history,
    milestones: publicMilestones(training),
    selection: training.lastSelection || null,
  };
}
