import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BINJGB_VERSION = "0.1.11";
const BINJGB_COMMIT = "8abd0d38d5bf109d7c280b27d815a8b53168adde";
const BINJGB_SOURCE = "https://github.com/binji/binjgb";
const RAW_BASE = `https://raw.githubusercontent.com/binji/binjgb/${BINJGB_COMMIT}`;

const FILES = [
  {
    sourcePath: "docs/binjgb.js",
    outputName: "binjgb.js",
    gitBlobSha: "45fe4d9dec2656226e1871b5f15858ee6f552d16",
  },
  {
    sourcePath: "docs/binjgb.wasm",
    outputName: "binjgb.wasm",
    gitBlobSha: "251b7b1c93d92983915b9403f8b74f04d38b5a3d",
  },
  {
    sourcePath: "LICENSE",
    outputName: "LICENSE.binjgb",
    gitBlobSha: "89de354795ec7a7cdab07c091029653d3618540d",
  },
];

const repoRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const outputDirectory = path.join(
  repoRoot,
  "public",
  "wasm-tools",
  "binjgb",
  BINJGB_VERSION,
);

function gitBlobSha(bytes) {
  const header = Buffer.from(`blob ${bytes.byteLength}\0`, "utf8");
  return createHash("sha1").update(header).update(bytes).digest("hex");
}

async function fetchPinnedFile(file) {
  const response = await fetch(`${RAW_BASE}/${file.sourcePath}`);
  if (!response.ok) {
    throw new Error(
      `Could not download binjgb ${file.sourcePath}: HTTP ${response.status}`,
    );
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const actualSha = gitBlobSha(bytes);
  if (actualSha !== file.gitBlobSha) {
    throw new Error(
      `binjgb ${file.sourcePath} checksum mismatch: expected Git blob ${file.gitBlobSha}, got ${actualSha}.`,
    );
  }
  return bytes;
}

async function main() {
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });

  const manifestFiles = {};
  for (const file of FILES) {
    const bytes = await fetchPinnedFile(file);
    await writeFile(path.join(outputDirectory, file.outputName), bytes);
    manifestFiles[file.outputName] = {
      sourcePath: file.sourcePath,
      gitBlobSha: file.gitBlobSha,
      size: bytes.byteLength,
    };
  }

  await writeFile(
    path.join(outputDirectory, "manifest.json"),
    `${JSON.stringify(
      {
        name: "binjgb",
        version: BINJGB_VERSION,
        commit: BINJGB_COMMIT,
        source: BINJGB_SOURCE,
        license: "MIT",
        files: manifestFiles,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.log(
    `Prepared binjgb ${BINJGB_VERSION} (${BINJGB_COMMIT}) in ${outputDirectory}`,
  );
}

await main();
