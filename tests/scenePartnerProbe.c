/* Native follower smoke test: only fixture new-game selection is seeded.
 * Pikachu identity, spawning, animation, movement and follow resumption are native. */
#include "emulator-debug.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
typedef struct { char name[256]; unsigned bank, address; } Symbol;
static Symbol symbols[65536]; static int count;
static Symbol sym(const char* name) { for(int i=0;i<count;i++)if(!strcmp(symbols[i].name,name))return symbols[i]; fprintf(stderr,"Missing %s\n",name);exit(2); }
static unsigned rd(Emulator* e,const char* name){return emulator_read_u8_raw(e,sym(name).address);}
static void shot(Emulator* e,const char* path){FILE* f=fopen(path,"wb");if(f){fwrite(emulator_get_frame_buffer(e),4,160*144,f);fclose(f);}}
int main(int argc,char** argv){
 if(argc!=7)return 2;FILE* f=fopen(argv[2],"r");char line[512];if(!f)return 2;
 while(fgets(line,sizeof(line),f)&&count<65536)if(sscanf(line,"%x:%x %255s",&symbols[count].bank,&symbols[count].address,symbols[count].name)==3)count++;fclose(f);
 f=fopen(argv[1],"rb");if(!f)return 2;fseek(f,0,SEEK_END);long size=ftell(f);rewind(f);EmulatorInit init={0};init.rom.data=malloc(size);init.rom.size=size;if(fread(init.rom.data,1,size,f)!=(size_t)size)return 2;fclose(f);
 int mode=atoi(argv[3]),map=atoi(argv[4]),id=atoi(argv[5]);Symbol variant=sym("PartnerMode");init.rom.data[variant.bank*0x4000+variant.address%0x4000]=mode;
 init.audio_frequency=44100;init.audio_frames=4096;init.random_seed=123;init.force_dmg=TRUE;Emulator* e=emulator_new(&init);if(!e)return 2;
 char actorX[80],actorY[80];snprintf(actorX,sizeof(actorX),"wSprite%02dStateData2MapX",id);snprintf(actorY,sizeof(actorY),"wSprite%02dStateData2MapY",id);
 int entered=0,active=0,parked=0,settled=0,phase=0,finished=0,saw_start=0,looked=0,saw_battle=0;
 unsigned flags=sym("wEventFlags").address;
 for(int frame=0;frame<10000;frame++){
  if(rd(e,"wIsInBattle"))saw_battle=1;
  if(rd(e,"wCurMap")==map&&rd(e,"wPartyCount"))entered=1;
  if(entered&&rd(e,"wEditorSceneActive")){active=1;if(rd(e,"wSpritePikachuStateData2MapX")==7&&rd(e,"wSpritePikachuStateData2MapY")==9){parked=1;if(rd(e,"wSpritePikachuStateData1FacingDirection")==12)looked=1;}if(!saw_start&&rd(e,"wSpritePikachuStateData1PictureID")){saw_start=1;fprintf(stderr,"mode %d initial partner %u,%u status %u image %u\n",mode,rd(e,"wSpritePikachuStateData2MapX"),rd(e,"wSpritePikachuStateData2MapY"),rd(e,"wSpritePikachuStateData1MovementStatus"),rd(e,"wSpritePikachuStateData1ImageIndex"));}}
  int blocked=mode==6;
  int done=active&&!rd(e,"wEditorSceneActive")&&!rd(e,"wJoyIgnore")&&(mode==9?rd(e,"wCurMap")!=map&&saw_battle:rd(e,actorX)==(blocked?8:9)&&rd(e,actorY)==(blocked?8:9));
  if(done)settled++;else settled=0;
  if(settled>30&&phase==0){
    int following=(mode==0||mode==6||mode==7||mode==8||mode==9);
    unsigned branch=emulator_read_u8_raw(e,flags+0x9d0/8);
    if((branch&3)!=(following?1:2))break;
    if((rd(e,"wPikachuOverworldStateFlags")&2)!=(mode==3?2:0))break;
    if((mode==0||mode==7||mode==8)&&(!parked||!looked))break;
    if((mode==1||mode==2||mode==4||mode==5)&&rd(e,"wSpritePikachuStateData1ImageIndex")!=255)break;
    if(mode==7&&rd(e,"wSpritePikachuStateData1ImageIndex")!=255)break;
    if(mode>=8&&!saw_battle)break;
    if(mode==9&&!emulator_read_u8_raw(e,sym("wPartyMon1HP").address)&&!emulator_read_u8_raw(e,sym("wPartyMon1HP").address+1))break;
    shot(e,argv[6]);parked=1;
    if(mode!=0&&mode!=7&&mode!=8){finished=1;break;}phase=1;
  }
  if(phase==1&&rd(e,"wXCoord")==2){phase=2;settled=0;}
  if(phase==2&&rd(e,"wWalkCounter")==0){settled++;if(settled>120){
    int dx=(int)rd(e,"wSpritePikachuStateData2MapX")-4-(int)rd(e,"wXCoord"),dy=(int)rd(e,"wSpritePikachuStateData2MapY")-4-(int)rd(e,"wYCoord");
    if(abs(dx)+abs(dy)<=1&&!(rd(e,"wPikachuOverworldStateFlags")&2)&&rd(e,"wSpritePikachuStateData1ImageIndex")!=255)finished=1;break;
  }}
  JoypadButtons buttons={0};if(frame%12<6){if(!entered){buttons.start=TRUE;buttons.A=TRUE;}else if(mode==9||(mode>=8&&(rd(e,"wEditorSceneBattle")||rd(e,"wIsInBattle"))))buttons.A=TRUE;else if(phase==1&&!rd(e,"wWalkCounter"))buttons.left=TRUE;}
  emulator_set_joypad_buttons(e,&buttons);if(emulator_run_until(e,emulator_get_ticks(e)+PPU_FRAME_TICKS)&EMULATOR_EVENT_INVALID_OPCODE)break;
 }
 if(!finished){shot(e,argv[6]);fprintf(stderr,"Partner mode %d failed: PC %04x map %u player %u,%u active %u state %u actor %u,%u partner %u,%u status %u picture %u image %u flags %02x parked %d phase %d battle %u/%u result %u party %u\n",mode,emulator_get_registers(e).PC,rd(e,"wCurMap"),rd(e,"wXCoord"),rd(e,"wYCoord"),rd(e,"wEditorSceneActive"),rd(e,"wEditorSceneState"),rd(e,actorX),rd(e,actorY),rd(e,"wSpritePikachuStateData2MapX"),rd(e,"wSpritePikachuStateData2MapY"),rd(e,"wSpritePikachuStateData1MovementStatus"),rd(e,"wSpritePikachuStateData1PictureID"),rd(e,"wSpritePikachuStateData1ImageIndex"),rd(e,"wPikachuOverworldStateFlags"),parked,phase,rd(e,"wEditorSceneBattle"),rd(e,"wIsInBattle"),rd(e,"wBattleResult"),rd(e,"wPartyCount"));}
 else printf("Partner mode %d: native %s, NPC path, input and follower state verified\n",mode,mode==0?"movement and follow resumption":mode==6?"blocked-route cleanup":mode==7?"blocked rejoin fallback":mode==8?"battle reentry and follow resumption":mode==9?"blackout cleanup":"absent/detached partner");
 emulator_delete(e);free(init.rom.data);return finished?0:1;
}
