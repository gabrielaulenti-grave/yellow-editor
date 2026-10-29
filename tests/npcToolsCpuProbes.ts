import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { renderPlayerCondition, type PlayerCondition } from "../src/core/playerConditions";
import { renderNpcTransaction, renderNpcShop, type NpcTransaction } from "../src/core/npcServices";
import { renderScene } from "../src/core/interactionScene";
import type { ManagedInteraction } from "../src/core/scriptInteractions";
import { projectConstantCatalogFromSources } from "../src/core/projectConstants";

export async function npcToolsCpuProbes(root: string, temp: string, rgbds: string, cpu: string, run: (cmd: string, args: string[], cwd?: string) => string, overlay: Map<string, string>, receipt: ManagedInteraction) {
  const defs = { wNumBagItems: 0xc200, wBagItems: 0xc201, wNumBoxItems: 0xc800, wPlayerMoney: 0xc240, wPlayerCoins: 0xc244, wNumHoFTeams: 0xc246, wPartyCount: 0xc247, wPartySpecies: 0xc248, wObtainedBadges: 0xc24f, wWalkBikeSurfState: 0xc250, wPartyMon1: 0xc300, wPokedexOwned: 0xc480, wPokedexSeen: 0xc4a0, wBoxCount: 0xc4c0, wAddedToParty: 0xc4c1, wWhichPokemon: 0xc500, wItemQuantity: 0xc501, wMaxItemQuantity: 0xc502, wListScrollOffset: 0xc503, wCurrentMenuItem: 0xc504, wBagSavedMenuItem: 0xc505, wSavedListScrollOffset: 0xc506, wListCount: 0xc507, wMaxMenuItem: 0xc508, wCurItem: 0xc509, wNamedObjectIndex: 0xc50a, wItemListPointer: 0xc50b, wUpdateSpritesEnabled: 0xc50d, wListMenuID: 0xc50e, wItemList: 0xc510, wEditorSceneState: 0xc530, wDoNotWaitForButtonPressAfterDisplayingText: 0xc531, wEventFlags: 0xc900, wCurMap: 0xc536, wToggleableObjectList: 0xc540, wToggleableObjectFlags: 0xc580, hLoadedROMBank: 0xff80, hCurrentSpriteOffset: 0xff81, hIsToggleableObjectOff: 0xff82 };
  const expected: string[] = [], driver: string[] = [], helpers: string[] = [];
  const set = (address: string | number, value: string | number) => [`\tld a, ${value}`, `\tld [${typeof address === "number" ? `$${address.toString(16)}` : address}], a`];
  const observe = (address: string | number, output: number, value: number) => { expected.push(`${output.toString(16)}=${value.toString(16)}`); return [`\tld a, [${typeof address === "number" ? `$${address.toString(16)}` : address}]`, `\tld [$${output.toString(16)}], a`]; };
  const money = (a: number, b: number, c: number) => [...set("wPlayerMoney", a), ...set("wPlayerMoney + 1", b), ...set("wPlayerMoney + 2", c)];
  const mon = (index: number, species: string, move: string) => [...set(`wPartySpecies + ${index}`, species), ...set(`wPartyMon1 + ${index} * PARTYMON_STRUCT_LENGTH`, species), ...set(`wPartyMon1 + ${index} * PARTYMON_STRUCT_LENGTH + MON_MOVES + 3`, move)];
  let count = 0;
  function condition(c: PlayerCondition, setup: string[], matched: boolean) {
    const p = `Condition${count}`, out = 0xc000 + count++;
    driver.push("\tcall ResetState", ...setup, `\tcall ${p}`, `\tld [$${out.toString(16)}], a`);
    helpers.push(`${p}:`, ...renderPlayerCondition(c, ".yes", ".no", p), ".yes", "\tld a, 1", "\tret", ".no", "\txor a", "\tret");
    expected.push(`${out.toString(16)}=${matched ? 1 : 0}`);
  }
  condition({ kind: "hall-of-fame" }, [], false); condition({ kind: "hall-of-fame" }, set("wNumHoFTeams", 1), true);
  condition({ event: "EVENT_GOT_POKEDEX", set: true }, [], false); condition({ event: "EVENT_GOT_POKEDEX", set: true }, ["\tSetEvent EVENT_GOT_POKEDEX"], true);
  const bag = [...set("wNumBagItems", 2), ...set("wBagItems", "POTION"), ...set("wBagItems + 1", 1), ...set("wBagItems + 2", "POTION"), ...set("wBagItems + 3", 2), ...set("wBagItems + 4", 255)];
  condition({ kind: "item", item: "POTION", quantity: 3 }, bag, true); condition({ kind: "item", item: "POTION", quantity: 4 }, bag, false);
  condition({ kind: "item", item: "POTION", quantity: 1 }, [...set("wNumBoxItems", 1), ...set("wNumBoxItems + 1", "POTION"), ...set("wNumBoxItems + 2", 99)], false);
  condition({ kind: "money", amount: 0 }, [], true); condition({ kind: "money", amount: 1000 }, money(0, 0x10, 0), true); condition({ kind: "money", amount: 1001 }, money(0, 0x10, 0), false);
  condition({ kind: "money", amount: 49999 }, money(5, 0, 0), true); condition({ kind: "money", amount: 50001 }, money(5, 0, 0), false);
  condition({ kind: "coins", amount: 1000 }, [...set("wPlayerCoins", 0x10), ...set("wPlayerCoins + 1", 0)], true); condition({ kind: "coins", amount: 1001 }, [...set("wPlayerCoins", 0x10), ...set("wPlayerCoins + 1", 0)], false);
  condition({ kind: "party-species", species: "LAPRAS" }, [...set("wPartyCount", 1), ...mon(0, "LAPRAS", "SURF")], true); condition({ kind: "party-species", species: "LAPRAS" }, mon(0, "LAPRAS", "SURF"), false);
  condition({ kind: "party-move", move: "SURF" }, [...set("wPartyCount", 1), ...mon(0, "RATTATA", "SURF")], true);
  condition({ kind: "party-move", move: "SURF", species: "LAPRAS" }, [...set("wPartyCount", 1), ...mon(0, "RATTATA", "SURF")], false);
  condition({ kind: "party-move", move: "SURF", species: "LAPRAS" }, [...set("wPartyCount", 2), ...mon(0, "RATTATA", "CUT"), ...mon(1, "LAPRAS", "SURF")], true);
  condition({ kind: "party-move", move: "CUT" }, mon(0, "LAPRAS", "CUT"), false);
  condition({ kind: "badge", badge: "SOUL" }, set("wObtainedBadges", 16), true); condition({ kind: "badge", badge: "RAINBOW" }, set("wObtainedBadges", 16), false);
  condition({ kind: "badge-count", minimum: 8 }, set("wObtainedBadges", 255), true); condition({ kind: "badge-count", minimum: 4 }, set("wObtainedBadges", 7), false);
  condition({ kind: "party-count", minimum: 6 }, set("wPartyCount", 6), true); condition({ kind: "party-count", minimum: 1 }, [], false);
  condition({ kind: "bag-space", minimum: 1 }, set("wNumBagItems", 19), true); condition({ kind: "bag-space", minimum: 1 }, set("wNumBagItems", 20), false);
  condition({ kind: "dex-species", species: "MEW", status: "caught" }, set("wPokedexOwned + 18", 64), true); condition({ kind: "dex-species", species: "MEW", status: "seen" }, set("wPokedexOwned + 18", 64), false);
  condition({ kind: "dex-count", minimum: 1, status: "caught" }, set("wPokedexOwned + 18", 128), false); condition({ kind: "dex-count", minimum: 151, status: "caught" }, Array.from({ length: 19 }, (_, i) => set(`wPokedexOwned + ${i}`, 255)).flat(), true);
  condition({ kind: "travel", mode: "cycling" }, set("wWalkBikeSurfState", 1), true); condition({ kind: "travel", mode: "surfing" }, set("wWalkBikeSurfState", 1), false);
  condition({ kind: "all", conditions: [{ kind: "not", condition: { kind: "hall-of-fame" } }, { kind: "any", conditions: [{ kind: "badge", badge: "SOUL" }, { kind: "money", amount: 100 }] }] }, money(0, 1, 0), true);
  condition({ kind: "not", condition: { kind: "any", conditions: [{ kind: "hall-of-fame" }, { kind: "badge", badge: "SOUL" }] } }, set("wObtainedBadges", 16), false);

  let transactionCount = 0;
  function transaction(service: NpcTransaction, setup: string[], status: number, observations: Array<[string | number, number]>) {
    const p = `Transaction${transactionCount}`, at = 0xc080 + transactionCount++ * 8;
    driver.push("\tcall ResetState", ...setup, `\tcall ${p}`, `\tld [$${at.toString(16)}], a`, ...observations.flatMap(([address, value], i) => observe(address, at + i + 1, value)));
    expected.push(`${at.toString(16)}=${status}`); helpers.push(...renderNpcTransaction(service, p).map(l => l.replace("predef HealParty", "call HealParty")));
  }
  const none = { kind: "none" } as const, potion = { kind: "item", item: "POTION", quantity: 1 } as const;
  transaction({ cost: { kind: "money", amount: 900001 }, reward: none, confirm: false }, money(0x99, 0x99, 0x99), 0, [["wPlayerMoney", 9], ["wPlayerMoney + 1", 0x99], ["wPlayerMoney + 2", 0x98]]);
  transaction({ cost: { kind: "coins", amount: 501 }, reward: none, confirm: false }, [...set("wPlayerCoins", 0x10), ...set("wPlayerCoins + 1", 0)], 0, [["wPlayerCoins", 4], ["wPlayerCoins + 1", 0x99]]);
  transaction({ cost: { kind: "money", amount: 500 }, reward: potion, confirm: true }, [...money(0, 0x10, 0), ...set("wCurrentMenuItem", 1)], 1, [["wPlayerMoney + 1", 0x10], ["wNumBagItems", 0]]);
  transaction({ cost: { kind: "money", amount: 500 }, reward: potion, confirm: true }, money(0, 4, 0x99), 2, [["wPlayerMoney + 1", 4], ["wPlayerMoney + 2", 0x99], ["wNumBagItems", 0]]);
  const fullBag = [...set("wNumBagItems", 20), ...Array.from({ length: 20 }, (_, i) => [...set(`wBagItems + ${i * 2}`, "ULTRA_BALL"), ...set(`wBagItems + ${i * 2 + 1}`, 1)]).flat(), ...set("wBagItems + 40", 255)];
  transaction({ cost: { kind: "money", amount: 500 }, reward: potion, confirm: false }, [...fullBag, ...money(0, 0x10, 0)], 3, [["wPlayerMoney + 1", 0x10], ["wNumBagItems", 20], ["wBagItems + 40", 255]]);
  transaction({ cost: { kind: "item", item: "POTION", quantity: 3 }, reward: { kind: "item", item: "RARE_CANDY", quantity: 5 }, confirm: false }, [...fullBag, ...set("wBagItems", "POTION"), ...set("wBagItems + 1", 1), ...set("wBagItems + 2", "POTION"), ...set("wBagItems + 3", 2)], 0, [["wNumBagItems", 19], ["wBagItems", 2], ["wBagItems + 36", 0x28], ["wBagItems + 37", 5], ["wBagItems + 38", 255]]);
  transaction({ cost: { kind: "item", item: "POTION", quantity: 1 }, reward: { kind: "item", item: "RARE_CANDY", quantity: 1 }, confirm: false }, [...fullBag, ...set("wBagItems", "POTION"), ...set("wBagItems + 1", 2)], 3, [["wNumBagItems", 20], ["wBagItems + 1", 2], ["wBagItems + 40", 255]]);
  transaction({ cost: { kind: "item", item: "POTION", quantity: 1 }, reward: { kind: "item", item: "POTION", quantity: 10 }, confirm: false }, [...fullBag, ...set("wBagItems", "POTION"), ...set("wBagItems + 1", 2)], 0, [["wNumBagItems", 20], ["wBagItems + 1", 11]]);
  transaction({ cost: { kind: "item", item: "POTION", quantity: 4 }, reward: none, confirm: false }, bag, 2, [["wNumBagItems", 2], ["wBagItems + 1", 1], ["wBagItems + 3", 2]]);
  transaction({ cost: { kind: "money", amount: 500 }, reward: { kind: "pokemon", species: "MAGIKARP", level: 5 }, confirm: false }, [...money(0, 0x10, 0), ...set("wPartyCount", 6), ...set("wBoxCount", 20)], 3, [["wPlayerMoney + 1", 0x10], ["wAddedToParty", 0]]);
  transaction({ cost: { kind: "item", item: "POTION", quantity: 3 }, reward: { kind: "pokemon", species: "MAGIKARP", level: 5 }, confirm: false }, [...bag, ...set(0xc532, 1)], 3, [["wNumBagItems", 2], ["wBagItems + 1", 1], ["wBagItems + 3", 2]]);
  transaction({ cost: { kind: "money", amount: 500 }, reward: { kind: "heal" }, confirm: true }, money(0, 0x10, 0), 0, [["wPlayerMoney + 1", 5], [0xc533, 1]]);
  const shop = renderNpcShop(["POTION", "POKE_BALL", "TM_DIG"], "ShopProbe").map(l => l.replace("farcall DisplayPokemartDialogue_", "call DisplayPokemartDialogue_"));
  driver.push("\tcall ResetState", "\tcall ShopProbe", ...observe("wItemList", 0xc0f0, 3), ...observe("wItemList + 1", 0xc0f1, 0x14), ...observe("wItemList + 2", 0xc0f2, 4), ...observe("wItemList + 3", 0xc0f3, 0xe4), ...observe("wItemList + 4", 0xc0f4, 255), ...observe(0xc534, 0xc0f5, 1));
  helpers.push(...shop);

  // Execute the generated scene's native text entry twice without clearing its
  // receipt flag, as happens after an aborted movement and a later retry.
  const model = receipt, plan = model.scene!, serviceNode = plan.nodes.findIndex(n => n.action?.kind === "transaction"), textIndex = plan.textNodes.indexOf(serviceNode);
  assert.ok(serviceNode >= 0 && plan.giftFlag);
  const textLabel = `${model.prefix}SceneText${textIndex}`, rendered = renderScene(model);
  const entry = rendered.match(new RegExp(`^${textLabel}:\\n([\\s\\S]*?)(?=^[A-Za-z_]\\w*:{1,2})`, "m"))![1].replace("\ttext_asm\n", "");
  helpers.push(`${textLabel}:`, entry, ...renderNpcTransaction(plan.nodes[serviceNode].action as Extract<NonNullable<typeof plan.nodes[number]["action"]>, { kind: "transaction" }>, `${model.prefix}Service${serviceNode}`).map(l => l.replace("predef HealParty", "call HealParty")));
  driver.push("\tcall ResetState", ...money(0, 0x10, 0), `\tcall ${textLabel}`, `\tcall ${textLabel}`, ...observe("wPlayerMoney + 1", 0xc0f6, 5), ...observe(0xc533, 0xc0f7, 1), ...observe("wEditorSceneState", 0xc0f8, plan.nodes[serviceNode].next!), `\tResetEvent ${plan.giftFlag}`, ...money(0, 0x10, 0), `\tcall ${textLabel}`, ...observe(0xc533, 0xc0f9, 2));
  const engine = overlay.get("engine/overworld/toggleable_objects.asm")!;
  const conditionalRuntime = engine.match(/; yellow-editor-npc-visibility-begin\n([\s\S]*?); yellow-editor-npc-visibility-end/)!;
  assert.ok(conditionalRuntime);
  const visibilityRuntime = conditionalRuntime[1].replace('SECTION "Editor NPC Conditions", ROMX', 'SECTION "Editor NPC Conditions", ROMX, BANK[1]').replace(/(SECTION "NPC condition [^"]+", ROMX)/g, '$1, BANK[2]');
  const blocker = [...overlay.get("scripts/BluesHouse.asm")!.matchAll(/yellow-editor-interaction: (.*)/g)].map(m => JSON.parse(m[1]) as ManagedInteraction).find(m => m.visibilityRule)!;
  driver.push("\tcall ResetState", ...set("wCurMap", "BLUES_HOUSE"), ...set("hCurrentSpriteOffset", blocker.visibilityRule!.object * 16), ...set("wToggleableObjectList", 255), ...set("wObtainedBadges", 1), ...set(0xc537, 1), "\tcall IsObjectHidden", ...observe("hIsToggleableObjectOff", 0xc0fa, 0), ...set("wNumHoFTeams", 1), "\tcall IsObjectHidden", ...observe("hIsToggleableObjectOff", 0xc0fb, 1), ...set("wNumHoFTeams", 0), ...set(0xc538, 1), "\tcall IsObjectHidden", ...observe("hIsToggleableObjectOff", 0xc0fc, 1), ...set(0xc537, 0), ...set("hCurrentSpriteOffset", 14 * 16), "\tcall IsObjectHidden", ...observe("hIsToggleableObjectOff", 0xc0fd, 0));
  const eventText = overlay.get("constants/event_constants.asm")!, event = projectConstantCatalogFromSources([{ path: "constants/event_constants.asm", contents: eventText }]).constants.find(c => c.symbol === plan.giftFlag)!;
  assert.ok(event); const receiptDef = `DEF ${plan.giftFlag} EQU ${event.value}`;
  const extract = (text: string, name: string) => `${name}::\n` + text.match(new RegExp(`^${name}:{1,2}\\r?\\n([\\s\\S]*?)(?=^[A-Za-z_]\\w*:{1,2}|$(?![\\s\\S]))`, "m"))![1];
  const nativeInventory = overlay.get("engine/items/inventory.asm") ?? await readFile(join(root, "engine/items/inventory.asm"), "utf8");
  const give = extract(await readFile(join(root, "home/give.asm"), "utf8"), "GiveItem"), load = extract(await readFile(join(root, "home/text_script.asm"), "utf8"), "LoadItemList");
  const bankFile = await readFile(join(root, "home/bankswitch2.asm"), "utf8").catch(() => readFile(join(root, "home/bankswitch.asm"), "utf8"));
  const bankswitch = extract(bankFile, "Bankswitch") + (bankFile.includes("JumpToAddress::") ? extract(bankFile, "JumpToAddress") : "");
  const objectVisibility = extract(engine, "IsObjectHidden");
  const asm = ['INCLUDE "includes.asm"', ...Object.entries(defs).map(([name, address]) => `DEF ${name} EQU $${address.toString(16)}`), receiptDef, 'SECTION "Header", ROM0[$100]', "jp Entry", "ds $150 - @, 0", 'SECTION "Code", ROM0[$150]', "Entry:", "di", "ld sp, $dfff", "ld hl, $c000", "ld bc, $1000", ".clear", "xor a", "ld [hli], a", "dec bc", "ld a, b", "or c", "jr nz, .clear", ...set("hLoadedROMBank", 1), ...set("rROMB", 1), ...driver, "ProbeDone:", "halt", "jr ProbeDone", ...helpers, give, nativeInventory, load, bankswitch, objectVisibility, visibilityRuntime, "ResetState:", "ld hl, $c200", "ld bc, $340", ".clear", "xor a", "ld [hli], a", "dec bc", "ld a, b", "or c", "jr nz, .clear", "ret", "AddItemToInventory:", "jp AddItemToInventory_", "RemoveItemFromInventory:", "jp RemoveItemFromInventory_", "GivePokemon:", "ld a, [$c532]", "and a", "ret nz", "ld a, 1", "ld [wAddedToParty], a", "scf", "ret", "HealParty:", "ld hl, $c533", "inc [hl]", "ret", "DisplayPokemartDialogue_:", "ld a, 1", "ld [$c534], a", "ret", "EditorSceneObjectHidden:", "ld a, [$c537]", "and a", "ret z", "ld a, [$c538]", "ldh [hIsToggleableObjectOff], a", "scf", "ret", "ToggleableObjectFlagAction:", "ret", "TextScriptEnd:", "GetItemName:", "CopyToStringBuffer:", "PrintText:", "YesNoChoice:", "WaitForTextScrollButtonPress:", "EnableAutoTextBoxDrawing:", "ret"].join("\n");
  const file = join(temp, "npc-tools-probe.asm"), obj = join(temp, "npc-tools-probe.o"), rom = join(temp, "npc-tools-probe.gb"), sym = join(temp, "npc-tools-probe.sym");
  await writeFile(file, asm); run(join(rgbds, "rgbasm"), ["-I", `${root}/`, "-o", obj, file]); run(join(rgbds, "rgblink"), ["-n", sym, "-o", rom, obj]); run(join(rgbds, "rgbfix"), ["-v", "-p", "0", "-m", "0x19", rom]);
  const stop = (await readFile(sym, "utf8")).match(/^00:([0-9a-f]+) ProbeDone$/mi)![1];
  run(cpu, [rom, stop, ...expected]);
  console.log(`${root}: CPU probes passed (${count} predicate cases, ${transactionCount} transactions with native inventory, shop ABI, banked visibility and scene payment retries)`);
}
