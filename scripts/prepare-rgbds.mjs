import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RGBDS_VERSION = "1.0.3";
const TOOLS = ["rgbasm", "rgblink", "rgbfix", "rgbgfx"];
const RELEASE_BASE = `https://github.com/gbdev/rgbds/releases/download/v${RGBDS_VERSION}`;

const RELEASES = {
  "win32-x64": {
    file: "rgbds-win64.zip",
    sha256: "b66c23cb6d073dd3866ea30ef1ca5164549e0dae9ebe771957aff25e2658b0e3",
    kind: "zip",
  },
  "win32-ia32": {
    file: "rgbds-win32.zip",
    sha256: "c46f70d9df52aa72cf0d017a9042768c84bb5b1e9440cb84c0634db13ca5956e",
    kind: "zip",
  },
  "linux-x64": {
    file: "rgbds-linux-x86_64.tar.xz",
    sha256: "280a52061a0c516999bee75ac357628d6d50784309e0486cef25f7460e6f330b",
    kind: "tar.xz",
  },
  "darwin-x64": {
    file: "rgbds-macos.zip",
    sha256: "dc1804b187895c4e1b730ba9d4b476052979607e613113b72dc7a494f88c898e",
    kind: "zip",
  },
  "darwin-arm64": {
    file: "rgbds-macos.zip",
    sha256: "dc1804b187895c4e1b730ba9d4b476052979607e613113b72dc7a494f88c898e",
    kind: "zip",
  },
};

const repoRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const versionRoot = path.join(
  repoRoot,
  "src-tauri",
  "resources",
  "rgbds",
  RGBDS_VERSION,
);
const destinationBin = path.join(versionRoot, "bin");
const markerPath = path.join(versionRoot, "bundle.json");
const platformKey = `${process.platform}-${process.arch}`;
const release = RELEASES[platformKey];

function executableName(tool) {
  return process.platform === "win32" ? `${tool}.exe` : tool;
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function bundleIsCurrent() {
  if (!(await exists(markerPath))) {
    return false;
  }

  try {
    const marker = JSON.parse(await readFile(markerPath, "utf8"));
    if (
      marker.version !== RGBDS_VERSION ||
      marker.platform !== platformKey ||
      marker.asset !== release.file ||
      marker.sha256 !== release.sha256
    ) {
      return false;
    }

    for (const tool of TOOLS) {
      if (!(await exists(path.join(destinationBin, executableName(tool))))) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

async function sha256(filePath) {
  const contents = await readFile(filePath);
  return createHash("sha256").update(contents).digest("hex");
}

function powershellQuote(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function extractArchive(archivePath, destination, kind) {
  try {
    if (kind === "tar.xz") {
      execFileSync("tar", ["-xJf", archivePath, "-C", destination], {
        stdio: "inherit",
      });
      return;
    }

    if (process.platform === "win32") {
      const command = `Expand-Archive -LiteralPath ${powershellQuote(archivePath)} -DestinationPath ${powershellQuote(destination)} -Force`;
      execFileSync(
        "powershell.exe",
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
        { stdio: "inherit" },
      );
      return;
    }

    execFileSync("unzip", ["-q", "-o", archivePath, "-d", destination], {
      stdio: "inherit",
    });
  } catch (error) {
    throw new Error(
      `Could not extract ${path.basename(archivePath)}. Ensure the platform archive utility is available. ${String(error)}`,
    );
  }
}

async function findNamedFile(root, fileName) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const candidate = path.join(root, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) {
      return candidate;
    }
    if (entry.isDirectory()) {
      const nested = await findNamedFile(candidate, fileName);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

async function copyToolDirectory(extractedRoot) {
  const foundTools = new Map();

  for (const tool of TOOLS) {
    const fileName = executableName(tool);
    const found = await findNamedFile(extractedRoot, fileName);
    if (!found) {
      throw new Error(`The RGBDS archive did not contain ${fileName}.`);
    }
    foundTools.set(tool, found);
  }

  const sourceDirectory = path.dirname(foundTools.get("rgbasm"));
  for (const [tool, toolPath] of foundTools) {
    if (path.dirname(toolPath) !== sourceDirectory) {
      throw new Error(
        `Unexpected RGBDS archive layout: ${tool} is not next to rgbasm.`,
      );
    }
  }

  await rm(destinationBin, { recursive: true, force: true });
  await mkdir(destinationBin, { recursive: true });

  // Copy all files next to the tools, not just the four executables. Official
  // Windows/macOS archives may include runtime libraries in the same folder.
  const entries = await readdir(sourceDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const source = path.join(sourceDirectory, entry.name);
    const destination = path.join(destinationBin, entry.name);
    await copyFile(source, destination);
  }

  if (process.platform !== "win32") {
    for (const tool of TOOLS) {
      await chmod(path.join(destinationBin, executableName(tool)), 0o755);
    }
  }
}

function verifyRgbds() {
  const rgbasm = path.join(destinationBin, executableName("rgbasm"));
  try {
    const output = execFileSync(rgbasm, ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();

    if (!output.includes(RGBDS_VERSION)) {
      throw new Error(`Expected RGBDS ${RGBDS_VERSION}, got '${output}'.`);
    }

    return output;
  } catch (error) {
    throw new Error(`Prepared RGBDS could not be executed: ${String(error)}`);
  }
}

async function main() {
  if (!release) {
    console.warn(
      `[RGBDS] No official prebuilt RGBDS ${RGBDS_VERSION} archive is configured for ${platformKey}. ` +
        "Skipping the bundled toolchain; Yellow Editor can still fall back to RGBDS on PATH.",
    );
    return;
  }

  if (await bundleIsCurrent()) {
    console.log(`[RGBDS] ${RGBDS_VERSION} is already prepared for ${platformKey}.`);
    return;
  }

  await mkdir(versionRoot, { recursive: true });
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "yellow-editor-rgbds-"));
  const archivePath = path.join(temporaryRoot, release.file);
  const extractRoot = path.join(temporaryRoot, "extract");

  try {
    await mkdir(extractRoot, { recursive: true });
    const url = `${RELEASE_BASE}/${release.file}`;
    console.log(`[RGBDS] Downloading ${url}`);

    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) {
      throw new Error(`Download failed with HTTP ${response.status} ${response.statusText}.`);
    }

    await writeFile(archivePath, Buffer.from(await response.arrayBuffer()));
    const digest = await sha256(archivePath);
    if (digest !== release.sha256) {
      throw new Error(
        `RGBDS archive checksum mismatch. Expected ${release.sha256}, got ${digest}.`,
      );
    }

    extractArchive(archivePath, extractRoot, release.kind);
    await copyToolDirectory(extractRoot);
    const versionOutput = verifyRgbds();

    await writeFile(
      markerPath,
      `${JSON.stringify(
        {
          version: RGBDS_VERSION,
          platform: platformKey,
          asset: release.file,
          sha256: release.sha256,
          source: `${RELEASE_BASE}/${release.file}`,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    console.log(`[RGBDS] Bundled ${versionOutput} for ${platformKey}.`);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

await main();
