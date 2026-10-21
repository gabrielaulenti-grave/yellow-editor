import assert from "node:assert/strict";
import { test } from "node:test";
import { createLazyOpfsProjectSource } from "../src/platform/lazyOpfsWorkspace";
import { createOpfsWorkspaceProjectSource } from "../src/platform/opfsWorkspace";
import { createBrowserProjectFile, removeBrowserProjectFile } from "../src/platform/projectFileLifecycle";
import type { ProjectSource } from "../src/core/types";

class MemoryFile {
  kind = "file"; bytes = new Uint8Array(); stamp = 1; failWrite = false;
  constructor(readonly name: string) {}
  async getFile() { return new File([this.bytes], this.name, { lastModified: this.stamp }); }
  async createWritable() {
    let pending = this.bytes;
    return { write: async (data: string | Uint8Array) => { if (this.failWrite) { this.failWrite = false; throw new Error("write failed"); } pending = typeof data === "string" ? new TextEncoder().encode(data) : data.slice(); },
      close: async () => { this.bytes = pending; this.stamp++; }, abort: async () => {} };
  }
}
class MemoryDirectory {
  kind = "directory"; children = new Map<string, MemoryDirectory | MemoryFile>(); failRemove = false;
  constructor(readonly name: string) {}
  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<MemoryDirectory> {
    if (!this.children.has(name) && options?.create) this.children.set(name, new MemoryDirectory(name));
    const found = this.children.get(name); if (!(found instanceof MemoryDirectory)) throw new DOMException("missing directory", "NotFoundError"); return found;
  }
  async getFileHandle(name: string, options?: { create?: boolean }): Promise<MemoryFile> {
    if (!this.children.has(name) && options?.create) this.children.set(name, new MemoryFile(name));
    const found = this.children.get(name); if (!(found instanceof MemoryFile)) throw new DOMException("missing file", "NotFoundError"); return found;
  }
  async removeEntry(name: string) {
    if (this.failRemove) { this.failRemove = false; throw new Error("remove failed"); }
    if (!this.children.delete(name)) throw new DOMException("missing", "NotFoundError");
  }
  async *entries() { yield* this.children.entries(); }
}
test("folder file primitives preserve existing files and reject traversal", async () => {
  const root = new MemoryDirectory("project"), maps = await root.getDirectoryHandle("maps", { create: true });
  await createBrowserProjectFile(root as never, "maps/Test.blk", Uint8Array.of(0, 128, 255));
  await assert.rejects(createBrowserProjectFile(root as never, "maps/Test.blk", Uint8Array.of(1)), /already exists/);
  assert.deepEqual((await maps.getFileHandle("Test.blk")).bytes, Uint8Array.of(0, 128, 255));
  await assert.rejects(createBrowserProjectFile(root as never, "../outside", new Uint8Array()), /Invalid/);
  await removeBrowserProjectFile(root as never, "maps/Test.blk"); assert.equal(maps.children.has("Test.blk"), false);
});
for (const [label, create] of [["lazy", createLazyOpfsProjectSource], ["eager", createOpfsWorkspaceProjectSource]] as const) test(`${label} browser workspace: mirrored creation, deletion, rollback and external guards`, async () => {
  const external = new MemoryDirectory("project"), opfs = new MemoryDirectory("opfs");
  const maps = await external.getDirectoryHandle("maps", { create: true });
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator"), originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { storage: { getDirectory: async () => opfs, persist: async () => true } } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { setTimeout } });
  let source: ProjectSource | null = null;
  try {
    source = await create({ externalRoot: external as never, identityHint: "fixture", storageKey: "fixture", historyStore: { persistent: false, load: async () => null, save: async () => {} }, trainerCatalogCache: {} as never });
    assert.ok(source);
    await source.createFile!("maps/New.blk", Uint8Array.of(0, 255, 128));
    assert.deepEqual(await source.readBytes("maps/New.blk"), Uint8Array.of(0, 255, 128));
    assert.deepEqual((await maps.getFileHandle("New.blk")).bytes, Uint8Array.of(0, 255, 128));
    maps.failRemove = true;
    await assert.rejects(source.removeFile!("maps/New.blk"), /remove failed/);
    assert.deepEqual(await source.readBytes("maps/New.blk"), Uint8Array.of(0, 255, 128));
    const externalFile = await maps.getFileHandle("New.blk"); externalFile.bytes = Uint8Array.of(33); externalFile.stamp++;
    await assert.rejects(source.removeFile!("maps/New.blk"), /outside Yellow Editor/);
    assert.deepEqual(externalFile.bytes, Uint8Array.of(33));
    externalFile.bytes = Uint8Array.of(0, 255, 128); externalFile.stamp++;
    await source.removeFile!("maps/New.blk"); assert.equal(await source.exists("maps/New.blk"), false);
    await source.createFile!("maps/New.blk", new Uint8Array()); assert.equal((await source.readBytes("maps/New.blk")).length, 0);
    await source.removeFile!("maps/New.blk");
  } finally {
    source?.dispose?.(); await new Promise(resolve => setTimeout(resolve, 20));
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator); else Reflect.deleteProperty(globalThis, "navigator");
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else Reflect.deleteProperty(globalThis, "window");
  }
});
