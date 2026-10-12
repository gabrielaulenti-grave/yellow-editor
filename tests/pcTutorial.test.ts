import { pcTutorialBankProbes } from "./pcTutorialBanks";
import { pcTutorialSceneProbes } from "./pcTutorialRuntime";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile,readdir,writeFile,cp,mkdtemp,rm } from "node:fs/promises";
import { resolve,join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadPcTutorialDocument,preparePcTutorialWrites,tutorialPath,renderPcTutorialStorage } from "../src/core/pcTutorial";
import type { ProjectSource } from "../src/core/types";

test("tutorial routes avoid obstacles and reject disconnected destinations",()=>{
 const walk=(x:number,y:number)=>x>=0&&y>=0&&x<4&&y<4;
 assert.deepEqual(tutorialPath({x:0,y:0},{x:2,y:0},walk,[{x:1,y:0}]),["DOWN","RIGHT","RIGHT","UP"]);
 assert.throws(()=>tutorialPath({x:0,y:0},{x:2,y:0},walk,[{x:1,y:0},{x:0,y:1}]),/No safe/);
});
const args=process.argv.slice(2);const romAt=args.indexOf("--rom");
const rgbds=romAt>=0?resolve(args[romAt+1]):null,binjgb=romAt>=0?resolve(args[romAt+2]):null;
if(romAt>=0)args.splice(romAt,3);
for(const directory of args) test(`${directory}: managed Lance PC tutorial creation, editing and safety`,async()=>{
 const root=resolve(directory),overlay=new Map<string,string>();
 async function listFiles(path=""):Promise<string[]> {return(await Promise.all((await readdir(join(root,path),{withFileTypes:true})).filter(e=>!e.name.startsWith(".")).map(e=>e.isDirectory()?listFiles(join(path,e.name)):[join(path,e.name)]))).flat();}
 const source:ProjectSource={listFiles,readText:async p=>overlay.get(p)??readFile(join(root,p),"utf8"),readBytes:async p=>new Uint8Array(await readFile(join(root,p))),exists:async p=>{try{await readFile(join(root,p));return true;}catch{return false;}}};
 const document=await loadPcTutorialDocument(source);assert.equal(document.existing,false);assert.ok(document.sprites.includes("SPRITE_LANCE"));
 const originalEvents=await source.readText("constants/event_constants.asm");
 const changes=await preparePcTutorialWrites(source,document,document.values);
 assert.equal(changes.length,8);changes.forEach(w=>overlay.set(w.path,w.contents));
 const reopened=await loadPcTutorialDocument(source);assert.equal(reopened.existing,true);assert.deepEqual(reopened.values,document.values);
 assert.equal(reopened.model?.routes.length,2);assert.ok(reopened.model!.eventStart%8===0);
 assert.ok(overlay.get("constants/event_constants.asm")!.startsWith(originalEvents));
 assert.equal(await source.readText("ram/wram.asm"),await readFile(join(root,"ram/wram.asm"),"utf8"));
 assert.ok(overlay.get("scripts/ViridianPokecenter.asm")!.includes("bit BIT_SCRIPTED_MOVEMENT_STATE, a"));
 assert.ok(overlay.get("scripts/ViridianPokecenter.asm")!.includes("ret nc\n\txor a\n\tld [wMonDataLocation], a"));
 const update={...reopened.values,species:"EEVEE",level:7,intro:["A new PC lesson!"]};
 const edited=await preparePcTutorialWrites(source,reopened,update);assert.equal(edited.length,1);assert.equal(edited[0].path,"scripts/ViridianPokecenter.asm");
 const bad={...update,level:0};await assert.rejects(()=>preparePcTutorialWrites(source,reopened,bad),/level/);
 await assert.rejects(()=>preparePcTutorialWrites(source,reopened,{...update,instructions:["This row is much too long for the game text box"]}),/wide|width|spaces|character|row/i);
 overlay.set("engine/pokemon/remove_mon.asm",overlay.get("engine/pokemon/remove_mon.asm")!.replace("dec a","inc a"));
 await assert.rejects(()=>preparePcTutorialWrites(source,reopened,update),/reviewed remove/);
 overlay.set("engine/pokemon/remove_mon.asm",changes.find(w=>w.path==="engine/pokemon/remove_mon.asm")!.contents);
 overlay.set("scripts/ViridianPokecenter.asm",overlay.get("scripts/ViridianPokecenter.asm")!+"; unrelated source edit\n");
 await assert.rejects(()=>preparePcTutorialWrites(source,reopened,update),/sources changed/);
 overlay.set("scripts/ViridianPokecenter.asm",changes.find(w=>w.path==="scripts/ViridianPokecenter.asm")!.contents);
 const model=reopened.model!;
 if(rgbds&&binjgb) {
  const temporary=await mkdtemp(resolve("node_modules/.pc-tutorial-rom-"));
  const run=(cmd:string,argv:string[],cwd=temporary)=>{const result=spawnSync(cmd,argv,{cwd,encoding:"utf8",maxBuffer:16*1024*1024});assert.equal(result.status,0,`${cmd}: ${result.stderr.slice(-10000)}\n${result.stdout.slice(-500)}`);return result.stdout;};
  try {
   const gameRoot=join(temporary,"game");await cp(root,gameRoot,{recursive:true,filter:p=>!p.split("/").includes(".git")});
   for(const w of changes)await writeFile(join(gameRoot,w.path),w.contents);
   run("make",["clean"],gameRoot);const cartridge=model.game==="pokeyellow"?"pokeyellow.gbc":"pokered.gbc";
   run("make",["-j2",`RGBDS=${rgbds}/`,cartridge],gameRoot);console.log(`${model.game}: complete tutorial ROM assembled and linked`);
   await storageProbes(model,root,rgbds,binjgb,temporary,run);
   await pcTutorialBankProbes(model,root,rgbds,temporary,run);
   const cpu=join(temporary,"cpu");
   await pcTutorialSceneProbes(model,await source.readText("constants/charmap.asm"),async(asm,expected)=>{
    const filename=join(temporary,"scene.asm"),obj=join(temporary,"scene.o"),rom=join(temporary,"scene.gb"),sym=join(temporary,"scene.sym");
    await writeFile(filename,asm);run(join(rgbds,"rgbasm"),["-o",obj,filename]);run(join(rgbds,"rgblink"),["-n",sym,"-o",rom,obj]);run(join(rgbds,"rgbfix"),["-v","-p","0",rom]);
    const stop=(await readFile(sym,"utf8")).match(/^00:([0-9a-f]+) ProbeDone$/mi)![1];run(cpu,[rom,stop,...expected]);
   });
  }finally{await rm(temporary,{recursive:true,force:true});}
 }
 console.log(`${model.game}: 8-file atomic tutorial, one-file recipe edits, source drift, stale source and dialogue guards passed`);
});

async function storageProbes(model:NonNullable<Awaited<ReturnType<typeof loadPcTutorialDocument>>["model"]>,root:string,rgbds:string,binjgb:string,temporary:string,run:(cmd:string,args:string[],cwd?:string)=>string){
 assert.equal(run("git",["rev-parse","HEAD"],binjgb).trim(),"8abd0d38d5bf109d7c280b27d815a8b53168adde");
 const cpu=join(temporary,"cpu");run("cc",["-std=gnu11","-O2",`-I${join(binjgb,"src")}`,resolve("tests/scriptRuntimeProbe.c"),...["memory.c","common.c","emulator-debug.c"].map(f=>join(binjgb,"src",f)),"-lm","-o",cpu]);
 const p=model.prefix,base=0xc100+model.eventStart/8;
 const storage=renderPcTutorialStorage(model).replace(/\t(?:callfar|farcall) (\w+)/g,"\tcall $1");
 const bindings={wEventFlags:0xc100,wBoxCount:0xc000,wMonDataLocation:0xc001,wEnemyBattleStatus3:0xc002,wCurPartySpecies:0xc003,wEnemyMonSpecies2:0xc004,wCurrentBoxNum:0xc005,wRemoveMonFromBox:0xc006,wWhichPokemon:0xc007};
 const counters={SetPokedexOwnedFlag:0xc010,LoadEnemyMonData:0xc011,SendNewMonToBox:0xc012};
 const stubs=["EnableAutoTextBoxDrawing:","ret",...Object.entries(counters).flatMap(([name,address])=>[`${name}:`,`ld hl, $${address.toString(16)}`,"inc [hl]","ret"])].join("\n");
 let count=0;
 async function probe(body:string,expect:string[]){
  const asm=join(temporary,"probe.asm"),obj=join(temporary,"probe.o"),rom=join(temporary,"probe.gb"),sym=join(temporary,"probe.sym");
  await writeFile(asm,[...Object.entries(bindings).map(([n,a])=>`DEF ${n} EQU $${a.toString(16)}`),"DEF MONS_PER_BOX EQU 20","DEF BOX_NUM_MASK EQU $0f",'SECTION "Header", ROM0[$100]',"jp Entry","ds $150 - @, 0",'SECTION "Code", ROM0[$150]',"Entry:","di","ld sp, $dfff","ld hl, $c000","ld bc, $400",".clear:","xor a","ld [hli], a","dec bc","ld a, b","or c","jr nz, .clear",body,"ProbeDone:","halt","jr ProbeDone",storage,stubs].join("\n"));
  run(join(rgbds,"rgbasm"),["-o",obj,asm]);run(join(rgbds,"rgblink"),["-n",sym,"-o",rom,obj]);run(join(rgbds,"rgbfix"),["-v","-p","0",rom]);
  const endpoint=(await readFile(sym,"utf8")).match(/^00:([0-9a-f]+) ProbeDone$/mi)![1];run(cpu,[rom,endpoint,...expect]);count++;
 }
 const flag=(n:number)=>`ld a, ${n}\nld [$${base.toString(16)}], a`;
 const target=(box:number,index:number)=>`ld a, ${box}\nld [$${(base+1).toString(16)}], a\nld a, ${index}\nld [$${(base+2).toString(16)}], a`;
 for(const capacity of [0,19,20])await probe(`ld a, ${capacity}\nld [wBoxCount], a\ncall ${p}GiveToBox\nld a, 0\nadc a, 0\nld [$c020], a`,["c001=0",`c010=${capacity<20?1:0}`,`c011=${capacity<20?1:0}`,`c012=${capacity<20?1:0}`,`c020=${capacity<20?1:0}`]);
 for(const flags of [0,1,2,3,6,10])for(const current of [0,1])await probe(`${flag(flags)}\n${target(0x80,3)}\nld a, ${current}\nld [wCurrentBoxNum], a\ncall ${p}BoxInsert`,[`${(base+2).toString(16)}=${flags===2||flags===3?current===0?4:3:3}`]);
 for(const selected of [1,3,5])for(const operation of [0,1])await probe(`${flag(3)}\n${target(0,3)}\nld a, ${operation}\nld [wRemoveMonFromBox], a\nld a, ${selected}\nld [wWhichPokemon], a\ncall ${p}BoxRemove`,[`${base.toString(16)}=${operation&&selected===3?"b":"3"}`,`${(base+2).toString(16)}=${operation&&selected<3?2:3}`]);
 for(const selected of [1,3,5])for(const success of [false,true])await probe(`${flag(3)}\n${target(0,3)}\nld a, ${selected}\nld [wWhichPokemon], a\n${success?"and a":"scf"}\ncall ${p}WithdrawCommit`,[`${base.toString(16)}=${success&&selected===3?7:3}`]);
 // Insert, remove an earlier slot, change boxes, then withdraw the shifted gift.
 await probe(`${flag(3)}\n${target(0,0)}\ncall ${p}BoxInsert\nld a, 1\nld [wCurrentBoxNum], a\ncall ${p}BoxInsert\nxor a\nld [wCurrentBoxNum], a\nld [wWhichPokemon], a\ninc a\nld [wRemoveMonFromBox], a\ncall ${p}BoxRemove\nxor a\nld [wWhichPokemon], a\ncall ${p}WithdrawCommit\ncall ${p}BoxRemove`,[`${base.toString(16)}=7`,`${(base+2).toString(16)}=0`]);
 console.log(`${model.game}: ${count} direct-PC gift and exact-slot tracking CPU probes passed; native creation/naming/storage routines are boundary stubs`);
}
