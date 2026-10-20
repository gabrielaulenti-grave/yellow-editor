/* Full native ROM smoke test. Only the new-game fixture's scenario byte is
 * seeded. Battles, menus, capture, blackout, SRAM save/load and rendering run
 * unmodified; the controller supplies ordinary joypad presses. */
#include "emulator-debug.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct { char name[256]; unsigned bank, address; } Symbol;
static Symbol symbols[65536]; static int symbol_count; static unsigned event_base, species;
static Symbol get(const char* name) {
  for (int i = 0; i < symbol_count; i++) if (!strcmp(symbols[i].name, name)) return symbols[i];
  fprintf(stderr, "Missing native gameplay symbol %s\n", name); exit(2);
}
static unsigned address(const char* name) { return get(name).address; }
static unsigned read8(Emulator* e, unsigned a) { return emulator_read_u8_raw(e, a); }
static int event(Emulator* e, unsigned bit) { return read8(e, event_base + bit / 8) & (1u << (bit % 8)); }
static int still_visible(Emulator* e) {
  int count = 0;
  for (unsigned a = 0xfe00; a < 0xfea0; a += 4) {
    unsigned y = read8(e, a), x = read8(e, a + 1), tile = read8(e, a + 2);
    if (y > 0 && y < 160 && x > 0 && x < 168 && tile >= 0x78 && tile < 0x7c) count++;
  }
  return count;
}
static void screenshot(Emulator* e, const char* path) {
  FILE* out = fopen(path, "wb"); if (!out) return;
  fwrite(emulator_get_frame_buffer(e), 4, 160 * 144, out); fclose(out);
}
static int drive(Emulator* e, int mode, int reload, unsigned map, unsigned done, unsigned hidden, const char* shot) {
  unsigned cur_map = address("wCurMap"), active = address("wEditorSceneActive"), battle = address("wIsInBattle"), saved = address("wEditorSmokeSaved");
  unsigned party = address("wPartyCount"), box = address("wBoxCount"), menu_x = address("wTopMenuItemX"), menu_y = address("wTopMenuItemY"), menu_item = address("wCurrentMenuItem");
  int entered = 0, saw_battle = 0, previous_battle = 0, saw_sprite = 0, settled = 0, retry_stage = 0;
  unsigned expected_party = mode == 2 ? 6 : 1;
  for (int step = 0; step < 18000; step++) {
    unsigned frame = emulator_get_ticks(e) / PPU_FRAME_TICKS;
    int in_battle = read8(e, battle) == 1 || read8(e, battle) == 2;
    if (in_battle && !previous_battle) { saw_battle++; fprintf(stderr, "mode %d%s: native battle entered at frame %u\n", mode, reload ? " reload" : "", frame); }
    previous_battle = in_battle;
    if (read8(e, cur_map) == map && read8(e, party) >= expected_party) entered = 1;
    if (entered && !in_battle && read8(e, active) && still_visible(e)) {
      if (!saw_sprite) { char before[1024]; snprintf(before, sizeof(before), "%s.before", shot); screenshot(e, before); } saw_sprite = 1;
    }
    int lost = mode == 4 || mode == 6;
    int escaped = mode == 3;
    int complete = reload ? entered && event(e, done) && read8(e, saved) == 0x5a && !read8(e, active) : lost ? entered && saw_battle && read8(e, cur_map) != map && !read8(e, active) : escaped ? saw_battle && !in_battle && !read8(e, active) && event(e, 0x9f3) : read8(e, saved) == 0x5a;
    if (complete && !in_battle && !read8(e, address("wJoyIgnore"))) settled++; else settled = 0;
    if (mode == 3 && !reload && saw_battle == 1 && settled > 60 && retry_stage == 0) { retry_stage = 1; settled = 0; }
    if (retry_stage == 1 && read8(e, address("wXCoord")) == 3) retry_stage = 2;
    if (retry_stage == 2 && read8(e, address("wXCoord")) == 4) retry_stage = 3;
    if (settled > 60 && (mode != 3 || saw_battle >= 2)) {
      if ((!reload && !saw_battle) || (reload && saw_battle) || (!reload && !saw_sprite)) break;
      if (lost || escaped) { if (event(e, done) || event(e, hidden)) break; if (lost && !read8(e, address("wPartyMon1HP")) && !read8(e, address("wPartyMon1HP") + 1)) break; }
      else if (!event(e, done) || !event(e, hidden) || still_visible(e)) break;
      if ((mode == 1 || mode == 2) && (read8(e, party) != (mode == 2 ? 6 : 2) || read8(e, box) != (mode == 2 ? 1 : 0) || !event(e, 0x9f2))) break;
      if ((mode == 0 || mode == 5) && !event(e, 0x9f1)) break;
      if (read8(e,address("wEditorSceneBattle")) || read8(e,address("wEditorScenePalette")) || read8(e,address("wEditorSceneMusic")) || read8(e,0xff47)==0xff) break;
      if ((mode==1 && read8(e,address("wPartySpecies")+1)!=species) || (mode==2 && read8(e,address("wBoxSpecies"))!=species)) break;
      if ((mode==1 || mode==2) && (read8(e,address("wBagItems"))!=1 || read8(e,address("wBagItems")+1)!=98)) break;
      if (mode==5 && read8(e,address("wPlayerMoney"))==0 && read8(e,address("wPlayerMoney")+1)<=0x30) break;
      screenshot(e, shot); printf("mode %d%s: native outcome, visibility, input and %s verified\n", mode, reload ? " reload" : "", reload ? "battery reload" : lost ? "blackout" : escaped ? "escape retry" : "save"); return 0;
    }
    JoypadButtons buttons = {0};
    if (frame % 12 < 6) {
      if (retry_stage == 1) buttons.left = TRUE;
      else if (retry_stage == 2) buttons.right = TRUE;
      else if (!entered) { buttons.A = TRUE; buttons.start = TRUE; }
      else if (saw_battle && (mode == 1 || mode == 2) && (read8(e, party) > expected_party || read8(e, box))) buttons.B = TRUE;
      else if (in_battle && read8(e, menu_y) == 14 && read8(e, address("wMaxMenuItem")) == 1 && (read8(e, menu_x) == 9 || read8(e, menu_x) == 15) && (mode == 1 || mode == 2 || mode == 3)) {
        unsigned x = read8(e, menu_x), item = read8(e, menu_item);
        if (mode == 3 && x != 15) buttons.right = TRUE;
        else if (mode != 3 && x != 9) buttons.left = TRUE;
        else if (item == 0) buttons.down = TRUE;
        else buttons.A = TRUE;
      } else buttons.A = TRUE;
    }
    emulator_set_joypad_buttons(e, &buttons);
    EmulatorEvent result = emulator_run_until(e, emulator_get_ticks(e) + PPU_FRAME_TICKS);
    if (result & EMULATOR_EVENT_INVALID_OPCODE) break;
    if (step % 2400 == 2399) fprintf(stderr, "mode %d: frame %u map %02x active %u battle %u PC %04x menu %u,%u/%u saved %02x\n", mode, frame, read8(e, cur_map), read8(e, active), read8(e, battle), emulator_get_registers(e).PC, read8(e, menu_x), read8(e, menu_y), read8(e, menu_item), read8(e, saved));
  }
  screenshot(e, shot);
  fprintf(stderr, "Native gameplay failed mode %d reload %d: PC %04x bank %02x map %02x entered %d battles %d static sprite %d active %u phase %u result %u party %u box %u saved %02x joy %02x done %d hidden %d\n", mode, reload, emulator_get_registers(e).PC, read8(e,address("hLoadedROMBank")), read8(e, cur_map), entered, saw_battle, saw_sprite, read8(e, active), read8(e,address("wEditorSceneBattle")), read8(e,address("wEditorSceneBattleResult")), read8(e,party),read8(e,box),read8(e,saved),read8(e,address("wJoyIgnore")),event(e,done),event(e,hidden)); return 1;
}
int main(int argc, char** argv) {
  if (argc != 9) return 2;
  FILE* file = fopen(argv[2], "r"); if (!file) return 2;
  char line[512]; while (fgets(line,sizeof(line),file) && symbol_count < 65536) if (sscanf(line,"%x:%x %255s",&symbols[symbol_count].bank,&symbols[symbol_count].address,symbols[symbol_count].name)==3) symbol_count++; fclose(file);
  file=fopen(argv[1],"rb"); if(!file)return 2;fseek(file,0,SEEK_END);long size=ftell(file);rewind(file);
  EmulatorInit init={0};init.rom.data=malloc(size);init.rom.size=size;if(fread(init.rom.data,1,size,file)!=(size_t)size)return 2;fclose(file);
  event_base=address("wEventFlags"); Symbol mon=get("SmokeSpecies"); species=init.rom.data[mon.bank*0x4000+mon.address%0x4000];
  int mode=atoi(argv[3]);Symbol variant=get("SmokeMode");init.rom.data[variant.bank*0x4000+variant.address%0x4000]=mode;
  init.audio_frequency=44100;init.audio_frames=4096;init.random_seed=123;init.force_dmg=TRUE;
  Emulator* e=emulator_new(&init);if(!e)return 2;
  int result=drive(e,mode,0,strtoul(argv[4],0,16),strtoul(argv[5],0,16),strtoul(argv[6],0,16),argv[8]);
  if(!result && mode!=3 && mode!=4 && mode!=6) {
    FileData battery={0};emulator_init_ext_ram_file_data(e,&battery);if(emulator_write_ext_ram(e,&battery)!=OK)return 2;
    FILE* save=fopen(argv[7],"wb");if(save){fwrite(battery.data,1,battery.size,save);fclose(save);}
    emulator_delete(e);e=emulator_new(&init);if(!e || emulator_read_ext_ram(e,&battery)!=OK)return 2;free(battery.data);
    result=drive(e,mode,1,strtoul(argv[4],0,16),strtoul(argv[5],0,16),strtoul(argv[6],0,16),argv[8]);
  }
  emulator_delete(e);free(init.rom.data);return result;
}
