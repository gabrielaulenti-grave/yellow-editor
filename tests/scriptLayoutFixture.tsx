import { renderToStaticMarkup } from "react-dom/server";
import { MapScriptPreview } from "../src/MapScriptPreview";
import { ScriptsTab } from "../src/ScriptsTab";

// Eight nested conditions exceed a normal phone's width if each level indents.
const source = ["DeepScript:", ...Array.from({ length: 8 }, (_value, index) =>
  `\tTestEvent EVENT_LEVEL_${index + 1}\n\tret z`), "\tld c, 7", "\tcall DelayFrames", "\tret", ""].join("\n");
export const flow = renderToStaticMarkup(<MapScriptPreview reference={{
  scriptPath: "scripts/Deep.asm", routineLabel: "DeepScript", mapScriptSource: source,
  eventMacroSemantics: [{ name: "TestEvent", action: "check", eventParameterIndexes: [1],
    zeroMeaning: "event-clear", sourcePath: "macros/events.asm", sourceLine: 1 }],
}} />);
export const tab = renderToStaticMarkup(<ScriptsTab project={{ storageKey: "layout-check" } as never} focus={null} />);
