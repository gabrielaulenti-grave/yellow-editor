import { code, freeSections, type CreationStamp } from "./creationSupport";
import { hashText } from "./history";
import { readProjectRgbdsSources } from "./projectConstants";
import { behaviorDataPath, behaviorEnginePaths, installBehaviorHooks, recoverBehaviorSources, type BehaviorPatch } from "./moveBehaviorRuntime";
import type { MoveData, ProjectSource, TextWriteRequest } from "./types";

export const extraEffects = ["POISON_SIDE_EFFECT1", "BURN_SIDE_EFFECT1", "FREEZE_SIDE_EFFECT1", "PARALYZE_SIDE_EFFECT1", "FLINCH_SIDE_EFFECT1", "CONFUSION_SIDE_EFFECT", "ATTACK_DOWN_SIDE_EFFECT", "DEFENSE_DOWN_SIDE_EFFECT", "SPEED_DOWN_SIDE_EFFECT", "SPECIAL_DOWN_SIDE_EFFECT"] as const;
export const damagingEffects = ["NO_ADDITIONAL_EFFECT", "SWIFT_EFFECT", "PAY_DAY_EFFECT", "RAGE_EFFECT", "THRASH_PETAL_DANCE_EFFECT", "JUMP_KICK_EFFECT", "POISON_SIDE_EFFECT2", "BURN_SIDE_EFFECT2", "FREEZE_SIDE_EFFECT2", "PARALYZE_SIDE_EFFECT2", "FLINCH_SIDE_EFFECT2", "DRAIN_HP_EFFECT", "DREAM_EATER_EFFECT", "RECOIL_EFFECT", "TWO_TO_FIVE_ATTACKS_EFFECT", "ATTACK_TWICE_EFFECT", "TWINEEDLE_EFFECT", "CHARGE_EFFECT", "FLY_EFFECT", "TRAPPING_EFFECT", "HYPER_BEAM_EFFECT", "SUPER_FANG_EFFECT", "SPECIAL_DAMAGE_EFFECT", ...extraEffects];
export interface MoveBehaviorValues {
  priority: "normal" | "first" | "last";
  counter: boolean; badlyPoisoned: boolean; rest: boolean;
  damageMode: "level" | "fixed" | "random"; fixedDamage: number;
  recoil: "quarter" | "half";
  charge: "generic" | "whirlwind" | "sunlight" | "head" | "glowing" | "fly" | "dig";
  secondaryChance: number | null; additionalEffect: typeof extraEffects[number] | null;
}
export interface MoveBehaviorSupport { reason: string | null; moves: Record<string, MoveBehaviorValues> }
const priorities = ["normal", "first", "last"] as const, damageModes = ["level", "fixed", "random"] as const;
const charges = ["generic", "whirlwind", "sunlight", "head", "glowing", "fly", "dig"] as const;
export function defaultMoveBehavior(constant = ""): MoveBehaviorValues {
  return { priority: constant === "QUICK_ATTACK" ? "first" : constant === "COUNTER" ? "last" : "normal", counter: constant === "COUNTER", badlyPoisoned: constant === "TOXIC", rest: constant === "REST", damageMode: ["SEISMIC_TOSS", "NIGHT_SHADE"].includes(constant) ? "level" : ["SONICBOOM", "DRAGON_RAGE"].includes(constant) ? "fixed" : "random", fixedDamage: constant === "DRAGON_RAGE" ? 40 : 20, recoil: constant === "STRUGGLE" ? "half" : "quarter", charge: ({ RAZOR_WIND: "whirlwind", SOLARBEAM: "sunlight", SKULL_BASH: "head", SKY_ATTACK: "glowing", FLY: "fly", DIG: "dig" } as Record<string, MoveBehaviorValues["charge"]>)[constant] ?? "generic", secondaryChance: null, additionalEffect: null };
}
export function validateMoveBehavior(value: MoveBehaviorValues) {
  if (!value || value.additionalEffect !== null && !extraEffects.includes(value.additionalEffect) || !priorities.includes(value.priority) || !damageModes.includes(value.damageMode) || !["quarter", "half"].includes(value.recoil) || !charges.includes(value.charge) || [value.counter, value.badlyPoisoned, value.rest].some(v => typeof v !== "boolean") || !Number.isInteger(value.fixedDamage) || value.fixedDamage < 1 || value.fixedDamage > 255 || value.secondaryChance !== null && (!Number.isInteger(value.secondaryChance) || value.secondaryChance < 0 || value.secondaryChance > 100)) throw new Error("Choose supported move properties, fixed damage from 1–255 and a secondary chance from 0–100% (or the original chance).");
}
export function validateBehaviorFamily(v: MoveBehaviorValues, effect: string) {
  validateMoveBehavior(v);
  if (v.counter && effect !== "NO_ADDITIONAL_EFFECT") throw new Error("Counter retaliation requires No additional effect as its battle behavior.");
  if (v.additionalEffect && !damagingEffects.includes(effect)) throw new Error("An additional effect requires a supported damaging battle behavior. Choose None to use a status-only behavior.");
}
function bytes(v: MoveBehaviorValues) { return [priorities.indexOf(v.priority), +v.counter, +v.badlyPoisoned, +v.rest, damageModes.indexOf(v.damageMode) + 1, v.fixedDamage, +(v.recoil === "half"), charges.indexOf(v.charge), +(v.secondaryChance !== null), v.secondaryChance === null ? 0 : Math.min(255, Math.floor(v.secondaryChance * 255 / 100) + (v.secondaryChance ? 1 : 0)), +(v.secondaryChance === 100), v.additionalEffect ?? 0, 0, 0, 0, 0]; }
const manifestPrefix = "; yellow-editor-move-behaviors: ";
function render(moves: MoveData[], values: Record<string, MoveBehaviorValues>, patches: BehaviorPatch[]) {
  return [manifestPrefix + JSON.stringify({ version: 1, patches, values }), "PUSHS", 'SECTION "Editor move behavior data", ROMX', "EditorMoveBehaviorData::", ...moves.map(move => `\tdb ${bytes(values[move.constant]).join(", ")} ; ${move.constant}`), "\tassert @ - EditorMoveBehaviorData == NUM_ATTACKS * 16", "POPS", ""].join("\n");
}
export async function loadMoveBehaviors(source: ProjectSource, moves: MoveData[]) {
  const paths = [...behaviorEnginePaths, "home/copy.asm", "layout.link", "main.asm", "text.asm", ...(await source.exists(behaviorDataPath) ? [behaviorDataPath] : [])];
  const contents = (await Promise.all(paths.map(async path => await source.exists(path) ? { path, contents: await source.readText(path) } : null))).filter(file => file !== null);
  const text = new Map(contents.map(file => [file.path, file.contents]));
  const sources: CreationStamp[] = await Promise.all(contents.map(async file => ({ path: file.path, hash: await hashText(file.contents) })));
  let values = Object.fromEntries(moves.map(move => [move.constant, defaultMoveBehavior(move.constant)])), patches: BehaviorPatch[] = [], reason: string | null = null;
  try {
    for (const path of paths) if (!text.has(path)) throw new Error(`Move behavior source ${path} is unavailable; ordinary move data remains editable.`);
    const copy = text.get("home/copy.asm")!.split(/\r?\n/).map(code).filter(Boolean).join("\n");
    if (!copy.includes("FarCopyData::\nld [wBuffer], a\nldh a, [hLoadedROMBank]\npush af\nld a, [wBuffer]\nldh [hLoadedROMBank], a\nld [rROMB], a\ncall CopyData\npop af\nldh [hLoadedROMBank], a\nld [rROMB], a\nret") && !copy.includes("FarCopyData::\nld [wFarCopyDataSavedROMBank], a\nldh a, [hLoadedROMBank]\npush af\nld a, [wFarCopyDataSavedROMBank]\ncall BankswitchCommon\ncall CopyData\npop af\ncall BankswitchCommon\nret")) throw new Error("The banked data reader needs source review before editing move properties.");
    const existing = text.get(behaviorDataPath);
    if (existing !== undefined) {
      const matches = [...existing.matchAll(/^; yellow-editor-move-behaviors: (.+)$/gm)];
      if (matches.length !== 1) throw new Error("Move behavior metadata is missing or ambiguous.");
      const manifest = JSON.parse(matches[0][1]);
      if (manifest.version !== 1 || !Array.isArray(manifest.patches) || !manifest.values || Object.keys(manifest.values).length !== moves.length) throw new Error("The move behavior table is not synchronized with move identities.");
      for (const move of moves) validateMoveBehavior(manifest.values[move.constant]);
      if (existing !== render(moves, manifest.values, manifest.patches)) throw new Error("The managed move behavior table changed in source.");
      recoverBehaviorSources(text, manifest.patches);
      values = manifest.values; patches = manifest.patches;
    } else patches = installBehaviorHooks(text).patches;
  } catch (error) { reason = error instanceof Error ? error.message : String(error); }
  return { text, sources, support: { reason, moves: values } as MoveBehaviorSupport, patches };
}
export async function prepareMoveBehaviorWrites(source: ProjectSource, oldMoves: MoveData[], moves: MoveData[], constant: string, requested?: MoveBehaviorValues): Promise<TextWriteRequest[]> {
  const state = await loadMoveBehaviors(source, oldMoves), existing = state.text.has(behaviorDataPath);
  const previous = state.support.moves[constant] ?? defaultMoveBehavior();
  const value = requested ?? previous; validateMoveBehavior(value);
  if (!existing && JSON.stringify(value) === JSON.stringify(previous)) return [];
  if (existing && oldMoves.length === moves.length && JSON.stringify(value) === JSON.stringify(previous)) return [];
  if (state.support.reason) throw new Error(state.support.reason);
  const values = { ...state.support.moves, [constant]: value }, updates = new Map<string, string>();
  let patches = state.patches;
  if (!existing) {
    const install = installBehaviorHooks(state.text); patches = install.patches;
    for (const [path, contents] of install.changes) updates.set(path, contents);
  }
  updates.set(behaviorDataPath, render(moves, values, patches));
  const files = await readProjectRgbdsSources(source);
  if (files.some(file => file.readError)) throw new Error("All source files must be readable before allocating move behavior data.");
  if (!existing && files.some(file => /\b(?:EditorMB\w+|EditorMoveBehaviorData)\b/.test(file.contents))) throw new Error("Move behavior helper symbols already occur elsewhere in this project.");
  updates.set("layout.link", freeSections(state.text.get("layout.link")!, files, behaviorEnginePaths));
  return [...updates].filter(([path, contents]) => contents !== state.text.get(path)).map(([path, contents]) => ({ path, contents, ...(path === behaviorDataPath && !existing ? { operation: "create" as const } : { expectedHash: state.sources.find(stamp => stamp.path === path)!.hash }) }));
}
