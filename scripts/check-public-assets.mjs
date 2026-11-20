import { lstat, open, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

const publicRoot = resolve(process.argv[2] ?? "public");
const privateExtensions = /\.(gbc?|sym)$/i;
const trainerSignature = Buffer.from("PBEACH1");

async function checkDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (privateExtensions.test(entry.name) || entry.isSymbolicLink()) {
      throw new Error(`Remove the ROM, symbol file, or symlink from the public build directory: ${path}`);
    }
    if (entry.isDirectory()) {
      await checkDirectory(path);
    } else if (entry.isFile()) {
      const { size } = await stat(path);
      // Catch a boot-patched ROM even if its filename was changed.
      if (size >= 32 * 1024 && size % (16 * 1024) === 0) {
        const file = await open(path, "r");
        try {
          const headerBank = Buffer.alloc(16 * 1024);
          await file.read(headerBank);
          if (headerBank.includes(trainerSignature)) {
            throw new Error(`Remove the Pikachu’s Beach ROM from the public build directory: ${path}`);
          }
        } finally {
          await file.close();
        }
      }
    }
  }
}

if ((await lstat(publicRoot)).isSymbolicLink()) {
  throw new Error("The public build directory must be a real directory.");
}
await checkDirectory(publicRoot);
