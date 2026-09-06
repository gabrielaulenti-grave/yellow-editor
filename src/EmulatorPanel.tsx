import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type {
  BuildArtifact,
  BuildTarget,
  ProjectInfo,
  SaveCompatibilityDescriptor,
} from "./core/types";
import {
  BinjgbEmulator,
  BINJGB_VERSION,
  loadBinjgbModule,
  type EmulatorButton,
} from "./core/binjgb";
import { invoke } from "./platform/compat";
import {
  loadBatterySave,
  requestPersistentEmulatorStorage,
  saveBatteryRam,
  type BatterySaveCompatibility,
} from "./platform/emulatorSaveStore";
import "./EmulatorPanel.css";

const SPEED_OPTIONS = [0.5, 1, 2, 4] as const;
const BATTERY_POLL_MS = 1000;

const KEY_BUTTONS: Record<string, EmulatorButton> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  KeyX: "a",
  KeyZ: "b",
  Enter: "start",
  Tab: "select",
};

interface SaveContext {
  projectStorageKey: string;
  target: BuildTarget;
  compatibility: SaveCompatibilityDescriptor;
}

function targetFromRom(rom: BuildArtifact): BuildTarget {
  const name = rom.fileName.toLowerCase();
  if (name.includes("yellow")) {
    return "yellow";
  }
  if (name.includes("red")) {
    return "red";
  }
  if (name.includes("blue")) {
    return "blue";
  }
  throw new Error(`Could not determine the build target from ${rom.fileName}.`);
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

function formatSaveTime(value: string): string {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function incompatibleSaveMessage(status: BatterySaveCompatibility): string {
  switch (status) {
    case "event-schema-changed":
      return "A previous battery save belongs to a different event-flag schema. It has been preserved but was not loaded; this build starts with fresh save RAM until migration support is added.";
    case "structure-changed":
      return "A previous battery save belongs to a different saved-memory layout. It has been preserved but was not loaded; this build starts with fresh save RAM.";
    case "epoch-changed":
      return "A previous battery save belongs to an older Yellow Editor save-compatibility epoch. It has been preserved but was not loaded.";
    case "compatible":
      return "A compatible battery save is available.";
  }
}

export function EmulatorPanel({ rom }: { rom: BuildArtifact }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const emulatorRef = useRef<BinjgbEmulator | null>(null);
  const saveContextRef = useRef<SaveContext | null>(null);
  const loadTokenRef = useRef(0);
  const saveInFlightRef = useRef<Promise<void> | null>(null);
  const [status, setStatus] = useState("Ready to test the generated ROM.");
  const [saveStatus, setSaveStatus] = useState("Battery save RAM will persist in this browser after launch.");
  const [loading, setLoading] = useState(false);
  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [error, setError] = useState<string | null>(null);

  function queueBatterySave(emulator = emulatorRef.current, message = true): Promise<void> {
    const context = saveContextRef.current;
    if (!emulator || !context) {
      return Promise.resolve();
    }

    let ram: Uint8Array;
    try {
      ram = emulator.getBatteryRam();
    } catch (saveError) {
      setSaveStatus(`Could not read battery RAM: ${String(saveError)}`);
      return Promise.resolve();
    }

    const previous = saveInFlightRef.current ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const updatedAt = await saveBatteryRam(
          context.projectStorageKey,
          context.target,
          context.compatibility,
          ram,
        );
        if (message) {
          setSaveStatus(`Battery save stored locally · ${formatSaveTime(updatedAt)}`);
        }
      })
      .catch((saveError) => {
        setSaveStatus(`Could not persist battery save: ${String(saveError)}`);
      })
      .finally(() => {
        if (saveInFlightRef.current === next) {
          saveInFlightRef.current = null;
        }
      });
    saveInFlightRef.current = next;
    return next;
  }

  useEffect(() => {
    loadTokenRef.current += 1;
    const previous = emulatorRef.current;
    if (previous) {
      void queueBatterySave(previous, false);
      previous.destroy();
    }
    emulatorRef.current = null;
    saveContextRef.current = null;
    setStarted(false);
    setPaused(false);
    setLoading(false);
    setError(null);
    setStatus("Ready to test the generated ROM.");
    setSaveStatus("Battery save RAM will persist in this browser after launch.");

    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas && context) {
      canvas.width = 160;
      canvas.height = 144;
      context.fillStyle = "black";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }

    return () => {
      loadTokenRef.current += 1;
      const emulator = emulatorRef.current;
      if (emulator) {
        void queueBatterySave(emulator, false);
        emulator.destroy();
      }
      emulatorRef.current = null;
      saveContextRef.current = null;
    };
  }, [rom]);

  useEffect(() => {
    if (!started) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) {
        return;
      }
      const button = KEY_BUTTONS[event.code];
      if (!button) {
        return;
      }
      emulatorRef.current?.setButton(button, true);
      event.preventDefault();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const button = KEY_BUTTONS[event.code];
      if (!button) {
        return;
      }
      emulatorRef.current?.setButton(button, false);
      event.preventDefault();
    };

    const releaseButtons = () => emulatorRef.current?.releaseAllButtons();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", releaseButtons);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", releaseButtons);
      releaseButtons();
    };
  }, [started]);

  useEffect(() => {
    if (!started) {
      return;
    }

    const poll = window.setInterval(() => {
      const emulator = emulatorRef.current;
      if (emulator?.consumeBatteryRamUpdated()) {
        void queueBatterySave(emulator);
      }
    }, BATTERY_POLL_MS);

    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") {
        void queueBatterySave(emulatorRef.current, false);
      }
    };
    const flushOnPageHide = () => {
      void queueBatterySave(emulatorRef.current, false);
    };

    document.addEventListener("visibilitychange", flushWhenHidden);
    window.addEventListener("pagehide", flushOnPageHide);
    return () => {
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", flushWhenHidden);
      window.removeEventListener("pagehide", flushOnPageHide);
    };
  }, [started]);

  async function launch() {
    const canvas = canvasRef.current;
    if (!canvas || loading) {
      return;
    }

    const token = ++loadTokenRef.current;
    setLoading(true);
    setError(null);
    setStatus("Loading binjgb…");
    setSaveStatus("Checking persistent battery save storage…");

    try {
      const target = targetFromRom(rom);
      const project = await invoke<ProjectInfo>("open_project");
      const [module, compatibility, persistence] = await Promise.all([
        loadBinjgbModule(),
        invoke<SaveCompatibilityDescriptor>("get_save_compatibility", { target }),
        requestPersistentEmulatorStorage(),
      ]);
      const lookup = await loadBatterySave(project.storageKey, target, compatibility);

      if (token !== loadTokenRef.current || !canvasRef.current) {
        return;
      }

      saveContextRef.current = {
        projectStorageKey: project.storageKey,
        target,
        compatibility,
      };

      emulatorRef.current?.destroy();
      const emulator = new BinjgbEmulator(
        module,
        new Uint8Array(rom.bytes),
        canvasRef.current,
      );

      if (lookup.ram) {
        if (!emulator.loadBatteryRam(lookup.ram)) {
          emulator.destroy();
          throw new Error(
            `Stored battery RAM is ${lookup.ram.byteLength} bytes, but this ROM expects a different size. The stored save was not modified.`,
          );
        }
        setSaveStatus(
          `Loaded compatible battery save from ${lookup.previousUpdatedAt ? formatSaveTime(lookup.previousUpdatedAt) : "local storage"}.${persistence === false ? " Browser storage is not guaranteed persistent by the device." : ""}`,
        );
      } else if (lookup.compatibility) {
        setSaveStatus(
          `${incompatibleSaveMessage(lookup.compatibility)}${persistence === false ? " Browser storage is not guaranteed persistent by the device." : ""}`,
        );
      } else {
        setSaveStatus(
          `No previous battery save for this compatible build. A save will be created automatically when SRAM changes.${persistence === false ? " Browser storage is not guaranteed persistent by the device." : ""}`,
        );
      }

      emulator.setSpeed(speed);
      emulator.start();
      emulatorRef.current = emulator;
      setStarted(true);
      setPaused(false);
      setStatus(`Running ${rom.fileName} in binjgb ${BINJGB_VERSION}.`);
    } catch (launchError) {
      const message = launchError instanceof Error ? launchError.message : String(launchError);
      setError(message);
      setStatus("Could not start the integrated emulator.");
      emulatorRef.current?.destroy();
      emulatorRef.current = null;
      saveContextRef.current = null;
      setStarted(false);
      setPaused(false);
    } finally {
      if (token === loadTokenRef.current) {
        setLoading(false);
      }
    }
  }

  async function togglePause() {
    const emulator = emulatorRef.current;
    if (!emulator) {
      return;
    }
    if (paused) {
      emulator.resume();
      setPaused(false);
      setStatus(`Running ${rom.fileName} at ${speed}× speed.`);
    } else {
      await queueBatterySave(emulator);
      emulator.pause();
      setPaused(true);
      setStatus("Emulation paused.");
    }
  }

  function updateSpeed(nextSpeed: number) {
    setSpeed(nextSpeed);
    emulatorRef.current?.setSpeed(nextSpeed);
    if (started && !paused) {
      setStatus(`Running ${rom.fileName} at ${nextSpeed}× speed.`);
    }
  }

  async function reset() {
    const emulator = emulatorRef.current;
    if (emulator) {
      await queueBatterySave(emulator);
      emulator.destroy();
      emulatorRef.current = null;
    }
    setStarted(false);
    setPaused(false);
    await launch();
  }

  function setPointerButton(
    button: EmulatorButton,
    pressed: boolean,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    if (pressed) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    emulatorRef.current?.setButton(button, pressed);
    event.preventDefault();
  }

  function controllerButton(
    button: EmulatorButton,
    label: string,
    className = "",
  ) {
    return (
      <button
        type="button"
        className={`emulator-button ${className}`.trim()}
        disabled={!started || loading}
        aria-label={label}
        onPointerDown={(event) => setPointerButton(button, true, event)}
        onPointerUp={(event) => setPointerButton(button, false, event)}
        onPointerCancel={(event) => setPointerButton(button, false, event)}
        onContextMenu={(event) => event.preventDefault()}
      >
        {label}
      </button>
    );
  }

  return (
    <section className="emulator-panel" aria-label="Generated ROM emulator">
      <div className="emulator-heading">
        <div>
          <h3>Test generated ROM</h3>
          <p>
            The ROM is passed directly from the completed build into a local WebAssembly
            emulator. Battery-backed save RAM is stored locally and is only reused when
            the project's saved-memory and event schemas are compatible.
          </p>
        </div>
        <div className="emulator-toolbar">
          <label>
            Speed
            <select
              value={speed}
              disabled={loading}
              onChange={(event) => updateSpeed(Number(event.target.value))}
            >
              {SPEED_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}×
                </option>
              ))}
            </select>
          </label>

          {!started ? (
            <button
              type="button"
              className="primary-action"
              disabled={loading}
              onClick={() => void launch()}
            >
              {loading ? "Loading emulator…" : "Launch ROM"}
            </button>
          ) : (
            <>
              <button type="button" onClick={() => void togglePause()}>
                {paused ? "Resume" : "Pause"}
              </button>
              <button type="button" disabled={loading} onClick={() => void reset()}>
                Reset
              </button>
            </>
          )}
        </div>
      </div>

      <div className="emulator-stage">
        <div className="emulator-screen-frame">
          <canvas
            ref={canvasRef}
            className="emulator-screen"
            width={160}
            height={144}
            aria-label="Game Boy screen"
          />
        </div>

        <div className="emulator-controller" aria-label="Game Boy controls">
          <div className="emulator-dpad" aria-label="Directional pad">
            {controllerButton("up", "▲", "dpad-up")}
            {controllerButton("left", "◀", "dpad-left")}
            {controllerButton("right", "▶", "dpad-right")}
            {controllerButton("down", "▼", "dpad-down")}
          </div>

          <div className="emulator-center-buttons">
            {controllerButton("select", "Select", "system-button")}
            {controllerButton("start", "Start", "system-button")}
          </div>

          <div className="emulator-action-buttons">
            {controllerButton("b", "B", "round-button b-button")}
            {controllerButton("a", "A", "round-button a-button")}
          </div>
        </div>
      </div>

      <p className="emulator-status" role="status">{status}</p>
      <p className="emulator-save-status" role="status">{saveStatus}</p>
      {error && <p className="emulator-error" role="alert">{error}</p>}
      <p className="emulator-hint">
        Keyboard: arrows move, X = A, Z = B, Enter = Start, Tab = Select. Battery RAM is
        autosaved locally; incompatible older save revisions are retained rather than overwritten.
      </p>
    </section>
  );
}
