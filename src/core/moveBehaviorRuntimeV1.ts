export interface BehaviorPatch { path: string; before: string; after: string }
export const behaviorDataPath = "data/moves/editor_behaviors.asm";
export const behaviorEnginePaths = ["engine/battle/core.asm", "engine/battle/effects.asm", "engine/battle/move_effects/heal.asm", "engine/battle/move_effects/recoil.asm"];
const marker = "; yellow-editor move behaviors: 1";

// Copies one byte into a private stack slot. No new WRAM or ROM0 space is used.
// FarCopyData restores the caller's ROM bank before returning into ROMX code.
export function reader(prefix: string) {
  return [`${prefix}Read:`, "\tand a", "\tjr z, .none", "\tcp NUM_ATTACKS + 1", "\tjr nc, .none", "\tpush bc", "\tpush de", "\tpush hl", "\tpush af", "\tdec a", "\tld l, a", "\tld h, 0", ...Array(4).fill("\tadd hl, hl"), "\tld b, 0", "\tadd hl, bc", "\tld de, EditorMoveBehaviorData", "\tadd hl, de", "\tpush hl", "\tld hl, sp + 3", "\tld d, h", "\tld e, l", "\tpop hl", "\tld bc, 1", "\tld a, BANK(EditorMoveBehaviorData)", "\tcall FarCopyData", "\tpop af", "\tpop hl", "\tpop de", "\tpop bc", "\tret", ".none", "\txor a", "\tret"].join("\n");
}
function field(prefix: string, name: string, offset: number, compare?: number) {
  return [`${prefix}${name}:`, "\tpush bc", `\tld c, ${offset}`, `\tcall ${prefix}Read`, "\tpop bc", ...(compare === undefined ? [] : [`\tcp ${compare}`]), "\tret"].join("\n");
}
function chance(prefix: string) {
  return [`${prefix}Chance:`, "\tpush bc", "\tpush de", "\tpush hl", "\tpush af", "\tldh a, [hWhoseTurn]", "\tand a", "\tld a, [wPlayerMoveNum]", "\tjr z, .selected", "\tld a, [wEnemyMoveNum]", ".selected", "\tld d, a", "\tld c, 8", `\tcall ${prefix}Read`, "\tand a", "\tjr z, .native", "\tld a, d", "\tld c, 10", `\tcall ${prefix}Read`, "\tand a", "\tjr nz, .always", "\tld a, d", "\tld c, 9", `\tcall ${prefix}Read`, "\tld b, a", ".native", "\tpop af", "\tcp b", "\tjr .done", ".always", "\tpop af", "\tscf", ".done", "\tpop hl", "\tpop de", "\tpop bc", "\tret", ...[["StatChance", "33 percent + 1"], ["ConfusionChance", "10 percent"]].map(([name, threshold]) => [`${prefix}${name}:`, "\tpush bc", `\tld b, ${threshold}`, `\tcall ${prefix}Chance`, "\tpop bc", "\tret"].join("\n"))].join("\n");
}
function additionalEffect() {
  return ["EditorMBApplySecondary::", "\tpush bc", "\tpush de", "\tpush hl", "\tld a, [wMoveMissed]", "\tand a", "\tjr nz, .done", "\tld a, [wDamage]", "\tld b, a", "\tld a, [wDamage + 1]", "\tor b", "\tjr z, .done", "\tldh a, [hWhoseTurn]", "\tand a", "\tld hl, wPlayerMoveEffect", "\tld de, wBattleMonHP", "\tld a, [wPlayerMoveNum]", "\tjr z, .selected", "\tld hl, wEnemyMoveEffect", "\tld de, wEnemyMonHP", "\tld a, [wEnemyMoveNum]", ".selected", "\tld c, 11", "\tcall EditorMBEffectsRead", "\tand a", "\tjr z, .done", "\tld b, a", "\tld a, [de]", "\tinc de", "\tld c, a", "\tld a, [de]", "\tor c", "\tjr z, .done", "\tldh a, [hWhoseTurn]", "\tand a", "\tld de, wEnemyMonHP", "\tjr z, .target", "\tld de, wBattleMonHP", ".target", "\tld a, [de]", "\tinc de", "\tld c, a", "\tld a, [de]", "\tor c", "\tjr z, .done", "\tld a, [hl]", "\tpush af", "\tld a, [wMoveMissed]", "\tpush af", "\tld [hl], b", "\tpush hl", "\tcall _JumpMoveEffect", "\tpop hl", "\tpop af", "\tld [wMoveMissed], a", "\tpop af", "\tld [hl], a", ".done", "\tpop hl", "\tpop de", "\tpop bc", "\tret"].join("\n");
}
export function behaviorHelpers(path: string) {
  const prefix = ["EditorMBCore", "EditorMBEffects", "EditorMBHeal", "EditorMBRecoil"][behaviorEnginePaths.indexOf(path)];
  const fields: Array<[string, number, number?]> = path === behaviorEnginePaths[0] ? [["First", 0, 1], ["Last", 0, 2], ["Counter", 1, 1], ["DamageMode", 4], ["DamageAmount", 5]] : path === behaviorEnginePaths[1] ? [["Toxic", 2, 1], ["Charge", 7], ["Underground", 7, 6], ["Airborne", 7, 5]] : path === behaviorEnginePaths[2] ? [["Rest", 3, 1]] : [["Half", 6, 1]];
  return "\n" + marker + "\n" + reader(prefix) + "\n" + fields.map(([name, offset, compare]) => field(prefix, name, offset, compare)).join("\n") + (path === behaviorEnginePaths[1] ? "\n" + chance(prefix) + "\n" + additionalEffect() + '\nEditorMBGenericChargeText:\n\ttext_start\n\tline "is charging!"\n\tprompt' : "") + (path === behaviorEnginePaths[0] ? `\nINCLUDE "${behaviorDataPath}"` : "") + "\n; yellow-editor move behaviors end\n";
}
export function installBehaviorHooks(text: Map<string, string>) {
  const changes = new Map<string, string>(), patches: BehaviorPatch[] = [];
  for (const path of behaviorEnginePaths) {
    let contents = text.get(path)!;
    if (/EditorMB\w+|EditorMoveBehaviorData/.test(contents)) throw new Error("Move behavior helper symbols already occur in this project.");
    const patch = (pattern: RegExp, replace: (match: string) => string, count = 1) => {
      const hits = [...contents.matchAll(pattern)];
      if (hits.length !== count) throw new Error(`The move behavior engine in ${path} needs source review before these settings can be edited.`);
      contents = contents.replace(pattern, match => { const after = replace(match); patches.push({ path, before: match, after }); return after; });
    };
    if (path === behaviorEnginePaths[0]) {
      for (const [label, side] of [["executeOtherEffects", "Player"], ["notMultiHitMove", "Enemy"]]) {
        patch(new RegExp(`^\\.${label}\\r?\\n[\\s\\S]*?\\t(?:jp|jr) Execute${side}MoveDone(?=\\r?\\n)`, "gm"), match => {
          const nl = match.includes("\r\n") ? "\r\n" : "\n";
          return match.replace(new RegExp(`\\t(?:jp|jr) z, Execute${side}MoveDone`), "\tjr z, .editorAdditionalEffect")
            .replace(new RegExp(`(\\t(?:jp|jr) Execute${side}MoveDone)$`), `.editorAdditionalEffect${nl}\tfarcall EditorMBApplySecondary${nl}$1`);
        });
      }
      patch(/\tcp QUICK_ATTACK\b/g, () => "\tcall EditorMBCoreFirst", 3);
      const boundary = contents.indexOf("HandleCounterMove:");
      if (boundary < 0) throw new Error("Counter's engine routine is unavailable.");
      // Turn order and retaliation are separate properties.
      const early = contents.slice(0, boundary), late = contents.slice(boundary);
      if ((early.match(/\tcp COUNTER\b/g) ?? []).length !== 3 || (late.match(/\tcp COUNTER\b/g) ?? []).length !== 2) throw new Error("Counter's engine checks need source review.");
      contents = early.replace(/\tcp COUNTER\b/g, match => { const after = "\tcall EditorMBCoreLast"; patches.push({ path, before: match, after }); return after; }) + late.replace(/\tcp COUNTER\b/g, match => { const after = "\tcall EditorMBCoreCounter"; patches.push({ path, before: match, after }); return after; });
      for (const side of ["Player", "Enemy"]) patch(new RegExp(`\\tld a, \\[w${side}MoveNum\\]\\r?\\n\\tcp SEISMIC_TOSS[\\s\\S]*?(?=; Psywave)`,'g'), match => [ `\tld a, [w${side}MoveNum]`, "\tcall EditorMBCoreDamageMode", "\tcp 1", "\tjr z, .storeDamage", "\tcp 2", "\tjr nz, .editorRandomDamage", `\tld a, [w${side}MoveNum]`, "\tcall EditorMBCoreDamageAmount", "\tld b, a", "\tjr .storeDamage", ".editorRandomDamage", ""].join(match.includes("\r\n") ? "\r\n" : "\n"));
    } else if (path === behaviorEnginePaths[1]) {
      patch(/\tcp TOXIC\b/g, () => "\tcall EditorMBEffectsToxic");
      patch(/\tld a, \[de\]\r?\n\tdec de[^\r\n]*\r?\n\tcp FLY_EFFECT/g, match => ["\tdec de", "\tld a, [de]", "\tcall EditorMBEffectsAirborne"].join(match.includes("\r\n") ? "\r\n" : "\n"));
      patch(/\tcp DIG\b/g, () => "\tcall EditorMBEffectsUnderground", 2);
      patch(/\tld a, \[wChargeMoveNum\]\r?\n[\s\S]*?(?=\.gotText\r?\n\tret)/g, match => {
        const names = ["MadeWhirlwindText", "TookInSunlightText", "LoweredItsHeadText", "SkyAttackGlowingText", "FlewUpHighText", "DugAHoleText"];
        return ["\tld a, [wChargeMoveNum]", "\tcall EditorMBEffectsCharge", ...names.flatMap((name, i) => [`\tcp ${i + 1}`, `\tld hl, ${name}`, "\tjr z, .gotText"]), "\tld hl, EditorMBGenericChargeText", ""].join(match.includes("\r\n") ? "\r\n" : "\n");
      });
      // Override only secondary-effect rolls, leaving accuracy and other RNG alone.
      for (const [start, end, expected] of [["PoisonEffect:", "PoisonedText:", 1], ["FreezeBurnParalyzeEffect:", "BurnedText:", 2], ["FlinchSideEffect:", "OneHitKOEffect:", 1]] as const) {
        const from = contents.indexOf(start), to = contents.indexOf(end, from);
        if (from < 0 || to < 0) throw new Error("Secondary-effect boundaries need source review.");
        const region = contents.slice(from, to);
        if ((region.match(/\tcall BattleRandom[^\r\n]*\r?\n\tcp b\b/g) ?? []).length !== expected) throw new Error("Secondary-effect chance tests need source review.");
        contents = contents.slice(0, from) + region.replace(/\tcall BattleRandom[^\r\n]*\r?\n\tcp b\b/g, before => { const after = before.replace(/\tcp b$/, "\tcall EditorMBEffectsChance"); patches.push({ path, before, after }); return after; }) + contents.slice(to);
      }
      patch(/\tcp 33 percent \+ 1/g, () => "\tcall EditorMBEffectsStatChance");
      patch(/\tcp 10 percent(?=\s*; chance of confusion)/g, () => "\tcall EditorMBEffectsConfusionChance");
    } else if (path === behaviorEnginePaths[2]) patch(/\tcp REST\b/g, () => "\tcall EditorMBHealRest");
    else patch(/\tcp STRUGGLE\b/g, () => "\tcall EditorMBRecoilHalf");
    changes.set(path, contents + behaviorHelpers(path).replace(/\n/g, contents.includes("\r\n") ? "\r\n" : "\n"));
  }
  return { changes, patches };
}
export function recoverBehaviorSources(text: Map<string, string>, patches: BehaviorPatch[]) {
  const restored = new Map(text);
  for (const path of behaviorEnginePaths) {
    let contents = text.get(path)!;
    const suffix = behaviorHelpers(path).replace(/\n/g, contents.includes("\r\n") ? "\r\n" : "\n");
    if (!contents.endsWith(suffix)) throw new Error("The installed move behavior helpers changed in source.");
    contents = contents.slice(0, -suffix.length);
    for (const patch of patches.filter(p => p.path === path).reverse()) {
      const at = contents.lastIndexOf(patch.after);
      if (at < 0) throw new Error("An installed move behavior hook changed in source.");
      contents = contents.slice(0, at) + patch.before + contents.slice(at + patch.after.length);
    }
    restored.set(path, contents);
  }
  const rebuilt = installBehaviorHooks(restored);
  if (JSON.stringify(rebuilt.patches) !== JSON.stringify(patches) || behaviorEnginePaths.some(path => rebuilt.changes.get(path) !== text.get(path))) throw new Error("The move behavior hook manifest needs source review.");
  return restored;
}
