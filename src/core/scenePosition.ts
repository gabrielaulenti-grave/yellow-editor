import type { FacingDirection, PlayerPositionTest } from "./interactionSequence";

type Point = { x: number; y: number };
export function matchesPlayerPosition(test: PlayerPositionTest, player: Point, actors: Record<string, Point>): boolean {
  if (test.mode === "tile") return player.x === test.x && player.y === test.y;
  const npc = actors[test.npc];
  return test.side === "LEFT" ? player.x < npc.x : test.side === "RIGHT" ? player.x > npc.x : test.side === "UP" ? player.y < npc.y : player.y > npc.y;
}

// Diagonal targets use the horizontal axis first so facing stays predictable.
export function facingToward(from: Point, to: Point): FacingDirection {
  if (from.x !== to.x) return from.x < to.x ? "RIGHT" : "LEFT";
  if (from.y !== to.y) return from.y < to.y ? "DOWN" : "UP";
  throw new Error("Characters must occupy different tiles to face one another.");
}

export function renderPositionTest(test: PlayerPositionTest, npcId: number | undefined, yes: string, no: string): string[] {
  if (test.mode === "tile") return ["\tld a, [wXCoord]", `\tcp ${test.x}`, `\tjp nz, ${no}`, "\tld a, [wYCoord]", `\tcp ${test.y}`, `\tjp z, ${yes}`, `\tjp ${no}`];
  const horizontal = test.side === "LEFT" || test.side === "RIGHT", axis = horizontal ? "X" : "Y";
  const lower = test.side === "LEFT" || test.side === "UP";
  return [`\tld a, [wSprite${String(npcId).padStart(2, "0")}StateData2Map${axis}]`, "\tsub 4", "\tld b, a", `\tld a, [w${axis}Coord]`, "\tcp b",
    ...(lower ? [`\tjp c, ${yes}`] : [`\tjp z, ${no}`, `\tjp nc, ${yes}`]), `\tjp ${no}`];
}
