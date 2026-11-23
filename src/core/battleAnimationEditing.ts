import { loadBattleAnimationCatalog, type BattleAnimationCatalog } from "./battleAnimations";
import { loadGraphicsCatalog, loadGraphicsDocument } from "./graphics";
import { bytesToHex, hashText } from "./history";
import { evaluateRgbdsExpression, projectConstantCatalogFromSources, readProjectRgbdsSources } from "./projectConstants";
import type { ProjectSource, TextWriteRequest } from "./types";

export interface AnimationStepValues {
  kind: "subanimation" | "effect"; targetId: number; sound: string; sheetId: number; delay: number;
}
export interface AnimationEditDocument {
  animationId: number | null; catalog: BattleAnimationCatalog;
  sources: Array<{ path: string; hash: string }>;
  artwork: Array<{ path: string; hash: string }>;
  sounds: string[]; nextId: number; reason: string | null;
}
export interface AnimationEditValues {
  constant: string; steps: AnimationStepValues[]; hook: string | null;
  assignMoveId: number | null; confirmShared: boolean;
}
export interface AnimationWritePlan { changes: TextWriteRequest[]; animationId: number; constant: string }

const ANIMATIONS = "data/moves/animations.asm", CONSTANTS = "constants/move_constants.asm", MOVES = "data/moves/moves.asm", HOOKS = "data/battle_anims/special_effects.asm";
const dependencies = [ANIMATIONS, CONSTANTS, MOVES, HOOKS, "constants/move_animation_constants.asm", "constants/battle_anim_constants.asm", "data/moves/names.asm", "data/moves/sfx.asm", "data/battle_anims/subanimations.asm", "data/battle_anims/frame_blocks.asm", "data/battle_anims/base_coords.asm", "data/battle_anims/special_effect_pointers.asm", "engine/battle/animations.asm"];
const clean = (line: string) => line.split(";", 1)[0].trim();

export async function loadAnimationEditDocument(source: ProjectSource, animationId: number | null): Promise<AnimationEditDocument> {
  const files = await Promise.all(dependencies.map(async path => ({ path, contents: await source.readText(path) })));
  const text = new Map(files.map(file => [file.path, file.contents]));
  const snapshot: ProjectSource = { ...source, readText: async path => text.get(path) ?? source.readText(path) };
  const catalog = await loadBattleAnimationCatalog(snapshot, await loadGraphicsCatalog(snapshot));
  const constants = projectConstantCatalogFromSources(files.filter(file => file.path.startsWith("constants/")), { resolveConstCounters: true });
  const symbols = new Map(constants.constants.map(constant => [constant.symbol, constant.value]));
  const count = symbols.get("NUM_ATTACK_ANIMS"), nextId = catalog.scripts.length + 1;
  const tablePrefix = text.get(ANIMATIONS)!.split("AttackAnimationPointers:")[1]?.split(/assert_table_length\s+NUM_ATTACK_ANIMS\b/)[0];
  const assertedCount = tablePrefix?.split(/\r?\n/).filter(line => /^dw\s/.test(clean(line))).reduce((sum, line) => sum + clean(line).slice(2).split(",").length, 0);
  let reason: string | null = null;
  if (catalog.warnings.length || count !== assertedCount || count === undefined || count > catalog.scripts.length) reason = "Animation pointers and constants must resolve to a synchronized table before editing.";
  else if (animationId !== null && (!catalog.scripts.some(script => script.id === animationId) || catalog.scripts.find(script => script.id === animationId)!.warnings.length)) reason = "This animation contains unresolved source commands. Inspect its source before composing a copy.";
  else if (animationId === null && nextId >= 255) reason = "The one-byte animation ID range has no remaining slots.";
  else if (animationId !== null && !/^[A-Z][A-Z0-9_]*$/.test(catalog.scripts.find(script => script.id === animationId)!.constant)) reason = "This animation has no named constant. Duplicate it as a new animation to compose an independent script.";
  const sounds = catalog.moves.filter(move => {
    const id = symbols.get(move.constant); return id !== undefined && id > 0 && id <= catalog.moves.length;
  }).map(move => move.constant);
  const artwork = await Promise.all([...new Set(catalog.sheets.flatMap(sheet => sheet.path ? [sheet.path] : []))].map(async path => ({ path, hash: await hashText(bytesToHex(await source.readBytes(path))) })));
  return { animationId, catalog, sounds: ["NO_MOVE", ...sounds], nextId, reason, artwork, sources: await Promise.all(files.map(async file => ({ path: file.path, hash: await hashText(file.contents) }))) };
}

function replacePointer(text: string, id: number, label: string) {
  const lines = text.split(/\r?\n/); let inTable = false, index = 0, replaced = false;
  for (let i = 0; i < lines.length; i++) {
    const code = clean(lines[i]);
    if (code === "AttackAnimationPointers:") { inTable = true; continue; }
    if (!inTable || !code || /^(?:table_width|assert_table_length)\b/.test(code)) continue;
    const match = lines[i].match(/^(\s*dw\s+)([A-Za-z_]\w*)(\s*(?:;.*)?)$/);
    if (!match) break;
    if (++index === id) { lines[i] = `${match[1]}${label}${match[3]}`; replaced = true; break; }
  }
  if (!replaced) throw new Error("The selected animation pointer cannot be updated safely.");
  return lines.join(text.includes("\r\n") ? "\r\n" : "\n");
}
function insertBefore(text: string, pattern: RegExp, line: string) {
  const matches = [...text.matchAll(new RegExp(pattern.source, "gm"))];
  if (matches.length !== 1) throw new Error("The animation table boundary is missing or ambiguous.");
  const at = matches[0].index!, newline = text.includes("\r\n") ? "\r\n" : "\n";
  return text.slice(0, at) + line + newline + text.slice(at);
}

function appendPointer(text: string, label: string) {
  const lines = text.split(/\r?\n/); let table = false, last = -1, assertion = -1;
  for (let i = 0; i < lines.length; i++) {
    const code = clean(lines[i]);
    if (code === "AttackAnimationPointers:") { table = true; continue; }
    if (!table || !code || /^table_width\b/.test(code)) continue;
    if (/^assert_table_length\b/.test(code)) { if (/^assert_table_length\s+NUM_ATTACK_ANIMS\b/.test(code)) assertion = i; continue; }
    if (!/^dw\s+[A-Za-z_]\w*\s*$/.test(code)) break;
    last = i;
  }
  if (last < 0 || assertion < 0) throw new Error("The animation pointer table cannot be extended safely.");
  const assertionLine = lines[assertion]; lines.splice(assertion, 1); if (assertion < last) last--;
  lines.splice(last + 1, 0, `\tdw ${label}`, assertionLine);
  return lines.join(text.includes("\r\n") ? "\r\n" : "\n");
}

export async function prepareAnimationWrites(source: ProjectSource, document: AnimationEditDocument, values: AnimationEditValues): Promise<AnimationWritePlan> {
  const current = await loadAnimationEditDocument(source, document.animationId);
  if (current.sources.length !== document.sources.length || current.sources.some(entry => document.sources.find(old => old.path === entry.path)?.hash !== entry.hash)) throw new Error("Animation sources changed outside this draft. Reload the composer before saving.");
  if (JSON.stringify(current.artwork) !== JSON.stringify(document.artwork)) throw new Error("Animation artwork sources changed outside this draft. Reload the composer before saving.");
  if (current.reason) throw new Error(current.reason);
  const { catalog } = current, original = catalog.scripts.find(script => script.id === document.animationId);
  if (document.animationId !== null && !values.confirmShared) throw new Error("Acknowledge that all uses of this animation ID receive the edited sequence.");
  if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(values.constant)) throw new Error("Choose an animation constant using uppercase letters, numbers and underscores, starting with a letter.");
  if (!Array.isArray(values.steps) || !values.steps.length || values.steps.length > 128) throw new Error("An animation needs between 1 and 128 steps.");
  const files = await readProjectRgbdsSources(source);
  if (files.some(file => file.readError)) throw new Error("All assembly sources must be readable to check animation symbol collisions.");
  const allText = files.map(file => file.contents).join("\n");
  const constants = projectConstantCatalogFromSources(files, { resolveConstCounters: true });
  const symbols = new Map(constants.constants.map(constant => [constant.symbol, constant.value]));
  const creating = document.animationId === null, animationId = creating ? current.nextId : document.animationId!;
  if (creating && new RegExp(`\\b${values.constant}\\b`).test(allText)) throw new Error(`Symbol ${values.constant} already occurs in the project. Choose a unique animation constant.`);
  if (!creating && (!original || original.constant !== values.constant)) throw new Error("The animation identity changed. Reload the composer.");
  const canonical = (id: number, prefix: string) => constants.constants.find(constant => constant.sourcePath === "constants/move_animation_constants.asm" && constant.value === id && constant.symbol.startsWith(prefix))?.symbol ?? String(id);
  const commands = values.steps.map((step, i) => {
    if (!current.sounds.includes(step.sound)) throw new Error(`Step ${i + 1}: choose an existing move sound cue or No sound.`);
    if (step.kind === "effect") {
      const effect = catalog.effects.find(effect => effect.id === step.targetId);
      if (!effect || effect.id < 192 || effect.id >= 255 || !effect.routineSource) throw new Error(`Step ${i + 1}: unresolved special effect.`);
      return `\tbattle_anim ${step.sound}, ${effect.constant}`;
    }
    if (step.kind !== "subanimation") throw new Error(`Step ${i + 1}: unsupported animation step.`);
    const sub = catalog.subanimations.find(sub => sub.id === step.targetId), sheet = catalog.sheets.find(sheet => sheet.id === step.sheetId);
    if (!sub || sub.warnings.length || sub.id < 0 || sub.id > 255) throw new Error(`Step ${i + 1}: unresolved frame sequence.`);
    if (!sheet?.path || !Number.isInteger(sheet.tileCount) || sheet.tileCount! <= 0 || !Number.isInteger(step.sheetId) || step.sheetId < 0 || step.sheetId > 2) throw new Error(`Step ${i + 1}: choose a supported tile sheet.`);
    if (!Number.isInteger(step.delay) || step.delay < 0 || step.delay > 63) throw new Error(`Step ${i + 1}: frame delay must be an integer from 0 to 63.`);
    if (sub.frames.some(frame => { const block = catalog.blocks.find(block => block.id === frame.blockId); return !block || block.warnings.length || block.sprites.some(sprite => sprite.tile >= sheet.tileCount! || sprite.tile < 0); })) throw new Error(`Step ${i + 1}: this sequence references tiles outside the selected sheet.`);
    const encoded = evaluateRgbdsExpression(`(${step.sheetId} << 6) | ${step.delay}`, symbols);
    if (encoded === null || encoded >= (symbols.get("FIRST_SE_ID") ?? 192)) throw new Error(`Step ${i + 1}: tile sheet and delay overlap special-effect opcodes.`);
    return `\tbattle_anim ${step.sound}, ${canonical(sub.id, "SUBANIM_")}, ${step.sheetId}, ${step.delay}`;
  });
  for (const id of new Set(values.steps.filter(step => step.kind === "subanimation").map(step => step.sheetId))) {
    const sheet = catalog.sheets.find(sheet => sheet.id === id)!;
    const graphic = await loadGraphicsDocument(source, sheet.path!);
    if (graphic.depth !== 2 || graphic.width * graphic.height / 64 < sheet.tileCount!) throw new Error(`Tile sheet ${id} does not contain the declared graphics capacity.`);
  }
  if (values.hook !== null && !catalog.hooks.some(hook => hook.routine === values.hook && hook.routineSource)) throw new Error("Choose an existing per-frame hook routine or None.");
  const existingHooks = catalog.hooks.filter(hook => hook.animationId === animationId);
  if (existingHooks.length > 1) throw new Error("Multiple hook bindings for this animation need source review.");
  const unchanged = original && original.steps.length === values.steps.length && original.steps.every((step, i) => {
    const next = values.steps[i]; return step.kind === next.kind && step.targetId === next.targetId && step.sound === next.sound && (step.kind === "effect" || step.sheetId === next.sheetId && step.delay === next.delay);
  });
  if (!creating && unchanged && (existingHooks[0]?.routine ?? null) === values.hook && (values.assignMoveId === null || catalog.moves.find(move => move.id === values.assignMoveId)?.animationId === animationId)) return { animationId, constant: values.constant, changes: [] };
  const sourceText = new Map(await Promise.all(current.sources.map(async entry => [entry.path, await source.readText(entry.path)] as const)));
  // Recheck after symbol scans so intervening edits cannot be silently incorporated.
  for (const entry of current.sources) if (await hashText(sourceText.get(entry.path)!) !== entry.hash) throw new Error("Animation sources changed while preparing the save. Reload the composer.");
  const updates = new Map<string, string>();
  let animations = sourceText.get(ANIMATIONS)!, label = `YellowEditor_${values.constant}`, suffix = 2;
  while (new RegExp(`\\b${label}\\b`).test(allText)) label = `YellowEditor_${values.constant}_${suffix++}`;
  if (creating) {
    updates.set(CONSTANTS, insertBefore(sourceText.get(CONSTANTS)!, /^\s*DEF[ \t]+NUM_ATTACK_ANIMS[ \t]+EQU\b[^\r\n]*/, `\tconst_next ${animationId}\n\tconst ${values.constant}`.replace(/\n/g, sourceText.get(CONSTANTS)!.includes("\r\n") ? "\r\n" : "\n")));
    animations = appendPointer(animations, label);
  } else animations = replacePointer(animations, animationId, label);
  const newline = animations.includes("\r\n") ? "\r\n" : "\n";
  // Update a private block created by the composer in place; detach shared or external blocks.
  const marker = original && `; yellow-editor animation ${animationId} ${original.constant}`;
  const originalLabel = original?.label;
  const occurrences = originalLabel ? allText.match(new RegExp(`\\b${originalLabel}\\b`, "g"))?.length ?? 0 : 0;
  if (!creating && original && occurrences === 2 && sourceText.get(ANIMATIONS)!.includes(`${marker}${newline}${original.label}:`)) {
    label = original.label;
    animations = sourceText.get(ANIMATIONS)!;
    const block = original.source.text;
    if (!animations.includes(block) || animations.indexOf(block) !== animations.lastIndexOf(block)) throw new Error("The managed animation block is ambiguous.");
    animations = animations.replace(block, `${label}:${newline}${commands.join(newline)}${newline}\tdb -1 ; end`);
  } else {
    animations += `${animations.endsWith(newline) ? "" : newline}${newline}; yellow-editor animation ${animationId} ${values.constant}${newline}${label}:${newline}${commands.join(newline)}${newline}\tdb -1 ; end${newline}`;
  }
  updates.set(ANIMATIONS, animations);
  let hooks = sourceText.get(HOOKS)!;
  if (existingHooks[0]) {
    const line = existingHooks[0].source.text;
    if (hooks.indexOf(line) !== hooks.lastIndexOf(line)) throw new Error("The engine hook binding is ambiguous.");
    hooks = hooks.replace(line, values.hook ? `\tanim_special_effect ${values.constant}, ${values.hook}` : "");
  } else if (values.hook) {
    const tableStart = hooks.indexOf("AnimationIdSpecialEffects:");
    if (tableStart < 0) throw new Error("Missing engine hook table.");
    const tail = insertBefore(hooks.slice(tableStart), /^\s*db[ \t]+-1\b[^\r\n]*/, `\tanim_special_effect ${values.constant}, ${values.hook}`);
    hooks = hooks.slice(0, tableStart) + tail;
  }
  if (hooks !== sourceText.get(HOOKS)) updates.set(HOOKS, hooks);
  if (values.assignMoveId !== null) {
    const move = catalog.moves.find(move => move.id === values.assignMoveId);
    if (!move) throw new Error("Choose a move from this project for the animation assignment.");
    const moves = sourceText.get(MOVES)!, rows = moves.split(/\r?\n/), indexes = rows.map((line, i) => /^\s*move\s+/.test(clean(line)) ? i : -1).filter(i => i >= 0);
    if (indexes.length !== catalog.moves.length || rows.some(line => /^\s*(?:IF|ELSE|ENDC|REPT|INCLUDE)\b/.test(clean(line)))) throw new Error("Move assignments require a direct, synchronized move table.");
    const at = indexes[move.id - 1];
    rows[at] = rows[at].replace(/^(\s*move\s+)[^,]+(,)/, `$1${values.constant}$2`);
    updates.set(MOVES, rows.join(moves.includes("\r\n") ? "\r\n" : "\n"));
  }
  return { animationId, constant: values.constant, changes: [...updates].filter(([path, contents]) => contents !== sourceText.get(path)).map(([path, contents]) => ({ path, contents, expectedHash: current.sources.find(entry => entry.path === path)!.hash })) };
}
