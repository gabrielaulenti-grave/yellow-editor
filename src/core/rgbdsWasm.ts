import type { BuildToolStatus } from "./types";
import type {
  BuildToolRuntime,
  ToolInvocation,
  ToolInvocationResult,
  ToolRuntimeStatus,
} from "./toolRuntime";

const RGBDS_TOOLS = ["rgbasm", "rgblink", "rgbfix", "rgbgfx"] as const;

interface RgbdsWasmToolDefinition {
  module: string;
  wasm: string;
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

  const tools = RGBDS_TOOLS.map((name): BuildToolStatus => {
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
  const ready = tools.every((tool) => tool.available);

  return {
    ready,
    version: manifest.rgbds.version,
    versionMatches: manifest.rgbds.version === requiredVersion,
    tools,
    message: ready
      ? `RGBDS ${manifest.rgbds.version} is available as WebAssembly.`
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

      return {
        available: RGBDS_TOOLS.every((tool) => Boolean(manifest.tools[tool])),
        tools: RGBDS_TOOLS.filter((tool) => Boolean(manifest.tools[tool])),
        version: manifest.rgbds.version,
        message: `RGBDS ${manifest.rgbds.version} WebAssembly toolchain.`,
      };
    },

    async run(invocation: ToolInvocation): Promise<ToolInvocationResult> {
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
