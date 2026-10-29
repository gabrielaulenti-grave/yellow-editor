/* Full native ROM: ordinary joypad input, real trainer sight/approach, battles,
 * blackout and SRAM Continue. Only new-game fixture ROM data is selected. */
#include "emulator-debug.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
typedef struct { char name[256]; unsigned bank,address; } Symbol;
static Symbol symbols[65536]; static int count; static unsigned event_base;
static Symbol get(const char* name) { for(int i=0;i<count;i++)if(!strcmp(name,symbols[i].name))return symbols[i];fprintf(stderr,"Missing %s\n",name);exit(2); }
static unsigned addr(const char* name){return get(name).address;}
static unsigned rd(Emulator*e,const char*name){return emulator_read_u8_raw(e,addr(name));}
static int flag(Emulator*e,unsigned bit){return !!(emulator_read_u8_raw(e,event_base+bit/8)&(1u<<(bit%8)));}
static void screenshot(Emulator*e,const char*path){FILE*f=fopen(path,"wb");if(f){fwrite(emulator_get_frame_buffer(e),4,160*144,f);fclose(f);}}
static int drive(Emulator*e,int mode,int reload,unsigned map,unsigned automatic,unsigned talk,const char*shot){
 int entered=0,battles=0,prev_battle=0,approach=0,settled=0;unsigned target=(mode==0||mode==2)?automatic:talk,other=(mode==0||mode==2)?talk:automatic;
 for(int n=0;n<24000;n++){
  unsigned frame=emulator_get_ticks(e)/PPU_FRAME_TICKS;
  int battle=rd(e,"wIsInBattle")==1||rd(e,"wIsInBattle")==2;
  if(battle&&!prev_battle){battles++;fprintf(stderr,"trainer mode %d%s: battle entered at %u\n",mode,reload?" reload":"",frame);}prev_battle=battle;
  if(rd(e,"wCurMap")==map&&rd(e,"wPartyCount")==1)entered=1;
  if(entered&&rd(e,"wEditorMapTrainerState")==1)approach=1;
  if(entered&&!reload&&!battles&&flag(e,target)){fprintf(stderr,"Defeat flag set before battle\n");break;}
  int complete=mode==2?entered&&battles==1&&rd(e,"wCurMap")!=map&&!battle&&rd(e,"wPartyMon1HP")+emulator_read_u8_raw(e,addr("wPartyMon1HP")+1)>0:entered&&!battle&&flag(e,target)&&rd(e,"wTrainerSmokeSaved")==0x5a;
  if(complete&&!rd(e,"wJoyIgnore")&&!rd(e,"wEditorMapTrainerState"))settled++;else settled=0;
  if(settled>60){
   if((reload&&battles)||(!reload&&battles!=1)||flag(e,other))break;
   if(mode==2&&flag(e,target))break;
   if(!reload&&(mode==0||mode==2)&&!approach)break;
   screenshot(e,shot);printf("native trainer mode %d%s: %s, independent defeat flag and input cleanup passed\n",mode,reload?" Continue":"",mode==2?"blackout":reload?"battery reload without rematch":mode==0?"sight and approach":"talk challenge");return 0;
  }
  JoypadButtons buttons={0};
  if(frame%12<6){
   if(!entered){buttons.A=TRUE;buttons.start=TRUE;}
   else if(!battle&&flag(e,target)){if(rd(e,"wTrainerSmokeSaved")==0x5a)buttons.B=TRUE;else buttons.A=TRUE;}
   else if(mode!=0&&mode!=2&&!battle&&!battles){
    if(frame%24>=12)buttons.A=TRUE;
    else if(mode==1)buttons.up=TRUE;else if(mode==3)buttons.down=TRUE;else if(mode==4)buttons.right=TRUE;else buttons.left=TRUE;
   }else buttons.A=TRUE;
  }
  emulator_set_joypad_buttons(e,&buttons);EmulatorEvent result=emulator_run_until(e,emulator_get_ticks(e)+PPU_FRAME_TICKS);if(result&EMULATOR_EVENT_INVALID_OPCODE)break;
  if(n%3000==2999)fprintf(stderr,"mode %d%s frame%u map%02x state%u ret%02x PC%04x battle%u opp%u bit%d hp%u,%u joy%02x pos%u,%u\n",mode,reload?" reload":"",frame,rd(e,"wCurMap"),rd(e,"wEditorMapTrainerState"),rd(e,"wEditorMapTrainerReturn"),emulator_get_registers(e).PC,rd(e,"wIsInBattle"),rd(e,"wCurOpponent"),flag(e,target),rd(e,"wPartyMon1HP"),emulator_read_u8_raw(e,addr("wPartyMon1HP")+1),rd(e,"wJoyIgnore"),rd(e,"wXCoord"),rd(e,"wYCoord"));
 }
 screenshot(e,shot);fprintf(stderr,"Sprite index %u hSprite %u player facing %u movement dir %u\n",rd(e,"wSpriteIndex"),rd(e,"hSpriteIndex"),rd(e,"wSpritePlayerStateData1FacingDirection"),rd(e,"wPlayerMovingDirection"));fprintf(stderr,"Trainer gameplay failed mode%d reload%d PC%04x bank%02x map%02x state%u return%02x battle%u battles%d seen%d done%d other%d saved%02x joy%02x\n",mode,reload,emulator_get_registers(e).PC,rd(e,"hLoadedROMBank"),rd(e,"wCurMap"),rd(e,"wEditorMapTrainerState"),rd(e,"wEditorMapTrainerReturn"),rd(e,"wIsInBattle"),battles,approach,flag(e,target),flag(e,other),rd(e,"wTrainerSmokeSaved"),rd(e,"wJoyIgnore"));return 1;
}
int main(int argc,char**argv){
 if(argc!=12)return 2;FILE*f=fopen(argv[2],"r");if(!f)return 2;char line[512];while(fgets(line,sizeof(line),f)&&count<65536)if(sscanf(line,"%x:%x %255s",&symbols[count].bank,&symbols[count].address,symbols[count].name)==3)count++;fclose(f);
 f=fopen(argv[1],"rb");if(!f)return 2;fseek(f,0,SEEK_END);long size=ftell(f);rewind(f);EmulatorInit init={0};init.rom.data=malloc(size);init.rom.size=size;if(fread(init.rom.data,1,size,f)!=(size_t)size)return 2;fclose(f);
 int mode=atoi(argv[3]);Symbol m=get("TrainerSmokeMode"),warp=get("NewGameWarp");init.rom.data[m.bank*0x4000+m.address%0x4000]=mode;
 unsigned x=atoi(argv[7]),y=atoi(argv[8]),width=atoi(argv[9]),view=addr("wOverworldMap")+7+width+(width+6)*(y>>1)+(x>>1),at=warp.bank*0x4000+warp.address%0x4000;
 init.rom.data[at+1]=view&255;init.rom.data[at+2]=view>>8;init.rom.data[at+3]=y;init.rom.data[at+4]=x;init.rom.data[at+5]=y&1;init.rom.data[at+6]=x&1;
 event_base=addr("wEventFlags");init.audio_frequency=44100;init.audio_frames=4096;init.random_seed=123;init.force_dmg=TRUE;Emulator*e=emulator_new(&init);if(!e)return 2;
 unsigned map=strtoul(argv[4],0,16),automatic=strtoul(argv[5],0,16),talk=strtoul(argv[6],0,16);int result=drive(e,mode,0,map,automatic,talk,argv[11]);
 if(!result&&mode!=2){FileData battery={0};emulator_init_ext_ram_file_data(e,&battery);if(emulator_write_ext_ram(e,&battery)!=OK)return 2;FILE*out=fopen(argv[10],"wb");if(out){fwrite(battery.data,1,battery.size,out);fclose(out);}emulator_delete(e);e=emulator_new(&init);if(!e||emulator_read_ext_ram(e,&battery)!=OK)return 2;free(battery.data);result=drive(e,mode,1,map,automatic,talk,argv[11]);}
 emulator_delete(e);free(init.rom.data);return result;
}
