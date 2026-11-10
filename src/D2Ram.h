#pragma once
#include <Arduino.h>
#include <new>

// The H7's D2 SRAM (0x30000000-0x3003FFFF, 256 KB) is not used by the Arduino core when the
// M4 core isn't running: the linker script only puts the Ethernet buffers above it
// (.lwip_sec at 0x30040000). Big fixed buffers live here so the heap stays free for
// project loading, connections and JSON. Allocation only, never freed.
namespace D2Ram {
void* alloc(size_t bytes, size_t align);
size_t used();
size_t freeBytes();   // between the alloc()s and the keep() blocks
// A block at the top of the area that is NOT cleared: D2 SRAM keeps its contents through a
// reset (watchdog, crash, restart), so what was there before can be read back. Always the
// same address for the same size; check your own magic number (after power-on it's noise).
void* keep(size_t bytes);

// A default-constructed T[N] in D2 SRAM, as an array reference (range-for still works).
// Safe from global constructors: alloc() switches the SRAM clocks on first.
template <typename T, size_t N>
T (&array())[N] {
  T* p = static_cast<T*>(alloc(sizeof(T) * N, alignof(T)));
  for (size_t i = 0; i < N; i++) new (p + i) T();
  return *reinterpret_cast<T(*)[N]>(p);
}
}  // namespace D2Ram
