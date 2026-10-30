import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { PNG } from "pngjs";
import { configureGen1PngDecoder } from "../src/core/gen1Graphics";
import type { HistoryState, ProjectSource } from "../src/core/types";

configureGen1PngDecoder("independent pngjs", async bytes => { const image = PNG.sync.read(Buffer.from(bytes)); return { width: image.width, height: image.height, rgba: new Uint8ClampedArray(image.data) }; });
export async function contentFixture(root: string) {
  const data = new Map<string, Uint8Array>(); let history: HistoryState | null = null, failPath: string | null = null;
  async function visit(folder = "") { for (const entry of await readdir(join(root, folder), { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue; const path = folder ? `${folder}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await visit(path); else if (!/\.(o|gbc|sym|map|2bpp|pic)$/.test(path)) data.set(path, new Uint8Array(await readFile(join(root, path))));
  } }
  await visit();
  const source: ProjectSource = { displayPath: root, storageKey: root,
    exists: async path => data.has(path) || [...data.keys()].some(key => key.startsWith(`${path}/`)), listFiles: async () => [...data.keys()],
    readBytes: async path => { const bytes = data.get(path); if (!bytes) throw new Error(`Missing ${path}`); return bytes.slice(); },
    readText: async path => new TextDecoder().decode(await source.readBytes(path)),
    writeBytes: async (path, bytes) => { if (path === failPath) { failPath = null; throw new Error("Injected write failure"); } data.set(path, bytes.slice()); },
    writeText: async (path, text) => source.writeBytes!(path, new TextEncoder().encode(text)),
    createFile: async (path, bytes) => { if (data.has(path)) throw new Error(`Already exists ${path}`); await source.writeBytes!(path, bytes); }, removeFile: async path => { data.delete(path); }, assetUrl: async () => null,
    historyStore: { persistent: true, load: async () => structuredClone(history), save: async next => { history = structuredClone(next); } },
  };
  return { source, data, fail: (path: string) => { failPath = path; } };
}
