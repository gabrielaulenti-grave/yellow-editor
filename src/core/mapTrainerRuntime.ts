export interface MapTrainerValues {
  x: number; y: number; sprite: string; facing: "DOWN" | "UP" | "LEFT" | "RIGHT";
  sight: number; partyId: string; before: string[]; defeat: string[]; after: string[];
}
export interface PlacedTrainer { id: number; object: string; text: string; label: string; event: string; values: MapTrainerValues }
export interface MapTrainerModel { version: 1; name: string; map: string; trainers: PlacedTrainer[] }
export const trainerMarker = "; yellow-editor-map-trainers: ";
export const trainerEnd = "; yellow-editor-map-trainers-end";
export function trainerResumeHook(name: string) { return `\t; yellow-editor-trainer-resume\n\tcall ${name}EditorTrainerResume\n\tret c\n\t; yellow-editor-trainer-resume-end\n`; }
export function trainerFrameHook(name: string) { return `\t; yellow-editor-trainer-frame\n\tcall ${name}EditorTrainerFrame\n\tret c\n\t; yellow-editor-trainer-frame-end\n`; }
// Resuming a native challenge takes priority over new automatic scenes or puzzles.
export function insertAfterTrainerResume(script: string, name: string, added: string) {
  const root = script.match(new RegExp(`^${name}_Script:{1,2}\\r?\\n`, "m"));
  if (!root) throw new Error("This map needs a unique script entry point.");
  let at = root.index! + root[0].length;
  const nl = script.includes("\r\n") ? "\r\n" : "\n", resume = trainerResumeHook(name).replace(/\n/g, nl);
  if (script.slice(at).startsWith(resume)) at += resume.length;
  return script.slice(0, at) + added.replace(/\r?\n/g, nl) + script.slice(at);
}
export const trainerScratchReservation = "wTrainerHeaderPtr:: dw\n\n\tds 6\n";
export const trainerScratch = "wTrainerHeaderPtr:: dw\n\n; yellow-editor-trainer-scratch: 1\nwEditorMapTrainerMap:: db\nwEditorMapTrainerState:: db\nwEditorMapTrainerReturn:: db\n\tds 3\n; yellow-editor-trainer-scratch-end\n";
// Only a native challenge in state 2 may survive the EnterMap after a battle.
// A loss is processed by EndTrainerBattle before blackout and never sets defeat.
export const trainerBattleHook = "\t; yellow-editor-trainer-battle-return\n\tfarcall EditorMapTrainerBattleReturn\n\t; yellow-editor-trainer-battle-return-end\n";
export const trainerBattleRuntime = ["; yellow-editor-trainer-battle-runtime", "PUSHS", 'SECTION "Editor trainer battle return", ROMX', "EditorMapTrainerBattleReturn::", ...["\t; yellow-editor-trainer-battle-return", "\tld a, [wEditorMapTrainerMap]", "\tld b, a", "\tld a, [wCurMap]", "\tcp b", "\tjr nz, .editorMapTrainerNoReturn", "\tld a, [wEditorMapTrainerState]", "\tcp 2", "\tjr z, .editorMapTrainerReturned", "\tld a, [wStatusFlags7]", "\tbit BIT_USE_CUR_MAP_SCRIPT, a", "\tjr z, .editorMapTrainerNoReturn", "\tld a, [wCurMapScript]", "\tcp 2", "\tjr nz, .editorMapTrainerNoReturn", ".editorMapTrainerReturned", "\tld a, 2", "\tld [wEditorMapTrainerState], a", "\tld a, $a7", "\tld [wEditorMapTrainerReturn], a", ".editorMapTrainerNoReturn", "\t; yellow-editor-trainer-battle-return-end", ""].slice(1, -2), "\tret", "POPS", "; yellow-editor-trainer-battle-runtime-end", ""].join("\n");
export const trainerEntryHook = ["\t; yellow-editor-trainer-map-entry", "\tld a, [wEditorMapTrainerReturn]", "\tcp $a7", "\tjr nz, .editorMapTrainerReset", "\tld a, [wEditorMapTrainerState]", "\tcp 2", "\tjr nz, .editorMapTrainerReset", "\tld a, [wEditorMapTrainerMap]", "\tld b, a", "\tld a, [wCurMap]", "\tcp b", "\tjr nz, .editorMapTrainerReset", "\tld a, $5a", "\tld [wEditorMapTrainerReturn], a", "\tjr .editorMapTrainerEntryDone", ".editorMapTrainerReset", "\txor a", "\tld [wEditorMapTrainerState], a", "\tld [wEditorMapTrainerReturn], a", "\tld a, $ff", "\tld [wEditorMapTrainerMap], a", ".editorMapTrainerEntryDone", "\t; yellow-editor-trainer-map-entry-end", ""].join("\n");

export function renderMapTrainers(model: MapTrainerModel) {
  const p = `${model.name}EditorTrainer`, lines = [trainerMarker + JSON.stringify(model), `${p}Resume:`, "\tld a, [wEditorMapTrainerState]", "\tand a", "\tjr nz, .resume", "\tld a, [wStatusFlags7]", "\tbit BIT_USE_CUR_MAP_SCRIPT, a", "\tjr z, .idle", ".resume", `\tcall ${p}Frame`, "\tscf", "\tret", ".idle", "\tand a", "\tret", "", `${p}Frame:`, "\tld a, [wCurMap]", "\tld [wEditorMapTrainerMap], a", "\tcall EnableAutoTextBoxDrawing", `\tld hl, ${p}Headers`, "\tld a, [wEditorMapTrainerState]", "\tld b, a", "\tld a, [wStatusFlags7]", "\tbit BIT_USE_CUR_MAP_SCRIPT, a", "\tld a, b", "\tjr z, .stateReady", "\tld a, [wCurMapScript]", ".stateReady", "\tcp 3", "\tjr nc, .invalid", "\tld c, a", "\tcp 2", "\tjr nz, .headerReady", "\tld a, [wIsInBattle]", "\tcp LOST_BATTLE", "\tjr z, .headerReady", "\tld a, [wEditorMapTrainerReturn]", "\tcp $5a", "\tjr z, .headerReady", "\tld a, 2", "\tld [wEditorMapTrainerState], a", "\tscf", "\tret", ".headerReady", "\tld a, c", "\tand a", "\tjr nz, .findHeader", "\tpush hl", `\tcall ${p}CanBattle`, "\tpop hl", "\tjr nc, .notReady", "\txor a", "\tjr .dispatch", ".findHeader", "\tld a, [wSpriteIndex]", "\tcp [hl]", "\tjr z, .selected", "\tld a, [hl]", "\tcp $ff", "\tjr z, .invalid", "\tld de, TRAINER_STRUCT_SIZE", "\tadd hl, de", "\tjr .findHeader", ".selected", "\tld a, [hl]", "\tld [wTrainerHeaderFlagBit], a", "\tld a, c", ".dispatch", `\tld de, ${p}Pointers`, "\tcall ExecuteCurMapScriptInTable", "\tld [wEditorMapTrainerState], a", "\tand a", "\tjr nz, .busy", "\tld [wEditorMapTrainerReturn], a", "\tand a", "\tret", ".busy", "\tscf", "\tret", ".invalid", "\tcall ResetButtonPressedAndMapScript", "\txor a", "\tld [wEditorMapTrainerState], a", "\tld [wEditorMapTrainerReturn], a", "\tld hl, wStatusFlags7", "\tres BIT_USE_CUR_MAP_SCRIPT, [hl]", "\tand a", "\tret", ".notReady", "\tand a", "\tret", "", `${p}CanBattle:`, "\tld a, [wPartyCount]", "\tand a", "\tret z", "\tcp PARTY_LENGTH + 1", "\tjr nc, .no", "\tfarcall AnyPartyAlive", "\tld a, d", "\tand a", "\tret z", "\tscf", "\tret", ".no", "\tand a", "\tret", "", `${p}Pointers:`, "\tdw CheckFightingMapTrainers", "\tdw DisplayEnemyTrainerTextAndStartBattle", "\tdw EndTrainerBattle", "", `${p}Headers:`];
  for (const t of model.trainers) lines.push(`\tdef_trainers ${t.id}`, `${p}Header${t.id}:`, `\ttrainer ${t.event}, ${t.values.sight}, ${p}Before${t.id}, ${p}Defeat${t.id}, ${p}After${t.id}`);
  lines.push("\tdb -1", "");
  for (const t of model.trainers) {
    lines.push(`${p}Text${t.id}:`, "\ttext_asm", "\tld a, [wCurMap]", "\tld [wEditorMapTrainerMap], a", `\tCheckEvent ${t.event}`, "\tjr nz, .talk", `\tcall ${p}CanBattle`, "\tjr c, .talk", `\tld hl, ${p}NoPartyText`, "\tcall PrintText", "\tjp TextScriptEnd", ".talk", `\tld a, ${t.object}`, "\tld [wSpriteIndex], a", `\tld hl, ${p}Header${t.id}`, "\tcall TalkToTrainer", "\tjp TextScriptEnd", "");
    for (const [role, texts] of [["Before", t.values.before], ["Defeat", t.values.defeat], ["After", t.values.after]] as const) lines.push(`${p}${role}${t.id}:`, ...texts.map((text, i) => `\t${i === 0 ? "text" : i === 1 ? "line" : "cont"} "${text}"`), "\tdone", "");
  }
  lines.push(`${p}NoPartyText:`, '\ttext "Bring a healthy"', '\tline "POKéMON first."', "\tdone", "");
  return lines.join("\n") + trainerEnd + "\n";
}
