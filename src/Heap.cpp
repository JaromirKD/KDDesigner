// Faster heap: our own versions of Mbed's malloc wrappers (the core links with --wrap,_malloc_r
// etc.). Mbed's took a mutex for heap statistics on every call, on top of newlib's own heap
// lock, went through memory tracing, and did realloc as malloc + copy + free: ~3000 CPU cycles
// per allocation. Arduino Strings allocate all the time (a UDP message matched against 100
// triggers took ~1.7 ms, a "var x ++" ~1 ms).
// Small blocks come from HeapPool (free lists, a few cycles with interrupts off); newlib's
// malloc, with its lock (Mbed's __malloc_lock, an RTOS mutex, ~540 cycles a call), only gets
// the big ones. Don't make that lock a critical section instead: tried, the board hung at boot.
// libmbed.a is linked whole (--whole-archive), so its versions of these functions are made weak
// in our copy of the library (tools/core/README.md, "Heap wrappers"): ours win.
#include <mbed.h>
#include <reent.h>
#include "platform/mbed_stats.h"
#include "Heap.h"

// Interrupts off only for a list push / pop (also safe if an interrupt frees memory).
#define KD_POOL_LOCK() ([]() { uint32_t m = __get_PRIMASK(); __disable_irq(); return m; }())
#define KD_POOL_UNLOCK(m) __set_PRIMASK(m)
#include "HeapPool.h"

extern "C" {
void* __real__malloc_r(struct _reent* r, size_t n);
void __real__free_r(struct _reent* r, void* p);
void* __real__realloc_r(struct _reent* r, void* p, size_t n);
void* __real__calloc_r(struct _reent* r, size_t n, size_t size);
void* __real__memalign_r(struct _reent* r, size_t align, size_t n);
}

namespace {
HeapPool::Pool pool;   // zero until start() (see HeapPool.h: no constructor)
bool started;

// The arena is taken at the first allocation (global constructors, one thread): AXI RAM like
// the rest of the heap, so the network can send from it as before.
inline void start(struct _reent* r) {
  if (started) return;
  started = true;
  pool.begin(__real__malloc_r(r, HeapPool::kArena));
}
}  // namespace

extern "C" {
void* __wrap__malloc_r(struct _reent* r, size_t n) {
  start(r);
  void* p = pool.alloc(n);
  return p ? p : __real__malloc_r(r, n);
}

void __wrap__free_r(struct _reent* r, void* p) {
  if (!p) return;
  if (pool.owns(p)) pool.free(p);
  else __real__free_r(r, p);
}

void* __wrap__realloc_r(struct _reent* r, void* p, size_t n) {
  if (!p) return __wrap__malloc_r(r, n);
  if (!pool.owns(p)) return __real__realloc_r(r, p, n);
  if (!n) { pool.free(p); return nullptr; }
  const size_t have = pool.sizeOf(p);
  if (n <= have) return p;   // still fits its block
  void* q = __wrap__malloc_r(r, n);
  if (!q) return nullptr;    // p stays valid, as realloc promises
  memcpy(q, p, have);
  pool.free(p);
  return q;
}

void* __wrap__calloc_r(struct _reent* r, size_t n, size_t size) {
  if (size && n > (size_t)-1 / size) return nullptr;
  start(r);
  void* p = pool.alloc(n * size);
  if (p) { memset(p, 0, n * size); return p; }
  return __real__calloc_r(r, n, size);
}

void* __wrap__memalign_r(struct _reent* r, size_t align, size_t n) { return __real__memalign_r(r, align, n); }

// The rest of Mbed's mbed_alloc_wrappers.o (GCC signatures, as in Mbed OS 6).
void* malloc_wrapper(struct _reent* r, size_t n, void*) { return __wrap__malloc_r(r, n); }
void free_wrapper(struct _reent* r, void* p, void*) { __wrap__free_r(r, p); }
// Mbed's heap statistics are gone with its wrappers (main.cpp reads mallinfo).
void mbed_stats_heap_get(mbed_stats_heap_t* stats) { memset(stats, 0, sizeof(*stats)); }
}

namespace Heap {
// Free bytes inside the small-block arena (newlib counts the whole arena as in use).
size_t poolFree() { return pool.freeBytes; }
}
