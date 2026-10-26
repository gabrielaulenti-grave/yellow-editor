import { partnerHelpers, renderPartnerMove, type PartnerDomain, type PartnerRouteCell } from "./scenePartner";
import { InteractionValidationError, actionValidationError } from "./interactionValidation";
import { hashText } from "./history";
import { trainerEntryHook } from "./mapTrainerRuntime";
import { sceneVisibilityHook as visibilityHook, conditionVisibilityHook } from "./objectVisibilityHooks";
import { renderConditionFailure, renderPlayerCondition, validatePlayerCondition, type PlayerCondition } from "./playerConditions";
import { renderNpcTransaction, renderNpcShop } from "./npcServices";
import { reviewStrengthVisibility, strengthControlsVisibility } from "./mapStrength";
import { prepareSceneBankSpace, prepareSharedSceneBankSpace } from "./sceneBankSpace";
import { itemClaims } from "./sceneFlags";
import { prepareSceneTextHandoff } from "./sceneTextHandoff";
import { renderSceneEffect, renderSceneEffectHelpers, effectScratchFields, effectEntryHook, legacyEffectEntryHook, sceneBattleReturnHook, battleSnapshotRuntime } from "./sceneEffectRuntime";
import { parseMapIndex } from "./mapVisualization";
import { interactionBranches, isBattle, type InteractionAction } from "./interactionSequence";
import type { ManagedInteraction, InteractionInspection } from "./scriptInteractions";
import type { ProjectSource } from "./types";
import { matchesPlayerPosition, facingToward, renderPositionTest } from "./scenePosition";

export interface SceneOptions {
  trigger: "interaction" | "coordinate";
  playerX: number; playerY: number; idleState: number; hiddenNpcs: string[];
  additionalStarts?: Array<{ x: number; y: number }>;
  automaticStarts?: Array<{ x: number; y: number }>;
  automaticCondition?: PlayerCondition;
}
interface Point { x: number; y: number }
export const maximumSceneStarts = 8;
export function scenePlayerStarts(options: SceneOptions): Point[] {
  return [{ x: options.playerX, y: options.playerY }, ...(options.additionalStarts ?? [])];
}
export interface SceneActor extends Point { constant: string; id: number; canWalk?: boolean }
export interface SceneDomain {
  reason: string | null; mapConstant: string; actors: SceneActor[];
  idleStates: Array<{ id: number; label: string }>; stateVariable: string | null;
  defaultPlayer: Point;
  partner?: PartnerDomain;
  emotes: string[]; emoteReason: string | null;
}
export interface SceneNode {
  kind: "start" | "finish" | "original" | "op" | "npc-start" | "npc-wait" | "player-start" | "player-wait" | "battle-start" | "battle-return";
  next?: number; other?: number; action?: InteractionAction; textKey?: string;
  npc?: string; step?: string; from?: Point; to?: Point; complete?: boolean;
  caught?: number; staging?: SceneActor[]; partnerRoute?: PartnerRouteCell[];
  unpaid?: number; noRoom?: number;
}
type Node = SceneNode;
export interface ScenePlan {
  owner: number; mapConstant: string; stateVariable: string | null;
  actors: SceneActor[]; frozen: number[]; nodes: Node[]; textNodes: number[]; textSlots: number;
  visibility: Array<{ npc: string; id: number; flag: string; hiddenInitially: boolean }>;
  latchFlag: string | null; follower: boolean;
  // Optional so existing v3 source can still be verified before upgrading.
  // One reward per path: one pending delivery covers all mutually exclusive gifts.
  giftFlag?: string;
  textHandoff?: true;
  starts?: Array<Point & { next: number }>;
  partner?: true;
  partnerReturns?: Array<{ x: number; y: number; steps: number[] }>;
  effects?: { music: Array<{ id: string; header: string }>; battles: Record<string, { won: string; caught?: string }> };
}
const delta: Record<string, Point> = { UP: { x: 0, y: -1 }, DOWN: { x: 0, y: 1 }, LEFT: { x: -1, y: 0 }, RIGHT: { x: 1, y: 0 } };
const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
const sprite = (id: number, field: string) => `wSprite${String(id).padStart(2, "0")}${field}`;
export function sceneModels(files: Array<{ contents: string }>): ManagedInteraction[] {
  return files.flatMap(file => [...file.contents.matchAll(/^\s*; yellow-editor-interaction: (.*)$/gm)].map(match => JSON.parse(match[1]) as ManagedInteraction)).filter(model => model.version === 3 && model.scene);
}
export function needsScene(actions: InteractionAction[]): boolean {
  return actions.some(action => action.kind === "item" && Boolean(action.claim) || ["if-position", "face-npc", "face-player", "if-partner", "partner-move", "walk-npc", "follow-npc", "visibility", "emote", "music", "fade", "wild-battle", "trainer-battle"].includes(action.kind)
    || interactionBranches(action).some(([branch]) => needsScene(branch)));
}
export async function buildScenePlan(source: ProjectSource, state: InteractionInspection, model: ManagedInteraction, allocate: (name: string) => string): Promise<ScenePlan> {
  const domain = state.document.scene, options = model.values.scene;
  if (!options || !model.values.actions || domain.reason) throw new Error(domain.reason ?? "Configure the scene's trigger and player start.");
  if (model.values.movement) throw new Error("Use walking actions instead of the separate approach route.");
  if (!["interaction", "coordinate"].includes(options.trigger) || !Number.isInteger(options.playerX) || !Number.isInteger(options.playerY)
    || !domain.idleStates.some(entry => entry.id === options.idleState) || !Array.isArray(options.hiddenNpcs)
    || options.hiddenNpcs.some(npc => !domain.actors.some(actor => actor.constant === npc))) throw new Error("Choose valid scene coordinates, idle state and actors.");
  if (options.additionalStarts !== undefined && (!Array.isArray(options.additionalStarts) || options.additionalStarts.some(point => !point || !Number.isInteger(point.x) || !Number.isInteger(point.y)))) throw new Error("Choose whole-number X/Y coordinates for every player start.");
  const starts = scenePlayerStarts(options);
  if (options.automaticStarts !== undefined && (options.trigger !== "interaction" || !Array.isArray(options.automaticStarts) || !options.automaticStarts.length
    || options.automaticStarts.some(point => !point || !starts.some(start => same(start, point))) || new Set(options.automaticStarts.map(point => `${point.x},${point.y}`)).size !== options.automaticStarts.length)) throw new Error("Choose distinct automatic trigger tiles from this interaction's player starts.");
  if (options.automaticCondition) {
    if (!options.automaticStarts) throw new Error("Choose automatic start tiles before adding a trigger condition.");
    validatePlayerCondition(options.automaticCondition, { ...state.document, events: [...state.document.events, ...(model.values.sharedFlags ?? []).map(flag => flag.event)] });
  }
  if (starts.length > maximumSceneStarts) throw new Error(`Use at most ${maximumSceneStarts} player starts in one scene.`);
  if (new Set(starts.map(point => `${point.x},${point.y}`)).size !== starts.length) throw new Error("Each player start must use a different tile.");
  const others = sceneModels(state.files).filter(other => other.prefix !== model.prefix && other.scene!.mapConstant === domain.mapConstant);
  const owner = state.old?.scene?.owner ?? Array.from({ length: 255 }, (_, i) => i + 1).find(id => !others.some(other => other.scene!.owner === id));
  if (!owner) throw new Error("No free scene identifier remains on this map.");
  const visibility = structuredClone(state.old?.scene?.visibility ?? []), staged = new Set(options.hiddenNpcs);
  let hasGift = false;
  let hasEffects = false, hasPartner = false;
  const usedMusic = new Set<string>(), battles = structuredClone(state.old?.scene?.effects?.battles ?? {});
  const visit = (actions: InteractionAction[]) => actions.forEach(action => {
    if (action.kind === "if-partner" || action.kind === "partner-move") hasPartner = true;
    if (action.kind === "visibility") staged.add(action.npc);
    else if (action.kind === "item" || action.kind === "pokemon" || action.kind === "transaction") hasGift = true;
    if (["music", "fade", "wild-battle", "trainer-battle"].includes(action.kind)) hasEffects = true;
    if (action.kind === "music" && action.mode === "play") usedMusic.add(action.track);
    if (isBattle(action) && !battles[action.battleId!]) battles[action.battleId!] = {
      won: allocate(`EVENT_${model.prefix.toUpperCase()}_${action.battleId!.toUpperCase()}_BATTLE_WON`),
      ...(action.kind === "wild-battle" ? { caught: allocate(`EVENT_${model.prefix.toUpperCase()}_${action.battleId!.toUpperCase()}_BATTLE_CAUGHT`) } : {}),
    };
    interactionBranches(action).forEach(([branch]) => visit(branch));
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
  for (const [i, point] of starts.entries()) {
    if (!walkable(point, options.trigger === "coordinate")) throw new InteractionValidationError({ message: `${starts.length > 1 ? `Player start ${i + 1}: ` : ""}Choose a walkable player start away from signs. Warp starts require a coordinate scene.`, tile: point });
    if (starts.length > 1 && state.objectRows.some((row, index) => !options.hiddenNpcs.includes(state.npcConstants[index]) && same(point, { x: +row[1], y: +row[2] }))) throw new InteractionValidationError({ message: `Player start ${i + 1} is occupied by a visible NPC.`, tile: point });
  }
  interface World { player: Point; actors: Record<string, Point>; visible: Record<string, boolean>; dark: boolean; partner?: Point | null }
  const showPoints = new Map<string, Point>();
  const partnerRoutes = new Map<string, PartnerRouteCell[]>();
  const partnerPlayers = new Map(starts.map(point => [`${point.x},${point.y}`, point]));
  const battleStaging = new Map<string, SceneActor[]>();
  const positionBranches = new Map<string, boolean>();
  const facings = new Map<string, string>();
  const reachableActions = new Set<string>();
  const routes = new Map<string, Array<{ from: Point; to: Point; step: string; playerFrom: Point; playerTo: Point; playerStep?: string }>>();
  function validate(actions: InteractionAction[], worlds: World[], path = "Action"): World[] {
    for (const [i, action] of actions.entries()) {
      const key = `${path}${i + 1}`;
      try {
      if (!worlds.length) return [];
      reachableActions.add(key);
      if (action.kind === "end") return [];
      if (worlds.some(world => world.dark) && ["dialogue", "choice", "emote", "wild-battle", "trainer-battle", "item", "pokemon", "transaction", "shop", "walk-npc", "follow-npc", "partner-move"].includes(action.kind)) throw new Error("Restore the screen before dialogue, movement, rewards or battles.");
      if (isBattle(action)) {
        battleStaging.set(key, domain.actors.map(actor => ({ ...actor, ...worlds[0].actors[actor.constant] })));
        worlds.forEach(world => { delete world.partner; });
      }
      const branches = interactionBranches(action);
      if (branches.length) {
        if (action.kind === "if-position") {
          if (action.test.mode === "tile" && (action.test.x >= map.width * 2 || action.test.y >= map.height * 2)) throw new Error("Choose a player position inside this map.");
          // Starts are dispatched separately and all scripted movement is checked.
          // Validate only the reachable arm so alternate routes can pass through
          // the tile occupied by the player on another starting side.
          const matched = matchesPlayerPosition(action.test, worlds[0].player, worlds[0].actors);
          if (worlds.some(world => matchesPlayerPosition(action.test, world.player, world.actors) !== matched)) throw new Error("Rejoin player positions before testing their location.");
          positionBranches.set(key, matched);
          worlds = validate(matched ? action.then : action.otherwise, worlds, `${key}${matched ? "Then" : "Otherwise"}`);
          continue;
        }
        worlds = branches.flatMap(([entries, suffix]) => validate(entries, structuredClone(worlds).map(world => action.kind === "if-partner" && suffix === "Absent" ? { ...world, partner: null } : world), `${key}${suffix}`));
        const common = (world: World) => { const { partner: _partner, ...rest } = world; return JSON.stringify(rest); };
        if (worlds.some(world => common(world) !== common(worlds[0]))) throw new Error("Rejoining branches must have the same player, actor positions, visibility and screen brightness. End differently staged branches separately.");
        worlds = [...new Map(worlds.map(world => [JSON.stringify(world), world])).values()];
      } else for (const world of worlds) {
        if (action.kind === "face-npc" || action.kind === "face-player") {
          const npc = action.npc ? world.actors[action.npc] : undefined;
          if ((action.kind === "face-npc" || action.facing === "NPC") && !world.visible[action.npc!]) throw new Error("Show the hidden NPC before turning toward it or turning it.");
          const facing = action.facing === "PLAYER" ? facingToward(npc!, world.player) : action.facing === "NPC" ? facingToward(world.player, npc!) : action.facing;
          if (facings.has(key) && facings.get(key) !== facing) throw new Error("Rejoin character positions before turning toward another character.");
          facings.set(key, facing);
          continue;
        }
        if (action.kind === "partner-move") {
          const target = { x: action.x, y: action.y };
          const occupied = (point: Point) => same(point, world.player) || state.objectRows.some((row, index) => {
            const name = state.npcConstants[index];
            return world.visible[name] !== false && same(world.actors[name] ?? { x: +row[1], y: +row[2] }, point);
          });
          const onScreen = (point: Point) => Math.abs(point.x - world.player.x) <= 4 && Math.abs(point.y - world.player.y) <= 3;
          if (!walkable(target) || !onScreen(target) || occupied(target)) throw new InteractionValidationError({ message: "Choose a clear, walkable partner destination on screen, away from warps, signs, the player and visible NPCs.", tile: target });
          // Reverse shortest-path field: the follower's actual start is read at
          // runtime. Like NPC steps, Pikachu can cross door tiles without warping.
          const queue = [{ ...target, distance: 0 }], seen = new Set([`${target.x},${target.y}`]), cells: PartnerRouteCell[] = [];
          for (let at = 0; at < queue.length; at++) {
            const to = queue[at]; if (to.distance >= 16) continue;
            for (const [step, d] of Object.entries(delta)) {
              const from = { x: to.x - d.x, y: to.y - d.y }, id = `${from.x},${from.y}`;
              if (seen.has(id) || !onScreen(from) || !walkable(from, true) || occupied(from)) continue;
              seen.add(id); cells.push({ ...from, toX: to.x, toY: to.y, step });
              queue.push({ ...from, distance: to.distance + 1 });
            }
          }
          partnerRoutes.set(key, cells);
          if (world.partner !== null) world.partner = target;
          continue;
        }
        if (action.kind === "fade") { world.dark = action.mode === "out"; continue; }
        if (action.kind === "visibility") {
          if (action.visible && (same(world.actors[action.npc], world.player) || world.partner && same(world.actors[action.npc], world.partner) || state.objectRows.some((row, index) => {
            const name = state.npcConstants[index];
            return name !== action.npc && world.visible[name] !== false && same(world.actors[name] ?? { x: +row[1], y: +row[2] }, world.actors[action.npc]);
          }))) throw new Error("Cannot show an NPC on an occupied tile.");
          if (action.visible) showPoints.set(key, { ...world.actors[action.npc] });
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
          if (action.kind === "follow-npc" && warps.some(warp => same(warp, to))) throw new InteractionValidationError({ message: `Following routes cannot enter a warp at (${to.x}, ${to.y}). Use Walk NPC for an NPC-only departure.`, tile: to });
          if (world.partner && same(to, world.partner)) throw new InteractionValidationError({ message: "The NPC route reaches the partner's destination. Move the partner to a different tile first.", tile: to });
          if (!walkable(to, action.kind === "walk-npc") || same(to, world.player) || state.objectRows.some((row, index) => {
            const name = state.npcConstants[index];
            return name !== action.npc && world.visible[name] !== false && same(world.actors[name] ?? { x: +row[1], y: +row[2] }, to);
          })) throw new InteractionValidationError({ message: `The NPC route is blocked at (${to.x}, ${to.y}).`, tile: to });
          if (Math.abs(to.x - world.player.x) > 4 || Math.abs(to.y - world.player.y) > 3) throw new Error("Keep walking NPCs on screen; use following for longer routes.");
          let playerStep: string | undefined;
          if (action.kind === "follow-npc") {
            playerStep = Object.entries(delta).find(([, d]) => world.player.x + d.x === from.x && world.player.y + d.y === from.y)?.[0];
            if (!playerStep || !walkable(from)) throw new Error("The player must start beside the leading NPC on a clear following route.");
            world.player = from;
            partnerPlayers.set(`${from.x},${from.y}`, from);
          }
          world.actors[action.npc] = to;
          route.push({ from, to, step, playerFrom, playerTo: { ...world.player }, playerStep });
        }
        routes.set(key, route);
      }
      } catch (error) { throw actionValidationError(error, key, "npc" in action ? action.npc : undefined); }
    }
    return worlds;
  }
  function buildPartnerReturns() { return hasPartner ? [...partnerPlayers.values()].map(player => {
    const steps = Array<number>(63).fill(0), queue = [{ ...player, distance: 0 }], seen = new Set([`${player.x},${player.y}`]);
    for (let at = 0; at < queue.length; at++) {
      const to = queue[at]; if (to.distance >= 16) continue;
      for (const [step, d] of Object.entries(delta)) {
        const from = { x: to.x - d.x, y: to.y - d.y }, id = `${from.x},${from.y}`;
        if (seen.has(id) || Math.abs(from.x - player.x) > 4 || Math.abs(from.y - player.y) > 3 || !walkable(from, true)) continue;
        seen.add(id); steps[(from.y - player.y + 3) * 9 + from.x - player.x + 4] = ({ DOWN: 1, UP: 2, LEFT: 3, RIGHT: 4 } as Record<string, number>)[step];
        queue.push({ ...from, distance: to.distance + 1 });
      }
    }
    return { ...player, steps };
  }) : undefined; }
  const nodes: Node[] = [{ kind: "start" }], shared = new Map<string, number>();
  // Compile each starting world separately, then share identical tails. The
  // first following step can differ by approach side; completion flags cannot.
  const add = (node: Node) => {
    const key = JSON.stringify(node), existing = starts.length > 1 ? shared.get(key) : undefined;
    if (existing !== undefined) return existing;
    nodes.push(node); shared.set(key, nodes.length - 1); return nodes.length - 1;
  };
  const success = add({ kind: "finish", complete: true }), failed = add({ kind: "finish", complete: false });
  function compile(actions: InteractionAction[], next: number, path = "Action"): number {
    for (let i = actions.length - 1; i >= 0; i--) {
      const action = actions[i], key = `${path}${i + 1}`;
      if (!reachableActions.has(key)) continue;
      if (action.kind === "end") { next = action.complete ? success : failed; continue; }
      if (action.kind === "if-position") {
        const matched = positionBranches.get(key);
        // Keep a live check: unexpected runtime displacement aborts rather than
        // using a route validated for a different side.
        const branch = compile(matched ? action.then : action.otherwise, next, `${key}${matched ? "Then" : "Otherwise"}`);
        next = add({ kind: "op", action, next: matched ? branch : failed, other: matched ? failed : branch });
      } else if (isBattle(action)) {
        const won = compile(action.won, next, `${key}Won`);
        const caught = action.kind === "wild-battle" ? compile(action.caught, next, `${key}Caught`) : undefined;
        const escaped = action.kind === "wild-battle" ? compile(action.escaped, next, `${key}Escaped`) : failed;
        const returned = add({ kind: "battle-return", action, next: won, other: escaped, caught, staging: battleStaging.get(key) });
        next = add({ kind: "battle-start", action, next: returned, other: won, caught });
      } else if (action.kind === "transaction") {
        next = add({ kind: "op", action, next: compile(action.success, next, `${key}Success`), other: compile(action.declined, next, `${key}Declined`), unpaid: compile(action.insufficient, next, `${key}Insufficient`), noRoom: compile(action.full, next, `${key}Full`) });
      } else if (action.kind === "choice" || action.kind === "if-event" || action.kind === "if-condition" || action.kind === "if-partner") {
        const branches = interactionBranches(action);
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
      } else next = add({ kind: "op", action, next, ...(action.kind === "face-npc" || action.kind === "face-player" ? { step: facings.get(key) } : {}), ...(action.kind === "partner-move" ? { partnerRoute: partnerRoutes.get(key) } : {}), ...(action.kind === "visibility" && action.visible && hasPartner ? { to: showPoints.get(key) } : {}), textKey: action.kind === "dialogue" ? action.textId ?? key : undefined });
    }
    return next;
  }
  const entries = starts.map((player, i) => {
    showPoints.clear(); partnerRoutes.clear(); battleStaging.clear(); routes.clear(); positionBranches.clear(); facings.clear(); reachableActions.clear();
    const world: World = { dark: false, player: { ...player }, actors: Object.fromEntries(domain.actors.map(actor => [actor.constant, { x: actor.x, y: actor.y }])), visible: Object.fromEntries(domain.actors.map(actor => [actor.constant, !options.hiddenNpcs.includes(actor.constant)])) };
    try { validate(model.values.actions!, [world]); }
    catch (error) {
      if (starts.length === 1) throw error;
      const detail = error instanceof InteractionValidationError ? error.detail : { message: String(error) };
      throw new InteractionValidationError({ ...detail, message: `From player start ${i + 1} (${player.x}, ${player.y}): ${detail.message}` });
    }
    const first = compile(model.values.actions!, success);
    return { ...player, next: model.values.showOriginal ? add({ kind: "original", next: first }) : first };
  });
  nodes[0].next = entries[0].next;
  if (nodes.length > 128) throw new Error("The scene exceeds the 128-state dispatcher. Shorten its routes or actions.");
  const textNodes = nodes.flatMap((node, i) => node.kind === "original" || node.kind === "op" && ["dialogue", "choice", "item", "pokemon", "transaction", "shop"].includes(node.action!.kind) ? [i] : []);
  return { owner, mapConstant: domain.mapConstant, stateVariable: domain.stateVariable, actors: domain.actors, frozen: state.objectRows.map((_, i) => i + 1), nodes, textNodes,
    textSlots: Math.max(textNodes.length, state.old?.scene?.textSlots ?? 0), visibility, follower: state.byPath.has("scripts/OaksLab_2.asm"),
    ...(starts.length > 1 ? { starts: entries } : {}),
    latchFlag: state.old?.scene?.latchFlag ?? (options.trigger === "coordinate" || options.automaticStarts ? allocate(`EVENT_${model.prefix.toUpperCase()}_SCENE_LATCH`) : null),
    ...(giftFlag ? { giftFlag } : {}), textHandoff: true, ...(hasPartner ? { partner: true as const, partnerReturns: buildPartnerReturns() } : {}),
    ...(hasEffects || state.old?.scene?.effects ? { effects: { music: state.document.effects.music.filter(track => usedMusic.has(track.id)), battles } } : {}) };
}
export function sceneRootHook(prefix: string) { return `\t; yellow-editor-scene-hook ${prefix}\n\tcall ${prefix}SceneFrame\n\tret c\n\t; yellow-editor-scene-hook-end ${prefix}\n`; }

export function renderScene(model: ManagedInteraction): string {
  const p = model.prefix, plan = model.scene!, v = model.values, options = v.scene!;
  const actorId = (npc: string) => plan.actors.find(actor => actor.constant === npc)!.id;
  const next = (id: number) => [`\tld a, ${id}`, "\tld [wEditorSceneState], a", "\tret"];
  const print = (suffix: string) => [`\tld hl, ${p}${suffix}`, "\tcall PrintText"];
  let conditionIndex = 0;
  const condition = (target: string) => v.condition ? renderConditionFailure(v.condition, target, `${p}Entry${conditionIndex++}`) : [];
  const location = (x: string, y: string, point: Point, target: string, offset = 0) => [`\tld a, [${x}]`, `\tcp ${point.x + offset}`, `\tjp nz, ${target}`, `\tld a, [${y}]`, `\tcp ${point.y + offset}`, `\tjp nz, ${target}`];
  const playerLocations = (fallback: string, label: string) => plan.starts ? [
    ...plan.starts.flatMap((point, i) => [...location("wXCoord", "wYCoord", point, `.${label}${i}`), `\tjp .${label}Matched`, `.${label}${i}`]),
    `\tjp ${fallback}`, `.${label}Matched`,
  ] : location("wXCoord", "wYCoord", { x: options.playerX, y: options.playerY }, fallback);
  const automaticLocations = (fallback: string) => options.automaticStarts ? [
    ...options.automaticStarts.flatMap((point, i) => [...location("wXCoord", "wYCoord", point, `.autoPosition${i}`), "\tjp .autoPositionMatched", `.autoPosition${i}`]), `\tjp ${fallback}`, ".autoPositionMatched",
  ] : playerLocations(fallback, "triggerPosition");
  const guards = (fallback: string) => [
    ...(plan.stateVariable ? [`\tld a, [${plan.stateVariable}]`, `\tcp ${options.idleState}`, `\tjp nz, ${fallback}`] : []),
    "\tld a, [wWalkCounter]", "\tand a", `\tjp nz, ${fallback}`, "\tld a, [wLinkState]", "\tand a", `\tjp nz, ${fallback}`,
    "\tld a, [wStatusFlags5]", "\tand (1 << BIT_SCRIPTED_NPC_MOVEMENT) | (1 << BIT_SCRIPTED_MOVEMENT_STATE)", `\tjp nz, ${fallback}`,
    "\tld a, [wNPCMovementScriptPointerTableNum]", "\tand a", `\tjp nz, ${fallback}`,
    ...playerLocations(fallback, "guardPosition"),
    ...plan.actors.filter(actor => plan.nodes.some(node => node.npc === actor.constant || node.action && "npc" in node.action && node.action.npc === actor.constant || node.action?.kind === "if-position" && node.action.test.mode === "relative" && node.action.test.npc === actor.constant)).flatMap(actor => location(sprite(actor.id, "StateData2MapX"), sprite(actor.id, "StateData2MapY"), actor, fallback, 4)),
  ];
  const lines = [`${model.label}:`, "\ttext_asm", `\t; yellow-editor-interaction: ${JSON.stringify(model)}`];
  if (options.trigger === "interaction" && plan.textHandoff) lines.push(...(v.once && model.flag ? [`\tCheckEvent ${model.flag}`, `\tjp nz, ${p}Already`] : []), `\tjp ${p}OriginalOnly`);
  else if (options.trigger === "interaction") lines.push(...(v.once && model.flag ? [`\tCheckEvent ${model.flag}`, `\tjp nz, ${p}Already`] : []), ...condition(`${p}OriginalOnly`),
    "\tld a, [wEditorSceneActive]", "\tand a", `\tjp nz, ${p}OriginalOnly`, ...guards(`${p}OriginalOnly`), ...(options.automaticStarts ? [`\tSetEvent ${plan.latchFlag}`] : []), `\tcall ${p}Launch`, "\tld a, 1", "\tld [wDoNotWaitForButtonPressAfterDisplayingText], a", "\tjp TextScriptEnd");
  else lines.push(`\tjp ${p}OriginalOnly`);
  lines.push(`${p}Already:`, ...print("AlreadyText"), "\tjp TextScriptEnd", `${p}OriginalOnly:`, ...print("Original"), "\tjp TextScriptEnd", "");
  if (options.trigger === "interaction" && plan.textHandoff) lines.push(`${p}TryLaunch::`, ...(v.once && model.flag ? [`\tCheckEvent ${model.flag}`, `\tjp nz, ${p}LaunchUnavailable`] : []), ...condition(`${p}LaunchUnavailable`), "\tld a, [wEditorSceneActive]", "\tand a", `\tjp nz, ${p}LaunchUnavailable`, ...guards(`${p}LaunchUnavailable`), ...(options.automaticStarts ? [`\tSetEvent ${plan.latchFlag}`] : []), `\tcall ${p}Launch`, "\tscf", "\tret", `${p}LaunchUnavailable:`, "\tand a", "\tret", "");
  lines.push(`${p}SceneFrame:`, "\tld a, [wEditorSceneActive]", "\tand a", "\tjp nz, .active");
  if (options.trigger === "coordinate" || options.automaticStarts) lines.push(...automaticLocations(`${p}ClearLatch`),
    `\tCheckEvent ${plan.latchFlag}`, "\tjp nz, .inactive", ...(v.once && model.flag ? [`\tCheckEvent ${model.flag}`, "\tjp nz, .inactive"] : []),
    ...condition(`${p}Inactive`), ...(options.automaticCondition ? renderConditionFailure(options.automaticCondition, `${p}Inactive`, `${p}Automatic`) : []), ...guards(`${p}Inactive`), `\tSetEvent ${plan.latchFlag}`, `\tcall ${p}Launch`);
  else lines.push("\tjp .inactive");
  lines.push(".active", "\tld a, [wEditorSceneMap]", `\tcp ${plan.mapConstant}`, "\tjp nz, .inactive", "\tld a, [wEditorSceneOwner]", `\tcp ${plan.owner}`, "\tjp nz, .inactive",
    ...(plan.effects ? ["\tld a, [wEditorSceneBattle]", "\tand a", "\tjr z, .dispatch", "\tld a, [wIsInBattle]", "\tcp LOST_BATTLE", `\tjp z, ${p}BattleLost`, "\tld a, [wEditorSceneBattle]", "\tcp 1", "\tjr nz, .dispatch", "\txor a", "\tld [wJoyIgnore], a", "\tscf", "\tret", ".dispatch"] : []),
    "\tld a, $ff", "\tld [wJoyIgnore], a", `\tld hl, ${p}ScenePointers`, "\tld a, [wEditorSceneState]", `\tcp ${plan.nodes.length}`, `\tjp nc, ${p}Abort`, "\tcall CallFunctionInTable", "\tscf", "\tret", ".inactive", "\tand a", "\tret", `${p}Inactive:`, "\tand a", "\tret", "");
  if (plan.latchFlag) lines.push(`${p}ClearLatch:`, `\tResetEvent ${plan.latchFlag}`, "\tand a", "\tret", "");
  if (plan.effects) lines.push(`${p}BattleLost:`, `\tcall ${p}Abort`, "\tscf", "\tret", "");
  lines.push(`${p}Launch:`, "\tld a, [wJoyIgnore]", "\tld [wEditorSceneJoyIgnore], a", "\tld a, [wOverrideSimulatedJoypadStatesMask]", "\tld [wEditorSceneOverride], a", "\tld a, [wStatusFlags4]", "\tld [wEditorSceneFlags4], a",
    ...(plan.effects ? ["\txor a", "\tld [wEditorSceneBattle], a", "\tld [wEditorScenePalette], a", "\tld [wEditorSceneMusic], a"] : []),
    ...plan.visibility.flatMap((entry, i) => [`\tCheckEvent ${entry.flag}`, "\tld a, 0", `\tjr z, .visibility${i}`, "\tinc a", `.visibility${i}`, `\tld [wEditorSceneVisibility + ${i}], a`]),
    ...plan.frozen.flatMap((id, i) => [`\tld a, [wMapSpriteData + ${(id - 1) * 2}]`, `\tld [wEditorSceneDirections + ${i}], a`, `\tld a, [${sprite(id, "StateData2MovementByte1")}]`, `\tld [wEditorSceneMovements + ${i}], a`, "\tld a, STAY", `\tld [${sprite(id, "StateData2MovementByte1")}], a`]),
    "\tld hl, wStatusFlags4", "\tset BIT_NO_BATTLES, [hl]", `\tld a, ${plan.mapConstant}`, "\tld [wEditorSceneMap], a", `\tld a, ${plan.owner}`, "\tld [wEditorSceneOwner], a", "\txor a", "\tld [wEditorSceneState], a", "\tld a, 1", "\tld [wEditorSceneActive], a", "\tld a, $ff", "\tld [wJoyIgnore], a", "\txor a", "\tldh [hJoyHeld], a", "\tret", "", `${p}ScenePointers:`, ...plan.nodes.map((_, i) => `\tdw ${p}State${i}`), "");
  const occupied = (point: Point, excluded: number, name: string) => [
    ...plan.frozen.filter(id => id !== excluded).flatMap(id => [
      `\tld a, [${sprite(id, "StateData1PictureID")}]`, "\tand a", `\tjr z, .${name}${id}`, `\tld a, ${id * 16}`, "\tldh [hCurrentSpriteOffset], a", "\tpush bc", "\tpredef IsObjectHidden", "\tpop bc", "\tldh a, [hIsToggleableObjectOff]", "\tand a", `\tjr nz, .${name}${id}`,
      `\tld a, [${sprite(id, "StateData2MapX")}]`, `\tcp ${point.x + 4}`, `\tjr nz, .${name}${id}`, `\tld a, [${sprite(id, "StateData2MapY")}]`, `\tcp ${point.y + 4}`, `\tjp z, ${p}Abort`, `.${name}${id}`,
    ]),
    ...(plan.follower ? [...(plan.partner ? [`\tcall ${p}PartnerVisible`, `\tjr nc, .${name}Pikachu`] : ["\tld a, [wSpritePikachuStateData1PictureID]", "\tand a", `\tjr z, .${name}Pikachu`]), "\tld a, [wSpritePikachuStateData2MapX]", `\tcp ${point.x + 4}`, `\tjr nz, .${name}Pikachu`, "\tld a, [wSpritePikachuStateData2MapY]", `\tcp ${point.y + 4}`, `\tjp z, ${p}Abort`, `.${name}Pikachu`] : []),
  ];
  plan.nodes.forEach((node, i) => {
    lines.push(`${p}State${i}:`);
    const effect = renderSceneEffect(node, model, next);
    if (effect) lines.push(...effect);
    else if (node.kind === "start") lines.push(...(plan.starts ? [
      ...plan.starts.flatMap((entry, index) => [...location("wXCoord", "wYCoord", entry, `.start${index}`), ...next(entry.next), `.start${index}`]), `\tjp ${p}Abort`,
    ] : next(node.next!)));
    else if (node.kind === "finish") lines.push(...(node.complete ? [...(v.once && model.flag ? [`\tSetEvent ${model.flag}`] : []),
      // Only normal completion retires the pending delivery. Aborts and map
      // reloads retain it; a repeatable scene can give again after completing.
      ...(plan.giftFlag ? [`\tResetEvent ${plan.giftFlag}`] : []),
      ...(plan.effects ? Object.values(plan.effects.battles).flatMap(flags => [flags.won, ...(flags.caught ? [flags.caught] : [])].map(flag => `\tResetEvent ${flag}`)) : []),
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
    else if (node.kind === "original" || node.action && ["dialogue", "choice", "item", "pokemon", "transaction", "shop"].includes(node.action.kind)) {
      lines.push("\txor a", "\tld [wJoyIgnore], a", `\tld a, TEXT_${p.toUpperCase()}_SCENE_${plan.textNodes.indexOf(i)}`, "\tldh [hTextID], a", "\tcall DisplayTextID", "\tld a, $ff", "\tld [wJoyIgnore], a", "\tret");
    } else if (node.action) {
      const a = node.action;
      if (a.kind === "if-position") lines.push(...renderPositionTest(a.test, a.test.mode === "relative" ? actorId(a.test.npc) : undefined, ".positionYes", ".positionNo"), ".positionYes", ...next(node.next!), ".positionNo", ...next(node.other!));
      else if (a.kind === "face-npc" || a.kind === "face-player") {
        const prefix = a.kind === "face-npc" ? `wSprite${String(actorId(a.npc)).padStart(2, "0")}` : "wSpritePlayer";
        if (a.kind === "face-npc") lines.push(`\tld a, ${node.step}`, `\tld [wMapSpriteData + ${(actorId(a.npc) - 1) * 2}], a`);
        else lines.push(`\tld a, PLAYER_DIR_${node.step}`, "\tld [wPlayerDirection], a", "\tld [wPlayerLastStopDirection], a", "\txor a", "\tld [wPlayerMovingDirection], a");
        lines.push(`\tld a, SPRITE_FACING_${node.step}`, `\tld [${prefix}StateData1FacingDirection], a`, `\tld [${prefix}StateData1ImageIndex], a`,
          ...(a.kind === "face-npc" ? [`\tld [${prefix}StateData2OrigFacingDirection], a`] : []),
          "\txor a", `\tld [${prefix}StateData1IntraAnimFrameCounter], a`, `\tld [${prefix}StateData1AnimFrameCounter], a`, "\tcall UpdateSprites", ...next(node.next!));
      }
      else if (a.kind === "partner-move") lines.push(...renderPartnerMove(node, i, p, next(node.next!)));
      else if (a.kind === "if-partner") lines.push(`\tcall ${p}PartnerPresent`, `\tld a, ${node.next}`, "\tjr c, .selected", `\tld a, ${node.other}`, ".selected", "\tld [wEditorSceneState], a", "\tret");
      else if (a.kind === "if-event") lines.push(`\tCheckEvent ${a.event}`, `\tld a, ${node.next}`, `\tjr ${a.set ? "nz" : "z"}, .selected`, `\tld a, ${node.other}`, ".selected", "\tld [wEditorSceneState], a", "\tret");
      else if (a.kind === "if-condition") lines.push(...renderPlayerCondition(a.condition, ".conditionYes", ".conditionNo", `${p}Node${i}`), ".conditionYes", ...next(node.next!), ".conditionNo", ...next(node.other!));
      else {
        if (a.kind === "visibility") { const entry = plan.visibility.find(entry => entry.npc === a.npc)!; if (a.visible && plan.partner) lines.push(...occupied(node.to!, entry.id, `show${i}`)); lines.push(`\t${a.visible === entry.hiddenInitially ? "SetEvent" : "ResetEvent"} ${entry.flag}`, "\tcall UpdateSprites"); }
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
    if (a?.kind === "shop") lines.push(`\tcall ${p}Service${id}`, `\tld a, ${node.next}`, "\tld [wEditorSceneState], a");
    else if (a?.kind === "transaction") lines.push(...(plan.giftFlag ? [`\tCheckEvent ${plan.giftFlag}`, "\tjp nz, .paid"] : []), `\tcall ${p}Service${id}`, "\tand a", "\tjr z, .success", "\tdec a", "\tjr z, .declined", "\tdec a", "\tjr z, .insufficient", `\tld a, ${node.noRoom}`, "\tjr .selected", ".declined", `\tld a, ${node.other}`, "\tjr .selected", ".insufficient", `\tld a, ${node.unpaid}`, "\tjr .selected", ".success", ...(plan.giftFlag ? [`\tSetEvent ${plan.giftFlag}`] : []), ".paid", `\tld a, ${node.next}`, ".selected", "\tld [wEditorSceneState], a");
    else if (a?.kind === "choice") lines.push(...choose(node));
    else if (a?.kind === "dialogue" && plan.nodes[node.next!].action?.kind === "choice") { lines.push(...choose(plan.nodes[node.next!])); }
    else if (a?.kind === "item" || a?.kind === "pokemon") {
      const claim = a.kind === "item" ? a.claim : undefined;
      lines.push(...(claim ? [
        `\tCheckEvent ${claim.group}`, "\tjr z, .unclaimed", `\tCheckEvent ${claim.option}`, "\tjp nz, .delivered",
        ...print("AlreadyText"), "\tld a, 2", "\tjp .selected", ".unclaimed",
      ] : plan.giftFlag ? [`\tCheckEvent ${plan.giftFlag}`, "\tjr nz, .delivered"] : []),
        `\tlb bc, ${a.kind === "item" ? `${a.item}, ${a.quantity}` : `${a.species}, ${a.level}`}`, `\tcall ${a.kind === "item" ? "GiveItem" : "GivePokemon"}`, "\tjr nc, .full",
        // A linked choice commits both flags before sound, prompts or movement.
        ...(claim ? [`\tSetEvent ${claim.group}`, `\tSetEvent ${claim.option}`] : []),
        ...(plan.giftFlag ? [`\tSetEvent ${plan.giftFlag}`] : []),
        ...(a.kind === "pokemon" ? ["\tld a, [wAddedToParty]", "\tand a", "\tcall z, WaitForTextScrollButtonPress", "\tcall EnableAutoTextBoxDrawing"] : ["\tld a, SFX_GET_ITEM_1", "\tcall PlaySound", "\tcall WaitForSoundToFinish"]),
        ...(plan.giftFlag || claim ? [".delivered"] : []), `\tld a, ${node.next}`, "\tjr .selected", ".full", ...print("BagFullText"), "\tld a, 2", ".selected", "\tld [wEditorSceneState], a");
    } else lines.push(`\tld a, ${node.next}`, "\tld [wEditorSceneState], a");
    lines.push("\tld a, 1", "\tld [wDoNotWaitForButtonPressAfterDisplayingText], a", "\tjp TextScriptEnd", "");
  });
  for (let i = plan.textNodes.length; i < plan.textSlots; i++) lines.push(`${p}SceneText${i}:`, "\ttext_asm", "\tjp TextScriptEnd", "");
  plan.nodes.forEach((node, i) => { if (node.action?.kind === "transaction") lines.push(...renderNpcTransaction(node.action, `${p}Service${i}`)); else if (node.action?.kind === "shop") lines.push(...renderNpcShop(node.action.items, `${p}Service${i}`)); });
  if (plan.effects) lines.push(...renderSceneEffectHelpers(model));
  lines.push(...partnerHelpers(plan, p));
  lines.push(`${p}AdvanceText:`, "\ttext_promptbutton", "\ttext_end", "", `${p}Abort:`,
    ...(plan.effects ? ["\tld a, [wEditorSceneMusic]", "\tcp 2", "\tjr nz, .restoreVisibility", "\tld a, 1", "\tld [wEditorSceneMusic], a", ".restoreVisibility"] : []),
    ...plan.visibility.flatMap((entry, i) => [`\tld a, [wEditorSceneVisibility + ${i}]`, "\tand a", `\tjr z, .restore${i}`, `\tSetEvent ${entry.flag}`, `\tjr .next${i}`, `.restore${i}`, `\tResetEvent ${entry.flag}`, `.next${i}`]),
    `${p}Cleanup:`, ...(plan.partner ? [`\tcall ${p}PartnerResume`] : []), ...plan.frozen.flatMap((id, i) => [`\tld a, [wEditorSceneDirections + ${i}]`, `\tld [wMapSpriteData + ${(id - 1) * 2}], a`, `\tld a, [wEditorSceneMovements + ${i}]`, `\tld [${sprite(id, "StateData2MovementByte1")}], a`]),
    ...(plan.effects ? [`\tcall ${p}FadeIn`, "\tld a, [wEditorSceneMusic]", "\tcp 1", `\tcall z, ${p}RestoreMusic`, "\txor a", "\tld [wEditorSceneMusic], a", "\tld [wEditorSceneBattle], a"] : []),
    "\tld a, [wEditorSceneJoyIgnore]", "\tld [wJoyIgnore], a", "\tld a, [wEditorSceneOverride]", "\tld [wOverrideSimulatedJoypadStatesMask], a", "\tld a, [wEditorSceneFlags4]", "\tand 1 << BIT_NO_BATTLES", "\tld b, a", "\tld a, [wStatusFlags4]", "\tand ~(1 << BIT_NO_BATTLES)", "\tor b", "\tld [wStatusFlags4], a", "\txor a", "\tld [wEditorSceneActive], a", "\tld [wSimulatedJoypadStatesIndex], a", "\tld [wSimulatedJoypadStatesEnd], a", "\tld [wUnusedOverrideSimulatedJoypadStatesIndex], a", "\tldh [hJoyHeld], a", "\tret", "");
  if (model.arrival) for (const idle of model.idleStates ?? [0]) for (const kind of ["Start", "Arrive", "Cleanup"]) lines.push(`${p}${idle ? `Resume${idle}` : ""}${kind}State:`, `\tld a, ${idle}`, `\tld [${plan.stateVariable}], a`, "\tret", "");
  return lines.join("\n") + `; yellow-editor-interaction-code-end ${model.label}\n\n`;
}

const entryHook = "\t; yellow-editor-scene-map-entry-hook\n\txor a\n\tld [wEditorSceneActive], a\n\t; yellow-editor-scene-map-entry-hook-end\n";
function sceneEntryHook(models: ManagedInteraction[], snapshot = true) {
  const latches = [...new Set(models.flatMap(model => model.scene?.latchFlag ? [model.scene.latchFlag] : []))].sort().map(flag => `\tResetEvent ${flag}\n`).join("");
  // EnterMap runs before JoypadOverworld's first map-script tick. Rearm each
  // coordinate latch here, including departure directly through its warp tile.
  const extended = models.some(model => model.scene?.effects);
  const restoreStaging = models.filter(model => model.scene!.nodes.some(node => node.kind === "battle-return")).sort((a, b) => a.prefix.localeCompare(b.prefix)).flatMap((model, i) => [
    "\tld a, [wEditorSceneMap]", `\tcp ${model.scene!.mapConstant}`, `\tjr nz, .editorBattleNext${i}`, "\tld a, [wEditorSceneOwner]", `\tcp ${model.scene!.owner}`, `\tjr nz, .editorBattleNext${i}`,
    `\tfarcall ${model.prefix}RestoreBattleStaging`, `.editorBattleNext${i}`,
  ]).join("\n");
  const partners = models.filter(model => model.scene?.partner).sort((a, b) => a.prefix.localeCompare(b.prefix));
  const releasePartner = partners.length ? [
    "\tld a, [wEditorSceneActive]", "\tbit 7, a", "\tjp z, .editorPartnerReleased",
    ...partners.flatMap((model, i) => ["\tld a, [wCurMap]", `\tcp ${model.scene!.mapConstant}`, `\tjr nz, .editorPartnerNext${i}`,
      "\tld a, [wEditorSceneMap]", `\tcp ${model.scene!.mapConstant}`, `\tjr nz, .editorPartnerNext${i}`,
      "\tld a, [wEditorSceneOwner]", `\tcp ${model.scene!.owner}`, `\tjr nz, .editorPartnerNext${i}`,
      `\tfarcall ${model.prefix}PartnerResume`, "\tjp .editorPartnerReleased", `.editorPartnerNext${i}`]),
    "\tcall EnablePikachuFollowingPlayer", "\tld hl, wEditorSceneActive", "\tres 7, [hl]", ".editorPartnerReleased", "",
  ].join("\n") : "";
  return entryHook.replace("\txor a", releasePartner + (extended ? (snapshot ? effectEntryHook : legacyEffectEntryHook).replace("\t; restore editor battle staging", restoreStaging).replace(/\tjr /g, "\tjp ") : "") + "\txor a").replace("\t; yellow-editor-scene-map-entry-hook-end", latches + (extended ? ".editorSceneEntryDone\n" : "") + "\t; yellow-editor-scene-map-entry-hook-end");
}
// Replace a reviewed 56-byte unused reservation, preserving its exact size and
// every existing WRAM/save address. Native movement/menu unions cannot hold this.
const scratch = "; yellow-editor-scene-scratch: 1\nwEditorSceneDirections:: ds 14\nwEditorSceneMovements:: ds 14\nwEditorSceneVisibility:: ds 14\nwEditorSceneJoyIgnore:: db\nwEditorSceneOverride:: db\nwEditorSceneFlags4:: db\nwEditorSceneMap:: db\nwEditorSceneOwner:: db\nwEditorSceneState:: db\nwEditorSceneActive:: db\n\tds 7\n; yellow-editor-scene-scratch-end\n";
const extendedScratch = scratch.replace("scratch: 1", "scratch: 2").replace("\tds 7\n", effectScratchFields);
function runtime(models: ManagedInteraction[], snapshot = true) {
  const entries = new Map<string, { map: string; entry: ScenePlan["visibility"][number] }>();
  models.forEach(model => model.scene!.visibility.forEach(entry => entries.set(`${model.scene!.mapConstant}:${entry.npc}`, { map: model.scene!.mapConstant, entry })));
  const battle = snapshot && models.some(model => model.scene!.nodes.some(node => node.kind === "battle-start"));
  return `; yellow-editor-scene-runtime: ${battle ? 2 : 1}\nEditorSceneObjectHidden:\n` + [...entries.values()].sort((a, b) => `${a.map}:${a.entry.npc}`.localeCompare(`${b.map}:${b.entry.npc}`)).map(({ map, entry }, i) => [
    "\tld a, [wCurMap]", `\tcp ${map}`, `\tjr nz, .next${i}`, "\tldh a, [hCurrentSpriteOffset]", `\tcp ${entry.id * 16}`, `\tjr nz, .next${i}`, `\tCheckEvent ${entry.flag}`, "\tld a, 0", `\tjr ${entry.hiddenInitially ? "nz" : "z"}, .result${i}`, "\tinc a", `.result${i}`, "\tldh [hIsToggleableObjectOff], a", "\tscf", "\tret", `.next${i}`,
  ].join("\n")).join("\n") + "\n\tand a\n\tret\n" + (battle ? battleSnapshotRuntime : "") + "; yellow-editor-scene-runtime-end\n";
}
function body(text: string, label: string) {
  const match = text.match(new RegExp(`^${label}:{1,2}\\n([\\s\\S]*?)(?=^[A-Za-z_]\\w*:{1,2}|$(?![\\s\\S]))`, "m"));
  if (!match) throw new Error(`Missing scene dependency ${label}.`);
  return match[1].split("\n").map(line => line.split(";", 1)[0].trim()).filter(Boolean).join("\n");
}
export async function prepareSceneRuntime(state: InteractionInspection, model: ManagedInteraction, changed: Map<string, string>) {
  await prepareSceneBankSpace(state, changed);
  if (model.values.sharedFlags?.length || itemClaims(model.values.actions ?? []).length) await prepareSharedSceneBankSpace(state, changed);
  const existing = sceneModels(state.files), all = [...existing.filter(other => other.prefix !== model.prefix), model];
  if (model.scene?.visibility.some(entry => strengthControlsVisibility(state.files, model.scene!.mapConstant, entry.id))) throw new Error("A Strength hole controls this boulder's visibility. Use a separate object for scene visibility actions.");
  await prepareSceneTextHandoff(state, existing, all, changed);
  const normalize = (text: string) => text.replace(/\r\n/g, "\n");
  const save = (path: string, text: string) => changed.set(path, text.replace(/\n/g, state.byPath.get(path)!.includes("\r\n") ? "\r\n" : "\n"));
  const visibilityPath = "engine/overworld/toggleable_objects.asm";
  let text = normalize(state.byPath.get(visibilityPath)!);
  const extended = all.some(model => model.scene?.effects);
  if (existing.length) {
    const old = [runtime(existing), runtime(existing, false)].find(previous => text.endsWith(previous));
    if (!old || !text.includes(visibilityHook)) throw new Error("The shared scene visibility runtime was changed in source.");
    text = text.slice(0, -old.length) + runtime(all);
  } else {
    if (await hashText(body(reviewStrengthVisibility(text, state.files).replace(conditionVisibilityHook, ""), "IsObjectHidden")) !== "f78a101337f2f157e91014ea8ad83876e16bc65120172c6cf098c16215ac7008") throw new Error("Scene visibility needs the reviewed native IsObjectHidden routine.");
    const anchor = "IsObjectHidden:\n" + (text.includes("IsObjectHidden:\n" + conditionVisibilityHook) ? conditionVisibilityHook : "");
    text = text.replace(anchor, anchor + visibilityHook) + "\n" + runtime(all);
  }
  save(visibilityPath, text);
  const overworldPath = "home/overworld.asm", overworld = normalize(state.byPath.get(overworldPath)!);
  const hasBattles = all.some(model => model.scene!.nodes.some(node => node.kind === "battle-start"));
  if (overworld.includes("yellow-editor-scene-battle-return-hook") && (overworld.split(sceneBattleReturnHook).length !== 2 || !overworld.includes("\n.battleOccurred\n" + sceneBattleReturnHook))) throw new Error("The shared battle-return hook was changed in source.");
  if (hasBattles && !overworld.includes(sceneBattleReturnHook)) {
    if (!overworld.includes("\n.battleOccurred\n")) throw new Error("The native battle return boundary is missing.");
    save(overworldPath, overworld.replace("\n.battleOccurred\n", "\n.battleOccurred\n" + sceneBattleReturnHook));
  } else if (!hasBattles && overworld.includes(sceneBattleReturnHook)) save(overworldPath, overworld.replace(sceneBattleReturnHook, ""));
  const ram = normalize(state.byPath.get("ram/wram.asm")!), clear = normalize(state.byPath.get("engine/overworld/clear_variables.asm")!);
  if (existing.length) {
    const previous = [sceneEntryHook(existing), sceneEntryHook(existing, false), ...(existing.some(model => model.scene?.effects) ? [] : [entryHook])].find(hook => clear.includes(hook));
    if (!ram.includes(scratch) && !ram.includes(extendedScratch) || !previous) throw new Error("The scene scratch or map-entry hook was changed in source.");
    if (extended && ram.includes(scratch)) save("ram/wram.asm", ram.replace(scratch, extendedScratch));
    save("engine/overworld/clear_variables.asm", clear.replace(previous, sceneEntryHook(all)));
  } else {
    const reservation = "wGameProgressFlagsEnd::\n\n\tds 56\n";
    if (ram.split(reservation).length !== 2 || /wEditorScene\w+/.test(ram)) throw new Error("Scene storage requires the reviewed unused 56-byte WRAM reservation.");
    if (await hashText(body(clear.replace(trainerEntryHook, ""), "ClearVariablesOnEnterMap")) !== "86ee2041b20584e3b9df2c0ee987347ebc8f201797e1b09e1349747b6d985296") throw new Error("Scene cleanup needs the reviewed map-entry routine.");
    save("ram/wram.asm", ram.replace(reservation, "wGameProgressFlagsEnd::\n\n" + (extended ? extendedScratch : scratch)));
    save("engine/overworld/clear_variables.asm", clear.replace("ClearVariablesOnEnterMap::\n", "ClearVariablesOnEnterMap::\n" + sceneEntryHook(all)));
  }
}
