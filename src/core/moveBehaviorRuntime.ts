import { behaviorEnginePaths, behaviorHelpers as legacyHelpers, installBehaviorHooks as legacyInstall, recoverBehaviorSources as legacyRecover, reader, type BehaviorPatch } from "./moveBehaviorRuntimeV1";
import { moveStatHelpers, nativeStatHelpers } from "./moveStatRuntime";
export { behaviorDataPath, behaviorEnginePaths, type BehaviorPatch } from "./moveBehaviorRuntimeV1";

export function behaviorHelpers(path: string, version = 2) {
  return legacyHelpers(path) + (version === 2 && path === behaviorEnginePaths[1]
    ? "\n" + nativeStatHelpers + '\nPUSHS\nSECTION "Editor combined stat changes", ROMX\n' + reader("EditorMBStats") + "\n" + moveStatHelpers + "\nPOPS\n" : "");
}
export function installBehaviorHooks(text: Map<string, string>, version = 2) {
  const installed = legacyInstall(text);
  if (version === 1) return installed;
  const path = behaviorEnginePaths[1], before = "_JumpMoveEffect:", contents = installed.changes.get(path)!;
  if (contents.split(before).length !== 2) throw new Error("The move-effect dispatcher needs source review before combining stat changes.");
  const nl = contents.includes("\r\n") ? "\r\n" : "\n";
  const after = [before, "\tfarcall EditorMBTryStatChanges", "\tret c"].join(nl);
  const extra = behaviorHelpers(path).slice(legacyHelpers(path).length).replace(/\n/g, nl);
  installed.changes.set(path, contents.replace(before, after) + extra);
  installed.patches.push({ path, before, after });
  return installed;
}
export function recoverBehaviorSources(text: Map<string, string>, patches: BehaviorPatch[], version = 2) {
  if (version === 1) return legacyRecover(text, patches);
  if (!Array.isArray(patches) || patches.some(p => !p || !behaviorEnginePaths.includes(p.path) || typeof p.before !== "string" || typeof p.after !== "string" || !p.after)) throw new Error("The move behavior hook manifest needs source review.");
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
