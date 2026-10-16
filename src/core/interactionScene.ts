import { hashText } from "./history";
import { prepareSceneBankSpace } from "./sceneBankSpace";
import { parseMapIndex } from "./mapVisualization";
import type { InteractionAction } from "./interactionSequence";
import type { ManagedInteraction, InteractionInspection } from "./scriptInteractions";
import type { ProjectSource } from "./types";

export interface SceneOptions {
  trigger: "interaction" | "coordinate";
  playerX: number; playerY: number; idleState: number; hiddenNpcs: string[];
}
interface Point { x: number; y: number }
export interface SceneActor extends Point { constant: string; id: number }
export interface SceneDomain {
  reason: string | null; mapConstant: string; actors: SceneActor[];
  idleStates: Array<{ id: number; label: string }>; stateVariable: string | null;
  defaultPlayer: Point;
  emotes: string[]; emoteReason: string | null;
}
interface Node {
  kind: "start" | "finish" | "original" | "op" | "npc-start" | "npc-wait" | "player-start" | "player-wait";
  next?: number; other?: number; action?: InteractionAction; textKey?: string;
  npc?: string; step?: string; from?: Point; to?: Point; complete?: boolean;
}
export interface ScenePlan {
  owner: number; mapConstant: string; stateVariable: string | null;
  actors: SceneActor[]; frozen: number[]; nodes: Node[]; textNodes: number[]; textSlots: number;
  visibility: Array<{ npc: string; id: number; flag: string; hiddenInitially: boolean }>;
  latchFlag: string | null; follower: boolean;
  // Optional so existing v3 source can still be verified before upgrading.
  // One reward per path: one pending delivery covers all mutually exclusive gifts.
  giftFlag?: string;
}
const delta: Record<string, Point> = { UP: { x: 0, y: -1 }, DOWN: { x: 0, y: 1 }, LEFT: { x: -1, y: 0 }, RIGHT: { x: 1, y: 0 } };
const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
const sprite = (id: number, field: string) => `wSprite${String(id).padStart(2, "0")}${field}`;
export function sceneModels(files: Array<{ contents: string }>): ManagedInteraction[] {
  return files.flatMap(file => [...file.contents.matchAll(/^\s*; yellow-editor-interaction: (.*)$/gm)].map(match => JSON.parse(match[1]) as ManagedInteraction)).filter(model => model.version === 3 && model.scene);
}
export function needsScene(actions: InteractionAction[]): boolean {
  return actions.some(action => ["walk-npc", "follow-npc", "visibility", "emote"].includes(action.kind)
    || action.kind === "choice" && (needsScene(action.yes) || needsScene(action.no))
    || action.kind === "if-event" && (needsScene(action.then) || needsScene(action.otherwise)));
}
export async function buildScenePlan(source: ProjectSource, state: InteractionInspection, model: ManagedInteraction, allocate: (name: string) => string): Promise<ScenePlan> {
  const domain = state.document.scene, options = model.values.scene;
  if (!options || !model.values.actions || domain.reason) throw new Error(domain.reason ?? "Configure the scene's trigger and player start.");
  if (model.values.movement) throw new Error("Use walking actions instead of the separate approach route.");
  if (!["interaction", "coordinate"].includes(options.trigger) || !Number.isInteger(options.playerX) || !Number.isInteger(options.playerY)
    || !domain.idleStates.some(entry => entry.id === options.idleState) || !Array.isArray(options.hiddenNpcs)
    || options.hiddenNpcs.some(npc => !domain.actors.some(actor => actor.constant === npc))) throw new Error("Choose valid scene coordinates, idle state and actors.");
  const others = sceneModels(state.files).filter(other => other.prefix !== model.prefix && other.scene!.mapConstant === domain.mapConstant);
  const owner = state.old?.scene?.owner ?? Array.from({ length: 255 }, (_, i) => i + 1).find(id => !others.some(other => other.scene!.owner === id));
  if (!owner) throw new Error("No free scene identifier remains on this map.");
  const visibility = structuredClone(state.old?.scene?.visibility ?? []), staged = new Set(options.hiddenNpcs);
  let hasGift = false;
  const visit = (actions: InteractionAction[]) => actions.forEach(action => {
    if (action.kind === "visibility") staged.add(action.npc);
    else if (action.kind === "item" || action.kind === "pokemon") hasGift = true;
    else if (action.kind === "choice") { visit(action.yes); visit(action.no); }
    else if (action.kind === "if-event") { visit(action.then); visit(action.otherwise); }
  });
  visit(model.values.actions);
  const giftFlag = state.old?.scene?.giftFlag ?? (hasGift ? allocate(`EVENT_${model.prefix.toUpperCase()}_GIFT_DELIVERED`) : undefined);
  for (const npc of staged) {
    const actor = domain.actors.find(actor => actor.constant === npc)!;
    const shared = others.flatMap(other => other.scene!.visibility).find(entry => entry.npc === npc);
    let entry = visibility.find(entry => entry.npc === npc);
    if ((entry ?? shared) && (entry ?? shared)!.hiddenInitially !== options.hiddenNpcs.includes(npc)) throw new Error("An existing staged NPC must keep its initial visibility to preserve saved event bits.");
    if (!entry) { entry = shared ?? { npc, id: actor.id, flag: allocate(`EVENT_${model.prefix.toUpperCase()}_${actor.id}_VISIBILITY`), hiddenInitially: options.hiddenNpcs.includes(npc) }; visibility.push(entry); }
  }
  const map = (await parseMapIndex(source)).find(map => map.constant === domain.mapConstant)!;
  const header = state.byPath.get(map.headerPath!)!.match(/map_header\s+\w+,\s*\w+,\s*(\w+)/)!;
  const tilesets = [...state.byPath.get("data/tilesets/tileset_headers.asm")!.matchAll(/^\s*tileset\s+(\w+),/gm)].map(match => match[1]);
  const tileset = tilesets[state.symbols.get(header[1])!];
  const collision = state.byPath.get("data/tilesets/collision_tile_ids.asm")!;
  const passable = collision.slice(collision.indexOf(`${tileset}_Coll::`)).match(/coll_tiles\s+([^\r\n;]+)/)?.[1].split(",").map(value => state.number(value.trim()));
  const graphics = state.byPath.get("gfx/tilesets.asm")!;
  const asset = graphics.slice(graphics.indexOf(`${tileset}_Block::`)).match(/INCBIN "([^"]+)"/)?.[1];
  if (!passable || passable.some(tile => tile === null) || !asset) throw new Error("Cannot prove the map's walking surfaces.");
  const [blocks, blockset] = await Promise.all([source.readBytes(`maps/${state.mapName}.blk`), source.readBytes(asset)]);
  const coordinates = (event: string) => [...state.objects.matchAll(new RegExp(`^[ \\t]*${event}\\s+(\\d+),\\s*(\\d+)`, "gm"))].map(match => ({ x: +match[1], y: +match[2] }));
  const warps = coordinates("warp_event"), signs = coordinates("bg_event");
  const walkable = (p: Point, npcOnly = false) => {
    if (p.x < 0 || p.y < 0 || p.x >= map.width * 2 || p.y >= map.height * 2 || signs.some(other => same(other, p))) return false;
    // Native warps inspect player coordinates, not NPC positions. Scripted NPC
    // movement can enter a door tile (even one absent from collision tiles).
    // Following routes still use ordinary player collision rules.
    if (warps.some(other => same(other, p))) return npcOnly;
    return passable.includes(blockset[blocks[Math.floor(p.y / 2) * map.width + Math.floor(p.x / 2)] * 16 + (p.y % 2 * 2 + 1) * 4 + p.x % 2 * 2]);
  };
  if (!walkable({ x: options.playerX, y: options.playerY }, options.trigger === "coordinate")) throw new Error("Choose a walkable player start away from signs. Warp starts require a coordinate scene.");
  interface World { player: Point; actors: Record<string, Point>; visible: Record<string, boolean> }
  const world: World = { player: { x: options.playerX, y: options.playerY }, actors: Object.fromEntries(domain.actors.map(actor => [actor.constant, { x: actor.x, y: actor.y }])), visible: Object.fromEntries(domain.actors.map(actor => [actor.constant, !options.hiddenNpcs.includes(actor.constant)])) };
  const routes = new Map<string, Array<{ from: Point; to: Point; step: string; playerFrom: Point; playerTo: Point; playerStep?: string }>>();
  function validate(actions: InteractionAction[], worlds: World[], path = "Action"): World[] {
    for (const [i, action] of actions.entries()) {
      const key = `${path}${i + 1}`;
      if (action.kind === "end") return [];
      if (action.kind === "choice" || action.kind === "if-event") {
        const branches = action.kind === "choice" ? [[action.yes, "Yes"], [action.no, "No"]] as const : [[action.then, "Then"], [action.otherwise, "Otherwise"]] as const;
        worlds = branches.flatMap(([entries, suffix]) => validate(entries, structuredClone(worlds), `${key}${suffix}`));
        if (worlds.some(world => JSON.stringify(world) !== JSON.stringify(worlds[0]))) throw new Error("Rejoining branches must have the same player, actor positions and visibility. End differently staged branches separately.");
        worlds = worlds.slice(0, 1);
      } else for (const world of worlds) {
        if (action.kind === "visibility") {
          if (action.visible && (same(world.actors[action.npc], world.player) || state.objectRows.some((row, index) => {
            const name = state.npcConstants[index];
            return name !== action.npc && world.visible[name] !== false && same(world.actors[name] ?? { x: +row[1], y: +row[2] }, world.actors[action.npc]);
          }))) throw new Error("Cannot show an NPC on an occupied tile.");
          world.visible[action.npc] = action.visible; continue;
        }
        if (action.kind === "emote") {
          if (!world.visible[action.npc]) throw new Error("Show the hidden NPC before making it emote.");
          const actor = world.actors[action.npc];
          if (Math.abs(actor.x - world.player.x) > 4 || Math.abs(actor.y - world.player.y) > 3) throw new Error("Keep an emoting NPC on screen.");
          continue;
        }
        if (action.kind !== "walk-npc" && action.kind !== "follow-npc") continue;
        if (!world.visible[action.npc]) throw new Error("Show the hidden NPC before walking it.");
        const route: NonNullable<ReturnType<typeof routes.get>> = [];
        for (const step of action.steps) {
          const from = { ...world.actors[action.npc] }, to = { x: from.x + delta[step].x, y: from.y + delta[step].y }, playerFrom = { ...world.player };
          if (action.kind === "follow-npc" && warps.some(warp => same(warp, to))) throw new Error(`Following routes cannot enter a warp at (${to.x}, ${to.y}). Use Walk NPC for an NPC-only departure.`);
          if (!walkable(to, action.kind === "walk-npc") || same(to, world.player) || state.objectRows.some((row, index) => {
            const name = state.npcConstants[index];
            return name !== action.npc && world.visible[name] !== false && same(world.actors[name] ?? { x: +row[1], y: +row[2] }, to);
          })) throw new Error(`The NPC route is blocked at (${to.x}, ${to.y}).`);
          if (Math.abs(to.x - world.player.x) > 4 || Math.abs(to.y - world.player.y) > 3) throw new Error("Keep walking NPCs on screen; use following for longer routes.");
          let playerStep: string | undefined;
          if (action.kind === "follow-npc") {
            playerStep = Object.entries(delta).find(([, d]) => world.player.x + d.x === from.x && world.player.y + d.y === from.y)?.[0];
            if (!playerStep || !walkable(from)) throw new Error("The player must start beside the leading NPC on a clear following route.");
            world.player = from;
          }
          world.actors[action.npc] = to;
          route.push({ from, to, step, playerFrom, playerTo: { ...world.player }, playerStep });
        }
        routes.set(key, route);
      }
    }
    return worlds;
  }
  validate(model.values.actions, [world]);
  const nodes: Node[] = [{ kind: "start" }], add = (node: Node) => { nodes.push(node); return nodes.length - 1; };
  const success = add({ kind: "finish", complete: true }), failed = add({ kind: "finish", complete: false });
  function compile(actions: InteractionAction[], next: number, path = "Action"): number {
    for (let i = actions.length - 1; i >= 0; i--) {
      const action = actions[i], key = `${path}${i + 1}`;
      if (action.kind === "end") { next = action.complete ? success : failed; continue; }
      if (action.kind === "choice" || action.kind === "if-event") {
        const branches = action.kind === "choice" ? [[action.yes, "Yes"], [action.no, "No"]] as const : [[action.then, "Then"], [action.otherwise, "Otherwise"]] as const;
        const a = compile(branches[0][0], next, `${key}${branches[0][1]}`), b = compile(branches[1][0], next, `${key}${branches[1][1]}`);
        next = add({ kind: "op", action, next: a, other: b });
      } else if (action.kind === "walk-npc" || action.kind === "follow-npc") {
        for (const step of routes.get(key)!.slice().reverse()) {
          if (step.playerStep) {
            const wait = add({ kind: "player-wait", to: step.playerTo, next });
            next = add({ kind: "player-start", from: step.playerFrom, to: step.playerTo, step: step.playerStep, next: wait });
          }
          const wait = add({ kind: "npc-wait", npc: action.npc, to: step.to, next });
          next = add({ kind: "npc-start", npc: action.npc, from: step.from, to: step.to, step: step.step, next: wait });
        }
      } else next = add({ kind: "op", action, next, textKey: action.kind === "dialogue" ? action.textId ?? key : undefined });
    }
    return next;
  }
  const first = compile(model.values.actions, success);
  nodes[0].next = model.values.showOriginal ? add({ kind: "original", next: first }) : first;
  if (nodes.length > 128) throw new Error("The scene exceeds the 128-state dispatcher. Shorten its routes or actions.");
  const textNodes = nodes.flatMap((node, i) => node.kind === "original" || node.kind === "op" && ["dialogue", "choice", "item", "pokemon"].includes(node.action!.kind) ? [i] : []);
  return { owner, mapConstant: domain.mapConstant, stateVariable: domain.stateVariable, actors: domain.actors, frozen: state.objectRows.map((_, i) => i + 1), nodes, textNodes,
    textSlots: Math.max(textNodes.length, state.old?.scene?.textSlots ?? 0), visibility, follower: state.byPath.has("scripts/OaksLab_2.asm"),
    latchFlag: state.old?.scene?.latchFlag ?? (options.trigger === "coordinate" ? allocate(`EVENT_${model.prefix.toUpperCase()}_SCENE_LATCH`) : null),
    ...(giftFlag ? { giftFlag } : {}) };
}
export function sceneRootHook(prefix: string) { return `\t; yellow-editor-scene-hook ${prefix}\n\tcall ${prefix}SceneFrame\n\tret c\n\t; yellow-editor-scene-hook-end ${prefix}\n`; }

export function renderScene(model: ManagedInteraction): string {
  const p = model.prefix, plan = model.scene!, v = model.values, options = v.scene!;
  const actorId = (npc: string) => plan.actors.find(actor => actor.constant === npc)!.id;
  const next = (id: number) => [`\tld a, ${id}`, "\tld [wEditorSceneState], a", "\tret"];
  const print = (suffix: string) => [`\tld hl, ${p}${suffix}`, "\tcall PrintText"];
  const condition = (target: string) => v.condition ? [`\tCheckEvent ${v.condition.event}`, `\tjp ${v.condition.set ? "z" : "nz"}, ${target}`] : [];
  const location = (x: string, y: string, point: Point, target: string, offset = 0) => [`\tld a, [${x}]`, `\tcp ${point.x + offset}`, `\tjp nz, ${target}`, `\tld a, [${y}]`, `\tcp ${point.y + offset}`, `\tjp nz, ${target}`];
  const guards = (fallback: string) => [
    ...(plan.stateVariable ? [`\tld a, [${plan.stateVariable}]`, `\tcp ${options.idleState}`, `\tjp nz, ${fallback}`] : []),
    "\tld a, [wWalkCounter]", "\tand a", `\tjp nz, ${fallback}`, "\tld a, [wLinkState]", "\tand a", `\tjp nz, ${fallback}`,
    "\tld a, [wStatusFlags5]", "\tand (1 << BIT_SCRIPTED_NPC_MOVEMENT) | (1 << BIT_SCRIPTED_MOVEMENT_STATE)", `\tjp nz, ${fallback}`,
    "\tld a, [wNPCMovementScriptPointerTableNum]", "\tand a", `\tjp nz, ${fallback}`,
    ...location("wXCoord", "wYCoord", { x: options.playerX, y: options.playerY }, fallback),
    ...plan.actors.filter(actor => plan.nodes.some(node => node.npc === actor.constant || (node.action?.kind === "visibility" || node.action?.kind === "emote") && node.action.npc === actor.constant)).flatMap(actor => location(sprite(actor.id, "StateData2MapX"), sprite(actor.id, "StateData2MapY"), actor, fallback, 4)),
  ];
  const lines = [`${model.label}:`, "\ttext_asm", `\t; yellow-editor-interaction: ${JSON.stringify(model)}`];
  if (options.trigger === "interaction") lines.push(...(v.once && model.flag ? [`\tCheckEvent ${model.flag}`, `\tjp nz, ${p}Already`] : []), ...condition(`${p}OriginalOnly`),
    "\tld a, [wEditorSceneActive]", "\tand a", `\tjp nz, ${p}OriginalOnly`, ...guards(`${p}OriginalOnly`), `\tcall ${p}Launch`, "\tld a, 1", "\tld [wDoNotWaitForButtonPressAfterDisplayingText], a", "\tjp TextScriptEnd");
  else lines.push(`\tjp ${p}OriginalOnly`);
  lines.push(`${p}Already:`, ...print("AlreadyText"), "\tjp TextScriptEnd", `${p}OriginalOnly:`, ...print("Original"), "\tjp TextScriptEnd", "", `${p}SceneFrame:`, "\tld a, [wEditorSceneActive]", "\tand a", "\tjp nz, .active");
  if (options.trigger === "coordinate") lines.push(...location("wXCoord", "wYCoord", { x: options.playerX, y: options.playerY }, `${p}ClearLatch`),
    `\tCheckEvent ${plan.latchFlag}`, "\tjp nz, .inactive", ...(v.once && model.flag ? [`\tCheckEvent ${model.flag}`, "\tjp nz, .inactive"] : []),
    ...condition(`${p}Inactive`), ...guards(`${p}Inactive`), `\tSetEvent ${plan.latchFlag}`, `\tcall ${p}Launch`);
  else lines.push("\tjp .inactive");
  lines.push(".active", "\tld a, [wEditorSceneMap]", `\tcp ${plan.mapConstant}`, "\tjp nz, .inactive", "\tld a, [wEditorSceneOwner]", `\tcp ${plan.owner}`, "\tjp nz, .inactive",
    "\tld a, $ff", "\tld [wJoyIgnore], a", `\tld hl, ${p}ScenePointers`, "\tld a, [wEditorSceneState]", `\tcp ${plan.nodes.length}`, `\tjp nc, ${p}Abort`, "\tcall CallFunctionInTable", "\tscf", "\tret", ".inactive", "\tand a", "\tret", `${p}Inactive:`, "\tand a", "\tret", "");
  if (plan.latchFlag) lines.push(`${p}ClearLatch:`, `\tResetEvent ${plan.latchFlag}`, "\tand a", "\tret", "");
  lines.push(`${p}Launch:`, "\tld a, [wJoyIgnore]", "\tld [wEditorSceneJoyIgnore], a", "\tld a, [wOverrideSimulatedJoypadStatesMask]", "\tld [wEditorSceneOverride], a", "\tld a, [wStatusFlags4]", "\tld [wEditorSceneFlags4], a",
    ...plan.visibility.flatMap((entry, i) => [`\tCheckEvent ${entry.flag}`, "\tld a, 0", `\tjr z, .visibility${i}`, "\tinc a", `.visibility${i}`, `\tld [wEditorSceneVisibility + ${i}], a`]),
    ...plan.frozen.flatMap((id, i) => [`\tld a, [wMapSpriteData + ${(id - 1) * 2}]`, `\tld [wEditorSceneDirections + ${i}], a`, `\tld a, [${sprite(id, "StateData2MovementByte1")}]`, `\tld [wEditorSceneMovements + ${i}], a`, "\tld a, STAY", `\tld [${sprite(id, "StateData2MovementByte1")}], a`]),
    "\tld hl, wStatusFlags4", "\tset BIT_NO_BATTLES, [hl]", `\tld a, ${plan.mapConstant}`, "\tld [wEditorSceneMap], a", `\tld a, ${plan.owner}`, "\tld [wEditorSceneOwner], a", "\txor a", "\tld [wEditorSceneState], a", "\tld a, 1", "\tld [wEditorSceneActive], a", "\tld a, $ff", "\tld [wJoyIgnore], a", "\txor a", "\tldh [hJoyHeld], a", "\tret", "", `${p}ScenePointers:`, ...plan.nodes.map((_, i) => `\tdw ${p}State${i}`), "");
  const occupied = (point: Point, excluded: number, name: string) => [
    ...plan.frozen.filter(id => id !== excluded).flatMap(id => [
      `\tld a, [${sprite(id, "StateData1PictureID")}]`, "\tand a", `\tjr z, .${name}${id}`, `\tld a, ${id * 16}`, "\tldh [hCurrentSpriteOffset], a", "\tpush bc", "\tpredef IsObjectHidden", "\tpop bc", "\tldh a, [hIsToggleableObjectOff]", "\tand a", `\tjr nz, .${name}${id}`,
      `\tld a, [${sprite(id, "StateData2MapX")}]`, `\tcp ${point.x + 4}`, `\tjr nz, .${name}${id}`, `\tld a, [${sprite(id, "StateData2MapY")}]`, `\tcp ${point.y + 4}`, `\tjp z, ${p}Abort`, `.${name}${id}`,
    ]),
    ...(plan.follower ? ["\tld a, [wSpritePikachuStateData1PictureID]", "\tand a", `\tjr z, .${name}Pikachu`, "\tld a, [wSpritePikachuStateData2MapX]", `\tcp ${point.x + 4}`, `\tjr nz, .${name}Pikachu`, "\tld a, [wSpritePikachuStateData2MapY]", `\tcp ${point.y + 4}`, `\tjp z, ${p}Abort`, `.${name}Pikachu`] : []),
  ];
  plan.nodes.forEach((node, i) => {
    lines.push(`${p}State${i}:`);
    if (node.kind === "start") lines.push(...next(node.next!));
    else if (node.kind === "finish") lines.push(...(node.complete ? [...(v.once && model.flag ? [`\tSetEvent ${model.flag}`] : []),
      // Only normal completion retires the pending delivery. Aborts and map
      // reloads retain it; a repeatable scene can give again after completing.
      ...(plan.giftFlag ? [`\tResetEvent ${plan.giftFlag}`] : []),
      ...v.events.map(event => `\t${event.set ? "SetEvent" : "ResetEvent"} ${event.event}`), `\tjp ${p}Cleanup`] : [`\tjp ${p}Abort`]));
    else if (node.kind === "npc-start") {
      const id = actorId(node.npc!);
      lines.push(...location(sprite(id, "StateData2MapX"), sprite(id, "StateData2MapY"), node.from!, `${p}Abort`, 4), ...occupied(node.to!, id, `npc${i}`),
        "\tld a, [wXCoord]", `\tcp ${node.to!.x}`, "\tjr nz, .clear", "\tld a, [wYCoord]", `\tcp ${node.to!.y}`, `\tjp z, ${p}Abort`, ".clear", `\tld a, ${id * 16}`, "\tldh [hCurrentSpriteOffset], a", "\tpredef IsObjectHidden", "\tldh a, [hIsToggleableObjectOff]", "\tand a", `\tjp nz, ${p}Abort`,
        "\tld a, NONE", `\tld [wMapSpriteData + ${(id - 1) * 2}], a`, `\tld a, ${node.npc}`, "\tldh [hSpriteIndex], a", `\tld de, ${p}Route${i}`, "\tcall MoveSprite", ...next(node.next!));
    } else if (node.kind === "npc-wait") lines.push("\tld a, [wStatusFlags5]", "\tbit BIT_SCRIPTED_NPC_MOVEMENT, a", "\tret nz", ...location(sprite(actorId(node.npc!), "StateData2MapX"), sprite(actorId(node.npc!), "StateData2MapY"), node.to!, `${p}Abort`, 4), ...next(node.next!));
    else if (node.kind === "player-start") lines.push(...location("wXCoord", "wYCoord", node.from!, `${p}Abort`), ...occupied(node.to!, 0, `player${i}`),
      `\tld a, PAD_${node.step}`, "\tld [wSimulatedJoypadStatesEnd], a", "\tld a, 1", "\tld [wSimulatedJoypadStatesIndex], a", "\tcall StartSimulatingJoypadStates", ...next(node.next!));
    else if (node.kind === "player-wait") lines.push("\tld a, [wSimulatedJoypadStatesIndex]", "\tand a", "\tret nz", "\tld a, [wWalkCounter]", "\tand a", "\tret nz", "\tld a, [wStatusFlags5]", "\tbit BIT_SCRIPTED_MOVEMENT_STATE, a", "\tret nz", ...location("wXCoord", "wYCoord", node.to!, `${p}Abort`), ...next(node.next!));
    else if (node.kind === "original" || node.action && ["dialogue", "choice", "item", "pokemon"].includes(node.action.kind)) {
      lines.push("\txor a", "\tld [wJoyIgnore], a", `\tld a, TEXT_${p.toUpperCase()}_SCENE_${plan.textNodes.indexOf(i)}`, "\tldh [hTextID], a", "\tcall DisplayTextID", "\tld a, $ff", "\tld [wJoyIgnore], a", "\tret");
    } else if (node.action) {
      const a = node.action;
      if (a.kind === "if-event") lines.push(`\tCheckEvent ${a.event}`, `\tld a, ${node.next}`, `\tjr ${a.set ? "nz" : "z"}, .selected`, `\tld a, ${node.other}`, ".selected", "\tld [wEditorSceneState], a", "\tret");
      else {
        if (a.kind === "visibility") { const entry = plan.visibility.find(entry => entry.npc === a.npc)!; lines.push(`\t${a.visible === entry.hiddenInitially ? "SetEvent" : "ResetEvent"} ${entry.flag}`, "\tcall UpdateSprites"); }
        else if (a.kind === "event") lines.push(`\t${a.set ? "SetEvent" : "ResetEvent"} ${a.event}`);
        else if (a.kind === "wait") lines.push(`\tld c, ${a.frames}`, "\tcall DelayFrames");
        else if (a.kind === "heal") lines.push("\tpredef HealParty");
        else if (a.kind === "sound") lines.push(`\tld a, ${a.sound}`, "\tcall PlaySound", ...(a.wait ? ["\tcall WaitForSoundToFinish"] : []));
        else if (a.kind === "emote") {
          const id = actorId(a.npc);
          lines.push(`\tld a, [${sprite(id, "StateData1PictureID")}]`, "\tand a", `\tjp z, ${p}Abort`,
            `\tld a, ${id * 16}`, "\tldh [hCurrentSpriteOffset], a", "\tpredef IsObjectHidden", "\tldh a, [hIsToggleableObjectOff]", "\tand a", `\tjp nz, ${p}Abort`,
            `\tld a, ${id}`, "\tld [wEmotionBubbleSpriteIndex], a", `\tld a, ${a.bubble}`, "\tld [wWhichEmotionBubble], a", "\tpredef EmotionBubble");
        }
        lines.push(...next(node.next!));
      }
    }
    lines.push("");
    if (node.kind === "npc-start") lines.push(`${p}Route${i}:`, `\tdb NPC_MOVEMENT_${node.step}`, "\tdb -1", "");
  });
  // Fuse dialogue -> choice within the same native text session, including joins.
  const choose = (node: Node) => ["\tcall YesNoChoice", "\tld a, [wCurrentMenuItem]", "\tand a", "\tjr nz, .no", `\tld a, ${node.next}`, "\tjr .selected", ".no", `\tld a, ${node.other}`, ".selected", "\tld [wEditorSceneState], a"];
  plan.textNodes.forEach((id, index) => {
    const node = plan.nodes[id], a = node.action;
    lines.push(`${p}SceneText${index}:`, "\ttext_asm");
    if (node.kind === "original") lines.push(...print("Original"), ...(!model.originalHasPrompt ? [...print("AdvanceText")] : []));
    else if (a?.kind === "dialogue") lines.push(...print(`${node.textKey}Text`));
    if (a?.kind === "choice") lines.push(...choose(node));
    else if (a?.kind === "dialogue" && plan.nodes[node.next!].action?.kind === "choice") { lines.push(...choose(plan.nodes[node.next!])); }
    else if (a?.kind === "item" || a?.kind === "pokemon") {
      lines.push(...(plan.giftFlag ? [`\tCheckEvent ${plan.giftFlag}`, "\tjr nz, .delivered"] : []),
        `\tlb bc, ${a.kind === "item" ? `${a.item}, ${a.quantity}` : `${a.species}, ${a.level}`}`, `\tcall ${a.kind === "item" ? "GiveItem" : "GivePokemon"}`, "\tjr nc, .full",
        // Commit immediately on carry success, before prompts or further steps.
        ...(plan.giftFlag ? [`\tSetEvent ${plan.giftFlag}`] : []),
        ...(a.kind === "pokemon" ? ["\tld a, [wAddedToParty]", "\tand a", "\tcall z, WaitForTextScrollButtonPress", "\tcall EnableAutoTextBoxDrawing"] : ["\tld a, SFX_GET_ITEM_1", "\tcall PlaySound", "\tcall WaitForSoundToFinish"]),
        ...(plan.giftFlag ? [".delivered"] : []), `\tld a, ${node.next}`, "\tjr .selected", ".full", ...print("BagFullText"), "\tld a, 2", ".selected", "\tld [wEditorSceneState], a");
    } else lines.push(`\tld a, ${node.next}`, "\tld [wEditorSceneState], a");
    lines.push("\tld a, 1", "\tld [wDoNotWaitForButtonPressAfterDisplayingText], a", "\tjp TextScriptEnd", "");
  });
  for (let i = plan.textNodes.length; i < plan.textSlots; i++) lines.push(`${p}SceneText${i}:`, "\ttext_asm", "\tjp TextScriptEnd", "");
  lines.push(`${p}AdvanceText:`, "\ttext_promptbutton", "\ttext_end", "", `${p}Abort:`, ...plan.visibility.flatMap((entry, i) => [`\tld a, [wEditorSceneVisibility + ${i}]`, "\tand a", `\tjr z, .restore${i}`, `\tSetEvent ${entry.flag}`, `\tjr .next${i}`, `.restore${i}`, `\tResetEvent ${entry.flag}`, `.next${i}`]),
    `${p}Cleanup:`, ...plan.frozen.flatMap((id, i) => [`\tld a, [wEditorSceneDirections + ${i}]`, `\tld [wMapSpriteData + ${(id - 1) * 2}], a`, `\tld a, [wEditorSceneMovements + ${i}]`, `\tld [${sprite(id, "StateData2MovementByte1")}], a`]),
    "\tld a, [wEditorSceneJoyIgnore]", "\tld [wJoyIgnore], a", "\tld a, [wEditorSceneOverride]", "\tld [wOverrideSimulatedJoypadStatesMask], a", "\tld a, [wEditorSceneFlags4]", "\tand 1 << BIT_NO_BATTLES", "\tld b, a", "\tld a, [wStatusFlags4]", "\tand ~(1 << BIT_NO_BATTLES)", "\tor b", "\tld [wStatusFlags4], a", "\txor a", "\tld [wEditorSceneActive], a", "\tld [wSimulatedJoypadStatesIndex], a", "\tld [wSimulatedJoypadStatesEnd], a", "\tld [wUnusedOverrideSimulatedJoypadStatesIndex], a", "\tldh [hJoyHeld], a", "\tret", "");
  if (model.arrival) for (const idle of model.idleStates ?? [0]) for (const kind of ["Start", "Arrive", "Cleanup"]) lines.push(`${p}${idle ? `Resume${idle}` : ""}${kind}State:`, `\tld a, ${idle}`, `\tld [${plan.stateVariable}], a`, "\tret", "");
  return lines.join("\n") + `; yellow-editor-interaction-code-end ${model.label}\n\n`;
}

const visibilityHook = "\t; yellow-editor-scene-visibility-hook\n\tpush bc\n\tpush de\n\tpush hl\n\tcall EditorSceneObjectHidden\n\tpop hl\n\tpop de\n\tpop bc\n\tret c\n\t; yellow-editor-scene-visibility-hook-end\n";
const entryHook = "\t; yellow-editor-scene-map-entry-hook\n\txor a\n\tld [wEditorSceneActive], a\n\t; yellow-editor-scene-map-entry-hook-end\n";
function sceneEntryHook(models: ManagedInteraction[]) {
  const latches = [...new Set(models.flatMap(model => model.scene?.latchFlag ? [model.scene.latchFlag] : []))].sort().map(flag => `\tResetEvent ${flag}\n`).join("");
  // EnterMap runs before JoypadOverworld's first map-script tick. Rearm each
  // coordinate latch here, including departure directly through its warp tile.
  return entryHook.replace("\t; yellow-editor-scene-map-entry-hook-end", latches + "\t; yellow-editor-scene-map-entry-hook-end");
}
// Replace a reviewed 56-byte unused reservation, preserving its exact size and
// every existing WRAM/save address. Native movement/menu unions cannot hold this.
const scratch = "; yellow-editor-scene-scratch: 1\nwEditorSceneDirections:: ds 14\nwEditorSceneMovements:: ds 14\nwEditorSceneVisibility:: ds 14\nwEditorSceneJoyIgnore:: db\nwEditorSceneOverride:: db\nwEditorSceneFlags4:: db\nwEditorSceneMap:: db\nwEditorSceneOwner:: db\nwEditorSceneState:: db\nwEditorSceneActive:: db\n\tds 7\n; yellow-editor-scene-scratch-end\n";
function runtime(models: ManagedInteraction[]) {
  const entries = new Map<string, { map: string; entry: ScenePlan["visibility"][number] }>();
  models.forEach(model => model.scene!.visibility.forEach(entry => entries.set(`${model.scene!.mapConstant}:${entry.npc}`, { map: model.scene!.mapConstant, entry })));
  return "; yellow-editor-scene-runtime: 1\nEditorSceneObjectHidden:\n" + [...entries.values()].sort((a, b) => `${a.map}:${a.entry.npc}`.localeCompare(`${b.map}:${b.entry.npc}`)).map(({ map, entry }, i) => [
    "\tld a, [wCurMap]", `\tcp ${map}`, `\tjr nz, .next${i}`, "\tldh a, [hCurrentSpriteOffset]", `\tcp ${entry.id * 16}`, `\tjr nz, .next${i}`, `\tCheckEvent ${entry.flag}`, "\tld a, 0", `\tjr ${entry.hiddenInitially ? "nz" : "z"}, .result${i}`, "\tinc a", `.result${i}`, "\tldh [hIsToggleableObjectOff], a", "\tscf", "\tret", `.next${i}`,
  ].join("\n")).join("\n") + "\n\tand a\n\tret\n; yellow-editor-scene-runtime-end\n";
}
function body(text: string, label: string) {
  const match = text.match(new RegExp(`^${label}:{1,2}\\n([\\s\\S]*?)(?=^[A-Za-z_]\\w*:{1,2}|$(?![\\s\\S]))`, "m"));
  if (!match) throw new Error(`Missing scene dependency ${label}.`);
  return match[1].split("\n").map(line => line.split(";", 1)[0].trim()).filter(Boolean).join("\n");
}
export async function prepareSceneRuntime(state: InteractionInspection, model: ManagedInteraction, changed: Map<string, string>) {
  await prepareSceneBankSpace(state, changed);
  const existing = sceneModels(state.files), all = [...existing.filter(other => other.prefix !== model.prefix), model];
  const normalize = (text: string) => text.replace(/\r\n/g, "\n");
  const save = (path: string, text: string) => changed.set(path, text.replace(/\n/g, state.byPath.get(path)!.includes("\r\n") ? "\r\n" : "\n"));
  const visibilityPath = "engine/overworld/toggleable_objects.asm";
  let text = normalize(state.byPath.get(visibilityPath)!);
  if (existing.length) {
    const old = runtime(existing);
    if (!text.endsWith(old) || !text.includes(visibilityHook)) throw new Error("The shared scene visibility runtime was changed in source.");
    text = text.slice(0, -old.length) + runtime(all);
  } else {
    if (await hashText(body(text, "IsObjectHidden")) !== "f78a101337f2f157e91014ea8ad83876e16bc65120172c6cf098c16215ac7008") throw new Error("Scene visibility needs the reviewed native IsObjectHidden routine.");
    text = text.replace("IsObjectHidden:\n", "IsObjectHidden:\n" + visibilityHook) + "\n" + runtime(all);
  }
  save(visibilityPath, text);
  const ram = normalize(state.byPath.get("ram/wram.asm")!), clear = normalize(state.byPath.get("engine/overworld/clear_variables.asm")!);
  if (existing.length) {
    const previous = sceneEntryHook(existing);
    if (!ram.includes(scratch) || !clear.includes(previous) && !clear.includes(entryHook)) throw new Error("The scene scratch or map-entry hook was changed in source.");
    save("engine/overworld/clear_variables.asm", clear.replace(clear.includes(previous) ? previous : entryHook, sceneEntryHook(all)));
  } else {
    const reservation = "wGameProgressFlagsEnd::\n\n\tds 56\n";
    if (ram.split(reservation).length !== 2 || /wEditorScene\w+/.test(ram)) throw new Error("Scene storage requires the reviewed unused 56-byte WRAM reservation.");
    if (await hashText(body(clear, "ClearVariablesOnEnterMap")) !== "86ee2041b20584e3b9df2c0ee987347ebc8f201797e1b09e1349747b6d985296") throw new Error("Scene cleanup needs the reviewed map-entry routine.");
    save("ram/wram.asm", ram.replace(reservation, "wGameProgressFlagsEnd::\n\n" + scratch));
    save("engine/overworld/clear_variables.asm", clear.replace("ClearVariablesOnEnterMap::\n", "ClearVariablesOnEnterMap::\n" + sceneEntryHook(all)));
  }
}
