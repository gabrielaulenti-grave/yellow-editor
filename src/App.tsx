import { useEffect, useRef, useState } from "react";
import { invoke, convertFileSrc, open } from "./platform/compat";
import "./App.css";

interface ProjectInfo {
  path: string;
  valid: boolean;
  projectName: string;
}

interface PokemonIndexEntry {
  internalId: number;
  constant: string | null;
  displayName: string;
  kind: "pokemon" | "missingno" | "special" | "system";
  sourceSlug: string | null;
}

interface PokemonBaseStats {
  dexConstant: string;
  hp: number;
  attack: number;
  defense: number;
  speed: number;
  special: number;
  type1: string;
  type2: string;
  catchRate: number;
  baseExp: number;
}

interface PokemonSprites {
  front: string | null;
  back: string | null;
}

interface LearnsetMove {
  level: number;
  moveConstant: string;
}

interface Evolution {
  method: "level" | "item" | "trade";
  level: number | null;
  item: string | null;
  target: string;
}

interface PokedexTextLine {
  kind: "text" | "next" | "page";
  text: string;
}

interface PokedexInfo {
  category: string;
  heightFeet: number;
  heightInches: number;
  weightTenthsLb: number;
  textLabel: string;
  textLines: PokedexTextLine[];
}

interface PokemonDetails {
  stats: PokemonBaseStats;
  evolutions: Evolution[];
  learnset: LearnsetMove[];
  pokedex: PokedexInfo | null;
  sprites: PokemonSprites;
}

interface MoveData {
  id: number;
  constant: string;
  name: string;
  animation: string;
  effect: string;
  power: number;
  moveType: string;
  accuracy: number;
  pp: number;
  animationLabel: string | null;
  animationScript: string[];
}

type Palette = [string, string, string, string];

type Tab = "pokemon" | "moves";

const PALETTE_PRESETS: { name: string; colors: Palette }[] = [
  { name: "Grayscale", colors: ["#ffffff", "#aaaaaa", "#555555", "#000000"] },
  { name: "DMG Green", colors: ["#e0f8cf", "#86c06c", "#306850", "#071821"] },
  { name: "Yellow", colors: ["#fff8cf", "#e8c85a", "#9a6b2f", "#2f241c"] },
  { name: "Blue", colors: ["#f5fbff", "#9cc7e8", "#477aa8", "#172c45"] },
];

function formatHex(value: number) {
  return `$${value.toString(16).toUpperCase().padStart(2, "0")}`;
}

function hexToRgb(hex: string) {
  const value = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(value)) {
    return { r: 0, g: 0, b: 0 };
  }

  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
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
    return (
      <img
        className="pokemon-sprite"
        src={convertFileSrc(src)}
        alt={alt}
      />
    );
  }

  return <canvas ref={canvasRef} className="pokemon-sprite" aria-label={alt} />;
}

function ReadonlyField({ label, value }: { label: string; value: string | number }) {
  return (
    <label className="editor-field">
      <span>{label}</span>
      <input value={value} readOnly />
    </label>
  );
}

function App() {
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("pokemon");
  const [pokemonIndex, setPokemonIndex] = useState<PokemonIndexEntry[]>([]);
  const [status, setStatus] = useState("No project loaded.");
  const [selectedPokemonId, setSelectedPokemonId] = useState<number | null>(null);
  const [selectedPokemon, setSelectedPokemon] = useState<PokemonDetails | null>(null);
  const [tmhmMoves, setTmhmMoves] = useState<string[]>([]);
  const [moves, setMoves] = useState<MoveData[]>([]);
  const [selectedMoveId, setSelectedMoveId] = useState<number | null>(null);
  const [moveSearch, setMoveSearch] = useState("");
  const [spritePalette, setSpritePalette] = useState<Palette>(PALETTE_PRESETS[0].colors);

  const selectedMove = moves.find((move) => move.id === selectedMoveId) ?? null;
  const selectedPokemonEntry =
    pokemonIndex.find((entry) => entry.internalId === selectedPokemonId) ?? null;

  const filteredMoves = moves.filter((move) => {
    const query = moveSearch.trim().toLowerCase();
    if (!query) {
      return true;
    }

    return (
      move.name.toLowerCase().includes(query) ||
      move.constant.toLowerCase().includes(query) ||
      formatHex(move.id).toLowerCase().includes(query)
    );
  });

  async function loadPokemon(entry: PokemonIndexEntry) {
    setSelectedPokemonId(entry.internalId);

    if (!project || !entry.sourceSlug) {
      setSelectedPokemon(null);
      setTmhmMoves([]);
      return;
    }

    try {
      const [details, compatibleMoves] = await Promise.all([
        invoke<PokemonDetails>("get_pokemon_details", {
          projectPath: project.path,
          internalId: entry.internalId,
          sourceSlug: entry.sourceSlug,
        }),
        invoke<string[]>("get_pokemon_tmhm_moves", {
          projectPath: project.path,
          sourceSlug: entry.sourceSlug,
        }),
      ]);

      setSelectedPokemon(details);
      setTmhmMoves(compatibleMoves);
      setStatus("Pokémon loaded successfully.");
    } catch (error) {
      setSelectedPokemon(null);
      setTmhmMoves([]);
      setStatus(String(error));
    }
  }

  async function selectProject() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Pokémon disassembly project",
      });

      if (!selected) {
        return;
      }

      const result = await invoke<ProjectInfo>("open_project", { path: selected });

      const [index, moveData] = await Promise.all([
        invoke<PokemonIndexEntry[]>("get_pokemon_index", { projectPath: result.path }),
        invoke<MoveData[]>("get_moves", { projectPath: result.path }),
      ]);

      setProject(result);
      setPokemonIndex(index);
      setMoves(moveData);
      setSelectedPokemon(null);
      setSelectedPokemonId(null);
      setTmhmMoves([]);
      setSelectedMoveId(moveData[0]?.id ?? null);
      setMoveSearch("");
      setStatus("Project loaded successfully.");
    } catch (error) {
      setProject(null);
      setPokemonIndex([]);
      setMoves([]);
      setSelectedPokemon(null);
      setSelectedPokemonId(null);
      setTmhmMoves([]);
      setSelectedMoveId(null);
      setStatus(String(error));
    }
  }

  function updatePaletteColor(index: number, color: string) {
    setSpritePalette((current) => {
      const next = [...current] as Palette;
      next[index] = color;
      return next;
    });
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <h1>Yellow Editor</h1>
          <p className="status-line">{status}</p>
        </div>
        <button onClick={selectProject}>Open Project</button>
      </header>

      {project && (
        <section className="project-strip">
          <strong>{project.projectName}</strong>
          <span>{project.path}</span>
        </section>
      )}

      <nav className="tab-bar">
        <button
          className={activeTab === "pokemon" ? "active" : ""}
          onClick={() => setActiveTab("pokemon")}
        >
          Pokémon
        </button>
        <button
          className={activeTab === "moves" ? "active" : ""}
          onClick={() => setActiveTab("moves")}
        >
          Moves
        </button>
      </nav>

      {activeTab === "pokemon" && (
        <section className="tab-content">
          <div className="tab-heading-row">
            <div>
              <h2>Pokémon</h2>
              <p>Read-only layout prepared for the upcoming editor.</p>
            </div>
            <select
              value={selectedPokemonId ?? ""}
              onChange={(event) => {
                const id = Number(event.target.value);
                const entry = pokemonIndex.find((pokemon) => pokemon.internalId === id);
                if (entry) {
                  loadPokemon(entry);
                }
              }}
            >
              <option value="" disabled>
                Select a Pokémon
              </option>
              {pokemonIndex
                .filter((entry) => entry.kind !== "system")
                .map((entry) => (
                  <option key={entry.internalId} value={entry.internalId}>
                    {formatHex(entry.internalId)} — {entry.displayName}
                  </option>
                ))}
            </select>
          </div>

          {!project && <p>Open a project to browse Pokémon.</p>}

          {selectedPokemon && (
            <div className="pokemon-editor">
              <div className="pokemon-title-row">
                <div>
                  <h3>{selectedPokemonEntry?.displayName}</h3>
                  <p className="muted-code">
                    {selectedPokemonEntry && formatHex(selectedPokemonEntry.internalId)}
                    {selectedPokemonEntry?.constant ? ` — ${selectedPokemonEntry.constant}` : ""}
                  </p>
                </div>
              </div>

              <section className="editor-card sprite-card">
                <div className="section-heading">
                  <div>
                    <h4>Sprites</h4>
                    <p>Preview the monochrome sprite data with any four-color palette.</p>
                  </div>
                  <div className="palette-presets">
                    {PALETTE_PRESETS.map((preset) => (
                      <button
                        key={preset.name}
                        type="button"
                        className="small-button"
                        onClick={() => setSpritePalette([...preset.colors] as Palette)}
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
                        src={selectedPokemon.sprites.front}
                        alt={`${selectedPokemonEntry?.displayName ?? "Pokémon"} front sprite`}
                        palette={spritePalette}
                      />
                      <figcaption>Front</figcaption>
                    </figure>
                    <figure>
                      <SpritePreview
                        src={selectedPokemon.sprites.back}
                        alt={`${selectedPokemonEntry?.displayName ?? "Pokémon"} back sprite`}
                        palette={spritePalette}
                      />
                      <figcaption>Back</figcaption>
                    </figure>
                  </div>

                  <div className="palette-editor">
                    <span className="field-label">Palette</span>
                    {spritePalette.map((color, index) => (
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
                    <p className="help-text">
                      This is a preview only; palette values are not written to the project yet.
                    </p>
                  </div>
                </div>
              </section>

              <section className="editor-card">
                <h4>Base Stats</h4>
                <div className="field-grid stat-grid">
                  <ReadonlyField label="HP" value={selectedPokemon.stats.hp} />
                  <ReadonlyField label="Attack" value={selectedPokemon.stats.attack} />
                  <ReadonlyField label="Defense" value={selectedPokemon.stats.defense} />
                  <ReadonlyField label="Speed" value={selectedPokemon.stats.speed} />
                  <ReadonlyField label="Special" value={selectedPokemon.stats.special} />
                  <ReadonlyField label="Catch Rate" value={selectedPokemon.stats.catchRate} />
                  <ReadonlyField label="Base EXP" value={selectedPokemon.stats.baseExp} />
                  <ReadonlyField label="Dex Constant" value={selectedPokemon.stats.dexConstant} />
                </div>

                <h5>Typing</h5>
                <div className="field-grid two-column-fields">
                  <ReadonlyField label="Type 1" value={selectedPokemon.stats.type1} />
                  <ReadonlyField label="Type 2" value={selectedPokemon.stats.type2} />
                </div>
              </section>

              <section className="editor-card">
                <h4>Evolution</h4>
                {selectedPokemon.evolutions.length === 0 ? (
                  <p className="empty-state">Does not evolve.</p>
                ) : (
                  <div className="table-wrap">
                    <table className="editor-table">
                      <thead>
                        <tr>
                          <th>Method</th>
                          <th>Level</th>
                          <th>Item</th>
                          <th>Target</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedPokemon.evolutions.map((evolution, index) => (
                          <tr key={index}>
                            <td><input value={evolution.method} readOnly /></td>
                            <td><input value={evolution.level ?? ""} readOnly /></td>
                            <td><input value={evolution.item ?? ""} readOnly /></td>
                            <td><input value={evolution.target} readOnly /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="editor-card">
                <h4>Level-up Learnset</h4>
                <div className="table-wrap">
                  <table className="editor-table compact-table">
                    <thead>
                      <tr>
                        <th>Level</th>
                        <th>Move</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedPokemon.learnset.map((move, index) => (
                        <tr key={index}>
                          <td><input value={move.level} readOnly /></td>
                          <td><input value={move.moveConstant} readOnly /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="editor-card">
                <h4>TM/HM Compatibility</h4>
                {tmhmMoves.length === 0 ? (
                  <p className="empty-state">No compatible TM/HM moves.</p>
                ) : (
                  <div className="move-chip-grid">
                    {tmhmMoves.map((move) => (
                      <label key={move} className="compatibility-chip">
                        <input type="checkbox" checked readOnly />
                        <span>{move}</span>
                      </label>
                    ))}
                  </div>
                )}
              </section>

              <section className="editor-card">
                <h4>Pokédex</h4>
                {selectedPokemon.pokedex ? (
                  <>
                    <div className="field-grid dex-grid">
                      <ReadonlyField label="Species" value={selectedPokemon.pokedex.category} />
                      <ReadonlyField label="Height (ft)" value={selectedPokemon.pokedex.heightFeet} />
                      <ReadonlyField label="Height (in)" value={selectedPokemon.pokedex.heightInches} />
                      <ReadonlyField
                        label="Weight (lb)"
                        value={(selectedPokemon.pokedex.weightTenthsLb / 10).toFixed(1)}
                      />
                    </div>

                    <h5>Entry Text</h5>
                    <div className="dex-text-lines">
                      {selectedPokemon.pokedex.textLines.map((line, index) => (
                        <label key={index} className="dex-line-field">
                          <span>{line.kind}</span>
                          <input value={line.text} maxLength={18} readOnly />
                        </label>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="empty-state">No Pokédex data.</p>
                )}
              </section>
            </div>
          )}
        </section>
      )}

      {activeTab === "moves" && (
        <section className="tab-content">
          <h2>Moves</h2>

          {!project ? (
            <p>Open a project to browse moves.</p>
          ) : (
            <div className="move-browser">
              <aside>
                <input
                  type="search"
                  placeholder="Search moves..."
                  value={moveSearch}
                  onChange={(event) => setMoveSearch(event.target.value)}
                  className="full-width-input"
                />

                <div className="move-list">
                  {filteredMoves.map((move) => (
                    <button
                      key={move.id}
                      onClick={() => setSelectedMoveId(move.id)}
                      className={move.id === selectedMoveId ? "active" : ""}
                    >
                      {formatHex(move.id)} — {move.name}
                    </button>
                  ))}

                  {filteredMoves.length === 0 && <p>No moves match that search.</p>}
                </div>
              </aside>

              <section className="editor-card">
                {selectedMove ? (
                  <>
                    <h3>{selectedMove.name}</h3>
                    <p className="muted-code">
                      {formatHex(selectedMove.id)} — {selectedMove.constant}
                    </p>

                    <h4>Move Data</h4>
                    <div className="field-grid two-column-fields">
                      <ReadonlyField label="Name" value={selectedMove.name} />
                      <ReadonlyField label="Power" value={selectedMove.power} />
                      <ReadonlyField label="Accuracy" value={`${selectedMove.accuracy}%`} />
                      <ReadonlyField label="PP" value={selectedMove.pp} />
                      <ReadonlyField label="Type" value={selectedMove.moveType} />
                      <ReadonlyField label="Effect" value={selectedMove.effect} />
                    </div>

                    <h4>Animation</h4>
                    <div className="field-grid two-column-fields">
                      <ReadonlyField label="Animation Constant" value={selectedMove.animation} />
                      <ReadonlyField
                        label="Animation Label"
                        value={selectedMove.animationLabel ?? "Not found"}
                      />
                    </div>

                    <details>
                      <summary>View animation script</summary>
                      {selectedMove.animationScript.length === 0 ? (
                        <p>No animation script found.</p>
                      ) : (
                        <pre>{selectedMove.animationScript.join("\n")}</pre>
                      )}
                    </details>
                  </>
                ) : (
                  <p>Select a move.</p>
                )}
              </section>
            </div>
          )}
        </section>
      )}
    </main>
  );
}

export default App;
