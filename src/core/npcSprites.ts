import { hashText } from "./history";

export function npcSpriteCatalog(text: string, constants: Map<string, number>, spriteConstants: string, sourceDriven = false) {
  if (sourceDriven) {
    const names = [...spriteConstants.matchAll(/^\s*const(?:_export)?\s+(SPRITE_\w+)/gm)].map(m => m[1]);
    const entries = [...text.matchAll(/^\s*overworld_sprite\s+\w+,\s*(4|12)\b/gm)].flatMap((m, i) => {
      const id = names.find(name => constants.get(name) === i + 1);
      return id ? [{ id, canWalk: m[1] === "12" }] : [];
    });
    const boundary = Math.min(...entries.filter(e => !e.canWalk).map(e => constants.get(e.id)!));
    if (!entries.length || !Number.isFinite(boundary)) throw new Error("The imported sprite table could not be resolved.");
    return { entries, boundary };
  }
  const first = spriteConstants.match(/DEF FIRST_STILL_SPRITE EQU const_value\s+const (SPRITE_\w+)/)?.[1];
  const boundary = first ? constants.get(first) : undefined;
  if (boundary === undefined) throw new Error("Cannot identify stationary sprite graphics.");
  const entries = [...text.matchAll(/^\s*overworld_sprite\s+\w+,\s*(4|12)\s*;\s*(SPRITE_\w+)\s*$/gm)]
    .filter(match => constants.has(match[2]) && !match[2].includes("UNUSED"))
    .map(match => ({ id: match[2], canWalk: match[1] === "12" }));
  if (!entries.length || entries.some(entry => entry.canWalk !== (constants.get(entry.id)! < boundary))) throw new Error("Sprite graphics do not match the native animated/stationary sprite ranges.");
  return { entries, boundary };
}

export async function indoorSpriteBudget(engine: string, yellow: boolean) {
  // These engines allocate independent pools: Red's slots 2..10 and 11..12;
  // Yellow's nine regular slots (including Pikachu) and two four-tile slots.
  const code = engine.split(/\r?\n/).map(line => line.split(";", 1)[0].trim()).filter(Boolean).join("\n");
  const expected = yellow ? "92312a3682df5fce309c8b242f1093888d88667c904b56423cc652616a318db8" : "92a543bf6b7704bfc1012d75bde9e68605c201b9bdca372e581b99f2c50b4f95";
  if (await hashText(code) !== expected) throw new Error("NPC graphics slots require the reviewed indoor sprite loader.");
  return { animated: 9, stationary: 2 };
}

export function validateNpcSpriteMovement(stationary: string[], sprite: string, movement: string, direction: string) {
  if (stationary.includes(sprite) && (movement !== "STAY" || direction !== "DOWN")) throw new Error("This stationary sprite has one pose. Choose Stay in place facing down; it cannot wander or walk in a scene.");
}
