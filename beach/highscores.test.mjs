import test from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { newTraining, recordRound, trainingStats, migrateTraining, fitness, decide } from "./learner.mjs";
import { encodeWebm } from "./video.mjs";
import { decode, memoryFields } from "./emulator.mjs";
import { predictLanding, landingSafety, landingFeatures } from "./landing-predictor.mjs";

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

test("v1, v2, v3 checkpoints migrate without losing any learned connections", () => {
  for (const oldInputs of [19, 25, 33]) {
    const oldWidth = (oldInputs + 1) * 8 + 9 * 3;
    const old = Array.from({length: oldWidth}, (_, i) => Math.sin(i * 0.17));
    const saved = newTraining();
    saved.champion = [...old];
    saved.candidates.forEach(entry => entry.weights = [...old]);
    saved.elites = [[...old]];
    const migrated = migrateTraining(saved);
    assert.equal(migrated.champion.length, 363);
    assert.equal(migrated.candidates[0].weights.length, 363);
    assert.equal(migrated.elites[0].length, 363);
    assert.equal(migrated.policyVersion, 4);
    for (let h = 0; h < 8; h++) {
      const target = h * 42;
      const source = h * (oldInputs + 1);
      assert.deepEqual(
        migrated.champion.slice(target, target + oldInputs + 1),
        old.slice(source, source + oldInputs + 1),
      );
      assert.deepEqual(migrated.champion.slice(target + oldInputs + 1, target + 42),
        Array(41 - oldInputs).fill(0));
    }
    assert.deepEqual(migrated.champion.slice(336), old.slice((oldInputs + 1) * 8));
    assert.deepEqual(migrateTraining(saved).champion, migrated.champion);
  }
});
test("new model responds to actual landing and descending telemetry", () => {
  const t = newTraining();
  t.candidates[0].weights.fill(0);
  // First neuron: react to descending flag at input index 25.
  t.candidates[0].weights[26] = 10;
  // A strong positive signal to turn right from first neuron.
  t.candidates[0].weights[336 + 2 * 9 + 1] = 10;
  const state = {
    state: 1, angle: 4, x: 80, y: 70, speed: 1,
    hp: 6000, progress: 0.3,
    water: Array(8).fill(100),
    descending: 0, jumpMagnitude: 4, jumpFraction: 0,
    landingClearance: 60, surfaceTile: 6,
  };
  const memory = {actions: []};
  assert.notEqual(decide(t, state, 0, memory), decide(t, {...state, descending: 1}, 0, memory));
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
  t.candidates[0].weights[336 + 2 * 9 + 1] = 10;
  const state = { state:1, angle:4,x:80,y:70,speed:1,hp:6000,progress:0.3,water:[100,100,100,100,100,100,100,100] };
  const before = decide(t,state,0,{actions:[]});
  const after = decide(t,state,0,{actions:[2]});
  assert.notEqual(before, after);
});

test("emulator decodes physical landing variables without using sprite-display offsets", () => {
  const fieldBytes = Object.values(memoryFields).reduce((sum, [, width]) => sum + width, 0);
  const buffer = Buffer.alloc(fieldBytes);
  let offset = 0;
  const set = { state: 1, angle: 4, y: 80, yOffset: 3, descending: 1,
    jumpMagnitude: 5, jumpFraction: 128, groundHeight: 105, surfaceTile: 20 };
  for (const [name, [, width]] of Object.entries(memoryFields)) {
    if (Object.hasOwn(set, name)) buffer.writeUInt8(set[name], offset);
    offset += width;
  }
  const state = decode(buffer);
  assert.equal(state.angle, 4);
  assert.equal(state.descending, 1);
  assert.equal(state.jumpMagnitude, 5);
  assert.equal(state.jumpFraction, 128);
  assert.equal(state.groundHeight, 105);
  assert.equal(state.surfaceTile, 20);
  assert.equal(state.landingClearance, 25);
  assert.equal(state.y, 67); // display Y: raw 80 + offset 3 - sprite origin 16
});

test("predictor simulates contact and uses actual upcoming terrain tiles", () => {
  const state = {
    state: 1, rawY: 90, yFraction: 0, angle: 4, descending: 1,
    jumpMagnitude: 12, jumpFraction: 0, scroll: 0,
    waveHeights: Array(20).fill(100),
    terrainTiles: Array(12).fill(11),
  };
  const hit = predictLanding(state);
  assert.equal(hit.known, true);
  assert.ok(hit.frames >= 2 && hit.frames < 12);
  assert.equal(hit.tile, 11);
  assert.equal(hit.safety, 3);
  const features = landingFeatures(hit);
  assert.equal(features.length, 8);
  assert.equal(features[0], 1);
  const slope = predictLanding({
    ...state,
    terrainTiles: [11, 6, ...Array(10).fill(11)],
  });
  assert.equal(slope.known, true);
  assert.equal(slope.tile, hit.offset >= 8 ? 6 : 11);
});
test("landing classification exactly matches all original collision cases", () => {
  assert.deepEqual([1,2,3,4,5,6,7].map(n => landingSafety(11,n)), [0,1,2,3,2,1,0]);
  assert.deepEqual([1,2,3,4,5,6,7].map(n => landingSafety(6,n)), [0,0,0,1,2,3,2]);
  assert.deepEqual([1,2,3,4,5,6,7].map(n => landingSafety(7,n)), [2,3,2,1,0,0,0]);
  assert.deepEqual([1,2,3,4,5,6,7].map(n => landingSafety(20,n)), [0,1,2,3,3,2,1]);
  assert.deepEqual([1,2,3,4,5,6,7].map(n => landingSafety(18,n)), [0,1,2,3,3,2,1]);
});
test("unknown future tiles or future beyond generated buffer never become fake forecasts", () => {
  const state = {
    state: 1, rawY: 90, yFraction: 0, angle: 4, descending: 1,
    jumpMagnitude: 12, jumpFraction: 0, scroll: 0,
    waveHeights: Array(20).fill(100),
    terrainTiles: [255, ...Array(11).fill(11)],
  };
  assert.equal(predictLanding(state).known, false);
  assert.deepEqual(landingFeatures(predictLanding(state)), Array(8).fill(0));
  const tooFar = { ...state, rawY: 10, jumpMagnitude: 0,
    terrainTiles: Array(2).fill(11) };
  assert.equal(predictLanding(tooFar).known, false);
});
