import type {
  BuildEnvironment,
  BuildResult,
  BuildService,
  BuildTarget,
  BuildToolStatus,
  ProjectSource,
} from "./types";

function unavailableTool(name: string): BuildToolStatus {
  return {
    name,
    available: false,
    path: null,
    version: null,
  };
}

async function readRequiredRgbdsVersion(source: ProjectSource): Promise<string | null> {
  if (!(await source.exists(".rgbds-version"))) {
    return null;
  }

  const version = (await source.readText(".rgbds-version")).trim();
  return version || null;
}

async function detectBuildTargets(source: ProjectSource): Promise<BuildTarget[]> {
  return (await source.exists("data/pokemon/mew.asm"))
    ? ["red", "blue"]
    : ["yellow"];
}

export function createWebBuildService(source: ProjectSource): BuildService {
  return {
    async inspect(): Promise<BuildEnvironment> {
      const [requiredRgbdsVersion, targets] = await Promise.all([
        readRequiredRgbdsVersion(source),
        detectBuildTargets(source),
      ]);

      return {
        backend: "web-wasm",
        ready: false,
        targets,
        requiredRgbdsVersion,
        detectedRgbdsVersion: null,
        versionMatches: null,
        toolchainSource: "unavailable",
        tools: [
          unavailableTool("rgbasm"),
          unavailableTool("rgblink"),
          unavailableTool("rgbfix"),
          unavailableTool("rgbgfx"),
        ],
        buildTool: unavailableTool("make"),
        helperCompiler: null,
        message: requiredRgbdsVersion
          ? `This checkout requests RGBDS ${requiredRgbdsVersion}. The browser RGBDS/WASM backend is the next integration step.`
          : "The browser RGBDS/WASM backend is the next integration step.",
      };
    },

    async build(_target: BuildTarget): Promise<BuildResult> {
      throw new Error(
        "ROM building is not available in the web version yet. The shared build API is ready for the RGBDS/WASM backend.",
      );
    },
  };
}
