#include "NetRx.h"
#include <mbed.h>
#include "BigRam.h"
#include "Log.h"

using namespace std::chrono_literals;

namespace {
struct Watched { EthernetUDP* sock = nullptr; NetRx::Handler handler = nullptr; };
Watched socks[NetRx::kSockets];
rtos::Mutex lock;            // socks[], and a socket is never closed while the thread reads it
rtos::EventFlags wake;
rtos::Thread* thread = nullptr;
uint8_t buf[1024];           // as MbedUDP's own receive buffer (WIFI_UDP_BUFFER_SIZE)

// The queue: one writer (the thread), one reader (the main loop), so no lock: each side only
// moves its own index, after the data. Free-running byte counters; a record never wraps (a
// 0xFFFF length at the end says "go on at the start").
const uint32_t kRing = 64 * 1024;
uint8_t* ring = nullptr;
volatile uint32_t head = 0, tail = 0;
uint32_t droppedCount = 0;
struct Hdr { uint16_t len; uint8_t slot, pad; uint32_t ip; uint16_t port, pad2; };
const uint32_t kHdr = sizeof(Hdr);
inline uint32_t align4(uint32_t n) { return (n + 3) & ~3u; }

void push(int slot, const uint8_t* data, int len, const IPAddress& from, uint16_t port) {
  if (!ring) return;
  const uint32_t need = kHdr + align4(len);
  const uint32_t h = head, pos = h % kRing;
  const uint32_t skip = kRing - pos < need ? kRing - pos : 0;   // no room before the end: start again at 0
  if (kRing - (h - tail) < skip + need) { droppedCount++; return; }
  if (skip) *(uint16_t*)(ring + pos) = 0xFFFF;
  uint8_t* p = ring + (h + skip) % kRing;
  Hdr hd = {(uint16_t)len, (uint8_t)slot, 0, (uint32_t)from[0] | (from[1] << 8) | (from[2] << 16) | ((uint32_t)from[3] << 24), port, 0};
  memcpy(p, &hd, kHdr);
  memcpy(p + kHdr, data, len);
  __DMB();   // the record is complete before the reader can see it
  head = h + skip + need;
}

void wakeUp() { wake.set(1); }

void run() {
  for (;;) {
    wake.wait_any_for(1, 5ms);   // the stack wakes us; 5 ms in case a wake-up was missed
    bool more = false;
    lock.lock();
    for (int s = 0; s < NetRx::kSockets; s++) {
      Watched& w = socks[s];
      if (!w.sock) continue;
      // A burst on one socket must not keep the others waiting: 32 at a time, then round again.
      for (int n = 0; n < 32; n++) {
        IPAddress from;
        uint16_t port;
        int len = w.sock->receive(buf, sizeof(buf), from, port);
        if (len == 0) break;
        if (len < 0) continue;   // an empty datagram or an error: the next one
        if (n == 31) more = true;
        if (w.handler) w.handler(buf, len, from, port);
        else push(s, buf, len, from, port);
      }
    }
    lock.unlock();
    if (more) wake.set(1);
  }
}
}  // namespace

namespace NetRx {

void watch(int slot, EthernetUDP* sock, Handler handler) {
  if (slot < 0 || slot >= kSockets) return;
  lock.lock();
  socks[slot].sock = sock;
  socks[slot].handler = handler;
  lock.unlock();
  sock->onEvent(mbed::callback(wakeUp));
  wake.set(1);   // something may be waiting already
}

void unwatch(int slot) {
  if (slot < 0 || slot >= kSockets) return;
  lock.lock();   // waits for a read in progress
  if (socks[slot].sock) socks[slot].sock->onEvent(nullptr);
  socks[slot].sock = nullptr;
  lock.unlock();
}

void begin() {
  if (thread) return;
  ring = (uint8_t*)BigRam::alloc(kRing);   // only the CPU touches it (no DMA): SDRAM is fine
  if (!ring) LOGE(Net, "No memory for the network receive queue: UDP trigger messages are not received");
  // Above the main loop (normal), so packets are taken while it renders a frame; it only
  // copies them, so the main loop barely notices. Same as the DMX thread.
  thread = new rtos::Thread(osPriorityAboveNormal, 3072, nullptr, "netrx");
  thread->start(run);
  // lwIP's own thread (it takes the packets from the Ethernet driver and hands them to the
  // sockets) runs at normal priority, sharing the CPU with the main loop and a dozen other
  // threads, so while an engine frame is rendered it waits, and the driver has buffers for
  // only ~7 packets (more arriving back to back are dropped by the chip). Above normal, like
  // this thread, it empties them at once; it only does short protocol work.
  osThreadId_t ids[32];
  uint32_t n = osThreadEnumerate(ids, 32);
  for (uint32_t k = 0; k < n; k++) {
    const char* name = osThreadGetName(ids[k]);
    if (name && !strcmp(name, "lwip_tcpip")) osThreadSetPriority(ids[k], osPriorityAboveNormal);
  }
}

bool take(int& slot, IPAddress& from, uint16_t& port, uint8_t* out, int& len) {
  for (;;) {
    uint32_t t = tail;
    if (t == head) return false;
    __DMB();   // read the record only after seeing head
    uint32_t pos = t % kRing;
    if (*(uint16_t*)(ring + pos) == 0xFFFF) { tail = t + (kRing - pos); continue; }
    Hdr hd;
    memcpy(&hd, ring + pos, kHdr);
    int n = hd.len < len - 1 ? hd.len : len - 1;
    memcpy(out, ring + pos + kHdr, n);
    out[n] = 0;
    len = n;
    slot = hd.slot;
    from = IPAddress(hd.ip & 0xff, (hd.ip >> 8) & 0xff, (hd.ip >> 16) & 0xff, hd.ip >> 24);
    port = hd.port;
    __DMB();   // done reading before the writer may reuse the space
    tail = t + kHdr + align4(hd.len);
    return true;
  }
}

void clear() { tail = head; }
uint32_t dropped() { return droppedCount; }

}  // namespace NetRx
