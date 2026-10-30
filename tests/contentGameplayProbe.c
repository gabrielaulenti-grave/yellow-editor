/* Complete native journey: new move, new trainer party, new species, capture,
 * Pokédex bit 153, PC deposit/withdraw and SRAM Continue. Joypad input only. */
#include "emulator-debug.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
typedef struct { char name[256]; unsigned bank,address; } Symbol;
static Symbol symbols[65536];static int count;
static Symbol get(const char*name){static Symbol cache[64];static int used;for(int i=0;i<used;i++)if(!strcmp(name,cache[i].name))return cache[i];for(int i=0;i<count;i++)if(!strcmp(name,symbols[i].name)){if(used<64)cache[used++]=symbols[i];return symbols[i];}fprintf(stderr,"Missing %s\n",name);exit(2);}
static unsigned rd(Emulator*e,const char*name){return emulator_read_u8_raw(e,get(name).address);}
static int at(Emulator*e,const char*name){Symbol s=get(name);return emulator_get_registers(e).PC==s.address&&(s.bank==0||rd(e,"hLoadedROMBank")==s.bank);}
static int dex(Emulator*e,const char*name,unsigned number){return !!(emulator_read_u8_raw(e,get(name).address+(number-1)/8)&(1u<<((number-1)%8)));}
static int drive(Emulator*e,int reload,unsigned animation,unsigned map,unsigned species,unsigned move,unsigned dexno){
 int battles=0,previous=0,played=0,settled=0,deposited=0,withdrawn=0;
 for(int n=0;n<400000;n++){
  unsigned frame=emulator_get_ticks(e)/PPU_FRAME_TICKS;int battle=rd(e,"wIsInBattle")==1||rd(e,"wIsInBattle")==2;
  if(battle&&!previous)battles++;previous=battle;
  if(rd(e,"wContentJourneyState")==1&&rd(e,"wPartyCount")==5)deposited=1;
  if(rd(e,"wPartyCount")==6&&emulator_read_u8_raw(e,get("wPartySpecies").address+5)==species)withdrawn=1;
  int done=rd(e,"wContentJourneyState")==0x5a&&!battle&&!rd(e,"wJoyIgnore")&&!rd(e,"wEditorSceneActive");
  if(done)settled++;else settled=0;
  if(settled>90){
   if((reload&&battles)||(!reload&&(battles!=2||!played||!deposited||!withdrawn))||!dex(e,"wPokedexSeen",dexno)||!dex(e,"wPokedexOwned",dexno)||!withdrawn||rd(e,"wPartyMon6Moves")!=move||rd(e,"wBoxCount")!=1){fprintf(stderr,"Journey invariants failed reload%d battles%d animation%d deposit%d withdraw%d owned%d seen%d move%u box%u\n",reload,battles,played,deposited,withdrawn,dex(e,"wPokedexOwned",dexno),dex(e,"wPokedexSeen",dexno),rd(e,"wPartyMon6Moves"),rd(e,"wBoxCount"));return 1;}
   printf("Native content%s: new trainer/move/species, capture, Pokédex #%u, PC deposit/withdraw and save state passed.\n",reload?" Continue":"",dexno);return 0;
  }
  JoypadButtons buttons={0};
  if(frame%12<6){
   unsigned state=rd(e,"wContentJourneyState"),x=rd(e,"wTopMenuItemX"),y=rd(e,"wTopMenuItemY"),item=rd(e,"wCurrentMenuItem"),max=rd(e,"wMaxMenuItem");
   if(state==1){
    if(withdrawn)buttons.B=TRUE;
    else if(max==5&&x==1&&y==2){unsigned target=deposited?0:1;if(item<target)buttons.down=TRUE;else if(item>target)buttons.up=TRUE;else buttons.A=TRUE;}
    else buttons.A=TRUE;
   }else if(!battle&&rd(e,"wCurMap")!=map){buttons.A=TRUE;buttons.start=TRUE;}
   else if(battles>=2&&rd(e,"wBoxCount"))buttons.B=TRUE;
   else if(battle&&battles==2&&max==1&&y==14&&(x==9||x==15)){if(x!=9)buttons.left=TRUE;else if(item==0)buttons.down=TRUE;else buttons.A=TRUE;}
   else buttons.A=TRUE;
  }
  emulator_set_joypad_buttons(e,&buttons);
  if(battle){for(int i=0;i<1000;i++){if(rd(e,"wAnimationID")==animation&&at(e,"DrawFrameBlock"))played=1;emulator_step(e);}}
  else if(emulator_run_until(e,emulator_get_ticks(e)+PPU_FRAME_TICKS)&EMULATOR_EVENT_INVALID_OPCODE)break;
  if(n%40000==39999)fprintf(stderr,"Journey reload%d PC%04x frame%u state%u battles%d party%u box%u menu%u,%u/%u played%d\n",reload,emulator_get_registers(e).PC,frame,rd(e,"wContentJourneyState"),battles,rd(e,"wPartyCount"),rd(e,"wBoxCount"),rd(e,"wTopMenuItemX"),rd(e,"wTopMenuItemY"),rd(e,"wCurrentMenuItem"),played);
 }
 fprintf(stderr,"Journey failed reload%d PC%04x map%u state%u battles%d party%u box%u played%d deposit%d withdraw%d\n",reload,emulator_get_registers(e).PC,rd(e,"wCurMap"),rd(e,"wContentJourneyState"),battles,rd(e,"wPartyCount"),rd(e,"wBoxCount"),played,deposited,withdrawn);return 1;
}
int main(int argc,char**argv){
 if(argc!=8)return 2;FILE*f=fopen(argv[2],"r");if(!f)return 2;char line[512];while(fgets(line,sizeof(line),f)&&count<65536)if(sscanf(line,"%x:%x %255s",&symbols[count].bank,&symbols[count].address,symbols[count].name)==3)count++;fclose(f);
 f=fopen(argv[1],"rb");if(!f)return 2;fseek(f,0,SEEK_END);long size=ftell(f);rewind(f);EmulatorInit init={0};init.rom.data=malloc(size);init.rom.size=size;if(fread(init.rom.data,1,size,f)!=(size_t)size)return 2;fclose(f);init.audio_frequency=44100;init.audio_frames=4096;init.random_seed=123;init.force_dmg=TRUE;Emulator*e=emulator_new(&init);if(!e)return 2;
 unsigned animation=atoi(argv[3]),map=atoi(argv[4]),species=atoi(argv[5]),move=atoi(argv[6]),dexno=atoi(argv[7]);int result=drive(e,0,animation,map,species,move,dexno);
 if(!result){FileData save={0};emulator_init_ext_ram_file_data(e,&save);if(emulator_write_ext_ram(e,&save)!=OK)return 2;emulator_delete(e);e=emulator_new(&init);if(!e||emulator_read_ext_ram(e,&save)!=OK)return 2;free(save.data);result=drive(e,1,animation,map,species,move,dexno);}
 emulator_delete(e);free(init.rom.data);return result;
}
