import { convertGen1PngToTiles } from "./gen1Graphics";
import type { BuildToolStatus } from "./types";
import type {
  BuildToolRuntime,
  ToolInvocation,
  ToolInvocationResult,
  ToolRuntimeStatus,
} from "./toolRuntime";

const RGBDS_WASM_TOOLS = ["rgbasm", "rgblink", "rgbfix"] as const;
const RGBDS_TOOLS = [...RGBDS_WASM_TOOLS, "rgbgfx"] as const;

interface RgbdsWasmToolDefinition {
  module: string;
  wasm: string;
  implementation?: string;
}

interface RgbdsWasmManifest {
  schemaVersion: 1;
  family: "rgbds";
  generatedAt: string;
  rgbds: {
    version: string;
    tag: string;
    commit: string;
  };
  emscripten: {
    version: string;
    versionLine: string;
  };
  tools: Record<string, RgbdsWasmToolDefinition>;
}

interface EmscriptenFileSystem {
  mkdirTree(path: string): void;
  chdir(path: string): void;
  writeFile(path: string, data: Uint8Array | string): void;
  readFile(path: string): Uint8Array;
}

interface EmscriptenModule {
  FS: EmscriptenFileSystem;
  callMain(args: string[]): number | void;
}

type EmscriptenFactory = (options: {
  noInitialRun?: boolean;
  locateFile?(path: string): string;
  print?(text: string): void;
  printErr?(text: string): void;
}) => Promise<EmscriptenModule>;

export interface RgbdsWasmInspection {
  ready: boolean;
  version: string | null;
  versionMatches: boolean | null;
  tools: BuildToolStatus[];
  message: string;
}

interface Gen1RgbgfxInvocation {
  input: string;
  output: string;
  depth: 1 | 2;
  columnMajor: boolean;
}

const manifestPromises = new Map<string, Promise<RgbdsWasmManifest | null>>();

function appAssetUrl(relativePath: string): string {
  const currentUrl =
    typeof window !== "undefined"
      ? window.location.href
      : "http://localhost/";
  const baseUrl = new URL(import.meta.env.BASE_URL || "/", currentUrl);
  return new URL(relativePath, baseUrl).toString();
}

function manifestPath(version: string): string {
  return `wasm-tools/rgbds/${version}/manifest.json`;
}

async function loadManifest(version: string): Promise<RgbdsWasmManifest | null> {
  let promise = manifestPromises.get(version);
  if (!promise) {
    promise = (async () => {
      try {
        const response = await fetch(appAssetUrl(manifestPath(version)), {
          cache: "no-cache",
        });
        if (!response.ok) {
          return null;
        }

        const manifest = (await response.json()) as RgbdsWasmManifest;
        if (
          manifest.schemaVersion !== 1 ||
          manifest.family !== "rgbds" ||
          manifest.rgbds?.version !== version ||
          !manifest.emscripten?.version ||
          !manifest.tools
        ) {
          return null;
        }

        return manifest;
      } catch {
        return null;
      }
    })();
    manifestPromises.set(version, promise);
  }

  return promise;
}

function unavailableTool(name: string): BuildToolStatus {
  return {
    name,
    available: false,
    path: null,
    version: null,
  };
}

function browserRgbgfxStatus(version: string): BuildToolStatus {
  return {
    name: "rgbgfx",
    available: true,
    path: "browser image decoder",
    version: `${version} Gen I-compatible subset`,
  };
}

export async function inspectRgbdsWasm(
  requiredVersion: string | null,
): Promise<RgbdsWasmInspection> {
  if (!requiredVersion) {
    return {
      ready: false,
      version: null,
      versionMatches: null,
      tools: RGBDS_TOOLS.map(unavailableTool),
      message: "This checkout does not declare an RGBDS version in .rgbds-version.",
    };
  }

  const manifest = await loadManifest(requiredVersion);
  if (!manifest) {
    return {
      ready: false,
      version: null,
      versionMatches: null,
      tools: RGBDS_TOOLS.map(unavailableTool),
      message: `Yellow Editor does not currently include an RGBDS ${requiredVersion} WebAssembly bundle.`,
    };
  }

  const wasmTools = RGBDS_WASM_TOOLS.map((name): BuildToolStatus => {
    const definition = manifest.tools[name];
    return definition
      ? {
          name,
          available: true,
          path: appAssetUrl(
            `wasm-tools/rgbds/${requiredVersion}/${definition.wasm}`,
          ),
          version: `${manifest.rgbds.version} / emscripten ${manifest.emscripten.version}`,
        }
      : unavailableTool(name);
  });
  const ready = wasmTools.every((tool) => tool.available);

  return {
    ready,
    version: manifest.rgbds.version,
    versionMatches: manifest.rgbds.version === requiredVersion,
    tools: [...wasmTools, browserRgbgfxStatus(manifest.rgbds.version)],
    message: ready
      ? `RGBDS ${manifest.rgbds.version} assembler/linker/fixer are available as WebAssembly; Gen I graphics conversion uses the browser image pipeline.`
      : `The RGBDS ${requiredVersion} WebAssembly bundle is incomplete.`,
  };
}

function normalizeRelativePath(relativePath: string): string {
  const parts = relativePath
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean);

  if (
    relativePath.startsWith("/") ||
    parts.length === 0 ||
    parts.some((part) => part === "." || part === "..")
  ) {
    throw new Error(`Invalid tool workspace path: ${relativePath}`);
  }

  return parts.join("/");
}

function workspacePath(workingDirectory: string, relativePath: string): string {
  return `${workingDirectory.replace(/\/$/, "")}/${normalizeRelativePath(relativePath)}`;
}

function exitStatus(error: unknown): number | null {
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    typeof (error as { status?: unknown }).status === "number"
  ) {
    return (error as { status: number }).status;
  }

  return null;
}

function parseDepth(value: string): 1 | 2 {
  if (value === "1") {
    return 1;
  }
  if (value === "2") {
    return 2;
  }
  throw new Error(`Unsupported Gen I rgbgfx bit depth '${value}'.`);
}

function parseGen1RgbgfxInvocation(args: string[]): Gen1RgbgfxInvocation {
  let input: string | null = null;
  let output: string | null = null;
  let depth: 1 | 2 = 2;
  let columnMajor = false;
  let dmgColors = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "-Weverything") {
      continue;
    }
    if (arg === "--columns" || arg === "-Z") {
      columnMajor = true;
      continue;
    }
    if (arg === "--colors") {
      const value = args[++index];
      if (value !== "dmg") {
        throw new Error(
          "Yellow Editor's Gen I graphics adapter only supports '--colors dmg'.",
        );
      }
      dmgColors = true;
      continue;
    }
    if (arg === "--colors=dmg") {
      dmgColors = true;
      continue;
    }
    if (arg === "--depth" || arg === "-d") {
      const value = args[++index];
      if (!value) {
        throw new Error("Missing Gen I rgbgfx bit depth.");
      }
      depth = parseDepth(value);
      continue;
    }
    if (arg.startsWith("--depth=")) {
      depth = parseDepth(arg.slice("--depth=".length));
      continue;
    }
    if (/^-d[12]$/.test(arg)) {
      depth = parseDepth(arg.slice(2));
      continue;
    }
    if (arg === "-o" || arg === "--output") {
      const value = args[++index];
      if (!value) {
        throw new Error("Missing Gen I rgbgfx output path.");
      }
      output = value;
      continue;
    }
    if (arg.startsWith("--output=")) {
      output = arg.slice("--output=".length);
      continue;
    }
    if (arg.startsWith("-o") && arg.length > 2) {
      output = arg.slice(2);
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unsupported Gen I rgbgfx option '${arg}'.`);
    }
    if (input !== null) {
      throw new Error("Gen I rgbgfx received more than one input image.");
    }
    input = arg;
  }

  if (!dmgColors) {
    throw new Error("The Gen I graphics adapter requires '--colors dmg'.");
  }
  if (!input) {
    throw new Error("Gen I rgbgfx is missing its input PNG path.");
  }
  if (!output) {
    throw new Error("Gen I rgbgfx is missing its output tile-data path.");
  }

  return { input, output, depth, columnMajor };
}

async function runBrowserRgbgfx(
  invocation: ToolInvocation,
): Promise<ToolInvocationResult> {
  const started = performance.now();
  const options = parseGen1RgbgfxInvocation(invocation.args);
  const inputPath = normalizeRelativePath(options.input);
  const outputPath = normalizeRelativePath(options.output);
  const input = (invocation.files ?? []).find(
    (file) => normalizeRelativePath(file.path) === inputPath,
  );
  if (!input) {
    throw new Error(`Gen I rgbgfx input '${inputPath}' was not mounted.`);
  }

  const data = await convertGen1PngToTiles(input.data, {
    depth: options.depth,
    columnMajor: options.columnMajor,
  });

  return {
    exitCode: 0,
    stdout: "",
    stderr: "",
    outputs: [{ path: outputPath, data }],
    durationMs: Math.round(performance.now() - started),
  };
}

async function loadToolFactory(
  version: string,
  manifest: RgbdsWasmManifest,
  tool: string,
): Promise<{
  factory: EmscriptenFactory;
  moduleUrl: string;
  wasmUrl: string;
}> {
  const definition = manifest.tools[tool];
  if (!definition) {
    throw new Error(`The RGBDS WASM bundle does not contain '${tool}'.`);
  }

  const root = `wasm-tools/rgbds/${version}`;
  const moduleUrl = appAssetUrl(`${root}/${definition.module}`);
  const wasmUrl = appAssetUrl(`${root}/${definition.wasm}`);
  const imported = (await import(/* @vite-ignore */ moduleUrl)) as {
    default?: EmscriptenFactory;
  };

  if (typeof imported.default !== "function") {
    throw new Error(`The WASM module for '${tool}' did not export a module factory.`);
  }

  return {
    factory: imported.default,
    moduleUrl,
    wasmUrl,
  };
}

export function createRgbdsWasmRuntime(version: string): BuildToolRuntime {
  return {
    async inspect(): Promise<ToolRuntimeStatus> {
      const manifest = await loadManifest(version);
      if (!manifest) {
        return {
          available: false,
          tools: [],
          version: null,
          message: `RGBDS ${version} WASM bundle not found.`,
        };
      }

      const ready = RGBDS_WASM_TOOLS.every((tool) => Boolean(manifest.tools[tool]));
      return {
        available: ready,
        tools: [
          ...RGBDS_WASM_TOOLS.filter((tool) => Boolean(manifest.tools[tool])),
          "rgbgfx",
        ],
        version: manifest.rgbds.version,
        message: ready
          ? `RGBDS ${manifest.rgbds.version} WebAssembly toolchain with browser-native Gen I graphics conversion.`
          : `RGBDS ${manifest.rgbds.version} WebAssembly bundle is incomplete.`,
      };
    },

    async run(invocation: ToolInvocation): Promise<ToolInvocationResult> {
      if (invocation.tool === "rgbgfx") {
        return runBrowserRgbgfx(invocation);
      }

      const manifest = await loadManifest(version);
      if (!manifest) {
        throw new Error(`RGBDS ${version} WASM bundle not found.`);
      }

      const { factory, moduleUrl, wasmUrl } = await loadToolFactory(
        version,
        manifest,
        invocation.tool,
      );
      const stdout: string[] = [];
      const stderr: string[] = [];
      const started = performance.now();

      const module = await factory({
        noInitialRun: true,
        locateFile(path) {
          if (path.endsWith(".wasm")) {
            return wasmUrl;
          }
          return new URL(path, moduleUrl).toString();
        },
        print(text) {
          stdout.push(String(text));
        },
        printErr(text) {
          stderr.push(String(text));
        },
      });

      const workingDirectory = invocation.workingDirectory ?? "/workspace";
      if (!workingDirectory.startsWith("/")) {
        throw new Error("Tool workingDirectory must be an absolute virtual path.");
      }

      module.FS.mkdirTree(workingDirectory);
      module.FS.chdir(workingDirectory);

      for (const file of invocation.files ?? []) {
        const path = workspacePath(workingDirectory, file.path);
        const parent = path.slice(0, path.lastIndexOf("/"));
        if (parent) {
          module.FS.mkdirTree(parent);
        }
        module.FS.writeFile(path, file.data);
      }

      let exitCode = 0;
      try {
        const result = module.callMain(invocation.args);
        if (typeof result === "number") {
          exitCode = result;
        }
      } catch (error) {
        const status = exitStatus(error);
        if (status === null) {
          throw error;
        }
        exitCode = status;
      }

      const outputs = (invocation.outputPaths ?? []).map((relativePath) => ({
        path: normalizeRelativePath(relativePath),
        data: module.FS.readFile(workspacePath(workingDirectory, relativePath)),
      }));

      return {
        exitCode,
        stdout: stdout.join("\n"),
        stderr: stderr.join("\n"),
        outputs,
        durationMs: Math.round(performance.now() - started),
      };
    },
  };
}
