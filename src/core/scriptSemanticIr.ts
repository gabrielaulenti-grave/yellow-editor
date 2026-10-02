export const SCRIPT_SEMANTIC_IR_VERSION = "1.1";

export type ScriptSemanticFamilyId =
  | "dialogue"
  | "condition"
  | "event"
  | "state-transition"
  | "movement"
  | "forced-movement"
  | "wait"
  | "scene-control"
  | "facing"
  | "object"
  | "map-edit"
  | "warp"
  | "battle"
  | "trainer"
  | "item"
  | "service"
  | "economy"
  | "party"
  | "recovery"
  | "music"
  | "screen"
  | "indexed-event"
  | "persistent-object-puzzle";

export interface ScriptSemanticFamilyDefinition {
  id: ScriptSemanticFamilyId;
  label: string;
  description: string;
  builderPriority: "core" | "advanced";
}

export const SCRIPT_SEMANTIC_FAMILIES: readonly ScriptSemanticFamilyDefinition[] = [
  { id: "dialogue", label: "Dialogue", description: "Show text and control dialogue progression.", builderPriority: "core" },
  { id: "condition", label: "Conditions", description: "Branch on comparisons, flags, menu choices, battle results, and other script state.", builderPriority: "core" },
  { id: "event", label: "Events", description: "Check, set, reset, or update groups of persistent event flags.", builderPriority: "core" },
  { id: "state-transition", label: "Script states", description: "Move between map script states and preserve intentional fall-through.", builderPriority: "core" },
  { id: "movement", label: "Character movement", description: "Run literal or project-derived NPC and player movement paths.", builderPriority: "core" },
  { id: "forced-movement", label: "Forced movement", description: "Temporarily drive player movement from coordinate, spinner, current, or gate logic.", builderPriority: "core" },
  { id: "wait", label: "Wait and timing", description: "Pause a scene for a fixed or state-dependent duration before continuing.", builderPriority: "core" },
  { id: "scene-control", label: "Scene controls", description: "Temporarily restrict input, auto-advance dialogue, or synchronize scripted scene state.", builderPriority: "advanced" },
  { id: "facing", label: "Facing", description: "Turn the player, NPCs, or sprite slots.", builderPriority: "core" },
  { id: "object", label: "Objects", description: "Show, hide, or otherwise stage map objects.", builderPriority: "core" },
  { id: "map-edit", label: "Map changes", description: "Replace loaded map blocks and apply persistent puzzle or door changes.", builderPriority: "core" },
  { id: "warp", label: "Map transitions", description: "Handle normal, elevator, dungeon, and fall-hole transitions.", builderPriority: "core" },
  { id: "battle", label: "Encounters", description: "Start trainer, wild, or scripted special encounters and react to their results.", builderPriority: "core" },
  { id: "trainer", label: "Trainer interactions", description: "Use trainer headers, sight ranges, battle text, and post-battle state.", builderPriority: "core" },
  { id: "item", label: "Items and rewards", description: "Give, remove, check, or name items while handling bag-full outcomes.", builderPriority: "core" },
  { id: "service", label: "Services and menus", description: "Model reusable interactions such as aides, daycare, elevators, trades, admission, and naming.", builderPriority: "advanced" },
  { id: "economy", label: "Money and currency", description: "Check affordability and add or subtract money or coins.", builderPriority: "advanced" },
  { id: "party", label: "Party selection", description: "Select party members and branch on ownership, moves, party capacity, or Pokémon state.", builderPriority: "advanced" },
  { id: "recovery", label: "Recovery", description: "Heal the party and related service state.", builderPriority: "core" },
  { id: "music", label: "Music and sound", description: "Play encounter music, cries, sound effects, or return to map music.", builderPriority: "advanced" },
  { id: "screen", label: "Presentation", description: "Fade, refresh, or synchronize presentation around gameplay actions.", builderPriority: "advanced" },
  { id: "indexed-event", label: "Indexed events", description: "Address a persistent event family by runtime index, as used by badge gates, gym gates, and card-key doors.", builderPriority: "advanced" },
  { id: "persistent-object-puzzle", label: "Persistent object puzzles", description: "React to pushed objects reaching switches or holes, persist the result, and update objects or map blocks across floors.", builderPriority: "advanced" },
] as const;

export const SCRIPT_ENGINE_INTERNAL_CALLS = new Set([
  "Bankswitch",
  "ReloadMapData",
  "LoadSmokeTileFourTimes",
  "ShakeElevator",
  "GetSpritePosition1",
  "GBPalWhiteOutWithDelay3",
  "AddNTimes",
  "BankswitchCommon",
  "BankswitchHome",
  "ClearSprites",
  "CopyData",
  "DebugPressedOrHeldB",
  "EnableAutoTextBoxDrawing",
  "FillMemory",
  "UpdateSprites",
  "WaitForSoundToFinish",
  "PlaySound",
  "PlaySoundWaitForCurrent",
  "StopAllMusic",
  "GBFadeOutToBlack",
  "GBFadeInFromBlack",
  "GBFadeOutToWhite",
  "GBFadeInFromWhite",
  "SaveScreenTilesToBuffer1",
  "SaveScreenTilesToBuffer2",
  "LoadScreenTilesFromBuffer1",
  "LoadScreenTilesFromBuffer2",
  "LoadGBPal",
  "LoadGymLeaderAndCityName",
  "LoadPlayerSpriteGraphics",
  "ReloadTilesetTilePatterns",
  "RestoreScreenTilesAndReloadTilePatterns",
  "Serial_TryEstablishingExternallyClockedConnection",
  "SetMapTextPointer",
  "WaitForTextScrollButtonPress",
  "CopyScreenTileBufferToVRAM",
  "SetSpritePosition1",
  "SetSpritePosition2",
  "SpriteFunc_34a1",
  "GetSpritePosition2",
]);

export function isScriptEngineInternalCall(name: string): boolean {
  return SCRIPT_ENGINE_INTERNAL_CALLS.has(name)
    || /^UpdateCGBPal_/i.test(name)
    || /^Schedule(?:East|West|North|South)/i.test(name)
    || /^LoadSmokeTile/i.test(name)
    || /^WriteOAM/i.test(name)
    || /^CopyVideoData/i.test(name)
    || /ConvertBCDtoNumber$/i.test(name);
}

export const SCRIPT_ENGINE_INTERNAL_MACROS = new Set([
  "lb",
  "coord",
  "bccoord",
  "decoord",
  "hlcoord",
  "dbcoord",
  "dbmapcoord",
  "dwcoord",
  "def_text_pointers",
  "dw_const",
  "def_script_pointers",
  "vc_patch",
]);

export function isScriptEngineInternalMacro(name: string): boolean {
  return SCRIPT_ENGINE_INTERNAL_MACROS.has(name.toLowerCase());
}


export interface ScriptRegressionFixtureDefinition {
  id: string;
  label: string;
  paths: readonly string[];
  purpose: string;
}

export const SCRIPT_REGRESSION_FIXTURES: readonly ScriptRegressionFixtureDefinition[] = [
  {
    id: "oaks-lab",
    label: "Oak's Lab",
    paths: ["scripts/OaksLab.asm"],
    purpose: "Starter choice, rival battle, gifts, state transitions, and multi-stage story flow.",
  },
  {
    id: "bills-house",
    label: "Bill's House",
    paths: ["scripts/BillsHouse.asm"],
    purpose: "Conditional dialogue, object staging, movement, and service-style state progression.",
  },
  {
    id: "mt-moon-b2f",
    label: "Mt. Moon B2F",
    paths: ["scripts/MtMoonB2F.asm"],
    purpose: "Dense state machine, fossil choice, special battle staging, and project-derived movement.",
  },
  {
    id: "daycare",
    label: "Daycare",
    paths: ["scripts/Daycare.asm"],
    purpose: "Party selection, service menus, money, level calculations, and resumable interaction flow.",
  },
  {
    id: "cinnabar-gym",
    label: "Cinnabar Gym",
    paths: ["scripts/CinnabarGym.asm"],
    purpose: "Indexed event addressing and persistent gate state.",
  },
  {
    id: "safari-zone-gate",
    label: "Safari Zone Gate",
    paths: ["scripts/SafariZoneGate.asm", "scripts/SafariZoneGate_2.asm"],
    purpose: "Admission, currency, session resources, timers, and entrance/exit state.",
  },
  {
    id: "seafoam",
    label: "Seafoam Islands",
    paths: [
      "scripts/SeafoamIslands1F.asm",
      "scripts/SeafoamIslandsB1F.asm",
      "scripts/SeafoamIslandsB2F.asm",
      "scripts/SeafoamIslandsB3F.asm",
      "scripts/SeafoamIslandsB4F.asm",
    ],
    purpose: "Persistent Strength boulders, holes, dungeon warps, and forced-current movement.",
  },
  {
    id: "victory-road",
    label: "Victory Road",
    paths: [
      "scripts/VictoryRoad1F.asm",
      "scripts/VictoryRoad2F.asm",
      "scripts/VictoryRoad3F.asm",
    ],
    purpose: "Strength switches, cross-floor boulders, persistent block changes, and special encounters.",
  },
  {
    id: "silph-11f",
    label: "Silph Co. 11F",
    paths: ["scripts/SilphCo11F.asm", "scripts/SilphCo11F_2.asm"],
    purpose: "Large staged encounter state machine, boss battle, object cleanup, and coordinate-dependent movement.",
  },
] as const;
