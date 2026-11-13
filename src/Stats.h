#pragma once
#include <Arduino.h>

// Per-second rates and timing, updated by the main loop, shown in the web UI.
struct Stats {
  uint32_t engineFps = 0;
  uint32_t dmxFps = 0;
  uint32_t artTxPs = 0, artRxPs = 0, sacnTxPs = 0, sacnRxPs = 0, udpRxPs = 0;
  uint32_t tickUsMax = 0;     // worst engine tick in the last second
  uint32_t loopUsMax = 0;     // worst main-loop iteration in the last second
  uint32_t tickPartUs[4] = {};   // average per frame: effects, fades, mixing, output (Show::Part)
  uint32_t trigUs = 0, busyUs = 0;   // last second: us in trigger handling / in the main loop (1000000 = all of it)
  // Where the main loop's time goes (last second), to find what makes a frame late: per part
  // the summed and the worst us; rounds made; worst time from one round's start to the next;
  // worst time the 1 ms sleep really took (long = other threads kept the main loop waiting).
  static const int kLoopParts = 12;
  uint32_t loopPartUs[kLoopParts] = {}, loopPartMax[kLoopParts] = {};
  uint32_t loopRounds = 0, loopGapUs = 0, loopSleepUs = 0;
  uint32_t udpDropped = 0;    // UDP packets the receive queue had no room for (since boot)
  uint32_t httpRequests = 0;
  // Heap (dynamic memory): total size, in use, free now, lowest free since boot.
  uint32_t heapSize = 0, heapUsed = 0, heapFree = 0, heapMinFree = 0;
  const char* resetReason = "";   // why the board last started (power on, watchdog...)
};
extern Stats g_stats;
