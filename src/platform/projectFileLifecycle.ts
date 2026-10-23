// File creation is explicit so ordinary saves never silently create a misspelled path.
export interface ProjectFileDirectory {
  getDirectoryHandle(name: string): Promise<ProjectFileDirectory>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<{
    getFile(): Promise<File>;
    createWritable(): Promise<{ write(data: Uint8Array): Promise<void>; close(): Promise<void>; abort?(): Promise<void> }>;
  }>;
  removeEntry(name: string): Promise<void>;
}
export async function fileParent(root: ProjectFileDirectory, path: string) {
  const parts = path.replace(/\\/g, "/").split("/");
  if (parts.some(part => !part || part === "." || part === "..")) throw new Error(`Invalid project file path: ${path}`);
  const name = parts.pop()!; let parent = root;
  for (const part of parts) parent = await parent.getDirectoryHandle(part);
  return { parent, name };
}
export async function createBrowserProjectFile(root: ProjectFileDirectory, path: string, bytes: Uint8Array) {
  const { parent, name } = await fileParent(root, path);
  try { await parent.getFileHandle(name); throw new Error(`${path} already exists.`); }
  catch (error) { if (!(error instanceof DOMException) || error.name !== "NotFoundError") throw error; }
  const handle = await parent.getFileHandle(name, { create: true });
  let stream: Awaited<ReturnType<typeof handle.createWritable>> | null = null;
  try { stream = await handle.createWritable(); await stream.write(bytes); await stream.close(); }
  catch (error) {
    await stream?.abort?.().catch(() => undefined);
    await parent.removeEntry(name).catch(() => undefined); throw error;
  }
}
export async function removeBrowserProjectFile(root: ProjectFileDirectory, path: string) {
  const { parent, name } = await fileParent(root, path);
  await parent.getFileHandle(name); // Only files, never recursive directory removal.
  await parent.removeEntry(name);
}
export async function verifyBrowserProjectBytes(root: ProjectFileDirectory, path: string, expected: Uint8Array) {
  const { parent, name } = await fileParent(root, path);
  const file = await (await parent.getFileHandle(name)).getFile();
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length !== expected.length || bytes.some((byte, index) => byte !== expected[index])) {
    throw new Error(`${path} changed outside Yellow Editor. Reopen the project before removing it.`);
  }
}
