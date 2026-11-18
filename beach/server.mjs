import { createServer } from "node:http";
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { openBeach } from "./emulator.mjs";
import { loadTraining, saveTraining, train } from "./training.mjs";
import { migrateTraining, backfillMilestones, recoverCurrentSpecialists, MILESTONE_AWARDS } from "./learner.mjs";
import { generationSummary } from "./telemetry.mjs";
import { remoteConfigured, restoreRemote, saveRemote, listArchivedRuns, readArchivedVideo, saveArchivedRun, saveGeneration, listGenerations, readGeneration, list500Videos, read500Video, save500Video, listExtendedVideos, readExtendedVideo, saveExtendedVideo } from "./remote-checkpoint.mjs";
import { encodeWebm } from "./video.mjs";

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
const records = [];
const milestoneVideos = [];
const extendedRecords = [];
const archivedGenerations = [];
let currentTraining;
const assets = new Map(await Promise.all([
  ["/", "index.html", "text/html"], ["/style.css", "style.css", "text/css"], ["/viewer.js", "viewer.js", "text/javascript"],
  ["/downloads/pokeyellow-landing-telemetry-disassembly.zip", "pokeyellow-landing-telemetry-disassembly.zip", "application/zip"],
].map(async ([route, file, type]) => [route, { type, contents: await readFile(pathFromHere(`../public/beach/${file}`)) }])));
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
  if (url.pathname === "/api/generation/current") {
    const headers = viewerHeaders(req);
    if (!headers) return res.writeHead(403).end();
    if (!currentTraining) return res.writeHead(503).end();
    const runs = currentTraining.generationRuns || [];
    return res.writeHead(200, { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" })
      .end(JSON.stringify({ summary: generationSummary(currentTraining.generation, runs), runs }));
  }
  if (url.pathname === "/api/generations") {
    const headers = viewerHeaders(req);
    if (!headers) return res.writeHead(403).end();
    return res.writeHead(200, { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" })
      .end(JSON.stringify(archivedGenerations));
  }
  const generationMatch = url.pathname.match(new RegExp("^/api/generations/([1-9][0-9]{0,8})$"));
  if (generationMatch) {
    const headers = viewerHeaders(req);
    if (!headers) return res.writeHead(403).end();
    const generation = Number(generationMatch[1]);
    if (!archivedGenerations.some(row => row.generation === generation)) return res.writeHead(404, headers).end();
    void readGeneration(generation).then(snapshot => {
      if (!snapshot) return res.writeHead(404, headers).end();
      res.writeHead(200, { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" })
        .end(JSON.stringify(snapshot));
    }).catch(error => {
      console.error("Archived generation read failed:", error.message);
      if (!res.headersSent) res.writeHead(503).end();
    });
    return;
  }
  if (url.pathname === "/api/milestones") {
    const headers = viewerHeaders(req);
    if (!headers) return res.writeHead(403).end();
    res.writeHead(200, {...headers, "Content-Type":"application/json", "Cache-Control":"no-store"})
      .end(JSON.stringify(milestoneVideos));
    return;
  }
  const milestoneMatch = url.pathname.match(/^\/api\/milestones\/([1-9][0-9]{0,14})$/);
  if (milestoneMatch) {
    const headers = viewerHeaders(req);
    if (!headers) return res.writeHead(403).end();
    const id = milestoneMatch[1];
    if (!milestoneVideos.some(entry => String(entry.id) === id))
      return res.writeHead(404,headers).end();
    void read500Video(id).then(video => {
      if (!video) return res.writeHead(404,headers).end();
      res.writeHead(200, {
        ...headers, "Content-Type":"video/webm", "Cache-Control":"no-store",
        "Content-Length":video.length,"X-Content-Type-Options":"nosniff",
        "Content-Disposition":`inline; filename="pikachus-beach-500-trick-${id}.webm"`,
      }).end(video);
    }).catch(error => {
      console.error("Milestone recording read failed:",error.message);
      if (!res.headersSent) res.writeHead(503).end();
    });
    return;
  }
  if (url.pathname === "/api/extended-records") {
    const headers=viewerHeaders(req);
    if(!headers) return res.writeHead(403).end();
    return res.writeHead(200,{...headers,"Content-Type":"application/json","Cache-Control":"no-store"})
      .end(JSON.stringify(extendedRecords));
  }
  const extendedMatch=url.pathname.match(new RegExp("^/api/extended-records/([1-9][0-9]{0,14})$"));
  if(extendedMatch) {
    const headers=viewerHeaders(req);
    if(!headers) return res.writeHead(403).end();
    const id=extendedMatch[1];
    if(!extendedRecords.some(item=>String(item.id)===id))
      return res.writeHead(404,headers).end();
    void readExtendedVideo(id).then(video=>{
      if(!video) return res.writeHead(404,headers).end();
      res.writeHead(200,{...headers,"Content-Type":"video/webm",
        "Cache-Control":"no-store","Content-Length":video.length,
        "X-Content-Type-Options":"nosniff",
        "Content-Disposition":`inline; filename="beach-super-maxout-${id}.webm"`,
      }).end(video);
    }).catch(error=>{
      console.error("Extended video read failed:",error.message);
      if(!res.headersSent) res.writeHead(503).end();
    });
    return;
  }
  if (url.pathname === "/api/records") {
    const headers = viewerHeaders(req);
    if (!headers) return res.writeHead(403).end();
    res.writeHead(200, { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(records));
    return;
  }
  const videoMatch = /^\/api\/records\/([1-9][0-9]{0,14})$/.exec(url.pathname);
  if (videoMatch) {
    const headers = viewerHeaders(req);
    if (!headers) return res.writeHead(403).end();
    const id = videoMatch[1];
    if (!records.some(record => String(record.id) === id)) return res.writeHead(404, headers).end();
    void readArchivedVideo(id).then(video => {
      if (!video) return res.writeHead(404, headers).end();
      res.writeHead(200, {
        ...headers, "Content-Type": "video/webm", "Cache-Control": "no-store",
        "Content-Length": video.length, "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `inline; filename="pikachus-beach-record-${id}.webm"`,
      }).end(video);
    }).catch(error => {
      console.error("Video archive read failed:", error.message);
      if (!res.headersSent) res.writeHead(503).end();
    });
    return;
  }
  if (url.pathname === "/api/health") {
    res.writeHead(errorMessage ? 503 : 200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ ok: !errorMessage }));
    return;
  }
  const asset = assets.get(url.pathname === "/index.html" ? "/" : url.pathname);
  if (asset) {
    const isZip=url.pathname.endsWith("/pokeyellow-landing-telemetry-disassembly.zip");
    res.writeHead(200, {
      "Content-Type": isZip ? "application/zip" : `${asset.type}; charset=utf-8`,
      "Content-Length": asset.contents.length,
      "X-Content-Type-Options": "nosniff",
      ...(isZip ? { "Content-Disposition": 'attachment; filename="pokeyellow-landing-telemetry-disassembly.zip"' } : {}),
    });
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

async function saveClips(round, frames, fullFrames, meta) {
  const names = [];
  if (!clips.has("first")) names.push("first");
  if (round.finished && (!clips.has("best") || round.score > clips.get("best").score)) names.push("best");
  if (!names.length && !fullFrames) return;
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
  if (fullFrames?.length && remoteConfigured()) {
    let fullVideo = null;
    let fullVideoError = null;
    if (meta.isRecord || meta.isExtendedRecord || meta.isMaxout ||
        (meta.specialCount && !meta.fullCaptureTruncated)) {
      try {
        fullVideo = await encodeWebm(fullFrames);
      } catch (error) {
        fullVideoError = error;
      }
    }
    if (meta.isRecord && fullVideo) {
      try {
        const inserted = await saveArchivedRun(emulator.id, round.score, meta.generation, meta.total, fullVideo);
        if (inserted) {
          records.splice(0, records.length, ...await listArchivedRuns());
          console.log(`Archived record run: ${round.score} points, ${fullVideo.length} bytes`);
        }
      } catch (error) {
        console.error("High-score video archival failed:",error.message);
      }
    } else if (meta.isRecord && fullVideoError) {
      console.error("High-score video encoding failed:",fullVideoError.message);
    }
    if (meta.isExtendedRecord || meta.isMaxout) {
      const firstMaxout=meta.isMaxout && !extendedRecords.some(item=>item.firstMaxout);
      try {
        let video=meta.fullCaptureTruncated ? null : fullVideo;
        // Preserve a short visual witness rather than discard a genuine
        // first max-out when the run is longer than the capture/file limit.
        if(!video && frames.length)
          video=await encodeWebm(frames.map(frame=>deflateSync(frame.pixels,{level:1})));
        if(!video) throw new Error("No encodable extended-record frames");
        const inserted=await saveExtendedVideo(emulator.id,round,
          {...meta,firstMaxout},video);
        if(inserted) {
          extendedRecords.splice(0,extendedRecords.length,...await listExtendedVideos());
          console.log(`Archived extended record ${round.extendedScore} (game ${round.score}) run ${meta.total}, first maxout=${firstMaxout}`);
        }
      } catch(error) {
        console.error("Extended-score archival failed:",error.message);
      }
    }
    if (meta.specialCount > 0) {
      // A special video is stored regardless of whether the course finished
      // or achieved a record. The archive never evicts these rare events.
      let evidence = meta.fullCaptureTruncated ? null : fullVideo;
      let fullRun = !!evidence;
      if (!evidence && meta.specialFrames?.length) {
        evidence = await encodeWebm(meta.specialFrames);
        fullRun = false;
      }
      if (!evidence) throw new Error("Unable to encode verified +500 evidence");
      const inserted = await save500Video(emulator.id, round, meta, evidence, fullRun);
      if (inserted) {
        milestoneVideos.splice(0, milestoneVideos.length, ...await list500Videos());
        console.log(`Preserved ${meta.specialCount} verified +500 trick(s) from run ${meta.total}; ${fullRun ? "full run" : "maneuver clip"} ${evidence.length} bytes`);
      }
    }
  }
}

try {
  // A configured remote store is authoritative after a restart. Never silently
  // start at generation 1 if remote restoration fails: that can erase progress.
  const training = migrateTraining(remoteConfigured()
    ? (await restoreRemote(emulator.id)) ?? await loadTraining(checkpoint, emulator.id)
    : await loadTraining(checkpoint, emulator.id));
  currentTraining = training;
  let lastRemoteSave = 0;
  if (remoteConfigured()) {
    records.splice(0, records.length, ...await listArchivedRuns());
    extendedRecords.splice(0,extendedRecords.length,...await listExtendedVideos());
    archivedGenerations.splice(0, archivedGenerations.length, ...await listGenerations());
    // Earlier +350 discoveries exist in per-generation telemetry, but no
    // weights were saved. Recover their genuine first-run provenance without
    // claiming to reproduce those historic candidate policies.
    const earliest = new Map();
    for (const row of [...archivedGenerations].reverse()) {
      for (const award of MILESTONE_AWARDS) {
        if ((row.tricks?.[String(award)] || 0) > 0 && !earliest.has(award))
          earliest.set(award,row.generation);
      }
    }
    const discovered = [];
    for (const generation of new Set(earliest.values())) {
      const snapshot=await readGeneration(generation);
      if (snapshot && Array.isArray(snapshot.runs))
        discovered.push({generation,runs:snapshot.runs});
    }
    discovered.push({generation:training.generation,runs:training.generationRuns || []});
    backfillMilestones(training,discovered);
    recoverCurrentSpecialists(training);
    milestoneVideos.splice(0, milestoneVideos.length, ...await list500Videos());
    if (records.length) training.highScore = Math.max(training.highScore || 0, records[0].score);
  }
  console.log(`Checkpoint store: ${remoteConfigured() ? "remote + local" : "local only (ephemeral)"}`);
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
    checkpoint: async (value, context = {}) => {
      await saveTraining(checkpoint, emulator.id, value);
      if (!remoteConfigured()) return;
      const mustArchive = value.pendingGenerations?.length > 0;
      if (!mustArchive && !context.milestone && lastRemoteSave !== 0 && Date.now() - lastRemoteSave < 45000) return;
      try {
        // Save the pending generation queue before attempting archival so
        // transient database failure never silently loses completed runs.
        await saveRemote(emulator.id, value);
        lastRemoteSave = Date.now();
        if (mustArchive) {
          for (const entry of [...value.pendingGenerations]) {
            await saveGeneration(emulator.id, entry);
            value.pendingGenerations.shift();
          }
          archivedGenerations.splice(0, archivedGenerations.length, ...await listGenerations());
          await saveRemote(emulator.id, value);
          await saveTraining(checkpoint, emulator.id, value);
          console.log(`Archived generation: ${value.generation - 1}`);
        }
      } catch (error) {
        console.error("Durable checkpoint or generation archive failed:", error.message);
      }
    },
    saveClip: saveClips,
    wantsFrame: () => clients.size > 0 && performance.now() - lastFrame >= 1000 / 24,
    publish(pixels, state) {
      lastFrame = performance.now();
      const frame = encode(pixels);
      lastEvent = `data: ${JSON.stringify({ ...state, frame, records, extendedRecords, milestoneVideos, clips: [...clips.keys()] })}\n\n`;
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
