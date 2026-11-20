// Lossless Game Boy frame capture to compact WebM, executed only for new records.
// Frames are already deflated individually to bound memory during long runs.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { inflateSync } from "node:zlib";

const MAX_VIDEO_BYTES = 4 * 1024 * 1024;
export async function encodeWebm(compressedFrames) {
  if (!Array.isArray(compressedFrames) || !compressedFrames.length || compressedFrames.length > 1800) {
    throw new Error("Invalid recording frame count");
  }
  const child = spawn("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-f", "rawvideo", "-pixel_format", "rgba", "-video_size", "160x144",
    "-framerate", "12", "-i", "pipe:0",
    "-an", "-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "8",
    "-b:v", "250k", "-pix_fmt", "yuv420p",
    "-f", "webm", "pipe:1",
  ], { stdio: ["pipe", "pipe", "pipe"] });
  const chunks = [];
  let bytes = 0;
  let stderr = "";
  let exceeded = false;
  child.stdout.on("data", chunk => {
    bytes += chunk.length;
    if (bytes > MAX_VIDEO_BYTES) {
      exceeded = true;
      child.kill("SIGKILL");
    } else chunks.push(chunk);
  });
  child.stderr.on("data", chunk => { stderr = (stderr + String(chunk)).slice(-2048); });
  // A failed or terminated encoder must not cause unhandled stream errors.
  child.stdin.on("error", () => {});
  const stopped = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", code => code === 0 && !exceeded
      ? resolve(Buffer.concat(chunks))
      : reject(new Error(`WebM encoding failed (exit ${code}, too large: ${exceeded}): ${stderr}`)));
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 120000);
  try {
    for (const packed of compressedFrames) {
      if (child.exitCode !== null || child.killed || child.stdin.destroyed) break;
      const pixels = inflateSync(packed);
      if (pixels.length !== 160 * 144 * 4) throw new Error("Bad frame size");
      if (!child.stdin.write(pixels)) await Promise.race([once(child.stdin, "drain"), stopped]);
    }
    child.stdin.end();
    const video = await stopped;
    if (video.length < 16 || video.length > MAX_VIDEO_BYTES || video.subarray(0, 4).toString("hex") !== "1a45dfa3") {
      throw new Error("Invalid encoded WebM");
    }
    return video;
  } catch (error) {
    child.kill("SIGKILL");
    await stopped.catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
