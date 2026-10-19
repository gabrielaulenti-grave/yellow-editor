# Recreating the fossil interaction

This example uses the normal NPC and action tools for a guardian battle, two
independent pickups, one shared choice, and the guardian taking the other fossil.
It does not replace the original Mt. Moon scripts.

## Place the actors

In Maps, use Add NPC for an animated guardian and two Fossil objects. Keep them
stationary; fossils have one pose facing down. Check the room for other actors.
These positions work in an otherwise vanilla Viridian Pokémon Center:

| Actor | X | Y |
| --- | ---: | ---: |
| Guardian | 7 | 6 |
| Dome fossil | 7 | 4 |
| Helix fossil | 8 | 4 |

## Shared progress and the guardian

Select the guardian, **Edit interaction → Compose action sequence**. Under
**Shared scene flags**, create:

- Fossil guardian defeated
- Fossil reward claimed
- Dome reward chosen
- Helix reward chosen

New flags start clear in a new save. Save the interaction to make them available
to other NPCs, objects and maps. They reserve unused bits in the existing save
layout without renumbering native story flags.

Uncheck **Show the original dialogue first** and **Run once per save file**.
Add **Branch on event → Fossil guardian defeated**, requiring it to be set:

- **Then:** branch on **Fossil reward claimed**. If set, show the lab-related
  dialogue; otherwise, tell the player to choose one fossil.
- **Otherwise:** show the challenge, start a **Trainer battle**, set **Fossil
  guardian defeated** in **Victory**, then show the offer to share.

Choose an existing trainer party, such as SUPER NERD:2, or create one in Trainers
first. Losing follows the native blackout flow and leaves the victory flag clear.

Use **Interact with this NPC or sign**, player start (8, 6), and add (6, 5) as
another manual approach. These include a reachable conversation tile after
either walking route. Check **Also start automatically here** for (8, 6)
only. Enable **Require an event for the automatic trigger**, select **Fossil
guardian defeated**, and leave **must be set** unchecked. This starts the battle
automatically before victory while allowing later manual conversations. Add
other clear adjacent manual starts as needed. Check and save the scene.

## The two independent pickups

For each fossil, compose an action sequence, uncheck **Show the original dialogue
first**, and keep **Run once per save file** checked. Leave it initially visible.

Start with **Branch on event → Fossil guardian defeated**, requiring it to be set:

- **Otherwise:** explain that the guardian must be defeated, then **End
  interaction** with **Mark interaction complete** unchecked.
- **Then:** show the pickup question and add **Yes/No choice**. No ends without
  completion. In Yes, add **Give item**, quantity 1, and enable **Only one reward
  from this shared group**.

| Pickup | Item | Reward group flag | Chosen option flag |
| --- | --- | --- | --- |
| Dome | DOME_FOSSIL | Fossil reward claimed | Dome reward chosen |
| Helix | HELIX_FOSSIL | Fossil reward claimed | Helix reward chosen |

After the gift, inside the same Yes branch:

1. Show the received-item dialogue and hide the selected fossil.
2. Walk the guardian toward the remaining fossil.
3. Face the guardian up, show “Then this is mine!”, and hide the remaining fossil.

For these positions, Dome uses guardian route RIGHT, UP; Helix uses UP. Both
routes stop adjacent to the other fossil. Add all clear pickup approaches:

| Pickup | Player starts |
| --- | --- |
| Dome | (6, 4), (7, 3), (7, 5) |
| Helix | (9, 4), (8, 3), (8, 5) |

Use **Branch on player position** when another layout needs different routes.
In Yellow, **Branch on following partner** and **Move following partner** can
move Pikachu aside before the guardian walks. Rejoining branches must leave
compatible positions for subsequent shared movement.

Set **Already completed dialogue** to explain that a fossil was chosen.
**Check scene**, save both interactions, and rebuild the ROM.

## Retry and persistence

No and a full bag leave the choice open. Successful delivery records the group
and option immediately, before sound, dialogue or movement. Another pickup in
that group stops without a gift. The chosen option can resume its remaining
actions without another gift if interrupted. Shared choice flags survive a map
reload. An aborted scene restores its starting visibility; re-enter the map to
restore actor starting positions if movement was interrupted before retrying.

Each option needs its own option flag. Do not clear the group or option flags
unless deliberately resetting the quest. Test both choices from separate
pre-choice saves, all approaches, No, a full bag, blackout and save/reload.

## The original Mt. Moon sequence

Open Mt. Moon B2F in Maps and choose **Edit map logic**, or select an object and
choose **Inspect map logic**. This shows native states, helpers, movement and
dialogue using the same guarded editors as Scripts. The original fossils'
**Edit interaction** supports item/quantity edits through their shared bag-full
handler. Structural state-machine changes stay in the guarded script tools;
this feature does not import the entire native sequence into action blocks.

Scripts remains useful as a project-wide index and for shared routines.
