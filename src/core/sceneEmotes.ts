import { hashText } from "./history";

export const NPC_EMOTES: Record<string, string> = {
  EXCLAMATION_BUBBLE: "Exclamation (!)", QUESTION_BUBBLE: "Question (?)", SMILE_BUBBLE: "Smile",
  SKULL_BUBBLE: "Skull", HEART_BUBBLE: "Heart", BOLT_BUBBLE: "Lightning bolt", ZZZ_BUBBLE: "Sleep (Zzz)", FISH_BUBBLE: "Fish",
};

// The native predef owns the OAM overlay and pauses for 60 frames. Red indexes
// a three-entry pointer table; Yellow indexes eight consecutive graphics blocks.
export async function inspectSceneEmotes(byPath: Map<string, string>, symbols: Map<string, number>) {
  const yellow = byPath.has("scripts/OaksLab_2.asm");
  const source = (byPath.get("engine/overworld/emotion_bubbles.asm") ?? "").replace(/\r\n/g, "\n")
    .split("\n").map(line => line.split(";", 1)[0].trim()).filter(Boolean).join("\n");
  const expected = yellow ? "7eb180c23abf4aae71bcf7b0e071736e14585a82f8938dab398375f4fdee7da7" : "e856a9e3be7e8be5b168478b505a536a83ab506caa0a553561f15ea7b4d71ca5";
  const emotes = Object.keys(NPC_EMOTES).slice(0, yellow ? 8 : 3);
  const emoteReason = await hashText(source) !== expected || emotes.some((name, index) => symbols.get(name) !== index)
    ? "NPC emotes require the reviewed emotion-bubble routine and bubble constants. This project's source differs." : null;
  return { emotes: emoteReason ? [] : emotes, emoteReason };
}
