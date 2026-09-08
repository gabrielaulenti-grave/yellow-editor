export interface ProjectInfo {
  path: string;
  valid: boolean;
  projectName: string;
  storageKey: string;
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

export interface PokemonBaseStatValues {
  hp: number;
  attack: number;
  defense: number;
  speed: number;
  special: number;
}

export interface PokemonBaseStatsEditDocument {
  path: string;
  sourceHash: string;
  values: PokemonBaseStatValues;
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

export type TrainerPartyFormat = "shared-level" | "individual-levels";
export type TrainerTriggerKind = "sight" | "talk" | "scripted";
export type TrainerPartyResolution =
  | "object"
  | "script"
  | "conditional-script"
  | "unresolved";
export type TrainerSpecialMoveScope = "party" | "class";
export type TrainerSpecialMoveSourceKind =
  | "yellow-party"
  | "red-lone"
  | "red-class";
export type TrainerScriptSelectionKind =
  | "direct"
  | "conditional"
  | "computed"
  | "table";

export interface TrainerSpecialMove {
  scope: TrainerSpecialMoveScope;
  pokemonIndex: number | null;
  moveSlot: number | null;
  moveConstant: string;
  sourceKind: TrainerSpecialMoveSourceKind;
  sourceKey: string;
}

export interface TrainerPokemon {
  level: number;
  speciesConstant: string;
  specialMoves: TrainerSpecialMove[];
}

export interface TrainerDialogue {
  wrapperLabel: string;
  textLabel: string | null;
  text: string | null;
  sourcePath: string | null;
}

export interface TrainerInstance {
  id: string;
  mapConstant: string;
  locationName: string;
  objectConstant: string | null;
  objectPath: string;
  scriptPath: string | null;
  x: number;
  y: number;
  spriteConstant: string;
  facingConstant: string;
  textConstant: string;
  triggerKind: TrainerTriggerKind;
  viewRange: number | null;
  eventFlag: string | null;
  trainerHeaderLabel: string | null;
  objectPartyId: string;
  effectivePartyIds: string[];
  partyResolution: TrainerPartyResolution;
  dialogue: {
    before: TrainerDialogue | null;
    defeat: TrainerDialogue | null;
    after: TrainerDialogue | null;
  };
}

export interface TrainerScriptReference {
  id: string;
  mapConstant: string;
  locationName: string;
  scriptPath: string;
  routineLabel: string;
  sourceLine: number;
  partyIds: string[];
  selectionKind: TrainerScriptSelectionKind;
  selectionSummary: string;
  routineSource: string;
  mapScriptSource: string;
}

export interface TrainerClassEntry {
  constant: string;
  name: string;
  partyIds: string[];
  partyCount: number;
  placedInstanceCount: number;
  scriptReferenceCount: number;
  affectedLocations: string[];
  baseRewardPerLevel: number | null;
  aiRoutine: string | null;
  aiUsesPerPokemon: number | null;
  moveChoiceModifiers: number[];
  classSpecialMoves: TrainerSpecialMove[];
  sourcePaths: string[];
}

export interface TrainerPartyEntry {
  id: string;
  classConstant: string;
  className: string;
  partyNumber: number;
  partyFormat: TrainerPartyFormat;
  pokemon: TrainerPokemon[];
  instances: TrainerInstance[];
  scriptReferences: TrainerScriptReference[];
  baseRewardPerLevel: number | null;
  calculatedPrize: number | null;
  aiRoutine: string | null;
  aiUsesPerPokemon: number | null;
  moveChoiceModifiers: number[];
  specialMoves: TrainerSpecialMove[];
  sourcePath: string;
  sourceLine: number;
}

export interface TrainerEditSourceDocument {
  path: string;
  sourceHash: string;
}

export interface TrainerPartyEditValues {
  partyFormat: TrainerPartyFormat;
  pokemon: Array<{
    level: number;
    speciesConstant: string;
  }>;
  specialMoves: TrainerSpecialMove[];
}

export interface TrainerCatalog {
  trainers: TrainerPartyEntry[];
  classes: TrainerClassEntry[];
  editSources: TrainerEditSourceDocument[];
  warnings: string[];
}

export type TrainerLoadStage =
  | "tables"
  | "maps"
  | "scripts"
  | "dialogue"
  | "complete";

export interface TrainerLoadProgress {
  stage: TrainerLoadStage;
  message: string;
  completed: number;
  total: number;
  percent: number;
}

export type TrainerLoadProgressListener = (progress: TrainerLoadProgress) => void;

export type EncounterVersion = "yellow" | "red" | "blue";
export type EncounterTerrain = "grass" | "water";

export interface EncounterSlot {
  level: number;
  speciesConstant: string;
  sourceLine: number | null;
}

export interface EncounterArea {
  rate: number;
  slots: EncounterSlot[];
}

export interface EncounterVersionData {
  version: EncounterVersion;
  grass: EncounterArea;
  water: EncounterArea;
}

export interface EncounterTableIndexEntry {
  path: string;
  tableLabel: string;
  displayName: string;
  versions: EncounterVersion[];
  hasGrass: boolean;
  hasWater: boolean;
  affectedLocations: string[];
  error: string | null;
}

export interface EncounterTableEditDocument {
  path: string;
  sourceHash: string;
  tableLabel: string;
  displayName: string;
  versions: EncounterVersionData[];
}

export type FishingFormat = "yellow" | "red-blue";

export interface FishingSlot {
  level: number;
  speciesConstant: string;
  sourceLine: number;
}

export interface SuperRodTable {
  id: string;
  displayName: string;
  affectedLocations: string[];
  slots: FishingSlot[];
}

export interface FishingData {
  format: FishingFormat;
  oldRod: FishingSlot;
  goodRod: FishingSlot[];
  superRodTables: SuperRodTable[];
}

export interface FishingSourceDocument {
  path: string;
  sourceHash: string;
}

export interface FishingEditDocument extends FishingData {
  sources: FishingSourceDocument[];
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

export type BuildTarget = "yellow" | "red" | "blue";
export type BuildBackend = "desktop-native" | "web-wasm";
export type BuildToolchainSource = "bundled" | "system" | "unavailable";

export interface SaveCompatibilityDescriptor {
  formatVersion: number;
  saveEpoch: number;
  target: BuildTarget;
  structuralHash: string;
  eventSchemaHash: string;
}

export interface BuildToolStatus {
  name: string;
  available: boolean;
  path: string | null;
  version: string | null;
}

export interface BuildEnvironment {
  backend: BuildBackend;
  ready: boolean;
  targets: BuildTarget[];
  requiredRgbdsVersion: string | null;
  detectedRgbdsVersion: string | null;
  versionMatches: boolean | null;
  toolchainSource: BuildToolchainSource;
  tools: BuildToolStatus[];
  buildTool: BuildToolStatus;
  helperCompiler: BuildToolStatus | null;
  helperTools: BuildToolStatus[];
  message: string;
}

export type BuildArtifactKind = "rom" | "map" | "sym";

export interface BuildArtifact {
  kind: BuildArtifactKind;
  fileName: string;
  mimeType: string;
  bytes: number[];
}

export interface BuildResult {
  success: boolean;
  target: BuildTarget;
  romPath: string | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  exitCode: number | null;
  artifacts?: BuildArtifact[];
}

export type BuildProgressStage =
  | "preparing"
  | "checking"
  | "assets"
  | "assembling"
  | "linking"
  | "fixing"
  | "complete"
  | "error";

export type BuildProgressLevel = "info" | "warning" | "error";

export interface BuildTaskProgress {
  label: string;
  completed?: number;
  total?: number;
  percent?: number;
  unit?: string;
}

export interface BuildProgressEvent {
  stage: BuildProgressStage;
  level: BuildProgressLevel;
  message: string;
  detail?: string;
  tool?: string;
  completed?: number;
  total?: number;
  task?: BuildTaskProgress;
  percent: number;
  timestamp: number;
}

export type BuildProgressListener = (event: BuildProgressEvent) => void;

export interface BuildService {
  inspect(): Promise<BuildEnvironment>;
  build(target: BuildTarget, onProgress?: BuildProgressListener): Promise<BuildResult>;
}

export interface ProjectBuildReadPreparation {
  indexed: boolean;
  fileCount: number;
  directoryCount: number;
  durationMs: number;
  message?: string;
}

export interface ProjectSource {
  displayPath: string;
  storageKey: string;
  readText(relativePath: string): Promise<string>;
  readBytes(relativePath: string): Promise<Uint8Array>;
  writeText(relativePath: string, contents: string): Promise<void>;
  exists(relativePath: string): Promise<boolean>;
  assetUrl(relativePath: string): Promise<string | null>;
  prepareBuildReads?(): Promise<ProjectBuildReadPreparation>;
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
  getPokemonBaseStatsEditDocument(sourceSlug: string): Promise<PokemonBaseStatsEditDocument>;
  savePokemonBaseStats(
    sourceSlug: string,
    expectedHash: string,
    values: PokemonBaseStatValues,
  ): Promise<HistorySummary>;
  getMoves(): Promise<MoveData[]>;
  getTrainers(onProgress?: TrainerLoadProgressListener): Promise<TrainerCatalog>;
  saveTrainerParty(
    partyId: string,
    sourceLine: number,
    sources: TrainerEditSourceDocument[],
    values: TrainerPartyEditValues,
    knownSpecies: string[],
    knownMoves: string[],
  ): Promise<HistorySummary>;
  getEncounterIndex(): Promise<EncounterTableIndexEntry[]>;
  getEncounterTable(path: string): Promise<EncounterTableEditDocument>;
  saveEncounterTable(
    path: string,
    expectedHash: string,
    versions: EncounterVersionData[],
    knownSpecies: string[],
  ): Promise<HistorySummary>;
  getFishing(): Promise<FishingEditDocument>;
  saveFishing(
    sources: FishingSourceDocument[],
    data: FishingData,
    knownSpecies: string[],
  ): Promise<HistorySummary>;
  getHistorySummary(): Promise<HistorySummary>;
  saveTextChanges(label: string, changes: TextWriteRequest[]): Promise<HistorySummary>;
  undoLastSave(): Promise<HistorySummary>;
  redoLastUndo(): Promise<HistorySummary>;
  getBuildEnvironment(): Promise<BuildEnvironment>;
  getSaveCompatibility(target: BuildTarget): Promise<SaveCompatibilityDescriptor>;
  buildRom(target: BuildTarget, onProgress?: BuildProgressListener): Promise<BuildResult>;
  dispose(): void;
}
