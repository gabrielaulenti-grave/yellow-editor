import { hashText } from "./history";
import { projectConstantCatalogFromSources, readProjectRgbdsSources, type ProjectRgbdsSourceFile } from "./projectConstants";
import type { HistoryEntry, ProjectSource, TextWriteRequest } from "./types";

export interface CreationStamp { path: string; hash: string }
export const code = (line: string) => line.split(";", 1)[0].trim();
export const newline = (text: string) => text.includes("\r\n") ? "\r\n" : "\n";
export function append(text: string, block: string) { const nl = newline(text); return text + (text.endsWith(nl) ? "" : nl) + nl + block.replace(/\r?\n/g, nl) + nl; }
export function before(text: string, pattern: RegExp, block: string) {
  const matches = [...text.matchAll(new RegExp(pattern.source, "gm"))];
  if (matches.length !== 1) throw new Error("A required creation table boundary is missing or ambiguous.");
  const at = matches[0].index!; return text.slice(0, at) + block.replace(/\r?\n/g, newline(text)) + newline(text) + text.slice(at);
}
export function rows(text: string, label: string, directive: string): string[] {
  const lines = text.split(/\r?\n/), at = lines.findIndex(line => new RegExp(`^${label}::{0,1}$`).test(code(line)));
  if (at < 0) throw new Error(`Missing ${label}.`);
  const result: string[] = [];
  for (const raw of lines.slice(at + 1)) { const line = code(raw); if (/^assert_(?:table|list)_length\b/.test(line)) break; if (!line || /^(?:table_width|list_start)\b/.test(line)) continue; if (!line.startsWith(directive + " ") && !line.startsWith(directive + "\t")) throw new Error(`Unsupported ${label} table structure.`); result.push(raw); }
  return result;
}
export async function creationSnapshot(source: ProjectSource, paths: string[]) {
  const files = await readProjectRgbdsSources(source);
  if (files.some(file => file.readError)) throw new Error("All assembly sources must be readable before allocating content identifiers.");
  const text = new Map(files.map(file => [file.path, file.contents]));
  for (const path of paths) if (!text.has(path)) text.set(path, await source.readText(path));
  const stamps = await Promise.all([...new Set(paths)].map(async path => ({ path, hash: await hashText(text.get(path)!) })));
  const symbols = new Map(projectConstantCatalogFromSources(files, { resolveConstCounters: true }).constants.map(constant => [constant.symbol, constant.value]));
  return { files, text, stamps, symbols };
}
export function checkStamps(previous: CreationStamp[], current: CreationStamp[]) {
  if (previous.length !== current.length || current.some(stamp => previous.find(old => old.path === stamp.path)?.hash !== stamp.hash)) throw new Error("Creation sources changed outside this form. Reload the form before creating content.");
}
export function identifier(value: string, files: ProjectRgbdsSourceFile[]) {
  if (!/^[A-Z][A-Z0-9_]{0,47}$/.test(value)) throw new Error("Use a constant of at most 48 uppercase letters, digits and underscores, starting with a letter.");
  if (files.some(file => new RegExp(`\\b${value}\\b`).test(file.contents))) throw new Error(`Symbol ${value} already occurs in the project.`);
}
export function gameText(value: string, max: number, field: string) {
  if (!value.trim() || value.length > max || !/^[A-Za-z0-9 .,'!?♂♀é-]+$/.test(value)) throw new Error(`${field} must contain 1–${max} supported game-text characters.`);
}
/** Correct the original name-list bug only when the reviewed source shape is present. */
export function extendNames(text: string) {
  if (text.includes("; yellow-editor typed name lookup")) return text;
  const pattern = /^[ \t]*; TM names are separate from item names\.[\s\S]*?^[ \t]*cp HM01\r?\n[ \t]*jp nc, GetMachineName/m;
  if (!pattern.test(text) || !text.includes("ld [wNamedObjectIndex], a")) throw new Error("This project's name lookup needs review before content IDs can be extended.");
  return text.replace(pattern, ["; yellow-editor typed name lookup", "\tpush af", "\tld a, [wNameListType]", "\tcp ITEM_NAME", "\tjr nz, .editorNonItem", "\tpop af", "\tcp HM01", "\tjp nc, GetMachineName", "\tjr .editorNameReady", ".editorNonItem", "\tpop af", ".editorNameReady"].join(newline(text)));
}
/** Free growing ROMX sections from fixed packing; keep each bank-relative group together. */
export function freeSections(layout: string, files: ProjectRgbdsSourceFile[], targets: string[]) {
  const byPath = new Map(files.map(file => [file.path, file.contents])), owners = new Map<string, Set<string>>();
  function visit(path: string, section: string | null, stack: string[]): string | null {
    if (stack.includes(path)) return section;
    const text = byPath.get(path); if (text === undefined) return section;
    if (section) { if (!owners.has(path)) owners.set(path, new Set()); owners.get(path)!.add(section); }
    for (const raw of text.split(/\r?\n/)) {
      const line = code(raw), declaration = line.match(/^SECTION\s+"([^"]+)"\s*,\s*ROMX\s*$/);
      if (declaration) section = declaration[1];
      else if (/^SECTION\b/.test(line)) section = null;
      const include = line.match(/^INCLUDE\s+"([^"]+)"$/);
      if (include) section = visit(include[1], section, [...stack, path]);
    }
    return section;
  }
  for (const root of ["main.asm", "text.asm", "home.asm", "gfx/pics.asm"]) visit(root, null, []);
  const names = new Set<string>();
  for (const target of targets) { const found = owners.get(target); if (!found || found.size !== 1) throw new Error(`Cannot determine a single relocatable ROM section for ${target}.`); names.add([...found][0]); }
  return layout.split(/\r?\n/).filter(line => !names.has(line.trim().replace(/^"(.*)"$/, "$1"))).join(newline(layout));
}
export function creationWrites(text: Map<string, string>, stamps: CreationStamp[], updates: Map<string, string>): TextWriteRequest[] {
  return [...updates].filter(([path, contents]) => contents !== text.get(path)).map(([path, contents]) => ({ path, contents, expectedHash: stamps.find(stamp => stamp.path === path)?.hash }));
}

export async function checkCreatedSymbolReferences(source: ProjectSource, entry: HistoryEntry) {
  const created = entry.label.match(/^Add (move|Pokémon) ([A-Z][A-Z0-9_]*)$/);
  if (!created) return;
  const names = created[1] === "Pokémon" ? [created[2], `DEX_${created[2]}`] : [created[2]];
  const files = await readProjectRgbdsSources(source);
  if (files.some(file => file.readError)) throw new Error("Cannot check new-content references while some assembly sources are unreadable.");
  for (const file of files) {
    const after = entry.files.find(change => change.path === file.path)?.after ?? "";
    for (const name of names) {
      const references = (text: string) => text.split(/\r?\n/).map(code).join("\n").match(new RegExp(`\\b${name}\\b`, "g"))?.length ?? 0;
      if (references(file.contents) > references(after)) throw new Error(`Cannot undo creation of ${created[2]} while later content references it in ${file.path}. Remove those references or undo their changes first.`);
    }
  }
}
