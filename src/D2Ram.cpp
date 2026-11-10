#include "D2Ram.h"
#include <mbed.h>

namespace {
const uintptr_t kStart = 0x30000000;   // D2 SRAM1 + SRAM2
const uintptr_t kEnd = 0x30040000;     // .lwip_sec (Ethernet DMA, lwIP heap) starts here
uintptr_t next = 0;
uintptr_t top = kEnd;   // keep() blocks sit above this

void start() {
  if (next) return;
  // The SRAM clocks are off after reset unless the M4 or a driver turned them on.
  __HAL_RCC_D2SRAM1_CLK_ENABLE();
  __HAL_RCC_D2SRAM2_CLK_ENABLE();
  __HAL_RCC_D2SRAM3_CLK_ENABLE();
  __DSB();
  next = kStart;
}
}  // namespace

namespace D2Ram {

void* keep(size_t bytes) {
  start();
  uintptr_t p = (top - bytes) & ~(uintptr_t)31;
  if (p < next) MBED_ERROR(MBED_ERROR_OUT_OF_MEMORY, "D2 SRAM full: lower KD_MAX_PLAYBACKS / KD_LOG_RING");
  top = p;
  return (void*)p;
}

void* alloc(size_t bytes, size_t align) {
  start();
  uintptr_t p = (next + align - 1) & ~(uintptr_t)(align - 1);
  // Runs before setup() (global constructors), so a too-big build stops here, loudly.
  if (p + bytes > top) MBED_ERROR(MBED_ERROR_OUT_OF_MEMORY, "D2 SRAM full: lower KD_MAX_PLAYBACKS / KD_LOG_RING");
  next = p + bytes;
  memset((void*)p, 0, bytes);
  return (void*)p;
}

size_t used() { return next ? next - kStart : 0; }
size_t freeBytes() { start(); return top > next ? top - next : 0; }

}  // namespace D2Ram
