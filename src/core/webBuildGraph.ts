import { createPretWasmToolRuntime } from "./pretWasmTools";
import { createRgbdsWasmRuntime } from "./rgbdsWasm";
import type {
  BuildArtifact,
  BuildResult,
  BuildTarget,
  ProjectSource,
} from "./types";
import type {
  BuildToolRuntime,
  ToolInvocationResult,
  ToolRuntimeFile,
} from "./toolRuntime";

const YELLOW_OBJECTS = [
  "audio",
  "home",
  "main",
  "maps",
  "ram",
  "text",
  "gfx/pics",
  "gfx/pikachu",
  "gfx/sprites",
  "gfx/surfing_pikachu",
  "gfx/tilesets",
] as const;

const RED_BLUE_OBJECTS = [
  "audio",
  "home",
  "main",
  "maps",
  "ram",
  "text",
  "gfx/pics",
  "gfx/sprites",
  "gfx/tilesets",
] as const;

const RED_COLUMNS_GRAPHICS = new Set([
  "gfx/intro/blue_jigglypuff_1.2bpp",
  "gfx/intro/blue_jigglypuff_2.2bpp",
  "gfx/intro/blue_jigglypuff_3.2bpp",
  "gfx/intro/red_nidorino_1.2bpp",
  "gfx/intro/red_nidorino_2.2bpp",
  "gfx/intro/red_nidorino_3.2bpp",
  "gfx/intro/gengar.2bpp",
]);

interface BuildProfile {
  family: "yellow" | "redblue";
  target: BuildTarget;
  romName: string;
  mapName: string;
  symName: string;
  objects: readonly string[];
  defines: string[];
  fixFlags: string[];
}

interface AsmReference {
  kind: "include" | "incbin";
  path: string;
}

class BuildFailure extends Error {
  exitCode: number | null;

  constructor(message: string, exitCode: number | null = null) {
    super(message);
    this.exitCode = exitCode;
  }
}

function profileFor(target: BuildTarget): BuildProfile {
  if (target === "yellow") {
    return {
      family: "yellow",
      target,
      romName: "pokeyellow.gbc",
      mapName: "pokeyellow.map",
      symName: "pokeyellow.sym",
      objects: YELLOW_OBJECTS,
      defines: [],
      fixFlags: [
        "-Weverything",
        "-cjsv",
        "-k",
        "01",
        "-l",
        "0x33",
        "-m",
        "MBC5+RAM+BATTERY",
        "-r",
        "03",
        "-t",
        "POKEMON YELLOW",
        "-p",
        "0x00",
      ],
    };
  }

  const isRed = target === "red";
  return {
    family: "redblue",
    target,
    romName: isRed ? "pokered.gbc" : "pokeblue.gbc",
    mapName: isRed ? "pokered.map" : "pokeblue.map",
    symName: isRed ? "pokered.sym" : "pokeblue.sym",
    objects: RED_BLUE_OBJECTS,
    defines: [isRed ? "_RED" : "_BLUE"],
    fixFlags: [
      "-Weverything",
      "-jsv",
      "-n",
      "0",
      "-k",
      "01",
      "-l",
      "0x33",
      "-m",
      "MBC3+RAM+BATTERY",
      "-r",
      "03",
      "-p",
      "0x00",
      "-t",
      isRed ? "POKEMON RED" : "POKEMON BLUE",
    ],
  };
}

function normalizeProjectPath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (
    normalized.startsWith("/") ||
    parts.length === 0 ||
    parts.some((part) => part === "." || part === "..")
  ) {
    throw new Error(`Invalid project-relative build path: ${relativePath}`);
  }
  return parts.join("/");
}

function replaceExtension(path: string, extension: string): string {
  const dot = path.lastIndexOf(".");
  return `${dot >= 0 ? path.slice(0, dot) : path}${extension}`;
}

function stripAsmComment(line: string): string {
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      quoted = !quoted;
    } else if (character === ";" && !quoted) {
      return line.slice(0, index);
    }
  }
  return line;
}

function parseAsmReferences(contents: string): AsmReference[] {
  const references: AsmReference[] = [];
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = stripAsmComment(rawLine);
    const pattern = /\b(INCLUDE|INCBIN)\s*"([^"]+)"/gi;
    for (const match of line.matchAll(pattern)) {
      references.push({
        kind: match[1].toUpperCase() === "INCLUDE" ? "include" : "incbin",
        path: normalizeProjectPath(match[2]),
      });
    }
  }
  return references;
}

function helperGraphicFlags(
  profile: BuildProfile,
  outputPath: string,
  pngPath: string,
): string[] {
  const flags: string[] = [];

  if (
    outputPath === "gfx/battle/move_anim_0.2bpp" ||
    outputPath === "gfx/battle/move_anim_1.2bpp"
  ) {
    flags.push("--trim-whitespace");
  }

  if (outputPath === "gfx/credits/the_end.2bpp") {
    flags.push("--interleave", `--png=${pngPath}`);
  }

  if (outputPath.startsWith("gfx/tilesets/") && outputPath.endsWith(".2bpp")) {
    flags.push("--trim-whitespace");
    if (outputPath === "gfx/tilesets/reds_house.2bpp") {
      flags.push("--preserve=0x48");
    }
  }

  if (outputPath === "gfx/trade/game_boy.2bpp") {
    flags.push("--remove-duplicates");
  }

  if (profile.family === "yellow") {
    if (
      outputPath === "gfx/diploma/diploma.2bpp" ||
      outputPath === "gfx/slots/slots_1.2bpp" ||
      outputPath === "gfx/title/pokemon_logo.2bpp" ||
      outputPath === "gfx/sgb/border.2bpp" ||
      outputPath === "gfx/surfing_pikachu/surfing_pikachu_1c.2bpp"
    ) {
      flags.push("--trim-whitespace");
    }
  } else {
    if (
      outputPath === "gfx/slots/red_slots_1.2bpp" ||
      outputPath === "gfx/slots/blue_slots_1.2bpp"
    ) {
      flags.push("--trim-whitespace");
    }

    if (outputPath === "gfx/intro/gengar.2bpp") {
      flags.push("--remove-duplicates", "--preserve=0x19,0x76");
    }
  }

  return flags;
}

function rgbgfxExtraFlags(profile: BuildProfile, outputPath: string): string[] {
  return profile.family === "redblue" && RED_COLUMNS_GRAPHICS.has(outputPath)
    ? ["--columns"]
    : [];
}

function artifact(kind: BuildArtifact["kind"], fileName: string, bytes: Uint8Array): BuildArtifact {
  return {
    kind,
    fileName,
    mimeType: kind === "rom" ? "application/octet-stream" : "text/plain;charset=utf-8",
    bytes: Array.from(bytes),
  };
}

class WebBuildWorkspace {
  private readonly sourceBytes = new Map<string, Promise<Uint8Array>>();
  private readonly sourceText = new Map<string, Promise<string>>();
  private readonly existsCache = new Map<string, Promise<boolean>>();
  private readonly generated = new Map<string, Promise<Uint8Array>>();
  private readonly helperRuntime = createPretWasmToolRuntime();
  private readonly rgbdsRuntime: BuildToolRuntime;
  private readonly stdout: string[] = [];
  private readonly stderr: string[] = [];

  constructor(
    private readonly source: ProjectSource,
    private readonly profile: BuildProfile,
    rgbdsVersion: string,
  ) {
    this.rgbdsRuntime = createRgbdsWasmRuntime(rgbdsVersion);
  }

  getStdout(): string {
    return this.stdout.join("\n");
  }

  getStderr(): string {
    return this.stderr.join("\n");
  }

  private exists(path: string): Promise<boolean> {
    const normalized = normalizeProjectPath(path);
    let promise = this.existsCache.get(normalized);
    if (!promise) {
      promise = this.source.exists(normalized);
      this.existsCache.set(normalized, promise);
    }
    return promise;
  }

  private readBytes(path: string): Promise<Uint8Array> {
    const normalized = normalizeProjectPath(path);
    let promise = this.sourceBytes.get(normalized);
    if (!promise) {
      promise = this.source.readBytes(normalized);
      this.sourceBytes.set(normalized, promise);
    }
    return promise;
  }

  private readText(path: string): Promise<string> {
    const normalized = normalizeProjectPath(path);
    let promise = this.sourceText.get(normalized);
    if (!promise) {
      promise = this.source.readText(normalized);
      this.sourceText.set(normalized, promise);
    }
    return promise;
  }

  private async runTool(
    runtime: BuildToolRuntime,
    tool: string,
    args: string[],
    files: ToolRuntimeFile[],
    outputPaths: string[],
  ): Promise<ToolInvocationResult> {
    this.stdout.push(`> ${tool} ${args.join(" ")}`);
    const result = await runtime.run({
      tool,
      args,
      files,
      outputPaths,
      workingDirectory: "/workspace",
    });

    if (result.stdout) {
      this.stdout.push(result.stdout);
    }
    if (result.stderr) {
      this.stderr.push(result.stderr);
    }
    if (result.exitCode !== 0) {
      throw new BuildFailure(`${tool} exited with code ${result.exitCode}.`, result.exitCode);
    }
    return result;
  }

  private async collectAsmClosure(
    path: string,
    textPaths: Set<string>,
    binaryPaths: Set<string>,
  ): Promise<void> {
    const normalized = normalizeProjectPath(path);
    if (textPaths.has(normalized)) {
      return;
    }
    textPaths.add(normalized);

    const contents = await this.readText(normalized);
    for (const reference of parseAsmReferences(contents)) {
      if (reference.kind === "include") {
        await this.collectAsmClosure(reference.path, textPaths, binaryPaths);
      } else {
        binaryPaths.add(reference.path);
      }
    }
  }

  private async assemblyFiles(entryPath: string, usePreinclude: boolean): Promise<ToolRuntimeFile[]> {
    const textPaths = new Set<string>();
    const binaryPaths = new Set<string>();

    if (usePreinclude) {
      await this.collectAsmClosure("includes.asm", textPaths, binaryPaths);
    }
    await this.collectAsmClosure(entryPath, textPaths, binaryPaths);

    const files: ToolRuntimeFile[] = [];
    for (const path of textPaths) {
      files.push({ path, data: await this.readBytes(path) });
    }
    for (const path of binaryPaths) {
      files.push({ path, data: await this.resolveBuildFile(path) });
    }
    return files;
  }

  private resolveBuildFile(path: string): Promise<Uint8Array> {
    const normalized = normalizeProjectPath(path);
    let promise = this.generated.get(normalized);
    if (!promise) {
      promise = this.resolveBuildFileUncached(normalized);
      this.generated.set(normalized, promise);
    }
    return promise;
  }

  private async resolveBuildFileUncached(path: string): Promise<Uint8Array> {
    if (path.endsWith(".2bpp") || path.endsWith(".1bpp")) {
      const pngPath = replaceExtension(path, ".png");
      if (await this.exists(pngPath)) {
        return this.generateGraphic(path, pngPath, path.endsWith(".1bpp") ? 1 : 2);
      }
    }

    if (path.endsWith(".pic")) {
      const twoBppPath = replaceExtension(path, ".2bpp");
      const pngPath = replaceExtension(path, ".png");
      if ((await this.exists(pngPath)) || (await this.exists(twoBppPath))) {
        const twoBpp = await this.resolveBuildFile(twoBppPath);
        const result = await this.runTool(
          this.helperRuntime,
          "pkmncompress",
          [twoBppPath, path],
          [{ path: twoBppPath, data: twoBpp }],
          [path],
        );
        return result.outputs[0].data;
      }
    }

    if (path.endsWith(".pcm")) {
      const wavPath = replaceExtension(path, ".wav");
      if (await this.exists(wavPath)) {
        const wav = await this.readBytes(wavPath);
        const result = await this.runTool(
          this.helperRuntime,
          "pcm",
          [wavPath, path],
          [{ path: wavPath, data: wav }],
          [path],
        );
        return result.outputs[0].data;
      }
    }

    if (await this.exists(path)) {
      return this.readBytes(path);
    }

    throw new BuildFailure(`Required build input '${path}' was not found and has no supported generation rule.`);
  }

  private async generateGraphic(
    outputPath: string,
    pngPath: string,
    depth: 1 | 2,
  ): Promise<Uint8Array> {
    const png = await this.readBytes(pngPath);
    const rgbgfxArgs = [
      "--colors",
      "dmg",
      "-Weverything",
      ...rgbgfxExtraFlags(this.profile, outputPath),
      ...(depth === 1 ? ["--depth", "1"] : []),
      "-o",
      outputPath,
      pngPath,
    ];
    const converted = await this.runTool(
      this.rgbdsRuntime,
      "rgbgfx",
      rgbgfxArgs,
      [{ path: pngPath, data: png }],
      [outputPath],
    );
    let bytes = converted.outputs[0].data;

    const helperFlags = helperGraphicFlags(this.profile, outputPath, pngPath);
    if (helperFlags.length > 0) {
      const helperFiles: ToolRuntimeFile[] = [{ path: outputPath, data: bytes }];
      if (helperFlags.some((flag) => flag.startsWith("--png="))) {
        helperFiles.push({ path: pngPath, data: png });
      }
      const processed = await this.runTool(
        this.helperRuntime,
        "gfx",
        [...helperFlags, "-o", outputPath, outputPath],
        helperFiles,
        [outputPath],
      );
      bytes = processed.outputs[0].data;
    }

    return bytes;
  }

  private async checkRgbds(): Promise<void> {
    if (!(await this.exists("rgbdscheck.asm"))) {
      return;
    }
    const outputName = "rgbdscheck.o";
    await this.runTool(
      this.rgbdsRuntime,
      "rgbasm",
      ["-o", outputName, "rgbdscheck.asm"],
      await this.assemblyFiles("rgbdscheck.asm", false),
      [outputName],
    );
  }

  private async assembleObjects(): Promise<ToolRuntimeFile[]> {
    const objects: ToolRuntimeFile[] = [];
    const defineArgs = this.profile.defines.flatMap((define) => ["-D", define]);

    for (let index = 0; index < this.profile.objects.length; index += 1) {
      const stem = this.profile.objects[index];
      const entryPath = `${stem}.asm`;
      const outputName = `yellow-editor-${String(index).padStart(2, "0")}.o`;
      const args = [
        "-Weverything",
        "-Wtruncation=1",
        "-Q8",
        "-P",
        "includes.asm",
        ...defineArgs,
        "-o",
        outputName,
        entryPath,
      ];
      const result = await this.runTool(
        this.rgbdsRuntime,
        "rgbasm",
        args,
        await this.assemblyFiles(entryPath, true),
        [outputName],
      );
      objects.push({ path: outputName, data: result.outputs[0].data });
    }

    return objects;
  }

  private async link(objects: ToolRuntimeFile[]): Promise<{
    rom: Uint8Array;
    map: Uint8Array;
    sym: Uint8Array;
  }> {
    const layout = await this.readBytes("layout.link");
    const args = [
      "-Weverything",
      "-Wtruncation=1",
      "-d",
      "-p",
      "0x00",
      "-l",
      "layout.link",
      "-m",
      this.profile.mapName,
      "-n",
      this.profile.symName,
      "-o",
      this.profile.romName,
      ...objects.map((file) => file.path),
    ];
    const result = await this.runTool(
      this.rgbdsRuntime,
      "rgblink",
      args,
      [{ path: "layout.link", data: layout }, ...objects],
      [this.profile.romName, this.profile.mapName, this.profile.symName],
    );
    const byPath = new Map(result.outputs.map((file) => [file.path, file.data]));
    const rom = byPath.get(this.profile.romName);
    const map = byPath.get(this.profile.mapName);
    const sym = byPath.get(this.profile.symName);
    if (!rom || !map || !sym) {
      throw new BuildFailure("rgblink did not produce all expected output files.");
    }
    return { rom, map, sym };
  }

  private async fix(rom: Uint8Array): Promise<Uint8Array> {
    const result = await this.runTool(
      this.rgbdsRuntime,
      "rgbfix",
      [...this.profile.fixFlags, this.profile.romName],
      [{ path: this.profile.romName, data: rom }],
      [this.profile.romName],
    );
    return result.outputs[0].data;
  }

  async build(): Promise<BuildArtifact[]> {
    await this.checkRgbds();
    const objects = await this.assembleObjects();
    const linked = await this.link(objects);
    const rom = await this.fix(linked.rom);
    return [
      artifact("rom", this.profile.romName, rom),
      artifact("map", this.profile.mapName, linked.map),
      artifact("sym", this.profile.symName, linked.sym),
    ];
  }
}

export async function buildWebRom(
  source: ProjectSource,
  target: BuildTarget,
  rgbdsVersion: string,
): Promise<BuildResult> {
  const started = performance.now();
  const profile = profileFor(target);
  const workspace = new WebBuildWorkspace(source, profile, rgbdsVersion);

  try {
    const artifacts = await workspace.build();
    return {
      success: true,
      target,
      romPath: null,
      stdout: workspace.getStdout(),
      stderr: workspace.getStderr(),
      durationMs: Math.round(performance.now() - started),
      exitCode: 0,
      artifacts,
    };
  } catch (error) {
    const failure = error instanceof BuildFailure ? error : null;
    const message = error instanceof Error ? error.message : String(error);
    const stderr = [workspace.getStderr(), message].filter(Boolean).join("\n");
    return {
      success: false,
      target,
      romPath: null,
      stdout: workspace.getStdout(),
      stderr,
      durationMs: Math.round(performance.now() - started),
      exitCode: failure?.exitCode ?? null,
      artifacts: [],
    };
  }
}
