import { evaluateRgbdsExpression, projectConstantCatalogFromSources, type ProjectRgbdsSourceFile } from "./projectConstants";

export interface ObjectSourceEvidence { path: string; line: number; detail: string }
export interface SourceTrainerHeader {
  label: string; path: string; line: number; event: string; sight: number | null;
  texts: string[]; evidence: ObjectSourceEvidence[];
}
export function resolveObjectExpression(expression: string, values: Map<string, number>, files: ProjectRgbdsSourceFile[], depth = 0): number | null {
  const direct = evaluateRgbdsExpression(expression, values);
  if (direct !== null || depth > 12) return direct;
  const expanded = expression.replace(/\b[A-Za-z_]\w*\b/g, name => {
    if (values.has(name)) return String(values.get(name));
    const definitions = new Set(files.flatMap(f => [...f.contents.matchAll(new RegExp(`^\\s*(?:DEF\\s+)?${name}\\s+EQU\\s+([^;\\r\\n]+)`, "gm"))].map(m => m[1].trim())));
    if (definitions.size !== 1) return name;
    const n = resolveObjectExpression([...definitions][0], values, files, depth + 1);
    return n === null ? name : `(${n})`;
  });
  return evaluateRgbdsExpression(expanded, values);
}
const sameSources = (a: ProjectRgbdsSourceFile[], b: ProjectRgbdsSourceFile[]) => a.length === b.length && a.every((f, i) => f.path === b[i].path && f.contents === b[i].contents && f.readError === b[i].readError);
const constantCache: Array<{ files: ProjectRgbdsSourceFile[]; values: Map<string, number> }> = [];
export function objectSourceConstants(files: ProjectRgbdsSourceFile[]) {
  const cached = constantCache.find(c => sameSources(c.files, files));
  if (cached) return new Map(cached.values);
  const values = new Map(projectConstantCatalogFromSources(files).constants.map(c => [c.symbol, c.value]));
  // trainer_const declares its opponent alias in the project's macro. Do not
  // assume a stock class order or a fixed opponent-ID offset.
  const macro = files.flatMap(f => [...f.contents.matchAll(/^MACRO\?? trainer_const\r?\n([\s\S]*?)^ENDM/gm)]).map(m => m[1]);
  const alias = macro.length === 1 && macro[0].match(/DEF\s+([A-Za-z_]\w*)\\1\s+EQU\s+([^\r\n;]+)/);
  if (alias) {
    const cls = files.find(f => f.path === "constants/trainer_constants.asm");
    let id = 0, step = 1;
    for (const raw of cls?.contents.split(/\r?\n/) ?? []) {
      const line = raw.split(";")[0].trim(), start = line.match(/^const_def(?:\s+([^,]+))?(?:,\s*(.+))?$/);
      if (start) { id = evaluateRgbdsExpression(start[1] ?? "0", values) ?? id; step = evaluateRgbdsExpression(start[2] ?? "1", values) ?? 1; }
      const adjustment = line.match(/^(const_next|const_skip)(?:\s+(.+))?$/);
      if (adjustment) { const n = evaluateRgbdsExpression(adjustment[2] ?? "1", values); if (n !== null) id = adjustment[1] === "const_next" ? n : id + n * step; }
      const entry = line.match(/^trainer_const\s+(\w+)/);
      if (entry) {
        values.set(entry[1], id);
        const value = evaluateRgbdsExpression(alias[2].replace(/\\1/g, String(id)), values);
        if (value !== null) { const name = alias[1] + entry[1]; values.set(name, value); values.set(`#opponent:${entry[1]}`, value); values.set(`#opponentAlias:${entry[1]}:${name}`, value); }
        id += step;
      }
    }
    // Aliases may refer to a trainer_const-generated opponent value.
    for (let pass = 0; pass < 8; pass++) {
      let progress = false;
      for (const f of files) for (const m of f.contents.matchAll(/^\s*(?:DEF\s+)?(\w+)\s+EQU\s+([^;\r\n]+)/gm)) {
        if (values.has(m[1])) continue;
        const n = evaluateRgbdsExpression(m[2], values); if (n !== null) { values.set(m[1], n); progress = true; }
      }
      if (!progress) break;
    }
  }
  constantCache.unshift({ files: files.map(f => ({ ...f })), values }); constantCache.splice(3);
  return new Map(values);
}

interface Statement { path: string; line: number; scope: string; code: string }
function buildTrainerSourceIndex(files: ProjectRgbdsSourceFile[], constants: Map<string, number>) {
  const macros = files.flatMap(f => [...f.contents.matchAll(/^MACRO\??\s+trainer\r?\n([\s\S]*?)^ENDM/gm)]).map(m => m[1]);
  let compatibleHeader = macros.length === 1;
  if (compatibleHeader) for (const range of [2, 5]) {
    const counter = macros[0].match(/^\s*db\s+([A-Za-z_]\w*)\s*(?:;[^\r\n]*)?$/m)?.[1];
    const pointer = macros[0].match(/^\s*dw\s+([^\r\n]+)/m)?.[1] ?? "";
    const bases = [...new Set(pointer.match(/\b[A-Za-z_]\w*\b/g) ?? [])].filter(n => n !== counter && n !== "_ev_bit" && n !== "_cur_bit");
    const symbols = new Map(constants); if (counter) symbols.set(counter, 1); if (bases.length === 1) symbols.set(bases[0], 1024); symbols.set("_ev_bit", 1); symbols.set("_cur_bit", 1);
    const args = [257, range, 4096, 8192, 12288];
    const emissions = macros[0].split(/\r?\n/).map(l => l.split(";")[0].trim()).flatMap(line => {
      const m = line.match(/^(db|dw)\s+(.+)$/); if (!m) return [];
      return m[2].split(",").map(operand => `${m[1]}:${evaluateRgbdsExpression(operand.replace(/\\([1-5])/g, (_, n) => String(args[+n - 1])), symbols)}`);
    });
    compatibleHeader &&= JSON.stringify(emissions) === JSON.stringify(["db:1", `db:${range * 16}`, "dw:1056", "dw:4096", "dw:12288", "dw:8192", "dw:8192"]);
  }
  if (!compatibleHeader) return (): { headers: SourceTrainerHeader[]; notes: string[] } => ({ headers: [], notes: ["The trainer macro emits an unfamiliar header layout. Header-specific fields need a layout adapter; object-record fields remain independent."] });
  const labels = new Map<string, Array<{ at: number; path: string }>>(), statements: Statement[] = [];
  const nextInFile = new Map<number, number>();
  for (const file of files) {
    let scope = "", previous: number | null = null, macro = 0;
    for (const [line, raw] of file.contents.split(/\r?\n/).entries()) {
      let code = raw.split(";")[0].trim();
      if (/^MACRO\??\b/.test(code)) macro++;
      if (macro) { if (code === "ENDM") macro--; continue; }
      const label = code.match(/^([A-Za-z_]\w*|\.\w+):{0,2}(?:\s*$|\s+(?=trainer\s))/);
      if (label && (code.includes(":") || label[1].startsWith("."))) {
        if (!label[1].startsWith(".")) scope = label[1];
        const name = label[1].startsWith(".") ? scope + label[1] : label[1];
        labels.set(name, [...(labels.get(name) ?? []), { at: statements.length, path: file.path }]);
        code = code.slice(label[0].length).trim();
      }
      if (!code) continue;
      const at = statements.length;
      statements.push({ path: file.path, line, scope, code });
      if (previous !== null) nextInFile.set(previous, at);
      previous = at;
    }
  }
  const resolve = (label: string, path: string, scope: string) => {
    const choices = (labels.get(label.startsWith(".") ? scope + label : label) ?? []).filter(d => statements[d.at]?.path === d.path);
    const local = choices.filter(d => d.path === path);
    return local.length === 1 ? local[0].at : choices.length === 1 ? choices[0].at : null;
  };
  const candidates = new Map<number, SourceTrainerHeader>(), edges = new Map<number, number[]>(), reverse = new Map<number, number[]>(), unresolved = new Set<number>();
  for (const [at, s] of statements.entries()) {
    const load = s.code.match(/^ld\s+(?:hl|de),\s*([.\w]+)$/i);
    if (load) {
      const target = resolve(load[1], s.path, s.scope), row = target === null ? null : statements[target];
      const fields = row?.code.match(/^trainer\s+([^,]+),\s*([^,]+),\s*([.\w]+),\s*([.\w]+),\s*([.\w]+)$/);
      if (row && fields) candidates.set(at, { label: load[1], path: row.path, line: row.line, event: fields[1].trim(), sight: evaluateRgbdsExpression(fields[2], constants), texts: fields.slice(3).map(label => label.startsWith(".") ? row.scope + label : label), evidence: [{ path: s.path, line: s.line + 1, detail: `References trainer header ${load[1]}.` }, { path: row.path, line: row.line + 1, detail: "Declares the existing defeat flag, sight range and three dialogue links." }] });
    }
    const successors: number[] = [], edge = s.code.match(/^(call|jp|jr|farcall|farjp|callfar|predef|predef_jump)\s+(?:(nz|z|nc|c),\s*)?([.\w]+)$/i);
    if (edge) { const target = resolve(edge[3], s.path, s.scope); if (target !== null) successors.push(target); else unresolved.add(at); }
    if (!/^(?:ret|reti)$|^(?:text_end|done|prompt)\b/i.test(s.code) && !(edge && /^(?:jp|jr|farjp|predef_jump)$/i.test(edge[1]) && !edge[2])) {
      const next = nextInFile.get(at); if (next !== undefined) successors.push(next);
    }
    edges.set(at, successors);
    for (const next of successors) reverse.set(next, [...(reverse.get(next) ?? []), at]);
  }
  // Slice the graph backwards from actual header references. Rendering, audio
  // and unrelated engine calls cannot add headers and need not be explored.
  const relevant = new Set(candidates.keys()), pending = [...relevant];
  while (pending.length) for (const previous of reverse.get(pending.pop()!) ?? []) if (!relevant.has(previous)) { relevant.add(previous); pending.push(previous); }
  return (entryPath: string, entryLabel: string): { headers: SourceTrainerHeader[]; notes: string[] } => {
  const headers = new Map<string, SourceTrainerHeader>(), notes: string[] = [], seen = new Set<number>();
  const start = resolve(entryLabel, entryPath, "");
  if (start === null) return { headers: [], notes: ["The object's script entry is missing or ambiguous."] };
  const beforeHeader = [start], covered = new Set<number>();
  while (beforeHeader.length && covered.size < 4096) {
    const at = beforeHeader.pop()!; if (covered.has(at)) continue; covered.add(at);
    if (candidates.has(at)) continue;
    if (unresolved.has(at)) { notes.push("An unresolved control path can run before a trainer header is selected; the binding is not assumed to be unique."); break; }
    beforeHeader.push(...(edges.get(at) ?? []));
  }
  if (beforeHeader.length && covered.size >= 4096) notes.push("Script analysis reached its limit before the header binding could be verified.");
  const queue = [start];
  while (queue.length && seen.size < 4096) {
    const at = queue.pop()!; if (seen.has(at) || !relevant.has(at)) continue; seen.add(at);
    const header = candidates.get(at); if (header) headers.set(`${header.path}:${header.line}`, header);
    queue.push(...(edges.get(at) ?? []).filter(n => relevant.has(n)));
  }
  if (queue.length) notes.push("Script analysis reached its limit; unresolved paths remain available in map logic.");
  if (headers.size > 1) notes.push("The script references several trainer headers. Sight and role-specific dialogue need a more specific binding.");
  return { headers: [...headers.values()], notes };
  };
}
const trainerCache: Array<{ files: ProjectRgbdsSourceFile[]; query: ReturnType<typeof buildTrainerSourceIndex> }> = [];
export function sourceTrainerHeaders(files: ProjectRgbdsSourceFile[], entryPath: string, entryLabel: string, constants: Map<string, number>) {
  let cached = trainerCache.find(c => sameSources(c.files, files));
  if (!cached) { cached = { files: files.map(f => ({ ...f })), query: buildTrainerSourceIndex(files, constants) }; trainerCache.unshift(cached); trainerCache.splice(1); }
  return cached.query(entryPath, entryLabel);
}

// Existing-record edits do not need the NPC-creation generator's exact macro
// spelling. Check its emitted ABI, allowing equivalent arithmetic/formatting.
export function existingObjectEncodingReason(text: string, constants: Map<string, number>) {
  const matches = [...text.matchAll(/^MACRO\??\s+object_event\r?\n([\s\S]*?)^ENDM/gm)];
  if (matches.length !== 1) return "The object_event encoding is missing or ambiguous.";
  const code = matches[0][1].split(/\r?\n/).map(l => l.split(";")[0].trim()).filter(Boolean);
  for (const count of [6, 7, 8]) for (const args of [[7, 19, 31, 43, 53, 61, 73, 89], [9, 23, 35, 47, 59, 11, 79, 97]]) {
    const values = new Map(constants); values.set("_NARG", count);
    const expected = [args[2], args[1] + 4, args[0] + 4, args[3], args[4], count > 7 ? (constants.get("TRAINER") ?? -1) | args[5] : count > 6 ? (constants.get("ITEM") ?? -1) | args[5] : args[5], ...(count > 6 ? [args[6]] : []), ...(count > 7 ? [args[7]] : [])];
    const emitted: number[] = [], stack: Array<{ parent: boolean; taken: boolean }> = []; let active = true;
    const expression = (s: string) => evaluateRgbdsExpression(s.replace(/\\([1-8])/g, (_, n) => String(args[+n - 1])), values);
    for (const line of code) {
      const condition = line.match(/^(IF|ELIF)\s+_NARG\s*(>|>=|==)\s*(\d+)$/);
      if (condition) {
        const result = condition[2] === ">" ? count > +condition[3] : condition[2] === ">=" ? count >= +condition[3] : count === +condition[3];
        if (condition[1] === "IF") { stack.push({ parent: active, taken: result }); active &&= result; }
        else { const frame = stack[stack.length - 1]; if (!frame) return "Unsupported object macro conditional."; active = frame.parent && !frame.taken && result; frame.taken ||= result; }
      } else if (line === "ELSE") { const frame = stack[stack.length - 1]; if (!frame) return "Unsupported object macro conditional."; active = frame.parent && !frame.taken; frame.taken = true; }
      else if (line === "ENDC") { const frame = stack.pop(); if (!frame) return "Unsupported object macro conditional."; active = frame.parent; }
      else if (active && /^db\s+/.test(line)) {
        for (const operand of line.slice(3).split(",")) { const n = expression(operand); if (n === null) return "The emitted object bytes could not be resolved."; emitted.push(n); }
      } else if (active && !/^(?:DEF|REDEF)\s/.test(line)) return `Unrecognized object encoding instruction: ${line}`;
    }
    if (stack.length || JSON.stringify(emitted) !== JSON.stringify(expected)) return "This project's object macro uses a different byte layout. Its objects remain visible; editing needs a layout adapter.";
  }
  return null;
}
