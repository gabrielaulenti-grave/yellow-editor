#include "emulator-debug.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
typedef struct { char name[256]; unsigned bank, address; } Symbol;
static Symbol symbols[65536]; static int count; static unsigned bits[6], flags; static char actorX[80], actorY[80];
static Symbol sym(const char* name) { for(int i=0;i<count;i++)if(!strcmp(symbols[i].name,name))return symbols[i];fprintf(stderr,"Missing %s\n",name);exit(2); }
static unsigned rd(Emulator* e,const char* name){return emulator_read_u8_raw(e,sym(name).address);}
static int event(Emulator* e,int i){return !!(emulator_read_u8_raw(e,flags+bits[i]/8)&(1<<(bits[i]%8)));}
static void shot(Emulator* e,const char* path){FILE* f=fopen(path,"wb");if(f){fwrite(emulator_get_frame_buffer(e),4,160*144,f);fclose(f);}}
static int drive(Emulator* e,int mode,int reload,const char* image){
 int entered=0,battles=0,was_battle=0,phase=0,settle=0,attempts=0,last_active=0,windows=0,saw_handoff=0,declined=0;
 int selected=mode==1;
 for(int frame=0;frame<24000;frame++){
  int in_battle=rd(e,"wIsInBattle")==1||rd(e,"wIsInBattle")==2;
  if(in_battle&&!was_battle)battles++;was_battle=in_battle;
  if(rd(e,"wCurMap")==0x29&&rd(e,"wPartyCount"))entered=1;
  int active=rd(e,"wEditorSceneActive");unsigned x=rd(e,"wXCoord"),y=rd(e,"wYCoord");
  if(phase==3&&active&&!last_active){
   attempts++;if((rd(e,"wChoiceProbe")&127)!=windows){fprintf(stderr,"Blank launch text box: init %u expected %u\n",rd(e,"wChoiceProbe")&127,windows);return 1;}saw_handoff=1;phase=4;
  }
  last_active=active;
  JoypadButtons buttons={0};
  if(!entered){if(frame%12<6){buttons.A=TRUE;buttons.start=TRUE;}}
  else if(reload){
   if(!active&&!in_battle&&(rd(e,"wChoiceProbe")==0xe0)&&event(e,1)&&event(e,4)&&event(e,5)&&!rd(e,"wJoyIgnore"))settle++;else settle=0;
   if(settle>90){if(battles||!event(e,selected?3:2)||event(e,selected?2:3))return 1;shot(e,image);printf("mode %d: native Continue preserves chosen fossil and both hidden objects\n",mode);return 0;}
   if(frame%12<6&&rd(e,"wChoiceProbe")!=0xe0)buttons.A=TRUE;
  }else if(mode==4){
   if(battles&&!active&&!in_battle&&rd(e,"wCurMap")!=0x29&&!rd(e,"wJoyIgnore")){if(event(e,0)||event(e,1))return 1;printf("mode 4: native blackout leaves guardian and reward unclaimed\n");return 0;}
   if(frame%12<6)buttons.A=TRUE;
  }else if(phase==0){
   if(event(e,0)&&!active&&!in_battle&&!rd(e,"wJoyIgnore")){if(++settle>45){phase=1;settle=0;}}else settle=0;
   if(frame%12<6&&(active||!event(e,0)))buttons.A=TRUE;
  }else if(phase==1){
   if(x==8&&y==5&&!rd(e,"wWalkCounter")){phase=selected?3:2;windows=rd(e,"wChoiceProbe")&127;}else if(!rd(e,"wWalkCounter"))buttons.up=TRUE;
  }else if(phase==2){
   if(x==7&&y==5&&!rd(e,"wWalkCounter")){phase=3;windows=rd(e,"wChoiceProbe")&127;}else if(!rd(e,"wWalkCounter"))buttons.left=TRUE;
  }else if(phase==3){
   if(frame%12<6){if(rd(e,"wSpritePlayerStateData1FacingDirection")!=4)buttons.up=TRUE;else buttons.A=TRUE;}
  }else if(phase==4){
   if(!active&&!in_battle&&!rd(e,"wJoyIgnore")){
    if(++settle>45){
     if((mode==2&&!declined)||mode==3){if(event(e,1)||event(e,4)||event(e,5))return 1;
      if(mode==3){if(rd(e,"wNumBagItems")!=20)return 1;printf("mode 3: native full bag leaves both choices available, no reward or movement\n");return saw_handoff?0:1;}
      declined=1;phase=3;windows=rd(e,"wChoiceProbe")&127;settle=0;
     }else if((rd(e,"wChoiceProbe")==0xe0)&&event(e,1)&&event(e,4)&&event(e,5)){
      if(!event(e,selected?3:2)||event(e,selected?2:3)||rd(e,"wNumBagItems")!=1||rd(e,"wBagItems")!=(selected?42:41)||emulator_read_u8_raw(e,sym("wBagItems").address+1)!=1)return 1;
      if(rd(e,actorX)!=(selected?11:12)||rd(e,actorY)!=9||x!=(selected?8:7)||y!=5||!saw_handoff||battles!=1)return 1;
      shot(e,image);printf("mode %d: native battle, %s, one fossil, guardian route, hidden objects, no empty launch window and SRAM save verified\n",mode,declined?"No then Yes":"Yes");return 0;
     }
    }
   }else settle=0;
   if(active&&frame%12<6){if(mode==2&&!declined&&rd(e,"wTopMenuItemX")==15&&rd(e,"wTopMenuItemY")==8&&rd(e,"wMaxMenuItem")==1)buttons.B=TRUE;else buttons.A=TRUE;}
  }
  emulator_set_joypad_buttons(e,&buttons);if(emulator_run_until(e,emulator_get_ticks(e)+PPU_FRAME_TICKS)&EMULATOR_EVENT_INVALID_OPCODE)break;
  if(frame%3000==2999)fprintf(stderr,"mode %d reload %d frame %d phase %d pos %u,%u map %u battle %d active %u state %u flags %d%d%d%d%d%d menu %u,%u/%u\n",mode,reload,frame,phase,x,y,rd(e,"wCurMap"),battles,active,rd(e,"wEditorSceneState"),event(e,0),event(e,1),event(e,2),event(e,3),event(e,4),event(e,5),rd(e,"wTopMenuItemX"),rd(e,"wTopMenuItemY"),rd(e,"wCurrentMenuItem"));
 }
 shot(e,image);fprintf(stderr,"Fossil failed mode %d reload %d phase %d PC %04x map %u active %u attempts %d\n",mode,reload,phase,emulator_get_registers(e).PC,rd(e,"wCurMap"),rd(e,"wEditorSceneActive"),attempts);return 1;
}
int main(int argc,char**argv){
 if(argc!=12)return 2;FILE*f=fopen(argv[2],"r");if(!f)return 2;char line[512];while(fgets(line,sizeof(line),f)&&count<65536)if(sscanf(line,"%x:%x %255s",&symbols[count].bank,&symbols[count].address,symbols[count].name)==3)count++;fclose(f);
 f=fopen(argv[1],"rb");if(!f)return 2;fseek(f,0,SEEK_END);long size=ftell(f);rewind(f);EmulatorInit init={0};init.rom.data=malloc(size);init.rom.size=size;if(fread(init.rom.data,1,size,f)!=(size_t)size)return 2;fclose(f);
 int actor=atoi(argv[10]);snprintf(actorX,sizeof(actorX),"wSprite%02dStateData2MapX",actor);snprintf(actorY,sizeof(actorY),"wSprite%02dStateData2MapY",actor);
 int mode=atoi(argv[3]);Symbol m=sym("ChoiceMode");init.rom.data[m.bank*0x4000+m.address%0x4000]=mode;flags=sym("wEventFlags").address;for(int i=0;i<6;i++)bits[i]=strtoul(argv[4+i],0,16);
 init.audio_frequency=44100;init.audio_frames=4096;init.random_seed=123;init.force_dmg=TRUE;Emulator*e=emulator_new(&init);if(!e)return 2;int result=drive(e,mode,0,argv[11]);
 if(!result&&mode!=3&&mode!=4){FileData battery={0};emulator_init_ext_ram_file_data(e,&battery);if(emulator_write_ext_ram(e,&battery)!=OK)return 2;emulator_delete(e);e=emulator_new(&init);if(!e||emulator_read_ext_ram(e,&battery)!=OK)return 2;free(battery.data);result=drive(e,mode,1,argv[11]);}
 emulator_delete(e);free(init.rom.data);return result;
}
