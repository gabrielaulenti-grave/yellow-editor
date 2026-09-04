import { hashText } from "./history";
import type {
  BuildToolStatus,
  ProjectSource,
} from "./types";
import type {
  BuildToolRuntime,
  ToolInvocation,
  ToolInvocationResult,
  ToolRuntimeStatus,
} from "./toolRuntime";

const MANIFEST_PATH = "wasm-tools/pret-gen1/manifest.json";
const BASE_HELPER_TOOLS = ["scan_includes", "gfx", "pkmncompress"] as const;
const OPTIONAL_HELPER_TOOLS = ["make_patch", "pcm"] as const;

interface PretWasmSourceFile {
  gitBlobSha: string;
  sha256: string;
}

interface PretWasmToolDefinition {
  module: string;
  wasm: string;
  source: string;
}

interface PretWasmToolManifest {
  schemaVersion: 1;
  family: "pret-gen1";
  generatedAt: string;
  source: {
    repository: string;
    commit: string;
    files: Record<string, PretWasmSourceFile>;
  };
  emscripten: {
    version: string;
    versionLine: string;
  };
  tools: Record<string, PretWasmToolDefinition>;
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

export interface PretWasmInspection {
  readyForRomBuild: boolean;
  tools: BuildToolStatus[];
  sourceCommit: string | null;
  emscriptenVersion: string | null;
  message: string;
}

let manifestPromise: Promise<PretWasmToolManifest | null> | null = null;

function appAssetUrl(relativePath: string): string {
  const currentUrl =
    typeof window !== "undefined"
      ? window.location.href
      : "http://localhost/";
  const baseUrl = new URL(import.meta.env.BASE_URL || "/", currentUrl);
  return new URL(relativePath, baseUrl).toString();
}

async function loadManifest(): Promise<PretWasmToolManifest | null> {
  if (!manifestPromise) {
    manifestPromise = (async () => {
      try {
        const response = await fetch(appAssetUrl(MANIFEST_PATH), {
          cache: "no-cache",
        });
        if (!response.ok) {
          return null;
        }

        const manifest = (await response.json()) as PretWasmToolManifest;
        if (
          manifest.schemaVersion !== 1 ||
          manifest.family !== "pret-gen1" ||
          !manifest.source?.commit ||
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
  }

  return manifestPromise;
}

function unavailableTool(name: string): BuildToolStatus {
  return {
    name,
    available: false,
    path: null,
    version: null,
  };
}

async function projectHelperTools(source: ProjectSource): Promise<{
  required: string[];
  visible: string[];
}> {
  const required = [...BASE_HELPER_TOOLS];
  const visible = [...BASE_HELPER_TOOLS];

  if (await source.exists("tools/make_patch.c")) {
    visible.push("make_patch");
  }

  if (await source.exists("tools/pcm.c")) {
    required.push("pcm");
    visible.push("pcm");
  }

  return { required, visible };
}

async function sourceMatchesManifest(
  source: ProjectSource,
  manifest: PretWasmToolManifest,
  relativePath: string,
): Promise<boolean> {
  const expected = manifest.source.files[relativePath];
  if (!expected || !(await source.exists(relativePath))) {
    return false;
  }

  try {
    const contents = await source.readText(relativePath);
    return (await hashText(contents)) === expected.sha256;
  } catch {
    return false;
  }
}

export async function inspectPretWasmTools(
  source: ProjectSource,
): Promise<PretWasmInspection> {
  const { required, visible } = await projectHelperTools(source);
  const manifest = await loadManifest();

  if (!manifest) {
    return {
      readyForRomBuild: false,
      tools: visible.map(unavailableTool),
      sourceCommit: null,
      emscriptenVersion: null,
      message:
        "The pret helper WebAssembly bundle is not present in this build of Yellow Editor.",
    };
  }

  const commonMatches = await sourceMatchesManifest(
    source,
    manifest,
    "tools/common.h",
  );

  const compatibility = new Map<string, boolean>();
  for (const name of visible) {
    const definition = manifest.tools[name];
    const sourcePath = definition?.source ?? `tools/${name}.c`;
    compatibility.set(
      name,
      Boolean(
        definition &&
          commonMatches &&
          (await sourceMatchesManifest(source, manifest, sourcePath)),
      ),
    );
  }

  const tools = visible.map((name): BuildToolStatus => {
    const definition = manifest.tools[name];
    const available = Boolean(definition && compatibility.get(name));
    return {
      name,
      available,
      path: definition ? appAssetUrl(`wasm-tools/pret-gen1/${definition.wasm}`) : null,
      version: available
        ? `${manifest.source.commit.slice(0, 12)} / emscripten ${manifest.emscripten.version}`
        : null,
    };
  });

  const readyForRomBuild = required.every(
    (name) => compatibility.get(name) === true,
  );

  const incompatible = visible.filter(
    (name) => compatibility.get(name) !== true,
  );

  return {
    readyForRomBuild,
    tools,
    sourceCommit: manifest.source.commit,
    emscriptenVersion: manifest.emscripten.version,
    message: readyForRomBuild
      ? "The precompiled pret helper WebAssembly tools match this checkout. RGBDS/WASM and the browser build graph are the remaining pieces before ROM builds can run in the web app."
      : `The helper WASM bundle does not match this checkout${
          incompatible.length ? ` for: ${incompatible.join(", ")}` : ""
        }. Yellow Editor will not use mismatched helper binaries.`,
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
  manifest: PretWasmToolManifest,
  tool: string,
): Promise<{
  factory: EmscriptenFactory;
  moduleUrl: string;
  wasmUrl: string;
}> {
  const definition = manifest.tools[tool];
  if (!definition) {
    throw new Error(`The pret WASM bundle does not contain '${tool}'.`);
  }

  const moduleUrl = appAssetUrl(`wasm-tools/pret-gen1/${definition.module}`);
  const wasmUrl = appAssetUrl(`wasm-tools/pret-gen1/${definition.wasm}`);
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

export function createPretWasmToolRuntime(): BuildToolRuntime {
  return {
    async inspect(): Promise<ToolRuntimeStatus> {
      const manifest = await loadManifest();
      if (!manifest) {
        return {
          available: false,
          tools: [],
          version: null,
          message: "Pret helper WASM bundle not found.",
        };
      }

      return {
        available: true,
        tools: Object.keys(manifest.tools),
        version: manifest.source.commit,
        message: `Pret helper WASM bundle built with Emscripten ${manifest.emscripten.version}.`,
      };
    },

    async run(invocation: ToolInvocation): Promise<ToolInvocationResult> {
      const manifest = await loadManifest();
      if (!manifest) {
        throw new Error("Pret helper WASM bundle not found.");
      }

      const { factory, moduleUrl, wasmUrl } = await loadToolFactory(
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
