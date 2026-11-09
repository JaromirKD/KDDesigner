#pragma once
// Small blocks (up to 256 bytes: Arduino Strings, vector buffers, JSON bits) come from free
// lists, one per size, in an arena taken from the heap once. newlib's malloc took an RTOS
// mutex on every call (~540 CPU cycles per malloc or free; a UDP trigger message made ~60
// of them); a free-list push or pop takes a few cycles with interrupts off. Bigger blocks,
// and small ones once the arena is used up, still go to newlib. Pages of the arena are given
// to a size for good: they are reused for that size, never handed back.
// Used by Heap.cpp; the includer defines KD_POOL_LOCK() / KD_POOL_UNLOCK(m) (tools/heaptest
// tests this file on a PC).
#include <stddef.h>
#include <stdint.h>
#include <string.h>

namespace HeapPool {
const int kClasses = 8;
const uint16_t kSize[kClasses] = {16, 32, 48, 64, 96, 128, 192, 256};
const size_t kPage = 2048;
const size_t kArena = 48 * 1024;
const size_t kMaxSmall = 256;

struct Free { Free* next; };
// No constructor and no member initialisers on purpose: a global Pool is zero bytes from the
// start. malloc runs before global constructors do, and a constructor would then wipe a pool
// already handing out blocks (seen on the board: the arena lost, its blocks freed into newlib).
struct Pool {
  uint8_t* arena;
  size_t used;                           // arena bytes given to sizes so far
  uint8_t pageClass[kArena / kPage];
  Free* lists[kClasses];
  size_t freeBytes;                      // in the lists, plus the arena not given out yet
  uint8_t classOf[kMaxSmall / 16 + 1];   // (n + 15) / 16 -> size class

  void begin(void* mem) {
    for (size_t k = 0; k <= kMaxSmall / 16; k++) {
      int c = 0;
      while (kSize[c] < k * 16) c++;
      classOf[k] = c;
    }
    arena = (uint8_t*)mem;
    freeBytes = mem ? kArena : 0;
  }
  bool owns(const void* p) const { return arena && (const uint8_t*)p >= arena && (const uint8_t*)p < arena + kArena; }
  size_t sizeOf(const void* p) const { return kSize[pageClass[((const uint8_t*)p - arena) / kPage]]; }

  void* alloc(size_t n) {
    if (!arena || n > kMaxSmall) return nullptr;
    const int c = classOf[(n + 15) >> 4];
    uint32_t m = KD_POOL_LOCK();
    Free* b = lists[c];
    if (b) {
      lists[c] = b->next;
      freeBytes -= kSize[c];
      KD_POOL_UNLOCK(m);
      return b;
    }
    if (used + kPage > kArena) { KD_POOL_UNLOCK(m); return nullptr; }   // arena full: newlib
    uint8_t* page = arena + used;
    pageClass[used / kPage] = c;
    used += kPage;
    const size_t sz = kSize[c], count = kPage / sz;
    for (size_t k = count - 1; k >= 1; k--) {   // the first block is this one, the rest wait
      Free* f = (Free*)(page + k * sz);
      f->next = lists[c];
      lists[c] = f;
    }
    freeBytes -= sz + (kPage - count * sz);    // what doesn't divide evenly is lost to the size
    KD_POOL_UNLOCK(m);
    return page;
  }

  void free(void* p) {   // p from this pool (owns(p))
    const int c = pageClass[((uint8_t*)p - arena) / kPage];
    uint32_t m = KD_POOL_LOCK();
    Free* f = (Free*)p;
    f->next = lists[c];
    lists[c] = f;
    freeBytes += kSize[c];
    KD_POOL_UNLOCK(m);
  }
};
}  // namespace HeapPool
