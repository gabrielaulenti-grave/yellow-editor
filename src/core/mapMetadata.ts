import type { ProjectSource } from "./types";

const MAP_CONSTANTS_PATH = "constants/map_constants.asm";

export function mapConstantDisplayName(constant: string): string {
  return constant
    .toLowerCase()
    .split("_")
    .map((part) => {
      if (/^\d+f$/.test(part) || /^b\d+f$/.test(part)) {
        return part.toUpperCase();
      }
      if (part === "ss") {
        return "S.S.";
      }
      if (part === "pokemon") {
        return "Pokémon";
      }
      return part ? part[0].toUpperCase() + part.slice(1) : part;
    })
    .join(" ")
    .replace(/Route (\d+)/, "Route $1");
}

export async function loadMapConstants(source: ProjectSource): Promise<string[]> {
  if (!(await source.exists(MAP_CONSTANTS_PATH))) {
    return [];
  }
  const contents = await source.readText(MAP_CONSTANTS_PATH);
  return [...contents.matchAll(/^\s*map_const\s+([A-Z][A-Z0-9_]*)\s*,/gm)]
    .map((match) => match[1]);
}

export function affectedWildLocations(
  indexContents: string,
  mapConstants: string[],
): Map<string, string[]> {
  const pointerBlock = indexContents.split(/^\s*INCLUDE\s+/m)[0];
  const labels = [...pointerBlock.matchAll(/^\s*dw\s+([A-Za-z_][A-Za-z0-9_]*WildMons)\b/gm)]
    .map((match) => match[1]);
  const result = new Map<string, string[]>();

  labels.forEach((label, index) => {
    const mapConstant = mapConstants[index];
    if (!mapConstant || label === "NothingWildMons") {
      return;
    }
    const locations = result.get(label) ?? [];
    locations.push(mapConstantDisplayName(mapConstant));
    result.set(label, locations);
  });
  return result;
}
