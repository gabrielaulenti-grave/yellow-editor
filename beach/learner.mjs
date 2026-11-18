import { randomBytes } from "node:crypto";
import { generationSummary } from "./telemetry.mjs";
import { landingFeatures } from "./landing-predictor.mjs";

const ORIGINAL_INPUTS = 19;
const TEMPORAL_INPUTS = 6; // last four steering actions, turn delta, speed delta
const LANDING_INPUTS = 8; // descent, velocity, fractional velocity, clearance, four terrain types
const PREDICTION_INPUTS = 8; // known, horizon, offset, surface type and safety
const INPUTS = ORIGINAL_INPUTS + TEMPORAL_INPUTS + LANDING_INPUTS + PREDICTION_INPUTS;
const HIDDEN = 8;
const OUTPUTS = 3;
const WEIGHTS = (INPUTS + 1) * HIDDEN + (HIDDEN + 1) * OUTPUTS;
const POPULATION = 10;
const RUNS_PER_POLICY = 4;
const EVALUATION_RUNS = 8;
const ELITE_COUNT = 3;

// Progressively shift from dependable completion to high-scoring tricks.
export function fitness(round, finishRate = 0) {
  const completionBonus = finishRate >= 0.85 ? 400 : 1200;
  return (round.finished ? round.score + completionBonus : 125 * Math.max(0, round.progress || 0))
    - 35 * Math.max(0, round.wipeouts || 0);
}

export function migrateTraining(training) {
  if (!training || !Array.isArray(training.champion) || !Array.isArray(training.candidates))
    throw new Error("Invalid training state");
  // Preserve all three previous policy layouts (187, 235, 299 weights).
  // Appending zero-weight landing inputs to each hidden neuron exactly preserves
  // the old network outputs until mutations start training the new connections.
  const v1Inputs = ORIGINAL_INPUTS;
  const v2Inputs = ORIGINAL_INPUTS + TEMPORAL_INPUTS;
  const v3Inputs = v2Inputs + LANDING_INPUTS;
  const widthFor = inputs => (inputs + 1) * HIDDEN + (HIDDEN + 1) * OUTPUTS;
  const expand = weights => {
    if (!Array.isArray(weights)) throw new Error("Invalid policy weights");
    if (weights.length === WEIGHTS) return weights;
    const oldInputs = weights.length === widthFor(v1Inputs) ? v1Inputs :
      weights.length === widthFor(v2Inputs) ? v2Inputs :
      weights.length === widthFor(v3Inputs) ? v3Inputs : null;
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
  training.policyVersion = 4;
  training.highScore ||= 0;
  training.generationRuns ||= [];
  training.pendingGenerations ||= [];
  return training;
}

export function newTraining() {
  return {
    generation: 1, total: 0, candidate: 0, history: [], evaluation: [], highScore: 0, policyVersion: 4, elites: [],
    generationRuns: [], pendingGenerations: [],
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
  const policy = training.candidate < POPULATION ? training.candidates[training.candidate].weights : training.champion;
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
    averageWipeouts: average(rounds, round => round.wipeouts),
  };
}

export function recordRound(training, round) {
  training.total++;
  // Retain exact run observations through candidate and evaluation phases.
  // Historic checkpoints only have summary data; never manufacture missing rows.
  if (round.tricks && Number.isFinite(round.averageSpeed)) {
    training.generationRuns.push({
      run: training.total,
      policy: training.candidate < POPULATION ? training.candidate + 1 : "evaluation",
      ...round,
    });
  }
  // Store only genuine, completed-course scores; partial attempts are not records.
  if (round.finished && round.score > (training.highScore || 0)) training.highScore = round.score;
  if (training.candidate < POPULATION) {
    const candidate = training.candidates[training.candidate];
    candidate.rounds.push(round);
    if (candidate.rounds.length < RUNS_PER_POLICY) return;
    training.candidate++;
    if (training.candidate !== POPULATION) return;

    const baseline = training.history.length
      ? training.history.slice(-3).reduce((sum, entry) => sum + entry.finishRate, 0) / Math.min(3, training.history.length)
      : 0;
    const rank = entry => ({
      fitness: average(entry.rounds, round => fitness(round, baseline)),
      score: average(entry.rounds, round => round.score),
      finishes: entry.rounds.filter(round => round.finished).length,
    });
    const ranked = training.candidates.map(entry => ({ ...entry, ...rank(entry) }))
      .sort((a, b) => b.fitness - a.fitness || b.score - a.score || b.finishes - a.finishes);
    training.champion = [...ranked[0].weights];
    training.elites = ranked.slice(0, ELITE_COUNT).map(entry => [...entry.weights]);
    return;
  }

  training.evaluation.push(round);
  if (training.evaluation.length < EVALUATION_RUNS) return;
  training.history.push({ generation: training.generation, ...summary(training.evaluation) });
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
  const elites = training.elites?.length ? training.elites : [training.champion];
  training.candidates = Array.from({ length: POPULATION }, (_, index) => ({
    weights: index < elites.length ? [...elites[index]] :
      perturb(elites[(index - elites.length) % elites.length], 0.16 + index * 0.025),
    rounds: [],
  }));
}

export function trainingStats(training) {
  return {
    generation: training.generation, total: training.total, highScore: training.highScore || 0,
    evaluating: training.candidate === POPULATION,
    policy: Math.min(POPULATION, training.candidate + 1),
    population: POPULATION, history: training.history,
  };
}
