import { hashText } from "./history";
import { parseMapIndex } from "./mapVisualization";
import { projectConstantCatalogFromSources, readProjectRgbdsSources } from "./projectConstants";
import { applyTextDocumentEdits, parseTextDocument, type TextSegment } from "./textEditing";
import type { MapNpcCreateDocument, MapNpcCreateValues, ProjectSource, TextWriteRequest } from "./types";

function clean(line: string): string {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\") { i++; continue; }
    if (line[i] === '"') quoted = !quoted;
    if (line[i] === ";" && !quoted) return line.slice(0, i).trim();
  }
  return line.trim();
}
const lines = (text: string) => text.split(/\r?\n/);
const symbol = /^[A-Za-z_][A-Za-z0-9_]*$/;

function block(text: string, label: string): string[] {
  const all = lines(text);
  const starts = all.flatMap((line, i) => clean(line).match(new RegExp(`^${label}:{1,2}$`)) ? [i] : []);
  if (starts.length !== 1) throw new Error(`Expected one ${label} definition.`);
  const start = starts[0] + 1;
  let end = start;
  while (end < all.length && !/^[A-Za-z_][A-Za-z0-9_]*:{1,2}$/.test(clean(all[end]))) end++;
  return all.slice(start, end).map(clean).filter(Boolean);
}

function table(text: string, label: string): string[][] {
  return block(text, label).filter(line => !/^(table_width|assert_table_length)\b/.test(line)).map(line => {
    if (!/^db\s+/.test(line)) throw new Error(`Unsupported ${label} layout.`);
    return line.replace(/^db\s+/, "").split(",").map(value => value.trim());
  });
}

function insert(text: string, index: number, added: string[]): string {
  const offsets = [0];
  for (const match of text.matchAll(/\n/g)) offsets.push(match.index + 1);
  const offset = offsets[index] ?? text.length;
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  return text.slice(0, offset) + added.join(newline) + newline + text.slice(offset);
}

// These generators depend on the standard six-field object encoding and the
// one-based constant tables. Changed macro implementations must be reviewed.
function checkMacros(text: string): void {
  const expected: Record<string, string> = {
    def_text_pointers: "const_def 1",
    object_const_def: "const_def 1",
    def_object_events: 'REDEF _NUM_OBJECT_EVENTS EQUS "_NUM_OBJECT_EVENTS_\\@"\ndb {_NUM_OBJECT_EVENTS}\nDEF {_NUM_OBJECT_EVENTS} = 0',
    object_event: 'db \\3\ndb \\2 + 4\ndb \\1 + 4\ndb \\4\ndb \\5\nIF _NARG > 7\ndb TRAINER | \\6\ndb \\7\ndb \\8\nELIF _NARG > 6\ndb ITEM | \\6\ndb \\7\nELSE\ndb \\6\nENDC\nIF _NARG > 6\nREDEF _OBJECT_EVENT_{d:{_NUM_OBJECT_EVENTS}}_TEXT_ID EQUS "0"\nELSE\nREDEF _OBJECT_EVENT_{d:{_NUM_OBJECT_EVENTS}}_TEXT_ID EQUS "\\6"\nENDC\nDEF {_NUM_OBJECT_EVENTS} += 1',
  };
  for (const [name, body] of Object.entries(expected)) {
    const matches = [...text.matchAll(new RegExp(`^MACRO ${name}\\r?\\n([\\s\\S]*?)^ENDM`, "gm"))];
    if (matches.length !== 1 || lines(matches[0][1]).map(clean).filter(Boolean).join("\n") !== body) {
      throw new Error(`NPC creation needs a reviewed ${name} macro implementation.`);
    }
  }
}

async function load(source: ProjectSource, mapConstant: string) {
  const files = await readProjectRgbdsSources(source);
  if (files.some(file => file.readError)) throw new Error("Could not inspect all assembly sources for NPC symbol collisions.");
  const byPath = new Map(files.map(file => [file.path, file.contents]));
  const read = (path: string): string => {
    const value = byPath.get(path);
    if (value === undefined) throw new Error(`Required NPC source ${path} is missing.`);
    return value;
  };
  const index = await parseMapIndex({ readText: async path => read(path) } as ProjectSource);
  const map = index.find(entry => entry.constant === mapConstant);
  if (!map || !map.headerPath || map.isUnused || map.isAlias) throw new Error("Choose a drawable map with its own map header.");
  const header = read(map.headerPath).match(/^\s*map_header\s+(\w+)\s*,\s*(\w+)\s*,/m);
  if (!header || header[2] !== mapConstant) throw new Error("This map header does not uniquely match the selected map.");
  const name = header[1];
  const objectPath = `data/maps/objects/${name}.asm`;
  const scriptPath = `scripts/${name}.asm`;
  const objects = read(objectPath);
  const script = read(scriptPath);
  checkMacros(read("macros/scripts/maps.asm"));
  for (const [macro, expected] of Object.entries({ text: "db TX_START, \\#", line: 'db "<LINE>", \\#', cont: 'db "<CONT>", \\#', done: 'db "<DONE>"', text_far: "db TX_FAR\ndab \\1", text_end: "db TX_END" })) {
    const matches = [...read("macros/scripts/text.asm").matchAll(new RegExp(`^MACRO ${macro}\\r?\\n([\\s\\S]*?)^ENDM`, "gm"))];
    if (matches.length !== 1 || lines(matches[0][1]).map(clean).filter(Boolean).join("\n") !== expected) throw new Error(`NPC creation needs a reviewed ${macro} text macro.`);
  }
  const objectLines = lines(objects);
  const objectBody = block(objects, `${name}_Object`);
  const start = objectBody.indexOf("def_object_events");
  const end = objectBody.findIndex(line => /^def_warps_to\s+/.test(line));
  if (start < 0 || end <= start || objectBody[end] !== `def_warps_to ${mapConstant}`) throw new Error("Unsupported map object table.");
  const events = objectBody.slice(start + 1, end).map(line => {
    if (!/^object_event\s+/.test(line)) throw new Error("Object table contains unsupported directives.");
    const args = line.replace(/^object_event\s+/, "").split(",").map(value => value.trim());
    if (args.length < 6 || args.length > 8 || !args.slice(0, 2).every(value => /^\d+$/.test(value))) throw new Error("Object table contains unsupported object entries.");
    return args;
  });
  const declarations = objectLines.map(clean).filter(Boolean);
  const labelIndex = declarations.indexOf(`${name}_Object:`);
  const hasObjectConstants = declarations[0] === "object_const_def";
  if (labelIndex < 0 || (!hasObjectConstants && (events.length !== 0 || labelIndex !== 0)) || (hasObjectConstants && (declarations.slice(1, labelIndex).some(line => !/^const_export [A-Z0-9_]+$/.test(line)) || labelIndex - 1 !== events.length))) {
    throw new Error("Object constants do not match the map's object slots.");
  }
  const pointerBody = block(script, `${name}_TextPointers`);
  if (pointerBody[0] !== "def_text_pointers") throw new Error("Unsupported map text pointer table.");
  const pointerRows = pointerBody[pointerBody.length - 1] === "text_end" ? pointerBody.slice(1, -1) : pointerBody.slice(1);
  const pointers = pointerRows.map(line => {
    const match = line.match(/^dw_const\s+([A-Za-z_][A-Za-z0-9_]*)\s*,\s*(TEXT_[A-Z0-9_]+)$/);
    if (!match) throw new Error("Text pointer table contains unsupported directives.");
    return { label: match[1], constant: match[2] };
  });
  if (new Set(pointers.map(pointer => pointer.constant)).size !== pointers.length || pointers.length < events.length) throw new Error("Text pointer IDs cannot be safely extended.");
  for (const event of events) {
    const id = pointers.findIndex(pointer => pointer.constant === event[5]) + 1;
    if (!id || id > events.length) throw new Error("Existing object text ID is outside the object text range.");
  }
  const signs = objectBody.filter(line => /^bg_event\s+/.test(line));
  for (const sign of signs) {
    const fields = sign.split(",");
    const constant = fields[fields.length - 1]?.trim();
    if (!constant || pointers.findIndex(pointer => pointer.constant === constant) < events.length) throw new Error("Existing sign text IDs cannot be safely extended.");
  }
  // Sign IDs move upward when a new object occupies the old object/sign
  // boundary. Literal text dispatches cannot follow those symbolic changes.
  if (pointers.length > events.length && /\bld\s+a,\s*(?:\$[\da-f]+|\d+)\s*(?:;[^\n]*)?\r?\n\s*(?:ldh?[^\n]*\r?\n\s*)?call\s+DisplayTextID\b/i.test(script + "\n" + (byPath.get(`scripts/${name}_2.asm`) ?? ""))) {
    throw new Error("This map dispatches numeric text IDs; review those calls before adding an NPC.");
  }
  const constants = new Map(projectConstantCatalogFromSources(files.filter(file => file.path.startsWith("constants/"))).constants.map(entry => [entry.symbol, entry.value]));
  const number = (key: string) => {
    const value = constants.get(key);
    if (value === undefined || !Number.isInteger(value)) throw new Error(`Could not derive ${key} from project constants.`);
    return value;
  };
  const follower = constants.get("PIKACHU_SPRITE_INDEX");
  const maxObjects = Math.min(number("MAX_OBJECT_EVENTS"), number("NUM_SPRITESTATEDATA_STRUCTS") - 1, follower === undefined ? Infinity : follower - 1);
  if (events.length >= maxObjects) throw new Error(`This map already uses all ${maxObjects} available object slots.`);
  if (pointers.length + 1 >= number("TRAINER")) throw new Error("This map has no free ordinary text IDs.");
  const fullSprites = [...read("data/sprites/sprites.asm").matchAll(/^\s*overworld_sprite\s+\w+,\s*12\s*;\s*(SPRITE_\w+)\s*$/gm)].map(match => match[1]).filter(value => constants.has(value) && !value.includes("UNUSED"));
  if (!fullSprites.length) throw new Error("Could not derive animated sprite graphics.");
  const sets = read("data/maps/sprite_sets.asm");
  const outdoor = table(sets, "MapSpriteSets");
  const indoorBoundary = read("constants/map_constants.asm").split(/DEF FIRST_INDOOR_MAP EQU const_value/)[0].match(/^\s*map_const\s+/gm)?.length;
  if (indoorBoundary !== outdoor.length || outdoor.some(row => row.length !== 1)) throw new Error("Could not derive the outdoor map sprite table.");
  let sprites: string[];
  let spriteNote: string;
  if (map.id < outdoor.length) {
    const setRows = table(sets, "SpriteSets").flat();
    const size = number("SPRITE_SET_LENGTH");
    const ids = outdoor[map.id];
    let names = ids;
    if (ids[0].startsWith("SPLITSET_")) {
      const firstSplit = Math.min(...[...constants].filter(([key]) => key.startsWith("SPLITSET_")).map(([, value]) => value));
      const split = table(sets, "SplitMapSpriteSets")[number(ids[0]) - firstSplit];
      if (!split || split.length !== 4) throw new Error("Could not derive this map's split sprite sets.");
      names = split.slice(2);
    }
    const choices = names.map(set => {
      const start = (number(set) - 1) * size;
      if (start < 0 || start + size > setRows.length) throw new Error("Invalid shared sprite set index.");
      return setRows.slice(start, start + size);
    });
    sprites = fullSprites.filter(sprite => choices.every(set => set.includes(sprite)));
    spriteNote = names.length > 1 ? "Sprites compatible with both areas of this outdoor map." : "Sprites already available in this outdoor map's shared set.";
  } else {
    const engine = read("engine/overworld/map_sprites.asm");
    const used = new Set(events.map(event => event[2]).filter(value => fullSprites.includes(value)));
    let capacity: number;
    if (follower !== undefined) {
      const match = engine.match(/ld de, wSpriteSet\s*\r?\n\s*ld b, (\d+)\s*\r?\n\s*call CheckIfPictureIDAlreadyLoaded/);
      if (!match || !/ld a, SPRITE_PIKACHU[^\n]*\n\s*ld \[wSpriteSet\], a/.test(engine)) throw new Error("Unknown indoor sprite loading limits.");
      capacity = Number(match[1]);
      used.add("SPRITE_PIKACHU");
    } else {
      const match = engine.match(/\.findNextVRAMSlotLoop[\s\S]*?cp (\d+)\s*;/);
      if (!match) throw new Error("Unknown indoor sprite loading limits.");
      capacity = Number(match[1]) - 2; // Player slot 1, NPC slots 2 through threshold - 1.
    }
    if (events.some(event => !constants.has(event[2]))) throw new Error("Unknown existing sprite IDs prevent a graphics budget check.");
    sprites = fullSprites.filter(sprite => used.has(sprite) || used.size < capacity);
    spriteNote = "Choices respect this indoor map's remaining sprite graphics slots.";
  }
  if (!sprites.length) throw new Error("This map has no compatible animated sprites available.");
  const dialogueOptions: MapNpcCreateDocument["dialogueOptions"] = [];
  // Reuse plain, context-free dialogue data, never the stateful wrapper that
  // originally selected it. Local labels and RAM-dependent text are excluded.
  const textPath = `text/${name}.asm`;
  const reusablePaths = [scriptPath, textPath].filter(path => byPath.has(path));
  for (const path of reusablePaths) {
    const contents = read(path);
    for (const match of contents.matchAll(/^([A-Za-z_][A-Za-z0-9_]*):{1,2}\s*(?:;[^\n]*)?$/gm)) {
      const label = match[1];
      const body = block(contents, label);
      if (!body.length || !/^(done|prompt)$/.test(body[body.length - 1]) || body.slice(0, -1).some(line => !/^(text|line|cont|para) "[^"\\@<>]*"$/.test(line))) continue;
      const doc = await parseTextDocument(path, label, contents);
      if (doc.editable && doc.segments.length && doc.segments[0].control === "text") {
        dialogueOptions.push({ id: `${path}:${label}`, path, label, preview: doc.segments.map(segment => segment.text).join("\n") });
      }
    }
  }
  const dependencies = files.filter(file => file.path.startsWith("constants/") || file.path.startsWith("macros/") || ["data/maps/map_header_pointers.asm", "data/maps/sprite_sets.asm", "data/sprites/sprites.asm", "engine/overworld/map_sprites.asm", map.headerPath, objectPath, scriptPath, `scripts/${name}_2.asm`, ...reusablePaths].includes(file.path));
  const document: MapNpcCreateDocument = {
    mapConstant, mapName: map.displayName, width: map.width * 2, height: map.height * 2,
    objectId: events.length + 1, maxObjects, sprites, spriteNote, dialogueOptions,
    occupied: objectBody.filter(line => /^(object_event|warp_event)\s+/.test(line)).map(line => {
      const xy = line.replace(/^\w+\s+/, "").split(",");
      return { x: Number(xy[0]), y: Number(xy[1]) };
    }),
    sources: await Promise.all(dependencies.map(async file => ({ path: file.path, hash: await hashText(file.contents) }))),
  };
  return { document, files, read, name, objectPath, scriptPath, objects, script, pointers, events, hasObjectConstants };
}

export async function loadMapNpcCreateDocument(source: ProjectSource, mapConstant: string): Promise<MapNpcCreateDocument> {
  return (await load(source, mapConstant)).document;
}

export function npcDialogueSegments(dialogueLines: string[]): TextSegment[] {
  return dialogueLines.map((text, i) => ({ control: i === 0 ? "text" : i === 1 ? "line" : "cont", text }));
}

export async function prepareMapNpcWrites(source: ProjectSource, document: MapNpcCreateDocument, values: MapNpcCreateValues): Promise<TextWriteRequest[]> {
  const state = await load(source, document.mapConstant);
  const current = state.document;
  if (JSON.stringify(current.sources) !== JSON.stringify(document.sources)) throw new Error("NPC sources changed while the form was open. Reopen Add NPC before saving.");
  if (!Number.isInteger(values.x) || !Number.isInteger(values.y) || values.x < 0 || values.y < 0 || values.x >= Math.min(current.width, 252) || values.y >= Math.min(current.height, 252)) throw new Error("Choose a whole-number position inside this map.");
  if (current.occupied.some(point => point.x === values.x && point.y === values.y)) throw new Error("This position already contains an object or warp.");
  if (!current.sprites.includes(values.sprite)) throw new Error("Choose a sprite compatible with this map.");
  const directions = values.movement === "STAY" ? ["DOWN", "UP", "LEFT", "RIGHT"] : values.movement === "WALK" ? ["ANY_DIR", "UP_DOWN", "LEFT_RIGHT"] : [];
  if (!directions.includes(values.direction)) throw new Error("Choose a supported facing or wandering direction.");
  let suffix = current.objectId;
  let objectConstant: string, textConstant: string, label: string;
  do {
    objectConstant = `${current.mapConstant}_EDITOR_NPC_${suffix}`;
    textConstant = `TEXT_${objectConstant}`;
    label = `${state.name}EditorNpc${suffix}Text`;
    suffix++;
  } while (state.files.some(file => [objectConstant, textConstant, label].some(value => new RegExp(`\\b${value}\\b`).test(file.contents))));
  let generated: string;
  if (values.dialogue?.kind === "new") {
    const input = values.dialogue.lines;
    if (!Array.isArray(input) || input.length < 1 || input.length > 16 || input.some(value => typeof value !== "string" || /[\r\n@<>\\"]/u.test(value)) || !input.some(value => value.trim())) throw new Error("Enter 1–16 dialogue lines without text control tokens.");
    // Limit new text to visible characters mapped by this project, so saving
    // cannot introduce assembler errors or embedded control codes.
    const charmap = state.files.find(file => file.path.endsWith("charmap.asm"))?.contents;
    if (!charmap) throw new Error("Project character map is unavailable.");
    const characters = new Set([...charmap.matchAll(/^\s*charmap "([^"\\])",\s*\$([\da-f]{2})\b/gmi)]
      .filter(match => Number.parseInt(match[2], 16) >= 0x60 || match[1] === "#" && match[2] === "54").map(match => match[1]));
    if (input.some(value => [...value].some(char => !characters.has(char)))) throw new Error("Dialogue contains a character unavailable in this project's font.");
    const segments = npcDialogueSegments(input);
    const template = `${label}:\n${segments.map(segment => `\t${segment.control} ""`).join("\n")}\n\tdone\n`;
    generated = applyTextDocumentEdits(template, label, segments);
    const reparsed = await parseTextDocument(state.scriptPath, label, generated);
    if (!reparsed.editable || JSON.stringify(reparsed.segments) !== JSON.stringify(segments)) throw new Error("Generated dialogue did not reparse correctly.");
  } else if (values.dialogue?.kind === "existing") {
    const id = values.dialogue.id;
    const option = current.dialogueOptions.find(entry => entry.id === id);
    if (!option || !symbol.test(option.label)) throw new Error("Choose compatible plain dialogue from this map.");
    generated = `${label}:\n\ttext_far ${option.label}\n\ttext_end\n`;
  } else throw new Error("Choose new or existing dialogue.");
  const objectLines = lines(state.objects);
  const constInsertion = objectLines.findIndex(line => clean(line) === `${state.name}_Object:`);
  const eventInsertion = objectLines.findIndex(line => clean(line) === `def_warps_to ${current.mapConstant}`);
  let objectContents = insert(state.objects, eventInsertion, [`\tobject_event ${values.x}, ${values.y}, ${values.sprite}, ${values.movement}, ${values.direction}, ${textConstant}`]);
  objectContents = insert(objectContents, constInsertion, [...(state.hasObjectConstants ? [] : ["\tobject_const_def"]), `\tconst_export ${objectConstant}`]);
  const scriptLines = lines(state.script);
  const pointerStart = scriptLines.findIndex(line => clean(line) === `${state.name}_TextPointers:`);
  const pointerIndices = scriptLines.flatMap((line, i) => i > pointerStart && /^dw_const\s+/.test(clean(line)) ? [i] : []).slice(0, state.pointers.length);
  const boundary = pointerIndices[state.events.length] ?? ((pointerIndices[pointerIndices.length - 1] ?? scriptLines.findIndex((line, i) => i > pointerStart && clean(line) === "def_text_pointers")) + 1);
  let scriptContents = insert(state.script, boundary, [`\tdw_const ${label}, ${textConstant}`]);
  const newline = state.script.includes("\r\n") ? "\r\n" : "\n";
  scriptContents += (scriptContents.endsWith("\n") ? newline : newline + newline) + generated.replace(/\n/g, newline);
  return [
    { path: state.objectPath, contents: objectContents, expectedHash: await hashText(state.objects) },
    { path: state.scriptPath, contents: scriptContents, expectedHash: await hashText(state.script) },
  ];
}
