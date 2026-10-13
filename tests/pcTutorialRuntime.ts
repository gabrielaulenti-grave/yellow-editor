import { renderPcTutorialScene,renderPcTutorialStorage,type PcTutorialModel } from "./recipes/pcTutorial";

export async function pcTutorialSceneProbes(model:PcTutorialModel,charmap:string,runProbe:(asm:string,expected:string[])=>Promise<void>) {
 const p=model.prefix,base=0xc100+model.eventStart/8, actor=model.npcId;
 const slot=(id:number)=>String(id).padStart(2,"0");
 const state=(id:number,field:number)=>0xc300+id*4+field;
 const bindings:Record<string,number>={wEventFlags:0xc100,wStatusFlags5:0xc001,wJoyIgnore:0xc002,wXCoord:0xc003,wYCoord:0xc004,wWalkCounter:0xc005,wCurrentMapScriptFlags:0xc006,wCurrentMenuItem:0xc007,wSpritePlayerStateData1FacingDirection:0xc008,wSimulatedJoypadStatesIndex:0xc009,wUnusedOverrideSimulatedJoypadStatesIndex:0xc00a,wOverrideSimulatedJoypadStatesMask:0xc00b,wCurrentBoxNum:0xc00c,wBoxCount:0xc00d,wCurPartySpecies:0xc00e,wCurEnemyLevel:0xc00f,wMonDataLocation:0xc010,wEnemyBattleStatus3:0xc011,wEnemyMonSpecies2:0xc012,wRemoveMonFromBox:0xc013,wWhichPokemon:0xc014,wPartyCount:0xc015,wMapSpriteData:0xc060,wSimulatedJoypadStatesEnd:0xc500,wStringBuffer:0xc530,hSpriteIndex:0xff91,hSpriteFacingDirection:0xff92,hJoyHeld:0xff93,MONS_PER_BOX:20,BOX_NUM_MASK:0x7f,BIT_CUR_MAP_LOADED_1:5,BIT_CUR_MAP_LOADED_2:6,BIT_SCRIPTED_NPC_MOVEMENT:0,BIT_SCRIPTED_MOVEMENT_STATE:7,NONE:255,DOWN:0,UP_DOWN:1,SPRITE_FACING_DOWN:0,SPRITE_FACING_UP:4,SPRITE_FACING_LEFT:8,SPRITE_FACING_RIGHT:12,NPC_MOVEMENT_DOWN:0,NPC_MOVEMENT_UP:64,NPC_MOVEMENT_LEFT:128,NPC_MOVEMENT_RIGHT:192,PAD_RIGHT:1,PAD_LEFT:2,PAD_UP:4,PAD_DOWN:8,DRATINI:88,[model.npcConstant]:actor};
 for(let id=1;id<=actor;id++){bindings[`wSprite${slot(id)}StateData1MovementStatus`]=state(id,0);bindings[`wSprite${slot(id)}StateData2MapX`]=state(id,1);bindings[`wSprite${slot(id)}StateData2MapY`]=state(id,2);}
 Object.assign(bindings,{wSpritePikachuStateData1PictureID:0xc3e0,wSpritePikachuStateData1ImageIndex:0xc3e1,wSpritePikachuStateData2MapX:0xc3e2,wSpritePikachuStateData2MapY:0xc3e3});
 const scene=renderPcTutorialScene(model,charmap).split("\n").map(row=>row.replace(/^\s*(?:text|line|cont|done|text_asm|text_ram)\b.*/,"\tdb 0").replace(/^\s*def_script_pointers\b.*/,"").replace(/^\s*dw_const (\w+),.*/,"\tdw $1").replace(/^\s*farcall (\w+)/,"\tcall $1")).join("\n");
 const storage=renderPcTutorialStorage(model).replace(/\t(?:callfar|farcall) (\w+)/g,"\tcall $1");
 const ax=`wSprite${slot(actor)}StateData2MapX`, ay=`wSprite${slot(actor)}StateData2MapY`;
 const stubs=[
  "CallFunctionInTable:","add a","ld e, a","ld d, 0","add hl, de","ld a, [hli]","ld h, [hl]","ld l, a","jp hl",
  "EnableAutoTextBoxDrawing:","TextScriptEnd:","LoadEnemyMonData:","SetPokedexOwnedFlag:","SetSpriteFacingDirectionAndDelay:","ret",
  "PrintText:","ld hl, $c024","inc [hl]","ret",
  "PlayDefaultMusic:","ld hl, $c025","inc [hl]","ret",
  "YesNoChoice:","ld a, [$c026]","ld [wCurrentMenuItem], a","ret",
  "SendNewMonToBox:","ld hl, $c023","inc [hl]","ld hl, wBoxCount","inc [hl]","ret",
  "MoveSprite:","ld hl, $c020","inc [hl]","ld a, $ff","ld [wJoyIgnore], a","ld hl, wStatusFlags5","set BIT_SCRIPTED_NPC_MOVEMENT, [hl]",".loop","ld a, [de]","inc de","cp $ff","ret z","and a","jr z, .down","cp NPC_MOVEMENT_UP","jr z, .up","cp NPC_MOVEMENT_LEFT","jr z, .left",`ld hl, ${ax}`,"inc [hl]","jr .loop",".down",`ld hl, ${ay}`,"inc [hl]","jr .loop",".up",`ld hl, ${ay}`,"dec [hl]","jr .loop",".left",`ld hl, ${ax}`,"dec [hl]","jr .loop",
  "FinishNpc:","ld hl, wStatusFlags5","res BIT_SCRIPTED_NPC_MOVEMENT, [hl]","ret",
  "StartSimulatingJoypadStates:","ld hl, $c021","inc [hl]","ld hl, wStatusFlags5","set BIT_SCRIPTED_MOVEMENT_STATE, [hl]","ret",
  "FinishPlayer:","ld a, [wSimulatedJoypadStatesIndex]","ld b, a","ld hl, wSimulatedJoypadStatesEnd","ld d, 0","ld e, a","add hl, de",".loop","dec hl","ld a, [hl]","cp PAD_DOWN","jr z, .down","cp PAD_UP","jr z, .up","cp PAD_LEFT","jr z, .left","push hl","ld hl, wXCoord","inc [hl]","jr .next",".down","push hl","ld hl, wYCoord","inc [hl]","jr .next",".up","push hl","ld hl, wYCoord","dec [hl]","jr .next",".left","push hl","ld hl, wXCoord","dec [hl]",".next","pop hl","dec b","jr nz, .loop","xor a","ld [wSimulatedJoypadStatesIndex], a","ld [wWalkCounter], a","ld hl, wStatusFlags5","res BIT_SCRIPTED_MOVEMENT_STATE, [hl]","ret",
  "ActivatePC:","ld hl, $c022","inc [hl]","ld a, [$c028]","and a","ret z","cp 3","jr z, .wrong","xor a","ld [wWhichPokemon], a","ld a, [$c028]","cp 2","jr z, .release","and a",`call ${p}WithdrawCommit`,"jr .remove",".wrong","ld a, 1","ld [wWhichPokemon], a","and a",`call ${p}WithdrawCommit`,"ret",".release","xor a","ld [wWhichPokemon], a",".remove","ld a, 1","ld [wRemoveMonFromBox], a",`call ${p}BoxRemove`,"ret",
 ].join("\n");
 const call=`call ${p}Dispatch`, memory=(address:number,value:number)=>`ld a, ${value}\nld [$${address.toString(16)}], a`;
 let count=0;
 async function probe(body:string,expected:string[]){const asm=[...Object.entries(bindings).map(([n,v])=>`DEF ${n} EQU $${v.toString(16)}`),'SECTION "Header", ROM0[$100]',"jp Entry","ds $150 - @, 0",'SECTION "Code", ROM0[$150]',"Entry:","di","ld sp, $dfff","ld hl, $c000","ld bc, $600",".clear","xor a","ld [hli], a","dec bc","ld a, b","or c","jr nz, .clear",body,"ProbeDone:","halt","jr ProbeDone",scene,storage,stubs].join("\n");await runProbe(asm,expected);count++;}
 for(const seed of model.routes[0])for(const alt of [false,true])for(const outcome of ["no","cancel","withdraw","full","release","wrong"] as const) {
  const manual=seed.y<6, accepted=outcome!=="no", capacity=outcome==="full"?20:0;
  const setup=[memory(state(actor,0),1),memory(state(actor,1),10),memory(state(actor,2),9),memory(state(2,0),1),memory(state(2,1),14),memory(state(2,2),alt?8:9),memory(0xc003,seed.x),memory(0xc004,seed.y),memory(0xc026,accepted?0:1),memory(0xc00d,capacity),memory(0xc028,{no:0,cancel:0,withdraw:1,full:0,release:2,wrong:3}[outcome]),manual?`call ${model.npcLabel} + 1`:call,call,
   call,"ld a, [$c023]","ld [$c02f], a", // Active NPC movement must yield without delivering.
   "call FinishNpc",call,
  ];
  if(accepted)setup.push(call,call,"call FinishNpc",call,call,call,"ld a, [$c023]","ld [$c02e], a", // Player work active.
    "xor a","ld [wSimulatedJoypadStatesIndex], a","inc a","ld [wWalkCounter], a",call,"ld a, [$c023]","ld [$c02d], a",
    // Restore the original count for the movement boundary, then finish it.
    memory(0xc009,model.routes[alt?1:0].find(r=>r.x===seed.x&&r.y===seed.y)!.player.length),"call FinishPlayer",call,...(outcome==="full"?[]:[call]),call,call,"call FinishNpc",call);
  else setup.push(call,call,"call FinishNpc",call);
  const flags=outcome==="withdraw"?7:outcome==="release"?11:accepted&&outcome!=="full"?3:1;
  try { await probe(setup.join("\n"),[`${base.toString(16)}=${flags.toString(16)}`,"c002=0","c001=0",`c020=${accepted?3:2}`,`c021=${accepted?1:0}`,`c022=${accepted&&outcome!=="full"?1:0}`,`c023=${accepted&&outcome!=="full"?1:0}`,"c02f=0","c02e=0","c02d=0",`${state(actor,1).toString(16)}=a`,`${state(actor,2).toString(16)}=9`,...(accepted?["c003=d","c004=4","c008=4"]:[])]); } catch(error) { throw new Error(`Scene ${seed.x},${seed.y}, alternate=${alt}, ${outcome}: ${String(error)}`); }
 }
 // Entering after a saved, interrupted lesson discards transient movement but
 // retains delivery and target identity; no duplicate gift is generated.
 await probe([memory(base,0x73),memory(base+1,0x81),memory(base+2,4),memory(0xc006,0x20),memory(0xc003,3),memory(0xc004,7),call].join("\n"),[`${base.toString(16)}=3`,`${(base+1).toString(16)}=1`,`${(base+2).toString(16)}=4`,"c002=0","c023=0"]);
 // An existing wandering NPC must finish its current step before route checks.
 await probe([memory(state(actor,0),1),memory(state(actor,1),10),memory(state(actor,2),9),memory(state(2,0),3),memory(0xc003,3),memory(0xc004,7),call,call].join("\n"),[`${base.toString(16)}=10`,"c020=0","c002=ff"]);
 console.log(`${model.game}: ${count} staged scene CPU probes passed across entry sides, manual retry, both routes, decline, cancellation, exact withdrawal, release, wrong-mon withdrawal, full storage, waits and saved-phase reset`);
}
