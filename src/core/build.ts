import { inspectPretWasmTools } from "./pretWasmTools";
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
      const [requiredRgbdsVersion, targets, helperInspection] = await Promise.all([
        readRequiredRgbdsVersion(source),
        detectBuildTargets(source),
        inspectPretWasmTools(source),
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
        buildTool: unavailableTool("Yellow Editor build graph"),
        helperCompiler: null,
        helperTools: helperInspection.tools,
        message: requiredRgbdsVersion
          ? `This checkout requests RGBDS ${requiredRgbdsVersion}. ${helperInspection.message}`
          : helperInspection.message,
      };
    },

    async build(_target: BuildTarget): Promise<BuildResult> {
      throw new Error(
        "ROM building is not available in the web version yet. The pret helper WASM runtime is in place; RGBDS/WASM and the browser build graph are the remaining build stages.",
      );
    },
  };
}
