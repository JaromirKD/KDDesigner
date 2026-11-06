#pragma once
#include <Arduino.h>

// Per-second rates and timing, updated by the main loop, shown in the web UI.
struct Stats {
  uint32_t engineFps = 0;
  uint32_t dmxFps = 0;
  uint32_t artTxPs = 0, artRxPs = 0, sacnTxPs = 0, sacnRxPs = 0, udpRxPs = 0;
  uint32_t tickUsMax = 0;     // worst engine tick in the last second
  uint32_t loopUsMax = 0;     // worst main-loop iteration in the last second
  uint32_t httpRequests = 0;
  // Heap (dynamic memory): total size, in use, free now, lowest free since boot.
  uint32_t heapSize = 0, heapUsed = 0, heapFree = 0, heapMinFree = 0;
  const char* resetReason = "";   // why the board last started (power on, watchdog...)
};
extern Stats g_stats;
