export interface ProjectInfo {
  path: string;
  valid: boolean;
  projectName: string;
  storageKey: string;
}

export interface MapIndexEntry {
  id: number;
  constant: string;
  displayName: string;
  width: number;
  height: number;
  headerLabel: string | null;
  headerPath: string | null;
  isAlias: boolean;
  isUnused: boolean;
}

export interface MapWarpEvent {
  id: number;
  x: number;
  y: number;
  destinationMapConstant: string | null;
  destinationMapDisplayName: string | null;
  destinationWarpId: number;
  isLastMap: boolean;
}

export interface MapConnection {
  direction: "north" | "south" | "east" | "west";
  destinationMapConstant: string;
  destinationMapDisplayName: string | null;
  offset: number | null;
}

export interface MapSignEvent {
  id: number;
  x: number;
  y: number;
  textConstant: string;
  textLabel: string | null;
  scriptPath: string;
}

export interface MapNpcEvent {
  id: number;
  objectConstant: string | null;
  x: number;
  y: number;
  spriteConstant: string;
  movementConstant: string;
  directionOrRangeConstant: string;
  textConstant: string;
  textLabel: string | null;
  scriptPath: string;
  dialoguePath: string;
  dialogueLabel: string | null;
}

export interface MapVisualization {
  map: MapIndexEntry;
  headerMapConstant: string;
  mapSourceLabel: string;
  tilesetConstant: string;
  tilesetName: string;
  mapBlockPath: string;
  blocksetPath: string;
  tilesetGfxPath: string;
  objectPath: string;
  mapBlocks: number[];
  blockset: number[];
  tilesetGfx: number[];
  tileCount: number;
  blockCount: number;
  warps: MapWarpEvent[];
  signs: MapSignEvent[];
  npcs: MapNpcEvent[];
  connections: MapConnection[];
  warnings: string[];
}

export type ScriptRoutineKind = "state" | "routine" | "source-label";

export type ScriptRoutineCategory =
  | "event-state"
  | "dispatcher"
  | "helper"
  | "dialogue"
  | "movement"
  | "data";

export interface ScriptRoutineSummary {
  path: string;
  label: string;
  startLine: number;
  kind: ScriptRoutineKind;
  category: ScriptRoutineCategory;
  recognizedOperationCount: number;
  operationKinds: string[];
}

export interface ScriptCatalogEntry {
  id: string;
  displayName: string;
  paths: string[];
  routines: ScriptRoutineSummary[];
}

export interface ScriptCatalog {
  entries: ScriptCatalogEntry[];
  fileCount: number;
  routineCount: number;
}

export type ScriptAuditStatus = "semantic" | "structural" | "internal" | "unresolved";

export type ScriptAuditConstructKind =
  | "macro"
  | "call"
  | "farcall"
  | "predef"
  | "jp"
  | "instruction"
  | "directive";

export interface ScriptAuditExample {
  path: string;
  line: number;
  source: string;
}

export interface ScriptAuditConstruct {
  key: string;
  name: string;
  kind: ScriptAuditConstructKind;
  status: ScriptAuditStatus;
  familyId?: string;
  occurrences: number;
  paths: string[];
  examples: ScriptAuditExample[];
  reason: string;
}

export interface ScriptAuditFile {
  path: string;
  semanticLines: number;
  structuralLines: number;
  internalLines: number;
  unresolvedLines: number;
  meaningfulLines: number;
  semanticInvocationCount: number;
  structuralInvocationCount: number;
  internalInvocationCount: number;
  unresolvedInvocationCount: number;
  unboundSemanticInvocationCount: number;
  unresolvedKeys: string[];
  structuralInvocationKeys: string[];
  unboundSemanticKeys: string[];
}

export interface ScriptAuditReleaseReadiness {
  ready: boolean;
  blockerCount: number;
  unresolvedConstructCount: number;
  structuralConstructCount: number;
  externalTargetConstructCount: number;
  macroSemanticConstructCount: number;
  unresolvedSyntaxConstructCount: number;
  unboundSemanticConstructCount: number;
  criteria: string[];
}

export interface ScriptAuditSemanticFamily {
  id: string;
  label: string;
  description: string;
  builderPriority: "core" | "advanced";
}

export interface ScriptAuditRegressionFixture {
  id: string;
  label: string;
  purpose: string;
  paths: string[];
  presentPaths: string[];
  requiredFamilies: string[];
  missingFamilies: string[];
  blockerCount: number;
  unresolvedInvocationCount: number;
  structuralInvocationCount: number;
  unboundSemanticInvocationCount: number;
  passed: boolean;
}

export interface ScriptAuditReport {
  irVersion: string;
  semanticFamilies: ScriptAuditSemanticFamily[];
  releaseReadiness: ScriptAuditReleaseReadiness;
  regressionFixtures: ScriptAuditRegressionFixture[];
  fileCount: number;
  meaningfulLineCount: number;
  semanticLineCount: number;
  structuralLineCount: number;
  internalLineCount: number;
  unresolvedLineCount: number;
  semanticInvocationCount: number;
  structuralInvocationCount: number;
  internalInvocationCount: number;
  unresolvedInvocationCount: number;
  unboundSemanticInvocationCount: number;
  files: ScriptAuditFile[];
  constructs: ScriptAuditConstruct[];
  warnings: string[];
}

export type ProjectMovementDirection =
  | "up"
  | "down"
  | "left"
  | "right"
  | "up-left"
  | "up-right"
  | "down-left"
  | "down-right";

export interface ProjectMovementRange {
  minimum: number;
  maximumExclusive: number | null;
  symbol: string;
  direction: ProjectMovementDirection;
  sourcePath: string;
}

export interface ProjectMovementExactValue {
  value: number;
  symbol: string;
  direction?: ProjectMovementDirection;
  operation?: "change-facing";
  sourcePath: string;
}

export type ProjectMovementCommandAction = "move" | "look" | "delay" | "end";
export type ProjectMovementCommandStyle = "step" | "slide" | "hop" | "walk";

export interface ProjectMovementCommandValue {
  value: number;
  symbol: string;
  family: string;
  action: ProjectMovementCommandAction;
  style?: ProjectMovementCommandStyle;
  direction?: ProjectMovementDirection;
  sourcePath: string;
}

export interface ProjectMovementConsumer {
  routine: string;
  register: "hl" | "de";
  family: string;
  commands: ProjectMovementCommandValue[];
  sourcePaths: string[];
  guards: string[];
}

export interface ProjectSpriteMovementStatus {
  value: number;
  routine: string;
  sourcePath: string;
}

export interface ProjectMovementVocabulary {
  npcRanges: ProjectMovementRange[];
  npcExactValues: ProjectMovementExactValue[];
  joypadExactValues: ProjectMovementExactValue[];
  exactValues: ProjectMovementExactValue[];
  consumers: ProjectMovementConsumer[];
  spriteStatuses: ProjectSpriteMovementStatus[];
  warnings: string[];
}

export type ProjectEventMacroAction =
  | "check"
  | "set"
  | "reset"
  | "set-many"
  | "reset-many"
  | "set-range"
  | "reset-range"
  | "check-set"
  | "check-reset"
  | "check-any"
  | "check-all";

export type ProjectEventZeroMeaning =
  | "event-clear"
  | "none-set"
  | "all-set";

export interface ProjectEventMacroSemantic {
  name: string;
  action: ProjectEventMacroAction;
  eventParameterIndexes: number[];
  zeroMeaning?: ProjectEventZeroMeaning;
  sourcePath: string;
  sourceLine: number;
}

export interface ScriptExternalRoutineSource {
  label: string;
  path: string;
  startLine: number;
  source: string;
}

export interface ScriptDocument {
  path: string;
  source: string;
  routines: ScriptRoutineSummary[];
  movementVocabulary?: ProjectMovementVocabulary;
  externalRoutines?: ScriptExternalRoutineSource[];
  eventMacroSemantics?: ProjectEventMacroSemantic[];
}

export type MacroParameterKind =
  | "unknown"
  | "number"
  | "string"
  | "label"
  | "constant"
  | "symbol"
  | "expression";

export type MacroInferenceConfidence = "low" | "medium" | "high";

export type ProjectSemanticDomainKind =
  | "pokemon"
  | "move"
  | "item"
  | "map"
  | "trainer-class"
  | "constant-family"
  | "label-family";

export interface ProjectSemanticDomainOption {
  value: string;
  label: string;
}

export interface ProjectSemanticDomain {
  id: string;
  label: string;
  kind: ProjectSemanticDomainKind;
  sourcePath: string | null;
  options: ProjectSemanticDomainOption[];
}

export interface SemanticDomainMatch {
  domainId: string;
  domainLabel: string;
  domainKind: ProjectSemanticDomainKind;
  confidence: MacroInferenceConfidence;
  evidence: string[];
}

export interface ProjectSemanticDomainCatalog {
  domains: ProjectSemanticDomain[];
  warnings: string[];
}

export interface MacroParameterSummary {
  index: number;
  displayName: string;
  required: boolean;
  inferredKind: MacroParameterKind;
  confidence: MacroInferenceConfidence;
  examples: string[];
  evidence: string[];
  semanticDomains: SemanticDomainMatch[];
}

export interface MacroDefinitionSummary {
  name: string;
  path: string;
  startLine: number;
  endLine: number;
  parameters: MacroParameterSummary[];
  callCount: number;
  nestedMacros: string[];
}

export interface MacroCatalog {
  macros: MacroDefinitionSummary[];
  sourceFileCount: number;
  scriptFileCount: number;
  definitionCount: number;
  callCount: number;
  warnings: string[];
  domains: ProjectSemanticDomain[];
  domainWarnings: string[];
}

export interface ScriptMacroArgument {
  index: number;
  raw: string;
  inferredKind: MacroParameterKind;
  confidence: MacroInferenceConfidence;
  semanticDomains: SemanticDomainMatch[];
}

export interface ScriptMacroCall {
  name: string;
  path: string;
  line: number;
  definitionPath: string;
  definitionLine: number;
  arguments: ScriptMacroArgument[];
}

export interface ScriptMacroCallDocument {
  path: string;
  calls: ScriptMacroCall[];
}

export interface ScriptMacroEditDocument {
  path: string;
  line: number;
  macroName: string;
  sourceHash: string;
  sourceLine: string;
  arguments: string[];
  editableArgumentDomains: Array<{
    index: number;
    domainIds: string[];
  }>;
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

export interface PokemonEditSourceDocument {
  path: string;
  sourceHash: string;
}

export interface PokemonSpriteChoice {
  id: string;
  label: string;
  frontLabel: string;
  backLabel: string;
  dimensionPath: string;
  frontAssetPath: string;
  backAssetPath: string;
}

export interface PokemonPaletteChoice {
  constant: string;
  cgbColors: [string, string, string, string] | null;
  sgbColors: [string, string, string, string] | null;
}

export interface PokemonPokedexEditValues {
  category: string;
  heightFeet: number;
  heightInches: number;
  weightTenthsLb: number;
  textLines: PokedexTextLine[];
}

export interface PokemonEditValues {
  displayName: string;
  hp: number;
  attack: number;
  defense: number;
  speed: number;
  special: number;
  type1: string;
  type2: string;
  catchRate: number;
  baseExp: number;
  growthRate: string;
  startingMoves: string[];
  spriteChoiceId: string;
  paletteConstant: string;
  cgbPalette: [string, string, string, string] | null;
  sgbPalette: [string, string, string, string] | null;
  evolutions: Evolution[];
  learnset: LearnsetMove[];
  tmhmMoves: string[];
  pokedex: PokemonPokedexEditValues | null;
}

export interface PokemonEditOptions {
  types: string[];
  growthRates: string[];
  moves: string[];
  species: string[];
  items: string[];
  evolutionItems: string[];
  maxEvolutions: number;
  tmhmMoves: string[];
  spriteChoices: PokemonSpriteChoice[];
  paletteChoices: PokemonPaletteChoice[];
}

export interface PokemonEditDocument {
  internalId: number;
  sourceSlug: string;
  dexConstant: string;
  sources: PokemonEditSourceDocument[];
  values: PokemonEditValues;
  options: PokemonEditOptions;
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
  method: "level" | "item" | "trade" | "move";
  level: number | null;
  item: string | null;
  move: string | null;
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

export type ItemKind = "item" | "key-item" | "tm" | "hm" | "unused";

export type ItemMenuBehavior = "direct" | "party" | "overworld" | "tmhm" | "unusable";

export interface ItemData {
  id: number;
  constant: string;
  name: string;
  kind: ItemKind;
  price: number | null;
  keyItem: boolean;
  useRoutine: string | null;
  menuBehavior: ItemMenuBehavior;
  machineNumber: number | null;
  moveConstant: string | null;
}

export interface PokemonTmhmCompatibilityReference {
  internalId: number;
  constant: string;
  displayName: string;
  sourceSlug: string;
}

export interface PokemonCatchProfile {
  internalId: number;
  constant: string;
  displayName: string;
  catchRate: number;
}

export interface TmEditSourceDocument {
  path: string;
  sourceHash: string;
}

export interface TmEditDocument {
  itemId: number;
  tmNumber: number;
  moveConstant: string;
  affectedPokemon: PokemonTmhmCompatibilityReference[];
  replacementMoveConstants: string[];
  sources: TmEditSourceDocument[];
}

export interface TmEditValues {
  moveConstant: string;
  retainedPokemonIds: number[];
}

export interface ItemEditSourceDocument {
  path: string;
  sourceHash: string;
}

export interface BallRoutineParameters {
  kind: "ball";
  masterBallGuaranteed: boolean;
  greatRandomCeiling: number;
  ultraSafariRandomCeiling: number;
  minorStatusCatchBonus: number;
  majorStatusCatchBonus: number;
  greatHpDivisor: number;
  otherHpDivisor: number;
  currentHpDivisor: number;
  pokeShakeDivisor: number;
  greatShakeDivisor: number;
  ultraSafariShakeDivisor: number;
  minorStatusShakeBonus: number;
  majorStatusShakeBonus: number;
  shakeOneThreshold: number;
  shakeTwoThreshold: number;
  shakeThreeThreshold: number;
}

export interface FixedHealingRoutineParameters {
  kind: "fixed-heal";
  healAmount: number;
}

export interface SpecialHealingRoutineParameters {
  kind: "special-heal";
  behavior: "full-hp" | "half-max-hp" | "full-hp-and-status" | "status-only";
  description: string;
}

export interface RepelRoutineParameters {
  kind: "repel";
  steps: number;
}

export interface VitaminRoutineParameters {
  kind: "vitamin";
  stat: "HP" | "Attack" | "Defense" | "Speed" | "Special";
  statExpAdded: number;
  useThreshold: number;
  sharedConstants: string[];
}

export interface ReviveRoutineParameters {
  kind: "revive";
  restoreMode: "quarter" | "half" | "full";
  editable: boolean;
}

export interface PpRestoreRoutineParameters {
  kind: "pp-restore";
  fullRestore: boolean;
  restoreAmount: number | null;
  sharedConstants: string[];
}

export interface PpUpRoutineParameters {
  kind: "pp-up";
  bonusDivisor: number;
  perUseCap: number;
  maxUses: number;
}

export interface BicycleRoutineParameters {
  kind: "bicycle";
  speedMultiplier: 1 | 2 | 4;
  sourceVariant: "pokered" | "pokeyellow";
}

export type StatusCureEffect =
  | "poison"
  | "burn"
  | "freeze"
  | "sleep"
  | "paralysis"
  | "all";

export interface StatusCureRoutineParameters {
  kind: "status-cure";
  effect: StatusCureEffect;
}

export interface XStatRoutineParameters {
  kind: "x-stat";
  stat: "Attack" | "Defense" | "Speed" | "Special";
  stageBoost: 1 | 2;
  sharedConstants: string[];
}

export type BattleFlagEffect = "x-accuracy" | "mist" | "focus-energy";

export interface BattleFlagRoutineParameters {
  kind: "battle-flag";
  effect: BattleFlagEffect;
}

export interface EvolutionStoneReference {
  internalId: number;
  sourceConstant: string;
  sourceDisplayName: string;
  targetConstant: string;
  targetDisplayName: string;
  minimumLevel: number;
  evolutionIndex: number;
  itemConstant: string;
}

export interface EvolutionStoneRoutineParameters {
  kind: "evolution-stone";
  stoneConstants: string[];
  references: EvolutionStoneReference[];
}

export interface ItemEvolutionEditData {
  triggerMode: "native" | "medicine";
  runtimeEnabled: boolean;
  eligibleItemConstants: string[];
  references: EvolutionStoneReference[];
}

export interface GenericItemRoutineParameters {
  kind: "routine";
  description: string;
}

export type ItemRoutineParameters =
  | BallRoutineParameters
  | FixedHealingRoutineParameters
  | SpecialHealingRoutineParameters
  | RepelRoutineParameters
  | VitaminRoutineParameters
  | ReviveRoutineParameters
  | PpRestoreRoutineParameters
  | PpUpRoutineParameters
  | BicycleRoutineParameters
  | StatusCureRoutineParameters
  | XStatRoutineParameters
  | BattleFlagRoutineParameters
  | EvolutionStoneRoutineParameters
  | GenericItemRoutineParameters;

export interface ItemEditDocument {
  itemId: number;
  constant: string;
  name: string;
  price: number;
  keyItem: boolean;
  useRoutine: string | null;
  maxNameLength: number;
  routineParameters: ItemRoutineParameters;
  itemEvolution: ItemEvolutionEditData | null;
  sources: ItemEditSourceDocument[];
}

export interface ItemEditValues {
  name: string;
  price: number;
  keyItem: boolean;
  routineParameters: ItemRoutineParameters;
  itemEvolution: ItemEvolutionEditData | null;
}

export type ItemCreateTemplate =
  | "unusable"
  | "evolution"
  | "repel"
  | "super-repel"
  | "max-repel"
  | "x-accuracy"
  | "guard-spec"
  | "dire-hit"
  | "escape-rope"
  | "bicycle"
  | "poke-doll";

export interface ItemCreateSlot {
  id: number;
  constant: string;
  displayName: string;
}

export interface ItemCreateSourceDocument {
  path: string;
  sourceHash: string;
}

export interface ItemCreateDocument {
  slots: ItemCreateSlot[];
  maxNameLength: number;
  sources: ItemCreateSourceDocument[];
}

export interface ItemCreateValues {
  slotId: number;
  constant: string;
  name: string;
  price: number;
  keyItem: boolean;
  template: ItemCreateTemplate;
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

export type TrainerPicOverrideSourceKind = "editor-table" | "legacy-engine";

export interface TrainerPresentation {
  classConstant: string;
  partyNumber: number;
  basePicLabel: string | null;
  baseSpritePath: string | null;
  baseSpriteSourcePath: string | null;
  legacyPicLabel: string | null;
  editorPicLabel: string | null;
  picLabel: string | null;
  spritePath: string | null;
  spriteSourcePath: string | null;
  picOverrideSourceKind: TrainerPicOverrideSourceKind | null;
  picOverrideSourcePath: string | null;
  availablePicLabels: string[];
  paletteConstant: string | null;
  paletteOptions: PokemonPaletteOption[];
}

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

export type TrainerInteractionDialogueRole =
  | "before-battle"
  | "player-wins"
  | "player-loses"
  | "post-battle"
  | "reward";

export interface TrainerInteractionDialogue extends TrainerDialogue {
  id: string;
  role: TrainerInteractionDialogueRole;
  title: string;
}

export interface TrainerInteractionReward {
  id: string;
  kind: "item" | "badge";
  constant: string;
  quantity: number | null;
  sourcePath: string | null;
  sourceLine: number | null;
}

export interface TrainerRewardItemOption {
  constant: string;
  label: string;
  kind: "item" | "tm" | "hm";
}

export interface TrainerRewardEditDocument {
  path: string;
  sourceLine: number;
  sourceHash: string;
  itemConstant: string;
  quantity: number;
  itemOptions: TrainerRewardItemOption[];
}

export interface TrainerInteraction {
  dialogues: TrainerInteractionDialogue[];
  rewards: TrainerInteractionReward[];
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
  interaction: TrainerInteraction;
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
  interaction: TrainerInteraction;
}

export interface TrainerClassEntry {
  constant: string;
  name: string;
  picLabel: string | null;
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

export interface TrainerClassCreateValues {
  constant: string;
  name: string;
  portraitClassConstant: string;
  baseRewardPerLevel: number;
  aiRoutine: string;
  aiUsesPerPokemon: number;
  moveChoiceModifiers: number[];
  initialParty: {
    partyFormat: TrainerPartyFormat;
    pokemon: Array<{
      level: number;
      speciesConstant: string;
    }>;
  };
}

export interface TrainerClassEditValues {
  name: string;
  picLabel: string;
  baseRewardPerLevel: number;
  aiRoutine: string;
  aiUsesPerPokemon: number;
  moveChoiceModifiers: number[];
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

export interface MapLocationReference {
  constant: string;
  displayName: string;
}

export interface EncounterTableIndexEntry {
  path: string;
  tableLabel: string;
  displayName: string;
  versions: EncounterVersion[];
  hasGrass: boolean;
  hasWater: boolean;
  affectedLocations: string[];
  affectedMaps: MapLocationReference[];
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
  affectedMaps: MapLocationReference[];
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

export interface HistorySelectiveUndoBlock {
  entryId: string;
  label: string;
  files: string[];
}

export interface HistoryTimelineEntry {
  id: string;
  timestamp: string;
  label: string;
  files: string[];
  applied: boolean;
  cursorAfter: number;
  canSelectiveUndo: boolean;
  selectiveUndoReason: string | null;
  selectiveUndoBlockedBy: HistorySelectiveUndoBlock[];
}

export interface HistoryTimeline {
  cursor: number;
  entryCount: number;
  persistent: boolean;
  entries: HistoryTimelineEntry[];
}

export interface ProjectSnapshot {
  fileName: string;
  bytes: Uint8Array;
  historyCursor: number;
  historyEntryCount: number;
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
export type BuildBackend = "desktop-wasm" | "web-wasm";
export type BuildToolchainSource = "bundled" | "unavailable";

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
  listFiles?(): Promise<string[]>;
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
  getPokemonEditDocument(
    internalId: number,
    sourceSlug: string,
  ): Promise<PokemonEditDocument>;
  savePokemon(
    internalId: number,
    sourceSlug: string,
    sources: PokemonEditSourceDocument[],
    values: PokemonEditValues,
  ): Promise<HistorySummary>;
  getMoves(): Promise<MoveData[]>;
  getItems(): Promise<ItemData[]>;
  getPokemonCatchProfiles(): Promise<PokemonCatchProfile[]>;
  getTmhmCompatibility(moveConstant: string): Promise<PokemonTmhmCompatibilityReference[]>;
  getTmEditDocument(itemId: number): Promise<TmEditDocument>;
  saveTmEdit(document: TmEditDocument, values: TmEditValues): Promise<HistorySummary>;
  getItemEditDocument(itemId: number): Promise<ItemEditDocument>;
  saveItemEdit(document: ItemEditDocument, values: ItemEditValues): Promise<HistorySummary>;
  getItemCreateDocument(): Promise<ItemCreateDocument>;
  createItem(
    document: ItemCreateDocument,
    values: ItemCreateValues,
  ): Promise<HistorySummary>;
  getMapIndex(): Promise<MapIndexEntry[]>;
  getMapVisualization(mapConstant: string): Promise<MapVisualization>;
  getScriptCatalog(): Promise<ScriptCatalog>;
  getScriptAudit(): Promise<ScriptAuditReport>;
  getScriptDocument(path: string): Promise<ScriptDocument>;
  getMacroCatalog(): Promise<MacroCatalog>;
  getScriptMacroCalls(path: string): Promise<ScriptMacroCallDocument>;
  getScriptMacroEditDocument(
    path: string,
    line: number,
  ): Promise<ScriptMacroEditDocument>;
  saveScriptMacroCall(
    path: string,
    line: number,
    macroName: string,
    expectedHash: string,
    arguments_: string[],
  ): Promise<HistorySummary>;
  getTrainers(onProgress?: TrainerLoadProgressListener): Promise<TrainerCatalog>;
  getTrainerPresentation(
    classConstant: string,
    partyNumber: number,
  ): Promise<TrainerPresentation>;
  saveTrainerPicOverride(
    classConstant: string,
    partyNumber: number,
    picLabel: string | null,
  ): Promise<HistorySummary>;
  getTrainerRewardEditDocument(
    path: string,
    sourceLine: number,
  ): Promise<TrainerRewardEditDocument>;
  saveTrainerReward(
    path: string,
    sourceLine: number,
    expectedHash: string,
    itemConstant: string,
    quantity: number,
  ): Promise<HistorySummary>;
  saveTrainerParty(
    partyId: string,
    sourceLine: number,
    sources: TrainerEditSourceDocument[],
    values: TrainerPartyEditValues,
    knownSpecies: string[],
    knownMoves: string[],
  ): Promise<HistorySummary>;
  createTrainerClass(
    sources: TrainerEditSourceDocument[],
    values: TrainerClassCreateValues,
    knownSpecies: string[],
  ): Promise<HistorySummary>;
  saveTrainerClass(
    classConstant: string,
    sources: TrainerEditSourceDocument[],
    values: TrainerClassEditValues,
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
  getHistoryTimeline(): Promise<HistoryTimeline>;
  selectivelyUndoHistoryEntry(entryId: string): Promise<HistorySummary>;
  exportProjectSnapshot(historyCursor?: number): Promise<ProjectSnapshot>;
  saveTextChanges(label: string, changes: TextWriteRequest[]): Promise<HistorySummary>;
  undoLastSave(): Promise<HistorySummary>;
  redoLastUndo(): Promise<HistorySummary>;
  getBuildEnvironment(): Promise<BuildEnvironment>;
  getSaveCompatibility(target: BuildTarget): Promise<SaveCompatibilityDescriptor>;
  buildRom(target: BuildTarget, onProgress?: BuildProgressListener): Promise<BuildResult>;
  dispose(): void;
}
