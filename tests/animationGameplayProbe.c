/* Real game initialization, trainer portrait, battle menus and animation engine.
 * Input is ordinary joypad presses; no battle/animation RAM is patched. */
#include "emulator-debug.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
typedef struct { char name[256]; unsigned bank, address; } Symbol;
static Symbol symbols[65536]; static int count;
static Symbol get(const char* name) { static Symbol cache[32];static int used;for(int i=0;i<used;i++)if(!strcmp(name,cache[i].name))return cache[i];for(int i=0;i<count;i++)if(!strcmp(name,symbols[i].name)){if(used<32)cache[used++]=symbols[i];return symbols[i];}fprintf(stderr,"Missing %s\n",name);exit(2); }
static unsigned rd(Emulator* e,const char* name) { return emulator_read_u8_raw(e,get(name).address); }
static int at(Emulator*e,const char*name) { Symbol s=get(name);return emulator_get_registers(e).PC==s.address&&(s.bank==0||rd(e,"hLoadedROMBank")==s.bank); }
int main(int argc,char**argv) {
 if(argc!=5)return 2;FILE*f=fopen(argv[2],"r");if(!f)return 2;char line[512];while(fgets(line,sizeof(line),f)&&count<65536)if(sscanf(line,"%x:%x %255s",&symbols[count].bank,&symbols[count].address,symbols[count].name)==3)count++;fclose(f);
 f=fopen(argv[1],"rb");if(!f)return 2;fseek(f,0,SEEK_END);long size=ftell(f);rewind(f);EmulatorInit init={0};init.rom.data=malloc(size);init.rom.size=size;if(fread(init.rom.data,1,size,f)!=(size_t)size)return 2;fclose(f);init.audio_frequency=44100;init.audio_frames=4096;init.random_seed=123;init.force_dmg=TRUE;Emulator*e=emulator_new(&init);if(!e)return 2;
 unsigned animation=atoi(argv[3]),map=atoi(argv[4]);int battle=0,play=0,frames=0,effect=0,returned=0,settled=0;
 for(int n=0;n<200000;n++) {
  unsigned frame=emulator_get_ticks(e)/PPU_FRAME_TICKS;
  if(rd(e,"wIsInBattle")==2)battle=1;
  if(battle&&rd(e,"wAnimationID")==animation) {
   if(at(e,"PlayAnimation"))play=1;
   if(at(e,"DrawFrameBlock"))frames=1;
   if(at(e,"AnimationFlashScreen"))effect=1;
   if(at(e,"MoveAnimation.animationFinished"))returned=1;
  }
  if(battle&&play&&frames&&effect&&returned&&!rd(e,"wIsInBattle")&&rd(e,"wCurMap")==map&&!rd(e,"wJoyIgnore")&&!rd(e,"wEditorSceneActive"))settled++;
  if(settled>300){printf("Native battle: new trainer portrait/class, allocated animation %u, tile frames, effect hook and return to gameplay passed.\n",animation);emulator_delete(e);free(init.rom.data);return 0;}
  JoypadButtons buttons={0};if(frame%12<6){buttons.A=TRUE;if(!battle&&rd(e,"wCurMap")!=map)buttons.start=TRUE;}emulator_set_joypad_buttons(e,&buttons);
  /* Observe actual instruction boundaries while the custom animation runs. */
  if(rd(e,"wIsInBattle")) { for(int i=0;i<500;i++){if(rd(e,"wAnimationID")==animation){if(at(e,"PlayAnimation"))play=1;if(at(e,"DrawFrameBlock"))frames=1;if(at(e,"AnimationFlashScreen"))effect=1;if(at(e,"MoveAnimation.animationFinished"))returned=1;}emulator_step(e);} }
  else if(emulator_run_until(e,emulator_get_ticks(e)+PPU_FRAME_TICKS)&EMULATOR_EVENT_INVALID_OPCODE)break;
 }
 fprintf(stderr,"Animation gameplay failed: PC%04x map%u battle%d play%d frames%d effect%d return%d anim%u joy%u\n",emulator_get_registers(e).PC,rd(e,"wCurMap"),battle,play,frames,effect,returned,rd(e,"wAnimationID"),rd(e,"wJoyIgnore"));return 1;
}
