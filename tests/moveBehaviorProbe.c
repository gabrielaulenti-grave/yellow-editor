#include "emulator-debug.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(int argc,char**argv){
 if(argc!=3)return 2;FILE*f=fopen(argv[2],"r");char line[512],name[256];unsigned bank,address,result=0;
 while(fgets(line,sizeof(line),f))if(sscanf(line,"%x:%x %255s",&bank,&address,name)==3&&!strcmp(name,"wUnusedPlayerDataByte"))result=address;fclose(f);if(!result)return 2;
 f=fopen(argv[1],"rb");fseek(f,0,SEEK_END);long size=ftell(f);rewind(f);EmulatorInit init={0};init.rom.data=malloc(size);init.rom.size=size;if(fread(init.rom.data,1,size,f)!=(size_t)size)return 2;fclose(f);init.audio_frequency=44100;init.audio_frames=4096;init.random_seed=123;init.force_dmg=TRUE;
 Emulator*e=emulator_new(&init);for(int n=0;n<300;n++){unsigned state=emulator_read_u8_raw(e,result);if(state==0x5a){puts("Native move properties passed for both sides, including combined stat changes, caps, shared accuracy, Substitute/Mist, badges, burn and paralysis.");return 0;}if(state==255)break;if(emulator_run_until(e,emulator_get_ticks(e)+PPU_FRAME_TICKS)&EMULATOR_EVENT_INVALID_OPCODE)break;}
 fprintf(stderr,"Move behavior probe failed: state %u PC %04x bank %u stage %u check %u A %u F %u\n",emulator_read_u8_raw(e,result),emulator_get_registers(e).PC,bank,emulator_read_u8_raw(e,0xc100),emulator_read_u8_raw(e,0xc101),emulator_get_registers(e).A,emulator_get_registers(e).F);return 1;
}
