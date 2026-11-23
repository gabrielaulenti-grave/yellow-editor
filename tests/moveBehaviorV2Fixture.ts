import { behaviorDataPath, behaviorEnginePaths, installBehaviorHooks, recoverBehaviorSources } from "../src/core/moveBehaviorRuntime";

/** Exact previous-format project for migration tests; preserve all move data. */
export function moveBehaviorV2Fixture(text: Map<string, string>) {
  const data = text.get(behaviorDataPath)!;
  const manifest = JSON.parse(data.match(/^; yellow-editor-move-behaviors: (.+)$/m)![1]);
  const restored = recoverBehaviorSources(text, manifest.patches, manifest.version);
  const legacy = installBehaviorHooks(restored, 2);
  const changes = new Map(legacy.changes);
  changes.set(behaviorDataPath, data.replace(/^; yellow-editor-move-behaviors: .+$/m,
    "; yellow-editor-move-behaviors: " + JSON.stringify({ version: 2, patches: legacy.patches, values: manifest.values })));
  return changes;
}
export const moveBehaviorFixturePaths = [...behaviorEnginePaths, behaviorDataPath];
