import { createServer } from "node:http";
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { openBeach } from "./emulator.mjs";
import { loadTraining, saveTraining, train } from "./training.mjs";

const pathFromHere = (path) => fileURLToPath(new URL(path, import.meta.url));
const env = process.env;
if (!env.BEACH_ROM || !env.BEACH_SYMBOLS) throw new Error("Set BEACH_ROM and BEACH_SYMBOLS to the local files exported from the patched checkout.");

const [romPath, symbolsPath] = await Promise.all([realpath(env.BEACH_ROM), realpath(env.BEACH_SYMBOLS)]);
for (const dir of ["../public", "../dist"]) {
  const root = await realpath(pathFromHere(dir)).catch(error => {
    if (error.code !== "ENOENT") throw error;
    return pathFromHere(dir);
  });
  for (const path of [romPath, symbolsPath]) {
    const subpath = relative(root, path);
    if (subpath !== ".." && !subpath.startsWith(`..${sep}`) && !isAbsolute(subpath)) {
      throw new Error("Keep the trainer ROM and symbol file outside the editor's public and build directories.");
    }
  }
}
const data = resolve(env.BEACH_DATA || pathFromHere("./.data"));
await mkdir(data, { recursive: true });
const checkpoint = resolve(data, "training.json");
const emulator = await openBeach(
  resolve(env.BEACH_EMULATOR || pathFromHere("./.build/beach-emulator")),
  romPath, symbolsPath,
);
const controller = new AbortController();
const clients = new Map();
const allowedOrigins = new Set((env.BEACH_VIEWER_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean));
const clipPath = name => resolve(data, `${name}.json`);
const clips = new Map();
const assets = new Map(await Promise.all([
  ["/", "index.html", "text/html"], ["/style.css", "style.css", "text/css"], ["/viewer.js", "viewer.js", "text/javascript"],
  ["/agent-preview.webm", "agent-preview.webm", "video/webm"],
].map(async ([route, file, type]) => [route, { type, contents: await readFile(pathFromHere(`./viewer/${file}`)) }])));
let errorMessage;
let lastFrame = 0;
let realtimeDeadline = 0;
let lastEvent;
let stopping = false;

function viewerHeaders(req) {
  const origin = req.headers.origin;
  const ownHosts = [req.headers.host, env.BEACH_PUBLIC_HOST].filter(Boolean);
  if (origin && !allowedOrigins.has(origin) && !ownHosts.some(host => origin === `https://${host}` || origin === `http://${host}`)) return null;
  return { Vary: "Origin", ...(origin && { "Access-Control-Allow-Origin": origin }) };
}

const server = createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url, "http://beach.local");
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" }).end();
    return;
  }
  if (url.pathname === "/api/live") {
    const headers = viewerHeaders(req);
    if (!headers) {
      res.writeHead(403).end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
      ...headers,
    });
    res.flushHeaders();
    const client = { normal: url.searchParams.get("pace") === "normal" };
    clients.set(res, client);
    res.on("close", () => clients.delete(res));
    if (errorMessage) res.write(`event: failure\ndata: ${JSON.stringify(errorMessage)}\n\n`);
    else if (lastEvent) res.write(lastEvent);
    return;
  }
  if (url.pathname === "/api/clips/first" || url.pathname === "/api/clips/best") {
    const headers = viewerHeaders(req);
    if (!headers) return res.writeHead(403).end();
    const clip = clips.get(url.pathname.slice("/api/clips/".length));
    if (!clip) return res.writeHead(404, headers).end();
    res.writeHead(200, { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" }).end(clip.contents);
    return;
  }
  if (url.pathname === "/api/health") {
    res.writeHead(errorMessage ? 503 : 200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ ok: !errorMessage }));
    return;
  }
  const asset = assets.get(url.pathname === "/index.html" ? "/" : url.pathname);
  if (asset) {
    res.writeHead(200, { "Content-Type": asset.type === "video/webm" ? asset.type : `${asset.type}; charset=utf-8`, "X-Content-Type-Options": "nosniff" });
    res.end(asset.contents);
    return;
  }
  res.writeHead(404).end();
});

function broadcast(event) {
  for (const res of clients.keys()) {
    if (res.writableLength < 65536) res.write(event);
  }
}

function stop() {
  if (stopping) return;
  stopping = true;
  controller.abort();
  for (const res of clients.keys()) res.end();
  server.close();
}

const encode = pixels => deflateSync(pixels, { level: 1 }).toString("base64");

function publicClip({ finished, score, progress, wipeouts, frames }) {
  return JSON.stringify({ finished, score, progress, wipeouts, frames: frames.map(({ frame, action }) => ({ frame, action })) });
}

async function saveClips(round, frames) {
  const names = [];
  if (!clips.has("first")) names.push("first");
  if (round.finished && (!clips.has("best") || round.score > clips.get("best").score)) names.push("best");
  if (!names.length) return;
  const clip = {
    ...round,
    frames: frames.map(({ pixels, action }) => ({ frame: encode(pixels), action })),
  };
  for (const name of names) {
    const path = clipPath(name);
    await writeFile(`${path}.tmp`, JSON.stringify({ ...clip, romId: emulator.id }), { mode: 0o600 });
    await rename(`${path}.tmp`, path);
    clips.set(name, { score: clip.score, contents: publicClip(clip) });
  }
}

try {
  const training = await loadTraining(checkpoint, emulator.id);
  for (const name of ["first", "best"]) {
    try {
      const clip = JSON.parse(await readFile(clipPath(name), "utf8"));
      if (clip.romId === emulator.id) clips.set(name, { score: clip.score, contents: publicClip(clip) });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  server.listen(Number(env.PORT || 8787), env.HOST || "127.0.0.1", () => {
    const { address, port } = server.address();
    console.log(`Pikachu’s Beach trainer listening on ${address}:${port}`);
  });
  server.on("error", (error) => {
    console.error(error);
    stop();
    process.exitCode = 1;
  });
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  await train(emulator, training, {
    signal: controller.signal,
    checkpoint: value => saveTraining(checkpoint, emulator.id, value),
    saveClip: saveClips,
    wantsFrame: () => clients.size > 0 && performance.now() - lastFrame >= 1000 / 24,
    publish(pixels, state) {
      lastFrame = performance.now();
      const frame = encode(pixels);
      lastEvent = `data: ${JSON.stringify({ ...state, frame, clips: [...clips.keys()] })}\n\n`;
      broadcast(lastEvent);
    },
    pace() {
      if (![...clients.values()].some(client => client.normal)) {
        realtimeDeadline = 0;
        return;
      }
      const now = performance.now();
      realtimeDeadline = Math.max(now - 33, realtimeDeadline) + 1000 * 70224 / 4194304;
      const wait = realtimeDeadline - now;
      if (wait > 1) return delay(wait);
    },
  });
} catch (error) {
  console.error(error);
  errorMessage = "The trainer stopped. Check the server logs and restart the service.";
  broadcast(`event: failure\ndata: ${JSON.stringify(errorMessage)}\n\n`);
  process.exitCode = 1;
  stop();
} finally {
  emulator.close();
}
