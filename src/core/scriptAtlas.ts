import { hashText } from "./history";
import { readProjectRgbdsSources, type ProjectRgbdsSourceFile } from "./projectConstants";
import { loadMacroAnalysis } from "./macroCatalog";
import { loadProjectSemanticDomains } from "./semanticDomains";
import { loadProjectMovementVocabulary } from "./movementVocabulary";
import { deriveProjectEventMacroSemantics } from "./eventMacroSemantics";
import { buildScriptAudit } from "./scriptAudit";
import { loadScriptCatalog } from "./scriptCatalog";
import { parseMapScriptProgram } from "./mapScriptProgram";
import type { MapScriptSemanticNode } from "./mapScriptProgram";
import type { ProjectSource, ScriptAuditReport, ScriptRoutineCategory } from "./types";

export interface AtlasLocation { path: string; label: string; line: number }
export interface AtlasReference {
  path: string; line: number; owner: string | null;
  kind: "call" | "jump" | "farcall" | "farjump" | "predef" | "return" | "indirect" | "pointer" | "text" | "fallthrough";
  target: string | null; condition: string | null; expression: string;
  resolution: "resolved" | "missing" | "ambiguous" | "runtime";
  definitions: AtlasLocation[];
}
export interface AtlasRoutine extends AtlasLocation {
  category: ScriptRoutineCategory; scriptConstant: string | null;
  operations: MapScriptSemanticNode[];
  references: AtlasReference[];
  stateTransitions: Array<{ constant: string; target: string | null; line: number }>;
  localLabels: AtlasLocation[];
}
export interface AtlasTrigger {
  path: string; line: number; kind: "object" | "sign" | "warp";
  arguments: string[]; textConstant: string | null; targets: AtlasLocation[];
}
export interface AtlasStateEntry {
  path: string; line: number; table: string | null;
  constant: string; label: string; declaredOrder: number; definitions: AtlasLocation[];
}
export interface AtlasMap {
  name: string; constant: string | null; paths: string[];
  routines: AtlasRoutine[]; triggers: AtlasTrigger[];
  stateEntries: AtlasStateEntry[];
  audit: { structuralInvocations: number; unresolvedInvocations: number; unboundSemanticInvocations: number };
}
export interface ScriptAtlas {
  schemaVersion: 1; revision: string; inputDigest: string;
  inputs: Array<{ path: string; hash: string }>;
  audit: ScriptAuditReport;
  maps: AtlasMap[];
  references: AtlasReference[];
  engineBoundaries: Array<{ label: string; definitions: AtlasLocation[]; callers: Array<{ path: string; line: number; owner: string | null }> }>;
  limitations: string[];
}

// Preserve semicolons inside quoted dialogue, filenames and character literals.
export function atlasCode(row: string): string {
  let quote: string | null = null, escaped = false;
  for (let i = 0; i < row.length; i++) {
    const c = row[i];
    if (escaped) { escaped = false; continue; }
    if (quote && c === "\\") { escaped = true; continue; }
    if (c === quote) quote = null;
    else if (!quote && (c === '"' || c === "'")) quote = c;
    if (c === ";" && !quote) return row.slice(0, i).trim();
  }
  return row.trim();
}
const globalLabel = /^([A-Za-z_][A-Za-z0-9_]*):{1,2}$/;
const localLabel = /^(\.[A-Za-z_][A-Za-z0-9_.]*):{0,2}$/;
const literal = /^[A-Za-z_.][A-Za-z0-9_.]*$/;
const qualify = (name: string, owner: string | null) => name.startsWith(".") && owner ? owner + name : name;

export function atlasLabelIndex(files: ProjectRgbdsSourceFile[]): Map<string, AtlasLocation[]> {
  const index = new Map<string, AtlasLocation[]>();
  for (const file of files) {
    let owner: string | null = null;
    file.contents.split(/\r?\n/).forEach((row, i) => {
      const code = atlasCode(row), global = code.match(globalLabel), local = code.match(localLabel);
      if (global) owner = global[1];
      if (!global && !local) return;
      const label = global?.[1] ?? qualify(local![1], owner);
      const definition = { path: file.path, label, line: i + 1 };
      index.set(label, [...index.get(label) ?? [], definition]);
    });
  }
  return index;
}

export function atlasReferences(file: ProjectRgbdsSourceFile, index: Map<string, AtlasLocation[]>): AtlasReference[] {
  const result: AtlasReference[] = [];
  let owner: string | null = null, previous: { line: number; code: string } | null = null;
  const add = (line: number, kind: AtlasReference["kind"], expression: string, condition: string | null = null) => {
    // Arithmetic and macro-generated labels remain explicit expressions. Do not
    // invent destinations for register jumps or unresolved computed pointers.
    const target = literal.test(expression) ? qualify(expression, owner) : null;
    const candidates = target ? index.get(target) ?? [] : [];
    const sameFile = candidates.filter(entry => entry.path === file.path);
    const definitions = sameFile.length ? sameFile : candidates;
    result.push({ path: file.path, line, owner, kind, target, condition, expression,
      resolution: kind === "return" || kind === "indirect" || !target ? "runtime" : definitions.length === 1 ? "resolved" : definitions.length ? "ambiguous" : "missing", definitions });
  };
  file.contents.split(/\r?\n/).forEach((row, i) => {
    const code = atlasCode(row);
    if (!code) return;
    const global = code.match(globalLabel);
    if (global) {
      // Physical adjacency is evidence of possible fall-through, not proof that
      // a data block executes. Keep it separate from calls and state transitions.
      if (owner && previous && !/^(?:ret|reti)\s*$|^(?:jp|jr|farjp|predef_jump)\s+(?!(?:z|nz|c|nc)\s*,)/i.test(previous.code)) add(previous.line, "fallthrough", global[1]);
      owner = global[1]; previous = null; return;
    }
    if (localLabel.test(code)) return;
    const branch = code.match(/^(call|jp|jr|farcall|callfar|farjp|predef|predef_jump)\s+(?:(z|nz|c|nc)\s*,\s*)?(.+)$/i);
    if (branch) {
      const operation = branch[1].toLowerCase(), target = branch[3].trim();
      const kind: AtlasReference["kind"] = /^(?:jp|jr)$/.test(operation) ? /^(?:hl|\[hl\])$/i.test(target) ? "indirect" : "jump" : operation === "call" ? "call" : /^(?:callfar|farcall)$/.test(operation) ? "farcall" : operation === "farjp" ? "farjump" : "predef";
      add(i + 1, kind, target, branch[2]?.toLowerCase() ?? null);
    } else if (/^(?:ret|reti)(?:\s+(?:z|nz|c|nc))?$/i.test(code)) {
      add(i + 1, "return", "stack", code.split(/\s+/)[1] ?? null);
    } else {
      const text = code.match(/^text_far\s+(.+)$/i);
      const pointer = code.match(/^(?:dw_const|dw|dba|dbw)\s+(.+)$/i);
      const register = code.match(/^ld\s+(?:hl|de),\s*(.+)$/i);
      const trainer = code.match(/^trainer\s+(.+)$/i);
      if (text) add(i + 1, "text", text[1]);
      if (pointer) {
        const values = pointer[1].split(",").map(value => value.trim());
        for (const value of /^dw_const/i.test(code) ? values.slice(0, 1) : values) if (literal.test(value) || /[{}+]/.test(value)) add(i + 1, "pointer", value);
      }
      if (register && (literal.test(register[1]) && (index.has(qualify(register[1], owner)) || register[1].startsWith(".")) || /^[A-Za-z_.][\w.]*\s*[+{}-]/.test(register[1]))) add(i + 1, "pointer", register[1]);
      if (trainer) for (const value of trainer[1].split(",").slice(2).map(value => value.trim())) if (literal.test(value)) add(i + 1, "text", value);
    }
    previous = { line: i + 1, code };
  });
  return result;
}

export function atlasStateEntries(file: ProjectRgbdsSourceFile, index: Map<string, AtlasLocation[]>): AtlasStateEntry[] {
  let table: string | null = null, declaredOrder = 0;
  const entries: AtlasStateEntry[] = [];
  file.contents.split(/\r?\n/).forEach((row, i) => {
    const code = atlasCode(row), global = code.match(globalLabel);
    if (global) { table = global[1]; declaredOrder = 0; }
    const match = code.match(/^dw_const\s+(\w+),\s*(SCRIPT_\w+)$/);
    if (!match) return;
    entries.push({ path: file.path, line: i + 1, table, label: match[1], constant: match[2], declaredOrder: declaredOrder++, definitions: index.get(match[1]) ?? [] });
  });
  return entries;
}

export async function buildScriptAtlas(source: ProjectSource, revision: string, projectName: string): Promise<ScriptAtlas> {
  const files = await readProjectRgbdsSources(source);
  const errors = files.filter(file => file.readError);
  if (errors.length) throw new Error(`Cannot inventory unreadable sources: ${errors.map(file => file.path).join(", ")}`);
  const [macros, movement, catalog] = await Promise.all([
    loadMacroAnalysis(source, loadProjectSemanticDomains(source, projectName), files),
    loadProjectMovementVocabulary(source, files), loadScriptCatalog(source),
  ]);
  const events = deriveProjectEventMacroSemantics(files);
  const audit = buildScriptAudit(files, macros, movement, events);
  const index = atlasLabelIndex(files), byPath = new Map(files.map(file => [file.path, file]));
  const references = files.filter(file => /^scripts\/.+\.asm$/.test(file.path)).flatMap(file => atlasReferences(file, index));
  const maps: AtlasMap[] = [];
  for (const group of catalog.entries) {
    const routines: AtlasRoutine[] = [];
    for (const summary of group.routines) {
      const file = byPath.get(summary.path)!;
      // Focus every global label, not just routines listed in state tables.
      const state = parseMapScriptProgram(file.contents, summary.label, movement, events).states.find(state => state.label === summary.label);
      if (!state || state.external) continue; // External table entries are covered by pointer references.
      const line = summary.startLine;
      const next = group.routines.filter(row => row.path === summary.path && row.startLine > line).sort((a, b) => a.startLine - b.startLine)[0]?.startLine ?? Infinity;
      routines.push({ path: summary.path, label: summary.label, line, category: summary.category,
        scriptConstant: state.scriptConstant, operations: state.nodes,
        references: references.filter(ref => ref.path === summary.path && ref.owner === summary.label),
        stateTransitions: state.transitions.map(t => ({ constant: t.targetConstant, target: t.targetLabel ?? null, line: t.source.lineStart })),
        localLabels: [...index.values()].flat().filter(location => location.path === summary.path && location.line > line && location.line < next && location.label.startsWith(summary.label + ".")),
      });
    }
    const primary = byPath.get(`scripts/${group.id}.asm`);
    const header = byPath.get(`data/maps/headers/${group.id}.asm`);
    const objects = byPath.get(`data/maps/objects/${group.id}.asm`);
    const textPointers = new Map<string, string[]>();
    for (const path of group.paths) for (const row of byPath.get(path)!.contents.split(/\r?\n/)) {
      const m = atlasCode(row).match(/^dw_const\s+(\w+),\s*(TEXT_\w+)$/);
      if (m) textPointers.set(m[2], [...textPointers.get(m[2]) ?? [], m[1]]);
    }
    const triggers: AtlasTrigger[] = [];
    objects?.contents.split(/\r?\n/).forEach((row, i) => {
      const m = atlasCode(row).match(/^(object_event|bg_event|warp_event)\s+(.+)$/);
      if (!m) return;
      const args = m[2].split(",").map(value => value.trim());
      const kind = m[1] === "object_event" ? "object" : m[1] === "bg_event" ? "sign" : "warp";
      const textConstant = kind === "object" ? args[5] ?? null : kind === "sign" ? args[2] ?? null : null;
      triggers.push({ path: objects.path, line: i + 1, kind, arguments: args, textConstant,
        targets: (textPointers.get(textConstant ?? "") ?? []).flatMap(label => index.get(label) ?? []),
      });
    });
    const counts = audit.files.filter(file => group.paths.includes(file.path));
    maps.push({ name: group.id, constant: header ? header.contents.split(/\r?\n/).map(atlasCode).map(row => row.match(/^map_header\s+\w+,\s*(\w+)/)?.[1]).find(Boolean) ?? null : null,
      paths: group.paths, routines, triggers, stateEntries: group.paths.flatMap(path => atlasStateEntries(byPath.get(path)!, index)),
      audit: { structuralInvocations: counts.reduce((n, f) => n + f.structuralInvocationCount, 0), unresolvedInvocations: counts.reduce((n, f) => n + f.unresolvedInvocationCount, 0), unboundSemanticInvocations: counts.reduce((n, f) => n + f.unboundSemanticInvocationCount, 0) },
    });
    if (!primary && !group.paths.length) throw new Error(`Empty script group ${group.id}.`);
  }
  const external = references.filter(ref => ["call", "jump", "farcall", "farjump", "predef"].includes(ref.kind) && ref.target && ref.definitions.some(d => !d.path.startsWith("scripts/")));
  const engineBoundaries = [...new Set(external.map(ref => ref.target!))].sort().map(label => ({ label,
    definitions: index.get(label) ?? [], callers: external.filter(ref => ref.target === label).map(ref => ({ path: ref.path, line: ref.line, owner: ref.owner })),
  }));
  const inputs = await Promise.all(files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0).map(async file => ({ path: file.path, hash: await hashText(file.contents) })));
  return { schemaVersion: 1, revision, inputDigest: await hashText(JSON.stringify(inputs)), inputs, audit, maps, references, engineBoundaries,
    limitations: [
      "Inventories source definitions and literal references, including conditional/unused code; it does not prove reachability in a compiled ROM.",
      "Local labels are scoped; duplicate global definitions remain ambiguous. Macro-generated and computed targets remain explicit runtime expressions.",
      "Physical fall-through is recorded as a possibility, including adjacency to data; it is not interpreted as an executable edge without a control-flow proof.",
      "Resolved engine helpers are named boundaries, not recursively proven implementations. Register, flag, input, bank, and return contracts still require review.",
      "Recognized semantic operations do not establish safe topology edits or arbitrary composition. Existing writer/ROM/CPU validation remains separate.",
    ],
  };
}
