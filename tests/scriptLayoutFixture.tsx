import { renderToStaticMarkup } from "react-dom/server";
import { MapScriptPreview } from "../src/MapScriptPreview";
import { ScriptsTab } from "../src/ScriptsTab";

// Eight nested conditions exceed a normal phone's width if each level indents.
const source = ["DeepScript:", ...Array.from({ length: 8 }, (_value, index) =>
  `\tTestEvent EVENT_LEVEL_${index + 1}\n\tret z`), "\tcall YesNoChoice", "\tld a, [wCurrentMenuItem]", "\tand a", "\tjr nz, .declined_this_very_long_scene_choice", "\tld a, SFX_GET_ITEM_1", "\tcall PlaySoundWaitForCurrent", "\tcall WaitForSoundToFinish", "\tld c, 7", "\tcall DelayFrames", ".declined_this_very_long_scene_choice", "\tret", ""].join("\n");
export const flow = renderToStaticMarkup(<MapScriptPreview reference={{
  scriptPath: "scripts/Deep.asm", routineLabel: "DeepScript", mapScriptSource: source,
  eventMacroSemantics: [{ name: "TestEvent", action: "check", eventParameterIndexes: [1],
    zeroMeaning: "event-clear", sourcePath: "macros/events.asm", sourceLine: 1 }],
}} />);
export const tab = renderToStaticMarkup(<ScriptsTab project={{ storageKey: "layout-check" } as never} focus={null} />);
