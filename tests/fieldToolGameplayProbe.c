/* Native game controller: no RAM injection after boot. */
#include "emulator-debug.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
typedef struct { char name[256]; unsigned bank,address; } Symbol;
static Symbol syms[65536]; static int count;
static Symbol get(const char*n){for(int i=0;i<count;i++)if(!strcmp(n,syms[i].name))return syms[i];fprintf(stderr,"Missing %s\n",n);exit(2);}
static unsigned rd(Emulator*e,const char*n){return emulator_read_u8_raw(e,get(n).address);}
static void shot(Emulator*e,const char*p){FILE*f=fopen(p,"wb");if(f){fwrite(emulator_get_frame_buffer(e),4,160*144,f);fclose(f);}}
static int message(Emulator*e,const char*text){unsigned base=get("wTileMap").address;size_t len=strlen(text);for(unsigned i=0;i+len<=360;i++){int match=1;for(size_t j=0;j<len;j++){unsigned c=text[j],tile=c>='A'&&c<='Z'?0x80+c-'A':c>='a'&&c<='z'?0xa0+c-'a':c==' '?0x7f:c=='.'?0xe8:c=='!'?0xe7:0;if(emulator_read_u8_raw(e,base+i+j)!=tile){match=0;break;}}if(match)return 1;}return 0;}
int main(int argc,char**argv){
 if(argc!=9)return 2;FILE*f=fopen(argv[2],"r");if(!f)return 2;char line[512];while(fgets(line,sizeof(line),f)&&count<65536)if(sscanf(line,"%x:%x %255s",&syms[count].bank,&syms[count].address,syms[count].name)==3)count++;fclose(f);
 f=fopen(argv[1],"rb");if(!f)return 2;fseek(f,0,SEEK_END);long size=ftell(f);rewind(f);EmulatorInit init={0};init.rom.data=malloc(size);init.rom.size=size;if(fread(init.rom.data,1,size,f)!=(size_t)size)return 2;fclose(f);
 int mode=atoi(argv[3]);Symbol m=get("FieldToolSmokeMode"),w=get("NewGameWarp");init.rom.data[m.bank*0x4000+m.address%0x4000]=mode;
 unsigned map=strtoul(argv[4],0,16),x=atoi(argv[5]),y=atoi(argv[6]),width=atoi(argv[7]),view=get("wOverworldMap").address+7+width+(width+6)*(y>>1)+(x>>1),at=w.bank*0x4000+w.address%0x4000;
 init.rom.data[at+1]=view&255;init.rom.data[at+2]=view>>8;init.rom.data[at+3]=y;init.rom.data[at+4]=x;init.rom.data[at+5]=y&1;init.rom.data[at+6]=x&1;
 init.audio_frequency=44100;init.audio_frames=4096;init.random_seed=123;init.force_dmg=TRUE;Emulator*e=emulator_new(&init);if(!e)return 2;
 int entered=-1,success=-1,menu=0,sawText=0;unsigned basebank=0;int moved=0,control=0;unsigned controlX=0,controlY=0;
 for(int n=0;n<12000;n++){
  if(entered<0&&rd(e,"wCurMap")==map&&rd(e,"wNumBagItems")==1)entered=n;
  int t=entered<0?-1:n-entered; JoypadButtons b={0};
  if(t<0){if(n%12<6){b.A=TRUE;b.start=TRUE;}}
  else if(t<50){if(t%12<6)b.B=TRUE;}
  else if(t<90){if(mode==2)b.right=TRUE;else if(mode==3)b.up=TRUE;}
  else if(t<120){}
  else if(t<130)b.start=TRUE;
  else if(t<160){}
  else if(t<170)b.down=TRUE;
  else if(t<200){}
  else if(t<210)b.A=TRUE;
  else if(t<240){}
  else if(t<250)b.A=TRUE;
  else if(t<280){}
  else if(t<290)b.A=TRUE;
  else if(rd(e,"wTownMapSpriteBlinkingEnabled")){menu=1;if(n%12<6){if(mode==4)b.B=TRUE;else b.A=TRUE;}}
  else if(success<0){if(n%12<6)b.A=TRUE;}
  else if(n-success<120){if(n%12<6)b.B=TRUE;}
  else {if(!control){controlX=rd(e,"wXCoord");controlY=rd(e,"wYCoord");control=1;}if(mode==3)b.up=TRUE;else b.left=TRUE;}
  const char*names[]={"FLASH!","STRENGTH!","RAFT!","CUT!","Cancelled.","FLY!","DIG!","TELEPORT!"};
  if(!sawText&&message(e,names[mode])&&(mode==4||message(e,"RED used"))){sawText=1;shot(e,argv[8]);}
  int effect=mode==0?rd(e,"wMapPalOffset")==0:mode==1?(rd(e,"wStatusFlags1")&1):mode==2?rd(e,"wWalkBikeSurfState")==2:mode==3?rd(e,"wCutTile")==0x3d:mode==4?menu&&!rd(e,"wTownMapSpriteBlinkingEnabled")&&!(rd(e,"wStatusFlags6")&8):mode==5?rd(e,"wCurMap")!=map:rd(e,"wCurMap")==1;
  if(t>290&&effect&&sawText&&success<0){success=n;basebank=rd(e,"hLoadedROMBank");}
  if(success>=0&&n-success>120&&!rd(e,"wJoyIgnore")&&!(rd(e,"wFontLoaded")&1)&&(control&&(rd(e,"wXCoord")!=controlX||rd(e,"wYCoord")!=controlY))){moved=1;break;}
  emulator_set_joypad_buttons(e,&b);EmulatorEvent result=emulator_run_until(e,emulator_get_ticks(e)+PPU_FRAME_TICKS);if(result&EMULATOR_EVENT_INVALID_OPCODE)break;
  if(n%3000==2999)fprintf(stderr,"field mode%d frame%d PC%04x map%02x pos%u,%u action%u pal%u surf%u flags%02x font%u joy%02x menu%d success%d\n",mode,n,emulator_get_registers(e).PC,rd(e,"wCurMap"),rd(e,"wXCoord"),rd(e,"wYCoord"),rd(e,"wActionResultOrTookBattleTurn"),rd(e,"wMapPalOffset"),rd(e,"wWalkBikeSurfState"),rd(e,"wStatusFlags6"),rd(e,"wFontLoaded"),rd(e,"wJoyIgnore"),menu,success);
 }
 if(!sawText)shot(e,argv[8]);int ok=moved&&success>=0&&rd(e,"wPartyCount")==0&&rd(e,"wObtainedBadges")==0&&emulator_read_u8_raw(e,get("wBagItems").address+1)==(mode==6?2:3)&&rd(e,"wTownVisitedFlag")<=3&&emulator_read_u8_raw(e,get("wTownVisitedFlag").address+1)==0;
 if(!ok)fprintf(stderr,"Field gameplay failure mode%d PC%04x bank%02x initialbank%02x map%02x pos%u,%u result%u joy%02x party%u badges%u quantity%u moved%d success%d\n",mode,emulator_get_registers(e).PC,rd(e,"hLoadedROMBank"),basebank,rd(e,"wCurMap"),rd(e,"wXCoord"),rd(e,"wYCoord"),rd(e,"wActionResultOrTookBattleTurn"),rd(e,"wJoyIgnore"),rd(e,"wPartyCount"),rd(e,"wObtainedBadges"),emulator_read_u8_raw(e,get("wBagItems").address+1),moved,success);
 else printf("Native field tool mode%d: item menu, effect, empty party, no badges, bag quantity and player control passed\n",mode);
 emulator_delete(e);free(init.rom.data);return ok?0:1;
}
