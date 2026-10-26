import { loadMapVisualization } from "./mapVisualization";
import type { MapVisualization, ProjectSource } from "./types";
export interface MapCheck { code: string; message: string; x?: number; y?: number }
export interface MapCheckReport { mapConstant: string; issues: MapCheck[]; checkedWarps: number }
const code = (s: string) => s.split(";")[0].trim();
function tile(v: MapVisualization, x: number, y: number) {
  const block = v.mapBlocks[Math.floor(y / 2) * v.map.width + Math.floor(x / 2)];
  return v.blockset[block * 16 + (y % 2 * 2 + 1) * 4 + x % 2 * 2];
}
function numbers(s: string) { return s.split(",").map(x => x.trim()).map(x => /^\$[\da-f]+$/i.test(x) ? parseInt(x.slice(1), 16) : /^-?\d+$/.test(x) ? Number(x) : NaN); }
function warpTiles(text: string, name: string) {
  const at = text.indexOf(`.${name}WarpTileIDs:`); if (at < 0) return null;
  const result = new Set<number>();
  for (const row of text.slice(at).split(/\r?\n/).slice(1)) {
    const line = code(row); if (!line || /^[.\w]+:$/.test(line)) continue;
    const m = line.match(/^(warp_tiles|db)(?:\s+(.+))?$/); if (!m) return null;
    for (const n of numbers(m[2] ?? "")) { if (n === -1) return result; if (!Number.isFinite(n)) { if (m[1] === "warp_tiles" && !m[2]) return result; return null; } result.add(n); }
    if (m[1] === "warp_tiles") return result;
  }
  return null;
}
export async function checkMap(source: ProjectSource, mapConstant: string): Promise<MapCheckReport> {
  const v = await loadMapVisualization(source, mapConstant), issues: MapCheck[] = [];
  const allowed = warpTiles(await source.readText("data/tilesets/warp_tile_ids.asm"), v.tilesetName), destinations = new Map<string, MapVisualization>();
  const outsideCount = ((await source.readText("constants/map_constants.asm")).split("DEF FIRST_INDOOR_MAP EQU const_value")[0].match(/^\s*map_const\s+/gm) ?? []).length;
  if (!allowed && v.warps.length) issues.push({ code: "warp-terrain-unknown", message: "The tileset's ordinary warp tile list could not be resolved. Review warp activation in its custom source." });
  const loaded = async (map: string) => { let next = destinations.get(map); if (!next) { next = await loadMapVisualization(source, map); destinations.set(map, next); } return next; };
  const occupied = new Map<string, string>();
  for (const [kind, points] of [["warp", v.warps], ["sign", v.signs], ["object", v.npcs]] as const) for (const p of points) {
    const key = `${p.x},${p.y}`;
    if (p.x < 0 || p.y < 0 || p.x >= v.map.width * 2 || p.y >= v.map.height * 2) issues.push({ code: "bounds", x: p.x, y: p.y, message: `${kind} ${p.id} lies outside the map.` });
    if (occupied.has(key)) issues.push({ code: "overlap", x: p.x, y: p.y, message: `${kind} ${p.id} overlaps another ${occupied.get(key)} at ${key}.` });
    occupied.set(key, kind);
  }
  for (const warp of v.warps) {
    if (allowed && !allowed.has(tile(v, warp.x, warp.y))) issues.push({ code: "warp-terrain", x: warp.x, y: warp.y, message: `Warp ${warp.id} is not on an ordinary warp tile. Paint a suitable door, stair or CAVERN hole tile, or verify its custom activation script.` });
    if (warp.isLastMap) continue;
    if (!warp.destinationMapConstant) { issues.push({ code: "destination", message: `Warp ${warp.id} has an unresolved destination.` }); continue; }
    try {
      const dest = await loaded(warp.destinationMapConstant), arrival = dest.warps.find(w => w.id === warp.destinationWarpId);
      if (!arrival) issues.push({ code: "arrival", message: `Warp ${warp.id} refers to missing warp ${warp.destinationWarpId} in ${dest.map.displayName}.` });
      if (!dest.warps.some(w => w.isLastMap && v.map.id < outsideCount || w.destinationMapConstant === mapConstant) && !dest.connections.some(c => c.destinationMapConstant === mapConstant)) issues.push({ code: "return-route", message: `No direct return warp or connection from ${dest.map.displayName} was found. Verify that this one-way route is intentional.` });
    } catch (e) { issues.push({ code: "destination", message: `Could not inspect warp ${warp.id}'s destination: ${String(e)}` }); }
  }
  const collision = await source.readText("data/tilesets/collision_tile_ids.asm"), label = `${v.tilesetName}_Coll::`, at = collision.indexOf(label);
  const passable = at < 0 ? null : collision.slice(at + label.length).match(/coll_tiles\s+([^\r\n;]+)/)?.[1];
  const floor = passable ? numbers(passable) : null;
  if (floor && floor.every(Number.isFinite)) for (const b of v.npcs.filter(n => n.spriteConstant === "SPRITE_BOULDER")) {
    if (!floor.includes(tile(v, b.x, b.y))) issues.push({ code: "boulder-terrain", x: b.x, y: b.y, message: `Boulder ${b.id} starts on non-walkable terrain. Verify that it is an intentional fixed or hidden obstacle.` });
  }
  return { mapConstant, issues, checkedWarps: v.warps.length };
}
