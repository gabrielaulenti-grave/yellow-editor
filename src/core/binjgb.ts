export const BINJGB_VERSION = "0.1.11";

const SCREEN_WIDTH = 160;
const SCREEN_HEIGHT = 144;
const CPU_TICKS_PER_SECOND = 4_194_304;
const EVENT_NEW_FRAME = 1;
const EVENT_UNTIL_TICKS = 4;
const AUDIO_FRAMES = 4096;
const AUDIO_SAMPLE_RATE = 44_100;
const MAX_UPDATE_SEC = 5 / 60;
const MAX_ROM_BYTES = 8 * 1024 * 1024;

export type EmulatorButton =
  | "up"
  | "down"
  | "left"
  | "right"
  | "a"
  | "b"
  | "start"
  | "select";

interface BinjgbModule {
  HEAP8: Int8Array;
  _malloc(size: number): number;
  _free(pointer: number): void;
  _emulator_new_simple(
    romPointer: number,
    romSize: number,
    audioFrequency: number,
    audioFrames: number,
  ): number;
  _emulator_delete(emulator: number): void;
  _emulator_get_ticks_f64(emulator: number): number;
  _emulator_run_until_f64(emulator: number, ticks: number): number;
  _get_frame_buffer_ptr(emulator: number): number;
  _get_frame_buffer_size(emulator: number): number;
  _joypad_new(): number;
  _joypad_delete(joypad: number): void;
  _emulator_set_default_joypad_callback(emulator: number, joypad: number): void;
  _set_joyp_up(emulator: number, pressed: boolean): void;
  _set_joyp_down(emulator: number, pressed: boolean): void;
  _set_joyp_left(emulator: number, pressed: boolean): void;
  _set_joyp_right(emulator: number, pressed: boolean): void;
  _set_joyp_A(emulator: number, pressed: boolean): void;
  _set_joyp_B(emulator: number, pressed: boolean): void;
  _set_joyp_start(emulator: number, pressed: boolean): void;
  _set_joyp_select(emulator: number, pressed: boolean): void;
}

type BinjgbFactory = (options?: {
  locateFile?: (path: string) => string;
}) => Promise<BinjgbModule>;

type BinjgbWindow = Window & {
  Binjgb?: BinjgbFactory;
};

let scriptPromise: Promise<void> | null = null;
let modulePromise: Promise<BinjgbModule> | null = null;

function emulatorAssetBase(): string {
  return `${import.meta.env.BASE_URL}wasm-tools/binjgb/${BINJGB_VERSION}/`;
}

function loadClassicScript(): Promise<void> {
  if ((window as BinjgbWindow).Binjgb) {
    return Promise.resolve();
  }
  if (scriptPromise) {
    return scriptPromise;
  }

  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${emulatorAssetBase()}binjgb.js`;
    script.async = true;
    script.dataset.yellowEditorBinjgb = BINJGB_VERSION;
    script.addEventListener("load", () => {
      if ((window as BinjgbWindow).Binjgb) {
        resolve();
      } else {
        reject(new Error("binjgb loaded without exposing its module factory."));
      }
    });
    script.addEventListener("error", () => {
      scriptPromise = null;
      reject(
        new Error(
          "Could not load the integrated emulator. Refresh the app and try again.",
        ),
      );
    });
    document.head.append(script);
  });

  return scriptPromise;
}

export function loadBinjgbModule(): Promise<BinjgbModule> {
  if (modulePromise) {
    return modulePromise;
  }

  modulePromise = (async () => {
    await loadClassicScript();
    const factory = (window as BinjgbWindow).Binjgb;
    if (!factory) {
      throw new Error("The binjgb module factory is unavailable.");
    }
    const base = emulatorAssetBase();
    return factory({
      locateFile: (fileName) => `${base}${fileName}`,
    });
  })().catch((error) => {
    modulePromise = null;
    throw error;
  });

  return modulePromise;
}

function validateRom(rom: Uint8Array): void {
  if (rom.byteLength < 32 * 1024) {
    throw new Error("The generated ROM is too small to be a Game Boy ROM.");
  }
  if (rom.byteLength > MAX_ROM_BYTES) {
    throw new Error(
      `The generated ROM is larger than Yellow Editor's ${MAX_ROM_BYTES / 1024 / 1024} MiB emulator safety limit.`,
    );
  }
}

export class BinjgbEmulator {
  private readonly module: BinjgbModule;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly imageData: ImageData;
  private readonly romPointer: number;
  private readonly emulator: number;
  private readonly joypad: number;
  private readonly frameBuffer: Uint8Array;
  private animationFrame: number | null = null;
  private lastFrameMs = 0;
  private leftoverTicks = 0;
  private speed = 1;
  private running = false;
  private destroyed = false;

  constructor(module: BinjgbModule, rom: Uint8Array, canvas: HTMLCanvasElement) {
    validateRom(rom);
    this.module = module;
    this.canvas = canvas;
    this.canvas.width = SCREEN_WIDTH;
    this.canvas.height = SCREEN_HEIGHT;

    const context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      throw new Error("This browser could not create a 2D canvas for the emulator.");
    }
    context.imageSmoothingEnabled = false;
    this.context = context;
    this.imageData = context.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);

    this.romPointer = module._malloc(rom.byteLength);
    if (!this.romPointer) {
      throw new Error("The emulator could not allocate memory for the generated ROM.");
    }

    new Uint8Array(module.HEAP8.buffer, this.romPointer, rom.byteLength).set(rom);
    this.emulator = module._emulator_new_simple(
      this.romPointer,
      rom.byteLength,
      AUDIO_SAMPLE_RATE,
      AUDIO_FRAMES,
    );
    if (!this.emulator) {
      module._free(this.romPointer);
      throw new Error("binjgb rejected the generated ROM as invalid.");
    }

    this.joypad = module._joypad_new();
    if (!this.joypad) {
      module._emulator_delete(this.emulator);
      module._free(this.romPointer);
      throw new Error("The emulator could not allocate its input buffer.");
    }
    module._emulator_set_default_joypad_callback(this.emulator, this.joypad);

    const framePointer = module._get_frame_buffer_ptr(this.emulator);
    const frameSize = module._get_frame_buffer_size(this.emulator);
    if (frameSize !== SCREEN_WIDTH * SCREEN_HEIGHT * 4) {
      this.destroy();
      throw new Error(`Unexpected binjgb frame buffer size: ${frameSize} bytes.`);
    }
    this.frameBuffer = new Uint8Array(module.HEAP8.buffer, framePointer, frameSize);
    this.releaseAllButtons();
    this.context.fillStyle = "black";
    this.context.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
  }

  get isRunning(): boolean {
    return this.running;
  }

  get speedMultiplier(): number {
    return this.speed;
  }

  setSpeed(multiplier: number): void {
    if (!Number.isFinite(multiplier) || multiplier < 0.25 || multiplier > 4) {
      throw new Error("Emulation speed must be between 0.25× and 4×.");
    }
    this.speed = multiplier;
    this.lastFrameMs = 0;
    this.leftoverTicks = 0;
  }

  start(): void {
    if (this.destroyed || this.running) {
      return;
    }
    this.running = true;
    this.lastFrameMs = 0;
    this.animationFrame = requestAnimationFrame(this.onAnimationFrame);
  }

  pause(): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    this.lastFrameMs = 0;
    this.leftoverTicks = 0;
    this.releaseAllButtons();
  }

  resume(): void {
    this.start();
  }

  setButton(button: EmulatorButton, pressed: boolean): void {
    if (this.destroyed) {
      return;
    }

    switch (button) {
      case "up":
        this.module._set_joyp_up(this.emulator, pressed);
        break;
      case "down":
        this.module._set_joyp_down(this.emulator, pressed);
        break;
      case "left":
        this.module._set_joyp_left(this.emulator, pressed);
        break;
      case "right":
        this.module._set_joyp_right(this.emulator, pressed);
        break;
      case "a":
        this.module._set_joyp_A(this.emulator, pressed);
        break;
      case "b":
        this.module._set_joyp_B(this.emulator, pressed);
        break;
      case "start":
        this.module._set_joyp_start(this.emulator, pressed);
        break;
      case "select":
        this.module._set_joyp_select(this.emulator, pressed);
        break;
    }
  }

  releaseAllButtons(): void {
    const buttons: EmulatorButton[] = [
      "up",
      "down",
      "left",
      "right",
      "a",
      "b",
      "start",
      "select",
    ];
    for (const button of buttons) {
      this.setButton(button, false);
    }
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.pause();
    this.destroyed = true;
    if (this.joypad) {
      this.module._joypad_delete(this.joypad);
    }
    if (this.emulator) {
      this.module._emulator_delete(this.emulator);
    }
    if (this.romPointer) {
      this.module._free(this.romPointer);
    }
  }

  private readonly onAnimationFrame = (frameMs: number) => {
    if (!this.running || this.destroyed) {
      return;
    }
    this.animationFrame = requestAnimationFrame(this.onAnimationFrame);

    const frameSec = frameMs / 1000;
    const lastFrameSec = this.lastFrameMs / 1000;
    const deltaSec = this.lastFrameMs
      ? Math.max(0, frameSec - lastFrameSec)
      : 0;
    this.lastFrameMs = frameMs;

    if (deltaSec === 0) {
      return;
    }

    const deltaTicks =
      Math.min(deltaSec, MAX_UPDATE_SEC) * CPU_TICKS_PER_SECOND * this.speed;
    const runUntilTicks =
      this.module._emulator_get_ticks_f64(this.emulator) +
      deltaTicks -
      this.leftoverTicks;
    this.runUntil(runUntilTicks);
    this.leftoverTicks =
      (this.module._emulator_get_ticks_f64(this.emulator) - runUntilTicks) | 0;
  };

  private runUntil(ticks: number): void {
    let frameReady = false;
    while (true) {
      const event = this.module._emulator_run_until_f64(this.emulator, ticks);
      if (event & EVENT_NEW_FRAME) {
        frameReady = true;
      }
      if (event & EVENT_UNTIL_TICKS) {
        break;
      }
    }

    if (frameReady) {
      this.imageData.data.set(this.frameBuffer);
      this.context.putImageData(this.imageData, 0, 0);
    }
  }
}
