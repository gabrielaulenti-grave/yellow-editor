import { readFile,writeFile } from "node:fs/promises";
import { join } from "node:path";
import { renderPcTutorialHook,renderPcTutorialStorage,type PcTutorialModel } from "../src/core/pcTutorial";

export async function pcTutorialBankProbes(m:PcTutorialModel,root:string,rgbds:string,temporary:string,run:(cmd:string,args:string[],cwd?:string)=>string) {
 const p=m.prefix,base=0xc100+m.eventStart/8,cpu=join(temporary,"cpu");
 const bankFile=await readFile(join(root,m.game==="pokeyellow"?"home/bankswitch2.asm":"home/bankswitch.asm"),"utf8");
 const rows=bankFile.split(/\r?\n/),start=rows.findIndex(r=>r.trim()==="Bankswitch::");let end=start+1;
 while(end<rows.length&&!/^[A-Za-z_]\w*:{1,2}/.test(rows[end]))end++;
 const bankCode=rows.slice(start,end).join("\n")+(m.game==="pokeyellow"?"\nJumpToAddress::\n\tjp hl\n":"");
 let count=0;
 for(const kind of ["insert","remove","withdraw"] as const) {
  const filename=join(temporary,"banks.asm"),obj=join(temporary,"banks.o"),rom=join(temporary,"banks.gb"),sym=join(temporary,"banks.sym");
  const inputCarry=kind!=="withdraw";
  const asm=[`INCLUDE "${join(root,"macros/farcall.asm")}"`,"DEF wEventFlags EQU $c100","DEF BOX_NUM_MASK EQU $7f","DEF MONS_PER_BOX EQU 20","DEF hLoadedROMBank EQU $ff80","DEF rROMB EQU $2000",...["wBoxCount","wMonDataLocation","wEnemyBattleStatus3","wCurPartySpecies","wEnemyMonSpecies2","wCurrentBoxNum","wRemoveMonFromBox","wWhichPokemon"].map((name,i)=>`DEF ${name} EQU $${(0xc000+i).toString(16)}`),
  'SECTION "Header", ROM0[$100]',"jp Entry","ds $150 - @, 0",'SECTION "Code", ROM0[$150]',"Entry:","di","ld sp, $dfff","ld hl, $c000","ld bc, $400",".clear","xor a","ld [hli], a","dec bc","ld a, b","or c","jr nz, .clear","ld a, 1","ldh [hLoadedROMBank], a","ld [rROMB], a","ld [wRemoveMonFromBox], a",`ld a, ${kind==="remove"?1:3}`,"ld [wWhichPokemon], a","ld a, 2",`ld [$${base.toString(16)}], a`,"ld a, 3",`ld [$${(base+2).toString(16)}], a`,"ld bc, $2233","ld de, $4455","ld hl, $6677","ld a, $99",inputCarry?"scf":"and a","call Hook","ld [$c020], a","ld a, 0","adc a, 0","ld [$c021], a",...["b","c","d","e","h","l"].flatMap((r,i)=>[`ld a, ${r}`,`ld [$${(0xc022+i).toString(16)}], a`]),"ProbeDone:","halt","jr ProbeDone",bankCode,
  "EnableAutoTextBoxDrawing::","LoadEnemyMonData::","SetPokedexOwnedFlag::","SendNewMonToBox::","ret",'SECTION "Caller", ROMX[$4000], BANK[1]',"Hook:",renderPcTutorialHook(kind,m),"ret",'SECTION "Storage", ROMX[$4000], BANK[2]',renderPcTutorialStorage(m)].join("\n");
  await writeFile(filename,asm);run(join(rgbds,"rgbasm"),["-o",obj,filename]);run(join(rgbds,"rgblink"),["-n",sym,"-o",rom,obj]);run(join(rgbds,"rgbfix"),["-v","-p","0","-m","1",rom]);
  const endpoint=(await readFile(sym,"utf8")).match(/^00:([0-9a-f]+) ProbeDone$/mi)![1];
  run(cpu,[rom,endpoint,"c020=99",`c021=${inputCarry?1:0}`,"c022=22","c023=33","c024=44","c025=55","c026=66","c027=77","ff80=1",`${base.toString(16)}=${kind==="withdraw"?6:2}`,`${(base+2).toString(16)}=${kind==="insert"?4:kind==="remove"?2:3}`]);count++;
 }
 console.log(`${m.game}: ${count} real bank-switch hook probes preserved AF/BC/DE/HL and returned to the caller bank`);
}
