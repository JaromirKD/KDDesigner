#include "BigRam.h"
#include <SDRAM.h>
#include <mbed.h>

namespace {
bool ok = false;
size_t used = 0;
rtos::Mutex mtx;   // ea_malloc is not thread-safe; the HTTP thread and setup() both load projects

// Just before every block: where ea_malloc's block starts and the size asked for, so
// resize() can copy (ea_malloc has no realloc). ea_malloc only aligns to 4 bytes; blocks
// are 8-byte aligned here (engine tables hold doubles).
struct Head { void* raw; size_t size; };

// A few words across the chip: an absent or broken SDRAM reads back wrong.
bool works() {
  volatile uint32_t* m = (volatile uint32_t*)SDRAM_START_ADDRESS;
  const uint32_t at[] = {0, 1, 0x1000, 0x40000, 0x100000, 0x1FFFFF};   // words, up to the last
  for (uint32_t a : at) m[a] = 0xA5000000u ^ a;
  for (uint32_t a : at) if (m[a] != (0xA5000000u ^ a)) return false;
  return true;
}

// Arduino's SDRAM library maps the chip uncached and unbuffered (MPU region 5): every read
// went out to the external bus, so effects (program, scratch and fixture tables live here)
// took ~77 us per fixture and a big show's load nearly hit the watchdog. Write-back cached
// instead. Not shareable: the M7 doesn't cache shareable memory. Nothing hands SDRAM to DMA
// (writeAll in Web.cpp and Storage's big reads/writes copy through internal RAM).
void cacheOn() {
  MPU_Region_InitTypeDef r = {};
  HAL_MPU_Disable();
  r.Enable = MPU_REGION_ENABLE;
  r.BaseAddress = SDRAM_START_ADDRESS;
  r.Size = MPU_REGION_SIZE_8MB;
  r.Number = MPU_REGION_NUMBER5;   // the region SDRAM.begin() set up: replaced, not added
  r.TypeExtField = MPU_TEX_LEVEL1;  // TEX 1 + C + B = write-back, read and write allocate
  r.AccessPermission = MPU_REGION_FULL_ACCESS;
  r.DisableExec = MPU_INSTRUCTION_ACCESS_ENABLE;
  r.IsShareable = MPU_ACCESS_NOT_SHAREABLE;
  r.IsCacheable = MPU_ACCESS_CACHEABLE;
  r.IsBufferable = MPU_ACCESS_BUFFERABLE;
  HAL_MPU_ConfigRegion(&r);
  HAL_MPU_Enable(MPU_PRIVILEGED_DEFAULT);
  SCB_CleanInvalidateDCache();
}

struct JsonAlloc : ArduinoJson::Allocator {
  void* allocate(size_t n) override { return BigRam::alloc(n); }
  void deallocate(void* p) override { BigRam::release(p); }
  void* reallocate(void* p, size_t n) override { return BigRam::resize(p, n); }
};
}  // namespace

namespace BigRam {

bool begin() {
  if (ok) return true;
  if (SDRAM.begin(0) && works()) {   // 0: set up the chip, add it to ea_malloc below
    ok = SDRAM.begin(SDRAM_START_ADDRESS);
    if (ok) cacheOn();
  }
  return ok;
}

bool present() { return ok; }
size_t freeBytes() { return ok ? (SDRAM_END_ADDRESS - SDRAM_START_ADDRESS) - used : 0; }

void* alloc(size_t bytes) {
  if (!ok) return malloc(bytes);
  mtx.lock();
  void* raw = SDRAM.malloc(sizeof(Head) + 8 + bytes);
  Head* h = nullptr;
  if (raw) {
    h = (Head*)(((uintptr_t)raw + sizeof(Head) + 7) & ~(uintptr_t)7) - 1;
    h->raw = raw;
    h->size = bytes;
    used += sizeof(Head) + 8 + bytes;
  }
  mtx.unlock();
  return h ? h + 1 : nullptr;
}

void release(void* p) {
  if (!p) return;
  if (!ok) { free(p); return; }
  Head* h = (Head*)p - 1;
  mtx.lock();
  used -= sizeof(Head) + 8 + h->size;
  SDRAM.free(h->raw);
  mtx.unlock();
}

void* resize(void* p, size_t bytes) {
  if (!ok) return realloc(p, bytes);
  if (!p) return alloc(bytes);
  size_t old = ((Head*)p - 1)->size;
  if (bytes <= old) return p;   // shrinking: keep the block (ArduinoJson shrinks once, at the end)
  void* n = alloc(bytes);
  if (!n) return nullptr;
  memcpy(n, p, old);
  release(p);
  return n;
}

ArduinoJson::Allocator* json() {
  static JsonAlloc a;
  return &a;
}

}  // namespace BigRam
