import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EMSCRIPTEN_VERSION = "4.0.15";
const PRET_SOURCE_COMMIT = "e89ead154b9968aa50eed9328ff2b38b6c194382";
const RGBDS_VERSION = "1.0.3";
const RGBDS_COMMIT = "307846b03ea89ee57bf75f179d5f8051175ac60d";
const PRET_TOOLS = ["scan_includes", "gfx", "pkmncompress", "make_patch", "pcm"];
const RGBDS_TOOLS = ["rgbasm", "rgblink", "rgbfix"];
const DEFAULT_ORIGIN = "https://gabrielaulenti-grave.github.io/yellow-editor/wasm-tools";

const repoRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const outputRoot = path.join(repoRoot, "public", "wasm-tools");
const origin = (process.env.YELLOW_EDITOR_WASM_DEV_ORIGIN || DEFAULT_ORIGIN).replace(/\/$/, "");

function safeAssetName(value, expectedSuffix) {
  if (
    typeof value !== "string" ||
    !value.endsWith(expectedSuffix) ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("..")
  ) {
    throw new Error(`Unexpected WASM bundle asset name: ${String(value)}`);
  }
  return value;
}

async function hasWasmMagic(filePath) {
  try {
    const bytes = await readFile(filePath);
    return (
      bytes.length >= 8 &&
      bytes[0] === 0x00 &&
      bytes[1] === 0x61 &&
      bytes[2] === 0x73 &&
      bytes[3] === 0x6d
    );
  } catch {
    return false;
  }
}

async function readLocalManifest(directory) {
  try {
    return JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
  } catch {
    return null;
  }
}

async function localBundleReady(directory, validateManifest, tools) {
  const manifest = await readLocalManifest(directory);
  if (!manifest || !validateManifest(manifest)) {
    return false;
  }

  for (const name of tools) {
    const definition = manifest.tools?.[name];
    if (!definition) {
      return false;
    }
    const moduleName = safeAssetName(definition.module, ".mjs");
    const wasmName = safeAssetName(definition.wasm, ".wasm");
    try {
      await readFile(path.join(directory, moduleName));
    } catch {
      return false;
    }
    if (!(await hasWasmMagic(path.join(directory, wasmName)))) {
      return false;
    }
  }

  return true;
}

async function fetchBytes(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while downloading ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function fetchManifest(relativeDirectory) {
  const bytes = await fetchBytes(`${origin}/${relativeDirectory}/manifest.json`);
  return {
    bytes,
    manifest: JSON.parse(bytes.toString("utf8")),
  };
}

async function syncBundle(relativeDirectory, validateManifest, tools) {
  const directory = path.join(outputRoot, ...relativeDirectory.split("/"));
  if (await localBundleReady(directory, validateManifest, tools)) {
    console.log(`[WASM] ${relativeDirectory} is already prepared.`);
    return;
  }

  console.log(`[WASM] Downloading verified development bundle ${relativeDirectory} from ${origin}.`);
  const { bytes: manifestBytes, manifest } = await fetchManifest(relativeDirectory);
  if (!validateManifest(manifest)) {
    throw new Error(
      `The published ${relativeDirectory} manifest does not match Yellow Editor's pinned toolchain.`,
    );
  }

  await mkdir(directory, { recursive: true });
  for (const name of tools) {
    const definition = manifest.tools?.[name];
    if (!definition) {
      throw new Error(`Published ${relativeDirectory} bundle is missing ${name}.`);
    }
    const moduleName = safeAssetName(definition.module, ".mjs");
    const wasmName = safeAssetName(definition.wasm, ".wasm");
    const [moduleBytes, wasmBytes] = await Promise.all([
      fetchBytes(`${origin}/${relativeDirectory}/${moduleName}`),
      fetchBytes(`${origin}/${relativeDirectory}/${wasmName}`),
    ]);

    if (
      wasmBytes.length < 8 ||
      wasmBytes[0] !== 0x00 ||
      wasmBytes[1] !== 0x61 ||
      wasmBytes[2] !== 0x73 ||
      wasmBytes[3] !== 0x6d
    ) {
      throw new Error(`${relativeDirectory}/${wasmName} is not a valid WebAssembly binary.`);
    }

    await Promise.all([
      writeFile(path.join(directory, moduleName), moduleBytes),
      writeFile(path.join(directory, wasmName), wasmBytes),
    ]);
  }

  await writeFile(path.join(directory, "manifest.json"), manifestBytes);
  console.log(`[WASM] Prepared ${relativeDirectory}.`);
}

function validPretManifest(manifest) {
  return (
    manifest?.schemaVersion === 1 &&
    manifest?.family === "pret-gen1" &&
    manifest?.source?.repository === "pret/pokeyellow" &&
    manifest?.source?.commit === PRET_SOURCE_COMMIT &&
    manifest?.emscripten?.version === EMSCRIPTEN_VERSION &&
    manifest?.tools
  );
}

function validRgbdsManifest(manifest) {
  return (
    manifest?.schemaVersion === 1 &&
    manifest?.family === "rgbds" &&
    manifest?.rgbds?.version === RGBDS_VERSION &&
    manifest?.rgbds?.commit === RGBDS_COMMIT &&
    manifest?.emscripten?.version === EMSCRIPTEN_VERSION &&
    manifest?.tools
  );
}

try {
  await syncBundle("pret-gen1", validPretManifest, PRET_TOOLS);
  await syncBundle(`rgbds/${RGBDS_VERSION}`, validRgbdsManifest, RGBDS_TOOLS);
} catch (error) {
  throw new Error(
    `Could not prepare the shared development WASM toolchain. Yellow Editor desktop development normally downloads the already-published, pinned web build artifacts so Emscripten is not required locally. If the published bundle is unavailable, run npm run prepare:wasm-tools in an Emscripten ${EMSCRIPTEN_VERSION} environment. ${String(error)}`,
  );
}
