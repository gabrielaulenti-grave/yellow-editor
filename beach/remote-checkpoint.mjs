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
