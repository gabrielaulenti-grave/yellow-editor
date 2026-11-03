# Add playable content

The Pokémon, Moves and Trainers workspaces can append content without replacing existing entries. Each creation is one source transaction in History. Reload a creation form if its underlying source files changed elsewhere.

## Moves

Select a move in **Moves** to edit its name, power, accuracy, PP, type and existing battle behavior. Use the global **Save**, **Revert**, **Undo** and **Redo** controls; Ctrl/Cmd+S saves while the Moves workspace is open. Changing a move or leaving the workspace asks before discarding an unfinished draft. Reload sources after external edits. Edited moves retain their IDs, source constants, animation assignments and sound tables. **High critical-hit rate** edits the separate move-membership list used by the engine; it is independent of Battle behavior. Unsupported list or lookup structures leave this checkbox disabled with an explanation, while ordinary move data remains editable.

Names support up to twelve game-text characters, power 0–255, accuracy 0–100 and PP 1–40. A zero power or accuracy setting is allowed; the selected behavior and original move-specific engine rules still determine battle mechanics. Editing chooses from named behaviors declared by the project's engine. Types and behaviors remain selectable after their last move is changed. Custom macros, expressions and ambiguous tables remain unmodified when unsupported.

Choose **New move** in Moves. Copy defaults from an existing move, then choose its name, source constant, type, power, accuracy, PP, existing battle behavior, animation and sound. The template also copies its **High critical-hit rate** setting, which can be changed before creation or afterward in Moves. The template also copies the supported special properties described below. The new move becomes available to Pokémon starting moves and learnsets. Existing moves and status-animation identifiers keep their values.

This first pass reuses existing battle behaviors and animation scripts, including animations created in Graphics. Creating a new battle mechanic still requires engine code. Allocation stops at the reviewed animation-table and byte-ID limits.

## Special move properties

**Moves → Special move properties** configures turn priority, Counter retaliation, badly poisoned status, Rest healing, fixed/level/random damage, quarter/half recoil, charge presentation and Fly/Dig invulnerability. Relevant controls appear for the selected Battle behavior. **New move** copies these settings from its template as well as ordinary stats, sounds, animation and high-critical-hit rate.

- **Turn priority:** normal, first (Quick Attack) or last (Counter). Counter retaliation uses No additional effect and retains Gen I's Normal/Fighting damage rules.
- **Poison and healing:** poison effects can badly poison; Heal can use Rest's full healing, status clearing and sleep instead of ordinary half healing.
- **Special damage:** choose the user's level, a fixed amount from 1–255, or the original Psywave random calculation.
- **Recoil and charging:** choose 25% or 50% recoil; choose a generic charge message, a vanilla charge presentation, airborne or underground invulnerability.
- **Secondary chances:** retain the original engine chance, or choose 0–100% for poison, burn, freeze, paralysis, flinch, confusion and stat-lowering side effects. Accuracy, type immunities and Substitute still apply.
- **Additional secondary effect:** add one supported status/stat side effect to a damaging effect family, such as draining plus paralysis or recoil plus flinching. It runs once after the main effect and completed hit/multi-hit sequence, only when the move hit and both Pokémon remain. A custom chance applies to each secondary-effect roll. The original Gen I limit of one major status remains.

The first change allocates a banked per-move table and installs reviewed engine hooks in one undoable transaction. Vanilla settings are preserved, including existing engine quirks. No new WRAM or ROM0 space is consumed. Subsequent move creation extends the table. Modified or unreviewed hooks disable these controls with an explanation; ordinary move-data editing remains available. Source changes during a draft require reloading before saving.

## Pokémon

Choose **New Pokémon** and select a template, name, source constant, starting move, Pokédex category and description. The form shows remaining capacity. Creation reclaims a verified unused internal slot first, then appends IDs when needed, while assigning a new Pokédex number. It makes independent front/back image copies and base stats and updates the species tables together.

The template supplies stats, types, growth, later level-up moves, TM compatibility, cry, palette and menu icon. New species start without evolutions. Edit the supported stats and progression in Pokémon and open their artwork in Graphics. Cry and menu-icon authoring are outside this first pass.

The game’s `dex` ending prints a closing period automatically. Creation accepts a final period in the description and stores it only once, preserving periods inside the text and intentional ellipses. The final row has room for 17 characters plus the automatic period. In the source-oriented text editor, omit the final period; its help text explains this convention.

Stock Red and Yellow projects offer **45 additional species**: 36 ordinary unused MissingNo slots plus nine tail IDs, for a total of 196 real Pokémon. Existing species, trainer, fossil-display and ghost IDs stay unchanged. Previously appended Pokémon retain their IDs.

Only reviewed placeholder rows can be reclaimed. Customized names, cries, Pokédex mappings, learnsets, aliases, shared data and known numeric or symbolic species references reserve a slot. Capacity can therefore be lower in a modified project. Allocation stops at the reviewed ID and RAM limits, and unsupported structures refuse creation.

New artwork, base stats and Pokédex descriptions use independent ROM banks. Their bank routing preserves the original Pokémon and special-image paths; evolution uses the bank-aware header loader. Expanded seen/owned flags consume twelve reviewed unused RAM bytes while keeping scene storage and the stack boundary intact. Other project content can still exhaust ROM space; a successful build remains the final capacity check.

Adding species can change the Pokédex save layout. Use a new test save; the editor changes the save-compatibility identity for expanded projects. Save migration is not included.

## Trainers

Choose **New trainer party** in Trainers. Select an existing class and up to six Pokémon, using shared or individual levels. New parties retain every existing party number, including when classes previously shared their source data. Use Maps and script interactions to place the new party in the world and supply its dialogue.

To add a class with its own portrait, use the existing creation form in Trainers → Class data and choose an independent portrait copy. Edit that portrait in Graphics. A class, its portrait and its individual parties remain separate concepts.

## Undo and validation

Creation writes all affected source files together and rolls back a failed write. History supports undo and redo. Creation cannot be undone while later content still references its new symbol or a placed trainer uses its new party; remove or undo those references first.

Source tests fill all 45 slots and check customized-slot refusal, existing identities, stale forms, rollback and history for pinned Red and Yellow sources. Browser checks exercise the forms on desktop and mobile widths. The native acceptance fixture fills all 45 slots, builds both games, checks reclaimed and tail picture banks and exercises battle, level-up evolution, capture at Pokédex #196, PC deposit/withdraw and SRAM Continue.
