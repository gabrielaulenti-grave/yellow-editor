export interface ProjectInfo {
  path: string;
  valid: boolean;
  projectName: string;
}

export interface PokemonIndexEntry {
  internalId: number;
  constant: string | null;
  displayName: string;
  kind: "pokemon" | "missingno" | "special" | "system";
  sourceSlug: string | null;
}

export interface PokemonBaseStats {
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

export interface PokemonSprites {
  front: string | null;
  back: string | null;
}

export type PokemonPaletteSource = "cgb" | "sgb";

export interface PokemonPaletteOption {
  source: PokemonPaletteSource;
  label: string;
  colors: [string, string, string, string];
}

export interface PokemonPaletteData {
  constant: string;
  dexNumber: number;
  options: PokemonPaletteOption[];
}

export interface LearnsetMove {
  level: number;
  moveConstant: string;
}

export interface Evolution {
  method: "level" | "item" | "trade";
  level: number | null;
  item: string | null;
  target: string;
}

export interface PokedexTextLine {
  kind: "text" | "next" | "page";
  text: string;
}

export interface PokedexInfo {
  category: string;
  heightFeet: number;
  heightInches: number;
  weightTenthsLb: number;
  textLabel: string;
  textLines: PokedexTextLine[];
}

export interface PokemonDetails {
  stats: PokemonBaseStats;
  evolutions: Evolution[];
  learnset: LearnsetMove[];
  pokedex: PokedexInfo | null;
  sprites: PokemonSprites;
}

export interface MoveData {
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

export interface ProjectSource {
  displayPath: string;
  readText(relativePath: string): Promise<string>;
  exists(relativePath: string): Promise<boolean>;
  assetUrl(relativePath: string): Promise<string | null>;
  dispose?(): void;
}

export interface ProjectSession {
  info: ProjectInfo;
  getPokemonIndex(): Promise<PokemonIndexEntry[]>;
  getPokemonDetails(
    internalId: number,
    sourceSlug: string,
  ): Promise<PokemonDetails>;
  getPokemonTmhmMoves(sourceSlug: string): Promise<string[]>;
  getPokemonPalette(sourceSlug: string): Promise<PokemonPaletteData | null>;
  getMoves(): Promise<MoveData[]>;
  dispose(): void;
}
