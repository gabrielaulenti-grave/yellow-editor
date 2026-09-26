import { useEffect, useRef, useState } from "react";
import type {
  PokemonPaletteOption,
  TrainerPresentation,
} from "./core/types";
import { convertFileSrc, invoke } from "./platform/compat";

type Palette = [string, string, string, string];

const PALETTE_PRESETS: { name: string; colors: Palette }[] = [
  { name: "Grayscale", colors: ["#ffffff", "#aaaaaa", "#555555", "#000000"] },
  { name: "DMG Green", colors: ["#e0f8cf", "#86c06c", "#306850", "#071821"] },
];

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
}: {
  classConstant: string;
  partyNumber: number;
  displayName: string;
}) {
  const [presentation, setPresentation] = useState<TrainerPresentation | null>(null);
  const [palette, setPalette] = useState<Palette>(PALETTE_PRESETS[0].colors);
  const [selection, setSelection] = useState("preset:Grayscale");
  const [error, setError] = useState<string | null>(null);

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

    void loadPresentation();
    return () => {
      cancelled = true;
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

  return (
    <section className="editor-card sprite-card trainer-sprite-card">
      <div className="section-heading">
        <div>
          <h4>Trainer sprite</h4>
          <p>
            Preview the battle portrait using the sprite and battle palette defined
            by the loaded project.
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
              src={presentation?.spritePath ?? null}
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

          {presentation?.picLabel && (
            <p className="help-text">
              Sprite: <code>{presentation.picLabel}</code>
              {presentation.spriteSourcePath ? <> · <code>{presentation.spriteSourcePath}</code></> : null}
            </p>
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
