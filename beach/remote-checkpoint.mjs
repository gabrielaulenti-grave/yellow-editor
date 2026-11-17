// Optional durable checkpoint store. Only accessed on the server.
const base = process.env.BEACH_SUPABASE_URL;
const key = process.env.BEACH_SUPABASE_SERVICE_KEY;
if (Boolean(base) !== Boolean(key)) {
  throw new Error("Configure both BEACH_SUPABASE_URL and BEACH_SUPABASE_SERVICE_KEY, or neither.");
}
const endpoint = base ? new URL("/rest/v1/beach_checkpoints", base) : null;
if (endpoint && (endpoint.protocol !== "https:" || endpoint.username || endpoint.password)) {
  throw new Error("BEACH_SUPABASE_URL must be an HTTPS URL without embedded credentials.");
}
const headers = () => ({
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
  Accept: "application/json",
});
const controller = () => AbortSignal.timeout(12000);
function validRecord(record, romId) {
  if (!record || record.version !== 1 || record.rom_id !== romId ||
      !record.training || !Number.isSafeInteger(record.training.total) ||
      !Number.isSafeInteger(record.training.generation) ||
      !Array.isArray(record.training.champion) ||
      !Array.isArray(record.training.candidates)) {
    throw new Error("Durable checkpoint is invalid or belongs to an incompatible ROM.");
  }
  return record.training;
}

export function remoteConfigured() { return Boolean(endpoint); }

export async function restoreRemote(romId) {
  if (!endpoint) return null;
  const url = new URL(endpoint);
  url.searchParams.set("id", "eq.main");
  url.searchParams.set("select", "version,rom_id,training");
  const response = await fetch(url, { headers: headers(), signal: controller() });
  if (!response.ok) throw new Error(`Remote checkpoint read failed (HTTP ${response.status})`);
  const records = await response.json();
  if (!Array.isArray(records) || records.length > 1) throw new Error("Unexpected remote checkpoint response");
  return records.length ? validRecord(records[0], romId) : null;
}

export async function saveRemote(romId, training) {
  if (!endpoint) return;
  const url = new URL(endpoint);
  url.searchParams.set("on_conflict", "id");
  const response = await fetch(url, {
    method: "POST",
    headers: { ...headers(), Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ id: "main", version: 1, rom_id: romId, training, total: training.total }]),
    signal: controller(),
  });
  if (!response.ok) throw new Error(`Remote checkpoint write failed (HTTP ${response.status})`);
}
