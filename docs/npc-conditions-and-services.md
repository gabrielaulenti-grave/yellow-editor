# NPC conditions and services

Open **Maps**, select an NPC, and choose **Edit interaction**. Existing event
conditions, dialogue, gifts, scenes and shared flags remain editable.

## A blocker that disappears after becoming Champion

Enable **Show this NPC only when a condition matches**. The default rule is
**Not this check → Hall of Fame completed**. Save the interaction.

The rule checks `wNumHoFTeams`, so a player who has already entered the Hall of
Fame can load an existing save and find the route open. It does not use the
temporary Champion battle or Hall of Fame Pokédex-dialogue event flags.
For a newly configured NPC, enabling visibility alone keeps the original
conversation and creates a repeatable interaction with no additional dialogue
actions. Previously configured interactions retain their one-time and action
settings.

Visibility is evaluated when sprites load or refresh; talking to the NPC is
not required. A matching condition permits the game's normal visibility rules
to run. Native story logic or a scene can still hide the NPC. A failing condition
hides it before those rules. These conditions use no additional save bits.

This control requires a text entry belonging to one NPC. Give NPCs separate
dialogue entries when their visibility should differ. A boulder linked to a
managed Strength hole keeps its own visibility owner.

## Reusable conditions

Use **Require a condition** for the whole interaction, **Branch on player
condition** inside an action sequence, or a condition for an automatic scene
trigger. Interaction requirements show the original dialogue when they fail;
branches have Then and Otherwise paths. Automatic conditions leave manual
interaction available from the configured starting tiles.

| Check | Meaning |
| --- | --- |
| Event flag | Existing or shared event is set/clear |
| Hall of Fame completed | At least one Hall of Fame team has been recorded |
| Item in bag | At least the selected quantity across all current bag stacks |
| Money / coins | At least the selected amount; checking never spends it |
| Pokémon in party | The selected species is in the current party |
| Move known by party | A current party member knows the selected move; optionally require that same member to be a particular species |
| Badge / badge count | A particular badge, or at least a chosen number |
| Party size | At least a chosen number of party members |
| Free bag slots | At least a chosen number of unused item slots |
| Pokédex species / count | Seen or caught registration, separately from current ownership |
| Travel mode | Currently walking, cycling or surfing |

Combine checks with **All**, **Any** and **Not**. Each group accepts 1–8 children;
a condition supports at most 24 nodes and four nesting levels. Checks are
read-only. The supported layout is the reviewed Red/Yellow bag, party, badges
and 151-species Pokédex.

Bag checks exclude PC storage. Party checks exclude boxed Pokémon. A move check
includes fainted party members and tests knowledge of the move; badges and map
field-use permissions are separate. Free slots do not describe the remaining
capacity of an existing stack. Delivery actions check actual available room.

## Payments, item exchanges and services

Add **Payment or item exchange** to an action sequence. Choose money, coins, or
an item quantity from the bag. Choose a reward in the same action: no reward
(admission or taking payment), an item, a Pokémon, or healing the party.

**Ask for confirmation** shows the actual price or item quantity with a Yes/No
menu. Declining, pressing B, insufficient resources, or failed delivery leaves
money and items intact. The action provides separate Paid, Declined, Not enough
money or items, and No room for reward paths. The default failure paths end
incompletely, allowing another attempt.

Item costs can span several stacks. A consumed stack can free the slot needed
for a reward. The bag is restored if delivery fails, including its item count
and terminator. Money or coins are subtracted only after successful delivery.
Pokémon rewards use the native party/current-PC-box delivery behavior.

Use one gift, payment/exchange, or shop per execution path. Put a transaction's
reward in its reward field instead of adding a separate gift afterward. Normal
dialogue, event changes and scene movement can follow it. Scenes retain a
receipt until completion, so retrying an interrupted scene skips an already
completed payment or exchange. Successful completion clears that receipt for
repeatable scenes. No save array is resized.

Prices are 1–999999 money or 1–9999 coins; item costs and item rewards are 1–99.
Taking an item without a reward uses an item cost and No reward. Confirmation
can be disabled for a scripted collection.

## Shops

Add **Open shop** and configure 1–14 different stock items. It opens the native
buy/sell/quit menu with the game's shared item prices, including supported
TM/HM item IDs. Set the interaction to repeatable for an ordinary merchant.
Add dialogue before the shop action to customize the introduction.

For an NPC offering a particular reward at a custom price, use a payment action.
Shop stock does not create per-NPC price overrides or a separate shop engine.

## Verification

```sh
npm run test:npcs:tools -- /path/to/pokered /path/to/pokeyellow
npm run test:npcs:tools:ui -- /path/to/pokered /path/to/pokeyellow
npm run test:npcs:tools -- /path/to/pokered /path/to/pokeyellow --rom /path/to/rgbds /path/to/binjgb
```

Source tests cover old interaction regeneration, compound conditions, visibility
history/removal, scene composition, native stock and source guards. CPU probes
exercise condition boundaries, the real native inventory routines, payment and
exchange rollback, shop-list calling conventions, scene receipts, and conditional
visibility through the real bank-switch routines. Text/menu drawing and Pokémon
gift boundaries are instrumented in those probes; complete Red/Yellow ROM builds
include the native implementations. Browser workflows cover 320, 375 and 1280px,
draft recovery, validation and save/reopen.
