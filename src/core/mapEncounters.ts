import { hashText } from "./history";
import { parseMapIndex } from "./mapVisualization";
import { loadEncounterTableEditDocument, parseEncounterIndex } from "./encounterEditing";
import { readProjectRgbdsSources } from "./projectConstants";
import { mapSourceName } from "./mapCreation";
import type { EncounterTableIndexEntry, MapSourceSnapshot, ProjectSource, TextWriteRequest } from "./types";

export interface MapEncounterDocument {
  mapConstant: string; mapName: string; currentLabel: string;
  tables: EncounterTableIndexEntry[]; sources: MapSourceSnapshot[];
}
export interface MapEncounterValues { mode: "blank" | "copy" | "share" | "none"; tablePath: string }
const indexPath = "data/wild/grass_water.asm";
const clean = (s: string) => s.split(";")[0].trim();
async function state(source: ProjectSource, mapConstant: string) {
  const maps = await parseMapIndex(source), map = maps.find(m => m.constant === mapConstant);
  if (!map || map.isUnused || map.isAlias || !map.headerPath) throw new Error("Choose a map with its own header.");
  const text = await source.readText(indexPath), lines = text.split(/\r?\n/);
  const start = lines.findIndex(l => clean(l) === "WildDataPointers:");
  const end = lines.findIndex((l, i) => i > start && clean(l) === "assert_table_length NUM_MAPS");
  if (start < 0 || end < 0) throw new Error("Cannot identify the native WildDataPointers table.");
  const rows: Array<{ line: number; label: string }> = [];
  for (let i = start + 1; i < end; i++) {
    const code = clean(lines[i]); if (!code || /^table_width\b/.test(code)) continue;
    const match = code.match(/^dw\s+([A-Za-z_]\w*WildMons)$/);
    if (!match) throw new Error("Wild encounter pointers contain unsupported expressions or conditional entries.");
    rows.push({ line: i, label: match[1] });
  }
  if (rows.length !== maps.length) throw new Error("Wild encounter pointers do not match the map ID table.");
  return { map, text, lines, row: rows[map.id] };
}
export async function loadMapEncounterDocument(source: ProjectSource, projectName: string, mapConstant: string): Promise<MapEncounterDocument> {
  const s = await state(source, mapConstant), tables = await parseEncounterIndex(source, projectName);
  const paths = [indexPath, "constants/map_constants.asm", "data/maps/map_header_pointers.asm", s.map.headerPath!, ...tables.map(t => t.path)];
  return { mapConstant, mapName: s.map.displayName, currentLabel: s.row.label, tables,
    sources: await Promise.all([...new Set(paths)].map(async path => ({ path, hash: await hashText(await source.readText(path)) }))) };
}
export async function prepareMapEncounterWrites(source: ProjectSource, projectName: string, document: MapEncounterDocument, values: MapEncounterValues): Promise<TextWriteRequest[]> {
  const fresh = await loadMapEncounterDocument(source, projectName, document.mapConstant);
  if (JSON.stringify(fresh.sources) !== JSON.stringify(document.sources)) throw new Error("Encounter sources changed. Reopen Assign encounters before saving.");
  if (!["blank", "copy", "share", "none"].includes(values.mode)) throw new Error("Choose how to assign encounters.");
  const s = await state(source, document.mapConstant), writes: TextWriteRequest[] = [];
  let label = "NothingWildMons", added = "";
  if (values.mode === "share" || values.mode === "copy") {
    const table = fresh.tables.find(t => t.path === values.tablePath);
    if (!table || table.error) throw new Error("Choose a supported encounter table.");
    await loadEncounterTableEditDocument(source, projectName, table.path);
    label = table.tableLabel;
    if (values.mode === "copy") added = await source.readText(table.path);
  }
  if (values.mode === "blank" || values.mode === "copy") {
    if (!source.createFile || !source.removeFile) throw new Error("This project does not support undoable file creation.");
    // Copy only the reviewed data grammar, never extra labels or executable code.
    if (added && added.split(/\r?\n/).map(clean).filter(Boolean).some(l => l !== `${label}:` && !/^(?:def_(?:grass|water)_wildmons\s+\d+|end_(?:grass|water)_wildmons|db\s+\d+\s*,\s*[A-Za-z_]\w*|IF\s+DEF\(_(?:RED|BLUE|YELLOW)\)|ENDC)$/.test(l))) throw new Error("This table contains additional source directives and cannot be copied safely. Assign it as a shared table instead.");
    const files = await readProjectRgbdsSources(source);
    if (files.some(f => f.readError)) throw new Error("Could not check encounter symbol collisions.");
    let suffix = 1, path: string, next: string;
    do { next = `${mapSourceName(s.map.constant)}Editor${suffix++}WildMons`; path = `data/wild/maps/${next.replace(/WildMons$/, "")}.asm`; }
    while (await source.exists(path) || files.some(f => new RegExp(`\\b${next}\\b`).test(f.contents)));
    const nl = s.text.includes("\r\n") ? "\r\n" : "\n";
    const contents = (added ? added.replace(new RegExp(`^\\s*${label}:`, "m"), `${next}:`) : `${next}:\n\tdef_grass_wildmons 0\n\tend_grass_wildmons\n\n\tdef_water_wildmons 0\n\tend_water_wildmons\n`).replace(/\r?\n/g, nl);
    label = next;
    writes.push({ path, operation: "create", contents });
    s.lines.push(`INCLUDE "${path}"`);
  }
  s.lines[s.row.line] = s.lines[s.row.line].replace(/^(\s*dw\s+)\w+/, `$1${label}`);
  const contents = s.lines.join(s.text.includes("\r\n") ? "\r\n" : "\n");
  if (contents !== s.text) writes.unshift({ path: indexPath, contents, expectedHash: await hashText(s.text) });
  return writes;
}
