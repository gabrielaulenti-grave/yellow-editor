import {PersonalTracker,initialPersonalStats,parseSymbols,inspectSymbols,readBeachMemory} from "./play-stats.mjs";

const $=id=>document.getElementById(id);
const keyMap={ArrowUp:"up",ArrowDown:"down",ArrowLeft:"left",ArrowRight:"right",
  KeyX:"a",KeyZ:"b",Enter:"start",ShiftLeft:"select",ShiftRight:"select"};
const buttons=["up","down","left","right","a","b","start","select"];
const frameTicks=4194304;
const maxRomSize=8*1024*1024;
let modPromise,game=null,sourceBytes=null,sourceName="",romKey="",statsTracker=null,
  autoSymbols=null,addresses=null,currentRomHash=null,paused=false,raf=null,
  lastMs=0,leftover=0,elapsed=0;
const number=new Intl.NumberFormat("en-US");
const canvas=$("screen"),ctx=canvas.getContext("2d",{alpha:false});
ctx.imageSmoothingEnabled=false;
ctx.fillStyle="#000";ctx.fillRect(0,0,160,144);
const imageData=ctx.createImageData(160,144);
const note=text=>{$("status").textContent=text;};
const readableError=e=>e instanceof Error?e.message:String(e);
function availableButtons(value) {
  for(const node of document.querySelectorAll("[data-button]"))node.disabled=!value;
}
availableButtons(false);

async function loadBinjgb() {
  if(modPromise)return modPromise;
  modPromise=(async()=>{
    if(!window.Binjgb)await new Promise((resolve,reject)=>{
      const s=document.createElement("script");s.src="/play/binjgb.js";
      s.onload=resolve;s.onerror=()=>reject(new Error("Could not load the Game Boy emulator."));
      document.head.append(s);
    });
    if(typeof window.Binjgb!=="function")throw new Error("binjgb did not register.");
    const mod=await window.Binjgb({locateFile:file=>"/play/"+file});
    if(typeof mod._beach_read_u8!=="function")
      throw new Error("The statistics-ready emulator module was not loaded.");
    return mod;
  })().catch(e=>{modPromise=null;throw e;});
  return modPromise;
}
function cleanHeader(bytes) {
  if(bytes.length<32768||bytes.length>maxRomSize)throw new Error("ROM must be between 32 KiB and 8 MiB.");
  if(bytes[0x148]>0x08)throw new Error("Unrecognized Game Boy cartridge size code.");
}
function isTelemetryRom(bytes) {
  const needle=[80,66,69,65,67,72,49]; // PBEACH1
  for(let i=0;i<bytes.length-needle.length;i++){
    if(bytes[i]===needle[0] && needle.every((b,j)=>bytes[i+j]===b))return true;
  }
  return false;
}
async function fingerprint(bytes) {
  const data=await crypto.subtle.digest("SHA-256",bytes);
  return [...new Uint8Array(data)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function getHostedSymbols() {
  const resp=await fetch("/play/symbols.json",{cache:"no-store"});
  if(!resp.ok)throw new Error("The server's telemetry address map is unavailable.");
  return resp.json();
}
async function selectROM() {
  const file=$("rom").files?.[0];
  if(!file){$("launch").disabled=true;return;}
  try{
    if(file.size>maxRomSize||file.size<32768)throw new Error("ROM size must be 32 KiB–8 MiB.");
    sourceBytes=new Uint8Array(await file.arrayBuffer());
    cleanHeader(sourceBytes);
    sourceName=file.name;
    currentRomHash=await fingerprint(sourceBytes);
    romKey="beach-player-stats-v1:"+currentRomHash;
    try{
      const json=localStorage.getItem(romKey);
      statsTracker=new PersonalTracker(json?JSON.parse(json):initialPersonalStats());
    }catch{statsTracker=new PersonalTracker();}
    renderStats();
    addresses=null;
    if(isTelemetryRom(sourceBytes)){
      const symFile=$("symbols").files?.[0];
      if(symFile){
        if(symFile.size>2*1024*1024)throw new Error("Symbols file is larger than 2 MiB.");
        addresses=inspectSymbols(parseSymbols(await symFile.text()));
      }else{
        const hosted=await getHostedSymbols();
        if(currentRomHash===hosted.sha256)addresses=inspectSymbols(hosted.symbols);
      }
    }
    $("launch").disabled=false;
    note(addresses
      ? "Ready: "+sourceName+". ROM telemetry is available and stays in this browser."
      : "Ready: "+sourceName+". Game will play; detailed scores need the matching telemetry-enabled .sym file or a ROM matching the hosted build.");
  }catch(error){
    addresses=null;
    sourceBytes=null;
    $("launch").disabled=true;
    note("ROM error: "+readableError(error));
  }
}
$("rom").addEventListener("change",()=>{void selectROM()});
$("symbols").addEventListener("change",()=>{if($("rom").files?.length)void selectROM()});
function saveStats(){
  if(!romKey||!statsTracker)return;
  try{localStorage.setItem(romKey,JSON.stringify(statsTracker.stats));}
  catch{note("Browser storage is unavailable. Export your statistics to keep them.");}
}
function fillCounts(id,counts) {
  const root=$(id);root.replaceChildren();
  for(const [key,value] of Object.entries(counts)){
    const span=document.createElement("span");
    span.textContent=key+" ";
    const bold=document.createElement("strong");
    bold.textContent=number.format(value);
    span.append(bold);root.append(span);
  }
}
function renderStats(){
  if(!statsTracker)return;
  const stats=statsTracker.stats;
  $("best").textContent=stats.finished?number.format(stats.bestScore):"—";
  $("finished").textContent=number.format(stats.finished);
  $("attempts").textContent=number.format(stats.total);
  $("average").textContent=stats.finished?number.format(Math.round(stats.scoreSum/stats.finished)):"—";
  fillCounts("landings",stats.landings);
  fillCounts("tricks",Object.fromEntries(Object.entries(stats.tricks).map(([k,v])=>["+"+k,v])));
  for(const id of ["export-json","export-csv","import-json"])$(id).disabled=false;
  const rows=stats.history.slice(-15).reverse();
  const root=$("recent");root.replaceChildren();
  if(!rows.length){const p=document.createElement("p");p.textContent="No completed attempts yet.";root.append(p);return;}
  const table=document.createElement("table"),heading=document.createElement("tr");
  for(const label of ["Date","Score","Result","Radness"]){
    const th=document.createElement("th");th.textContent=label;heading.append(th);
  }
  const thead=document.createElement("thead");thead.append(heading);table.append(thead);
  const tbody=document.createElement("tbody");
  for(const run of rows){
    const tr=document.createElement("tr");
    for(const text of [new Date(run.at).toLocaleString(),number.format(run.score),run.status,number.format(run.radness)]){
      const td=document.createElement("td");td.textContent=text;tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(tbody);root.append(table);
}
function setInput(name,pressed) {
  if(!game)return;
  const method={up:"_set_joyp_up",down:"_set_joyp_down",left:"_set_joyp_left",
    right:"_set_joyp_right",a:"_set_joyp_A",b:"_set_joyp_B",
    start:"_set_joyp_start",select:"_set_joyp_select"}[name];
  game.mod[method](game.emulator,pressed);
  for(const el of document.querySelectorAll("[data-button]"))
    if(el.dataset.button===name)el.classList.toggle("pressed",pressed);
}
function releaseAll() {for(const name of buttons)setInput(name,false);}
function destroy(){
  if(raf!==null){cancelAnimationFrame(raf);raf=null;}
  if(game){
    releaseAll();
    game.mod._joypad_delete(game.joypad);
    game.mod._emulator_delete(game.emulator);
    game.mod._free(game.romPointer);
    game=null;
  }
  $("pause").disabled=true;$("reset").disabled=true;
  availableButtons(false);
  paused=false;lastMs=0;leftover=0;elapsed=0;
}
function sample() {
  if(!addresses||!game?.mod._beach_read_u8)return;
  const observed=readBeachMemory(addr=>game.mod._beach_read_u8(game.emulator,addr),addresses);
  const result=statsTracker.read(observed);
  if(observed.routine===1){
    $("current").textContent="Surfing · HP "+(observed.hp??"—")+" · Radness "+(observed.radness??"—");
  }else if(result){
    $("current").textContent="Last attempt: "+result.status+
      " · "+number.format(result.score)+" points · "+result.radness+" radness";
    saveStats();renderStats();
  }
}
function renderGame(){
  if(!game)return;
  const m=game.mod;
  const fb=new Uint8Array(m.HEAPU8.buffer,game.framePointer,160*144*4);
  imageData.data.set(fb);
  ctx.putImageData(imageData,0,0);
}
function tick(ms){
  if(!game||paused){raf=null;return;}
  raf=requestAnimationFrame(tick);
  if(!lastMs){lastMs=ms;return;}
  const delta=Math.min(.08,Math.max(0,(ms-lastMs)/1000));
  lastMs=ms;
  const m=game.mod;
  const target=m._emulator_get_ticks_f64(game.emulator)+delta*frameTicks*Number($("speed").value)-leftover;
  let frames=0,loop=0;
  for(;;){
    const event=m._emulator_run_until_f64(game.emulator,target);
    if(event&16){note("Emulation encountered an invalid opcode.");pauseGame();break;}
    if(event&1){frames++;sample();}
    if(event&4)break;
    if(++loop>600){note("Emulator stalled.");pauseGame();break;}
  }
  if(game){
    leftover=Math.max(-frameTicks,Math.min(frameTicks,m._emulator_get_ticks_f64(game.emulator)-target));
    if(frames)renderGame();
  }
}
function pauseGame() {
  if(!game)return;
  paused=true;
  if(raf!==null)cancelAnimationFrame(raf);
  raf=null;releaseAll();$("pause").textContent="Resume";
  note("Paused. ROM and personal statistics remain in this browser.");
  saveStats();
}
function resumeGame(){
  if(!game)return;
  paused=false;lastMs=0;
  $("pause").textContent="Pause";raf=requestAnimationFrame(tick);
  note("Playing "+sourceName+(addresses?" · ROM telemetry active":" · visual-only mode"));
}
async function launch() {
  if(!sourceBytes)return;
  $("launch").disabled=true;note("Loading local Game Boy emulator…");
  try{
    const m=await loadBinjgb();
    destroy();
    const ptr=m._malloc(sourceBytes.length);
    if(!ptr)throw new Error("Could not allocate cartridge memory.");
    m.HEAPU8.set(sourceBytes,ptr);
    const e=m._emulator_new_simple(ptr,sourceBytes.length,44100,4096);
    if(!e){m._free(ptr);throw new Error("Emulator rejected this cartridge.");}
    const joypad=m._joypad_new();
    if(!joypad){m._emulator_delete(e);m._free(ptr);throw new Error("Could not allocate joypad.");}
    m._emulator_set_default_joypad_callback(e,joypad);
    const framePointer=m._get_frame_buffer_ptr(e);
    if(m._get_frame_buffer_size(e)!==160*144*4){
      m._joypad_delete(joypad);m._emulator_delete(e);m._free(ptr);
      throw new Error("Unexpected video frame layout.");
    }
    game={mod:m,romPointer:ptr,emulator:e,joypad,framePointer};
    if(statsTracker){statsTracker.current=null;statsTracker.previous=null;}
    availableButtons(true);
    $("pause").disabled=false;$("reset").disabled=false;
    $("launch").textContent="Reload ROM";
    $("launch").disabled=false;
    resumeGame();
  }catch(error){
    $("launch").disabled=false;
    note("Could not start ROM: "+readableError(error));
  }
}
$("launch").addEventListener("click",()=>{void launch()});
$("reset").addEventListener("click",()=>{void launch()});
$("pause").addEventListener("click",()=>{if(paused)resumeGame();else pauseGame()});
$("speed").addEventListener("change",()=>{lastMs=0;leftover=0});
for(const button of document.querySelectorAll("[data-button]")){
  button.addEventListener("pointerdown",event=>{
    event.preventDefault();if(!game)return;
    button.setPointerCapture(event.pointerId);
    setInput(button.dataset.button,true);
  });
  for(const ev of ["pointerup","pointercancel","lostpointercapture"])
    button.addEventListener(ev,event=>{event.preventDefault();setInput(button.dataset.button,false)});
  button.addEventListener("contextmenu",event=>event.preventDefault());
}
window.addEventListener("keydown",event=>{
  if(event.target instanceof HTMLInputElement||event.target instanceof HTMLSelectElement)return;
  const button=keyMap[event.code];
  if(!button||!game)return;
  event.preventDefault();setInput(button,true);
});
window.addEventListener("keyup",event=>{
  const button=keyMap[event.code];
  if(!button||!game)return;
  event.preventDefault();setInput(button,false);
});
window.addEventListener("blur",()=>releaseAll());
document.addEventListener("visibilitychange",()=>{if(document.hidden&&game)pauseGame();});
window.addEventListener("pagehide",()=>saveStats());
function download(name,content,type) {
  const url=URL.createObjectURL(new Blob([content],{type}));
  const a=document.createElement("a");a.href=url;a.download=name;
  document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$("export-json").addEventListener("click",()=>{
  if(!statsTracker)return;
  download("pikachus-beach-personal-stats.json",JSON.stringify({
    exportedAt:new Date().toISOString(),romSha256:currentRomHash,stats:statsTracker.stats
  },null,2),"application/json");
});
$("export-csv").addEventListener("click",()=>{
  if(!statsTracker)return;
  const quote=v=>'"'+String(v??"").replaceAll('"','""')+'"';
  const cols=["at","status","score","radness","clean","rough","hard","wipeout","unknown","50","150","180","350","500"];
  const rows=[cols.map(quote).join(",")];
  for(const run of statsTracker.stats.history)
    rows.push([run.at,run.status,run.score,run.radness,
      ...["clean","rough","hard","wipeout","unknown"].map(k=>run.landings?.[k]||0),
      ...["50","150","180","350","500"].map(k=>run.tricks?.[k]||0)].map(quote).join(","));
  download("pikachus-beach-personal-runs.csv",rows.join("\r\n"),"text/csv");
});
$("import-json").addEventListener("click",()=>$("stats-file").click());
$("stats-file").addEventListener("change",async event=>{
  const file=event.target.files?.[0];event.target.value="";
  if(!file||!statsTracker||file.size>3_000_000)return;
  try{
    const obj=JSON.parse(await file.text());
    if(obj.romSha256!==currentRomHash)throw new Error("These stats belong to a different ROM.");
    const stats=obj.stats;
    if(stats?.schema!==1||!Array.isArray(stats.history)||
       !Number.isSafeInteger(stats.total)||stats.total<0||
       !Number.isSafeInteger(stats.bestScore)||stats.bestScore<0)
      throw new Error("Invalid statistics file.");
    if(!confirm("Replace local statistics for this ROM with the imported file?"))return;
    statsTracker=new PersonalTracker(stats);
    saveStats();renderStats();note("Imported statistics for "+sourceName+".");
  }catch(error){note("Import failed: "+readableError(error));}
});
