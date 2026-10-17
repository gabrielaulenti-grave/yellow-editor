import { buildScenePlan, needsScene, prepareSceneRuntime, renderScene, sceneRootHook, type SceneDomain, type SceneOptions, type ScenePlan } from "./interactionScene";
import { InteractionValidationError, type InteractionCheckReport } from "./interactionValidation";
import { npcSpriteCatalog } from "./npcSprites";
import { inspectSceneEmotes } from "./sceneEmotes";
import { inspectSceneEffects, type SceneEffectsDomain } from "./sceneEffects";
import { deriveProjectEventMacroSemantics } from "./eventMacroSemantics";
import { hashText } from "./history";
import { identifySequenceDialogue, renderInteractionSequence, sequenceDialogue, sequenceDialoguePrompts, validateInteractionSequence, type InteractionAction } from "./interactionSequence";
import { reviewScriptEngineContracts } from "./scriptEngineContracts";
import { evaluateRgbdsExpression, projectConstantCatalogFromSources, readProjectRgbdsSources } from "./projectConstants";
import { parseMapIndex } from "./mapVisualization";
import { applyTextDocumentEdits, attachTextEditing, parseTextDocument, type TextSegmentControl } from "./textEditing";
import type { ProjectSession, ProjectSource, TextWriteRequest } from "./types";

export interface InteractionValues {
  scene?: SceneOptions;
  actions?: InteractionAction[];
  showOriginal: boolean;
  once: boolean;
  dialogue: string[];
  bagFull: string[];
  already: string[];
  reward: { item: string; quantity: number } | null;
  pokemon?: { species: string; level: number } | null;
  hideObject?: string | null;
  movement: { npc: string; steps: string[]; playerX: number; playerY: number } | null;
  condition: { event: string; set: boolean } | null;
  events: Array<{ event: string; set: boolean }>;
}
export interface ManagedInteraction {
  scene?: ScenePlan;
  version: 1 | 2 | 3;
  originalHasPrompt?: boolean;
  label: string;
  prefix: string;
  flag: string | null;
  arrival: string | null;
  cleanup: string | null;
  arrivalId: number | null;
  cleanupId: number | null;
  idleStates?: number[];
  values: InteractionValues;
}
export interface RewardDocument {
  path: string;
  label: string;
  sourceHash: string;
  line: number;
  item: string;
  quantity: number;
  earlyFlag: string | null;
}
export interface PokemonGiftDocument {
  path: string;
  label: string;
  sourceHash: string;
  line: number;
  species: string;
  level: number;
  hidesObject: boolean;
}
export interface InteractionDocument {
  projectKey: string;
  effects: SceneEffectsDomain;
  scene: SceneDomain;
  path: string;
  label: string;
  sources: Array<{ path: string; hash: string }>;
  items: string[];
  pokemon: string[];
  pokemonReason: string | null;
  hideObject: string | null;
  events: string[];
  sounds: string[];
  choiceReason: string | null;
  soundReason: string | null;
  reward: RewardDocument | null;
  gift: PokemonGiftDocument | null;
  canCreate: boolean;
  reason: string | null;
  values: InteractionValues;
  npcs: Array<{ constant: string; x: number; y: number }>;
  movementReason: string | null;
  sign: { x: number; y: number } | null;
}
const namePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
const clean = (line: string) => line.split(";", 1)[0].trim();
const rows = (text: string) => text.split(/\r?\n/);
const defaults = (): InteractionValues => ({ showOriginal: true, once: true, dialogue: ["Here you go!"], bagFull: ["Your BAG is full."], already: ["Come back soon!"], reward: null, pokemon: null, hideObject: null, movement: null, condition: null, events: [] });

function range(text: string, label: string) {
  const all = rows(text);
  const start = all.findIndex(line => new RegExp(`^${label}:{1,2}$`).test(clean(line)));
  if (start < 0 || all.filter(line => new RegExp(`^${label}:{1,2}$`).test(clean(line))).length !== 1) throw new Error(`Expected one ${label} definition.`);
  let end = start + 1;
  while (end < all.length && !/^[A-Za-z_][A-Za-z0-9_]*:{1,2}$/.test(clean(all[end]))) end++;
  const offsets = [0];
  for (const m of text.matchAll(/\n/g)) offsets.push(m.index + 1);
  return { start, end, from: offsets[start], to: offsets[end] ?? text.length, all, body: all.slice(start + 1, end) };
}
function replaceBlock(text: string, label: string, body: string) {
  const r = range(text, label);
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  return text.slice(0, r.from) + body.replace(/\n/g, nl) + text.slice(r.to);
}
function managed(text: string, label: string): ManagedInteraction | null {
  const match = range(text, label).body.find(line => /^\s*; yellow-editor-interaction: /.test(line));
  if (!match) return null;
  const value = JSON.parse(match.replace(/^\s*; yellow-editor-interaction: /, "")) as ManagedInteraction;
  if (![1, 2, 3].includes(value.version) || value.label !== label || !namePattern.test(value.prefix)) throw new Error("Unsupported interaction format. Review its source before editing.");
  return value;
}
function macro(files: Map<string, string>, path: string, name: string, body: string) {
  const matches = [...(files.get(path) ?? "").matchAll(new RegExp(`^MACRO ${name}\\r?\\n([\\s\\S]*?)^ENDM`, "gm"))];
  if (matches.length !== 1 || rows(matches[0][1]).map(clean).filter(Boolean).join("\n") !== body) throw new Error(`Interaction generation needs a reviewed ${name} macro.`);
}

// Reviewed Red/Yellow delivery contract. Ignore comments and the extra Yellow
// text terminator, but refuse changed branches or success/carry conventions.
function pokemonDeliveryReason(files: Map<string, string>): string | null {
  try {
    const wrapper = range(files.get("home/give.asm") ?? "", "GivePokemon").body.map(clean).filter(Boolean).join("\n");
    if (wrapper !== "ld a, b\nld [wCurPartySpecies], a\nld a, c\nld [wCurEnemyLevel], a\nxor a\nld [wMonDataLocation], a\nfarjp _GivePokemon") throw new Error("wrapper");
    const body = range(files.get("engine/events/give_pokemon.asm") ?? "", "_GivePokemon").body.map(clean).filter(Boolean).join("\n").replace("ld hl, UnknownTerminator_f6794\ncall PrintText\n", "");
    const reviewed = `call EnableAutoTextBoxDrawing
xor a
ld [wAddedToParty], a
ld a, [wPartyCount]
cp PARTY_LENGTH
jr c, .addToParty
ld a, [wBoxCount]
cp MONS_PER_BOX
jr nc, .boxFull
xor a
ld [wEnemyBattleStatus3], a
ld a, [wCurPartySpecies]
ld [wEnemyMonSpecies2], a
callfar LoadEnemyMonData
call SetPokedexOwnedFlag
callfar SendNewMonToBox
ld hl, wStringBuffer
ld a, [wCurrentBoxNum]
and BOX_NUM_MASK
cp 9
jr c, .singleDigitBoxNum
sub 9
ld [hl], '1'
inc hl
add '0'
jr .next
.singleDigitBoxNum
add '1'
.next
ld [hli], a
ld [hl], '@'
ld hl, SentToBoxText
call PrintText
scf
ret
.boxFull
ld hl, BoxIsFullText
call PrintText
and a
ret
.addToParty
call SetPokedexOwnedFlag
call AddPartyMon
ld a, 1
ld [wDoNotWaitForButtonPressAfterDisplayingText], a
ld [wAddedToParty], a
scf
ret`;
    if (body !== reviewed) throw new Error("delivery");
    return null;
  } catch { return "Pokémon gifts require the reviewed party/PC delivery routine. This project's routine differs."; }
}

async function inspect(source: ProjectSource, path: string, label: string) {
  if (!/^scripts\/[A-Za-z_][A-Za-z0-9_]*(?:_2)?\.asm$/.test(path) || !namePattern.test(label)) throw new Error("Choose a map interaction entry.");
  const files = await readProjectRgbdsSources(source);
  if (files.some(file => file.readError)) throw new Error("Could not read all script dependencies.");
  const byPath = new Map(files.map(file => [file.path, file.contents]));
  const text = byPath.get(path);
  if (text === undefined) throw new Error("Interaction source is missing.");
  const constants = projectConstantCatalogFromSources(files.filter(file => file.path.startsWith("constants/")));
  const symbols = new Map(constants.constants.map(entry => [entry.symbol, entry.value]));
  const number = (expression: string) => evaluateRgbdsExpression(expression, symbols);
  let eventValue = 0;
  for (const row of rows(byPath.get("constants/event_constants.asm") ?? "")) {
    const line = clean(row);
    const directive = line.match(/^(const_def|const_next|const_skip)(?:\s+(.+))?$/);
    if (directive) {
      const value = number(directive[2] ?? (directive[1] === "const_def" ? "0" : "1"));
      if (value === null) throw new Error("Cannot derive the event flag layout.");
      eventValue = directive[1] === "const_skip" ? eventValue + value : value;
    }
    if (/^const EVENT_\w+$/.test(line)) eventValue++;
    const snapshot = line.match(/^DEF (\w+) EQU (.*\bconst_value\b.*)$/);
    if (snapshot) { const value = number(snapshot[2].replace(/\bconst_value\b/g, String(eventValue))); if (value !== null) symbols.set(snapshot[1], value); }
  }
  const items = constants.constants.filter(entry => entry.sourcePath === "constants/item_constants.asm" && entry.symbol !== "NO_ITEM" && entry.value > 0 && entry.value < (symbols.get("NUM_ITEMS") ?? 256)).map(entry => entry.symbol);
  const dexOrder = rows(byPath.get("data/pokemon/dex_order.asm") ?? "").flatMap(row => { const match = clean(row).match(/^db (.+)$/); return match ? [number(match[1])] : []; });
  const pokemon = constants.constants.filter(entry => entry.sourcePath === "constants/pokemon_constants.asm" && entry.groupId !== null && entry.value > 0 && entry.value <= 255 && (dexOrder[entry.value - 1] ?? 0) > 0 && (dexOrder[entry.value - 1] ?? Infinity) <= (symbols.get("NUM_POKEMON") ?? 151)).map(entry => entry.symbol);
  const pokemonReason = pokemonDeliveryReason(byPath);
  const contracts = await reviewScriptEngineContracts(files, byPath.has("scripts/OaksLab_2.asm") ? "pokeyellow" : "pokered");
  const choiceReason = contracts.find(c => c.id === "yes-no")?.sourceStatus === "reviewed-source" ? null : "Yes/No actions need the reviewed menu and screen-restoration routines; this project's routines differ.";
  const soundReason = ["sound-playback", "sound-wait"].every(id => contracts.find(c => c.id === id)?.sourceStatus === "reviewed-source") ? null : "Sound actions need the reviewed playback and effect-wait routines; this project's routines differ.";
  // Vanilla sound IDs are linker-address EQUS aliases, not numeric constants.
  // Keep those symbolic operands and let RGBDS resolve their reviewed layout.
  const music = byPath.get("constants/music_constants.asm") ?? "";
  const soundMacro = music.match(/MACRO music_const\s*\n([\s\S]*?)\nENDM/);
  const sounds = soundMacro && rows(soundMacro[1]).map(clean).filter(Boolean).join("\n") === 'DEF \\1 EQUS "((\\2 - SFX_Headers_1) / 3)"'
    ? [...music.matchAll(/^\s*music_const\s+(SFX_[A-Z0-9_]+),\s*[A-Za-z_][A-Za-z0-9_]*\s*(?:;[^\r\n]*)?$/gm)].map(m => m[1]).filter((name, i, all) => all.indexOf(name) === i && name !== "SFX_STOP_ALL_MUSIC") : [];
  const events = constants.constants.filter(entry => entry.symbol.startsWith("EVENT_") && !/EDITORINTERACTION.*(?:_DONE|_SCENE_LATCH|_VISIBILITY|_GIFT_DELIVERED|_BATTLE_WON|_BATTLE_CAUGHT)$/.test(entry.symbol) && entry.value >= 0 && entry.value < (symbols.get("NUM_EVENTS") ?? 0)).map(entry => entry.symbol);
  const mapName = path.replace(/^scripts\//, "").replace(/(?:_2)?\.asm$/, "");
  const primaryPath = `scripts/${mapName}.asm`;
  const primary = byPath.get(primaryPath) ?? "";
  const old = managed(text, label);
  let reward: RewardDocument | null = null;
  let gift: PokemonGiftDocument | null = null;
  // Follow only a directly named companion farcall; leave arbitrary call graphs alone.
  let rewardPath = path, rewardLabel = label, rewardText = text;
  const entry = range(text, label).body.map(clean).filter(Boolean);
  if (entry.length === 3 && entry[0] === "text_asm" && /^farcall \w+$/.test(entry[1]) && entry[2] === "jp TextScriptEnd") {
    const target = entry[1].slice(8);
    for (const candidate of [primaryPath, `scripts/${mapName}_2.asm`]) {
      const contents = byPath.get(candidate);
      if (contents && new RegExp(`^${target}:{1,2}`, "m").test(contents)) { rewardPath = candidate; rewardLabel = target; rewardText = contents; break; }
    }
  }
  const rr = range(rewardText, rewardLabel);
  const calls = rr.body.flatMap((line, i) => clean(line) === "call GiveItem" ? [rr.start + 1 + i] : []);
  if (!old && calls.length === 1) {
    const index = calls[0] - 1;
    const args = clean(rr.all[index]).match(/^lb bc,\s*(\w+),\s*(\d+)$/);
    if (args && items.includes(args[1]) && Number(args[2]) >= 1 && Number(args[2]) <= 99 && /^jr nc,\s*\.[\w]+$/.test(clean(rr.all[index + 2]))) {
      const flags = rr.body.map(clean).filter(line => /^CheckAndSetEvent \w+$/.test(line));
      reward = { path: rewardPath, label: rewardLabel, sourceHash: await hashText(rewardText), line: index + 1, item: args[1], quantity: Number(args[2]), earlyFlag: flags.length === 1 ? flags[0].split(" ")[1] : null };
    }
  }
  const giftCalls = rr.body.flatMap((line, i) => clean(line) === "call GivePokemon" ? [rr.start + 1 + i] : []);
  if (!old && !pokemonReason && giftCalls.length === 1 && !calls.length) {
    const index = giftCalls[0] - 1;
    const args = clean(rr.all[index]).match(/^lb bc,\s*(\w+),\s*(\d+)$/);
    if (args && pokemon.includes(args[1]) && Number(args[2]) >= 1 && Number(args[2]) <= 100 && /^jr nc,\s*\.[\w]+$/.test(clean(rr.all[index + 2]))) {
      gift = { path: rewardPath, label: rewardLabel, sourceHash: await hashText(rewardText), line: index + 1, species: args[1], level: Number(args[2]), hidesObject: rr.body.some(row => clean(row) === "predef HideObject") };
    }
  }
  let canCreate = Boolean(old), reason: string | null = null;
  if (!old) {
    const leaves = await attachTextEditing({} as ProjectSession, source).getTextLeafDocuments(path, label);
    const inline = (await parseTextDocument(path, label, text)).editable;
    const plain = entry.length === 2 && /^text_far \w+$/.test(entry[0]) && entry[1] === "text_end";
    let yellowPlain = false;
    if (entry.length === 3 && entry[0] === "text_asm" && /^farcall \w+$/.test(entry[1]) && entry[2] === "jp TextScriptEnd") {
      const helper = range(rewardText, rewardLabel).body.map(clean).filter(Boolean);
      yellowPlain = /^ld hl,\s*\.\w+$/.test(helper[0] ?? "") && helper[1] === "call PrintText" && helper[2] === "ret" && helper.slice(3).every(line => /^\.\w+:?$/.test(line) || /^text_far \w+$/.test(line) || line === "text_end");
    }
    canCreate = path === primaryPath && leaves.length === 1 && leaves[0].editable && (plain || yellowPlain || inline);
    if (!canCreate) reason = reward || gift ? "Edit this existing gift below. Its dialogue paths are available above." : "New actions require a plain dialogue entry. This interaction's existing logic is preserved.";
  }
  const objectsPath = `data/maps/objects/${mapName}.asm`;
  const objects = byPath.get(objectsPath) ?? "";
  const pointers = primary.match(new RegExp(`dw_const\\s+${label}\\s*,\\s*(\\w+)`));
  const signRow = pointers ? objects.match(new RegExp(`bg_event\\s+(\\d+),\\s*(\\d+),\\s*${pointers[1]}\\b`)) : null;
  const sign = signRow ? { x: Number(signRow[1]), y: Number(signRow[2]) } : null;
  const npcConstants = [...objects.matchAll(/^\s*const_export (\w+)\s*$/gm)].map(m => m[1]);
  const objectRows = [...objects.matchAll(/^\s*object_event\s+(\d+),\s*(\d+),\s*(\w+),\s*(\w+),\s*(\w+),\s*([^\r\n;]+)/gm)];
  // Hiding is offered only for this entry's Poké Ball and an existing persistent
  // toggle slot. Never resize or renumber the game's object-state save array.
  const boundObjects = pointers ? objectRows.flatMap((row, i) => row[3] === "SPRITE_POKE_BALL" && row[6].trim() === pointers[1] ? [npcConstants[i]] : []) : [];
  const toggleNames = rows(byPath.get("constants/toggle_constants.asm") ?? "").flatMap(row => { const match = clean(row).match(/^const (TOGGLE_\w+)$/); return match ? [match[1]] : []; });
  let toggleMap = "", toggleIndex = 0, hideObject: string | null = null;
  const mapConstant = byPath.get(`data/maps/headers/${mapName}.asm`)?.match(/map_header\s+\w+,\s*(\w+)/)?.[1];
  for (const row of rows(byPath.get("data/maps/toggleable_objects.asm") ?? "")) {
    const map = clean(row).match(/^toggleable_objects_for (\w+)$/);
    if (map) toggleMap = map[1];
    const object = clean(row).match(/^toggle_object_state (\w+),\s*(ON|OFF)$/);
    if (!object) continue;
    const toggle = toggleNames[toggleIndex];
    if (toggleMap === mapConstant && boundObjects.length === 1 && boundObjects[0] === object[1] && object[2] === "ON" && npcConstants.length === objectRows.length && symbols.get(toggle) === toggleIndex && toggleIndex < 256) hideObject = toggle;
    toggleIndex++;
  }
  let spriteCatalog: Array<{ id: string; canWalk: boolean }> = [], spriteReason: string | null = null;
  try { spriteCatalog = npcSpriteCatalog(byPath.get("data/sprites/sprites.asm") ?? "", symbols, byPath.get("constants/sprite_constants.asm") ?? "").entries; }
  catch { spriteReason = "Scene actors require readable animated/stationary sprite definitions. Plain dialogue and reward editing remain available."; }
  const npcs = objectRows.flatMap((m, i) => m[4] === "STAY" && npcConstants[i] && !m[6].includes(",") ? [{ constant: npcConstants[i], x: Number(m[1]), y: Number(m[2]), canWalk: spriteCatalog.find(sprite => sprite.id === m[3])?.canWalk ?? false }] : []);
  let movementReason: string | null = null;
  let stateCount = 0;
  try {
    const table = range(primary, `${mapName}_ScriptPointers`).body.map(clean).filter(Boolean);
    if (table[0] !== "def_script_pointers" || table.slice(1).some(line => !/^dw_const \w+,\s*\w+$/.test(line))) throw new Error("layout");
    stateCount = table.length - 1;
    if (!stateCount || stateCount > 250 || !range(primary, `${mapName}_Script`).body.some(line => /^(?:jp|call) CallFunctionInTable$/.test(clean(line))) || !primary.includes(`[w${mapName}CurScript]`) || !byPath.get("ram/wram.asm")?.includes(`w${mapName}CurScript::`)) throw new Error("state");
    if (!sign || npcConstants.length !== objectRows.length) throw new Error("sign/object slots");
  } catch { movementReason = "NPC approach sequences need a sign and a map with an existing script-state table."; }
  const mapIndex = await parseMapIndex(source), map = mapIndex.find(map => map.headerLabel === mapName);
  const effects = await inspectSceneEffects(source, byPath);
  const safariStart = mapIndex.find(map => map.constant === "SAFARI_ZONE_EAST")?.id, safariEnd = mapIndex.find(map => map.constant === "SAFARI_ZONE_CENTER_REST_HOUSE")?.id;
  if (map && safariStart !== undefined && safariEnd !== undefined && map.id >= safariStart && map.id < safariEnd) effects.battleReason = "This map uses Safari battles. Normal scripted battles need a map outside the Safari Zone areas.";
  const stateVariable = byPath.get("ram/wram.asm")?.includes(`w${mapName}CurScript::`) ? `w${mapName}CurScript` : null;
  let idleStates: SceneDomain["idleStates"] = [{ id: 0, label: "Default" }];
  if (stateVariable) {
    try { idleStates = range(primary, `${mapName}_ScriptPointers`).body.map(clean).filter(Boolean).slice(1).flatMap((line, id) => {
      const match = line.match(/^dw_const (\w+),\s*\w+$/);
      return match && !match[1].includes("EditorInteraction") ? [{ id, label: match[1] }] : [];
    }); } catch { idleStates = []; }
  }
  const scene: SceneDomain = {
    ...await inspectSceneEmotes(byPath, symbols),
    reason: !map || map.isAlias || !map.width || !map.height || npcConstants.length !== objectRows.length || objectRows.length > 14 || !idleStates.length || idleStates.some(entry => entry.id >= 128)
      ? "Scenes require a unique map header, ordinary object slots and a readable map script."
      : !["npc-movement", "player-movement"].every(id => contracts.some(contract => contract.id === id && contract.sourceStatus === "reviewed-source")) ? "Scenes require the reviewed NPC and player movement routines." : spriteReason,
    mapConstant: map?.constant ?? "", stateVariable, idleStates,
    actors: npcs.map(npc => ({ ...npc, id: npcConstants.indexOf(npc.constant) + 1 })),
    defaultPlayer: sign ? { x: sign.x, y: sign.y + 1 } : pointers && objectRows.find(row => row[6].trim() === pointers[1]) ? (() => { const row = objectRows.find(row => row[6].trim() === pointers[1])!; return { x: +row[1], y: +row[2] + 1 }; })() : { x: 0, y: 0 },
  };
  const dependencies = files.filter(file => file.path.startsWith("constants/") || file.path.startsWith("macros/") || file.path.startsWith("home/") || file.path.startsWith("engine/overworld/") || file.path.startsWith("engine/battle/") || file.path.startsWith("audio/headers/") || file.path.startsWith("data/trainers/") || [path, primaryPath, `scripts/${mapName}_2.asm`, objectsPath, "main.asm", "data/events/hidden_events.asm", "ram/wram.asm", "engine/menus/text_box.asm", "engine/events/give_pokemon.asm", "data/pokemon/dex_order.asm", "data/sprites/sprites.asm", "data/maps/toggleable_objects.asm", `data/maps/headers/${mapName}.asm`, "data/maps/map_header_pointers.asm", "gfx/tilesets.asm", "data/tilesets/tileset_headers.asm", "data/tilesets/collision_tile_ids.asm"].includes(file.path));
  const binaryPaths = (await source.listFiles!()).filter(path => path === `maps/${mapName}.blk` || /^gfx\/blocksets\/[^/]+\.bst$/.test(path)).sort();
  const binarySources = await Promise.all(binaryPaths.map(async path => ({ path, hash: await hashText(Array.from(await source.readBytes(path)).join(",")) })));
  let editableValues = old?.values ?? defaults();
  if (old) {
    editableValues = structuredClone(old.values);
    editableValues.pokemon ??= null;
    editableValues.hideObject ??= null;
    if (editableValues.actions) {
      for (const block of sequenceDialogue(editableValues.actions)) {
        const leaf = await parseTextDocument(path, `${old.prefix}${block.key}Text`, text);
        if (!leaf.editable) throw new Error("An action's dialogue was changed outside the editor.");
        block.lines.splice(0, block.lines.length, ...leaf.segments.map(segment => segment.text));
      }
    }
    for (const [field, suffix] of [["dialogue", "Dialogue"], ["bagFull", "BagFullText"], ["already", "AlreadyText"]] as const) {
      const leaf = await parseTextDocument(path, `${old.prefix}${suffix}`, text);
      if (!leaf.editable) throw new Error("An interaction dialogue block was changed outside the editor.");
      editableValues[field] = leaf.segments.map(segment => segment.text);
    }
  }
  const document: InteractionDocument = { projectKey: source.storageKey, effects, path, label, sources: await Promise.all(dependencies.map(async file => ({ path: file.path, hash: await hashText(file.contents) }))).then(entries => [...entries, ...binarySources]), items, pokemon, pokemonReason, hideObject, events, sounds, choiceReason, soundReason, scene, reward, gift, canCreate, reason, values: editableValues, npcs: npcs.filter(npc => npc.canWalk), movementReason, sign };
  return { document, byPath, files, text, primary, mapName, primaryPath, symbols, number, old, stateCount, objects, objectsPath, npcConstants, objectRows };
}
export type InteractionInspection = Awaited<ReturnType<typeof inspect>>;
export async function loadScriptInteractionDocument(source: ProjectSource, path: string, label: string): Promise<InteractionDocument> {
  return (await inspect(source, path, label)).document;
}

export async function checkScriptInteraction(source: ProjectSource, document: InteractionDocument, values: InteractionValues): Promise<InteractionCheckReport> {
  try { await prepareScriptInteractionWrites(source, document, values); return { valid: true, issues: [] }; }
  catch (error) { return { valid: false, issues: [error instanceof InteractionValidationError ? error.detail : { message: error instanceof Error ? error.message : String(error) }] }; }
}

export async function prepareScriptRewardWrite(source: ProjectSource, document: InteractionDocument, item: string, quantity: number, fixBagFull: boolean): Promise<TextWriteRequest[]> {
  const current = await inspect(source, document.path, document.label);
  if (JSON.stringify(current.document.sources) !== JSON.stringify(document.sources)) throw new Error("Interaction sources changed. Reopen the editor before saving.");
  const reward = current.document.reward;
  if (!reward || !current.document.items.includes(item) || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new Error("Choose a valid item and quantity from 1 to 99.");
  let text = current.byPath.get(reward.path)!;
  const all = rows(text);
  all[reward.line - 1] = all[reward.line - 1].replace(/(lb bc,\s*)\w+(,\s*)\d+/, `$1${item}$2${quantity}`);
  if (fixBagFull && reward.earlyFlag) {
    const r = range(text, reward.label);
    const index = all.findIndex((line, i) => i > r.start && i < r.end && clean(line) === `CheckAndSetEvent ${reward.earlyFlag}`);
    if (index < 0 || !/^jr nz,\s*\.\w+$/.test(clean(all[index + 1]))) throw new Error("Cannot safely separate this event check from its reward.");
    all[index] = all[index].replace("CheckAndSetEvent", "CheckEvent");
    // Insert after the bag-full branch, so the flag records successful delivery only.
    all.splice(reward.line + 2, 0, `\tSetEvent ${reward.earlyFlag}`);
  }
  text = all.join(text.includes("\r\n") ? "\r\n" : "\n");
  const patchedSource = { ...source, readText: async (path: string) => path === reward.path ? text : source.readText(path) };
  const reparsed = await inspect(patchedSource, document.path, document.label);
  if (reparsed.document.reward?.item !== item || reparsed.document.reward.quantity !== quantity) throw new Error("The edited reward did not reparse correctly.");
  return [{ path: reward.path, contents: text, expectedHash: reward.sourceHash }];
}

export async function prepareScriptPokemonGiftWrite(source: ProjectSource, document: InteractionDocument, species: string, level: number): Promise<TextWriteRequest[]> {
  const current = await inspect(source, document.path, document.label);
  if (JSON.stringify(current.document.sources) !== JSON.stringify(document.sources)) throw new Error("Interaction sources changed. Reopen the editor before saving.");
  const gift = current.document.gift;
  if (!gift || !current.document.pokemon.includes(species) || !Number.isInteger(level) || level < 1 || level > 100) throw new Error("Choose a valid Pokémon and a level from 1 to 100.");
  const original = current.byPath.get(gift.path)!;
  // Keep each line's original CR byte so mixed newlines and final-newline
  // presence survive a parameter edit byte for byte.
  const all = original.split("\n");
  all[gift.line - 1] = all[gift.line - 1].replace(/(lb bc,\s*)\w+(,\s*)\d+/, `$1${species}$2${level}`);
  const text = all.join("\n");
  const patched = { ...source, readText: async (path: string) => path === gift.path ? text : source.readText(path) };
  const saved = await inspect(patched, document.path, document.label);
  if (saved.document.gift?.species !== species || saved.document.gift.level !== level) throw new Error("The Pokémon gift did not reparse correctly.");
  return [{ path: gift.path, contents: text, expectedHash: gift.sourceHash }];
}

function print(label: string) { return [`\tld hl, ${label}`, "\tcall PrintText"]; }
function textBlock(label: string, input: string[], state: Awaited<ReturnType<typeof inspect>>, terminator?: "done" | "prompt") {
  if (!Array.isArray(input) || input.length < 1 || input.length > 16 || input.some(value => typeof value !== "string" || /[\r\n@\\"]/u.test(value)) || !input.some(value => value.trim())) throw new Error("Enter 1–16 dialogue lines without embedded line breaks or text-ending codes.");
  const charmap = state.files.find(file => file.path.endsWith("charmap.asm"))?.contents ?? "";
  const chars = new Set([...charmap.matchAll(/^\s*charmap "([^"\\])",\s*\$([\da-f]{2})\b/gmi)].filter(m => Number.parseInt(m[2], 16) >= 0x60 || m[1] === "#" && m[2] === "54").map(m => m[1]));
  const tokens = new Set(["<PLAYER>", "<RIVAL>", "<TARGET>", "<USER>", "<PKMN>", "<PC>", "<TM>", "<TRAINER>", "<ROCKET>", "<……>"].filter(token => new RegExp(`charmap "${token}",`).test(charmap)));
  if (input.some(line => [...line.matchAll(/<[^>]*>/g)].some(match => !tokens.has(match[0])) || [...line.replace(/<[^>]*>/g, "")].some(char => !chars.has(char)))) throw new Error("Dialogue contains an unsupported token or characters unavailable in this game's font.");
  let originalBlock: string | null = null;
  if (state.old && new RegExp(`^${label}:{1,2}$`, "m").test(state.text.replace(/\r\n/g, "\n"))) {
    const existing = range(state.text, label);
    originalBlock = state.text.slice(existing.from, existing.to).replace(/\r\n/g, "\n").trimEnd() + "\n";
  }
  const controls = originalBlock ? rows(originalBlock).flatMap(row => {
    const match = row.match(/^\s*(text|next|line|cont|para|page)\s+"/);
    return match ? [match[1] as TextSegmentControl] : [];
  }) : [];
  const segments = input.map((text, i) => ({ control: controls[i] ?? (i === 0 ? "text" as const : i === 1 ? "line" as const : "cont" as const), text }));
  if (originalBlock) {
    const edited = applyTextDocumentEdits(originalBlock, label, segments);
    return terminator ? edited.replace(/^(\s*)(?:done|prompt|text_end)(\s*(?:;[^\r\n]*)?)$/m, `$1${terminator}$2`) : edited;
  }
  const template = `${label}:\n${segments.map(segment => `\t${segment.control} ""`).join("\n")}\n\t${terminator ?? "done"}\n`;
  return applyTextDocumentEdits(template, label, segments);
}
function rewardCode(m: ManagedInteraction, textPrefix = m.prefix) {
  const v = m.values, p = m.prefix;
  const code: string[] = [];
  if (v.actions) {
    const completion = [...(m.flag ? [`\tSetEvent ${m.flag}`] : []), ...v.events.map(event => `\t${event.set ? "SetEvent" : "ResetEvent"} ${event.event}`)];
    code.push(...renderInteractionSequence(v.actions, p, textPrefix, completion, "Action", m.version === 2), ...completion, `\tjp ${p}Finish`);
    code.push(`${p}BagFull:`, ...print(`${textPrefix}BagFullText`), ...(m.version === 2 ? ["\tld a, 1", "\tld [wDoNotWaitForButtonPressAfterDisplayingText], a"] : []), `\tjp ${p}Finish`);
    return code;
  }
  if (v.reward) code.push(`\tlb bc, ${v.reward.item}, ${v.reward.quantity}`, "\tcall GiveItem", `\tjp nc, ${p}BagFull`);
  if (v.pokemon) code.push(`\tlb bc, ${v.pokemon.species}, ${v.pokemon.level}`, "\tcall GivePokemon", `\tjp nc, ${p}BagFull`, "\tld a, [wAddedToParty]", "\tand a", "\tcall z, WaitForTextScrollButtonPress", "\tcall EnableAutoTextBoxDrawing");
  if (m.flag) code.push(`\tSetEvent ${m.flag}`);
  for (const event of v.events) code.push(`\t${event.set ? "SetEvent" : "ResetEvent"} ${event.event}`);
  if (v.hideObject) code.push(`\tld a, ${v.hideObject}`, "\tld [wToggleableObjectIndex], a", "\tpredef HideObject");
  if (v.reward) code.push("\tld a, SFX_GET_ITEM_1", "\tcall PlaySound", "\tcall WaitForSoundToFinish");
  code.push(...print(`${textPrefix}Dialogue`), `\tjp ${p}Finish`);
  if (v.reward || v.pokemon) code.push(`${p}BagFull:`, ...print(`${textPrefix}BagFullText`), `\tjp ${p}Finish`);
  return code;
}
function render(m: ManagedInteraction, npcId: number | null, mapName: string, resumeState = 0, textPrefix = m.prefix) {
  const p = m.prefix, v = m.values;
  const code = [`${m.label}:`, "\ttext_asm", `\t; yellow-editor-interaction: ${JSON.stringify(m)}`];
  const original = () => [...print(`${textPrefix}Original`), ...(m.version === 2 ? [
    ...(!m.originalHasPrompt ? [`\tld hl, ${p}AdvanceText`, "\tcall PrintText_NoCreatingTextBox"] : []),
    "\tld a, 1", "\tld [wDoNotWaitForButtonPressAfterDisplayingText], a",
  ] : [])];
  if (v.condition) code.push(`\tCheckEvent ${v.condition.event}`, `\tjp ${v.condition.set ? "z" : "nz"}, ${p}OriginalOnly`);
  if (m.flag) code.push(`\tCheckEvent ${m.flag}`, `\tjp nz, ${p}Already`);
  if (v.movement) {
    const slot = String(npcId!.toString(16)).padStart(2, "0").toUpperCase();
    // A background event has no NPC index: always name the selected object.
    code.push(`\tld a, [w${mapName}CurScript]`, "\tand a", `\tjp nz, ${p}OriginalOnly`, `\tld a, [wXCoord]`, `\tcp ${v.movement.playerX}`, `\tjp nz, ${p}OriginalOnly`, `\tld a, [wYCoord]`, `\tcp ${v.movement.playerY}`, `\tjp nz, ${p}OriginalOnly`, `\tld a, [wSprite${slot}StateData1MovementStatus]`, "\tand a", `\tjp z, ${p}OriginalOnly`);
    if (v.showOriginal) code.push(...original());
    // Defer movement until the sign's text engine has closed its box.
    code.push("\tld a, $ff", "\tld [wJoyIgnore], a", `\tld a, ${m.arrival}`, `\tld [w${mapName}CurScript], a`, "\tjp TextScriptEnd", "");
    code.push(`${p}StartWalk:`, `\tld a, ${v.movement.npc}`, "\tldh [hSpriteIndex], a", `\tld de, ${p}Walk`, "\tcall MoveSprite", "\tret", "");
    // Arrival state first starts the walk, then waits for the game's movement flag.
    // A separate state is needed; the text entry must never spin inside PrintText.
    code.push(`${p}StartState:`, `\tcall ${p}StartWalk`, `\tld a, ${m.arrivalId! + 1}`, `\tld [w${mapName}CurScript], a`, "\tret", "");
    code.push(`${p}ArriveState:`, "\tld a, [wStatusFlags5]", "\tbit BIT_SCRIPTED_NPC_MOVEMENT, a", "\tret nz");
    code.push(`\tld a, ${v.movement.npc}`, "\tldh [hSpriteIndex], a", `\tld a, ${p}Facing`, "\tldh [hSpriteFacingDirection], a", "\tcall SetSpriteFacingDirectionAndDelay", ...rewardCode(m, textPrefix));
    code.push(`${p}Finish:`, `\tld a, ${v.movement.npc}`, "\tldh [hSpriteIndex], a", `\tld de, ${p}Return`, "\tcall MoveSprite", `\tld a, ${m.cleanup}`, `\tld [w${mapName}CurScript], a`, "\tret", "");
    code.push(`${p}CleanupState:`, "\tld a, [wStatusFlags5]", "\tbit BIT_SCRIPTED_NPC_MOVEMENT, a", "\tret nz", "\txor a", "\tld [wJoyIgnore], a", ...(resumeState ? [`\tld a, ${resumeState}`] : []), `\tld [w${mapName}CurScript], a`, "\tret", "");
    code.push(`${p}Walk:`, ...v.movement.steps.map(step => `\tdb NPC_MOVEMENT_${step}`), "\tdb -1", "", `${p}Return:`, ...v.movement.steps.slice().reverse().map(step => `\tdb NPC_MOVEMENT_${opposite[step]}`), "\tdb -1", "");
  } else {
    if (v.showOriginal) code.push(...original());
    code.push(...rewardCode(m), `${p}Finish:`, "\tjp TextScriptEnd", "");
  }
  code.push(`${p}Already:`, ...print(`${textPrefix}AlreadyText`), "\tjp TextScriptEnd", `${p}OriginalOnly:`, ...print(`${textPrefix}Original`), "\tjp TextScriptEnd", "");
  if (m.version === 2 && v.showOriginal && !m.originalHasPrompt) code.push(`${p}AdvanceText:`, "\ttext_promptbutton", "\ttext_end", "");
  return code.join("\n").replace(`\tld a, [w${mapName}CurScript]\n\tand a`, `\tld a, [w${mapName}CurScript]\n${resumeState ? `\tcp ${resumeState}` : "\tand a"}`);
}
const opposite: Record<string, string> = { UP: "DOWN", DOWN: "UP", LEFT: "RIGHT", RIGHT: "LEFT" };
function endpoint(steps: string[]) { let x = 0, y = 0; for (const step of steps) { x += step === "RIGHT" ? 1 : step === "LEFT" ? -1 : 0; y += step === "DOWN" ? 1 : step === "UP" ? -1 : 0; } return { x, y }; }

async function validateMovement(source: ProjectSource, state: Awaited<ReturnType<typeof inspect>>, movement: NonNullable<InteractionValues["movement"]>) {
  if (state.document.movementReason) throw new Error(state.document.movementReason);
  const npc = state.document.npcs.find(entry => entry.constant === movement.npc);
  if (!npc || !Array.isArray(movement.steps) || movement.steps.length < 1 || movement.steps.length > 32 || movement.steps.some(step => !opposite[step])) throw new Error("Choose a stationary NPC and 1–32 walking steps.");
  const sign = state.document.sign!;
  if (!Number.isInteger(movement.playerX) || !Number.isInteger(movement.playerY) || Math.abs(movement.playerX - sign.x) + Math.abs(movement.playerY - sign.y) !== 1) throw new Error("Choose the player tile immediately beside the sign.");
  const index = await parseMapIndex(source);
  const headerPath = `data/maps/headers/${state.mapName}.asm`;
  const header = state.byPath.get(headerPath)?.match(/map_header\s+\w+,\s*(\w+),\s*(\w+)/);
  const map = index.find(entry => entry.constant === header?.[1]);
  if (!map) throw new Error("Map dimensions are unavailable.");
  const headers = state.byPath.get("data/tilesets/tileset_headers.asm") ?? "";
  const tilesets = [...headers.matchAll(/^\s*tileset\s+(\w+),/gm)].map(m => m[1]);
  const tilesetIndex = state.symbols.get(header![2]);
  const tileset = tilesetIndex === undefined ? undefined : tilesets[tilesetIndex];
  const collisionSource = state.byPath.get("data/tilesets/collision_tile_ids.asm") ?? "";
  const collision = tileset ? collisionSource.slice(collisionSource.indexOf(`${tileset}_Coll::`)).match(/coll_tiles\s+([^\r\n;]+)/) : null;
  const passable = collision?.[1].split(",").map(value => state.number(value.trim()));
  const gfx = state.byPath.get("gfx/tilesets.asm") ?? "";
  const blockAsset = tileset ? gfx.slice(gfx.indexOf(`${tileset}_Block::`)).match(/INCBIN "([^"]+)"/)?.[1] : undefined;
  if (!passable || passable.some(value => value === null) || !blockAsset) throw new Error("Cannot validate this tileset's walking surfaces.");
  const mapAsset = `maps/${state.mapName}.blk`;
  const [blocks, blockset] = await Promise.all([source.readBytes(mapAsset), source.readBytes(blockAsset)]);
  const blocked = [...state.objectRows].filter(m => m[3] && m[0].includes("object_event")).map(m => ({ x: Number(m[1]), y: Number(m[2]) }));
  const warps = [...state.objects.matchAll(/warp_event\s+(\d+),\s*(\d+)/g)].map(m => ({ x: Number(m[1]), y: Number(m[2]) }));
  const signs = [...state.objects.matchAll(/bg_event\s+(\d+),\s*(\d+)/g)].map(m => ({ x: Number(m[1]), y: Number(m[2]) }));
  let x = npc.x, y = npc.y;
  const walkable = (px: number, py: number) => {
    if (px < 0 || py < 0 || px >= map.width * 2 || py >= map.height * 2) return false;
    const block = blocks[Math.floor(py / 2) * map.width + Math.floor(px / 2)];
    const tile = blockset[block * 16 + (py % 2 * 2 + 1) * 4 + px % 2 * 2];
    return passable.includes(tile);
  };
  if (!walkable(movement.playerX, movement.playerY)) throw new Error("The player approach tile is not walkable.");
  for (const step of movement.steps) {
    const delta = endpoint([step]); x += delta.x; y += delta.y;
    if (!walkable(x, y) || [...blocked.filter(point => point.x !== npc.x || point.y !== npc.y), ...warps, ...signs, { x: movement.playerX, y: movement.playerY }].some(point => point.x === x && point.y === y)) throw new Error(`The route is blocked at (${x}, ${y}).`);
    if (Math.abs(x - movement.playerX) > 4 || Math.abs(y - movement.playerY) > 3) throw new Error("Keep the whole route near the sign so the NPC remains on screen.");
  }
  if (Math.abs(npc.x - movement.playerX) > 4 || Math.abs(npc.y - movement.playerY) > 3 || Math.abs(x - movement.playerX) + Math.abs(y - movement.playerY) !== 1) throw new Error("The NPC must start nearby and finish beside the player.");
  const facing = x < movement.playerX ? "RIGHT" : x > movement.playerX ? "LEFT" : y < movement.playerY ? "DOWN" : "UP";
  return { id: state.npcConstants.indexOf(npc.constant) + 1, x: npc.x, y: npc.y, facing, binarySources: [{ path: mapAsset, hash: await hashText(Array.from(blocks).join(",")) }, { path: blockAsset, hash: await hashText(Array.from(blockset).join(",")) }] };
}

export async function prepareScriptInteractionWrites(source: ProjectSource, document: InteractionDocument, values: InteractionValues): Promise<TextWriteRequest[]> {
  const state = await inspect(source, document.path, document.label);
  if (JSON.stringify(state.document.sources) !== JSON.stringify(document.sources)) throw new Error("Interaction sources changed. Reopen the editor before saving.");
  if (!state.document.canCreate) throw new Error(state.document.reason ?? "Cannot convert this entry safely.");
  if (typeof values.once !== "boolean" || typeof values.showOriginal !== "boolean" || !Array.isArray(values.events) || values.events.length > 16) throw new Error("Invalid interaction options.");
  if (values.actions !== undefined) {
    if (values.reward || values.pokemon || values.hideObject) throw new Error("Use reward actions inside the sequence rather than the legacy reward options.");
    validateInteractionSequence(values.actions, state.document, values.once);
    values = { ...values, actions: identifySequenceDialogue(values.actions) };
  }
  if (values.reward && (!state.document.items.includes(values.reward.item) || !Number.isInteger(values.reward.quantity) || values.reward.quantity < 1 || values.reward.quantity > 99)) throw new Error("Choose an item and quantity from 1 to 99.");
  if (values.pokemon) {
    if (state.document.pokemonReason) throw new Error(state.document.pokemonReason);
    if (values.reward) throw new Error("Choose one reward: an item or a Pokémon.");
    if (!state.document.pokemon.includes(values.pokemon.species) || !Number.isInteger(values.pokemon.level) || values.pokemon.level < 1 || values.pokemon.level > 100) throw new Error("Choose a valid Pokémon and a level from 1 to 100.");
  }
  if (values.hideObject && (!values.pokemon || !values.once || values.movement || values.hideObject !== state.document.hideObject)) throw new Error("Only a one-time Pokémon gift can hide its own existing Poké Ball object.");
  if (values.condition && (!state.document.events.includes(values.condition.event) || typeof values.condition.set !== "boolean") || values.events.some(event => !state.document.events.includes(event.event) || typeof event.set !== "boolean")) throw new Error("Choose existing project events for conditions and changes.");
  const semantics = deriveProjectEventMacroSemantics(state.files);
  if (!semantics.some(event => event.name === "CheckEvent" && event.action === "check" && event.zeroMeaning === "event-clear")) throw new Error("Cannot prove this project's event-check convention.");
  macro(state.byPath, "macros/scripts/text.asm", "text_asm", "db TX_START_ASM");
  macro(state.byPath, "macros/scripts/events.asm", "SetEvent", "DEF event_byte = ((\\1) / 8)\nld hl, wEventFlags + event_byte\nset (\\1) % 8, [hl]");
  macro(state.byPath, "macros/scripts/events.asm", "ResetEvent", "DEF event_byte = ((\\1) / 8)\nld hl, wEventFlags + event_byte\nres (\\1) % 8, [hl]");
  for (const [name, body] of Object.entries({ text: "db TX_START, \\#", line: 'db "<LINE>", \\#', cont: 'db "<CONT>", \\#', done: 'db "<DONE>"' })) macro(state.byPath, "macros/scripts/text.asm", name, body);
  if (values.actions) {
    macro(state.byPath, "macros/scripts/text.asm", "prompt", 'db "<PROMPT>"');
    macro(state.byPath, "macros/scripts/text.asm", "text_promptbutton", "db TX_PROMPT_BUTTON");
    macro(state.byPath, "macros/scripts/text.asm", "text_end", "db TX_END");
    const yellow = state.byPath.has("scripts/OaksLab_2.asm");
    // Normalized source fingerprints for the native arrow, A/B wait and the
    // no-redraw prompt used between original text and the composed actions.
    const routines = [
      ["home/text.asm", "PromptText", "828c746f8185e458a8eeda8d8256e98f0d1cfd9e16a3f07a7e997aea70a53422"],
      ["home/text.asm", "TextCommand_PROMPT_BUTTON", "56de3caafd5557158429bb0ffe4a756fe5676f365836340b00e6858e88e33af8"],
      ["home/joypad2.asm", "ManualTextScroll", yellow ? "cfc96944052e5c230bd8b1b4b1348ed1ee741ac195b91ad14f438ac3efc967bd" : "63da21b726ec844bc57408fe2e0840ea17dfb4efb531471e888dae74b2ceeed7"],
      ["home/joypad2.asm", "WaitForTextScrollButtonPress", yellow ? "5082b91da23de3ae92264fc113d9430ece0466d635ba9ffca588b3263ad85e31" : "e841a577bc3043ae69d185f3c83a19eb28041ead142fe6c17dfb87456d477a67"],
      ["home/window.asm", "PrintText_NoCreatingTextBox", "bfa77285701ebcc5bece51041fe728894ac03d83528ed9215d1545ea92830c3a"],
    ];
    for (const [path, label, fingerprint] of routines) {
      const body = range(state.byPath.get(path) ?? "", label).body.map(clean).filter(Boolean).join("\n");
      if (await hashText(body) !== fingerprint) throw new Error("Dialogue actions need the reviewed button-prompt and final text-wait routines.");
    }
    if (!/charmap "<PROMPT>",\s*\$58\b/i.test(state.byPath.get("constants/charmap.asm") ?? "")
      || !/call PrintText_NoCreatingTextBox\s+ld a, \[wDoNotWaitForButtonPressAfterDisplayingText\]\s+and a\s+jr nz, HoldTextDisplayOpen/.test(state.byPath.get("home/text_script.asm") ?? "")) {
      throw new Error("Dialogue actions need the reviewed button-prompt and final text-wait routines.");
    }
  }
  let prefix = state.old?.prefix ?? `${document.label}EditorInteraction`;
  if (!state.old) {
    let n = 1;
    while (state.files.some(file => file.contents.includes(prefix))) prefix = `${document.label}EditorInteraction${n++}`;
  }
  const m: ManagedInteraction = state.old ? { ...state.old, values } : { version: 1, label: document.label, prefix, flag: null, arrival: null, cleanup: null, arrivalId: null, cleanupId: null, values };
  if (values.actions) {
    m.version = 2;
    const originalLeaves = await attachTextEditing({} as ProjectSession, source).getTextLeafDocuments(document.path, state.old ? `${prefix}Original` : document.label);
    m.originalHasPrompt = originalLeaves.length === 1 && originalLeaves[0].terminator === "prompt";
  }
  const changed = new Map<string, string>();
  const append = (path: string, block: string) => { const text = changed.get(path) ?? state.byPath.get(path)!; changed.set(path, text + (text.endsWith("\n") ? "\n" : "\n\n") + block.replace(/\n/g, text.includes("\r\n") ? "\r\n" : "\n")); };
  const reserved = new Set<number>();
  const allocateFlag = (name: string) => {
    const capacity = state.symbols.get("NUM_EVENTS");
    const events = [...state.symbols].filter(([key]) => key.startsWith("EVENT_")).map(([, value]) => value);
    const high = Math.max(...projectConstantCatalogFromSources(state.files.filter(file => file.path === "constants/event_constants.asm")).constants.filter(entry => entry.symbol.startsWith("EVENT_") && entry.groupId !== null).map(entry => entry.value));
    if (!capacity || capacity % 8 || !/wEventFlags:: flag_array NUM_EVENTS/.test(state.byPath.get("ram/wram.asm") ?? "")) throw new Error("Cannot reserve a completion flag without changing save layout.");
    // Reserve only the explicit, unused tail of the existing event array. Never renumber flags.
    const available = Array.from({ length: capacity - high - 1 }, (_, i) => capacity - 1 - i).find(value => {
      const numeric = `\\$${Math.floor(value / 8).toString(16)}`;
      return !events.includes(value) && !reserved.has(value) && !state.files.some(file => new RegExp(`wEventFlags\\s*\\+\\s*(?:${numeric}|${Math.floor(value / 8)})\\b`, "i").test(file.contents)) && !state.files.some(file => !file.path.startsWith("macros/") && /(?:Set|Reset)EventRange\b/.test(file.contents) && rows(file.contents).some(line => {
        const match = clean(line).match(/^(?:Set|Reset)EventRange\s+([^,]+),\s*([^,]+)(?:,.*)?$/);
        if (!match) return false;
        const start = state.number(match[1]), end = state.number(match[2]);
        return start === null || end === null || value >= start && value <= end;
      }));
    });
    if (available === undefined) throw new Error("No verified unused completion flag remains in the existing save layout.");
    reserved.add(available);
    append("constants/event_constants.asm", `DEF ${name} EQU $${available.toString(16)}\n`);
    return name;
  };
  if (values.once && !m.flag) m.flag = allocateFlag(`EVENT_${prefix.toUpperCase()}_DONE`);
  if (values.scene || values.actions && needsScene(values.actions) || state.old?.version === 3) {
    if (document.path !== state.primaryPath) throw new Error("Scene actions must use a primary map text entry.");
    macro(state.byPath, "macros/scripts/maps.asm", "def_text_pointers", "const_def 1");
    const dwConst = state.byPath.get("macros/const.asm")?.match(/^MACRO\?? dw_const\r?\n([\s\S]*?)^ENDM/m);
    if (!dwConst || rows(dwConst[1]).map(clean).filter(Boolean).join("\n") !== "dw \\1\nconst \\2") throw new Error("Scene dialogue needs the reviewed dw_const macro.");
    if (range(state.byPath.get("home/array2.asm") ?? "", "CallFunctionInTable").body.map(clean).filter(Boolean).join("\n") !== "push hl\npush de\npush bc\nadd a\nld d, 0\nld e, a\nadd hl, de\nld a, [hli]\nld h, [hl]\nld l, a\nld de, .returnAddress\npush de\njp hl\n.returnAddress\npop bc\npop de\npop hl\nret") throw new Error("Scenes require the reviewed 128-state dispatcher.");
    m.version = 3;
    m.scene = await buildScenePlan(source, state, m, allocateFlag);
    await prepareSceneRuntime(state, m, changed);
    let primary = changed.get(state.primaryPath) ?? state.primary;
    const hook = sceneRootHook(prefix), nl = primary.includes("\r\n") ? "\r\n" : "\n";
    if (state.old?.version === 3) {
      if (!primary.includes(hook.replace(/\n/g, nl))) throw new Error("The map scene hook was changed in source.");
    } else primary = primary.replace(new RegExp(`^${state.mapName}_Script:{1,2}\\r?\\n`, "m"), match => match + hook.replace(/\n/g, nl));
    if (!primary.includes(hook.replace(/\n/g, nl))) throw new Error("Could not install the map scene hook.");
    const r = range(primary, `${state.mapName}_TextPointers`);
    const table = r.body.map(clean).filter(Boolean);
    if (table[0] !== "def_text_pointers" || table.slice(1).some(line => !/^dw_const \w+,\s*\w+$/.test(line))) throw new Error("Scene dialogue needs the reviewed text pointer table.");
    const oldSlots = state.old?.scene?.textSlots ?? 0;
    for (let i = 0; i < oldSlots; i++) if (!table.includes(`dw_const ${prefix}SceneText${i}, TEXT_${prefix.toUpperCase()}_SCENE_${i}`)) throw new Error("Scene dialogue pointer slots were changed in source.");
    if (table.length - 1 + m.scene.textSlots - oldSlots >= 0xf0) throw new Error("The map has no free native text slots for scene dialogue.");
    const additions = Array.from({ length: m.scene.textSlots - oldSlots }, (_, i) => `\tdw_const ${prefix}SceneText${i + oldSlots}, TEXT_${prefix.toUpperCase()}_SCENE_${i + oldSlots}`).join(nl);
    if (additions) primary = primary.slice(0, r.to).trimEnd() + nl + additions + nl + nl + primary.slice(r.to);
    changed.set(state.primaryPath, primary);
  }
  // Disabling one-time behavior retains its reserved bit for future re-enabling.
  const movement = values.movement ? await validateMovement(source, state, values.movement) : null;
  if (movement && !m.arrival) {
    // Yellow's Viridian City has three reviewed idle states. Keep its tutorial
    // progress by giving each state its own arrival/cleanup pair; no scratch RAM
    // or save layout changes are needed.
    const body = (label: string) => { try { return range(state.primary, label).body.map(clean).filter(Boolean).join("\n"); } catch { return ""; } };
    const yellowIdle = state.mapName === "ViridianCity" &&
      body("ViridianCityDefaultScript") === "call ViridianCityCheckGymOpenScript\ncall ViridianCityCheckSleepingOldMan\nret" &&
      body("ViridianCityAfterPokedexScript") === "call ViridianCityCheckWaitingOldMan" &&
      body("ViridianCityPostCatchTraining") === "call ViridianCityCheckGymOpenScript\nret" &&
      body("ViridianCity_ScriptPointers").split("\n").slice(1, 4).every((line, i) => new RegExp(`^dw_const ${["ViridianCityDefaultScript", "ViridianCityAfterPokedexScript", "ViridianCityPostCatchTraining"][i]},\\s*\\w+$`).test(line));
    m.idleStates = yellowIdle ? [0, 1, 2] : [0];
    if (state.stateCount + m.idleStates.length * 3 > 256) throw new Error("The map has no room for the approach sequence's states.");
    m.arrivalId = state.stateCount; m.cleanupId = state.stateCount + 2;
    m.arrival = `SCRIPT_${prefix.toUpperCase()}_START`;
    m.cleanup = `SCRIPT_${prefix.toUpperCase()}_CLEANUP`;
    const arrivalNext = `SCRIPT_${prefix.toUpperCase()}_ARRIVE`;
    const r = range(state.primary, `${state.mapName}_ScriptPointers`);
    const originalTable = state.primary.slice(r.from, r.to);
    const additions = `\tdw_const ${prefix}StartState, ${m.arrival}\n\tdw_const ${prefix}ArriveState, ${arrivalNext}\n\tdw_const ${prefix}CleanupState, ${m.cleanup}\n` + m.idleStates.slice(1).map(idle => ["Start", "Arrive", "Cleanup"].map(kind => `\tdw_const ${prefix}Resume${idle}${kind}State, SCRIPT_${prefix.toUpperCase()}_RESUME${idle}_${kind.toUpperCase()}\n`).join("")).join("") + "\n";
    changed.set(state.primaryPath, state.primary.slice(0, r.from) + originalTable.trimEnd() + "\n" + additions.replace(/\n/g, state.primary.includes("\r\n") ? "\r\n" : "\n") + state.primary.slice(r.to));

  }
  if (state.old?.values.movement && !values.movement && m.version !== 3) throw new Error("An existing approach sequence must keep its movement enabled. Edit its NPC and route instead.");
  const renderPart = (model: ManagedInteraction, info: typeof movement, resumeState = 0, textPrefix = model.prefix) => {
    const prefix = model.prefix;
    const effective = { ...model, flag: model.values.once ? model.flag : null };
    let code = render(effective, info?.id ?? null, state.mapName, resumeState, textPrefix);
    // Keep the actual reserved flag in metadata even while repeatable behavior is selected.
    code = code.replace(`; yellow-editor-interaction: ${JSON.stringify(effective)}`, `; yellow-editor-interaction: ${JSON.stringify(model)}`);
    if (info) {
      const slot = info.id.toString(16).padStart(2, "0").toUpperCase();
      const guard = [`\tld a, [wSprite${slot}StateData2MapX]`, `\tcp ${info.x + 4}`, `\tjp nz, ${prefix}OriginalOnly`, `\tld a, [wSprite${slot}StateData2MapY]`, `\tcp ${info.y + 4}`, `\tjp nz, ${prefix}OriginalOnly`].join("\n") + "\n";
      code = code.replace(`\tld a, [wSprite${slot}StateData1MovementStatus]`, guard + `\tld a, [wSprite${slot}StateData1MovementStatus]`);
      const originalDirection = state.objectRows[info.id - 1][5];
      code = code.replace(`${prefix}StartWalk:\n`, `${prefix}StartWalk:\n\tld a, NONE\n\tld [wMapSpriteData + ${(info.id - 1) * 2 + 1}], a\n`);
      code = code.replace(`\tld [w${state.mapName}CurScript], a\n\tret\n\n${prefix}Walk:`, `\tld [w${state.mapName}CurScript], a\n\tld a, ${originalDirection}\n\tld [wMapSpriteData + ${(info.id - 1) * 2 + 1}], a\n\tret\n\n${prefix}Walk:`);
      code += `DEF ${prefix}Facing EQU SPRITE_FACING_${info.facing}\n`;
    }
    return code;
  };
  const renderManaged = (model: ManagedInteraction, info: typeof movement) => {
    if (model.version === 3) return renderScene(model);
    let code = renderPart(model, info);
    const dispatch: string[] = [];
    for (const [i, idle] of (model.idleStates ?? [0]).slice(1).entries()) {
      const prefix = `${model.prefix}Resume${idle}`;
      const variant = { ...model, prefix, label: `${prefix}Entry`, arrival: `SCRIPT_${model.prefix.toUpperCase()}_RESUME${idle}_START`, cleanup: `SCRIPT_${model.prefix.toUpperCase()}_RESUME${idle}_CLEANUP`, arrivalId: model.arrivalId! + (i + 1) * 3, cleanupId: model.cleanupId! + (i + 1) * 3 };
      // Dispatch from the text engine's assembly mode, past each variant's opcode.
      dispatch.push(`\tcp ${idle}`, `\tjp z, ${variant.label} + 1`);
      code += renderPart(variant, info, idle, model.prefix);
    }
    if (dispatch.length) code = code.replace(`\tld a, [w${state.mapName}CurScript]\n\tand a`, `\tld a, [w${state.mapName}CurScript]\n${dispatch.join("\n")}\n\tand a`);
    return code + `; yellow-editor-interaction-code-end ${model.label}\n\n`;
  };
  const code = renderManaged(m, movement);
  let script = changed.get(document.path) ?? state.text;
  if (state.old) {
    const oldMovement = state.old.values.movement ? await validateMovement(source, state, state.old.values.movement) : null;
    const r = range(script, document.label);
    const endMark = `; yellow-editor-interaction-code-end ${document.label}`;
    const end = script.indexOf(endMark, r.from);
    const after = script.indexOf("\n", end) + 1;
    const oldCode = renderManaged(state.old, oldMovement).trimEnd();
    if (end < 0 || script.slice(r.from, after).replace(/\r\n/g, "\n").trimEnd() !== oldCode) throw new Error("The interaction's generated logic was changed in source. Review it before regenerating.");
    script = script.slice(0, r.from) + code.replace(/\n/g, script.includes("\r\n") ? "\r\n" : "\n") + script.slice(after).replace(/^\r?\n/, "");
  } else {
    const leaves = await attachTextEditing({} as ProjectSession, source).getTextLeafDocuments(document.path, document.label);
    const original = leaves[0].path === document.path && leaves[0].label === document.label
      ? script.slice(range(script, document.label).from, range(script, document.label).to).replace(new RegExp(`^${document.label}:{1,2}`), `${prefix}Original:`)
      : ` ${prefix}Original:\n\ttext_far ${leaves[0].label}\n\ttext_end\n`.trimStart();
    script = replaceBlock(script, document.label, code + original.replace(/\r\n/g, "\n") + "\n");
  }
  for (const [suffix, input] of [["Dialogue", values.dialogue], ["BagFullText", values.bagFull], ["AlreadyText", values.already]] as const) {
    const block = textBlock(`${prefix}${suffix}`, input, state, m.version >= 2 && suffix === "BagFullText" ? "prompt" : undefined);
    script = state.old ? replaceBlock(script, `${prefix}${suffix}`, block + "\n") : script + block.replace(/\n/g, script.includes("\r\n") ? "\r\n" : "\n") + "\n";
    const parsed = await parseTextDocument(document.path, `${prefix}${suffix}`, script);
    if (!parsed.editable || parsed.segments.map(segment => segment.text).join("\n") !== input.join("\n")) throw new Error("Generated dialogue did not reparse correctly.");
  }
  // Action text remains independently editable through Edit text. Remove only
  // the old action leaves and regenerate the new leaves, preserving their flow
  // controls through reordering using each dialogue action's stable identity.
  const prompts = values.actions ? sequenceDialoguePrompts(values.actions) : new Map();
  const actionBlocks = (values.actions ? sequenceDialogue(values.actions) : []).map(block => ({ label: `${prefix}${block.key}Text`, lines: block.lines, terminator: prompts.get(block.key) ? "prompt" as const : "done" as const }));
  const renderedBlocks = actionBlocks.map(block => ({ ...block, contents: textBlock(block.label, block.lines, state, block.terminator) }));
  for (const block of state.old?.values.actions ? sequenceDialogue(state.old.values.actions) : []) {
    const r = range(script, `${prefix}${block.key}Text`);
    script = script.slice(0, r.from) + script.slice(r.to);
  }
  for (const block of renderedBlocks) {
    script += block.contents.replace(/\n/g, script.includes("\r\n") ? "\r\n" : "\n") + "\n";
    const parsed = await parseTextDocument(document.path, block.label, script);
    if (!parsed.editable || parsed.terminator !== block.terminator || parsed.segments.map(segment => segment.text).join("\n") !== block.lines.join("\n")) throw new Error("Generated action dialogue did not reparse correctly.");
  }
  changed.set(document.path, script);
  const patchSource = { ...source, readText: async (path: string) => changed.get(path) ?? source.readText(path) };
  const reloaded = await loadScriptInteractionDocument(patchSource, document.path, document.label);
  if (JSON.stringify(reloaded.values) !== JSON.stringify(values)) throw new Error("The interaction did not reopen with its saved actions.");
  return Promise.all([...changed].map(async ([path, contents]) => ({ path, contents, expectedHash: await hashText(state.byPath.get(path)!) })));
}
