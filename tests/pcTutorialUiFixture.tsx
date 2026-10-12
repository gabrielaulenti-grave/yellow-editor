import { useState } from "react";
import { createRoot } from "react-dom/client";
import { PcTutorialWizard } from "./PcTutorialRecipeWizard";
import { loadPcTutorialDocument,preparePcTutorialWrites } from "./recipes/pcTutorial";
import { hashText } from "../src/core/history";
import type { ProjectSource,TextWriteRequest } from "../src/core/types";
const fixture=window as unknown as {tutorialFiles:Record<string,string>;tutorialBytes:Record<string,number[]>;tutorialInvoke:(command:string,args?:Record<string,unknown>)=>Promise<unknown>;tutorialHistory:Array<Record<string,string>>;tutorialWrites:TextWriteRequest[][]};
fixture.tutorialHistory=[];fixture.tutorialWrites=[];
const source:ProjectSource={readText:async p=>{if(!(p in fixture.tutorialFiles))throw new Error(`Missing ${p}`);return fixture.tutorialFiles[p];},readBytes:async p=>new Uint8Array(fixture.tutorialBytes[p]),listFiles:async()=>Object.keys(fixture.tutorialFiles),exists:async p=>p in fixture.tutorialFiles};
fixture.tutorialInvoke=async(command,args)=>{
 if(command==="get_pc_tutorial_document")return loadPcTutorialDocument(source);
 if(command==="save_pc_tutorial"){
  const writes=await preparePcTutorialWrites(source,args!.document as never,args!.values as never);
  for(const w of writes)if(await hashText(fixture.tutorialFiles[w.path])!==w.expectedHash)throw new Error("Source changed before history commit.");
  fixture.tutorialHistory.push(Object.fromEntries(writes.map(w=>[w.path,fixture.tutorialFiles[w.path]])));fixture.tutorialWrites.push(writes);
  writes.forEach(w=>{fixture.tutorialFiles[w.path]=w.contents;});return {canUndo:true,canRedo:false};
 }
 throw new Error(`Unexpected ${command}`);
};
function Fixture(){const [open,setOpen]=useState(false),[saved,setSaved]=useState(0);return <><button onClick={()=>setOpen(true)}>PC tutorial</button><button onClick={()=>{const old=fixture.tutorialHistory.pop();if(old)Object.assign(fixture.tutorialFiles,old);setSaved(s=>s-1);}}>Undo tutorial</button><p role="status">Saved {saved}</p>{open&&<PcTutorialWizard onClose={()=>setOpen(false)} onSaved={()=>{setOpen(false);setSaved(s=>s+1);}}/>}</>;}
createRoot(document.getElementById("root")!).render(<Fixture/>);
