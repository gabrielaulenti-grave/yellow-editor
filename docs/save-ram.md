# Emulator battery save RAM

Yellow Editor stores Game Boy battery-backed SRAM separately from the generated ROM. The web app uses IndexedDB and identifies the selected project by the same persistent File System Access handle identity used for editor history.

Each stored save revision is keyed by project, build target, and a save-compatibility descriptor. The descriptor currently contains:

- a Yellow Editor save format version and explicit compatibility epoch;
- a structural fingerprint of the Gen I SRAM/WRAM layout inputs, including the evaluated event-flag storage extent;
- a semantic fingerprint of event constant names and bit positions.

An exact compatibility match is loaded automatically. Older revisions with a changed event schema, structural layout, or compatibility epoch remain stored but are not loaded or overwritten. This gives future event-flag editing and save migration code a safe source revision to migrate from.

The emulator polls binjgb's external-RAM dirty flag and writes a copied SRAM snapshot to IndexedDB. It also attempts a final snapshot when pausing, resetting, hiding, unloading, or replacing the emulator. Browser persistent-storage permission is requested when available, but users should eventually also be offered explicit save import/export because clearing site data can remove IndexedDB.

Save migration is deliberately not implemented yet. When event editing is added, migrations should map old event bits to new bits by event constant name, operate on a copy, update the game's checksum, and retain the original save revision.
