import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { inflateSync } from "node:zlib";
import { openBeach, frameLength } from "./emulator.mjs";
import { newTraining, recordRound, trainingStats } from "./learner.mjs";

const rom = process.env.BEACH_ROM;
const symbols = process.env.BEACH_SYMBOLS;
const executable = resolve(process.env.BEACH_EMULATOR || "beach/.build/beach-emulator");

test("candidate rounds and evaluation rolls over to the next generation", () => {
  const training = newTraining();
  for (let i = 0; i < 48; i++) {
    recordRound(training, { finished: true, score: i, progress: 1, wipeouts: 2 });
  }
  const stats = trainingStats(training);
  assert.equal(stats.total, 48);
  assert.equal(stats.generation, 2);
  assert.deepEqual(stats.history, [{ generation: 1, finishRate: 1, averageScore: 44, averageWipeouts: 2 }]);
});

test("original restart runs the ROM continuously and generates a fresh course", { skip: !rom || !symbols }, async () => {
  const emulator = await openBeach(executable, resolve(rom), resolve(symbols));
  try {
    const courses = [];
    let waveSamples = [];
    let state;
    let inRound = false;
    for (let frame = 0; frame < 16000 && courses.length < 2; frame++) {
      const exit = (state?.routine === 11 || state?.routine === 12) && frame % 12 === 0;
      const result = await emulator.step(exit ? 3 : 0, frame === 200);
      state = result.state;
      if (frame === 200) assert.equal(result.pixels.length, frameLength);
      if (state.routine === 1) {
        inRound = true;
        waveSamples.push(state.water.join(","));
      }
      if (inRound && state.routine !== 1) {
        assert.ok(state.routine === 2 || state.routine === 12);
        assert.ok(waveSamples.length > 100);
        courses.push(waveSamples);
        waveSamples = [];
        inRound = false;
      }
    }
    assert.equal(courses.length, 2);
    assert.notDeepEqual(courses[0].slice(0, 500), courses[1].slice(0, 500));
  } finally {
    emulator.close();
  }
});

test("server streams frames, saves clips and resumes training from disk", { skip: !rom || !symbols, timeout: 35000 }, async () => {
  const data = await mkdtemp(join(tmpdir(), "beach-check-"));
  const controller = new AbortController();
  let server;
  let closed;
  async function startServer() {
    server = spawn(process.execPath, ["beach/server.mjs"], {
      env: { ...process.env, BEACH_ROM: resolve(rom), BEACH_SYMBOLS: resolve(symbols), BEACH_DATA: data, HOST: "127.0.0.1", PORT: "0" },
      stdio: ["ignore", "pipe", "inherit"],
    });
    closed = once(server, "close");
    const [startup] = await once(server.stdout, "data");
    const port = /:(\d+)\s*$/.exec(startup.toString())?.[1];
    assert.ok(port);
    return `http://127.0.0.1:${port}`;
  }
  const checkpoint = join(data, "training.json");
  async function waitForRound(previous) {
    for (let tries = 0; tries < 120; tries++) {
      const saved = await readFile(checkpoint, "utf8").catch(error => {
        if (error.code !== "ENOENT") throw error;
      });
      if (saved && JSON.parse(saved).training.total > previous) return JSON.parse(saved).training.total;
      await delay(100);
    }
    assert.fail("Training did not save another round with no viewer.");
  }
  try {
    const base = await startServer();
    const page = await fetch(base);
    assert.match(await page.text(), /Pikachu’s Beach/);
    for (const path of ["/pokeyellow.gbc", "/pokeyellow.sym", "/rom/pokeyellow.gbc",
      "/rom/pokeyellow.sym", "/api/rom", "/api/memory", "/api/state",
      "/viewer.js.map", "/server.mjs", "/beach/native/bridge.c", "/training.json",
      "/api/clips/..%2f..%2from%2fpokeyellow.gbc", "/api/%2e%2e/rom/pokeyellow.gbc"]) {
      assert.equal((await fetch(base + path)).status, 404, path);
    }
    const viewer = await (await fetch(`${base}/viewer.js`)).text();
    assert.doesNotMatch(viewer, /\.gbc\b|\.sym\b|WebAssembly|sourceMappingURL/);
    assert.equal((await fetch(`${base}/api/live`, { headers: { Origin: "https://wrong.example" } })).status, 403);

    const stream = await fetch(`${base}/api/live?pace=fast`, { signal: controller.signal });
    const reader = stream.body.getReader();
    let received = "";
    while (!received.includes("\n\n")) {
      const item = await reader.read();
      assert.equal(item.done, false);
      received += Buffer.from(item.value).toString();
    }
    const live = JSON.parse(received.split("\n\n")[0].slice(6));
    assert.equal(inflateSync(Buffer.from(live.frame, "base64")).length, frameLength);
    assert.deepEqual(Object.keys(live).filter(key => key !== "lastRound").sort(), [
      "action", "angle", "clips", "evaluating", "frame", "generation", "history", "hp", "phase",
      "policy", "population", "progress", "radness", "speed", "total", "wipeouts",
    ]);
    controller.abort();

    const completed = await waitForRound(live.total);
    const clip = await (await fetch(`${base}/api/clips/first`)).json();
    assert.deepEqual(Object.keys(clip).sort(), ["finished", "frames", "progress", "score", "wipeouts"]);
    assert.equal(clip.frames.length, 120);
    for (const frame of clip.frames) {
      assert.deepEqual(Object.keys(frame).sort(), ["action", "frame"]);
      assert.equal(inflateSync(Buffer.from(frame.frame, "base64")).length, frameLength);
    }
    server.kill();
    await closed;
    const restarted = await startServer();
    assert.deepEqual(await (await fetch(`${restarted}/api/clips/first`)).json(), clip);
    assert.ok(await waitForRound(completed) > completed);
  } finally {
    controller.abort();
    server?.kill();
    await closed;
    await rm(data, { recursive: true, force: true });
  }
});
