import { hashText } from "./history";
import { parseTrainerBaseCatalog } from "./trainerBaseIndex";
import type { ProjectSource } from "./types";
import { sceneBattleReturnHook } from "./sceneEffectRuntime";
import { trainerBattleHook } from "./mapTrainerRuntime";

export interface SceneEffectsDomain {
  music: Array<{ id: string; header: string }>;
  trainers: Array<{ id: string; label: string }>;
  musicReason: string | null; fadeReason: string | null; battleReason: string | null;
}
const code = (text: string) => text.replace(/\r\n/g, "\n").split("\n").map(line => line.split(";", 1)[0].trim()).filter(Boolean).join("\n");
// Fingerprint the reviewed entry/return boundaries. Data (songs and trainer
// parties) remains project-specific; emitted operands stay symbolic for RGBDS.
const contracts: Array<{ id: "audio" | "fade" | "battle"; path: string; yellowPath?: string; start?: string; end?: string; hashes: [string, string] }> = [
  { id: "audio", path: "home/audio.asm", hashes: ["88b74f29fa028af36d7742039108e3107d7385387679843cabcc4d98150e8f75", "fe25fb947485084de5d17b38f26dc05efec3d1ecbc4a24aacb3512e86c2bd872"] },
  { id: "fade", path: "home/fade.asm", hashes: ["5202bb405789276e5e2f329b7f86acaee1d71b315bcd927c964ef65d722ab317", "ec4fd537316d781795014ab7fa1db842b73cc4c228b37d57121af565ec21130d"] },
  { id: "battle", path: "engine/battle/core.asm", yellowPath: "engine/battle/init_battle.asm", start: "InitBattle::", end: "_LoadTrainerPic:", hashes: ["0bed13cb9ee43015e32f4023796dd9456bb365c7e6f9c392c1fb8532571a59e5", "ee847520e13cfafee879b24a534bcf9dfd1a775e696a2a2b2b7de5b9160d83b0"] },
  { id: "battle", path: "engine/battle/end_of_battle.asm", hashes: ["756ff7eb8629eedf3906056a1316854ab14617447b9d1da496ea5eedf1c96c9e", "a47a36973310ba036c6cb34ffa5d2e04d5fbbb14f92d59e4459419f1cfdd87c5"] },
  { id: "battle", path: "engine/battle/init_battle_variables.asm", hashes: ["1d99875547f1ad45e4b40279ef59055277fb83e94d36271b2ddd4098ce26996b", "1d99875547f1ad45e4b40279ef59055277fb83e94d36271b2ddd4098ce26996b"] },
  { id: "battle", path: "home/overworld.asm", start: ".battleOccurred", end: "; function to make bikes twice as fast as walking", hashes: ["807e1a57d08b6ae864566db6feb95ac6f756eacbe494878438d5045a7c2907fb", "6f12935698e5ffec3255f8ef95cd6be5f85e69ce54a38f2967e7424899be74c6"] },
  { id: "battle", path: "home/npc_movement.asm", start: "IsPlayerCharacterBeingControlledByGame::", end: "RunNPCMovementScript::", hashes: ["0230c498b6de8d05ce3ac980a98b54e2450ca7ce6c9067ebb6f2322084b990de", "0230c498b6de8d05ce3ac980a98b54e2450ca7ce6c9067ebb6f2322084b990de"] },
];
export async function inspectSceneEffects(source: ProjectSource, byPath: Map<string, string>): Promise<SceneEffectsDomain> {
  const yellow = byPath.has("scripts/OaksLab_2.asm"), reviewed = { audio: true, fade: true, battle: true };
  await Promise.all(contracts.map(async contract => {
    let text = (byPath.get(yellow && contract.yellowPath ? contract.yellowPath : contract.path) ?? "").replace(/\r\n/g, "\n");
    if (contract.path === "home/overworld.asm") text = text.replace(sceneBattleReturnHook, "").replace(trainerBattleHook, "");
    if (contract.start) text = text.includes(contract.start) ? text.slice(text.indexOf(contract.start)) : "";
    if (contract.end) text = text.includes(contract.end) ? text.slice(0, text.indexOf(contract.end)) : "";
    if (await hashText(code(text)) !== contract.hashes[yellow ? 1 : 0]) reviewed[contract.id] = false;
  }));
  const definitions = byPath.get("constants/music_constants.asm") ?? "";
  const macro = definitions.match(/MACRO music_const\s*\n([\s\S]*?)\nENDM/);
  const validMacro = macro && code(macro[1]) === 'DEF \\1 EQUS "((\\2 - SFX_Headers_1) / 3)"';
  const headers = [...byPath].filter(([path]) => /^audio\/headers\/musicheaders\d+\.asm$/.test(path)).map(([, text]) => text).join("\n");
  const music = validMacro ? [...definitions.matchAll(/^\s*music_const\s+(MUSIC_[A-Z0-9_]+),\s*(\w+)\s*(?:;[^\r\n]*)?$/gm)]
    .filter(match => new RegExp(`^${match[2]}::{0,1}\\s*$`, "m").test(headers)).map(match => ({ id: match[1], header: match[2] })) : [];
  let trainers: SceneEffectsDomain["trainers"] = [];
  try {
    const catalog = await parseTrainerBaseCatalog(source, yellow ? "pokeyellow" : "pokered");
    if (!catalog.warnings.length) trainers = catalog.trainers.filter(trainer => trainer.partyNumber >= 1 && trainer.partyNumber <= 255)
      .map(trainer => ({ id: trainer.id, label: `${trainer.className} #${trainer.partyNumber}` }));
  } catch { /* A custom trainer table can disable trainer battles independently. */ }
  return { music, trainers,
    musicReason: reviewed.audio && validMacro && music.length ? null : "Music actions require the reviewed audio routines and symbolic song headers.",
    fadeReason: reviewed.fade ? null : "Screen fades require the reviewed palette routines.",
    battleReason: reviewed.battle ? null : "Battles require the reviewed battle initialization, return and overworld dispatch routines.",
  };
}
