import { rows } from "./creationSupport";
export const moveOptionPaths = ["constants/type_constants.asm", "constants/move_effect_constants.asm", "data/moves/effects_pointers.asm"];
/** Declared engine options remain available even after their last move is edited. */
export function moveOptions(text: Map<string, string>, symbols: Map<string, number>) {
  const declarations = (path: string) => [...text.get(path)!.matchAll(/^[ \t]*const[ \t]+([A-Za-z_]\w*)\b/gm)].map(m => m[1]);
  const pointers = rows(text.get(moveOptionPaths[2])!, "MoveEffectPointerTable", "dw");
  if (pointers.length !== symbols.get("NUM_MOVE_EFFECTS")) throw new Error("The battle behavior constants and pointer table must be synchronized.");
  return {
    types: declarations(moveOptionPaths[0]).filter(name => { const n = symbols.get(name); return n !== undefined && n >= 0 && n < (symbols.get("NUM_TYPES") ?? 256); }),
    effects: declarations(moveOptionPaths[1]).filter(name => { const n = symbols.get(name); return n !== undefined && n >= 0 && n <= pointers.length && !/^EFFECT_[0-9A-F]+$/.test(name); }),
  };
}
