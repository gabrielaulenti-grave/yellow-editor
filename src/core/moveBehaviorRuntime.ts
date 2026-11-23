import { behaviorEnginePaths, behaviorHelpers as legacyHelpers, installBehaviorHooks as legacyInstall, recoverBehaviorSources as legacyRecover, reader, type BehaviorPatch } from "./moveBehaviorRuntimeV1";
import { moveStatHelpers, nativeStatHelpers } from "./moveStatRuntime";
export { behaviorDataPath, behaviorEnginePaths, type BehaviorPatch } from "./moveBehaviorRuntimeV1";

const prefixes = ["EditorMBCore", "EditorMBEffects", "EditorMBHeal", "EditorMBRecoil"];
function activeMove(prefix: string) {
  return [`${prefix}CurrentMove:`, "\tldh a, [hWhoseTurn]", "\tand a", "\tld a, [wPlayerSelectedMove]", "\tret z", "\tld a, [wEnemySelectedMove]", "\tret", ""].join("\n");
}
export function behaviorHelpers(path: string, version = 3) {
  let helpers = legacyHelpers(path);
  if (version >= 3) {
    // MoveNum is the cached animation byte, not necessarily the move ID. Mirror
    // Move, Metronome and disobedience also update SelectedMove before execution.
    helpers = helpers.replace(/w(Player|Enemy)MoveNum/g, "w$1SelectedMove");
    const index = behaviorEnginePaths.indexOf(path), prefix = prefixes[index];
    const names = index === 0 ? ["DamageMode", "DamageAmount"] : index === 1 ? ["Toxic", "Charge", "Underground", "Airborne"] : index === 2 ? ["Rest"] : ["Half"];
    for (const name of names) {
      const pattern = new RegExp(`(${prefix}${name}:\\n\\tpush bc\\n\\tld c, \\d+\\n)(\\tcall ${prefix}Read)`);
      if (!pattern.test(helpers)) throw new Error("The move behavior field reader needs source review.");
      helpers = helpers.replace(pattern, `$1\tcall ${prefix}CurrentMove\n$2`);
    }
    helpers += activeMove(prefix);
  }
  const stats = version >= 3 ? moveStatHelpers.replace(/w(Player|Enemy)MoveNum/g, "w$1SelectedMove") : moveStatHelpers;
  return helpers + (version >= 2 && path === behaviorEnginePaths[1]
    ? "\n" + nativeStatHelpers + '\nPUSHS\nSECTION "Editor combined stat changes", ROMX\n' + reader("EditorMBStats") + "\n" + stats + "\nPOPS\n" : "");
}
export function installBehaviorHooks(text: Map<string, string>, version = 3) {
  const installed = legacyInstall(text);
  if (version === 1) return installed;
  for (const path of behaviorEnginePaths) {
    const contents = installed.changes.get(path)!, nl = contents.includes("\r\n") ? "\r\n" : "\n";
    const suffix = legacyHelpers(path).replace(/\n/g, nl);
    installed.changes.set(path, contents.slice(0, -suffix.length) + behaviorHelpers(path, version).replace(/\n/g, nl));
  }
  const path = behaviorEnginePaths[1], before = "_JumpMoveEffect:", contents = installed.changes.get(path)!;
  if (contents.split(before).length !== 2) throw new Error("The move-effect dispatcher needs source review before combining stat changes.");
  const nl = contents.includes("\r\n") ? "\r\n" : "\n";
  const after = [before, "\tfarcall EditorMBTryStatChanges", "\tret c"].join(nl);
  installed.changes.set(path, contents.replace(before, after));
  installed.patches.push({ path, before, after });
  return installed;
}
export function recoverBehaviorSources(text: Map<string, string>, patches: BehaviorPatch[], version = 3) {
  if (version === 1) return legacyRecover(text, patches);
  if (!Array.isArray(patches) || patches.some(p => !p || !behaviorEnginePaths.includes(p.path) || typeof p.before !== "string" || typeof p.after !== "string" || !p.after)) throw new Error("The move behavior hook manifest needs source review.");
  const restored = new Map(text);
  for (const path of behaviorEnginePaths) {
    let contents = text.get(path)!;
    const suffix = behaviorHelpers(path, version).replace(/\n/g, contents.includes("\r\n") ? "\r\n" : "\n");
    if (!contents.endsWith(suffix)) throw new Error("The installed move behavior helpers changed in source.");
    contents = contents.slice(0, -suffix.length);
    for (const patch of patches.filter(p => p.path === path).reverse()) {
      const at = contents.lastIndexOf(patch.after);
      if (at < 0) throw new Error("An installed move behavior hook changed in source.");
      contents = contents.slice(0, at) + patch.before + contents.slice(at + patch.after.length);
    }
    restored.set(path, contents);
  }
  const rebuilt = installBehaviorHooks(restored, version);
  if (JSON.stringify(rebuilt.patches) !== JSON.stringify(patches) || behaviorEnginePaths.some(path => rebuilt.changes.get(path) !== text.get(path))) throw new Error("The move behavior hook manifest needs source review.");
  return restored;
}
