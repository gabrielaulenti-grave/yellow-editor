# Add playable content

The Pokémon, Moves and Trainers workspaces can append content without replacing existing entries. Each creation is one source transaction in History. Reload a creation form if its underlying source files changed elsewhere.

## Moves

Choose **New move** in Moves. Copy defaults from an existing move, then choose its name, source constant, type, power, accuracy, PP, existing battle behavior, animation and sound. The new move becomes available to Pokémon starting moves and learnsets. Existing moves and status-animation identifiers keep their values.

This first pass reuses existing battle behaviors and animation scripts, including animations created in Graphics. Creating a new battle mechanic still requires engine code. Allocation stops at the reviewed animation-table and byte-ID limits.

## Pokémon

Choose **New Pokémon** and select a template, name, source constant, starting move, Pokédex category and description. Creation allocates a new internal species ID and Pokédex number, makes independent front/back image copies and base stats, and updates the species tables together.

The template supplies stats, types, growth, later level-up moves, TM compatibility, cry, palette and menu icon. New species start without evolutions. Edit the supported stats and progression in Pokémon and open their artwork in Graphics. Cry and menu-icon authoring are outside this first pass.

Stock projects have nine appendable internal species slots before the trainer-opponent ID boundary. The editor refuses further allocation rather than shifting existing species or trainer identities. Projects with unsupported table structures also refuse creation.

Adding species can change the Pokédex save layout. Use a new test save; the editor changes the save-compatibility identity for expanded projects. Save migration is not included.

## Trainers

Choose **New trainer party** in Trainers. Select an existing class and up to six Pokémon, using shared or individual levels. New parties retain every existing party number, including when classes previously shared their source data. Use Maps and script interactions to place the new party in the world and supply its dialogue.

To add a class with its own portrait, use the existing creation form in Trainers → Class data and choose an independent portrait copy. Edit that portrait in Graphics. A class, its portrait and its individual parties remain separate concepts.

## Undo and validation

Creation writes all affected source files together and rolls back a failed write. History supports undo and redo. Creation cannot be undone while later content still references its new symbol or a placed trainer uses its new party; remove or undo those references first.

Source tests check allocation, existing identities, stale forms, rollback and history for pinned Red and Yellow sources. Browser checks exercise the forms on desktop and mobile widths. The native acceptance fixture builds both games and exercises a new move, a new trainer party and species through battle, capture, Pokédex registration, PC deposit/withdraw and SRAM Continue.
