# Imported map analysis

Existing-object editing reads relationships from the imported RGBDS project. It does not require Yellow Editor metadata, stock map names, the original pickup-handler name, a particular trainer-talk wrapper, or a byte-identical sprite loader.

The reader resolves numeric expressions and aliases in map dimensions, object positions, opponent/party fields and text IDs. It retains map registry slots even when one map's dimensions cannot be resolved. Symbolic `dw_const` tables and plain `dw` text tables are supported for existing records, including projects without named object constants. Unchanged expressions and comments are retained when another field is edited.

Trainer analysis indexes global and scoped labels across the project, follows direct calls, jumps, conditional branches, far calls and fallthroughs, and locates the header data referenced by each interaction. Header-specific controls are offered only when their binding and emitted layout can be resolved. Several reachable headers or an unresolved control path leave sight/role-specific text unavailable; the encoded party remains independently editable. Labels and flag-array/opponent aliases can be renamed. Dialogue resolution also finds definitions outside filename conventions. **How this was resolved** shows source locations for the record and its header links.

Object and trainer macros are checked by their emitted record layout rather than by a source hash. Equivalent arithmetic and formatting are accepted. Unknown object layouts stay listed with a diagnostic; their runtime positions are not invented. **View object source** opens the data behind a selected record. Unknown sprite allocation or layout does not require rejecting the object data: existing graphics are retained, and uncertain appearance controls are protected. New-object generation still has separate engine/layout checks because it adds records and code.

This is bounded analysis of supported RGBDS source formats, not execution of arbitrary assembly. Indirect dispatch, ambiguous definitions, unfamiliar macro encodings or unresolved expressions need an adapter or source review for the affected fields. Unsupported behavior is preserved rather than converted into generated Yellow Editor scripts. Binary ROM reverse-engineering is separate from the current source/ZIP import workflow.

## Verification

`npm run test:maps:imported -- <red> <yellow>` constructs independently modified projects with renamed maps, text IDs, opponent aliases, pickup handlers and saved-event arrays; expressions; relocated headers; cross-file helpers; conditional paths; modified sprite loaders; and comment-free graphics tables. It checks no-op saves, expression preservation, field-specific ambiguity, opaque layouts, plain pointer tables, unnamed object slots, cache invalidation, undo/redo and independent maps. Add `--rom <rgbds>` to compile complete edited Red and Yellow games.

`IMPORTED_MAP_OBJECTS=1 npm run test:maps:native:ui -- <red> <yellow>` exercises the imported-project workflow at 320, 375 and 1280 pixels, including independent party edits when sight is unresolved. The existing vanilla sweep, native CPU probes and full-game builds remain required.
