import { hashText } from "./history";
import { bcdBytes, renderPlayerCondition } from "./playerConditions";

export type NpcCost = { kind: "money" | "coins"; amount: number } | { kind: "item"; item: string; quantity: number };
export type NpcServiceReward = { kind: "none" | "heal" } | { kind: "item"; item: string; quantity: number } | { kind: "pokemon"; species: string; level: number };
export interface NpcTransaction { cost: NpcCost; reward: NpcServiceReward; confirm: boolean }
export interface NpcServicesDomain { transactionReason: string | null; shopReason: string | null }

const clean = (text: string) => text.split(/\r?\n/).map(line => line.split(";")[0].trim()).filter(Boolean).join("\n");
export async function inspectNpcServices(files: Map<string, string>): Promise<NpcServicesDomain> {
  async function reviewed(path: string, label: string, hashes: string[]) {
    const body = files.get(path)?.match(new RegExp(`^${label}:{1,2}\\r?\\n([\\s\\S]*?)(?=^[A-Za-z_]\\w*:{1,2}|$(?![\\s\\S]))`, "m"))?.[1];
    return body !== undefined && hashes.includes(await hashText(clean(body)));
  }
  const common = await reviewed("home/give.asm", "GiveItem", ["79bba382635f88c5c12ac756ac6fab332329f6da162d4e8ed656a76452a2938c"]);
  const removal = await reviewed("home/inventory.asm", "RemoveItemFromInventory", ["c99b59422aa658c6d836d19ff2b418b2db492ba6df04e7ee80496fda3ca453c7"])
    && await reviewed("engine/items/inventory.asm", "RemoveItemFromInventory_", ["16496ee2a591a118ce4a3fb4d88fdfbb960e5c39073f68348c09236dd54a9fd6", "7a6fd19c34331ecb9600c29d41916086302ab582ea1ff5bb64cc13c9902cbb57"]);
  const shop = await reviewed("home/text_script.asm", "LoadItemList", ["95b9c962c20f84b7b79219c8a3911bc666d02d11b60acc854cf85b7d42b2e617"])
    && await reviewed("engine/events/pokemart.asm", "DisplayPokemartDialogue_", ["3ca13658790c8ff7f8e0a97685c3d12cfb8a7848cef52c48548a4c7621eb8cdd"])
    && /wItemList:: ds 16/.test(files.get("ram/wram.asm") ?? "");
  return { transactionReason: common && removal ? null : "Payments and exchanges need the reviewed native inventory delivery/removal routines.", shopReason: common && shop ? null : "Shops need the reviewed native Poké Mart menu and stock-list routines." };
}

// Near-call helpers live with their owning map script. Result A: 0 success,
// 1 declined, 2 insufficient resources, 3 reward cannot be delivered.
export function renderNpcTransaction(service: NpcTransaction, prefix: string): string[] {
  // Item rewards may need the paid stack's slot. Other rewards can be delivered
  // before removing items, leaving the full native Pokémon-gift stack budget.
  const { cost, reward } = service, backup = reward.kind === "item";
  const lines = [`${prefix}:`, ...renderPlayerCondition(cost, ".eligible", ".insufficient", `${prefix}Cost`), ".eligible"];
  if (service.confirm) lines.push("\tld hl, .question", "\tcall PrintText", "\tcall YesNoChoice", "\tld a, [wCurrentMenuItem]", "\tand a", "\tjp nz, .declined");
  // The menu has no mutation paths, but test again before the commit begins.
  lines.push(...renderPlayerCondition(cost, ".commit", ".insufficient", `${prefix}Recheck`), ".commit");
  if (reward.kind === "pokemon") lines.push("\tld a, [wPartyCount]", "\tcp PARTY_LENGTH", "\tjr c, .space", "\tld a, [wBoxCount]", "\tcp MONS_PER_BOX", "\tjp nc, .fullEarly", ".space");
  if (backup) lines.push("\tadd sp, -(BAG_ITEM_CAPACITY * 2 + 2)", "\tld hl, sp + 0", "\tld de, wNumBagItems", "\tld b, BAG_ITEM_CAPACITY * 2 + 2", ".backup", "\tld a, [de]", "\tinc de", "\tld [hli], a", "\tdec b", "\tjr nz, .backup");
  if (cost.kind === "item" && reward.kind === "item") lines.push(`\tcall ${prefix}RemoveCost`);
  if (reward.kind === "item") lines.push(`\tlb bc, ${reward.item}, ${reward.quantity}`, "\tcall GiveItem", "\tjp nc, .rollback");
  if (reward.kind === "pokemon") lines.push(`\tlb bc, ${reward.species}, ${reward.level}`, "\tcall GivePokemon", `\tjp nc, ${backup ? ".rollback" : ".fullEarly"}`, "\tld a, [wAddedToParty]", "\tand a", "\tcall z, WaitForTextScrollButtonPress", "\tcall EnableAutoTextBoxDrawing");
  if (reward.kind === "heal") lines.push("\tpredef HealParty");
  if (cost.kind === "item" && reward.kind !== "item") lines.push(`\tcall ${prefix}RemoveCost`);
  if (cost.kind === "money" || cost.kind === "coins") {
    // Subtract packed BCD only after delivery succeeds. No scratch money/menu
    // fields need to survive native text or gift routines.
    lines.push("\tand a");
    [...bcdBytes(cost.amount, cost.kind === "money" ? 3 : 2)].reverse().forEach((byte, i) => {
      const at = (cost.kind === "money" ? 2 : 1) - i, address = `${cost.kind === "money" ? "wPlayerMoney" : "wPlayerCoins"} + ${at}`;
      lines.push(`\tld a, [${address}]`, `\tsbc ${byte}`, "\tdaa", `\tld [${address}], a`);
    });
  }
  if (backup) lines.push("\tadd sp, BAG_ITEM_CAPACITY * 2 + 2");
  lines.push("\txor a", "\tret");
  if (backup) lines.push(".rollback", "\tld hl, sp + 0", "\tld de, wNumBagItems", "\tld b, BAG_ITEM_CAPACITY * 2 + 2", ".restore", "\tld a, [hli]", "\tld [de], a", "\tinc de", "\tdec b", "\tjr nz, .restore", "\tadd sp, BAG_ITEM_CAPACITY * 2 + 2");
  lines.push(".fullEarly", "\tld a, 3", "\tret", ".declined", "\tld a, 1", "\tret", ".insufficient", "\tld a, 2", "\tret");
  if (service.confirm) {
    const question = cost.kind === "item" ? [`Trade ${cost.quantity} item${cost.quantity === 1 ? "" : "s"}?`, cost.item.replace(/_/g, " ") + "?"] : [`Pay ${cost.amount}`, cost.kind === "money" ? "in money?" : "in coins?"];
    lines.push(".question", ...question.map((text, i) => `\t${i ? "line" : "text"} "${text}"`), "\tdone");
  }
  if (cost.kind === "item") lines.push(`${prefix}RemoveCost:`, `\tld c, ${cost.quantity}`, ".again", "\tld hl, wBagItems", "\tld b, 0", ".find", "\tld a, [hli]", `\tcp ${cost.item}`, "\tjr z, .found", "\tinc hl", "\tinc b", "\tjr .find", ".found", "\tld a, b", "\tld [wWhichPokemon], a", "\tld a, [hl]", "\tcp c", "\tjr nc, .last", "\tld b, a", "\tld a, c", "\tsub b", "\tld c, a", "\tld a, b", "\tld [wItemQuantity], a", "\tpush bc", "\tld hl, wNumBagItems", "\tcall RemoveItemFromInventory", "\tpop bc", "\tjr .again", ".last", "\tld a, c", "\tld [wItemQuantity], a", "\tld hl, wNumBagItems", "\tjp RemoveItemFromInventory");
  return [...lines, ""];
}
export function renderNpcShop(items: string[], prefix: string): string[] {
  return [`${prefix}:`, "\tld hl, .stock", "\tcall LoadItemList", "\tld a, PRICEDITEMLISTMENU", "\tld [wListMenuID], a", "\tfarcall DisplayPokemartDialogue_", "\tcall WaitForTextScrollButtonPress", "\tret", ".stock", `\tdb ${items.length}`, `\tdb ${items.join(", ")}`, "\tdb -1", ""];
}
