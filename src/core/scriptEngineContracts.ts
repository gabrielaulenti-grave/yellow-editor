import { hashText } from "./history";
import type { ProjectRgbdsSourceFile } from "./projectConstants";

export type ScriptEngineContractId = "yes-no" | "sound-playback" | "sound-wait-before-play" | "sound-wait" | "npc-movement" | "player-movement";
export interface ScriptEngineContract {
  id: ScriptEngineContractId; helpers: string[];
  inputs: string[]; outcomes: string[]; scheduling: string;
  effects: string[]; cleanup: string[]; limitations: string[]; evidence: string[];
}
// Reviewed against the pinned vanilla sources. Recognition is not permission to
// generate arbitrary scenes: source drift and composition remain separate gates.
export const SCRIPT_ENGINE_CONTRACTS: ScriptEngineContract[] = [
  { id: "yes-no", helpers: ["YesNoChoice"], inputs: ["A normal text interaction with a saved screen"],
    outcomes: ["wCurrentMenuItem = 0: Yes", "wCurrentMenuItem = 1: No or B"], scheduling: "Blocks in the menu input loop",
    effects: ["Draws and restores the menu and screen", "Clobbers CPU flags; return carry does not encode the choice"],
    cleanup: ["Read wCurrentMenuItem before another menu overwrites it", "Commit effects only on the intended branch"],
    limitations: ["Other two-option menu variants are outside this contract", "Branch destinations are bound only for an adjacent ld/and/jr-or-jp idiom"],
    evidence: ["choice-entry", "choice-result", "choice-restore", "choice-copy"] },
  { id: "sound-playback", helpers: ["PlaySound", "StopAllMusic"], inputs: ["A: sound ID; active audio bank and fade state"],
    outcomes: ["Requests playback, or stop-all for SFX_STOP_ALL_MUSIC"], scheduling: "Returns without waiting for the cue to finish",
    effects: ["May clear effect channel IDs", "Uses current audio bank; fade state can defer playback", "Preserves BC, DE and HL"],
    cleanup: ["Restore map music explicitly if the scene replaces or stops it"], limitations: ["StopAllMusic is available only in Yellow; Red uses PlaySound with the stop-all ID", "No guarantee of immediate audible playback", "Track-bank allocation and restoration helper contracts still need review"], evidence: ["audio-play"] },
  { id: "sound-wait-before-play", helpers: ["PlaySoundWaitForCurrent"], inputs: ["A: sound ID; current audio context"],
    outcomes: ["Wait for previous effects, then request the new cue", "Low-health alarm bypasses the wait"], scheduling: "Blocks before playback, then returns without waiting for the new cue",
    effects: ["Preserves requested A across the wait", "Then uses PlaySound's effects"], cleanup: ["Use a separate sound wait if a later action needs cue completion"],
    limitations: ["The wait excludes channel 7 and music", "Interrupt-driven audio must be running"], evidence: ["audio-delay", "audio-play"] },
  { id: "sound-wait", helpers: ["WaitForSoundToFinish"], inputs: ["Effect channel IDs and low-health alarm state"],
    outcomes: ["Channels 5, 6 and 8 are zero", "Or low-health alarm bit 7 is set"], scheduling: "Busy-waits while interrupt-driven audio advances",
    effects: ["Clobbers A and flags", "Preserves HL"], cleanup: [], limitations: ["Does not wait for music or channel 7", "Alarm bypass means this is not an unconditional completion guarantee"], evidence: ["audio-delay"] },
  { id: "npc-movement", helpers: ["MoveSprite"], inputs: ["hSpriteIndex: actor slot", "DE: same-bank, $ff-terminated path within the engine buffer capacity"],
    outcomes: ["BIT_SCRIPTED_NPC_MOVEMENT is set on start and cleared when the NPC consumes the terminator"], scheduling: "Asynchronous; wait by returning from a resumable map state while the flag is set",
    effects: ["Copies one shared NPC path buffer", "Locks player input via wJoyIgnore", "Preserves BC and HL; advances DE"],
    cleanup: ["Clear scene input locks after completion", "Restore intended facing and map state"],
    limitations: ["Concurrent NPC paths cannot share this buffer", "Actor availability, path capacity, collision and dispatcher ordering must be checked before generation"], evidence: ["npc-start", "npc-completion"] },
  { id: "player-movement", helpers: ["StartSimulatingJoypadStates"], inputs: ["A preloaded simulated-input buffer and index"],
    outcomes: ["Starts BIT_SCRIPTED_MOVEMENT_STATE", "The overworld clears simulated state and input locks at exhaustion"], scheduling: "Asynchronous; vanilla states yield while wSimulatedJoypadStatesIndex is nonzero",
    effects: ["Clears override mask and player movement byte on start", "Cleanup clears held input, index and scripted movement flag"],
    cleanup: ["Resume through the actual map dispatcher", "Preserve any scene-specific facing and state restoration"],
    limitations: ["Index zero alone does not prove the final walking animation has completed", "Buffer order, step timing and variant-specific dispatcher paths need recipe-level validation"], evidence: ["player-start", "player-completion"] },
];

export const SCRIPT_CONTRACT_SOURCE_PARTS = [
  {
    "id": "choice-entry",
    "path": "home/yes_no.asm",
    "start": "YesNoChoice::",
    "end": null,
    "includeEnd": false,
    "hashes": {
      "pokered": "7691167de6b8cc30f162e4c5250f0f0ba80583c4be936e64defe3c62bfe05285",
      "pokeyellow": "7691167de6b8cc30f162e4c5250f0f0ba80583c4be936e64defe3c62bfe05285"
    }
  },
  {
    "id": "choice-result",
    "path": "engine/menus/text_box.asm",
    "start": "DisplayTwoOptionMenu:",
    "end": "TwoOptionMenu_SaveScreenTiles:",
    "includeEnd": false,
    "hashes": {
      "pokered": "9df70954b7233dd99eeb79ac01a6069239e791352b7823434d8bbe991978239d",
      "pokeyellow": "550275fda50070f005def05d73abf81837310bec597f8ae04c1ace020ddf2e22"
    }
  },
  {
    "id": "choice-restore",
    "path": "home/tilemap.asm",
    "start": "LoadScreenTilesFromBuffer1::",
    "end": null,
    "includeEnd": false,
    "hashes": {
      "pokered": "149fd655df7dd997035328dfd3c3fdae925d488e7798839384d71e4c431baed2",
      "pokeyellow": "149fd655df7dd997035328dfd3c3fdae925d488e7798839384d71e4c431baed2"
    }
  },
  {
    "id": "choice-copy",
    "path": "home/copy.asm",
    "start": "CopyData::",
    "end": null,
    "includeEnd": false,
    "hashes": {
      "pokered": "8096bc38292fcac13db3060f93771d63c335b4bce49bfcc930c6987ead31a9af",
      "pokeyellow": "5a23e131bff2d8beb715b3cf7a718b23cb13fd3a79f735e350928c2520d7f624"
    }
  },
  {
    "id": "audio-delay",
    "path": "home/delay.asm",
    "start": "PlaySoundWaitForCurrent::",
    "end": null,
    "includeEnd": false,
    "hashes": {
      "pokered": "f352042767d49eabbdd7a8fdb16d161305525cf399bfe0b7fd4d0a03b06405ed",
      "pokeyellow": "50f4427c93cfd28cb5c7b7d365e4e084ab0023f811d8da4050bea06532198ba2"
    }
  },
  {
    "id": "audio-play",
    "path": "home/audio.asm",
    "start": "PlayDefaultMusic::",
    "end": null,
    "includeEnd": false,
    "hashes": {
      "pokered": "88b74f29fa028af36d7742039108e3107d7385387679843cabcc4d98150e8f75",
      "pokeyellow": "fe25fb947485084de5d17b38f26dc05efec3d1ecbc4a24aacb3512e86c2bd872"
    }
  },
  {
    "id": "npc-start",
    "path": "home/pathfinding.asm",
    "start": "MoveSprite::",
    "end": "DivideBytes::",
    "includeEnd": false,
    "hashes": {
      "pokered": "9b23622dc2e7c594ac078f4f078b82a30b098951f8ac31b61a5e8fc973d0f56c",
      "pokeyellow": "9b23622dc2e7c594ac078f4f078b82a30b098951f8ac31b61a5e8fc973d0f56c"
    }
  },
  {
    "id": "npc-completion",
    "path": "engine/overworld/movement.asm",
    "start": "UpdateNPCSprite:",
    "end": ".next",
    "includeEnd": false,
    "hashes": {
      "pokered": "6fda7e521b2ca37bea074bfad37bfb041eab3a0ab8d43a41a8c9155047e07481",
      "pokeyellow": "430b5e55edd4e155b04ced2e0bbe9b791cd549ba176cfd286c262c051e03bf81"
    }
  },
  {
    "id": "player-start",
    "path": "home/map_objects.asm",
    "start": "StartSimulatingJoypadStates::",
    "end": "IsItemInBag::",
    "includeEnd": false,
    "hashes": {
      "pokered": "a8ebf7f3e1611404772b8045a5627a3f1477d35c3a58c58a30971f76385c4e4a",
      "pokeyellow": "a8ebf7f3e1611404772b8045a5627a3f1477d35c3a58c58a30971f76385c4e4a"
    }
  },
  {
    "id": "player-completion",
    "path": "home/overworld.asm",
    "start": ".doneSimulating",
    "end": "ret",
    "includeEnd": true,
    "hashes": {
      "pokered": "32ae39dccc19d42b241b18062d7effde5efdc081c1c9dfd3212b1239f7228d02",
      "pokeyellow": "32ae39dccc19d42b241b18062d7effde5efdc081c1c9dfd3212b1239f7228d02"
    }
  }
] as const;

const code = (row: string) => row.split(";")[0].trim(); // Engine evidence contains no quoted semicolons.
export function contractSourcePart(contents: string, part: typeof SCRIPT_CONTRACT_SOURCE_PARTS[number]): { contents: string; line: number } | null {
  const rows = contents.split(/\r?\n/), starts = rows.flatMap((row, i) => code(row) === part.start ? [i] : []);
  if (starts.length !== 1) return null;
  const start = starts[0];
  const end = part.end === null ? rows.length : rows.findIndex((row, i) => i > start && code(row) === part.end);
  if (end < 0) return null;
  return { contents: rows.slice(start, end + (part.includeEnd ? 1 : 0)).map(code).filter(Boolean).join("\n"), line: start + 1 };
}
export async function reviewScriptEngineContracts(files: ProjectRgbdsSourceFile[], game: "pokered" | "pokeyellow") {
  const evidence = await Promise.all(SCRIPT_CONTRACT_SOURCE_PARTS.map(async part => {
    const matches = files.filter(file => file.path === part.path);
    const extracted = matches.length === 1 ? contractSourcePart(matches[0].contents, part) : null;
    const hash = extracted ? await hashText(extracted.contents) : null;
    return { id: part.id, path: part.path, line: extracted?.line ?? null, expectedHash: part.hashes[game], hash,
      matchesReviewedSource: hash === part.hashes[game] };
  }));
  return SCRIPT_ENGINE_CONTRACTS.map(contract => ({ ...contract,
    sourceStatus: contract.evidence.every(id => evidence.find(part => part.id === id)?.matchesReviewedSource) ? "reviewed-source" as const : "source-drift" as const,
    evidence: evidence.filter(part => contract.evidence.includes(part.id)),
    validation: { generation: "not-enabled" as const, runtime: "requires-separate-probe-result" as const },
  }));
}
