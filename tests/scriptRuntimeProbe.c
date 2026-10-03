/* Runs assembled script probes using the same pinned binjgb CPU as the app.
 * Usage: script-runtime-probe rom.gb stop_pc address=value ... (hexadecimal).
 */
#include "emulator-debug.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(int argc, char **argv) {
  if (argc < 4) return 2;
  FILE *file = fopen(argv[1], "rb");
  if (!file) return 2;
  fseek(file, 0, SEEK_END);
  long size = ftell(file);
  rewind(file);
  if (size <= 0) return 2;
  EmulatorInit init;
  memset(&init, 0, sizeof(init));
  init.rom.data = malloc((size_t)size);
  init.rom.size = (size_t)size;
  if (!init.rom.data || fread(init.rom.data, 1, (size_t)size, file) != (size_t)size) return 2;
  fclose(file);
  init.audio_frequency = 44100;
  init.audio_frames = 4096;
  init.random_seed = 123;
  init.force_dmg = TRUE;
  Emulator *emulator = emulator_new(&init);
  if (!emulator) return 2;
  unsigned stop_pc = (unsigned)strtoul(argv[2], NULL, 16);
  int reached = 0;
  for (int step = 0; step < 500000; step++) {
    if (emulator_get_registers(emulator).PC == stop_pc) { reached = 1; break; }
    emulator_step(emulator);
  }
  if (!reached) {
    fprintf(stderr, "Script did not return to probe endpoint %04x (PC=%04x).\n", stop_pc, emulator_get_registers(emulator).PC);
    return 1;
  }
  for (int index = 3; index < argc; index++) {
    unsigned address, expected;
    if (sscanf(argv[index], "%x=%x", &address, &expected) != 2 || address > 0xffff || expected > 0xff) return 2;
    unsigned actual = emulator_read_u8_raw(emulator, (Address)address);
    if (actual != expected) {
      fprintf(stderr, "Unexpected RAM at %04x: expected %02x, got %02x.\n", address, expected, actual);
      return 1;
    }
  }
  emulator_delete(emulator);
  free(init.rom.data);
  return 0;
}
