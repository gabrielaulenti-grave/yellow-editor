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

export interface ScriptNamedHelperSemantic {
  name: string;
  family: ScriptSemanticFamilyId;
  title: string;
  description: string;
}

export const SCRIPT_NAMED_HELPER_SEMANTICS: readonly ScriptNamedHelperSemantic[] = [
  { name: "CeruleanHideRocket", family: "object", title: "Hide defeated Rocket", description: "Update the Cerulean Rocket object's visibility after the story event." },
  { name: "PewterJigglypuff", family: "service", title: "Run Jigglypuff interaction", description: "Run the Pewter Center Jigglypuff interaction." },
  { name: "SurfingPikachuMinigame", family: "service", title: "Start Surfing Pikachu minigame", description: "Enter the Surfing Pikachu minigame flow." },
  { name: "SaveGameData", family: "service", title: "Save game data", description: "Persist the current game state." },
  { name: "GiveFossilToCinnabarLab", family: "service", title: "Submit fossil for revival", description: "Hand a fossil to the Cinnabar Lab revival service." },
  { name: "DisplayNameRaterScreen", family: "service", title: "Open Name Rater", description: "Open the Pokémon nickname service." },
  { name: "RemoveGuardDrink", family: "item", title: "Give drink to Saffron guard", description: "Consume the qualifying drink and unlock the shared Saffron guard state." },
  { name: "SchedulePikachuSpawnForAfterText", family: "object", title: "Schedule Pikachu appearance", description: "Arrange for Pikachu's overworld sprite to appear after dialogue." },
  { name: "RemovePokemon", family: "party", title: "Remove selected Pokémon", description: "Remove the selected Pokémon from the current party/service slot." },
  { name: "RemoveItemFromInventory", family: "item", title: "Remove item from inventory", description: "Consume or remove an item from the player's inventory." },
  { name: "PrintText_NoCreatingTextBox", family: "dialogue", title: "Show dialogue in existing text box", description: "Print text without creating a new dialogue box." },
  { name: "MoveMon", family: "party", title: "Move Pokémon data", description: "Move a Pokémon between party/service storage structures." },
  { name: "LoadMonData", family: "party", title: "Load selected Pokémon data", description: "Load the selected Pokémon's data for a service interaction." },
  { name: "EnablePikachuOverworldSpriteDrawing", family: "object", title: "Show Pikachu overworld sprite", description: "Enable Pikachu's follower sprite rendering." },
  { name: "DisablePikachuOverworldSpriteDrawing", family: "object", title: "Hide Pikachu overworld sprite", description: "Disable Pikachu's follower sprite rendering." },
  { name: "DisplayTextBoxID", family: "dialogue", title: "Display text box", description: "Display a standard text/menu box." },
  { name: "DisableWaitingAfterTextDisplay", family: "scene-control", title: "Auto-advance dialogue", description: "Do not wait for a button press after the next dialogue." },
  { name: "CountSetBits", family: "condition", title: "Count set flags", description: "Count enabled bits for a later threshold condition." },
  { name: "CheckPikachuFollowingPlayer", family: "condition", title: "Check whether Pikachu is following", description: "Branch according to Pikachu's follower state." },
  { name: "AddPartyMon", family: "party", title: "Add Pokémon to party", description: "Add the prepared Pokémon to the player's party." },
  { name: "PlayPikachuSoundClip", family: "music", title: "Play Pikachu reaction sound", description: "Play the selected Pikachu voice/reaction clip." },
  { name: "CheckPikachuStatusCondition", family: "condition", title: "Check Pikachu status", description: "Branch on Pikachu's current status condition." },
  { name: "LoadItemList", family: "service", title: "Load menu choices", description: "Prepare a project-defined item/destination list for a menu." },
  { name: "GetMonName", family: "party", title: "Read Pokémon name", description: "Load a Pokémon name for dialogue or service output." },
  { name: "EndTrainerBattle", family: "trainer", title: "Resolve trainer battle", description: "Apply the standard post-battle trainer state." },
  { name: "DisplayEnemyTrainerTextAndStartBattle", family: "trainer", title: "Start trainer battle", description: "Show trainer encounter text and begin the selected battle." },
  { name: "CheckFightingMapTrainers", family: "trainer", title: "Check nearby trainers", description: "Run the standard map-trainer sight/engagement check." },
  { name: "ArePlayerCoordsInArray", family: "condition", title: "Check player coordinates", description: "Branch according to whether the player's coordinates match a scripted trigger table." },
  { name: "HallOfFamePC", family: "service", title: "Register Hall of Fame", description: "Run Hall of Fame registration and championship persistence." },
  { name: "WriteMonMoves", family: "party", title: "Write Pokémon moves", description: "Apply the selected move set to a Pokémon." },
  { name: "SubBCDPredef", family: "economy", title: "Subtract currency value", description: "Subtract a packed-BCD money/currency value." },
  { name: "FindPathToPlayer", family: "movement", title: "Find path to player", description: "Generate an NPC path toward the player's current position." },
  { name: "DivideBCDPredef3", family: "economy", title: "Divide currency value", description: "Perform packed-BCD division for service pricing or resource calculation." },
  { name: "DisplayDexRating", family: "service", title: "Show Pokédex rating", description: "Display Oak's Pokédex completion evaluation." },
  { name: "CalcPositionOfPlayerRelativeToNPC", family: "movement", title: "Calculate player-relative path", description: "Calculate player/NPC relative positioning for scripted movement." },
  { name: "AddBCDPredef", family: "economy", title: "Add currency value", description: "Add a packed-BCD money/currency value." },
  { name: "EmotionBubble", family: "service", title: "Show emotion bubble", description: "Display a scripted reaction bubble over a character." },
  { name: "GetQuantityOfItemInBag", family: "item", title: "Read item quantity", description: "Read how many of the selected item the player has." },
] as const;

export function namedScriptHelperSemantic(name: string): ScriptNamedHelperSemantic | null {
  return SCRIPT_NAMED_HELPER_SEMANTICS.find((helper) => helper.name === name) ?? null;
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
  "SetSpriteMovementBytesToFF",
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
