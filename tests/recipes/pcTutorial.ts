import { hashText } from "../../src/core/history";
import { loadMapNpcCreateDocument, prepareMapNpcWrites } from "../../src/core/npcCreation";
import { evaluateRgbdsExpression, projectConstantCatalogFromSources, readProjectRgbdsSources } from "../../src/core/projectConstants";
import { applyTextDocumentEdits, parseTextDocument } from "../../src/core/textEditing";
import { PC_TUTORIAL_EVIDENCE } from "./pcTutorialEvidence";
import type { MapNpcCreateDocument, ProjectSource, TextWriteRequest } from "../../src/core/types";

export interface PcTutorialValues {
  species: string; level: number; sprite: string;
  intro: string[]; instructions: string[]; completion: string[];
}
export interface TutorialRoute {
  x: number; y: number; approach: string[]; escort: string[]; player: string[];
  guard: Array<{x: number; y: number}>;
}
export interface PcTutorialModel {
  version: 1; prefix: string; npcId: number; npcLabel: string; npcConstant: string;
  eventStart: number; game: "pokered" | "pokeyellow"; values: PcTutorialValues;
  routes: TutorialRoute[][]; returns: string[][];
  frozen: Array<{id: number; direction: string}>;
  dependencies: Array<{path: string; hash: string}>;
}
export interface PcTutorialDocument {
  mapConstant: "VIRIDIAN_POKECENTER"; sources: Array<{path: string; hash: string}>;
  pokemon: string[]; sprites: string[]; values: PcTutorialValues; existing: boolean;
  model: PcTutorialModel | null; npc: MapNpcCreateDocument | null;
  steps: Array<{action: string; description: string}>;
}
const scriptPath = "scripts/ViridianPokecenter.asm";
const objectPath = "data/maps/objects/ViridianPokecenter.asm";
const marker = "; yellow-editor-pc-tutorial: ";
const clean = (row: string) => row.split(";")[0].trim();
const normalized = (text: string) => text.split(/\r?\n/).map(clean).filter(Boolean).join("\n");
const dirs: Record<string, {x:number;y:number}> = { UP:{x:0,y:-1}, DOWN:{x:0,y:1}, LEFT:{x:-1,y:0}, RIGHT:{x:1,y:0} };
const reverse = (path: string[]) => path.slice().reverse().map(d => ({UP:"DOWN",DOWN:"UP",LEFT:"RIGHT",RIGHT:"LEFT"})[d as "UP"]);
const slot = (id: number) => id.toString(10).padStart(2,"0").toUpperCase();
function routine(text: string, label: string) {
  const rows = text.split(/\r?\n/), start = rows.findIndex(row => new RegExp(`^${label}:{1,2}$`).test(clean(row)));
  if (start < 0 || rows.filter(row => new RegExp(`^${label}:{1,2}$`).test(clean(row))).length !== 1) throw new Error(`Expected one ${label} routine.`);
  let end = start+1;
  while (end < rows.length && !/^[A-Za-z_][A-Za-z0-9_]*:{1,2}$/.test(clean(rows[end]))) end++;
  return rows.slice(start,end).join("\n");
}
const defaults = (): PcTutorialValues => ({species:"DRATINI",level:5,sprite:"SPRITE_LANCE",
  intro:["LANCE: Hello,","<PLAYER>!","I'm LANCE.","Earn eight BADGES","to challenge the","POKéMON LEAGUE.","Want a partner","and a PC lesson?"],
  instructions:["Your gift is in","the PC BOX.","Choose the first","PC. Use WITHDRAW.","Take your partner","out of the BOX."],
  completion:["Well done!","Your new partner","is ready to go.","Good luck earning","those BADGES!"] });
export const PC_TUTORIAL_STEPS = [
  {action:"first-entry",description:"Introduce the mentor once; talking to the mentor resumes later."},
  {action:"choice",description:"Yes begins the lesson. No or B restores normal play."},
  {action:"escort",description:"Walk the mentor and player to the PC in separate resumable states."},
  {action:"gift-to-box",description:"Place one owned Pokémon directly in the current box, with its normal naming screen."},
  {action:"pc-session",description:"Use the real PC menus; full parties, box changes and cancellation remain supported."},
  {action:"withdrawal",description:"Confirm the exact gift's successful transfer; track shifting box slots across saves."},
  {action:"cleanup",description:"Return the mentor, restore NPC movement and input, and resume map music."},
];
function parsedModel(text: string): PcTutorialModel | null {
  const rows = text.split(/\r?\n/).filter(row=>row.trimStart().startsWith(marker));
  if (!rows.length) return null;
  if (rows.length!==1) throw new Error("More than one managed PC tutorial was found.");
  const m = JSON.parse(rows[0].trimStart().slice(marker.length)) as PcTutorialModel;
  if (m.version!==1 || m.prefix!=="ViridianPokecenterEditorPcTutorial" || !Number.isInteger(m.eventStart) || m.eventStart%8!==0 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(m.npcLabel) || !/^[A-Z0-9_]+$/.test(m.npcConstant)) throw new Error("Unsupported PC tutorial metadata.");
  return m;
}
export function renderPcTutorialHook(kind: "insert"|"remove"|"withdraw", m: PcTutorialModel) {
  return `\t; yellow-editor-pc-hook ${kind}\n\tpush af\n\tpush bc\n\tpush de\n\tpush hl\n\tfarcall ${m.prefix}${{insert:"BoxInsert",remove:"BoxRemove",withdraw:"WithdrawCommit"}[kind]}\n\tpop hl\n\tpop de\n\tpop bc\n\tpop af\n\t; yellow-editor-pc-hook-end ${kind}\n`;
}
function unhook(text: string, m: PcTutorialModel) {
  for (const kind of ["insert","remove","withdraw"] as const) {
    const expected=renderPcTutorialHook(kind,m).replace(/\n/g,text.includes("\r\n")?"\r\n":"\n");
    if (text.includes(`; yellow-editor-pc-hook ${kind}`)) {
      if (text.split(expected).length!==2) throw new Error("A generated PC storage hook was changed. Review its source before editing.");
      text=text.replace(expected,"");
    }
  }
  return text;
}
async function inspect(source: ProjectSource) {
  const files=await readProjectRgbdsSources(source);
  if (files.some(f=>f.readError)) throw new Error("All tutorial dependencies must be readable.");
  const byPath=new Map(files.map(f=>[f.path,f.contents]));
  const read=(p:string)=>{const s=byPath.get(p);if(s===undefined)throw new Error(`Missing tutorial dependency ${p}.`);return s;};
  const model=parsedModel(read(scriptPath));
  const game: "pokered" | "pokeyellow"=byPath.has("scripts/OaksLab_2.asm")?"pokeyellow":"pokered";
  for (const e of PC_TUTORIAL_EVIDENCE) {
    const path=typeof e.path === "string" ? e.path : e.path[game];
    let text=model?unhook(read(path),model):read(path);
    if(model) for (const name of ["SetPokedexOwnedFlag", "SendNewMonToBox", "LoadEnemyMonData"]) text=text.replace(`${name}::`, `${name}:`);
    if (await hashText(normalized(e.label?routine(text,e.label):text))!==e.hashes[game]) throw new Error(`PC tutorial creation needs the reviewed ${e.id} engine contract. ${path} differs.`);
  }
  if (!model && normalized(routine(read(scriptPath),"ViridianPokecenter_Script"))!=="ViridianPokecenter_Script:\ncall Serial_TryEstablishingExternallyClockedConnection\njp EnableAutoTextBoxDrawing") throw new Error("This Pokémon Center already has custom entry logic. Review it before adding a tutorial.");
  const constants=projectConstantCatalogFromSources(files.filter(f=>f.path.startsWith("constants/")));
  const symbols=new Map(constants.constants.map(c=>[c.symbol,c.value]));
  let eventValue=0;
  for (const row of read("constants/event_constants.asm").split(/\r?\n/)) {
    const code=clean(row), directive=code.match(/^(const_def|const_next|const_skip)(?:\s+(.+))?$/);
    if(directive) {
      const value=evaluateRgbdsExpression(directive[2]??(directive[1]==="const_def"?"0":"1"),symbols);
      if(value===null)throw new Error("Cannot derive the event array capacity.");
      eventValue=directive[1]==="const_skip"?eventValue+value:value;
    }
    if(/^const EVENT_\w+$/.test(code))eventValue++;
    const snapshot=code.match(/^DEF (\w+) EQU (.*\bconst_value\b.*)$/);
    if(snapshot){const value=evaluateRgbdsExpression(snapshot[2].replace(/\bconst_value\b/g,String(eventValue)),symbols);if(value!==null)symbols.set(snapshot[1],value);}
  }
  const dex=read("data/pokemon/dex_order.asm").split(/\r?\n/).flatMap(row=>{const m=clean(row).match(/^db (.+)$/);return m?[evaluateRgbdsExpression(m[1],symbols)]:[];});
  const pokemon=constants.constants.filter(c=>c.sourcePath==="constants/pokemon_constants.asm"&&c.groupId!==null&&c.value>0&&(dex[c.value-1]??0)>0&&(dex[c.value-1]??Infinity)<=(symbols.get("NUM_POKEMON")??151)).map(c=>c.symbol);
  const npc=model?null:await loadMapNpcCreateDocument(source,"VIRIDIAN_POKECENTER");
  const sprites=npc?.sprites??[model!.values.sprite];
  const assets=["maps/ViridianPokecenter.blk","gfx/blocksets/pokecenter.bst"];
  const assetBytes=await Promise.all(assets.map(p=>source.readBytes(p)));
  if(model) {
    if(!Array.isArray(model.dependencies)||model.dependencies.length!==3)throw new Error("Missing tutorial route dependencies.");
    for(const dependency of model.dependencies) {
      const current=assets.includes(dependency.path)?JSON.stringify([...assetBytes[assets.indexOf(dependency.path)]]):dependency.path===objectPath?read(objectPath):null;
      if(current===null||await hashText(current)!==dependency.hash)throw new Error("The Pokémon Center objects or terrain changed after this tutorial was created. Review its routes before editing the recipe.");
    }
  }
  if(model) {
    const charmap=files.find(f=>f.path.endsWith("charmap.asm"))?.contents??"";
    const expected=renderPcTutorialScene(model,charmap);
    replaceManaged(read(scriptPath),`; yellow-editor-pc-scene-start ${model.prefix}`,`; yellow-editor-pc-scene-end ${model.prefix}`,expected,expected);
    const storage=renderPcTutorialStorage(model);
    replaceManaged(read(scriptPath),`; yellow-editor-pc-storage-start ${model.prefix}`,`; yellow-editor-pc-storage-end ${model.prefix}`,storage,storage);
  }
  const snapshots=[...await Promise.all(files.map(async f=>({path:f.path,hash:await hashText(f.contents)}))),...await Promise.all(assets.map(async(p,i)=>({path:p,hash:await hashText(JSON.stringify([...assetBytes[i]]))})))];
  const document: PcTutorialDocument={mapConstant:"VIRIDIAN_POKECENTER",sources:snapshots,pokemon,sprites,values:model?.values??defaults(),existing:Boolean(model),model,npc,steps:PC_TUTORIAL_STEPS};
  return {files,byPath,read,model,game,symbols,constants,document,assetBytes};
}
export async function loadPcTutorialDocument(source: ProjectSource): Promise<PcTutorialDocument> { return (await inspect(source)).document; }
export function tutorialPath(start: {x:number;y:number}, goal: {x:number;y:number}, walkable: (x:number,y:number)=>boolean, blocked: Array<{x:number;y:number}>) {
  const queue=[{...start,path:[] as string[]}], seen=new Set([`${start.x},${start.y}`]);
  for (let i=0;i<queue.length;i++) for (const [dir,d] of Object.entries(dirs)) {
    const n={x:queue[i].x+d.x,y:queue[i].y+d.y,path:[...queue[i].path,dir]}, key=`${n.x},${n.y}`;
    if (seen.has(key)||!walkable(n.x,n.y)||blocked.some(b=>b.x===n.x&&b.y===n.y))continue;
    if(n.x===goal.x&&n.y===goal.y)return n.path;
    seen.add(key);queue.push(n);
  }
  if(start.x===goal.x&&start.y===goal.y)return [];
  throw new Error(`No safe tutorial route to (${goal.x}, ${goal.y}).`);
}
function points(start:{x:number;y:number},path:string[]) {let p={...start};return path.map(dir=>{p={x:p.x+dirs[dir].x,y:p.y+dirs[dir].y};return p;});}
function allocateEvents(state: Awaited<ReturnType<typeof inspect>>) {
  const capacity=state.symbols.get("NUM_EVENTS");
  if(!capacity||capacity%8||!state.read("ram/wram.asm").includes("wEventFlags:: flag_array NUM_EVENTS"))throw new Error("Cannot reserve tutorial data in the existing save layout.");
  const events=state.constants.constants.filter(c=>c.symbol.startsWith("EVENT_")).map(c=>c.value);
  const high=Math.max(...state.constants.constants.filter(c=>c.symbol.startsWith("EVENT_")&&c.groupId!==null).map(c=>c.value));
  for(let start=capacity-24;start>high;start-=8) {
    if(events.some(e=>e>=start&&e<start+24))continue;
    const byte=start/8;
    if(state.files.some(f=>new RegExp(`wEventFlags\\s*\\+\\s*(?:\\$(?:${[byte,byte+1,byte+2].map(b=>b.toString(16)).join("|")})|(?:${byte}|${byte+1}|${byte+2}))\\b`,"i").test(f.contents)))continue;
    if(state.files.some(f=>!f.path.startsWith("macros/")&&f.contents.split(/\r?\n/).some(row=>{
      const m=clean(row).match(/^(?:Set|Reset)EventRange\s+([^,]+),\s*([^,]+)(?:,.*)?$/);if(!m)return false;
      const a=evaluateRgbdsExpression(m[1],state.symbols),b=evaluateRgbdsExpression(m[2],state.symbols);return a===null||b===null||a<start+24&&b>=start;
    })))continue;
    return start;
  }
  throw new Error("The existing event array has no verified three-byte tutorial region. No save-layout expansion was attempted.");
}
function text(label:string,input:string[],charmap:string) {
  if(!Array.isArray(input)||input.length<1||input.length>16||input.some(s=>typeof s!=="string"||/[\r\n@\\"]/u.test(s))||!input.some(s=>s.trim()))throw new Error("Enter 1–16 dialogue rows without embedded control codes.");
  const chars=new Set([...charmap.matchAll(/^\s*charmap "([^"\\])",\s*\$([\da-f]{2})\b/gmi)].filter(m=>parseInt(m[2],16)>=0x60||m[1]==="#"&&m[2]==="54").map(m=>m[1]));
  if(input.some(s=>s.replace(/<PLAYER>/g,"").includes("<")||[...s.replace(/<PLAYER>/g,"")].some(c=>!chars.has(c))))throw new Error("Tutorial dialogue uses characters or tokens unavailable in this game.");
  const segments=input.map((text,i)=>({control:i===0?"text" as const:i===1?"line" as const:"cont" as const,text}));
  try { return applyTextDocumentEdits(`${label}:\n${segments.map(s=>`\t${s.control} ""`).join("\n")}\n\tdone\n`,label,segments); } catch(error) { throw new Error(`${label}: ${String(error)}`); }
}

export function renderPcTutorialStorage(m: PcTutorialModel) {
  const p=m.prefix, base=m.eventStart/8, data=`wEventFlags + ${base}`, box=`wEventFlags + ${base+1}`, index=`wEventFlags + ${base+2}`;
  // RAM inputs are loaded by the caller before farcall, which overwrites B/HL.
  return [`; yellow-editor-pc-storage-start ${p}`,`${p}GiveToBox::`,
    "\tcall EnableAutoTextBoxDrawing","\tld a, [wBoxCount]","\tcp MONS_PER_BOX","\tret nc",
    "\txor a","\tld [wMonDataLocation], a","\tld [wEnemyBattleStatus3], a","\tld a, [wCurPartySpecies]","\tld [wEnemyMonSpecies2], a",
    "\tcallfar LoadEnemyMonData","\tfarcall SetPokedexOwnedFlag","\tcallfar SendNewMonToBox","\tscf","\tret", "",
    `${p}MatchBox::`,`\tld a, [${data}]`,"\tand $0e","\tcp $02","\tjr nz, .no",`\tld a, [${box}]`,"\tand BOX_NUM_MASK","\tld b, a","\tld a, [wCurrentBoxNum]","\tand BOX_NUM_MASK","\tcp b","\tjr nz, .no","\tscf","\tret",".no","\tand a","\tret","",
    `${p}BoxInsert::`,`\tcall ${p}MatchBox`,`\tret nc`,`\tld hl, ${index}`,"\tinc [hl]","\tret","",
    `${p}BoxRemove::`,"\tld a, [wRemoveMonFromBox]","\tand a","\tret z",`\tcall ${p}MatchBox`,`\tret nc`,`\tld a, [${index}]`,"\tld b, a","\tld a, [wWhichPokemon]","\tcp b","\tjr c, .shift","\tret nz",`\tld hl, ${data}`,"\tset 3, [hl]","\tret",".shift",`\tld hl, ${index}`,"\tdec [hl]","\tret","",
    `${p}WithdrawCommit::`,"\tret c",`\tcall ${p}MatchBox`,`\tret nc`,`\tld a, [${index}]`,"\tld b, a","\tld a, [wWhichPokemon]","\tcp b","\tret nz",`\tld hl, ${data}`,"\tset 2, [hl]","\tret",`; yellow-editor-pc-storage-end ${p}`,""].join("\n");
}
const stepText=(p:string,s:string)=>[`\tld hl, ${p}${s}Text`,"\tcall PrintText"];
export function renderPcTutorialScene(m: PcTutorialModel,charmap:string) {
  const p=m.prefix, base=m.eventStart/8, data=`wEventFlags + ${base}`, box=`wEventFlags + ${base+1}`, index=`wEventFlags + ${base+2}`, npcSlot=slot(m.npcId);
  const phase=(n:number)=>[`\tld a, [${data}]`,`\tand $0f`,...(n?[`\tor $${(n<<4).toString(16)}`]:[]),`\tld [${data}], a`];
  const npcWait=["\tld a, [wStatusFlags5]","\tbit BIT_SCRIPTED_NPC_MOVEMENT, a","\tret nz"];
  const code=[`; yellow-editor-pc-scene-start ${p}`,marker+JSON.stringify(m),`${p}Dispatch:`,"\tld hl, wCurrentMapScriptFlags","\tbit BIT_CUR_MAP_LOADED_1, [hl]","\tjr z, .dispatch","\tres BIT_CUR_MAP_LOADED_1, [hl]","\tres BIT_CUR_MAP_LOADED_2, [hl]",`\tcall ${p}Cleanup`,".dispatch",`\tld a, [${data}]`,"\tswap a","\tand $0f","\tcp 13",`\tjp nc, ${p}Cleanup`,`\tld hl, ${p}ScriptPointers`,"\tjp CallFunctionInTable","",`${p}ScriptPointers:`,"\tdef_script_pointers",
    ...["Idle","ApproachStart","Choice","EscortStart","EscortWait","PlayerStart","Gift","PcSession","ReturnPcStart","ReturnPcWait","ReturnApproachStart","ReturnApproachWait","Cleanup"].map(name=>`\tdw_const ${p}${name}, SCRIPT_${p.toUpperCase()}_${name.toUpperCase()}`),"",
    `${p}Idle:`,`\tld a, [${data}]`,"\tand $01","\tret nz","\tld a, [wWalkCounter]","\tand a","\tret nz","\tld a, [wYCoord]","\tcp 6","\tjr z, .x","\tcp 7","\tret nz",".x","\tld a, [wXCoord]","\tcp 3","\tjr z, .start","\tcp 4","\tret nz",".start",...phase(1),"\tld a, $ff","\tld [wJoyIgnore], a","\tret","",
    `${m.npcLabel}:`,"\ttext_asm",`\tld a, [${data}]`,"\tand $f0",`\tjp nz, ${p}TalkBusy`,`\tld a, [${data}]`,"\tbit 2, a",`\tjp nz, ${p}TalkDone`,"\tbit 3, a",`\tjp nz, ${p}TalkLost`,...phase(1),"\tld a, $ff","\tld [wJoyIgnore], a","\tjp TextScriptEnd",
    `${p}TalkBusy:`,...stepText(p,"Busy"),"\tjp TextScriptEnd",`${p}TalkDone:`,...stepText(p,"Complete"),"\tjp TextScriptEnd",`${p}TalkLost:`,...stepText(p,"Lost"),"\tjp TextScriptEnd","",
    `${p}ApproachStart:`,...m.frozen.flatMap(n=>[`\tld a, NONE`,`\tld [wMapSpriteData + ${(n.id-1)*2+1}], a`,`\tld a, [wSprite${slot(n.id)}StateData1MovementStatus]`,`\tcp 3`,`\tret z`]),
    `\tld a, [wSprite${npcSlot}StateData1MovementStatus]`,"\tand a","\tret z",`\tld a, [wSprite${npcSlot}StateData2MapX]`,"\tcp 10",`\tjp nz, ${p}Blocked`,`\tld a, [wSprite${npcSlot}StateData2MapY]`,"\tcp 9",`\tjp nz, ${p}Blocked`,
    "\tld c, 0",`\tcall ${p}SelectRoute`,`\tjp nc, ${p}Blocked`,`\tld a, [${box}]`,"\tand BOX_NUM_MASK",`\tld [${box}], a`,
    "\tld c, 3",`\tcall ${p}SelectRoute`,`\tcall ${p}RouteClear`,"\tjr c, .routeReady",`\tld hl, ${box}`,"\tset 7, [hl]","\tld c, 3",`\tcall ${p}SelectRoute`,`\tcall ${p}RouteClear`,`\tjp nc, ${p}Blocked`,".routeReady","\tld c, 0",`\tcall ${p}SelectRoute`,`\tcall ${p}MoveNpc`,...phase(2),"\tret","",
    `${p}Choice:`,...npcWait,`\tcall ${p}FacePlayer`,...stepText(p,"Intro"),`\tld hl, ${data}`,"\tset 0, [hl]","\tcall YesNoChoice","\tld a, [wCurrentMenuItem]","\tand a","\tjr nz, .no",...phase(3),"\tret",".no",...phase(10),"\tret","",
    `${p}EscortStart:`,"\tld c, 1",`\tcall ${p}SelectRoute`,`\tjp nc, ${p}Blocked`,`\tcall ${p}MoveNpc`,...phase(4),"\tret","",
    `${p}EscortWait:`,...npcWait,`\tld a, ${m.npcConstant}`,"\tldh [hSpriteIndex], a","\tld a, SPRITE_FACING_RIGHT","\tldh [hSpriteFacingDirection], a","\tcall SetSpriteFacingDirectionAndDelay",...phase(5),"\tret","",
    `${p}PlayerStart:`,"\tld c, 2",`\tcall ${p}SelectRoute`,`\tjp nc, ${p}Blocked`,`\tld a, [de]`,`\tinc de`,`\tld [wSimulatedJoypadStatesIndex], a`,`\tld hl, wSimulatedJoypadStatesEnd`,"\tld c, a", ".copy", "\tld a, [de]","\tinc de","\tld [hli], a","\tdec c","\tjr nz, .copy","\tcall StartSimulatingJoypadStates",...phase(6),"\tret","",
    `${p}Gift:`,"\tld a, [wSimulatedJoypadStatesIndex]","\tand a","\tret nz","\tld a, [wWalkCounter]","\tand a","\tret nz","\tld a, [wStatusFlags5]","\tbit BIT_SCRIPTED_MOVEMENT_STATE, a","\tret nz","\tld a, $ff","\tld [wJoyIgnore], a","\tld a, SPRITE_FACING_UP","\tld [wSpritePlayerStateData1FacingDirection], a",`\tld a, [${data}]`,"\tbit 1, a","\tjr nz, .instructions",
    `\tld a, ${m.values.species}`,"\tld [wCurPartySpecies], a",`\tld a, ${m.values.level}`,"\tld [wCurEnemyLevel], a",`\tfarcall ${p}GiveToBox`,`\tjr nc, .full`,
    `\tld a, [${box}]`,"\tand $80","\tld b, a","\tld a, [wCurrentBoxNum]","\tand BOX_NUM_MASK","\tor b",`\tld [${box}], a`,`\txor a`,`\tld [${index}], a`,`\tld hl, ${data}`,"\tset 1, [hl]",".instructions",`\tcall ${p}BoxHint`,...stepText(p,"Instructions"),...phase(7),"\tret",".full",...stepText(p,"Full"),...phase(8),"\tret","",
    `${p}PcSession:`,"\tfarcall ActivatePC", "\tcall EnableAutoTextBoxDrawing",`\tld a, [${data}]`,"\tbit 2, a","\tjr z, .notWithdrawn",...stepText(p,"Complete"),"\tjr .return",".notWithdrawn","\tbit 3, a","\tjr z, .cancelled",...stepText(p,"Lost"),"\tjr .return",".cancelled",...stepText(p,"Resume"),".return",...phase(8),"\tret","",
    `${p}ReturnPcStart:`,`\tld a, [${box}]`,"\tbit 7, a",`\tld de, ${p}Return0`,`\tjr z, .move`,`\tld de, ${p}Return1`,".move",`\tcall ${p}MoveNpc`,...phase(9),"\tret","",
    `${p}ReturnPcWait:`,...npcWait,`\tjp ${p}Cleanup`,"",
    `${p}ReturnApproachStart:`,"\tld c, 4",`\tcall ${p}SelectRoute`,`\tjp nc, ${p}Cleanup`,`\tcall ${p}MoveNpc`,...phase(11),"\tret","",
    `${p}ReturnApproachWait:`,...npcWait,`\tjp ${p}Cleanup`,"",
    `${p}Blocked:`,`\tld hl, ${data}`,"\tset 0, [hl]",...stepText(p,"Blocked"),`\tjp ${p}Cleanup`,"",
    `${p}Cleanup:`,...m.frozen.flatMap(n=>[`\tld a, ${n.direction}`,`\tld [wMapSpriteData + ${(n.id-1)*2+1}], a`]),`\tld a, DOWN`,`\tld [wMapSpriteData + ${(m.npcId-1)*2+1}], a`,"\txor a","\tld [wJoyIgnore], a","\tld [wUnusedOverrideSimulatedJoypadStatesIndex], a","\tld [wOverrideSimulatedJoypadStatesMask], a","\tld [wSimulatedJoypadStatesEnd], a","\tld [wSimulatedJoypadStatesIndex], a","\tldh [hJoyHeld], a","\tld hl, wStatusFlags5",`\tres BIT_SCRIPTED_MOVEMENT_STATE, [hl]`,`\tld a, ${m.npcConstant}`,"\tldh [hSpriteIndex], a","\tld a, SPRITE_FACING_DOWN","\tldh [hSpriteFacingDirection], a","\tcall SetSpriteFacingDirectionAndDelay",...phase(0),`\tld a, [${box}]`,"\tand BOX_NUM_MASK",`\tld [${box}], a`,"\tjp PlayDefaultMusic","",
    `${p}BoxHint:`,"\tld hl, wStringBuffer",`\tld a, [${box}]`,"\tand BOX_NUM_MASK","\tcp 9","\tjr c, .single","\tsub 9","\tld [hl], '1'","\tinc hl","\tadd '0'","\tjr .digit",".single","\tadd '1'",".digit","\tld [hli], a","\tld [hl], '@'",...stepText(p,"BoxHint"),"\tret","",
    `${p}MoveNpc:`,`\tld a, ${m.npcConstant}`,"\tldh [hSpriteIndex], a","\tjp MoveSprite","",
    `${p}FacePlayer:`,`\tld a, ${m.npcConstant}`,"\tldh [hSpriteIndex], a",`\tld a, [wSprite${npcSlot}StateData2MapY]`,"\tsub 4","\tld b, a","\tld a, [wYCoord]","\tcp b","\tjr z, .horizontal","\tld a, SPRITE_FACING_DOWN","\tjr nc, .face","\tld a, SPRITE_FACING_UP","\tjr .face",".horizontal",`\tld a, [wSprite${npcSlot}StateData2MapX]`,"\tsub 4","\tld b, a","\tld a, [wXCoord]","\tcp b","\tld a, SPRITE_FACING_RIGHT","\tjr nc, .face","\tld a, SPRITE_FACING_LEFT",".face","\tldh [hSpriteFacingDirection], a","\tjp SetSpriteFacingDirectionAndDelay","",
  ];
  // Five pointers per route: approach, escort, player input, occupancy list,
  // reverse approach. Seed coordinates remain stable until player movement starts.
  code.push(`${p}SelectRoute:`,`\tld a, [${box}]`,"\tbit 7, a",`\tld hl, ${p}Routes0`,`\tjr z, .table`,`\tld hl, ${p}Routes1`,".table","\tld a, [wXCoord]","\tld b, a",".next","\tld a, [hli]","\tcp $ff","\tjr z, .no","\tcp b","\tjr nz, .skip","\tld a, [wYCoord]","\tcp [hl]","\tjr nz, .skip","\tinc hl","\tld b, 0","\tadd hl, bc","\tadd hl, bc","\tld a, [hli]","\tld d, [hl]","\tld e, a","\tscf","\tret",".skip","\tld a, 11","\tadd l","\tld l, a","\tjr nc, .next","\tinc h","\tjr .next",".no","\tand a","\tret","");
  code.push(`${p}RouteClear:`,"\tld h, d","\tld l, e",...Array.from({length:m.npcId-1},(_,i)=>i+1).flatMap(id=>["\tpush hl",`\tld a, [wSprite${slot(id)}StateData2MapX]`,`\tld b, a`,`\tld a, [wSprite${slot(id)}StateData2MapY]`,`\tld c, a`,`\tcall ${p}CheckRoute`,"\tpop hl",`\tret nc`]),...(m.game==="pokeyellow"?["\tld a, [wSpritePikachuStateData1PictureID]","\tand a","\tjr z, .followerClear","\tld a, [wSpritePikachuStateData1ImageIndex]","\tcp $ff","\tjr z, .followerClear","\tpush hl","\tld a, [wSpritePikachuStateData2MapX]","\tld b, a","\tld a, [wSpritePikachuStateData2MapY]","\tld c, a",`\tcall ${p}CheckRoute`,"\tpop hl","\tret nc",".followerClear"]:[]),"\tscf","\tret", `${p}CheckRoute:`,".loop","\tld a, [hli]","\tcp $ff","\tjr z, .clear","\tcp b","\tjr nz, .skip","\tld a, [hl]","\tcp c","\tjr z, .blocked",".skip","\tinc hl","\tjr .loop",".blocked","\tand a","\tret",".clear","\tscf","\tret","");
  m.routes.forEach((routes,v)=>{
    code.push(`${p}Routes${v}:`,...routes.flatMap((r,i)=>[`\tdb ${r.x}, ${r.y}`,`\tdw ${["Approach","Escort","Player","Guard","Back"].map(k=>`${p}${v}R${i}${k}`).join(", ")}`]),"\tdb $ff","");
    routes.forEach((r,i)=>{
      for(const [name,path] of [["Approach",r.approach],["Escort",r.escort],["Back",reverse(r.approach)]] as const)code.push(`${p}${v}R${i}${name}:`,...path.map(d=>`\tdb NPC_MOVEMENT_${d}`),"\tdb $ff","");
      code.push(`${p}${v}R${i}Player:`,`\tdb ${r.player.length}`, ...r.player.slice().reverse().map(d=>`\tdb PAD_${d}`),"");
      code.push(`${p}${v}R${i}Guard:`,...r.guard.map(c=>`\tdb ${c.x+4}, ${c.y+4}`),"\tdb $ff","");
    });
    code.push(`${p}Return${v}:`,...m.returns[v].map(d=>`\tdb NPC_MOVEMENT_${d}`),"\tdb $ff","");
  });
  const texts={Intro:m.values.intro,Instructions:m.values.instructions,Complete:m.values.completion,
    Full:["Your BOX is full.","Make room, then","talk to me again."],Resume:["Your gift is safe.","Talk to me to","resume the lesson"],Lost:["You released the","tutorial partner.","The lesson ended.","No second gift."],Blocked:["The path is busy.","Talk to me again","when it is clear."],Busy:["Please finish the","current lesson."]};
  for(const [suffix,lines] of Object.entries(texts))code.push(text(`${p}${suffix}Text`,lines,charmap),"");
  code.push(`${p}BoxHintText:`, '\ttext "Find your gift in"', '\tline "BOX "', '\ttext_ram wStringBuffer', '\tdone', "");
  code.push(`; yellow-editor-pc-scene-end ${p}`,"");return code.join("\n");
}
function replaceRoutine(text: string,label:string,body:string) {
  const original=routine(text,label), canonical=body.replace(/\n/g,text.includes("\r\n")?"\r\n":"\n");
  if(text.split(original).length!==2)throw new Error(`Cannot replace ${label} uniquely.`);
  return text.replace(original,canonical.trimEnd()+ (text.includes("\r\n")?"\r\n":"\n"));
}
function replaceManaged(text:string,start:string,end:string,oldCode:string,newCode:string) {
  const a=text.indexOf(start), b=text.indexOf(end,a), tail=b+end.length;
  if(a<0||b<0||text.indexOf(start,a+1)>=0||text.slice(a,tail).replace(/\r\n/g,"\n")!==oldCode.slice(0,oldCode.indexOf(end)+end.length))throw new Error("The generated tutorial was edited in source. Review it before regenerating.");
  return text.slice(0,a)+newCode.trimEnd().replace(/\n/g,text.includes("\r\n")?"\r\n":"\n")+text.slice(tail);
}
export async function preparePcTutorialWrites(source:ProjectSource,document:PcTutorialDocument,values:PcTutorialValues):Promise<TextWriteRequest[]> {
  const state=await inspect(source);
  if(JSON.stringify(state.document.sources)!==JSON.stringify(document.sources))throw new Error("Tutorial sources changed. Reopen the wizard before saving.");
  if(!state.document.pokemon.includes(values.species)||!Number.isInteger(values.level)||values.level<1||values.level>100||!state.document.sprites.includes(values.sprite))throw new Error("Choose a compatible mentor, Pokémon and level from 1 to 100.");
  const charmap=state.files.find(f=>f.path.endsWith("charmap.asm"))?.contents??"";
  for(const [label,input] of [["Intro",values.intro],["Instructions",values.instructions],["Complete",values.completion]] as const)text(label,input,charmap);
  const changed=new Map<string,string>();
  let model:PcTutorialModel;
  if(state.model) {
    model={...state.model,values};
    const oldScene=renderPcTutorialScene(state.model,charmap),newScene=renderPcTutorialScene(model,charmap);
    changed.set(scriptPath,replaceManaged(state.read(scriptPath),`; yellow-editor-pc-scene-start ${model.prefix}`,`; yellow-editor-pc-scene-end ${model.prefix}`,oldScene,newScene));
    // Gift species/level are RAM inputs in the scene, so storage code and hooks
    // remain byte-for-byte unchanged when the recipe's words or gift change.
    const storage=renderPcTutorialStorage(state.model);
    replaceManaged(state.read(scriptPath),`; yellow-editor-pc-storage-start ${model.prefix}`,`; yellow-editor-pc-storage-end ${model.prefix}`,storage,storage);
    const expectedEntry="ViridianPokecenter_Script:\n\tcall Serial_TryEstablishingExternallyClockedConnection\n\tcall EnableAutoTextBoxDrawing\n\tjp "+model.prefix+"Dispatch\n";
    if(normalized(routine(state.read(scriptPath),"ViridianPokecenter_Script"))!==normalized(expectedEntry))throw new Error("The tutorial dispatcher was changed in source.");
  } else {
    const prefix="ViridianPokecenterEditorPcTutorial";
    if(state.files.some(f=>f.contents.includes(prefix)))throw new Error("Tutorial helper symbols already exist without a managed recipe.");
    if(state.game==="pokeyellow"&&state.symbols.get("PIKACHU_SPRITE_INDEX")!==15)throw new Error("Review this project's follower slot before creating the tutorial.");
    if(!state.read("data/events/hidden_events.asm").includes("hidden_event 13,  3, OpenPokemonCenterPC, SPRITE_FACING_UP"))throw new Error("The Pokémon Center PC position or interaction was changed.");
    const npc=state.document.npc!;
    const npcWrites=await prepareMapNpcWrites(source,npc,{x:6,y:5,sprite:values.sprite,movement:"STAY",direction:"DOWN",dialogue:{kind:"new",lines:["Talk to me for","a PC lesson."]}});
    npcWrites.forEach(w=>changed.set(w.path,w.contents));
    const newObject=changed.get(objectPath)!;
    const objectRows=newObject.split(/\r?\n/).flatMap(row=>{const match=clean(row).match(/^object_event\s+(.+)$/);return match?[match[1].split(",").map(s=>s.trim())]:[];});
    const last=objectRows[objectRows.length-1];
    const npcConstant=newObject.split(/\r?\n/).map(clean).filter(s=>s.startsWith("const_export ")).slice(-1)[0]!.slice(13);
    const npcLabel=changed.get(scriptPath)!.match(new RegExp(`dw_const (\\w+), ${last[5]}`))![1];
    const collision=state.read("data/tilesets/collision_tile_ids.asm").match(/Pokecenter_Coll::\s*\n\s*coll_tiles ([^\r\n;]+)/)?.[1].split(",").map(x=>evaluateRgbdsExpression(x.trim(),state.symbols));
    if(!collision||collision.some(x=>x===null))throw new Error("Cannot derive Pokémon Center walking surfaces.");
    if(!/map_header ViridianPokecenter,\s*VIRIDIAN_POKECENTER,\s*POKECENTER/.test(state.read("data/maps/headers/ViridianPokecenter.asm"))||npc.width!==14||npc.height!==8)throw new Error("This recipe requires the reviewed Pokémon Center dimensions and tileset.");
    const [blocks,blockset]=state.assetBytes;
    if(blocks.length!==28||blockset.length%16)throw new Error("Invalid Pokémon Center block data.");
    const walkable=(x:number,y:number)=>x>=0&&y>=0&&x<14&&y<8&&collision.includes(blockset[blocks[Math.floor(y/2)*7+Math.floor(x/2)]*16+(y%2*2+1)*4+x%2*2]);
    const home={x:6,y:5}, destination={x:12,y:4}, pc={x:13,y:4};
    if(!walkable(home.x,home.y)||!walkable(destination.x,destination.y)||!walkable(pc.x,pc.y))throw new Error("The mentor and PC standing tiles must remain walkable.");
    const other=objectRows.slice(0,-1).map(r=>({x:Number(r[0]),y:Number(r[1])}));
    const warps=state.read(objectPath).split(/\r?\n/).flatMap(row=>{const m=clean(row).match(/^warp_event\s+(\d+),\s*(\d+)/);return m?[{x:Number(m[1]),y:Number(m[2])}]:[];});
    const variants=[other,[...other,{x:10,y:4}]];
    const returns=variants.map(blocked=>tutorialPath(destination,home,walkable,[...blocked,pc,...warps]));
    const seeds=[{x:3,y:6},{x:4,y:6},{x:3,y:7},{x:4,y:7},{x:5,y:5},{x:7,y:5},{x:6,y:4}];
    const routes=variants.map((blocked,v)=>seeds.map(seed=>{
      const goal=seed.y>=6?{x:seed.x,y:seed.y-1}:home;
      const approach=tutorialPath(home,goal,walkable,[...blocked,seed,...warps]);
      const escort=tutorialPath(goal,destination,walkable,[...blocked,seed,...warps]);
      const player=tutorialPath(seed,pc,walkable,[...blocked,destination,...warps]);
      if([approach,escort,player,returns[v]].some(path=>path.length>90)||!player.length)throw new Error("A tutorial movement path exceeds the reviewed buffer bounds.");
      const pointsAll=[...points(home,approach),...points(goal,escort),...points(seed,player),...points(destination,returns[v])];
      return {...seed,approach,escort,player,guard:[...new Map(pointsAll.map(p=>[`${p.x},${p.y}`,p])).values()]};
    }));
    model={dependencies:[{path:objectPath,hash:await hashText(newObject)},...state.document.sources.filter(s=>["maps/ViridianPokecenter.blk","gfx/blocksets/pokecenter.bst"].includes(s.path))],version:1,prefix,npcId:npc.objectId,npcLabel,npcConstant,eventStart:allocateEvents(state),game:state.game,values,routes,returns,frozen:objectRows.slice(0,-1).flatMap((r,i)=>r[3]==="WALK"?[{id:i+1,direction:r[4]}]:[])};
    const scene=renderPcTutorialScene(model,charmap);
    let script=replaceRoutine(changed.get(scriptPath)!,npcLabel,"");
    script=replaceRoutine(script,"ViridianPokecenter_Script",`ViridianPokecenter_Script:\n\tcall Serial_TryEstablishingExternallyClockedConnection\n\tcall EnableAutoTextBoxDrawing\n\tjp ${prefix}Dispatch\n`);
    const append=(path:string,body:string)=>{const old=changed.get(path)??state.read(path);changed.set(path,old+(old.endsWith("\n")?"\n":"\n\n")+body.replace(/\n/g,old.includes("\r\n")?"\r\n":"\n"));};
    changed.set(scriptPath,script);append(scriptPath,scene);
    const names=["SEEN","GIVEN","COMPLETE","RELEASED",...Array.from({length:20},(_,i)=>`RESERVED_${i+4}`)];
    append("constants/event_constants.asm",`; Three existing event bytes: milestone/state, box, slot. Save layout is unchanged.\n`+names.map((name,i)=>`DEF EVENT_${prefix.toUpperCase()}_${name} EQU $${(model.eventStart+i).toString(16)}`).join("\n")+"\n");
    append(scriptPath,renderPcTutorialStorage(model));
    changed.set("engine/events/give_pokemon.asm",state.read("engine/events/give_pokemon.asm").replace("SetPokedexOwnedFlag:","SetPokedexOwnedFlag::"));
    const insertHook=(path:string,label:string,kind:"insert"|"remove")=>{const original=state.read(path);const start=routine(original,label).split(/\r?\n/)[0];const addition=renderPcTutorialHook(kind,model).replace(/\n/g,original.includes("\r\n")?"\r\n":"\n");changed.set(path,original.replace(start+ (original.includes("\r\n")?"\r\n":"\n"),start+(original.includes("\r\n")?"\r\n":"\n")+addition));};
    insertHook("engine/items/item_effects.asm","SendNewMonToBox","insert");
    changed.set("engine/items/item_effects.asm",changed.get("engine/items/item_effects.asm")!.replace("SendNewMonToBox:","SendNewMonToBox::"));
    changed.set("engine/battle/core.asm",state.read("engine/battle/core.asm").replace("LoadEnemyMonData:","LoadEnemyMonData::"));
    insertHook("engine/pokemon/remove_mon.asm","_RemovePokemon","remove");
    const pcSource=state.read("engine/pokemon/bills_pc.asm"), originalWithdraw=routine(pcSource,"BillsPCWithdraw");
    if(originalWithdraw.split("\tcall MoveMon").length!==2)throw new Error("Cannot identify the PC withdrawal transaction.");
    const nl=pcSource.includes("\r\n")?"\r\n":"\n";
    changed.set("engine/pokemon/bills_pc.asm",pcSource.replace(originalWithdraw,originalWithdraw.replace("\tcall MoveMon"+nl,"\tcall MoveMon"+nl+renderPcTutorialHook("withdraw",model).replace(/\n/g,nl))));
  }
  const patch={...source,readText:async(path:string)=>changed.get(path)??source.readText(path)};
  const reopened=await loadPcTutorialDocument(patch);
  if(JSON.stringify(reopened.values)!==JSON.stringify(values)||!reopened.existing)throw new Error("The created tutorial did not reopen with its saved values.");
  for(const [suffix,input] of [["Intro",values.intro],["Instructions",values.instructions],["Complete",values.completion]] as const) {
    const parsed=await parseTextDocument(scriptPath,`${model.prefix}${suffix}Text`,changed.get(scriptPath)!);
    if(!parsed.editable||parsed.segments.map(s=>s.text).join("\n")!==input.join("\n"))throw new Error("Tutorial dialogue did not reparse.");
  }
  return Promise.all([...changed].map(async([path,contents])=>({path,contents,expectedHash:await hashText(state.read(path))})));
}
