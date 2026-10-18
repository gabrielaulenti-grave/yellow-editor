import { hashText } from "./history";
import { interactionBranches, type InteractionAction } from "./interactionSequence";
import type { TextWriteRequest } from "./types";

export const itemInventoryPath = "engine/items/inventory.asm";
const clean = (line: string) => line.split(";", 1)[0].trim();
function additionBody(text: string) {
  const lines = text.split(/\r?\n/), start = lines.findIndex(line => clean(line) === "AddItemToInventory_::");
  if (start < 0) return "";
  const end = lines.findIndex((line, i) => i > start && /^[A-Za-z_]\w*:{1,2}/.test(clean(line)));
  return lines.slice(start, end < 0 ? undefined : end).map(clean).filter(Boolean).join("\n");
}
export function hasItemReward(actions: InteractionAction[]): boolean {
  return actions.some(action => action.kind === "item" || interactionBranches(action).some(([branch]) => hasItemReward(branch)));
}

// Red jumps directly into the item loop after filling an existing stack. If
// that stack is last, it interprets the $ff terminator and later save/map bytes
// as more item slots. Backport Yellow's zero-byte label/jump-target correction.
export async function prepareItemDeliveryWrites(files: Map<string, string>): Promise<TextWriteRequest[]> {
  const original = files.get(itemInventoryPath);
  const fingerprint = await hashText(additionBody(original ?? ""));
  if (fingerprint === "b0ae7f7f89ef32ca1ac418e3cfd1286b0557352e970635a1fb5491497556f350") return [];
  if (!original || fingerprint !== "05b705fe4fec9203a619af04eee2493751a62c31c5cd3332263dc003fc6c7c2d") throw new Error("Item gifts require the reviewed inventory stack routine in engine/items/inventory.asm. This project's routine differs; review its end-of-inventory handling before saving a gift.");
  const lines = original.split(/\r?\n/), start = lines.findIndex(line => clean(line) === "AddItemToInventory_::");
  const end = lines.findIndex((line, i) => i > start && /^[A-Za-z_]\w*:{1,2}/.test(clean(line)));
  const terminator = lines.findIndex((line, i) => i > start && i < end && clean(line) === "ld a, [hl]" && clean(lines[i - 1]) === "inc hl" && clean(lines[i + 1]) === "cp $ff");
  const jump = lines.findIndex((line, i) => i > start && i < end && clean(line) === "jp .notAtEndOfInventory");
  if (terminator < 0 || jump < 0) throw new Error("Cannot locate the reviewed inventory stack boundary.");
  lines[jump] = lines[jump].replace(".notAtEndOfInventory", ".addAnotherStackOfItem");
  lines.splice(terminator, 0, "; yellow-editor: Check the terminator before scanning another item stack.", ".addAnotherStackOfItem");
  const contents = lines.join(original.includes("\r\n") ? "\r\n" : "\n");
  if (await hashText(additionBody(contents)) !== "b0ae7f7f89ef32ca1ac418e3cfd1286b0557352e970635a1fb5491497556f350") throw new Error("The corrected inventory routine did not match the reviewed Yellow behavior.");
  return [{ path: itemInventoryPath, contents, expectedHash: await hashText(original) }];
}
