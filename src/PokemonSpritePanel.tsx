import { useEffect, useRef, useState } from "react";
import { convertFileSrc, invoke } from "./platform/compat";

interface PokemonPaletteOption {
  source: "cgb" | "sgb";
  label: string;
  colors: [string, string, string, string];
}

interface PokemonPaletteData {
  constant: string;
  dexNumber: number;
  options: PokemonPaletteOption[];
}

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

function SpritePreview({
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

    if (!src || !canvasRef.current) {
      return;
    }

    const image = new Image();
    image.src = convertFileSrc(src);

    image.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }

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

        for (let i = 0; i < imageData.data.length; i += 4) {
          if (imageData.data[i + 3] === 0) {
            continue;
          }

          const luminance =
            imageData.data[i] * 0.2126 +
            imageData.data[i + 1] * 0.7152 +
            imageData.data[i + 2] * 0.0722;
          const shade = Math.max(0, Math.min(3, Math.round((255 - luminance) / 85)));
          const color = colors[shade];

          imageData.data[i] = color.r;
          imageData.data[i + 1] = color.g;
          imageData.data[i + 2] = color.b;
        }

        context.putImageData(imageData, 0, 0);
      } catch {
        setFallback(true);
      }
    };

    image.onerror = () => setFallback(true);
  }, [src, palette]);

  if (!src) {
    return <div className="sprite-empty">No sprite.</div>;
  }

  if (fallback) {
    return <img className="pokemon-sprite" src={convertFileSrc(src)} alt={alt} />;
  }

  return <canvas ref={canvasRef} className="pokemon-sprite" aria-label={alt} />;
}

export function PokemonSpritePanel({
  sourceSlug,
  displayName,
  front,
  back,
}: {
  sourceSlug: string;
  displayName: string;
  front: string | null;
  back: string | null;
}) {
  const [paletteData, setPaletteData] = useState<PokemonPaletteData | null>(null);
  const [palette, setPalette] = useState<Palette>(PALETTE_PRESETS[0].colors);
  const [selection, setSelection] = useState("preset:Grayscale");
  const [paletteError, setPaletteError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadPalette() {
      try {
        const data = await invoke<PokemonPaletteData | null>("get_pokemon_palette", {
          sourceSlug,
        });

        if (cancelled) {
          return;
        }

        setPaletteData(data);
        setPaletteError(null);

        const preferred =
          data?.options.find((option) => option.source === "cgb") ?? data?.options[0];

        if (preferred) {
          setPalette([...preferred.colors] as Palette);
          setSelection(`game:${preferred.source}`);
        } else {
          setPalette([...PALETTE_PRESETS[0].colors] as Palette);
          setSelection("preset:Grayscale");
        }
      } catch (error) {
        if (!cancelled) {
          setPaletteData(null);
          setPalette([...PALETTE_PRESETS[0].colors] as Palette);
          setSelection("preset:Grayscale");
          setPaletteError(String(error));
        }
      }
    }

    void loadPalette();
    return () => {
      cancelled = true;
    };
  }, [sourceSlug]);

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
    <section className="editor-card sprite-card">
      <div className="section-heading">
        <div>
          <h4>Sprites</h4>
          <p>
            Preview the sprite using the palette data in the selected disassembly or a custom palette.
          </p>
        </div>
        <div className="palette-presets">
          {paletteData?.options.map((option) => (
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

      <div className="sprite-layout">
        <div className="sprite-preview-grid">
          <figure>
            <SpritePreview
              src={front}
              alt={`${displayName} front sprite`}
              palette={palette}
            />
            <figcaption>Front</figcaption>
          </figure>
          <figure>
            <SpritePreview
              src={back}
              alt={`${displayName} back sprite`}
              palette={palette}
            />
            <figcaption>Back</figcaption>
          </figure>
        </div>

        <div className="palette-editor">
          <span className="field-label">Palette</span>
          {paletteData ? (
            <p className="help-text">
              Game mapping: <code>{paletteData.constant}</code> · Pokédex #{paletteData.dexNumber}
            </p>
          ) : (
            <p className="help-text">No game palette mapping was found for this species.</p>
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

          {paletteError && <p className="help-text">Palette read error: {paletteError}</p>}
          <p className="help-text">
            Game palettes are read from the project. Changing a color here is still preview-only.
          </p>
        </div>
      </div>
    </section>
  );
}
