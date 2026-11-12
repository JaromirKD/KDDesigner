// Test builds only (env machine_control_bigtest, -DKD_TEST_PAD=<bytes>): a block of known bytes
// that makes the firmware bigger than 768 KB, the size the old flash layout allowed. Installing
// that build as a network update shows the bootloader writes the second half of the flash, and
// the check at start-up shows every byte of the block reads back right. Not in normal builds.
#ifdef KD_TEST_PAD
#include <Arduino.h>
#include "Log.h"

#define KD_STR2(x) #x
#define KD_STR(x) KD_STR2(x)

// Written by the assembler: C++14 has no short way to fill a big constant table.
// Byte i = (i * 31 + (i >> 8) * 7) & 255: a pattern that differs from block to block, so data
// landing at the wrong flash address shows up.
__asm__(".section .rodata.kdTestPad,\"a\",%progbits\n"
        ".global kdTestPad\n"
        "kdTestPad:\n"
        ".set kdpad_i, 0\n"
        ".rept " KD_STR(KD_TEST_PAD) "\n"
        ".byte (kdpad_i * 31 + (kdpad_i >> 8) * 7) & 255\n"
        ".set kdpad_i, kdpad_i + 1\n"
        ".endr\n"
        ".text\n");
extern "C" const uint8_t kdTestPad[];

// Called once at the end of setup(): using the block also keeps the linker from dropping it.
void testPadCheck() {
  uint32_t wrong = 0, first = 0;
  for (uint32_t i = 0; i < (uint32_t)KD_TEST_PAD; i++)
    if (kdTestPad[i] != (uint8_t)(i * 31 + (i >> 8) * 7)) { if (!wrong) first = i; wrong++; }
  uint32_t from = (uint32_t)kdTestPad, to = from + (uint32_t)KD_TEST_PAD;
  if (!wrong)
    LOGI(Sys, "Big test build: %lu KB of test data in flash at 0x%08lX-0x%08lX, all bytes correct",
         (unsigned long)(KD_TEST_PAD / 1024), (unsigned long)from, (unsigned long)to);
  else
    LOGE(Sys, "Big test build: %lu of %lu test bytes in flash are WRONG (first at 0x%08lX)",
         (unsigned long)wrong, (unsigned long)KD_TEST_PAD, (unsigned long)(from + first));
}
#endif
