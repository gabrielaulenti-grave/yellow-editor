import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { BuildArtifact } from "./core/types";
import {
  BinjgbEmulator,
  BINJGB_VERSION,
  loadBinjgbModule,
  type EmulatorButton,
} from "./core/binjgb";
import "./EmulatorPanel.css";

const SPEED_OPTIONS = [0.5, 1, 2, 4] as const;

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

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

export function EmulatorPanel({ rom }: { rom: BuildArtifact }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const emulatorRef = useRef<BinjgbEmulator | null>(null);
  const loadTokenRef = useRef(0);
  const [status, setStatus] = useState("Ready to test the generated ROM.");
  const [loading, setLoading] = useState(false);
  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadTokenRef.current += 1;
    emulatorRef.current?.destroy();
    emulatorRef.current = null;
    setStarted(false);
    setPaused(false);
    setLoading(false);
    setError(null);
    setStatus("Ready to test the generated ROM.");

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
      emulatorRef.current?.destroy();
      emulatorRef.current = null;
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

  async function launch() {
    const canvas = canvasRef.current;
    if (!canvas || loading) {
      return;
    }

    const token = ++loadTokenRef.current;
    setLoading(true);
    setError(null);
    setStatus("Loading binjgb…");

    try {
      const module = await loadBinjgbModule();
      if (token !== loadTokenRef.current || !canvasRef.current) {
        return;
      }

      emulatorRef.current?.destroy();
      const emulator = new BinjgbEmulator(
        module,
        new Uint8Array(rom.bytes),
        canvasRef.current,
      );
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
      setStarted(false);
      setPaused(false);
    } finally {
      if (token === loadTokenRef.current) {
        setLoading(false);
      }
    }
  }

  function togglePause() {
    const emulator = emulatorRef.current;
    if (!emulator) {
      return;
    }
    if (paused) {
      emulator.resume();
      setPaused(false);
      setStatus(`Running ${rom.fileName} at ${speed}× speed.`);
    } else {
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
    emulatorRef.current?.destroy();
    emulatorRef.current = null;
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
            emulator. It is not uploaded to a server and does not need to be downloaded first.
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
              <button type="button" onClick={togglePause}>
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
      {error && <p className="emulator-error" role="alert">{error}</p>}
      <p className="emulator-hint">
        Keyboard: arrows move, X = A, Z = B, Enter = Start, Tab = Select. Audio and save-RAM
        persistence are not enabled in this first integration pass.
      </p>
    </section>
  );
}
