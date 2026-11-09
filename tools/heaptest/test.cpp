// PC test of src/HeapPool.h (the firmware's small-block allocator), with the same
// malloc / free / realloc logic as src/Heap.cpp on top of the C library's malloc:
//   wsl g++ -std=c++14 -O2 -I src tools/heaptest/test.cpp -o /tmp/heaptest && /tmp/heaptest
// Random allocations, reallocations and frees; every block is filled with its own pattern and
// checked before it is freed or grown, so overlapping blocks or lost contents show up.
#include <stdio.h>
#include <stdlib.h>
#include <vector>
#define KD_POOL_LOCK() 0u
#define KD_POOL_UNLOCK(m) (void)(m)
#include "HeapPool.h"

HeapPool::Pool pool;
void* xmalloc(size_t n) { void* p = pool.alloc(n); return p ? p : malloc(n); }
void xfree(void* p) { if (!p) return; if (pool.owns(p)) pool.free(p); else free(p); }
void* xrealloc(void* p, size_t n) {
  if (!p) return xmalloc(n);
  if (!pool.owns(p)) return realloc(p, n);
  if (!n) { pool.free(p); return nullptr; }
  size_t have = pool.sizeOf(p);
  if (n <= have) return p;
  void* q = xmalloc(n);
  if (!q) return nullptr;
  memcpy(q, p, have);
  pool.free(p);
  return q;
}

struct Blk { unsigned char* p; size_t n; unsigned char tag; };
bool check(const Blk& b) { for (size_t k = 0; k < b.n; k++) if (b.p[k] != (unsigned char)(b.tag + k)) return false; return true; }
void fill(Blk& b) { for (size_t k = 0; k < b.n; k++) b.p[k] = (unsigned char)(b.tag + k); }

int main() {
  void* arena = malloc(HeapPool::kArena);
  pool.begin(arena);
  size_t total = pool.freeBytes;
  std::vector<Blk> live;
  srand(12345);
  int bad = 0, fromPool = 0, ops = 0;
  for (int round = 0; round < 2000000; round++) {
    int op = rand() % 10;
    ops++;
    if (op < 4 || live.empty()) {   // alloc: mostly small, some big
      size_t n = rand() % 8 == 0 ? 200 + rand() % 3000 : rand() % 300;
      Blk b{(unsigned char*)xmalloc(n), n, (unsigned char)rand()};
      if (!b.p) { printf("alloc failed\n"); return 1; }
      if (pool.owns(b.p)) fromPool++;
      fill(b);
      live.push_back(b);
    } else if (op < 7) {   // free
      size_t i = rand() % live.size();
      if (!check(live[i])) bad++;
      xfree(live[i].p);
      live[i] = live.back();
      live.pop_back();
    } else {   // realloc (grow or shrink); the kept part must survive
      size_t i = rand() % live.size();
      Blk& b = live[i];
      if (!check(b)) bad++;
      size_t n = rand() % 4 == 0 ? rand() % 2000 : rand() % 300;
      if (!n) n = 1;
      unsigned char* q = (unsigned char*)xrealloc(b.p, n);
      if (!q) { printf("realloc failed\n"); return 1; }
      size_t keep = n < b.n ? n : b.n;
      for (size_t k = 0; k < keep; k++) if (q[k] != (unsigned char)(b.tag + k)) { bad++; break; }
      b.p = q;
      b.n = n;
      fill(b);
    }
    if (live.size() > 3000) {   // keep it bounded: free half
      for (size_t i = 0; i < live.size(); i += 2) { if (!check(live[i])) bad++; xfree(live[i].p); live[i].p = nullptr; }
      std::vector<Blk> keep;
      for (auto& b : live) if (b.p) keep.push_back(b);
      live.swap(keep);
    }
  }
  for (auto& b : live) { if (!check(b)) bad++; xfree(b.p); }
  // Everything freed: the pool must have all of its bytes back (minus the page tails lost to sizes).
  size_t lost = 0;
  for (size_t pg = 0; pg < pool.used / HeapPool::kPage; pg++) lost += HeapPool::kPage % HeapPool::kSize[pool.pageClass[pg]];
  printf("%d ops, %d from the pool, %d corrupted, pool %zu of %zu bytes free (%zu lost to page tails), %zu pages used\n", ops, fromPool, bad,
         pool.freeBytes, total, lost, pool.used / HeapPool::kPage);
  return bad || pool.freeBytes + lost != total ? 1 : 0;
}
