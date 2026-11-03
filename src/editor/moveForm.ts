import { defaultMoveBehavior, type MoveBehaviorValues } from "../core/moveBehaviors";
import { validateMoveEditValues, type MoveEditDocument, type MoveEditValues } from "../core/moveEditing";
export interface MoveDraft { name: string; power: string; accuracy: string; pp: string; moveType: string; effect: string; highCritical: boolean; behavior: MoveBehaviorValues }
export function moveDraftFromDocument(doc: MoveEditDocument): MoveDraft { const v = doc.values; return { ...v, behavior: v.behavior ?? defaultMoveBehavior(doc.constant), highCritical: v.highCritical ?? false, power: String(v.power), accuracy: String(v.accuracy), pp: String(v.pp) }; }
export function moveDraftIsDirty(draft: MoveDraft | null, doc: MoveEditDocument | null) { if (!draft || !doc) return false; const original = moveDraftFromDocument(doc); return (Object.keys(original) as Array<keyof MoveDraft>).some(key => key === "behavior" ? (Object.keys(original.behavior) as Array<keyof MoveBehaviorValues>).some(property => !Object.is(draft.behavior[property], original.behavior[property])) : draft[key] !== original[key]); }
export function moveDraftError(draft: MoveDraft | null, doc: MoveEditDocument | null): string | null {
  if (!draft || !doc) return "Move data is unavailable.";
  try { validateMoveEditValues({ ...draft, power: /^\d+$/.test(draft.power) ? Number(draft.power) : NaN, accuracy: /^\d+$/.test(draft.accuracy) ? Number(draft.accuracy) : NaN, pp: /^\d+$/.test(draft.pp) ? Number(draft.pp) : NaN }, doc); return null; }
  catch (error) { return error instanceof Error ? error.message : String(error); }
}
export function parseMoveDraft(draft: MoveDraft | null, doc: MoveEditDocument | null): MoveEditValues | null { return draft && !moveDraftError(draft, doc) ? { ...draft, power: Number(draft.power), accuracy: Number(draft.accuracy), pp: Number(draft.pp) } : null; }
