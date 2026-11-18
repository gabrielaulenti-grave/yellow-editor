import test from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { newTraining, recordRound, trainingStats } from "./learner.mjs";
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
