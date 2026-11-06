#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include <mbed.h>
#include <vector>

// The Portenta H7's 8 MB SDRAM, for big temporary things: the project text and its parsed
// JSON (a 75 KB show needs ~3x that, more than the ~200 KB heap has free). Falls back to the
// normal heap when there is no SDRAM (a Portenta H7 Lite) or before begin().
namespace BigRam {
bool begin();          // call first in setup(): sets up the SDRAM and checks it works
bool present();
size_t freeBytes();    // SDRAM not handed out (0 without SDRAM)

void* alloc(size_t bytes);
void* resize(void* p, size_t bytes);
void release(void* p);

// For JsonDocument d(BigRam::json()).
ArduinoJson::Allocator* json();

// std::vector in SDRAM: Vec<T>. For the show engine's tables (fixtures, scenes, cues,
// effects): ~40 KB for a mid-size show, and a save builds a second copy before the swap.
// Only for data the CPU reads; never hand SDRAM memory to the network (see Web.cpp writeAll).
template <class T>
struct Alloc {
  using value_type = T;
  Alloc() = default;
  template <class U> Alloc(const Alloc<U>&) {}
  T* allocate(size_t n) {
    void* p = alloc(n * sizeof(T));
    if (!p) MBED_ERROR(MBED_ERROR_OUT_OF_MEMORY, "SDRAM full");
    return static_cast<T*>(p);
  }
  void deallocate(T* p, size_t) { release(p); }
  template <class U> bool operator==(const Alloc<U>&) const { return true; }
  template <class U> bool operator!=(const Alloc<U>&) const { return false; }
};
template <class T> using Vec = std::vector<T, Alloc<T>>;

// Text that grows in SDRAM, for big replies (status, log): an Arduino String of a few KB
// can fail to grow on a fragmented heap and then silently stops (cut-off JSON).
struct Text {
  char* data = nullptr;
  size_t len = 0, cap = 0;
  bool failed = false;
  Text() {}
  ~Text() { release(data); }
  bool add(const char* s, size_t n) {
    if (len + n + 1 > cap) {
      size_t c = max((size_t)1024, max(cap * 2, len + n + 1));
      char* p = (char*)resize(data, c);
      if (!p) { failed = true; return false; }
      data = p;
      cap = c;
    }
    memcpy(data + len, s, n);
    len += n;
    data[len] = 0;
    return true;
  }
  bool add(const char* s) { return add(s, strlen(s)); }
  bool add(const String& s) { return add(s.c_str(), s.length()); }
  bool add(char ch) { return add(&ch, 1); }
  // ArduinoJson writes into it with serializeJson(doc, text).
  size_t write(uint8_t c) { return add((char)c) ? 1 : 0; }
  size_t write(const uint8_t* s, size_t n) { return add((const char*)s, n) ? n : 0; }
  Text(const Text&) = delete;
  Text& operator=(const Text&) = delete;
};

// A block that frees itself, e.g. a file read whole.
struct Buffer {
  char* data = nullptr;
  size_t len = 0;
  Buffer() {}
  ~Buffer() { release(data); }
  bool reserve(size_t n) { release(data); len = 0; data = (char*)alloc(n + 1); return data != nullptr; }
  Buffer(const Buffer&) = delete;
  Buffer& operator=(const Buffer&) = delete;
};
}  // namespace BigRam
