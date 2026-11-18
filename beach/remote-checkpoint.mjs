// Server-only checkpoint adapter using a scoped RPC token and a publishable API key.
// Never embed BEACH_CHECKPOINT_TOKEN in browser code or in a public source file.
const base = process.env.BEACH_SUPABASE_URL;
const publishableKey = process.env.BEACH_SUPABASE_PUBLISHABLE_KEY;
const token = process.env.BEACH_CHECKPOINT_TOKEN;
const configured = [base, publishableKey, token].filter(Boolean).length;
if (configured !== 0 && configured !== 3) {
  throw new Error("Configure all of BEACH_SUPABASE_URL, BEACH_SUPABASE_PUBLISHABLE_KEY, and BEACH_CHECKPOINT_TOKEN, or none.");
}
const root = base ? new URL("/rest/v1/rpc/", base) : null;
if (root && (root.protocol !== "https:" || root.username || root.password)) {
  throw new Error("BEACH_SUPABASE_URL must be HTTPS without credentials.");
}
function validRecord(record, romId) {
  if (!record || record.version !== 1 || record.rom_id !== romId ||
      !record.training || !Number.isSafeInteger(record.training.total) ||
      !Number.isSafeInteger(record.training.generation) ||
      !Array.isArray(record.training.champion) ||
      !Array.isArray(record.training.candidates)) {
    throw new Error("Remote checkpoint is corrupted or belongs to a different trainer ROM.");
  }
  return record.training;
}
async function rpc(name, body) {
  const response = await fetch(new URL(name, root), {
    method: "POST",
    headers: {
      apikey: publishableKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ p_token: token, ...body }),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`Remote checkpoint ${name} failed (HTTP ${response.status})`);
  return response.json();
}
export function remoteConfigured() { return Boolean(root); }
export async function restoreRemote(romId) {
  if (!root) return null;
  const record = await rpc("beach_load", {});
  return record == null ? null : validRecord(record, romId);
}
export async function saveRemote(romId, training) {
  if (!root) return;
  await rpc("beach_save", {
    p_rom_id: romId,
    p_version: 1,
    p_total: training.total,
    p_training: training,
  });
}

export async function listArchivedRuns() {
  if (!root) return [];
  const rows = await rpc("beach_archive_list", {});
  if (!Array.isArray(rows)) throw new Error("Invalid video archive index");
  return rows.filter(row =>
    Number.isSafeInteger(Number(row.id)) && Number.isFinite(row.score) &&
    Number.isFinite(row.total) && Number.isFinite(row.generation)
  );
}
export async function readArchivedVideo(id) {
  if (!root || !/^[1-9][0-9]{0,14}$/.test(String(id))) return null;
  const base64 = await rpc("beach_archive_read", { p_id: Number(id) });
  if (base64 === null) return null;
  if (typeof base64 !== "string" || base64.length > 6000000) throw new Error("Invalid video archive payload");
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length < 16 || bytes.length > 4194304 || bytes.subarray(0, 4).toString("hex") !== "1a45dfa3") {
    throw new Error("Invalid archived WebM");
  }
  return bytes;
}
export async function saveArchivedRun(romId, score, generation, total, webm) {
  if (!root) return false;
  if (!Buffer.isBuffer(webm) || webm.length > 4194304) throw new Error("Video larger than archive limit");
  return rpc("beach_archive_save", {
    p_rom_id: romId, p_score: score, p_generation: generation,
    p_total: total, p_video_base64: webm.toString("base64"),
  });
}

export async function saveGeneration(romId, entry) {
  if (!root) return false;
  await rpc("beach_generation_save", {
    p_rom_id: romId, p_generation: entry.generation,
    p_summary: entry.summary, p_runs: entry.runs,
  });
  return true;
}
export async function listGenerations(limit = 100) {
  if (!root) return [];
  const rows = await rpc("beach_generation_list", { p_limit: limit });
  if (!Array.isArray(rows)) throw new Error("Invalid generation archive list");
  return rows;
}
export async function readGeneration(generation) {
  if (!root || !Number.isSafeInteger(generation) || generation < 1) return null;
  return rpc("beach_generation_read", { p_generation: generation });
}

export async function list500Videos() {
  if (!root) return [];
  const rows = await rpc("beach_500_list", {});
  if (!Array.isArray(rows)) throw new Error("Invalid special recording list");
  return rows.filter(row => Number.isSafeInteger(Number(row.id)) &&
    Number.isSafeInteger(Number(row.total)) && Number(row.awards) > 0);
}
export async function read500Video(id) {
  if (!root || !/^[1-9][0-9]{0,14}$/.test(String(id))) return null;
  const base64 = await rpc("beach_500_read", { p_id: Number(id) });
  if (base64 == null) return null;
  if (typeof base64 !== "string" || base64.length > 6000000)
    throw new Error("Invalid special recording payload");
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length < 16 || bytes.length > 4194304 ||
      bytes.subarray(0,4).toString("hex") !== "1a45dfa3")
    throw new Error("Invalid special WebM recording");
  return bytes;
}
export async function save500Video(romId, round, meta, video, fullRun) {
  if (!root) return false;
  if (!Buffer.isBuffer(video) || video.length > 4194304)
    throw new Error("Milestone recording exceeds 4 MiB limit");
  return rpc("beach_500_save", {
    p_rom_id: romId, p_total: meta.total, p_generation: meta.generation,
    p_score: round.score, p_finished: round.finished,
    p_awards: meta.specialCount, p_full_run: fullRun,
    p_video_base64: video.toString("base64"),
  });
}
