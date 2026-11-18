import { randomBytes } from "node:crypto";

const INPUTS = 19;
const HIDDEN = 8;
const OUTPUTS = 3;
const WEIGHTS = (INPUTS + 1) * HIDDEN + (HIDDEN + 1) * OUTPUTS;
const POPULATION = 10;
const RUNS_PER_POLICY = 4;
const EVALUATION_RUNS = 8;

export function newTraining() {
  return {
    generation: 1, total: 0, candidate: 0, history: [], evaluation: [], highScore: 0,
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

export function decide(training, state, verticalMotion) {
  if (state.state !== 1) return 0;
  const policy = training.candidate < POPULATION ? training.candidates[training.candidate].weights : training.champion;
  const angle = (state.angle - 4) * Math.PI / 7;
  const input = [
    state.x / 160, state.y / 144, verticalMotion / 8, Math.sin(angle), Math.cos(angle),
    state.speed / 4, state.hp / 6000, state.progress,
    ...state.water.map(y => (116 - y) / 48),
    ...state.water.slice(2, 5).map((y, i) => (y - state.water[i + 1]) / 16),
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
  // Store only genuine, completed-course scores; partial attempts are not records.
  if (round.finished && round.score > (training.highScore || 0)) training.highScore = round.score;
  if (training.candidate < POPULATION) {
    const candidate = training.candidates[training.candidate];
    candidate.rounds.push(round);
    if (candidate.rounds.length < RUNS_PER_POLICY) return;
    training.candidate++;
    if (training.candidate !== POPULATION) return;

    const rank = entry => ({
      score: average(entry.rounds, result => result.score),
      progress: average(entry.rounds, result => result.progress),
      finishes: entry.rounds.filter(result => result.finished).length,
    });
    const ranked = training.candidates.map(entry => ({ ...entry, ...rank(entry) }))
      .sort((a, b) => b.finishes - a.finishes || b.score - a.score || b.progress - a.progress);
    training.champion = ranked[0].weights;
    return;
  }

  training.evaluation.push(round);
  if (training.evaluation.length < EVALUATION_RUNS) return;
  training.history.push({ generation: training.generation, ...summary(training.evaluation) });
  training.history = training.history.slice(-100);
  training.generation++;
  training.candidate = 0;
  training.evaluation = [];
  training.candidates = Array.from({ length: POPULATION }, (_, index) => ({
    weights: index === 0 ? training.champion : perturb(training.champion, 0.16 + index * 0.025),
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
