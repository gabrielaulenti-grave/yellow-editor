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

export interface HistoryFileChange {
  path: string;
  before: string;
  after: string;
  beforeHash: string;
  afterHash: string;
}

export interface HistoryEntry {
  id: string;
  timestamp: string;
  label: string;
  files: HistoryFileChange[];
}

export interface HistoryPendingOperation {
  entryId: string;
  fromCursor: number;
  toCursor: number;
  direction: "before" | "after";
}

export interface HistoryState {
  version: number;
  entries: HistoryEntry[];
  cursor: number;
  pending?: HistoryPendingOperation | null;
}

export interface HistorySummary {
  entryCount: number;
  appliedCount: number;
  canUndo: boolean;
  canRedo: boolean;
  latestLabel: string | null;
  latestTimestamp: string | null;
  persistent: boolean;
}

export interface HistoryStore {
  persistent: boolean;
  load(): Promise<HistoryState | null>;
  save(state: HistoryState): Promise<void>;
}

export interface TextWriteRequest {
  path: string;
  contents: string;
  expectedHash?: string;
}

export interface ProjectSource {
  displayPath: string;
  readText(relativePath: string): Promise<string>;
  writeText(relativePath: string, contents: string): Promise<void>;
  exists(relativePath: string): Promise<boolean>;
  assetUrl(relativePath: string): Promise<string | null>;
  historyStore: HistoryStore;
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
  getHistorySummary(): Promise<HistorySummary>;
  saveTextChanges(label: string, changes: TextWriteRequest[]): Promise<HistorySummary>;
  undoLastSave(): Promise<HistorySummary>;
  redoLastUndo(): Promise<HistorySummary>;
  dispose(): void;
}
