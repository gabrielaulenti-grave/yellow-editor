import { hashText } from "./history";
import type { InteractionInspection, ManagedInteraction } from "./scriptInteractions";

// Intercept only reviewed managed scene entries before DisplayTextIDInit draws
// a window. All native/special text and rejected scene starts take the original
// path, including its original facing, button wait and cleanup.
const path = "home/text_script.asm";
const hook = "\t; yellow-editor-scene-text-handoff\n\tfarcall EditorSceneTryTextHandoff\n\tret c\n\t; yellow-editor-scene-text-handoff-end\n";
const start = '; yellow-editor-scene-text-dispatch: 1\nPUSHS\nSECTION "Editor Scene Text Handoff", ROMX\n';
const end = "POPS\n; yellow-editor-scene-text-dispatch-end\n";
function dispatcher(state: InteractionInspection, models: ManagedInteraction[]) {
  const entries = models.filter(model => model.scene?.textHandoff && model.values.scene?.trigger === "interaction");
  const lines = [start.trimEnd(), "EditorSceneTryTextHandoff:", "\tld a, [wEditorSceneActive]", "\tand a", "\tjr nz, .native", "\tld a, [wTextPredefFlag]", "\tbit BIT_TEXT_PREDEF, a", "\tjr nz, .native", "\tldh a, [hTextID]", "\tand a", "\tjr z, .native", "\tcp TEXT_SAFARI_GAME_OVER", "\tjr nc, .native", "\tld c, a", "\tld a, [wNumSprites]", "\tcp c", "\tjr c, .resolved", "\tld a, c", "\tdec a", "\tadd a", "\tld e, a", "\tld d, 0", "\tld hl, wMapSpriteData + 1", "\tadd hl, de", "\tld c, [hl]", ".resolved"];
  entries.forEach((model, i) => {
    const tables = state.files.flatMap(file => [...file.contents.matchAll(/^\w+_TextPointers:\r?\n\s*def_text_pointers\r?\n((?:\s*dw_const[^\r\n]+\r?\n)+)/gm)]);
    const matches = tables.flatMap(table => [...table[1].matchAll(/dw_const\s+(\w+),\s*(\w+)/g)].flatMap((entry, index) => entry[1] === model.label ? [index + 1] : []));
    const id = matches.length === 1 ? matches[0] : null;
    if (!id) throw new Error("A scene's native text-table entry is missing.");
    lines.push("\tld a, [wCurMap]", `\tcp ${model.scene!.mapConstant}`, `\tjp nz, .next${i}`, "\tld a, c", `\tcp ${id}`, `\tjp nz, .next${i}`, `\tfarcall ${model.prefix}TryLaunch`, "\tret", `.next${i}`);
  });
  lines.push(".native", "\tand a", "\tret", end.trimEnd());
  // Entry count is unbounded across maps; initial skips must not be relative.
  return lines.join("\n").replace(/\tjr (nz|z|nc), \.native/g, "\tjp $1, .native") + "\n";
}

export async function prepareSceneTextHandoff(state: InteractionInspection, previous: ManagedInteraction[], models: ManagedInteraction[], changed: Map<string, string>) {
  const original = state.byPath.get(path)!;
  let text = original.replace(/\r\n/g, "\n");
  if (text.includes("yellow-editor-scene-text-")) {
    const old = dispatcher(state, previous);
    if (!text.endsWith(old) || text.split(hook).length !== 2 || !text.includes("DisplayTextID::\n" + hook)) throw new Error("The scene text handoff was changed in source.");
    text = text.slice(0, -old.length).replace(hook, "");
  }
  const code = text.split("\n").map(line => line.split(";", 1)[0].trim()).filter(Boolean).join("\n");
  if (!["91a8e05f96e7906682c740cc80f0a4fc8bd412a61c0360315bfc9815bb7f2fdf", "2f39f157f837825051326dbf03f4f3c38deb9558b4b9024cca6ee226739c3bf1"].includes(await hashText(code))) throw new Error("Scene text handoff needs the reviewed native DisplayTextID routine.");
  const yellow = state.byPath.has("scripts/OaksLab_2.asm");
  for (const [dependency, expected] of [yellow ? ["home/bankswitch2.asm", "f34a705d7dc5fb129003076f518c00554e94f0a9d6d925e34b7db224e91d0e00"] : ["home/bankswitch.asm", "b76654b5214e9168e089bb134ac6f6e937b2da43dd2c4c0889d5a4d01c655f16"], ["macros/farcall.asm", yellow ? "997f8bd7890be83497096f1d96e0c5f9fb78092e5223733d035b9059bbb43e9f" : "c10ef20e125e25bf6845a8df17f65f02d837ac9ff1f741b734049ae2e353c19a"]]) {
    const code = (state.byPath.get(dependency) ?? "").replace(/\r\n/g, "\n").split("\n").map(line => line.split(";", 1)[0].trim()).filter(Boolean).join("\n");
    if (await hashText(code) !== expected) throw new Error("Scene text handoff needs reviewed bank switching with preserved return flags.");
  }
  if (!/MACRO def_text_pointers\s*\n\s*const_def 1\s*\nENDM/.test(state.byPath.get("macros/scripts/maps.asm") ?? "")) throw new Error("Scene text handoff needs the reviewed native text-table numbering.");
  const updated = text.replace("DisplayTextID::\n", "DisplayTextID::\n" + hook) + dispatcher(state, models);
  changed.set(path, original.includes("\r\n") ? updated.replace(/\n/g, "\r\n") : updated);
}
