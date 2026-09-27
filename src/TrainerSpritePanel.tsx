import { useEffect, useRef, useState } from "react";
import type {
  HistorySummary,
  PokemonPaletteOption,
  TrainerCatalog,
  TrainerPresentation,
} from "./core/types";
import { convertFileSrc, invoke } from "./platform/compat";

type Palette = [string, string, string, string];

const PALETTE_PRESETS: { name: string; colors: Palette }[] = [
  { name: "Grayscale", colors: ["#ffffff", "#aaaaaa", "#555555", "#000000"] },
  { name: "DMG Green", colors: ["#e0f8cf", "#86c06c", "#306850", "#071821"] },
];

function displayPicLabel(value: string): string {
  return value
    .replace(/Pic$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2");
}

function hexToRgb(hex: string) {
  const value = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(value)) {
    return { r: 0, g: 0, b: 0 };
  }

  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

function TrainerSpritePreview({
  src,
  alt,
  palette,
}: {
  src: string | null;
  alt: string;
  palette: Palette;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    setFallback(false);
    if (!src || !canvasRef.current) return;

    let cancelled = false;
    const image = new Image();
    const resolvedSrc = convertFileSrc(src);

    image.onload = () => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;

      try {
        canvas.width = image.naturalWidth || image.width;
        canvas.height = image.naturalHeight || image.height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) {
          setFallback(true);
          return;
        }

        context.imageSmoothingEnabled = false;
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0);

        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        const colors = palette.map(hexToRgb);

        for (let offset = 0; offset < imageData.data.length; offset += 4) {
          if (imageData.data[offset + 3] === 0) continue;

          const luminance =
            imageData.data[offset] * 0.2126 +
            imageData.data[offset + 1] * 0.7152 +
            imageData.data[offset + 2] * 0.0722;
          const shade = Math.max(0, Math.min(3, Math.round((255 - luminance) / 85)));
          const color = colors[shade];
          imageData.data[offset] = color.r;
          imageData.data[offset + 1] = color.g;
          imageData.data[offset + 2] = color.b;
        }

        context.putImageData(imageData, 0, 0);
      } catch {
        setFallback(true);
      }
    };

    image.onerror = () => {
      if (!cancelled) setFallback(true);
    };
    image.src = resolvedSrc;

    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [src, palette]);

  if (!src) return <div className="sprite-empty">No trainer sprite source found.</div>;
  if (fallback) {
    return <img className="pokemon-sprite" src={convertFileSrc(src)} alt={alt} />;
  }
  return <canvas ref={canvasRef} className="pokemon-sprite" aria-label={alt} />;
}

export function TrainerSpritePanel({
  classConstant,
  partyNumber,
  displayName,
  portraitMode = "effective",
  onlyWhenOverride = false,
  allowOverrideEditing = false,
}: {
  classConstant: string;
  partyNumber: number;
  displayName: string;
  portraitMode?: "base" | "effective";
  onlyWhenOverride?: boolean;
  allowOverrideEditing?: boolean;
}) {
  const [presentation, setPresentation] = useState<TrainerPresentation | null>(null);
  const [palette, setPalette] = useState<Palette>(PALETTE_PRESETS[0].colors);
  const [selection, setSelection] = useState("preset:Grayscale");
  const [error, setError] = useState<string | null>(null);
  const [overrideEditing, setOverrideEditing] = useState(false);
  const [overrideDraft, setOverrideDraft] = useState("");
  const [overrideBusy, setOverrideBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadPresentation() {
      try {
        const next = await invoke<TrainerPresentation>("get_trainer_presentation", {
          classConstant,
          partyNumber,
        });
        if (cancelled) return;

        setPresentation(next);
        setOverrideDraft(
          next.editorPicLabel
            ?? next.picLabel
            ?? next.basePicLabel
            ?? next.availablePicLabels[0]
            ?? "",
        );
        setError(null);
        const preferred =
          next.paletteOptions.find((option) => option.source === "cgb")
          ?? next.paletteOptions[0];

        if (preferred) {
          setPalette([...preferred.colors] as Palette);
          setSelection(`game:${preferred.source}`);
        } else {
          setPalette([...PALETTE_PRESETS[0].colors] as Palette);
          setSelection("preset:Grayscale");
        }
      } catch (loadError) {
        if (!cancelled) {
          setPresentation(null);
          setPalette([...PALETTE_PRESETS[0].colors] as Palette);
          setSelection("preset:Grayscale");
          setError(String(loadError));
        }
      }
    }

    function handleHistoryChanged() {
      void loadPresentation();
    }

    setOverrideEditing(false);
    void loadPresentation();
    window.addEventListener("yellow-editor:history-changed", handleHistoryChanged);
    return () => {
      cancelled = true;
      window.removeEventListener("yellow-editor:history-changed", handleHistoryChanged);
    };
  }, [classConstant, partyNumber]);

  function applyGamePalette(option: PokemonPaletteOption) {
    setPalette([...option.colors] as Palette);
    setSelection(`game:${option.source}`);
  }

  function applyPreset(name: string, colors: Palette) {
    setPalette([...colors] as Palette);
    setSelection(`preset:${name}`);
  }

  function updatePaletteColor(index: number, color: string) {
    setPalette((current) => {
      const next = [...current] as Palette;
      next[index] = color;
      return next;
    });
    setSelection("custom");
  }

  async function saveOverride(picLabel: string | null) {
    setOverrideBusy(true);
    setError(null);
    try {
      const history = await invoke<HistorySummary>("save_trainer_pic_override", {
        classConstant,
        partyNumber,
        picLabel,
      });
      const [next, catalog] = await Promise.all([
        invoke<TrainerPresentation>("get_trainer_presentation", {
          classConstant,
          partyNumber,
        }),
        invoke<TrainerCatalog>("get_trainer_base_catalog"),
      ]);
      setPresentation(next);
      setOverrideDraft(
        next.editorPicLabel
          ?? next.picLabel
          ?? next.basePicLabel
          ?? next.availablePicLabels[0]
          ?? "",
      );
      setOverrideEditing(false);
      window.dispatchEvent(new CustomEvent("yellow-editor:trainer-edit-sources-changed", {
        detail: catalog.editSources,
      }));
      window.dispatchEvent(new CustomEvent("yellow-editor:history-changed", { detail: history }));
    } catch (saveError) {
      setError(String(saveError));
    } finally {
      setOverrideBusy(false);
    }
  }

  const hasOverride = Boolean(
    presentation?.editorPicLabel || presentation?.legacyPicLabel,
  );

  if (onlyWhenOverride && !hasOverride && !allowOverrideEditing) {
    return null;
  }

  if (
    allowOverrideEditing
    && presentation
    && !hasOverride
    && !overrideEditing
  ) {
    return (
      <section className="editor-card trainer-sprite-compact-card">
        <div className="section-heading">
          <div>
            <h4>Battle portrait</h4>
            <p>
              Uses the class portrait
              {presentation.basePicLabel ? <> <code>{presentation.basePicLabel}</code></> : null}.
            </p>
          </div>
          <button
            type="button"
            className="small-button"
            disabled={overrideBusy || presentation.availablePicLabels.length === 0}
            onClick={() => setOverrideEditing(true)}
          >
            Add sprite override
          </button>
        </div>
        {error && <p className="help-text">Trainer sprite edit error: {error}</p>}
      </section>
    );
  }

  const activePicLabel = portraitMode === "base"
    ? presentation?.basePicLabel ?? null
    : presentation?.picLabel ?? null;
  const activeSpritePath = portraitMode === "base"
    ? presentation?.baseSpritePath ?? null
    : presentation?.spritePath ?? null;
  const activeSpriteSourcePath = portraitMode === "base"
    ? presentation?.baseSpriteSourcePath ?? null
    : presentation?.spriteSourcePath ?? null;
  const overrideCard = (onlyWhenOverride || allowOverrideEditing) && hasOverride;
  const underlyingPicLabel = presentation?.legacyPicLabel ?? presentation?.basePicLabel ?? null;
  const overrideUnchanged = presentation?.editorPicLabel
    ? overrideDraft === presentation.editorPicLabel
    : overrideDraft === underlyingPicLabel;

  return (
    <section className="editor-card sprite-card trainer-sprite-card">
      <div className="section-heading">
        <div>
          <h4>{overrideCard ? "Sprite override" : "Trainer sprite"}</h4>
          <p>
            {overrideCard
              ? "This party uses a different battle portrait from its trainer class."
              : "Preview the battle portrait using the sprite and battle palette defined by the loaded project."}
          </p>
        </div>
        <div className="palette-presets">
          {presentation?.paletteOptions.map((option) => (
            <button
              key={option.source}
              type="button"
              className={selection === `game:${option.source}` ? "small-button active" : "small-button"}
              onClick={() => applyGamePalette(option)}
            >
              {option.label}
            </button>
          ))}
          {PALETTE_PRESETS.map((preset) => (
            <button
              key={preset.name}
              type="button"
              className={selection === `preset:${preset.name}` ? "small-button active" : "small-button"}
              onClick={() => applyPreset(preset.name, preset.colors)}
            >
              {preset.name}
            </button>
          ))}
        </div>
      </div>

      <div className="sprite-layout trainer-sprite-layout">
        <div className="sprite-preview-grid trainer-sprite-preview-grid">
          <figure>
            <TrainerSpritePreview
              src={activeSpritePath}
              alt={`${displayName} trainer battle sprite`}
              palette={palette}
            />
            <figcaption>Battle portrait</figcaption>
          </figure>
        </div>

        <div className="palette-editor">
          <span className="field-label">Palette</span>
          {presentation?.paletteConstant ? (
            <p className="help-text">
              Game battle mapping: <code>{presentation.paletteConstant}</code>
            </p>
          ) : (
            <p className="help-text">No trainer battle palette mapping was found.</p>
          )}

          {palette.map((color, index) => (
            <label key={index} className="palette-row">
              <span>Shade {index + 1}</span>
              <input
                type="color"
                value={color}
                onChange={(event) => updatePaletteColor(index, event.target.value)}
              />
              <code>{color.toUpperCase()}</code>
            </label>
          ))}

          {activePicLabel && (
            <p className="help-text">
              Sprite: <code>{activePicLabel}</code>
              {activeSpriteSourcePath ? <> · <code>{activeSpriteSourcePath}</code></> : null}
            </p>
          )}
          {portraitMode === "effective" && hasOverride && (
            <p className="help-text">
              Class portrait: <code>{presentation?.basePicLabel ?? "Unknown"}</code>
              {" → "}
              Party portrait: <code>{presentation?.picLabel ?? "Unknown"}</code>
              {presentation?.picOverrideSourceKind === "editor-table"
                ? <> · Yellow Editor override</>
                : presentation?.picOverrideSourceKind === "legacy-engine"
                  ? <> · Engine override</>
                  : null}
              {presentation?.picOverrideSourcePath
                ? <> · <code>{presentation.picOverrideSourcePath}</code></>
                : null}
            </p>
          )}
          {portraitMode === "effective" && presentation?.editorPicLabel && presentation.legacyPicLabel && (
            <p className="help-text">
              Underlying engine override: <code>{presentation.legacyPicLabel}</code>.
              Removing the Yellow Editor override will restore it.
            </p>
          )}
          {allowOverrideEditing && presentation && (
            <div className="trainer-sprite-override-editor">
              {overrideEditing ? (
                <>
                  <label className="editor-field">
                    <span>Party portrait override</span>
                    <select
                      value={overrideDraft}
                      disabled={overrideBusy}
                      onChange={(event) => setOverrideDraft(event.target.value)}
                    >
                      {presentation.availablePicLabels.map((picLabel) => (
                        <option key={picLabel} value={picLabel}>
                          {displayPicLabel(picLabel)} — {picLabel}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="help-text">
                    This exact override applies only to {displayName}. Existing engine behavior remains underneath it.
                  </p>
                  <div className="trainer-sprite-override-actions">
                    <button
                      type="button"
                      className="small-button"
                      disabled={overrideBusy || !overrideDraft || overrideUnchanged}
                      onClick={() => void saveOverride(overrideDraft)}
                    >
                      Save override
                    </button>
                    <button
                      type="button"
                      className="small-button"
                      disabled={overrideBusy}
                      onClick={() => {
                        setOverrideDraft(
                          presentation.editorPicLabel
                            ?? presentation.picLabel
                            ?? presentation.basePicLabel
                            ?? "",
                        );
                        setOverrideEditing(false);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : presentation.editorPicLabel ? (
                <div className="trainer-sprite-override-actions">
                  <button
                    type="button"
                    className="small-button"
                    disabled={overrideBusy}
                    onClick={() => setOverrideEditing(true)}
                  >
                    Change override
                  </button>
                  <button
                    type="button"
                    className="small-button danger-action"
                    disabled={overrideBusy}
                    onClick={() => void saveOverride(null)}
                  >
                    Remove override
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="small-button"
                  disabled={overrideBusy || presentation.availablePicLabels.length === 0}
                  onClick={() => setOverrideEditing(true)}
                >
                  Add Yellow Editor override
                </button>
              )}
            </div>
          )}
          {error && <p className="help-text">Trainer sprite read error: {error}</p>}
          <p className="help-text">
            Sprite and game palettes are read from the project. Custom color changes
            here are preview-only.
          </p>
        </div>
      </div>
    </section>
  );
}
