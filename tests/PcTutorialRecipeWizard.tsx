import { useEffect,useState } from "react";
import type { PcTutorialDocument,PcTutorialValues } from "./recipes/pcTutorial";
import type { HistorySummary } from "../src/core/types";
import { invoke } from "../src/platform/compat";
import { SearchableSelect } from "../src/editor/SearchableSelect";

export function PcTutorialWizard({onClose,onSaved}:{onClose:()=>void;onSaved:(history:HistorySummary)=>void}) {
 const [document,setDocument]=useState<PcTutorialDocument|null>(null),[values,setValues]=useState<PcTutorialValues|null>(null);
 const [error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false),[review,setReview]=useState(false);
 useEffect(()=>{let cancelled=false;void invoke<PcTutorialDocument>("get_pc_tutorial_document").then(d=>{if(!cancelled){setDocument(d);setValues(d.values);}}).catch(e=>{if(!cancelled)setError(String(e));});return()=>{cancelled=true;};},[]);
 const dirty=document&&values&&JSON.stringify(document.values)!==JSON.stringify(values);
 const close=()=>{if(!busy&&(!dirty||window.confirm("Discard these tutorial changes?")))onClose();};
 const update=(patch:Partial<PcTutorialValues>)=>{setValues(v=>v?{...v,...patch}:null);setReview(false);};
 async function save(){if(!document||!values)return;setBusy(true);setError(null);try{const history=await invoke<HistorySummary>("save_pc_tutorial",{document,values});onSaved(history);}catch(e){setError(String(e));setReview(false);}finally{setBusy(false);}}
 return <div className="text-editor-backdrop"><section className="text-editor-dialog" role="dialog" aria-modal="true" aria-label="PC tutorial">
  <div className="text-editor-dialog-heading"><h3>{document?.existing?"Edit PC tutorial":"Create PC tutorial"}</h3><button className="small-button" disabled={busy} onClick={close}>Close</button></div>
  {!document&&!error&&<p>Checking the Pokémon Center, storage routines, walking routes and save flags…</p>}
  {error&&<p className="text-editor-error" role="alert">{error}</p>}
  {document&&values&&<div className="interaction-fields">
   <p>A first-entry lesson in Viridian City's Pokémon Center. The mentor introduces gym badges, escorts the player to the PC and gives one Pokémon directly to the current box.</p>
   {!review?<>
    <label>Mentor sprite<SearchableSelect aria-label="Tutorial mentor" value={values.sprite} disabled={busy||document.existing} onChange={e=>update({sprite:e.target.value})}>{document.sprites.map(s=><option key={s} value={s}>{s.replace(/^SPRITE_/,"").replace(/_/g," ")}</option>)}</SearchableSelect></label>
    <label>Gift Pokémon<SearchableSelect aria-label="Tutorial gift Pokémon" value={values.species} disabled={busy} onChange={e=>update({species:e.target.value})}>{document.pokemon.map(s=><option key={s} value={s}>{s.replace(/_/g," ")}</option>)}</SearchableSelect></label>
    <label>Gift level<input aria-label="Tutorial gift level" type="number" min={1} max={100} value={values.level} disabled={busy} onChange={e=>update({level:Number(e.target.value)})}/></label>
    {([['intro','Introduction and offer'],['instructions','PC instructions'],['completion','Completion dialogue']] as const).map(([key,title])=><label key={key}>{title}<textarea aria-label={title} rows={5} disabled={busy} value={values[key].join("\n")} onChange={e=>update({[key]:e.target.value.split("\n")})}/></label>)}
    <p className="help-text">One game text row per line: up to 18 spaces on the first row and 17 on later rows. &lt;PLAYER&gt; is supported. If you change the mentor sprite, update the name in the introduction too.</p>
    <button className="small-button primary-action" disabled={busy||Boolean(document.existing&&!dirty)} onClick={()=>setReview(true)}>Review tutorial</button>
   </>:<>
    <p><strong>{values.species.replace(/_/g," ")} · Lv. {values.level}</strong> will go directly to the player's current PC box. The party stays unchanged until the player withdraws it.</p>
    <ol>{document.steps.map(s=><li key={s.action}>{s.description}</li>)}</ol>
    <p>No or B declines the lesson. A full box leaves the gift unclaimed; cancelling the PC lets the player resume later. Releasing the gift ends its lesson without awarding another Pokémon.</p>
    <p>The mentor stays available after the lesson. Creation saves the mentor, dialogue, map states and storage hooks together as one undoable change.</p>
    <div className="text-editor-actions"><button className="small-button" disabled={busy} onClick={()=>setReview(false)}>Back</button><button className="small-button primary-action" disabled={busy} onClick={()=>void save()}>{busy?"Saving…":document.existing?"Save tutorial":"Create tutorial"}</button></div>
   </>}
  </div>}
 </section></div>;
}
