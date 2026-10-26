import { hashText } from "./history";
import { conditionVisibilityHook, sceneVisibilityHook } from "./objectVisibilityHooks";
import { renderPlayerCondition, type PlayerCondition } from "./playerConditions";
import { reviewStrengthVisibility, strengthControlsVisibility } from "./mapStrength";
import type { InteractionInspection, ManagedInteraction } from "./scriptInteractions";

export interface NpcVisibilityRule { map: string; object: number; condition: PlayerCondition }
const begin = "; yellow-editor-npc-visibility-begin", end = "; yellow-editor-npc-visibility-end";
function models(files: Array<{ contents: string }>) {
  return files.flatMap(file => [...file.contents.matchAll(/^\s*; yellow-editor-interaction: (.*)$/gm)].map(match => JSON.parse(match[1]) as ManagedInteraction)).filter(m => m.visibilityRule).sort((a, b) => a.prefix.localeCompare(b.prefix));
}
function runtime(all: ManagedInteraction[]) {
  const grouped = new Map<string, ManagedInteraction[]>();
  for (const m of all) grouped.set(m.visibilityRule!.map, [...(grouped.get(m.visibilityRule!.map) ?? []), m]);
  const maps = [...grouped], lines = [begin, "PUSHS", 'SECTION "Editor NPC Conditions", ROMX', "EditorNpcConditionVisibility::", "\tpush bc", "\tpush de", "\tpush hl", "\tld a, [wCurMap]", "\tcp NUM_MAPS", "\tjp nc, .ordinary", "\tld l, a", "\tld h, 0", "\tadd hl, hl", "\tld de, .maps", "\tadd hl, de", "\tld a, [hli]", "\tld h, [hl]", "\tld l, a", "\tjp hl"];
  for (const [i, [, entries]] of maps.entries()) {
    lines.push(`.map${i}`);
    entries.forEach((m, j) => lines.push("\tldh a, [hCurrentSpriteOffset]", "\tswap a", `\tcp ${m.visibilityRule!.object}`, `\tjr nz, .next${i}_${j}`, `\tfarcall ${m.prefix}VisibilityCondition`, "\tpop hl", "\tpop de", "\tpop bc", "\tret", `.next${i}_${j}`));
    lines.push("\tjp .ordinary");
  }
  lines.push(".ordinary", "\tpop hl", "\tpop de", "\tpop bc", "\tand a", "\tret", ".maps", "FOR n, NUM_MAPS");
  maps.forEach(([map], i) => lines.push(`${i ? "ELIF" : "IF"} n == ${map}`, `\tdw .map${i}`));
  if (maps.length) lines.push("ELSE");
  lines.push("\tdw .ordinary"); if (maps.length) lines.push("ENDC"); lines.push("ENDR", "POPS");
  for (const m of all) lines.push("PUSHS", `SECTION "NPC condition ${m.prefix}", ROMX`, `${m.prefix}VisibilityCondition::`, ...renderPlayerCondition(m.visibilityRule!.condition, ".ordinary", ".hidden", `${m.prefix}Visibility`), ".ordinary", "\tand a", "\tret", ".hidden", "\tld a, 1", "\tldh [hIsToggleableObjectOff], a", "\tscf", "\tret", "POPS");
  return lines.join("\n") + `\n${end}\n`;
}
export async function prepareNpcVisibility(state: InteractionInspection, model: ManagedInteraction, changed: Map<string, string>) {
  if (model.values.visibleWhen) {
    const npc = state.document.visibilityNpc;
    if (!npc) throw new Error("Conditional visibility needs a text entry belonging to one NPC on this map.");
    if (strengthControlsVisibility(state.files, state.document.scene.mapConstant, npc.id)) throw new Error("A Strength hole controls this boulder's visibility. Choose a separate NPC for this rule.");
    model.visibilityRule = { map: state.document.scene.mapConstant, object: npc.id, condition: model.values.visibleWhen };
  } else delete model.visibilityRule;
  const old = models(state.files), all = [...old.filter(m => m.prefix !== model.prefix), ...(model.visibilityRule ? [model] : [])].sort((a, b) => a.prefix.localeCompare(b.prefix));
  if (!old.length && !all.length) return;
  if (all.length > 64) throw new Error("Use at most 64 NPC visibility conditions in one project.");
  const owners = all.map(m => `${m.visibilityRule!.map}:${m.visibilityRule!.object}`);
  if (new Set(owners).size !== owners.length) throw new Error("An NPC already has a visibility condition on another text entry.");
  const path = "engine/overworld/toggleable_objects.asm", before = state.byPath.get(path)!, nl = before.includes("\r\n") ? "\r\n" : "\n";
  let text = (changed.get(path) ?? before).replace(/\r\n/g, "\n");
  if (before.includes(begin)) {
    if (!text.includes(runtime(old)) || text.split(conditionVisibilityHook).length !== 2) throw new Error("The NPC conditional-visibility runtime was changed in source.");
    text = text.replace(runtime(old), all.length ? runtime(all) : "");
    text = text.replace(conditionVisibilityHook, "");
    if (all.length) text = text.replace("IsObjectHidden:\n", "IsObjectHidden:\n" + conditionVisibilityHook);
  } else {
    const native = reviewStrengthVisibility(text.replace(sceneVisibilityHook, ""), state.files);
    const body = native.match(/^IsObjectHidden:\n([\s\S]*?)(?=^[A-Za-z_]\w*:{1,2})/m)?.[1];
    if (!body || await hashText(body.split("\n").map(l => l.split(";")[0].trim()).filter(Boolean).join("\n")) !== "f78a101337f2f157e91014ea8ad83876e16bc65120172c6cf098c16215ac7008") throw new Error("NPC visibility requires the reviewed native object-visibility routine.");
    text = text.replace("IsObjectHidden:\n", "IsObjectHidden:\n" + conditionVisibilityHook);
    const at = text.indexOf("; yellow-editor-scene-runtime:");
    text = at < 0 ? text + "\n" + runtime(all) : text.slice(0, at) + runtime(all) + "\n" + text.slice(at);
  }
  changed.set(path, text.replace(/\n/g, nl));
}
