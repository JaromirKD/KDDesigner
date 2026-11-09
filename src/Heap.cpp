// Faster heap: our own versions of Mbed's malloc wrappers (the core links with --wrap,_malloc_r
// etc.). Mbed's took a mutex for heap statistics on every call, on top of newlib's own heap
// lock, went through memory tracing, and did realloc as malloc + copy + free: ~3000 CPU cycles
// per allocation. Arduino Strings allocate all the time (a UDP message matched against 100
// triggers took ~1.7 ms, a "var x ++" ~1 ms). newlib's heap lock (Mbed's __malloc_lock, an RTOS
// mutex) stays: it is what makes malloc thread-safe.
// libmbed.a is linked whole (--whole-archive), so its versions of these functions are made weak
// in our copy of the library (tools/core/README.md, "Heap wrappers"): ours win.
#include <mbed.h>
#include <reent.h>
#include "platform/mbed_stats.h"

extern "C" {
void* __real__malloc_r(struct _reent* r, size_t n);
void __real__free_r(struct _reent* r, void* p);
void* __real__realloc_r(struct _reent* r, void* p, size_t n);
void* __real__calloc_r(struct _reent* r, size_t n, size_t size);
void* __real__memalign_r(struct _reent* r, size_t align, size_t n);

void* __wrap__malloc_r(struct _reent* r, size_t n) { return __real__malloc_r(r, n); }
void __wrap__free_r(struct _reent* r, void* p) { __real__free_r(r, p); }
void* __wrap__realloc_r(struct _reent* r, void* p, size_t n) { return __real__realloc_r(r, p, n); }
void* __wrap__calloc_r(struct _reent* r, size_t n, size_t size) { return __real__calloc_r(r, n, size); }
void* __wrap__memalign_r(struct _reent* r, size_t align, size_t n) { return __real__memalign_r(r, align, n); }

// The rest of Mbed's mbed_alloc_wrappers.o (GCC signatures, as in Mbed OS 6).
void* malloc_wrapper(struct _reent* r, size_t n, void*) { return __real__malloc_r(r, n); }
void free_wrapper(struct _reent* r, void* p, void*) { __real__free_r(r, p); }
// Mbed's heap statistics are gone with its wrappers (main.cpp reads mallinfo).
void mbed_stats_heap_get(mbed_stats_heap_t* stats) { memset(stats, 0, sizeof(*stats)); }
}
