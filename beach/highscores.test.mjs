import test from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { newTraining, recordRound, trainingStats, migrateTraining, fitness, decide } from "./learner.mjs";
import { encodeWebm } from "./video.mjs";

test("high score only increases on successful completed courses", () => {
  const training = newTraining();
  assert.equal(trainingStats(training).highScore, 0);
  recordRound(training, { finished: false, score: 2000, progress: 0.5, wipeouts: 1 });
  assert.equal(training.highScore, 0);
  recordRound(training, { finished: true, score: 560, progress: 1, wipeouts: 1 });
  assert.equal(training.highScore, 560);
  recordRound(training, { finished: true, score: 400, progress: 1, wipeouts: 2 });
  assert.equal(training.highScore, 560);
  assert.equal(training.total, 3);
});

test("full-run encoder produces valid, compact WebM", async () => {
  const frames = Array.from({ length: 24 }, (_, i) => {
    const pixels = Buffer.alloc(160 * 144 * 4, 0xff);
    pixels.fill(i % 2 ? 180 : 120, (i * 31) % pixels.length, (i * 31) % pixels.length + 32);
    return deflateSync(pixels, { level: 1 });
  });
  const video = await encodeWebm(frames);
  assert.equal(video.subarray(0, 4).toString("hex"), "1a45dfa3");
  assert.ok(video.length > 100 && video.length < 4194304);
});

test("legacy checkpoint weights expand without changing the original policy outputs", () => {
  const oldLength = 187;
  const old = Array.from({length: oldLength}, (_, i) => Math.sin(i * 0.17));
  const saved = newTraining();
  saved.champion = [...old];
  saved.candidates.forEach(entry => entry.weights = [...old]);
  saved.elites = undefined;
  const migrated = migrateTraining(saved);
  assert.equal(migrated.champion.length, 235);
  assert.equal(migrated.candidates[0].weights.length, 235);
  assert.equal(migrated.policyVersion, 2);
  for (let h = 0; h < 8; h++) {
    assert.deepEqual(migrated.champion.slice(h * 26, h * 26 + 20), old.slice(h * 20, h * 20 + 20));
    assert.deepEqual(migrated.champion.slice(h * 26 + 20, h * 26 + 26), Array(6).fill(0));
  }
  assert.deepEqual(migrated.champion.slice(208), old.slice(160));
  assert.deepEqual(migrateTraining(saved).champion, migrated.champion);
});
test("fitness favors scoring when completion is reliable but retains survival incentive", () => {
  const safe = {finished:true,score:700, progress:1, wipeouts:2};
  const big = {finished:true,score:2000,progress:1,wipeouts:5};
  const fail = {finished:false,score:0,progress:0.6,wipeouts:3};
  assert.ok(fitness(big, 0.92) > fitness(safe, 0.92));
  assert.ok(fitness(safe, 0.3) > fitness(fail, 0.3));
  assert.ok(fitness(safe, 0.92) < fitness(safe, 0.3));
});
test("new temporal features affect steering decisions", () => {
  const t = newTraining();
  // First hidden neuron responds only to most recent action.
  t.candidates[0].weights.fill(0);
  t.candidates[0].weights[20] = 10;
  // Steer right when that neuron is active; release otherwise.
  t.candidates[0].weights[208 + 2 * 9 + 1] = 10;
  const state = { state:1, angle:4,x:80,y:70,speed:1,hp:6000,progress:0.3,water:[100,100,100,100,100,100,100,100] };
  const before = decide(t,state,0,{actions:[]});
  const after = decide(t,state,0,{actions:[2]});
  assert.notEqual(before, after);
});
