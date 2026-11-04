import { code, freeSections, rows, type CreationStamp } from "./creationSupport";
import { hashText } from "./history";
import { projectConstantCatalogFromSources, readProjectRgbdsSources } from "./projectConstants";
import { behaviorDataPath, behaviorEnginePaths, installBehaviorHooks, recoverBehaviorSources, type BehaviorPatch } from "./moveBehaviorRuntime";
import type { MoveData, ProjectSource, TextWriteRequest } from "./types";
import { isStatMoveEffect, moveStatChangeBytes, validateMoveStatChanges, type MoveStatChanges } from "./moveStatChanges";

// Reviewed in both pinned disassemblies. Changes to these shared native helpers
// need review before the combined-stat routine can safely call into them.
async function checkStatEngine(text: Map<string, string>) {
  const contracts = [
    ["engine/battle/core.asm", "QuarterSpeedDueToParalysis:", "LoadHudAndHpBarAndStatusTilePatterns:", "170c33de45e31a4d721f06cd456b8af2e4ec97055434c6616f70631575fd1729", "fnv1a-cd2b2b81"],
    ["engine/battle/core.asm", "MoveHitTest:", "CalcHitChance:", "71279b14e81d7c4e6fe40bc2ba9d68dd5dd36fb8300d2fbe17ff716c4d33d053", "fnv1a-afd297b6"],
    ["engine/battle/effects.asm", "PrintStatText:", 'INCLUDE "data/battle/stat_mod_names.asm"', "30c9e51aec9dda9aa086fb54a5f1ccb65e0d45d7ee98eb94ea6b7a29365c7cea", "fnv1a-1a2af1cf"],
    ["engine/battle/effects.asm", "CheckTargetSubstitute:", "PlayCurrentMoveAnimation2:", "d63c57c2599419826e3e7e6f4d3d37248c542b56f5a373703905560ea3087030", "fnv1a-ad42e5f7"],
  ];
  for (const [path, start, end, hash, fallback] of contracts) {
    const contents = text.get(path) ?? "", from = contents.indexOf(start), to = contents.indexOf(end, from);
    if (from < 0 || to < 0 || ![hash, fallback].includes(await hashText(contents.slice(from, to).split(/\r?\n/).map(code).filter(Boolean).join("\n")))) throw new Error("The stat-change engine needs source review before editing special move properties.");
  }
}

export const extraEffects = ["POISON_SIDE_EFFECT1", "BURN_SIDE_EFFECT1", "FREEZE_SIDE_EFFECT1", "PARALYZE_SIDE_EFFECT1", "FLINCH_SIDE_EFFECT1", "CONFUSION_SIDE_EFFECT", "ATTACK_DOWN_SIDE_EFFECT", "DEFENSE_DOWN_SIDE_EFFECT", "SPEED_DOWN_SIDE_EFFECT", "SPECIAL_DOWN_SIDE_EFFECT", "ACCURACY_DOWN_SIDE_EFFECT", "EVASION_DOWN_SIDE_EFFECT"] as const;
const secondaryStatPaths = ["constants/move_effect_constants.asm", "data/moves/effects_pointers.asm"];
const extendedSecondary = (effect: MoveBehaviorValues["additionalEffect"]) => effect === "ACCURACY_DOWN_SIDE_EFFECT" || effect === "EVASION_DOWN_SIDE_EFFECT";
async function checkSecondaryStatSlots(text: Map<string, string>) {
  // Both vanilla engines already dispatch the next two stat-down slots to the
  // general stat handler. Refer to them by expression, without declaring or
  // claiming new effect IDs in the user's project.
  const symbols = projectConstantCatalogFromSources(secondaryStatPaths.map(path => ({ path, contents: text.get(path) ?? "" })), { resolveConstCounters: true });
  const base = symbols.constants.find(entry => entry.symbol === "ATTACK_DOWN_SIDE_EFFECT")?.value;
  const pointers = rows(text.get(secondaryStatPaths[1]) ?? "", "MoveEffectPointerTable", "dw");
  const effects = text.get(behaviorEnginePaths[1]) ?? "", start = effects.indexOf("StatModifierDownEffect:"), end = effects.indexOf("MonsStatsFellText:", start);
  if (base !== 0x44 || [4, 5].some(offset => code(pointers[base + offset - 1] ?? "") !== "dw StatModifierDownEffect") || start < 0 || end < 0 ||
    !["9ef475ae960f8e4b2670093072192418bfba70dcf614c21afcd61084c6004109", "fnv1a-112b6a22"].includes(await hashText(effects.slice(start, end).split(/\r?\n/).map(code).filter(Boolean).join("\n")))) {
    throw new Error("Accuracy/evasion secondary-effect slots need source review; the project's engine was preserved.");
  }
}
export const damagingEffects = ["NO_ADDITIONAL_EFFECT", "SWIFT_EFFECT", "PAY_DAY_EFFECT", "RAGE_EFFECT", "THRASH_PETAL_DANCE_EFFECT", "JUMP_KICK_EFFECT", "POISON_SIDE_EFFECT2", "BURN_SIDE_EFFECT2", "FREEZE_SIDE_EFFECT2", "PARALYZE_SIDE_EFFECT2", "FLINCH_SIDE_EFFECT2", "DRAIN_HP_EFFECT", "DREAM_EATER_EFFECT", "RECOIL_EFFECT", "TWO_TO_FIVE_ATTACKS_EFFECT", "ATTACK_TWICE_EFFECT", "TWINEEDLE_EFFECT", "CHARGE_EFFECT", "FLY_EFFECT", "TRAPPING_EFFECT", "HYPER_BEAM_EFFECT", "SUPER_FANG_EFFECT", "SPECIAL_DAMAGE_EFFECT", ...extraEffects];
export interface MoveBehaviorValues {
  priority: "normal" | "first" | "last";
  counter: boolean; badlyPoisoned: boolean; rest: boolean;
  damageMode: "level" | "fixed" | "random"; fixedDamage: number;
  recoil: "quarter" | "half";
  charge: "generic" | "whirlwind" | "sunlight" | "head" | "glowing" | "fly" | "dig";
  secondaryChance: number | null; additionalEffect: typeof extraEffects[number] | null;
  statChanges: MoveStatChanges | null;
}
export interface MoveBehaviorSupport { reason: string | null; moves: Record<string, MoveBehaviorValues> }
const priorities = ["normal", "first", "last"] as const, damageModes = ["level", "fixed", "random"] as const;
const charges = ["generic", "whirlwind", "sunlight", "head", "glowing", "fly", "dig"] as const;
export function defaultMoveBehavior(constant = ""): MoveBehaviorValues {
  return { priority: constant === "QUICK_ATTACK" ? "first" : constant === "COUNTER" ? "last" : "normal", counter: constant === "COUNTER", badlyPoisoned: constant === "TOXIC", rest: constant === "REST", damageMode: ["SEISMIC_TOSS", "NIGHT_SHADE"].includes(constant) ? "level" : ["SONICBOOM", "DRAGON_RAGE"].includes(constant) ? "fixed" : "random", fixedDamage: constant === "DRAGON_RAGE" ? 40 : 20, recoil: constant === "STRUGGLE" ? "half" : "quarter", charge: ({ RAZOR_WIND: "whirlwind", SOLARBEAM: "sunlight", SKULL_BASH: "head", SKY_ATTACK: "glowing", FLY: "fly", DIG: "dig" } as Record<string, MoveBehaviorValues["charge"]>)[constant] ?? "generic", secondaryChance: null, additionalEffect: null, statChanges: null };
}
export function validateMoveBehavior(value: MoveBehaviorValues) {
  if (!value || value.additionalEffect !== null && !extraEffects.includes(value.additionalEffect) || !priorities.includes(value.priority) || !damageModes.includes(value.damageMode) || !["quarter", "half"].includes(value.recoil) || !charges.includes(value.charge) || [value.counter, value.badlyPoisoned, value.rest].some(v => typeof v !== "boolean") || !Number.isInteger(value.fixedDamage) || value.fixedDamage < 1 || value.fixedDamage > 255 || value.secondaryChance !== null && (!Number.isInteger(value.secondaryChance) || value.secondaryChance < 0 || value.secondaryChance > 100)) throw new Error("Choose supported move properties, fixed damage from 1–255 and a secondary chance from 0–100% (or the original chance).");
  validateMoveStatChanges(value.statChanges);
}
export function validateBehaviorFamily(v: MoveBehaviorValues, effect: string, power?: number) {
  validateMoveBehavior(v);
  if (v.counter && effect !== "NO_ADDITIONAL_EFFECT") throw new Error("Counter retaliation requires No additional effect as its battle behavior.");
  if (v.additionalEffect && !damagingEffects.includes(effect)) throw new Error("An additional effect requires a supported damaging battle behavior. Choose None to use a status-only behavior.");
  if (v.statChanges && (!isStatMoveEffect(effect) || power !== undefined && power !== 0 || v.counter || v.additionalEffect)) throw new Error("Combined stat changes require Power 0 and a stat-raising or stat-lowering battle behavior, without Counter or an additional damaging effect.");
}
function bytes(v: MoveBehaviorValues, version: number) { const secondary = v.additionalEffect === "ACCURACY_DOWN_SIDE_EFFECT" ? "(ATTACK_DOWN_SIDE_EFFECT + 4)" : v.additionalEffect === "EVASION_DOWN_SIDE_EFFECT" ? "(ATTACK_DOWN_SIDE_EFFECT + 5)" : v.additionalEffect ?? 0; return [priorities.indexOf(v.priority), +v.counter, +v.badlyPoisoned, +v.rest, damageModes.indexOf(v.damageMode) + 1, v.fixedDamage, +(v.recoil === "half"), charges.indexOf(v.charge), +(v.secondaryChance !== null), v.secondaryChance === null ? 0 : Math.min(255, Math.floor(v.secondaryChance * 255 / 100) + (v.secondaryChance ? 1 : 0)), +(v.secondaryChance === 100), secondary, ...(version === 1 ? [0, 0, 0, 0] : moveStatChangeBytes(v.statChanges))]; }
const manifestPrefix = "; yellow-editor-move-behaviors: ";
function render(moves: MoveData[], values: Record<string, MoveBehaviorValues>, patches: BehaviorPatch[], version = 2) {
  return [manifestPrefix + JSON.stringify({ version, patches, values }), "PUSHS", 'SECTION "Editor move behavior data", ROMX', "EditorMoveBehaviorData::", ...moves.map(move => `\tdb ${bytes(values[move.constant], version).join(", ")} ; ${move.constant}`), "\tassert @ - EditorMoveBehaviorData == NUM_ATTACKS * 16", "POPS", ""].join("\n");
}
export async function loadMoveBehaviors(source: ProjectSource, moves: MoveData[]) {
  const paths = [...behaviorEnginePaths, ...secondaryStatPaths, "home/copy.asm", "layout.link", "main.asm", "text.asm", ...(await source.exists(behaviorDataPath) ? [behaviorDataPath] : [])];
  const contents = (await Promise.all(paths.map(async path => await source.exists(path) ? { path, contents: await source.readText(path) } : null))).filter(file => file !== null);
  const text = new Map(contents.map(file => [file.path, file.contents]));
  const sources: CreationStamp[] = await Promise.all(contents.map(async file => ({ path: file.path, hash: await hashText(file.contents) })));
  let values = Object.fromEntries(moves.map(move => [move.constant, defaultMoveBehavior(move.constant)])), patches: BehaviorPatch[] = [], reason: string | null = null, version = 2, restored = text;
  try {
    for (const path of paths) if (!text.has(path)) throw new Error(`Move behavior source ${path} is unavailable; ordinary move data remains editable.`);
    const copy = text.get("home/copy.asm")!.split(/\r?\n/).map(code).filter(Boolean).join("\n");
    if (!copy.includes("FarCopyData::\nld [wBuffer], a\nldh a, [hLoadedROMBank]\npush af\nld a, [wBuffer]\nldh [hLoadedROMBank], a\nld [rROMB], a\ncall CopyData\npop af\nldh [hLoadedROMBank], a\nld [rROMB], a\nret") && !copy.includes("FarCopyData::\nld [wFarCopyDataSavedROMBank], a\nldh a, [hLoadedROMBank]\npush af\nld a, [wFarCopyDataSavedROMBank]\ncall BankswitchCommon\ncall CopyData\npop af\ncall BankswitchCommon\nret")) throw new Error("The banked data reader needs source review before editing move properties.");
    const existing = text.get(behaviorDataPath);
    if (existing !== undefined) {
      const matches = [...existing.matchAll(/^; yellow-editor-move-behaviors: (.+)$/gm)];
      if (matches.length !== 1) throw new Error("Move behavior metadata is missing or ambiguous.");
      const manifest = JSON.parse(matches[0][1]);
      if (![1, 2].includes(manifest.version) || !Array.isArray(manifest.patches) || !manifest.values || Object.keys(manifest.values).length !== moves.length) throw new Error("The move behavior table is not synchronized with move identities.");
      for (const move of moves) validateMoveBehavior(manifest.values[move.constant]);
      if (existing !== render(moves, manifest.values, manifest.patches, manifest.version)) throw new Error("The managed move behavior table changed in source.");
      restored = recoverBehaviorSources(text, manifest.patches, manifest.version);
      values = Object.fromEntries(moves.map(move => [move.constant, { ...manifest.values[move.constant], statChanges: manifest.values[move.constant].statChanges ?? null }]));
      patches = manifest.patches; version = manifest.version;
    } else patches = installBehaviorHooks(text).patches;
    await checkStatEngine(restored);
    if (Object.values(values).some(value => extendedSecondary(value.additionalEffect))) await checkSecondaryStatSlots(restored);
  } catch (error) { reason = error instanceof Error ? error.message : String(error); }
  return { text, restored, version, sources, support: { reason, moves: values } as MoveBehaviorSupport, patches };
}
export async function prepareMoveBehaviorWrites(source: ProjectSource, oldMoves: MoveData[], moves: MoveData[], constant: string, requested?: MoveBehaviorValues): Promise<TextWriteRequest[]> {
  const state = await loadMoveBehaviors(source, oldMoves), existing = state.text.has(behaviorDataPath);
  const previous = state.support.moves[constant] ?? defaultMoveBehavior();
  const value = requested ?? previous; validateMoveBehavior(value);
  if (!existing && JSON.stringify(value) === JSON.stringify(previous)) return [];
  if (existing && oldMoves.length === moves.length && JSON.stringify(value) === JSON.stringify(previous)) return [];
  if (state.support.reason) throw new Error(state.support.reason);
  if (extendedSecondary(value.additionalEffect)) await checkSecondaryStatSlots(state.restored);
  const values = { ...state.support.moves, [constant]: value }, updates = new Map<string, string>();
  let patches = state.patches;
  if (!existing || state.version === 1) {
    const install = installBehaviorHooks(state.restored); patches = install.patches;
    for (const [path, contents] of install.changes) updates.set(path, contents);
  }
  updates.set(behaviorDataPath, render(moves, values, patches));
  const files = await readProjectRgbdsSources(source);
  if (files.some(file => file.readError)) throw new Error("All source files must be readable before allocating move behavior data.");
  if (!existing && files.some(file => /\b(?:EditorMB\w+|EditorMoveBehaviorData)\b/.test(file.contents))) throw new Error("Move behavior helper symbols already occur elsewhere in this project.");
  updates.set("layout.link", freeSections(state.text.get("layout.link")!, files, behaviorEnginePaths));
  return [...updates].filter(([path, contents]) => contents !== state.text.get(path)).map(([path, contents]) => ({ path, contents, ...(path === behaviorDataPath && !existing ? { operation: "create" as const } : { expectedHash: state.sources.find(stamp => stamp.path === path)!.hash }) }));
}
