import { inspectPretWasmTools } from "./pretWasmTools";
import { inspectRgbdsWasm } from "./rgbdsWasm";
import type {
  BuildEnvironment,
  BuildResult,
  BuildService,
  BuildTarget,
  BuildToolStatus,
  ProjectSource,
} from "./types";
import { buildWebRom } from "./webBuildGraph";

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
  async function inspectEnvironment(): Promise<BuildEnvironment> {
    const [requiredRgbdsVersion, targets, helperInspection] = await Promise.all([
      readRequiredRgbdsVersion(source),
      detectBuildTargets(source),
      inspectPretWasmTools(source),
    ]);
    const rgbdsInspection = await inspectRgbdsWasm(requiredRgbdsVersion);
    const ready = helperInspection.readyForRomBuild && rgbdsInspection.ready;

    return {
      backend: "web-wasm",
      ready,
      targets,
      requiredRgbdsVersion,
      detectedRgbdsVersion: rgbdsInspection.version,
      versionMatches: rgbdsInspection.versionMatches,
      toolchainSource: rgbdsInspection.ready ? "bundled" : "unavailable",
      tools: rgbdsInspection.tools,
      buildTool: ready
        ? {
            name: "Yellow Editor build graph",
            available: true,
            path: "browser memory",
            version: "Gen I Yellow + Red/Blue",
          }
        : unavailableTool("Yellow Editor build graph"),
      helperCompiler: null,
      helperTools: helperInspection.tools,
      message: [rgbdsInspection.message, helperInspection.message].join(" "),
    };
  }

  return {
    inspect: inspectEnvironment,

    async build(target: BuildTarget): Promise<BuildResult> {
      const environment = await inspectEnvironment();
      if (!environment.targets.includes(target)) {
        throw new Error(`Build target '${target}' does not belong to this project.`);
      }

      if (!environment.ready || !environment.requiredRgbdsVersion) {
        return {
          success: false,
          target,
          romPath: null,
          stdout: "",
          stderr: environment.message,
          durationMs: 0,
          exitCode: null,
          artifacts: [],
        };
      }

      return buildWebRom(source, target, environment.requiredRgbdsVersion);
    },
  };
}
