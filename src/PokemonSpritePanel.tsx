import { useEffect, useRef, useState } from "react";
import type { PokemonEditDocument } from "./core/types";
import type { PokemonDraft } from "./editor/pokemonForm";
import { convertFileSrc } from "./platform/compat";

type Palette = [string, string, string, string];
type PaletteSource = "cgb" | "sgb" | "grayscale" | "dmg";

const GRAYSCALE: Palette = ["#ffffff", "#aaaaaa", "#555555", "#000000"];
const DMG: Palette = ["#e0f8cf", "#86c06c", "#306850", "#071821"];

function hexToRgb(hex: string) {
  const value = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return { r: 0, g: 0, b: 0 };
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
    if (!src || !canvasRef.current) return;

    let cancelled = false;
    const image = new Image();
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
        for (let index = 0; index < imageData.data.length; index += 4) {
          if (imageData.data[index + 3] === 0) continue;
          const luminance =
            imageData.data[index] * 0.2126 +
            imageData.data[index + 1] * 0.7152 +
            imageData.data[index + 2] * 0.0722;
          const shade = Math.max(0, Math.min(3, Math.round((255 - luminance) / 85)));
          const color = colors[shade];
          imageData.data[index] = color.r;
          imageData.data[index + 1] = color.g;
          imageData.data[index + 2] = color.b;
        }
        context.putImageData(imageData, 0, 0);
      } catch {
        setFallback(true);
      }
    };
    image.onerror = () => {
      if (!cancelled) setFallback(true);
    };
    image.src = convertFileSrc(src);
    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [src, palette]);

  if (!src) return <div className="sprite-empty">No sprite.</div>;
  if (fallback) return <img className="pokemon-sprite" src={convertFileSrc(src)} alt={alt} />;
  return <canvas ref={canvasRef} className="pokemon-sprite" aria-label={alt} />;
}

export function PokemonSpritePanel({
  document,
  draft,
  displayName,
  front,
  back,
  disabled,
  onSpriteChoiceChange,
  onPaletteConstantChange,
  onPaletteColorChange,
}: {
  document: PokemonEditDocument;
  draft: PokemonDraft;
  displayName: string;
  front: string | null;
  back: string | null;
  disabled: boolean;
  onSpriteChoiceChange(value: string): void;
  onPaletteConstantChange(value: string): void;
  onPaletteColorChange(source: "cgb" | "sgb", index: number, value: string): void;
}) {
  const initialSource: PaletteSource = draft.cgbPalette ? "cgb" : draft.sgbPalette ? "sgb" : "grayscale";
  const [source, setSource] = useState<PaletteSource>(initialSource);

  useEffect(() => {
    if (source === "cgb" && !draft.cgbPalette) {
      setSource(draft.sgbPalette ? "sgb" : "grayscale");
    } else if (source === "sgb" && !draft.sgbPalette) {
      setSource(draft.cgbPalette ? "cgb" : "grayscale");
    }
  }, [draft.paletteConstant, draft.cgbPalette, draft.sgbPalette, source]);

  const palette: Palette =
    source === "cgb" && draft.cgbPalette
      ? draft.cgbPalette
      : source === "sgb" && draft.sgbPalette
        ? draft.sgbPalette
        : source === "dmg"
          ? DMG
          : GRAYSCALE;

  const selectedSprite = document.options.spriteChoices.find(
    (choice) => choice.id === draft.spriteChoiceId,
  );
  const selectedPalette = document.options.paletteChoices.find(
    (choice) => choice.constant === draft.paletteConstant,
  );
  const editableSource = source === "cgb" || source === "sgb";
  const savedSpriteChanged = draft.spriteChoiceId !== document.values.spriteChoiceId;

  return (
    <section className="editor-card sprite-card">
      <div className="section-heading">
        <div>
          <h4>Sprites &amp; Palette</h4>
          <p>Choose a project-defined sprite pair and edit the species palette assignment.</p>
        </div>
        <div className="palette-presets">
          {draft.cgbPalette && (
            <button type="button" className={source === "cgb" ? "small-button active" : "small-button"} onClick={() => setSource("cgb")}>
              Game Boy Color
            </button>
          )}
          {draft.sgbPalette && (
            <button type="button" className={source === "sgb" ? "small-button active" : "small-button"} onClick={() => setSource("sgb")}>
              Super Game Boy
            </button>
          )}
          <button type="button" className={source === "grayscale" ? "small-button active" : "small-button"} onClick={() => setSource("grayscale")}>
            Grayscale
          </button>
          <button type="button" className={source === "dmg" ? "small-button active" : "small-button"} onClick={() => setSource("dmg")}>
            DMG Green
          </button>
        </div>
      </div>

      <div className="sprite-layout">
        <div className="sprite-preview-grid">
          <figure>
            <SpritePreview src={front} alt={displayName + " front sprite"} palette={palette} />
            <figcaption>Front</figcaption>
          </figure>
          <figure>
            <SpritePreview src={back} alt={displayName + " back sprite"} palette={palette} />
            <figcaption>Back</figcaption>
          </figure>
        </div>

        <div className="palette-editor">
          <label className="editor-field">
            <span>Sprite Pair</span>
            <select value={draft.spriteChoiceId} disabled={disabled} onChange={(event) => onSpriteChoiceChange(event.target.value)}>
              {document.options.spriteChoices.map((choice) => (
                <option key={choice.id} value={choice.id}>{choice.label}</option>
              ))}
            </select>
          </label>
          {selectedSprite && (
            <p className="help-text">
              <code>{selectedSprite.frontLabel}</code> / <code>{selectedSprite.backLabel}</code>
            </p>
          )}
          {savedSpriteChanged && (
            <p className="help-text">The preview switches to the new sprite pair after Save.</p>
          )}

          <label className="editor-field">
            <span>Palette Mapping</span>
            <select value={draft.paletteConstant} disabled={disabled} onChange={(event) => onPaletteConstantChange(event.target.value)}>
              {document.options.paletteChoices.map((choice) => (
                <option key={choice.constant} value={choice.constant}>{choice.constant}</option>
              ))}
            </select>
          </label>

          <p className="shared-warning">
            Palette constants are shared. Editing these colors changes every Pokémon that uses <code>{draft.paletteConstant}</code>.
          </p>

          {editableSource && selectedPalette ? (
            palette.map((color, index) => (
              <label key={index} className="palette-row">
                <span>Shade {index + 1}</span>
                <input
                  type="color"
                  value={color}
                  disabled={disabled}
                  onChange={(event) => onPaletteColorChange(source, index, event.target.value)}
                />
                <code>{color.toUpperCase()}</code>
              </label>
            ))
          ) : (
            <p className="help-text">Grayscale and DMG Green are preview presets only.</p>
          )}
        </div>
      </div>
    </section>
  );
}
