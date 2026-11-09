#pragma once
#include <Arduino.h>
#include <EthernetUdp.h>
#include "Config.h"

// The network receive thread. Mbed's network stack keeps only 8 packets per UDP socket; the
// main loop read them between engine frames, so at a few thousand messages a second most of
// what arrived during a 13 ms frame was dropped. This thread (above the main loop's priority,
// woken by the stack as packets arrive) empties the sockets at once: into a 64 KB queue in
// SDRAM that the main loop works through (trigger ports), or straight to a handler that runs
// in this thread (Art-Net / sACN: DMX input frames and ArtPoll, see Net.cpp).
namespace NetRx {
enum { kArtNet = 0, kSacn = 1, kFirstTrigger = 2, kSockets = kFirstTrigger + KD_MAX_UDP_PORTS };

// Runs in the receive thread: short, and it locks what it shares with other threads.
typedef void (*Handler)(const uint8_t* data, int len, const IPAddress& from, uint16_t port);

// Socket slot (an enum above) is read from now on: its packets go to the queue, or to handler.
// unwatch() before closing or reopening the socket (begin/stop), watch() again after.
void watch(int slot, EthernetUDP* sock, Handler handler = nullptr);
void unwatch(int slot);
void begin();   // starts the thread; call after Net::begin

// The oldest queued packet, copied into buf (cut at len - 1 bytes and 0-terminated); false
// when the queue is empty. Main loop only.
bool take(int& slot, IPAddress& from, uint16_t& port, uint8_t* buf, int& len);
void clear();          // drop what is queued (a project reload reopens the trigger ports)
uint32_t dropped();    // packets the queue had no room for, since boot
}  // namespace NetRx
