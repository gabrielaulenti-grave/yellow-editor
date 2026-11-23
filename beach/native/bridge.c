// Build in the same translation unit as the pinned core to use its raw,
// side-effect-free memory reader. The pipe protocol has no memory write command.
#include <stdio.h>
#define printf(...) fprintf(stderr, __VA_ARGS__)
#include "emulator.c"
#undef printf

static void get_buttons(JoypadButtons* out, void* data) {
  *out = *(JoypadButtons*)data;
}

int main(int argc, char** argv) {
  if (argc < 3 || argc > 130) return 2;
  unsigned char memory[128];
  Address addresses[128];
  for (int i = 2; i < argc; i++) {
    char* end;
    unsigned long address = strtoul(argv[i], &end, 16);
    if (*end || address > 0xffff) return 2;
    addresses[i - 2] = (Address)address;
  }

  EmulatorInit init = {0};
  if (!SUCCESS(file_read(argv[1], &init.rom))) return 2;
  init.audio_frequency = 44100;
  init.audio_frames = 4096;
  // Same power-on hardware defaults as Yellow Editor's binjgb adapter.
  init.random_seed = 0xcabba6e5;
  Emulator* emulator = emulator_new(&init);
  if (!emulator) return 2;
  JoypadButtons buttons = {0};
  emulator_set_joypad_callback(emulator, get_buttons, &buttons);
  Ticks target = emulator_get_ticks(emulator);
  int command;
  while ((command = getchar()) != EOF) {
    memset(&buttons, 0, sizeof(buttons));
    buttons.left = (command & 3) == 1;
    buttons.right = (command & 3) == 2;
    buttons.A = (command & 3) == 3;
    target += PPU_FRAME_TICKS;
    EmulatorEvent event;
    do {
      event = emulator_run_until(emulator, target);
      if (event & EMULATOR_EVENT_INVALID_OPCODE) return 3;
    } while (!(event & EMULATOR_EVENT_UNTIL_TICKS));

    const size_t size = argc - 2;
    for (size_t i = 0; i < size; i++) memory[i] = read_u8_raw(emulator, addresses[i]);
    if (fwrite(memory, 1, size, stdout) != size) break;
    if (command & 4) {
      FrameBuffer* frame = emulator_get_frame_buffer(emulator);
      if (fwrite(frame, 1, sizeof(*frame), stdout) != sizeof(*frame)) break;
    }
    if (fflush(stdout) != 0) break;
  }
  emulator_delete(emulator);
  free(init.rom.data);
  return 0;
}
