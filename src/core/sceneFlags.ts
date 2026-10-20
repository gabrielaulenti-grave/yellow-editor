import { interactionBranches, type InteractionAction } from "./interactionSequence";

export interface SharedSceneFlag { event: string; label: string }
export function sharedSceneFlag(label: string): SharedSceneFlag {
  if (typeof label !== "string" || !/^[A-Za-z0-9][A-Za-z0-9 _-]{0,47}$/.test(label.trim())) throw new Error("Use a flag name of 1–48 letters, numbers, spaces, hyphens or underscores.");
  label = label.trim();
  return { event: `EVENT_EDITOR_SHARED_${label.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`, label };
}
export function readSharedSceneFlags(text: string, symbols: Map<string, number>): SharedSceneFlag[] {
  const flags = [...text.matchAll(/^; yellow-editor-shared-flag: (.+)$/gm)].map(match => JSON.parse(match[1]) as SharedSceneFlag & { bit: number });
  const seen = new Set<string>();
  const bits = new Set<number>();
  for (const flag of flags) {
    if (sharedSceneFlag(flag.label).event !== flag.event || seen.has(flag.event) || bits.has(flag.bit) || !Number.isInteger(flag.bit) || flag.bit < 0 || flag.bit >= (symbols.get("NUM_EVENTS") ?? 0) || symbols.get(flag.event) !== flag.bit
      || [...symbols].some(([event, bit]) => event.startsWith("EVENT_") && event !== flag.event && bit === flag.bit)) throw new Error("A shared scene flag definition was changed or duplicated in source.");
    seen.add(flag.event);
    bits.add(flag.bit);
  }
  return flags.map(({ event, label }) => ({ event, label }));
}
export function mergeSharedSceneFlags(existing: SharedSceneFlag[], requested: SharedSceneFlag[], symbols?: Map<string, number>): SharedSceneFlag[] {
  if (!Array.isArray(requested) || requested.length > 64) throw new Error("Use at most 64 shared flag declarations per interaction.");
  const result = [...existing];
  for (const flag of requested) {
    if (!flag || sharedSceneFlag(flag.label).event !== flag.event) throw new Error("Choose a valid shared scene flag name.");
    const old = result.find(entry => entry.event === flag.event);
    if (old && old.label !== flag.label || !old && symbols?.has(flag.event)) throw new Error("That shared flag name is already defined differently in the project.");
    if (!old) result.push(flag);
  }
  return result;
}
export function itemClaims(actions: InteractionAction[]): Array<{ group: string; option: string; item: string; quantity: number }> {
  return actions.flatMap(action => [
    ...(action.kind === "item" && action.claim ? [{ ...action.claim, item: action.item, quantity: action.quantity }] : []),
    ...interactionBranches(action).flatMap(([branch]) => itemClaims(branch)),
  ]);
}
export function validateItemClaims(actions: InteractionAction[], otherActions: InteractionAction[][]) {
  const claims = [...otherActions.flatMap(itemClaims), ...itemClaims(actions)];
  for (const claim of claims) {
    if (claims.some(other => other.option === claim.option && (other.group !== claim.group || other.item !== claim.item || other.quantity !== claim.quantity)
      || other.group === claim.option)) throw new Error("Each chosen-option flag must belong to one reward group and identify the same item and quantity. Use a different flag for each option.");
  }
}
