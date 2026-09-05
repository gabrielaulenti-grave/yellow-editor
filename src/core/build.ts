import { inspectPretWasmTools } from "./pretWasmTools";
import { inspectRgbdsWasm } from "./rgbdsWasm";
import type {
  BuildEnvironment,
  BuildProgressListener,
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

function report(
  onProgress: BuildProgressListener | undefined,
  message: string,
  percent: number,
  detail?: string,
) {
  onProgress?.({
    stage: "preparing",
    level: "info",
    message,
    detail,
    percent,
    timestamp: Date.now(),
  });
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

    async build(
      target: BuildTarget,
      onProgress?: BuildProgressListener,
    ): Promise<BuildResult> {
      report(onProgress, "Inspecting the build environment", 2);
      const environment = await inspectEnvironment();
      report(
        onProgress,
        "Build environment ready",
        5,
        `RGBDS ${environment.detectedRgbdsVersion ?? "not detected"}; target ${target}`,
      );

      if (!environment.targets.includes(target)) {
        const message = `Build target '${target}' does not belong to this project.`;
        onProgress?.({
          stage: "error",
          level: "error",
          message,
          percent: 5,
          timestamp: Date.now(),
        });
        throw new Error(message);
      }

      if (!environment.ready || !environment.requiredRgbdsVersion) {
        onProgress?.({
          stage: "error",
          level: "error",
          message: "The browser build environment is not ready.",
          detail: environment.message,
          percent: 5,
          timestamp: Date.now(),
        });
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

      let handleIndexDurationMs = 0;
      if (source.prepareBuildReads) {
        report(
          onProgress,
          "Indexing project file handles",
          6,
          "Enumerating the checkout once so subsequent build reads can reuse browser file handles.",
        );
        const preparation = await source.prepareBuildReads();
        handleIndexDurationMs = preparation.durationMs;
        onProgress?.({
          stage: "preparing",
          level: preparation.indexed ? "info" : "warning",
          message: preparation.indexed
            ? "Project file index ready"
            : "Project file index incomplete",
          detail: preparation.indexed
            ? `${preparation.fileCount} files in ${preparation.directoryCount} directories indexed in ${(preparation.durationMs / 1000).toFixed(1)}s.`
            : preparation.message,
          task: {
            label: "Index project file handles",
            completed: 1,
            total: 1,
            percent: 100,
            unit: "index",
          },
          percent: 6,
          timestamp: Date.now(),
        });
      }

      const result = await buildWebRom(
        source,
        target,
        environment.requiredRgbdsVersion,
        onProgress,
      );
      if (handleIndexDurationMs > 0) {
        result.durationMs += handleIndexDurationMs;
        const profileLine = `Project file handle index: ${(handleIndexDurationMs / 1000).toFixed(1)}s before build graph execution.`;
        result.stdout = [result.stdout, profileLine].filter(Boolean).join("\n");
      }
      return result;
    },
  };
}
