export const moveStats = ["attack", "defense", "speed", "special", "accuracy", "evasion"] as const;
export type MoveStat = typeof moveStats[number];
export interface MoveStatChanges {
  target: "user" | "opponent";
  changes: Array<{ stat: MoveStat; stages: number }>;
}
export function isStatMoveEffect(effect: string) {
  return /^(ATTACK|DEFENSE|SPEED|SPECIAL|ACCURACY|EVASION)_(UP|DOWN)[12]_EFFECT$/.test(effect);
}
export function validateMoveStatChanges(value: MoveStatChanges | null | undefined) {
  if (value == null) return;
  if (!["user", "opponent"].includes(value.target) || !Array.isArray(value.changes) || !value.changes.length || value.changes.length > moveStats.length ||
    value.changes.some(row => !row || !moveStats.includes(row.stat) || ![-2, -1, 1, 2].includes(row.stages)) ||
    new Set(value.changes.map(row => row.stat)).size !== value.changes.length) {
    throw new Error("Choose a recipient and one to six different stats, changing each by 1 or 2 stages up or down.");
  }
}
// Six signed changes fit in the three unused bytes of the existing 16-byte row.
// Nibbles: 0 = unchanged, 1/2 = +1/+2, 3/4 = -1/-2.
export function moveStatChangeBytes(value: MoveStatChanges | null | undefined) {
  if (!value) return [0, 0, 0, 0];
  const codes = moveStats.map(stat => {
    const amount = value.changes.find(row => row.stat === stat)?.stages ?? 0;
    return amount < 0 ? 2 - amount : amount;
  });
  return [value.target === "user" ? 1 : 2, ...[0, 2, 4].map(i => codes[i] | codes[i + 1] << 4)];
}
